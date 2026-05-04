# ember-minecraft-bot

Minecraft Java bot body for EMBER using Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This release is **v0.12: shadow mode (observation only)**.

- AI bridge remains optional and disabled by default.
- Shadow mode is optional and disabled by default.
- No autonomous behavior loops are enabled.
- Combat/building/containers/crafting remain locked by default.
- Harvesting exists as single-command scaffolding behind safety flags.
- Wandering is owner-commanded, radius-bound, and time-limited behind safety flags.
- Tasks are owner-commanded one-shot objectives only.

## v0.12 Highlights

- Added AI shadow mode as observation + suggestion + logging only.
- Added periodic shadow observation loop with no-overlap protection.
- Added owner commands:
  - `Ember shadow status`
  - `Ember shadow last`
  - `Ember shadow test`
  - `Ember shadow summary`
- Added shadow visibility to `Ember capabilities` and `Ember safety test`.
- Shadow responses never execute actions and never write to action queue.

## Environment

Copy `.env.example` to `.env` and set values.

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
ENABLE_AI_SHADOW=false
SHADOW_BRIDGE_URL=http://10.0.0.218:3004/api/minecraft/shadow
SHADOW_BRIDGE_TOKEN=
SHADOW_OBSERVATION_INTERVAL_MS=10000
SHADOW_SEND_WHILE_MOVING=true
SHADOW_SEND_RECENT_EVENTS=25
SHADOW_TIMEOUT_MS=15000
SHADOW_LOG_RESPONSE=true
SHADOW_CHAT_SUMMARY=false
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
ALLOW_HARVEST=false
ALLOW_CROP_HARVEST=false
ENABLE_TASK_SYSTEM=true
TASK_OWNER_ONLY=true
REQUIRE_MATURE_CROPS=true
REPLANT_CROPS=false

MINE_OWNER_ONLY=true
HARVEST_OWNER_ONLY=true

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
MINE_PREVIEW_MAX_DISTANCE=5
BLOCK_TARGET_RAYCAST_DISTANCE=5

HARVEST_MAX_DISTANCE=5
HARVEST_TIMEOUT_MS=10000
HARVEST_ALLOWED_BLOCKS=short_grass,grass,fern,tall_grass,wheat,carrots,potatoes,beetroots,pumpkin,melon
HARVEST_FORBIDDEN_BLOCKS=chest,barrel,furnace,crafting_table,door,trapdoor,bedrock,water,lava,fire

ALLOW_WANDER=false
WANDER_OWNER_ONLY=true
WANDER_CENTER_MODE=home
WANDER_RADIUS=8
WANDER_MAX_DURATION_MS=30000
WANDER_STEP_RADIUS=4
WANDER_PAUSE_MS=2000
WANDER_MAX_STEPS=8
WANDER_TARGET_ATTEMPTS=20
WANDER_FLAT_ONLY=true
WANDER_MAX_STUCK_RETRIES=1
WANDER_STOP_ON_DANGER=true
WANDER_STOP_ON_LOW_HEALTH=true
WANDER_LOW_HEALTH_THRESHOLD=10
WANDER_STOP_ON_LOW_FOOD=true
WANDER_LOW_FOOD_THRESHOLD=8
WANDER_ALLOW_MINING=false
WANDER_ALLOW_HARVEST=false
WANDER_ALLOW_COMBAT=false
WANDER_ALLOW_BUILDING=false
WANDER_ALLOW_CONTAINERS=false
WANDER_REQUIRE_HOME=true
WANDER_RESPECT_HOME_PROTECTION=true

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

- `Ember target`
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
- `Ember harvest report`
- `Ember harvest front`
- `Ember harvest grass`
- `Ember harvest crop`
- `Ember harvest stop`
- `Ember wander`
- `Ember wander home`
- `Ember wander stop`
- `Ember yard status`
- `Ember yard check`
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
- `Ember shadow status`
- `Ember shadow last`
- `Ember shadow test`
- `Ember shadow summary`
- `Ember action queue`
- `Ember task go home`
- `Ember task follow owner`
- `Ember task eat if hungry`
- `Ember task wander once`
- `Ember task harvest once`
- `Ember task mine once`
- `Ember task report`
- `Ember task stop`

## Capability Model

`Ember capabilities` reports current enabled state, including:

- movement
- perception
- home
- flee
- tasks
- shadow
- inventoryRead
- equipment
- eating
- mining
- harvesting
- cropHarvesting
- wandering
- combat
- building
- crafting
- containers
- ai

