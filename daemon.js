// Keeps Discord Rich Presence in sync with Claude Code sessions. Launched hidden at Windows logon.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pickSession, buildActivity, modelName, DATA_DIR, SESSIONS_DIR, LOCK_PIPE } = require('./presence');

// Settings, later files win: config.json (defaults), config.local.json (gitignored, for clone installs),
// ~/.claude/discord-presence/config.json (survives plugin updates). Read every tick, so edits apply without a restart.
const CONFIG_FILES = [
  path.join(__dirname, 'config.json'),
  path.join(__dirname, 'config.local.json'),
  path.join(DATA_DIR, 'config.json'),
];
let lastConfigError;

function loadConfig() {
  return CONFIG_FILES.reduce((config, file) => {
    try {
      return { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      const message = `${file}: ${err.message}`;
      if (err.code !== 'ENOENT' && message !== lastConfigError) log(`ignoring bad config ${message}`);
      if (err.code !== 'ENOENT') lastConfigError = message;
      return config;
    }
  }, {});
}

const run = promisify(execFile);
const POLL_MS = 5000; // ≤ 4 updates per 20 s, under Discord's limit of 5
const HANDSHAKE_TIMEOUT_MS = 10000;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

let socket = null; // handshaken Discord connection
let lastSent;
const lastModel = new Map(); // transcript → last model id (a huge tool output can push it out of the tail)

function log(message) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'daemon.log'), `${new Date().toISOString()} ${message}\n`);
  } catch { /* logging must never kill the daemon */ }
}

function frame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function openPipe(index) {
  return new Promise((resolve, reject) => {
    const pipe = net.createConnection(`\\\\?\\pipe\\discord-ipc-${index}`, () => resolve(pipe));
    pipe.once('error', reject);
  });
}

function handshake(pipe) {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('no reply from Discord')), HANDSHAKE_TIMEOUT_MS);
    let buffer = Buffer.alloc(0);
    pipe.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= 8 + buffer.readInt32LE(4)) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        const message = JSON.parse(buffer.subarray(8, 8 + length).toString('utf8'));
        buffer = buffer.subarray(8 + length);
        if (op === OP.FRAME && message.evt === 'READY') resolve();
        if (op === OP.FRAME && message.evt === 'ERROR') log(`Discord error: ${message.data?.message}`);
        if (op === OP.PING) pipe.write(frame(OP.PONG, message));
        if (op === OP.CLOSE) {
          log(`Discord closed the connection: ${message.message}`);
          reject(new Error(message.message));
          pipe.destroy();
        }
      }
    });
    pipe.on('error', () => { /* 'close' always follows */ });
    pipe.on('close', () => {
      if (socket === pipe) {
        socket = null;
        lastSent = undefined;
        log('disconnected from Discord');
      }
      reject(new Error('connection closed'));
    });
    pipe.write(frame(OP.HANDSHAKE, { v: 1, client_id: loadConfig().clientId }));
  });
}

async function connect() {
  for (let index = 0; index < 10 && !socket; index++) {
    const pipe = await openPipe(index).catch(() => null);
    if (!pipe) continue;
    try {
      await handshake(pipe);
      socket = pipe;
      log(`connected to Discord (discord-ipc-${index})`);
    } catch (err) {
      log(`handshake failed: ${err.message}`);
      pipe.destroy();
    }
  }
}

function readSessions() {
  let files;
  try { files = fs.readdirSync(SESSIONS_DIR); } catch { return []; }
  // ponytail: files of crashed sessions (no SessionEnd) stay behind; they are tiny and ignored once stale.
  return files.flatMap((file) => {
    try { return [JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'))]; } catch { return []; }
  });
}

function transcriptModel(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const tail = Buffer.alloc(length);
    fs.readSync(fd, tail, 0, length, size - length);
    const ids = tail.toString('utf8').match(/"model":"claude-[^"]+"/g);
    return ids ? ids[ids.length - 1].slice('"model":"'.length, -1) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sessionModel(session) {
  const id = transcriptModel(session.transcript) || lastModel.get(session.transcript) || session.model;
  lastModel.set(session.transcript, id);
  return modelName(id);
}

async function repoAndBranch(cwd) {
  const git = (...args) => run('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 3000 })
    .then(({ stdout }) => stdout.trim());
  try {
    const [commonDir, branch] = await Promise.all([
      git('rev-parse', '--path-format=absolute', '--git-common-dir'),
      git('branch', '--show-current'),
    ]);
    // Worktrees share the main repo's .git, so this names the repo, not the worktree folder.
    const root = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;
    return { repo: path.basename(root), branch: branch || null };
  } catch {
    return { repo: path.basename(cwd || '') || 'Claude', branch: null };
  }
}

async function isClaudeRunning() {
  try {
    const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/NH'], { windowsHide: true });
    return /claude\.exe/i.test(stdout);
  } catch {
    return false;
  }
}

async function currentActivity() {
  const session = pickSession(readSessions(), Date.now());
  const config = loadConfig();
  const options = { image: config.largeImage, language: config.language };
  if (!session) return buildActivity(null, await isClaudeRunning(), options);
  const { repo, branch } = await repoAndBranch(session.cwd);
  return buildActivity({ ...session, repo, branch, model: sessionModel(session) }, true, options);
}

async function tick() {
  if (!socket) await connect();
  if (!socket) return;
  const activity = await currentActivity();
  const key = JSON.stringify(activity);
  if (key === lastSent) return;
  socket.write(frame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) }));
  lastSent = key;
}

async function loop() {
  try { await tick(); } catch (err) { log(`error: ${err.stack}`); }
  setTimeout(loop, POLL_MS);
}

// Single instance: a second copy fails to claim the pipe and exits.
// Connecting to the pipe stops the running daemon (install.js does this before restarting or uninstalling).
net.createServer(() => {
  log('stopped by install.js');
  process.exit(0);
})
  .once('error', () => process.exit(0))
  .listen(LOCK_PIPE, () => {
    log('daemon started');
    loop();
  });
