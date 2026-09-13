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
  buildActivity({ repo: 'site', branch: 'main', state: '🤔 A pensar', model: 'Opus 5', startedAt: 123 }, true, 'logo'),
  {
    name: 'Claude Code',
    details: '📁 site · 🌿 main',
    state: '🤔 A pensar · Opus 5',
    timestamps: { start: 123 },
    assets: { large_image: 'logo', large_text: 'Claude Code' },
  },
);
const noGit = buildActivity({ repo: 'notas', branch: null, state: '💬 À espera de ti', model: null, startedAt: 1 }, false, 'logo');
assert.strictEqual(noGit.details, '📁 notas');
assert.strictEqual(noGit.state, '💬 À espera de ti');
assert.strictEqual(buildActivity({ repo: 'x'.repeat(300), branch: null, state: 's', model: null, startedAt: 1 }, false, 'logo').details.length, 128);
assert.deepStrictEqual(buildActivity(null, true, 'logo'), { name: 'Claude', assets: { large_image: 'logo', large_text: 'Claude' } });
assert.strictEqual(buildActivity(null, false, 'logo'), null);

console.log('ok');
