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
