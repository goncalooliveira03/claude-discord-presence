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

// `name` overrides the Discord application name shown under "A jogar"; `image` is the Rich Presence asset key.
function buildActivity(session, appOpen, image) {
  if (!session) return appOpen ? { name: 'Claude', assets: { large_image: image, large_text: 'Claude' } } : null;
  return {
    name: 'Claude Code',
    details: clip(session.branch ? `📁 ${session.repo} · 🌿 ${session.branch}` : `📁 ${session.repo}`),
    state: clip(session.model ? `${session.state} · ${session.model}` : session.state),
    timestamps: { start: session.startedAt },
    assets: { large_image: image, large_text: 'Claude Code' },
  };
}

module.exports = { DATA_DIR, SESSIONS_DIR, stateFor, modelName, pickSession, buildActivity };
