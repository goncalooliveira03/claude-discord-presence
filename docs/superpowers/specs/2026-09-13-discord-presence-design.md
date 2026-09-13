# Claude Discord Presence — Design

Data: 2026-09-13 · Estado: aprovado

## Objetivo

Mostrar no Discord (Rich Presence, "A jogar Claude") o que o Claude está a fazer:
repositório + branch, estado atual e modelo. Sem mods ao cliente Discord.

## O que aparece

```
A jogar Claude
📁 <repo ou pasta> · 🌿 <branch>        (details)
<emoji> <estado> · <modelo>             (state)
⏱ decorrido desde o início da sessão    (timestamps.start)
```

- Sessão de código ativa → layout completo acima.
- Sem sessão ativa, mas `claude.exe` a correr (app Claude, mesmo na bandeja) → só "A jogar Claude".
- Nada disto → atividade limpa.
- Várias sessões → mostra a com evento mais recente.
- Sessão sem eventos há mais de 30 min → ignorada (conta como inativa).
- Pasta fora de git → nome da pasta, sem branch.

## Estados

| Evento (hook) | Estado |
|---|---|
| UserPromptSubmit, PostToolUse | 🤔 A pensar |
| PreToolUse Edit/Write/MultiEdit/NotebookEdit | ✍️ A escrever código |
| PreToolUse Read/Grep/Glob | 📖 A ler código |
| PreToolUse Bash/PowerShell | ⚙️ A correr comandos |
| PreToolUse WebSearch/WebFetch | 🌐 A pesquisar |
| PreToolUse Agent/Task/Workflow | 🤖 A coordenar agentes |
| PreToolUse outra | 🛠️ A usar ferramentas |
| Notification (pedido de permissão) | ✋ À espera de aprovação |
| SessionStart, Stop, Notification (idle) | 💬 À espera de ti |
| SessionEnd | sessão removida |

Modelo: último `"model":"claude-…"` no transcript (ou `model` do input do hook, se existir).
Nome: `claude-opus-5` → Opus 5, `claude-fable-5-1` → Fable 5.1,
`claude-haiku-4-5-20251001` → Haiku 4.5, `claude-3-5-sonnet-20241022` → Sonnet 3.5.

## Componentes

- `hook.js` — lê o JSON do stdin, grava `~/.claude/discord-presence/sessions/<session_id>.json`
  (`cwd`, `event`, `tool`, `transcript`, `model`, `startedAt`, `updatedAt`); SessionEnd apaga.
  Nunca falha: qualquer erro → exit 0 sem output. Corre com `"async": true` (não atrasa o Claude);
  como hooks async podem terminar fora de ordem, só escreve se o seu `Date.now()` de arranque
  for ≥ `updatedAt` já gravado. Notification: `permission_prompt` → aprovação, `idle_prompt` →
  à espera de ti, outros tipos → ignorados.
- `presence.js` — funções puras: evento → estado, id → nome do modelo, sessões → atividade.
- `daemon.js` — instância única (named pipe de lock). A cada 5 s: lê sessões, deriva repo/branch
  (`git`) e modelo (fim do transcript), monta a atividade, envia via IPC
  (`\\?\pipe\discord-ipc-N`) só se mudou, no máximo 1 envio / 4 s. Reconecta se o Discord fechar.
- `config.json` — `clientId` da aplicação Discord "Claude" (asset `claude`).
- `test.js` — `assert` sobre `presence.js`.
- Instalação — hooks em `~/.claude/settings.json`; `.vbs` na pasta Arranque do Windows
  que lança `node daemon.js` sem janela.

## Limitações aceites

- Hooks não distinguem "a pensar" de "a escrever texto da resposta".
- O Discord pode demorar alguns segundos a refletir mudanças.
