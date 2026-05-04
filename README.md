# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.7: survival foundation + inventory awareness scaffolding**.

- AI bridge remains optional/stubbed and is disabled by default.
- Mining/combat/building/container usage remain locked by default.
- Adds inventory read summaries, food/hunger awareness, flee scaffolding, stay-home mode, and block/ore perception commands.

## v0.7 Highlights

- New read-only inventory summary command.
- Food detection helper with known-food names plus registry-based food metadata fallback.
- `EAT_FOOD` action scaffold is safety-gated by `ALLOW_EATING`.
- Hunger/vitals now include hunger status (`full/okay/hungry/starving`).
- Danger summary now includes proximity levels: `none/far/medium/close/critical`.
- Optional flee behavior and manual `Ember flee` command.
- Home/stay-home polish with persisted home at `HOME_FILE_PATH`.
- New block/ore perception command surfaces for future mining planning (scan-only, no mining).

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
ALLOW_EATING=false
ALLOW_FLEE=true

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
FLEE_DISTANCE=12
FLEE_HOME_RADIUS=6
FLEE_TO_HOME=true
FLEE_TO_OWNER=true

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
- `Ember status`
- `Ember where are you`
- `Ember nearby`
- `Ember look`
- `Ember vitals`
- `Ember hunger`
- `Ember danger`
- `Ember threat`
- `Ember movement`

Owner-only:

- `Ember inventory`
- `Ember food`
- `Ember eat`
- `Ember flee`
- `Ember block`
- `Ember ores nearby`
- `Ember obstacle`
- `Ember distance`
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember set home`
- `Ember home`
- `Ember stay home`
- `Ember home status`
- `Ember clear home`
- `Ember respawn`
- `Ember recover`
- `Ember safety test`
- `Ember state`
- `Ember debug`
- `Ember ai status`
- `Ember action queue`

## Safety Rules

Defaults remain locked:

- `ALLOW_MINING=false`
- `ALLOW_COMBAT=false`
- `ALLOW_BUILDING=false`
- `ALLOW_INVENTORY=false`
- `ALLOW_EATING=false`

Notes:

- Inventory read commands are safe and do not open chests/containers.
- `EAT_FOOD` is blocked unless `ALLOW_EATING=true`.
- Non-owner users cannot control movement/flee/recover/eat.
- No arbitrary code execution or chat eval is implemented.

## Home Persistence

Home is persisted to `HOME_FILE_PATH` (default `./data/home.json`) with:

- `x`
- `y`
- `z`
- `dimension`
- `world`
- `timestamp`
- `setBy`

## Recover Behavior

`Ember recover`:

- stops movement
- clears queued actions
- if dead: requests respawn
- if alive + invalid position: says `Recovering my position.` once, then quits for Docker restart
- if alive + valid position: reports ready/position/vitals

## AI Bridge Stub

- If `ENABLE_AI_BRIDGE=false`, bridge calls are skipped and logged periodically.
- If `ENABLE_AI_BRIDGE=true`, observations are POSTed to `AI_BRIDGE_URL`.
- AI-requested actions are still safety-validated before queueing.

## Known Limitation

Movement remains terrain-limited while mining/building are disabled. EMBER may stop with:

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
