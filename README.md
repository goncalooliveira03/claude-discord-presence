# Claude Discord Presence

Mostra no Discord, em vez de um jogo, o que o Claude está a fazer:

```
A jogar Claude
📁 nome-do-repo · 🌿 main
✍️ A escrever código · Opus 5
⏱ 00:42 decorrido
```

Sem sessão de código ativa mas com a app Claude aberta, mostra só "A jogar Claude".

## Como funciona

- `hook.js`: os hooks do Claude Code (assíncronos, não atrasam nada) gravam o estado de cada sessão em `~/.claude/discord-presence/sessions/`.
- `daemon.js`: arranca escondido com o Windows e, de 5 em 5 s, lê as sessões, descobre o repositório e a branch (git) e o modelo (transcript), e envia a atividade ao Discord pelo IPC local.
- `presence.js`: lógica pura (estados, nomes de modelos, atividade), testada em `test.js`.

## Instalação

1. Em [discord.com/developers](https://discord.com/developers/applications) cria uma aplicação chamada **Claude**, copia o Application ID para `config.json` e, em *Rich Presence → Art Assets*, carrega o logo com o nome `claude`.
2. No Discord: *Definições → Privacidade de atividade → Partilhar a minha atividade* ligado.
3. `node install.js`: adiciona os hooks a `~/.claude/settings.json` (guarda cópia em `.bak`), cria o arranque automático e inicia o daemon.

Sessões do Claude Code que já estavam abertas só começam a enviar eventos depois de reiniciadas.

## Testes

```bash
node test.js
```

## Logs

- `~/.claude/discord-presence/daemon.log`: ligação ao Discord e erros.
- `~/.claude/discord-presence/hook-error.log`: erros dos hooks.

## Desinstalar

1. Apaga `Claude Discord Presence.vbs` em `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
2. Remove de `~/.claude/settings.json` as entradas de hooks cujo comando aponta para `hook.js`.
3. Termina o processo `node` que corre `daemon.js` (ou reinicia o PC).
