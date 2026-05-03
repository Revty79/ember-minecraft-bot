# ember-minecraft-bot

Basic Minecraft Java bot service for EMBER, built with Node.js, TypeScript, Mineflayer, and mineflayer-pathfinder.

This is **v0.4 bot body only**:
- No Ollama integration
- No EMBER web app integration
- No advanced AI behavior
- No mining/building/combat/inventory automation

## Features (v0.4)

1. Connects to your Minecraft Java/Paper server.
2. Logs connect/disconnect/kick/error events.
3. Supports one-time spawn announcement with `ANNOUNCE_ON_SPAWN` (default `true`).
4. If any player says `Ember hello`, replies: `Hello. I'm here.`
5. If any player says `Ember status`, replies with position + health (and avoids `NaN` output).
6. If `BIRevty` says `Ember follow me`, bot follows `BIRevty`.
7. If `BIRevty` says `Ember come`, bot pathfinds to `BIRevty`'s current location.
8. If `BIRevty` says `Ember respawn`, bot requests manual respawn.
9. If `BIRevty` says `Ember stop`, bot clears movement/follow state.
10. Movement commands are owner-gated to `BIRevty`.
11. Death/respawn hardening: auto-respawn attempt, movement reset on death, no auto-follow resume after respawn.
12. Follow behavior is safety-limited (no digging, no parkour, no sprinting, no 1x1 tower pillaring).
13. Movement reliability hardening: distance gates, stuck-limit auto-stop, conservative path settings, and come timeout handling.

## Requirements

- Node.js 22+
- A Minecraft Java account for the bot (Microsoft auth)
- Bot account added to your server whitelist

## Environment

Copy `.env.example` to `.env` and fill values:

```env
MINECRAFT_HOST=10.0.0.218
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=
MINECRAFT_AUTH=microsoft
MINECRAFT_VERSION=
ANNOUNCE_ON_SPAWN=true
MAX_COME_DISTANCE=40
MAX_FOLLOW_START_DISTANCE=40
COME_GOAL_RADIUS=3
FOLLOW_DISTANCE=3
PATHFINDER_TIMEOUT_MS=15000
STUCK_RESET_LIMIT=3
```

Notes:
- `MINECRAFT_USERNAME` is required. For Microsoft auth, use the bot account identifier you want to cache under.
- This service currently supports only `MINECRAFT_AUTH=microsoft`.
- `MINECRAFT_VERSION` is optional. Set it when you want to force a specific server protocol/version (useful for diagnostics).
- `ANNOUNCE_ON_SPAWN` is optional (`true`/`false`). When true, the bot announces `EMBER is online.` once per process start after a safe startup delay.
- `MAX_COME_DISTANCE` blocks `Ember come` when target is too far.
- `MAX_FOLLOW_START_DISTANCE` blocks starting `Ember follow me` when target is too far.
- `COME_GOAL_RADIUS` sets `GoalNear` radius for `Ember come`.
- `FOLLOW_DISTANCE` sets `GoalFollow` range.
- `PATHFINDER_TIMEOUT_MS` stops `Ember come` if pathing takes too long.
- `STUCK_RESET_LIMIT` stops movement after repeated `path_reset: stuck`.

### Test Server Example

```env
MINECRAFT_HOST=10.0.0.218
MINECRAFT_PORT=25566
MINECRAFT_USERNAME=EmberR2025
MINECRAFT_AUTH=microsoft
MINECRAFT_VERSION=1.21.11
ANNOUNCE_ON_SPAWN=true
MAX_COME_DISTANCE=40
MAX_FOLLOW_START_DISTANCE=40
COME_GOAL_RADIUS=3
FOLLOW_DISTANCE=3
PATHFINDER_TIMEOUT_MS=15000
STUCK_RESET_LIMIT=3
```

## Commands (v0.4)

- `Ember hello`
- `Ember status`
- `Ember where are you`
- `Ember distance` (BIRevty only)
- `Ember come`
- `Ember follow me`
- `Ember stop`
- `Ember respawn`

## Local Development

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Production build/run:

```bash
npm run build
npm run start
```

## First-Time Microsoft Login (Device Code Flow)

On first run, Mineflayer will request Microsoft device auth. The service logs an auth message with:
- verification URL (usually `https://www.microsoft.com/link`)
- device code

Complete the flow in a browser while the bot process is running. After success, tokens are cached under `./data` (inside container: `/app/data`) so you do not re-auth on every restart.

## Docker

### Build and run with Compose

```bash
mkdir -p data
cp .env.example .env
# edit .env
docker compose up -d --build
```

Logs:

```bash
docker compose logs -f ember-minecraft-bot
```

Stop:

```bash
docker compose down
```

## Home Server Deployment Path

For your home server target path:

```bash
cd /apps/ember-minecraft-bot
docker compose up -d --build
```

`docker-compose.yml` already mounts auth/session cache as requested:

```yaml
./data:/app/data
```

Restart policy is set to:

```yaml
restart: unless-stopped
```

## Safety Scope

This bot intentionally does **not** mine, attack, place blocks, open containers, or manage inventory in v0.4.
