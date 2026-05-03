# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.5: AI-ready architecture**.

- Structured state, perception, commands, actions, and safety layers are implemented.
- AI bridge is a stub-ready integration point.
- No Ollama or EMBER web app wiring yet unless you explicitly enable bridge endpoint testing.
- No mining, combat, building, inventory, or container automation.

## v0.5 Purpose

v0.5 organizes EMBER's Minecraft body so future AI/memory systems can plug in through a safe, action-driven interface:

- modular runtime (`src/bot/*`)
- central bot state snapshots
- perception summaries + obstacle reporting
- command router
- action queue + execution pipeline
- safety policy checks
- in-memory event log (last 100 events)
- optional AI observation bridge (`ENABLE_AI_BRIDGE`)

## Current Behavior

- Microsoft-auth Mineflayer login with token/session cache in `./data`
- connect/spawn/death/respawn/kick/disconnect/error logging
- chat warmup and safe chat send wrapper
- one-time `EMBER is online.` announce per process start (configurable)
- owner-gated movement/respawn/debug command actions
- conservative pathfinder behavior with timeout + stuck-stop handling
- stuck obstacle snapshot capture

## Project Layout

```text
src/
  index.ts
  config.ts
  bot/
    createBot.ts
    lifecycle.ts
    chat.ts
    commands.ts
    safety.ts
    state.ts
    perception.ts
    movement.ts
    actions.ts
    aiBridge.ts
    logging.ts
    types.ts
```

## Requirements

- Node.js 22+
- Bot Microsoft account added to server whitelist
- Minecraft Java/Paper server reachable from bot runtime

## Environment

Copy `.env.example` to `.env` and fill values.

```env
MINECRAFT_HOST=10.0.0.218
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=
MINECRAFT_AUTH=microsoft
MINECRAFT_VERSION=
ANNOUNCE_ON_SPAWN=true

OWNER_USERNAME=BIRevty
ENABLE_AI_BRIDGE=false
AI_BRIDGE_URL=http://127.0.0.1:3004/api/minecraft
OBSERVATION_INTERVAL_MS=5000
STATE_LOG_INTERVAL_MS=10000
MAX_CHAT_LENGTH=220
MAX_ACTIONS_PER_MINUTE=20
ALLOW_MINING=false
ALLOW_COMBAT=false
ALLOW_BUILDING=false
ALLOW_INVENTORY=false

MAX_COME_DISTANCE=40
MAX_FOLLOW_START_DISTANCE=40
COME_GOAL_RADIUS=3
FOLLOW_DISTANCE=3
PATHFINDER_TIMEOUT_MS=15000
STUCK_RESET_LIMIT=3
```

### Test Server Example

```env
MINECRAFT_HOST=10.0.0.218
MINECRAFT_PORT=25566
MINECRAFT_USERNAME=EmberR2025
MINECRAFT_AUTH=microsoft
MINECRAFT_VERSION=1.21.11
ANNOUNCE_ON_SPAWN=true

OWNER_USERNAME=BIRevty
ENABLE_AI_BRIDGE=false
AI_BRIDGE_URL=http://127.0.0.1:3004/api/minecraft
OBSERVATION_INTERVAL_MS=5000
STATE_LOG_INTERVAL_MS=10000
MAX_CHAT_LENGTH=220
MAX_ACTIONS_PER_MINUTE=20
ALLOW_MINING=false
ALLOW_COMBAT=false
ALLOW_BUILDING=false
ALLOW_INVENTORY=false

MAX_COME_DISTANCE=40
MAX_FOLLOW_START_DISTANCE=40
COME_GOAL_RADIUS=3
FOLLOW_DISTANCE=3
PATHFINDER_TIMEOUT_MS=15000
STUCK_RESET_LIMIT=3
```

## Commands (v0.5)

Public safe commands:

- `Ember hello`
- `Ember help`
- `Ember status`
- `Ember where are you`
- `Ember nearby`
- `Ember look`

Owner-only commands (`OWNER_USERNAME`):

- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember respawn`
- `Ember distance`
- `Ember obstacle`
- `Ember state`
- `Ember debug`
- `Ember ai status`
- `Ember action queue`

## Safety Rules

- Non-owner chat never controls movement/debug actions.
- Action execution is rate-limited (`MAX_ACTIONS_PER_MINUTE`).
- Chat sends are rate-limited and guarded by spawn/ready state.
- `ALLOW_MINING=false`: no mining/dig automation.
- `ALLOW_COMBAT=false`: no attack/combat automation.
- `ALLOW_BUILDING=false`: no block placement automation.
- `ALLOW_INVENTORY=false`: no inventory/chest/container automation.
- No eval/arbitrary code execution from chat.

## AI Bridge Stub Behavior

- If `ENABLE_AI_BRIDGE=false`: bridge logs disabled and skips network calls.
- If `ENABLE_AI_BRIDGE=true`: bot POSTs structured observation payloads to `AI_BRIDGE_URL`.
- Response may include optional `say` and `actions` fields.
- All AI-requested actions are still safety-validated before queueing/running.
- Bridge failures are logged and stored as `lastAiBridgeError`; bot keeps running.

## Microsoft Login and Session Cache

First run may require device-code auth. Watch logs for the code and verification URL.

Auth/session files are persisted in `./data` (mounted to `/app/data` in Docker) so restarts reuse tokens.

## Local Dev

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Build and start:

```bash
npm run build
npm run start
```

## Docker

```bash
docker compose up -d --build
docker compose logs -f ember-minecraft-bot
docker compose down
```

Compose mounts data persistence and restarts unless stopped:

- `./data:/app/data`
- `restart: unless-stopped`

## Home Server Deploy

```bash
cd /apps/ember-minecraft-bot
git pull
docker compose down
docker compose up -d --build
docker logs ember-minecraft-bot --tail 160
```

## v0.5 Test Checklist

- `Ember hello`
- `Ember help`
- `Ember status`
- `Ember where are you`
- `Ember nearby`
- `Ember look`
- `Ember obstacle`
- `Ember distance`
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember respawn`
- `Ember state`
- `Ember debug`
- `Ember ai status`
- `Ember action queue`
