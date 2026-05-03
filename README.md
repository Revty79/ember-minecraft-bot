# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.6: survival + movement polish + locked capability scaffolding**.

- AI bridge remains optional and disabled by default.
- Mining/combat/building/inventory remain disabled by default.
- New survival/danger/vitals reporting and movement recovery tooling are included.

## v0.6 Goals

- Better survival awareness without enabling combat.
- Better movement robustness when terrain blocks progress.
- Structured state/perception/action architecture preserved from v0.5.
- Locked capability scaffolding for future expansion behind safety gates.

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

DANGER_SCAN_INTERVAL_MS=3000
HOSTILE_DANGER_RADIUS=10
HOSTILE_STOP_RADIUS=4
STOP_ON_DANGER=true

MIN_GOAL_REFRESH_DISTANCE=2
FOLLOW_REPATH_INTERVAL_MS=1500
MOVEMENT_PROGRESS_CHECK_MS=2000
MIN_PROGRESS_DISTANCE=0.5
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

DANGER_SCAN_INTERVAL_MS=3000
HOSTILE_DANGER_RADIUS=10
HOSTILE_STOP_RADIUS=4
STOP_ON_DANGER=true

MIN_GOAL_REFRESH_DISTANCE=2
FOLLOW_REPATH_INTERVAL_MS=1500
MOVEMENT_PROGRESS_CHECK_MS=2000
MIN_PROGRESS_DISTANCE=0.5
```

## Commands (v0.6)

Public-safe:

- `Ember hello`
- `Ember help`
- `Ember capabilities`
- `Ember status`
- `Ember vitals`
- `Ember danger`
- `Ember where are you`
- `Ember nearby`
- `Ember look`
- `Ember movement`

Owner-only:

- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember respawn`
- `Ember distance`
- `Ember obstacle`
- `Ember set home`
- `Ember home`
- `Ember recover`
- `Ember safety test`
- `Ember state`
- `Ember debug`
- `Ember ai status`
- `Ember action queue`

## Safety Rules

- Non-owner users cannot run owner commands.
- Chat and actions are rate-limited.
- `ALLOW_MINING`, `ALLOW_COMBAT`, `ALLOW_BUILDING`, `ALLOW_INVENTORY` default to `false`.
- Capability action scaffolding exists but is safety-gated and not implemented for execution yet.
- No eval/arbitrary code execution from chat.

## Survival + Movement Notes

- Periodic danger scan tracks nearby hostiles.
- If `STOP_ON_DANGER=true` and hostiles are within `HOSTILE_STOP_RADIUS`, bot stops movement and says: `Danger close. I am stopping.`
- Movement progress checks detect no-progress windows and trigger stuck handling.
- Stuck handling logs obstacle details and stops movement safely.
- `Ember obstacle` returns concise summary in chat and logs full JSON.
- `Ember set home` / `Ember home` are in-memory only (process lifetime, no DB).

## AI Bridge Stub Behavior

- `ENABLE_AI_BRIDGE=false`: logs skip and sends nothing.
- `ENABLE_AI_BRIDGE=true`: sends structured observations to `AI_BRIDGE_URL`.
- Observation includes bot snapshot, vitals, danger summary, movement state, capabilities, obstacle/perception, recent events, and action queue summary.
- AI-returned actions still pass safety validation before queueing.

## Microsoft Login and Session Cache

First run may require device-code auth. Use the logged code and verification URL.

Session/auth cache persists in `./data` (mounted as `/app/data` in Docker), so reauth is not required each restart.

## Local Dev

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Build and run:

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

Compose defaults:

- `./data:/app/data`
- `restart: unless-stopped`

## Home Server Deploy

```bash
cd /apps/ember-minecraft-bot
git pull
docker compose down
docker compose up -d --build
docker logs ember-minecraft-bot --tail 180
```

## v0.6 Test Checklist

- `Ember hello`
- `Ember help`
- `Ember capabilities`
- `Ember vitals`
- `Ember danger`
- `Ember movement`
- `Ember obstacle`
- `Ember safety test`
- `Ember set home`
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember home`
- `Ember recover`
- `Ember ai status`
