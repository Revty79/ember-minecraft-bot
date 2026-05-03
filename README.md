# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.6.1: stability polish**.

- Fixes `entity.mobType` deprecation log spam.
- Adds invalid-live-position recovery path.
- Improves not-ready chat throttling and chat-validation safety behavior.
- Persists home location to `./data/home.json`.
- Reduces repeated state log noise.

## v0.6.1 Stability Fixes

- Hostile detection no longer touches deprecated `entity.mobType`; uses `displayName/name/type` fallback chain.
- Invalid alive position handling:
  - detects non-finite bot position while alive
  - stops movement and clears queue
  - attempts short soft recovery
  - cleanly quits so Docker can restart if still invalid
- `Ember recover` now handles dead, invalid-position, and safe-reset recovery flows.
- Not-ready chat cooldown added to reduce repeated messages.
- Home now persists across respawn/restart in `HOME_FILE_PATH`.
- State summary logging can be change-only with periodic heartbeat.

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
STATE_LOG_ONLY_ON_CHANGE=true
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

DANGER_SCAN_INTERVAL_MS=3000
HOSTILE_DANGER_RADIUS=10
HOSTILE_STOP_RADIUS=4
STOP_ON_DANGER=true

MIN_GOAL_REFRESH_DISTANCE=2
FOLLOW_REPATH_INTERVAL_MS=1500
MOVEMENT_PROGRESS_CHECK_MS=2000
MIN_PROGRESS_DISTANCE=0.5

NOT_READY_CHAT_COOLDOWN_MS=10000
INVALID_POSITION_RECOVERY_MS=5000
HOME_FILE_PATH=./data/home.json
```

## Commands

Public-safe:

- `Ember hello`
- `Ember help`
- `Ember capabilities`
- `Ember vitals`
- `Ember danger`
- `Ember status`
- `Ember where are you`
- `Ember nearby`
- `Ember look`
- `Ember movement`

Owner-only:

- `Ember set home`
- `Ember home`
- `Ember home status`
- `Ember clear home`
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember recover`
- `Ember respawn`
- `Ember obstacle`
- `Ember distance`
- `Ember safety test`
- `Ember state`
- `Ember debug`
- `Ember ai status`
- `Ember action queue`

## Recover Behavior

`Ember recover`:

- stops movement
- clears queued actions
- if dead: requests respawn
- if alive + invalid position: says `Recovering my position.` once, then quits cleanly for Docker restart
- if alive + valid position: reports ready/position/vitals summary

## Home Persistence

Home is persisted to `HOME_FILE_PATH` (default `./data/home.json`) with:

- `x`
- `y`
- `z`
- `dimension`
- `world`
- `timestamp`
- `setBy`

No database is used.

## Safety and Locked Capabilities

Defaults remain locked:

- `ALLOW_MINING=false`
- `ALLOW_COMBAT=false`
- `ALLOW_BUILDING=false`
- `ALLOW_INVENTORY=false`

Scaffolded actions are safety-checked and blocked unless corresponding flags are enabled.

## Known Limitation

Movement is still terrain-limited because mining/building are disabled. Bot may stop with:

- `I'm blocked and stopped moving.`

when pathing cannot proceed safely.

## Docker

```bash
docker compose up -d --build
docker logs ember-minecraft-bot --tail 180
docker compose down
```

Compose defaults:

- `./data:/app/data`
- `restart: unless-stopped`

## Deploy

```bash
cd /apps/ember-minecraft-bot
git pull
docker compose down
docker compose up -d --build
docker logs ember-minecraft-bot --tail 180
```
