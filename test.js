// Self-check for presence.js. Run: node test.js
const assert = require('assert');
const { EVENTS, LABELS, DATA_DIR, LOCK_PIPE, stateFor, modelName, pickSession, buildActivity } = require('./presence');

assert.strictEqual(modelName('claude-opus-5'), 'Opus 5');
assert.strictEqual(modelName('claude-fable-5-1'), 'Fable 5.1');
assert.strictEqual(modelName('claude-sonnet-5'), 'Sonnet 5');
assert.strictEqual(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
assert.strictEqual(modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
assert.strictEqual(modelName('claude-opus-5[1m]'), 'Opus 5');
assert.strictEqual(modelName('<synthetic>'), null);
assert.strictEqual(modelName(undefined), null);

assert.strictEqual(stateFor('UserPromptSubmit'), 'thinking');
assert.strictEqual(stateFor('PostToolUse', 'Read'), 'thinking');
assert.strictEqual(stateFor('PreToolUse', 'Edit'), 'writing');
assert.strictEqual(stateFor('PreToolUse', 'Grep'), 'reading');
assert.strictEqual(stateFor('PreToolUse', 'PowerShell'), 'running');
assert.strictEqual(stateFor('PreToolUse', 'WebFetch'), 'searching');
assert.strictEqual(stateFor('PreToolUse', 'Agent'), 'delegating');
assert.strictEqual(stateFor('PreToolUse', 'mcp__github__search'), 'tools');
assert.strictEqual(stateFor('Notification', undefined, 'permission_prompt'), 'approval');
assert.strictEqual(stateFor('Notification', undefined, 'idle_prompt'), 'waiting');
assert.strictEqual(stateFor('Notification', undefined, 'auth_success'), null);
assert.strictEqual(stateFor('SessionStart'), 'waiting');
assert.strictEqual(stateFor('Stop'), 'waiting');
assert.strictEqual(stateFor('SessionEnd'), null);

assert.deepStrictEqual(Object.keys(LABELS.pt).sort(), Object.keys(LABELS.en).sort());

const now = 100_000_000;
const recent = { updatedAt: now - 1000 };
const older = { updatedAt: now - 5000 };
const stale = { updatedAt: now - 31 * 60 * 1000 };
assert.strictEqual(pickSession([older, stale, recent], now), recent);
assert.strictEqual(pickSession([stale], now), null);
assert.strictEqual(pickSession([], now), null);

const session = { repo: 'site', branch: 'main', state: 'thinking', model: 'Opus 5', startedAt: 123 };
assert.deepStrictEqual(buildActivity(session, true, { image: 'logo', language: 'en' }), {
  name: 'Claude Code',
  details: '📁 site · 🌿 main',
  state: '🤔 Thinking · Opus 5',
  timestamps: { start: 123 },
  assets: { large_image: 'logo', large_text: 'Claude Code' },
});
assert.strictEqual(buildActivity(session, true, { image: 'logo', language: 'pt' }).state, '🤔 A pensar · Opus 5');
assert.strictEqual(buildActivity(session, true, { image: 'logo', language: 'xx' }).state, '🤔 Thinking · Opus 5');
// Session files written by older versions hold the label itself.
assert.strictEqual(buildActivity({ ...session, state: '⚙️ A correr comandos' }, true, { image: 'logo' }).state, '⚙️ A correr comandos · Opus 5');

const noGit = buildActivity({ ...session, branch: null, state: 'waiting', model: null }, false, { image: 'logo', language: 'en' });
assert.strictEqual(noGit.details, '📁 site');
assert.strictEqual(noGit.state, '💬 Waiting for input');
assert.strictEqual(buildActivity({ ...session, repo: 'x'.repeat(300) }, false, { image: 'logo' }).details.length, 128);

assert.deepStrictEqual(buildActivity(null, true, { image: 'logo' }), { name: 'Claude', assets: { large_image: 'logo', large_text: 'Claude' } });
assert.strictEqual(buildActivity(null, false, { image: 'logo' }), null);

// The plugin (hooks/hooks.json) and install.js must register the same async hook on the same events.
const pluginHooks = require('./hooks/hooks.json').hooks;
assert.deepStrictEqual(Object.keys(pluginHooks).sort(), [...EVENTS].sort());
for (const event of EVENTS) {
  assert.deepStrictEqual(pluginHooks[event], [
    { hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hook.js'], async: true }] },
  ]);
}

// Rename: new data folder and lock pipe names.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { stopDaemon, migrateLegacyConfig } = require('./lifecycle');

assert.strictEqual(path.basename(DATA_DIR), 'presence-for-claude');
assert.ok(LOCK_PIPE.endsWith('presence-for-claude'));

// migrateLegacyConfig copies config.json once and never overwrites.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-test-'));
const legacyDir = path.join(tmp, 'discord-presence');
const newDir = path.join(tmp, 'presence-for-claude');
assert.strictEqual(migrateLegacyConfig(legacyDir, newDir), false);
fs.mkdirSync(legacyDir);
fs.writeFileSync(path.join(legacyDir, 'config.json'), '{"language":"pt"}');
assert.strictEqual(migrateLegacyConfig(legacyDir, newDir), true);
assert.strictEqual(fs.readFileSync(path.join(newDir, 'config.json'), 'utf8'), '{"language":"pt"}');
fs.writeFileSync(path.join(legacyDir, 'config.json'), '{"language":"en"}');
assert.strictEqual(migrateLegacyConfig(legacyDir, newDir), false);
assert.strictEqual(fs.readFileSync(path.join(newDir, 'config.json'), 'utf8'), '{"language":"pt"}');
fs.rmSync(tmp, { recursive: true, force: true });

// stopDaemon resolves when nothing listens, and connects to a listening daemon.
async function checkStopDaemon() {
  const pipePath = process.platform === 'win32'
    ? `\\\\?\\pipe\\pfc-test-${process.pid}`
    : path.join(os.tmpdir(), `pfc-test-${process.pid}.sock`);
  await stopDaemon(pipePath);
  let connected = false;
  const server = net.createServer((conn) => {
    connected = true;
    conn.destroy();
    server.close();
  });
  await new Promise((resolve) => server.listen(pipePath, resolve));
  await stopDaemon(pipePath);
  assert.strictEqual(connected, true);
}

checkStopDaemon().then(
  () => console.log('ok'),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
