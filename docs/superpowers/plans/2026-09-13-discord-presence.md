# Claude Discord Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude Code / Claude app activity (repo, branch, state, model) as Discord Rich Presence.

**Architecture:** Async Claude Code hooks (`hook.js`) write one small JSON file per session. A hidden,
single-instance Node daemon (`daemon.js`) polls those files every 5 s, derives repo/branch (git) and
model (transcript tail), and sends `SET_ACTIVITY` over Discord's local IPC named pipe. Pure logic
lives in `presence.js` and is covered by `test.js`.

**Tech Stack:** Node 24 (stdlib only), git CLI, Windows Startup folder + VBScript launcher.

## Global Constraints

- Zero npm dependencies; Node stdlib only.
- Discord Application ID: `1548485169738940466`; large image asset key: `claude`.
- UI copy in pt-PT exactly as in the spec state table.
- Hooks must never slow or break Claude Code: `"async": true`, errors never escape `hook.js`.
- Data dir: `~/.claude/discord-presence/` (`sessions/<session_id>.json`, `daemon.log`, `hook-error.log`).
- Discord field limit: `details`/`state` ≤ 128 chars.
- Poll interval 5 s (≤ 4 updates / 20 s, under Discord's 5 / 20 s limit).

---

### Task 1: Pure presence logic

**Files:**
- Create: `presence.js`
- Test: `test.js`

**Interfaces:**
- Produces: `stateFor(event: string, tool?: string, notificationType?: string): string|null`,
  `modelName(id?: string): string|null`, `pickSession(sessions: {updatedAt:number}[], now: number): object|null`,
  `buildActivity(session: {repo, branch, state, model, startedAt}|null, appOpen: boolean): object|null`,
  constants `DATA_DIR`, `SESSIONS_DIR`.

- [ ] **Step 1: Write the failing test** — `test.js`

```js
// Self-check for presence.js — run: node test.js
const assert = require('assert');
const { stateFor, modelName, pickSession, buildActivity } = require('./presence');

assert.strictEqual(modelName('claude-opus-5'), 'Opus 5');
assert.strictEqual(modelName('claude-fable-5-1'), 'Fable 5.1');
assert.strictEqual(modelName('claude-sonnet-5'), 'Sonnet 5');
assert.strictEqual(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
assert.strictEqual(modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
assert.strictEqual(modelName('claude-opus-5[1m]'), 'Opus 5');
assert.strictEqual(modelName('<synthetic>'), null);
assert.strictEqual(modelName(undefined), null);

assert.strictEqual(stateFor('UserPromptSubmit'), '🤔 A pensar');
assert.strictEqual(stateFor('PostToolUse', 'Read'), '🤔 A pensar');
assert.strictEqual(stateFor('PreToolUse', 'Edit'), '✍️ A escrever código');
assert.strictEqual(stateFor('PreToolUse', 'Grep'), '📖 A ler código');
assert.strictEqual(stateFor('PreToolUse', 'PowerShell'), '⚙️ A correr comandos');
assert.strictEqual(stateFor('PreToolUse', 'WebFetch'), '🌐 A pesquisar');
assert.strictEqual(stateFor('PreToolUse', 'Agent'), '🤖 A coordenar agentes');
assert.strictEqual(stateFor('PreToolUse', 'mcp__github__search'), '🛠️ A usar ferramentas');
assert.strictEqual(stateFor('Notification', undefined, 'permission_prompt'), '✋ À espera de aprovação');
assert.strictEqual(stateFor('Notification', undefined, 'idle_prompt'), '💬 À espera de ti');
assert.strictEqual(stateFor('Notification', undefined, 'auth_success'), null);
assert.strictEqual(stateFor('SessionStart'), '💬 À espera de ti');
assert.strictEqual(stateFor('Stop'), '💬 À espera de ti');
assert.strictEqual(stateFor('SessionEnd'), null);

const now = 100_000_000;
const recent = { updatedAt: now - 1000 };
const older = { updatedAt: now - 5000 };
const stale = { updatedAt: now - 31 * 60 * 1000 };
assert.strictEqual(pickSession([older, stale, recent], now), recent);
assert.strictEqual(pickSession([stale], now), null);
assert.strictEqual(pickSession([], now), null);

assert.deepStrictEqual(
  buildActivity({ repo: 'site', branch: 'main', state: '🤔 A pensar', model: 'Opus 5', startedAt: 123 }, true),
  {
    details: '📁 site · 🌿 main',
    state: '🤔 A pensar · Opus 5',
    timestamps: { start: 123 },
    assets: { large_image: 'claude', large_text: 'Claude Code' },
  },
);
const noGit = buildActivity({ repo: 'notas', branch: null, state: '💬 À espera de ti', model: null, startedAt: 1 }, false);
assert.strictEqual(noGit.details, '📁 notas');
assert.strictEqual(noGit.state, '💬 À espera de ti');
assert.strictEqual(buildActivity({ repo: 'x'.repeat(300), branch: null, state: 's', model: null, startedAt: 1 }, false).details.length, 128);
assert.deepStrictEqual(buildActivity(null, true), { assets: { large_image: 'claude', large_text: 'Claude' } });
assert.strictEqual(buildActivity(null, false), null);

console.log('ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js` — Expected: FAIL `Cannot find module './presence'`

- [ ] **Step 3: Write minimal implementation** — `presence.js`

```js
// Pure logic: hook events → state labels, model ids → names, sessions → Discord activity.
const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.homedir(), '.claude', 'discord-presence');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const STALE_MS = 30 * 60 * 1000;
const MAX_FIELD = 128; // Discord limit for details/state

const THINKING = '🤔 A pensar';
const WAITING = '💬 À espera de ti';
const TOOL_STATES = [
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, '✍️ A escrever código'],
  [/^(Read|Grep|Glob)$/, '📖 A ler código'],
  [/^(Bash|PowerShell)$/, '⚙️ A correr comandos'],
  [/^(WebSearch|WebFetch)$/, '🌐 A pesquisar'],
  [/^(Agent|Task|Workflow)$/, '🤖 A coordenar agentes'],
];

// State label for a hook event, or null when the event must not change the state.
function stateFor(event, tool, notificationType) {
  switch (event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return THINKING;
    case 'PreToolUse': {
      const match = TOOL_STATES.find(([pattern]) => pattern.test(tool || ''));
      return match ? match[1] : '🛠️ A usar ferramentas';
    }
    case 'Notification':
      if (notificationType === 'permission_prompt') return '✋ À espera de aprovação';
      return notificationType === 'idle_prompt' ? WAITING : null;
    case 'SessionStart':
    case 'Stop':
      return WAITING;
    default:
      return null;
  }
}

// 'claude-fable-5-1' → 'Fable 5.1', 'claude-3-5-sonnet-20241022' → 'Sonnet 3.5'.
function modelName(id) {
  const parts = String(id || '').toLowerCase().replace(/\[.*\]$/, '').split('-')
    .filter((part) => part !== 'claude' && !/^\d{8}$/.test(part));
  const family = parts.find((part) => /^[a-z]+$/.test(part));
  if (!family) return null;
  const version = parts.filter((part) => /^\d+$/.test(part)).join('.');
  return [family[0].toUpperCase() + family.slice(1), version].filter(Boolean).join(' ');
}

function pickSession(sessions, now) {
  return sessions
    .filter((session) => now - session.updatedAt < STALE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

const clip = (text) => (text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text);

function buildActivity(session, appOpen) {
  if (!session) return appOpen ? { assets: { large_image: 'claude', large_text: 'Claude' } } : null;
  return {
    details: clip(session.branch ? `📁 ${session.repo} · 🌿 ${session.branch}` : `📁 ${session.repo}`),
    state: clip(session.model ? `${session.state} · ${session.model}` : session.state),
    timestamps: { start: session.startedAt },
    assets: { large_image: 'claude', large_text: 'Claude Code' },
  };
}

module.exports = { DATA_DIR, SESSIONS_DIR, stateFor, modelName, pickSession, buildActivity };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js` — Expected: `ok`

- [ ] **Step 5: Commit** — `git add presence.js test.js && git commit -m "feat: presence state, model name and activity logic"`

---

### Task 2: Hook recorder

**Files:**
- Create: `hook.js`

**Interfaces:**
- Consumes: `stateFor`, `DATA_DIR`, `SESSIONS_DIR` from `presence.js`.
- Produces: `~/.claude/discord-presence/sessions/<session_id>.json` =
  `{ cwd, transcript, model, state, startedAt, updatedAt }` (ms epoch); deleted on `SessionEnd`.

- [ ] **Step 1: Write implementation** — `hook.js`

```js
// Claude Code hook: records the session's current state for daemon.js. Registered with "async": true.
const fs = require('fs');
const path = require('path');
const { stateFor, DATA_DIR, SESSIONS_DIR } = require('./presence');

const spawnedAt = Date.now();

function record(input) {
  if (!/^[\w-]+$/.test(input.session_id || '')) return; // used as a file name
  const file = path.join(SESSIONS_DIR, `${input.session_id}.json`);
  if (input.hook_event_name === 'SessionEnd') return fs.rmSync(file, { force: true });

  const state = stateFor(input.hook_event_name, input.tool_name, input.notification_type);
  if (!state) return;

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first event of the session */ }
  // ponytail: async hooks may finish out of order, so the newest spawn wins; the tiny read→write race is accepted.
  if (prev.updatedAt > spawnedAt) return;

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    cwd: input.cwd || prev.cwd,
    transcript: input.transcript_path || prev.transcript,
    model: input.model || prev.model,
    state,
    startedAt: prev.startedAt || spawnedAt,
    updatedAt: spawnedAt,
  }));
}

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    record(JSON.parse(raw));
  } catch (err) {
    // Never disturb Claude Code: log and exit cleanly.
    try { fs.appendFileSync(path.join(DATA_DIR, 'hook-error.log'), `${new Date().toISOString()} ${err.stack}\n`); } catch { /* nowhere left to report */ }
  }
});
```

- [ ] **Step 2: Verify with sample events**

```bash
echo '{"session_id":"test-1","hook_event_name":"PreToolUse","tool_name":"Edit","cwd":"C:/Dev/ClaudeCode Atividade Discord"}' | node hook.js
cat ~/.claude/discord-presence/sessions/test-1.json   # state "✍️ A escrever código"
echo '{"session_id":"test-1","hook_event_name":"SessionEnd"}' | node hook.js
ls ~/.claude/discord-presence/sessions/                # test-1.json gone
```

- [ ] **Step 3: Commit** — `git add hook.js && git commit -m "feat: hook that records session state"`

---

### Task 3: Discord daemon

**Files:**
- Create: `config.json`, `daemon.js`

**Interfaces:**
- Consumes: session files (Task 2); `pickSession`, `buildActivity`, `modelName`, `DATA_DIR`, `SESSIONS_DIR` (Task 1).
- Produces: running process holding pipe `\\?\pipe\claude-discord-presence`; log `~/.claude/discord-presence/daemon.log`.

- [ ] **Step 1: `config.json`**

```json
{ "clientId": "1548485169738940466" }
```

- [ ] **Step 2: `daemon.js`**

```js
// Keeps Discord Rich Presence in sync with Claude Code sessions. Launched hidden at Windows logon.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pickSession, buildActivity, modelName, DATA_DIR, SESSIONS_DIR } = require('./presence');
const { clientId } = require('./config.json');

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
    setTimeout(() => reject(new Error('sem resposta do Discord')), HANDSHAKE_TIMEOUT_MS);
    let buffer = Buffer.alloc(0);
    pipe.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= 8 + buffer.readInt32LE(4)) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        const message = JSON.parse(buffer.subarray(8, 8 + length).toString('utf8'));
        buffer = buffer.subarray(8 + length);
        if (op === OP.FRAME && message.evt === 'READY') resolve();
        if (op === OP.FRAME && message.evt === 'ERROR') log(`erro do Discord: ${message.data?.message}`);
        if (op === OP.PING) pipe.write(frame(OP.PONG, message));
        if (op === OP.CLOSE) {
          log(`Discord fechou a ligação: ${message.message}`);
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
        log('ligação ao Discord terminada');
      }
      reject(new Error('ligação fechada'));
    });
    pipe.write(frame(OP.HANDSHAKE, { v: 1, client_id: clientId }));
  });
}

async function connect() {
  for (let index = 0; index < 10 && !socket; index++) {
    const pipe = await openPipe(index).catch(() => null);
    if (!pipe) continue;
    try {
      await handshake(pipe);
      socket = pipe;
      log(`ligado ao Discord (discord-ipc-${index})`);
    } catch (err) {
      log(`handshake falhou: ${err.message}`);
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
  if (!session) return buildActivity(null, await isClaudeRunning());
  const { repo, branch } = await repoAndBranch(session.cwd);
  return buildActivity({ ...session, repo, branch, model: sessionModel(session) }, true);
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
  try { await tick(); } catch (err) { log(`erro: ${err.stack}`); }
  setTimeout(loop, POLL_MS);
}

// Single instance: a second copy fails to claim the pipe and exits.
net.createServer()
  .once('error', () => process.exit(0))
  .listen('\\\\?\\pipe\\claude-discord-presence', () => {
    log('daemon iniciado');
    loop();
  });
```

- [ ] **Step 3: Verify** — `node test.js` passes; start `node daemon.js`, then `~/.claude/discord-presence/daemon.log`
  shows `daemon iniciado` and `ligado ao Discord`; a second `node daemon.js` exits immediately; Discord profile shows "A jogar Claude".

- [ ] **Step 4: Commit** — `git add config.json daemon.js && git commit -m "feat: daemon that syncs Discord Rich Presence"`

---

### Task 4: Installer and README

**Files:**
- Create: `install.js`, `README.md`
- Modify (at install time): `~/.claude/settings.json` (backup `.bak`), `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Claude Discord Presence.vbs`

**Interfaces:**
- Consumes: `hook.js`, `daemon.js` paths.

- [ ] **Step 1: `install.js`**

```js
// Installs the presence: async Claude Code hooks + hidden daemon autostart at Windows logon. Safe to re-run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const slash = (p) => p.replace(/\\/g, '/');
const hookScript = slash(path.join(__dirname, 'hook.js'));
const command = `"${slash(process.execPath)}" "${hookScript}"`;

const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
const settings = fs.existsSync(settingsFile)
  ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''))
  : {};
const hooks = settings.hooks || {};
const isOurs = (group) => (group.hooks || []).some((hook) => (hook.command || '').includes(hookScript));
const updatedHooks = { ...hooks };
for (const event of EVENTS) {
  updatedHooks[event] = [
    ...(hooks[event] || []).filter((group) => !isOurs(group)),
    { hooks: [{ type: 'command', command, async: true }] },
  ];
}
if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, `${settingsFile}.bak`);
fs.writeFileSync(settingsFile, `${JSON.stringify({ ...settings, hooks: updatedHooks }, null, 2)}\n`);
console.log(`hooks adicionados a ${settingsFile} (cópia em settings.json.bak)`);

const launcher = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Claude Discord Presence.vbs');
const daemon = path.join(__dirname, 'daemon.js');
fs.writeFileSync(launcher, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${daemon}""", 0, False\r\n`);
console.log(`arranque automático: ${launcher}`);

spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore' }).unref();
console.log('daemon iniciado');
```

- [ ] **Step 2: `README.md`** — what it is, Discord app setup (asset `claude`), `node install.js`, uninstall steps, logs.

- [ ] **Step 3: Run `node install.js`** — settings.json has 7 hook events with our command and `async: true`;
  Startup `.vbs` exists; `daemon.log` shows `ligado ao Discord`.

- [ ] **Step 4: Commit** — `git add install.js README.md && git commit -m "feat: installer and README"`