## Safety Rules

Defaults stay locked:

- `ALLOW_COMBAT=false`
- `ALLOW_BUILDING=false`
- `ALLOW_INVENTORY=false`
- `ALLOW_HARVEST=false`
- `ALLOW_CROP_HARVEST=false`
- `REPLANT_CROPS=false`

Important notes:

- No chest/container interaction.
- No crafting support.
- No autonomous mining/harvesting loops.
- Mining and harvesting remain explicit command actions.
- Home protection still blocks risky mining near home.
- While wandering, mining/harvesting/combat/building/container/crafting actions are blocked.
- Task system is one-shot only and does not add autonomous loops.
- Shadow mode is observation-only and does not execute body actions.
- Shadow response `actions` are ignored in v0.12.

## Harvesting (v0.9)

- `Ember harvest front` breaks one directly targeted safe block.
- `Ember harvest grass` allows only grass/fern/tall_grass targets.
- `Ember harvest crop` requires `ALLOW_CROP_HARVEST=true`.
- If `REQUIRE_MATURE_CROPS=true`, unknown/immature crop age is refused.
- `REPLANT_CROPS=false` means no replant behavior yet.

## Shadow Mode (v0.12)

Shadow mode sends observation snapshots to the EMBER app and records what EMBER would do, without executing body actions.

- Shadow control flag: `ENABLE_AI_SHADOW`
- Shadow endpoint: `SHADOW_BRIDGE_URL`
- Shadow auth: `SHADOW_BRIDGE_TOKEN` (never logged)
- Shadow interval: `SHADOW_OBSERVATION_INTERVAL_MS`
- Shadow timeout: `SHADOW_TIMEOUT_MS`
- Shadow moving behavior: `SHADOW_SEND_WHILE_MOVING`
- Shadow response logging: `SHADOW_LOG_RESPONSE`
- Shadow chat summary toggle: `SHADOW_CHAT_SUMMARY` (default `false`)

Shadow endpoints are expected to return data like:

```json
{
  "mode": "shadow",
  "executed": false,
  "reply": "I would step back and reassess.",
  "wouldDo": "Move to safer ground near home.",
  "confidence": "medium",
  "allowedActionTypes": [],
  "actions": [],
  "logId": "optional-id"
}
```

Behavior guarantees in v0.12:

- Shadow response `actions` are ignored.
- No action queue entries are created from shadow responses.
- `executed=true` is logged as warning and still not executed.
- If the endpoint is offline or invalid, bot continues running.

## AI Bridge vs Shadow

- `ENABLE_AI_BRIDGE` is the separate action bridge path (disabled by default).
- `ENABLE_AI_SHADOW` is observation-only shadow mode.
- Keep `ENABLE_AI_BRIDGE=false` when using shadow-only operation.

## Shadow Commands

- `Ember shadow status`: enabled/configured state, bridge host+path, send/response/error counters.
- `Ember shadow last`: last reply/wouldDo/confidence/logId.
- `Ember shadow test`: owner-triggered single shadow send (no action execution).
- `Ember shadow summary`: one-line shadow health summary.

## Yard Wandering (v0.10.2)

- `Ember wander` and `Ember wander home` run safe, owner-commanded wandering around home.
- Wandering is bounded by `WANDER_RADIUS`, `WANDER_MAX_DURATION_MS`, and `WANDER_MAX_STEPS`.
- Flat-yard reliability controls:
  - `WANDER_TARGET_ATTEMPTS`
  - `WANDER_FLAT_ONLY`
  - `WANDER_MAX_STUCK_RETRIES`
- `Ember wander stop` and `Ember stop` both stop wandering immediately.
- `Ember yard status` reports center/radius/distance/inside/active.
- `Ember yard check` reports safety diagnostics for live testing.

## Task System (v0.11)

- `Ember task go home`: one-shot home task.
- `Ember task follow owner`: starts follow objective as a task.
- `Ember task eat if hungry`: eats only when hunger requires it.
- `Ember task wander once`: runs one bounded yard-wander task.
- `Ember task harvest once`: harvests one safe target.
- `Ember task mine once`: mines one safe target.
- `Ember task report`: reports current/last task state.
- `Ember task stop`: stops active task and clears queued task actions.

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

## Known Limitations

- Terrain-limited pathing remains possible because autonomous terrain modification is disabled.
- Crop maturity detection depends on block state availability.
- Harvesting is intentionally single-action and command-driven only.
