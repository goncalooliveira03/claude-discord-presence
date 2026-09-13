// Installs the presence: async Claude Code hooks + hidden daemon autostart at Windows logon. Safe to re-run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const hookScript = path.join(__dirname, 'hook.js');

const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
const settings = fs.existsSync(settingsFile)
  ? JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, ''))
  : {};
const hooks = settings.hooks || {};
const isOurs = (group) => (group.hooks || []).some((hook) => (hook.args || []).includes(hookScript));
const updatedHooks = { ...hooks };
for (const event of EVENTS) {
  updatedHooks[event] = [
    ...(hooks[event] || []).filter((group) => !isOurs(group)),
    // Exec form (command + args): no shell, so the space in the folder name needs no quoting.
    { hooks: [{ type: 'command', command: process.execPath, args: [hookScript], async: true }] },
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
