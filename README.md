# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.8: controlled eating, equipment awareness, and safe mining foundation**.

- AI bridge remains optional/stubbed and disabled by default.
- No autonomous AI behavior is enabled.
- Mining/combat/building/containers remain locked by default.

## v0.8 Highlights

- Controlled eating flow with `Ember eat` / `Ember eat force`.
- Equipment awareness and equip commands (`food/pickaxe/shovel/axe`) behind safety gating.
- Safe mining foundation with strict owner-only and block safety checks.
- Ore report now explains why ore is or is not mineable.
- Home protection radius prevents mining inside home area.

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
ALLOW_EQUIP=false
ALLOW_FLEE=true
MINE_OWNER_ONLY=true

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

MINING_MAX_DISTANCE=5
MINING_TIMEOUT_MS=10000
MINING_ALLOWED_BLOCKS=dirt,grass_block,snow,stone,coal_ore,copper_ore,iron_ore
MINING_FORBIDDEN_BLOCKS=bedrock,water,lava,fire,chest,barrel,furnace,crafting_table,door,trapdoor
REQUIRE_TOOL_FOR_STONE=true
REQUIRE_TOOL_FOR_ORES=true
LOW_HEALTH_STOP_THRESHOLD=8
LOW_FOOD_EAT_THRESHOLD=14
HOME_PROTECTION_RADIUS=6

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
- `Ember equipment`
- `Ember food`
- `Ember eat`
- `Ember eat force`
- `Ember equip food`
- `Ember equip pickaxe`
- `Ember equip shovel`
- `Ember equip axe`
- `Ember mine front`
- `Ember mine block`
- `Ember mine ore`
- `Ember mine stop`
- `Ember ore report`
- `Ember block`
- `Ember ores nearby`
- `Ember obstacle`
- `Ember distance`
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember flee`
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
- `ALLOW_EQUIP=false`

Notes:

- Inventory read commands do not open chests/containers.
- `EAT_FOOD` and `EQUIP_ITEM` are blocked unless explicitly enabled.
- Mining is owner-commanded only and safety-validated for distance, block allow/deny lists, danger, health, hunger, position validity, and home protection.
- No autonomous mining loops are enabled.

## Mining Guardrails (v0.8)

- Mines only explicit owner commands.
- `mine front`/`mine block` target direct front block.
- `mine ore` targets nearest visible ore only when safe/simple.
- Stops mining on timeout, invalid position, danger, or low health.
- Rejects mining inside `HOME_PROTECTION_RADIUS` around home.

## AI Bridge Stub

- If `ENABLE_AI_BRIDGE=false`, bridge calls are skipped/logged.
- If `ENABLE_AI_BRIDGE=true`, observations are POSTed to `AI_BRIDGE_URL`.
- AI-requested actions still pass safety validation.

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
