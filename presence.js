// Pure logic: hook events → state keys, model ids → names, sessions → Discord activity.
const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.homedir(), '.claude', 'discord-presence');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const LOCK_PIPE = '\\\\?\\pipe\\claude-discord-presence';
const STALE_MS = 30 * 60 * 1000;
const MAX_FIELD = 128; // Discord limit for details/state

const LABELS = {
  en: {
    thinking: '🤔 Thinking',
    writing: '✍️ Writing code',
    reading: '📖 Reading code',
    running: '⚙️ Running commands',
    searching: '🌐 Searching the web',
    delegating: '🤖 Running agents',
    tools: '🛠️ Using tools',
    approval: '✋ Waiting for approval',
    waiting: '💬 Waiting for input',
  },
  pt: {
    thinking: '🤔 A pensar',
    writing: '✍️ A escrever código',
    reading: '📖 A ler código',
    running: '⚙️ A correr comandos',
    searching: '🌐 A pesquisar',
    delegating: '🤖 A coordenar agentes',
    tools: '🛠️ A usar ferramentas',
    approval: '✋ À espera de aprovação',
    waiting: '💬 À espera de ti',
  },
};

const TOOL_STATES = [
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'writing'],
  [/^(Read|Grep|Glob)$/, 'reading'],
  [/^(Bash|PowerShell)$/, 'running'],
  [/^(WebSearch|WebFetch)$/, 'searching'],
  [/^(Agent|Task|Workflow)$/, 'delegating'],
];

// State key for a hook event, or null when the event must not change the state.
function stateFor(event, tool, notificationType) {
  switch (event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'thinking';
    case 'PreToolUse': {
      const match = TOOL_STATES.find(([pattern]) => pattern.test(tool || ''));
      return match ? match[1] : 'tools';
    }
    case 'Notification':
      if (notificationType === 'permission_prompt') return 'approval';
      return notificationType === 'idle_prompt' ? 'waiting' : null;
    case 'SessionStart':
    case 'Stop':
      return 'waiting';
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

// `name` overrides the Discord application name shown under "Playing"; `image` is the Rich Presence asset key.
function buildActivity(session, appOpen, { image, language } = {}) {
  if (!session) return appOpen ? { name: 'Claude', assets: { large_image: image, large_text: 'Claude' } } : null;
  const label = (LABELS[language] || LABELS.en)[session.state] || session.state;
  return {
    name: 'Claude Code',
    details: clip(session.branch ? `📁 ${session.repo} · 🌿 ${session.branch}` : `📁 ${session.repo}`),
    state: clip(session.model ? `${label} · ${session.model}` : label),
    timestamps: { start: session.startedAt },
    assets: { large_image: image, large_text: 'Claude Code' },
  };
}

module.exports = { DATA_DIR, SESSIONS_DIR, LOCK_PIPE, LABELS, stateFor, modelName, pickSession, buildActivity };
