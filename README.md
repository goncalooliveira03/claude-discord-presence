![Presence for Claude](assets/banner.png)

[![test](https://github.com/goncalooliveira03/presence-for-claude/actions/workflows/test.yml/badge.svg)](https://github.com/goncalooliveira03/presence-for-claude/actions/workflows/test.yml)
![Windows](https://img.shields.io/badge/platform-Windows-0078D4)
![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Your Discord status shows what Claude Code is doing: the repo and branch you're in, what Claude is working on, and the model.

```
Playing Claude Code
📁 my-app · 🌿 main
✍️ Writing code · Opus 5
⏱ 12:04 elapsed
```

With the Claude desktop app open and no coding session running, your status reads "Playing Claude". Close the app and the activity disappears.

## Requirements

- Windows 10 or 11
- [Discord](https://discord.com/download) desktop app
- [Node.js](https://nodejs.org) 20 or newer
- [Git](https://git-scm.com)
- Claude Code (terminal, desktop app or IDE extension)

## Install

Discord only shows activities when **Share my activity** is on (User Settings → Activity Privacy). Pick one of the two methods below, not both.

### As a Claude Code plugin

Run these two commands inside Claude Code:

```
/plugin marketplace add goncalooliveira03/presence-for-claude
/plugin install presence-for-claude@presence-for-claude
```

Restart Claude Code. The background process starts with your first session and keeps running after it ends.

Installed it before the project was renamed from `claude-discord-presence`? Remove that plugin from the `/plugin` menu, then run the two commands above. Your settings are copied over.

### From source

This method also starts the presence when you sign in to Windows, before you open Claude Code. Open a terminal and run:

```bash
git clone https://github.com/goncalooliveira03/presence-for-claude.git
cd presence-for-claude
node install.js
```

Then restart the Claude Code sessions you have open. Keep the folder where you cloned it, because the hooks point to it. If you move it, run `node install.js` again from the new place.

## What your status shows

| When Claude is | Status |
|---|---|
| working on your prompt | 🤔 Thinking |
| editing files | ✍️ Writing code |
| reading or searching files | 📖 Reading code |
| running shell commands | ⚙️ Running commands |
| searching or fetching web pages | 🌐 Searching the web |
| running subagents | 🤖 Running agents |
| using another tool, such as an MCP server | 🛠️ Using tools |
| asking for permission | ✋ Waiting for approval |
| done and waiting for you | 💬 Waiting for input |

If you have several sessions open, Discord shows the one that did something most recently. A session that sits idle for 30 minutes drops out.

Anyone who can see your Discord profile can see your repo and branch names.

## Settings

Put your settings in `~/.claude/presence-for-claude/config.json`. The file works with both install methods, survives updates, and changes apply within a few seconds.

```json
{ "language": "pt" }
```

![Discord activity card with the status in Portuguese](assets/activity.png)

*Real screenshot with `language` set to `pt`.*

| Key | Default | Meaning |
|---|---|---|
| `language` | `en` | Status language: `en` or `pt` |
| `clientId` | this project's Discord app | ID of your own Discord application, if you want one |
| `largeImage` | `claude_icon_512` | Rich Presence art asset of that application |

With the install from source, `config.local.json` in the project folder works too, and `git pull` leaves it alone.

## Update

Plugin: update it from the `/plugin` menu in Claude Code.

From source:

```bash
git pull
node install.js
```

## Uninstall

Plugin: remove it from the `/plugin` menu in Claude Code. The background process stops when you sign out of Windows.

From source:

```bash
node install.js --uninstall
```

This removes the hooks from `~/.claude/settings.json` (the previous file is kept as `settings.json.bak`), the startup entry and the local state. Delete the folder afterwards.

## How it works

```mermaid
flowchart LR
  CC[Claude Code] -- hook events --> H[hook.js]
  H -- session state --> S[(~/.claude/presence-for-claude)]
  S --> D[daemon.js]
  G[git + transcript] --> D
  D -- local named pipe --> DC[Discord]
```

- `hooks/hooks.json` (plugin) or `install.js` (from source) registers `hook.js` for seven Claude Code hook events. The hooks run in the background, so Claude doesn't wait for them.
- `hook.js` writes a small JSON file per session with its current state, and starts `daemon.js` when a session begins if it isn't running yet.
- `daemon.js` runs without a window. The install from source also starts it when you sign in to Windows. Every 5 seconds it picks the most recent session, reads the repo and branch from git and the model from the session transcript, and sends the activity to Discord through Discord's local IPC pipe.
- `presence.js` turns that data into the text you see. `node test.js` checks it.

The project has no npm dependencies and makes no network requests of its own.

## Troubleshooting

**Nothing shows up on Discord.** Check that Share my activity is on, and that you restarted Claude Code after installing.

**Still nothing.** Open `%USERPROFILE%\.claude\presence-for-claude\daemon.log`. You should see `connected to Discord`. Hook errors go to `hook-error.log` in the same folder.

**Old or missing icon.** Discord caches images. Wait a few minutes or press Ctrl+R in Discord.

## Disclaimer

This is a personal project, not affiliated with or endorsed by Anthropic or Discord. Claude is a trademark of Anthropic.

## License

[MIT](LICENSE)
