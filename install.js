// Installs the presence (async Claude Code hooks + hidden daemon started at Windows logon), or removes it.
//   node install.js              install, or update after `git pull`
//   node install.js --uninstall  remove everything
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR, LOCK_PIPE } = require('./presence');

const MIN_NODE_MAJOR = 20;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const uninstall = process.argv.includes('--uninstall');
const hookScript = path.join(__dirname, 'hook.js');
const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
const launcher = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Claude Discord Presence.vbs');

function checkEnvironment() {
  if (process.platform !== 'win32') throw new Error('Windows only for now.');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) throw new Error(`Node.js ${MIN_NODE_MAJOR} or newer is required (you have ${process.versions.node}).`);
}

function updateHooks() {
  const settings = fs.existsSync(settingsFile)
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  const { hooks: currentHooks = {}, ...rest } = settings;
  const isOurs = (group) => (group.hooks || []).some((hook) => (hook.args || []).includes(hookScript));
  // Exec form (command + args): no shell, so paths with spaces need no quoting.
  const ours = uninstall ? [] : [{ hooks: [{ type: 'command', command: process.execPath, args: [hookScript], async: true }] }];

  const hooks = Object.fromEntries(
    [...new Set([...Object.keys(currentHooks), ...EVENTS])]
      .map((event) => {
        const kept = (currentHooks[event] || []).filter((group) => !isOurs(group));
        return [event, EVENTS.includes(event) ? [...kept, ...ours] : kept];
      })
      .filter(([, groups]) => groups.length > 0),
  );

  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, `${settingsFile}.bak`);
  const next = Object.keys(hooks).length ? { ...rest, hooks } : rest;
  fs.writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
}

// The daemon exits as soon as something connects to its lock pipe.
function stopDaemon() {
  return new Promise((resolve) => {
    const pipe = net.connect(LOCK_PIPE);
    pipe.on('error', () => { /* not running; 'close' follows */ });
    pipe.on('close', resolve);
  });
}

async function main() {
  checkEnvironment();
  updateHooks();
  await stopDaemon();

  if (uninstall) {
    fs.rmSync(launcher, { force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('Uninstalled. Restart any open Claude Code sessions.');
    return;
  }

  const daemon = path.join(__dirname, 'daemon.js');
  fs.writeFileSync(launcher, `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${daemon}""", 0, False\r\n`);
  spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore' }).unref();
  console.log('Installed. Restart any open Claude Code sessions, then check your Discord profile.');
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
