# EMBER Prompt Roadmap Status

## Queue
- [x] v10.2_safe_yard_reliability.md
- [x] v11_task_system.md
- [x] v12_shadow_mode.md
- [x] v13_supervised_action_requests.md
- [ ] v14_inventory_and_containers_scaffold.md
- [ ] v15_building_and_crafting_scaffold.md
- [ ] v16_combat_defense_scaffold.md

## Execution Rule
Implement only the first unchecked prompt in order. Do not skip ahead.

## Run Log

### 2026-05-04 - v10.2_safe_yard_reliability.md

Status: completed

Summary:
- Verified `v10.2` reliability mechanics already present in codebase (safe target attempts, flat-only mode, stuck retry limits, yard diagnostics, and short_grass handling).
- Added strict safety enforcement so mining/harvesting/combat/building/container/crafting actions are blocked while wandering.
- Added structured prompt roadmap files (`v10.2` through `v16`) and initialized queue tracking.
- Updated README to `v0.10.2` with wander env vars, command docs, and yard reliability/safety notes.

Files changed:
- `README.md`
- `src/bot/safety.ts`
- `prompts/STATUS.md`
- `prompts/v10.2_safe_yard_reliability.md`
- `prompts/v11_task_system.md`
- `prompts/v12_shadow_mode.md`
- `prompts/v13_supervised_action_requests.md`
- `prompts/v14_inventory_and_containers_scaffold.md`
- `prompts/v15_building_and_crafting_scaffold.md`
- `prompts/v16_combat_defense_scaffold.md`

Commands run:
- `npm run build`

Commands to run on server:
- `cd /apps/ember-minecraft-bot`
- `git pull`
- `docker compose down`
- `docker compose up -d --build`
- `docker logs ember-minecraft-bot --tail 220`

Tests to perform:
- With `ALLOW_WANDER=false`:
  - `Ember wander` -> should report disabled.
  - `Ember yard status`
  - `Ember yard check`
- With `ALLOW_WANDER=true`:
  - `Ember yard check`
  - `Ember wander`
  - Verify 1-3 successful steps in flat yard before stop/completion.
  - `Ember stop` and `Ember wander stop` immediate stop.
  - Confirm no mining/harvesting/combat/building/container actions during wander.
- Grass handling:
  - Face `short_grass`
  - `Ember target`
  - `Ember harvest grass` (when harvesting enabled)
  - Verify one-block action and no loop.

Known limitations:
- Terrain/pathfinding can still stop on edge cases; safe-stop behavior is intentional.
- Live Minecraft integration tests were not run in this local pass; only TypeScript build was validated.

### 2026-05-04 - v11_task_system.md

Status: completed

Summary:
- Added a one-shot owner task system (`START_TASK`) with explicit task state tracking in bot state.
- Added owner task commands for one-shot objectives (home/follow/eat-if-hungry/wander/harvest/mine), plus `Ember task report` and `Ember task stop`.
- Added task safety gating via env flags (`ENABLE_TASK_SYSTEM`, `TASK_OWNER_ONLY`) and integrated task checks into safety test output.
- Updated capability reporting to include `tasks`.
- Updated README and `.env.example` with v11 task docs and env values.

Files changed:
- `.env.example`
- `README.md`
- `src/config.ts`
- `src/index.ts`
- `src/bot/types.ts`
- `src/bot/state.ts`
- `src/bot/safety.ts`
- `src/bot/commands.ts`
- `src/bot/actions.ts`
- `src/bot/aiBridge.ts`
- `prompts/STATUS.md`

Commands run:
- `npm run build`

Commands to run on server:
- `cd /apps/ember-minecraft-bot`
- `git pull`
- `docker compose down`
- `docker compose up -d --build`
- `docker logs ember-minecraft-bot --tail 220`

Tests to perform:
- With `ENABLE_TASK_SYSTEM=false`:
  - `Ember capabilities` (verify `tasks=false`)
  - `Ember safety test` (verify tasks blocked)
  - `Ember task report`
  - `Ember task home` (should say disabled)
- With `ENABLE_TASK_SYSTEM=true`:
  - `Ember task report`
  - `Ember task eat if hungry`
  - `Ember task home`
  - `Ember task wander once`
  - `Ember task harvest once`
  - `Ember task mine once`
  - `Ember task stop`
  - `Ember stop` (verify active task is safely stopped)

Known limitations:
- `follow_owner` task is treated as one-shot "follow start" success; it does not stay open as a long-lived task lifecycle.
- Task execution relies on existing action behavior and action-level safety; no separate task scheduler/timer loop was added.
- Live in-game validation is still required; this pass validated TypeScript build only.

### 2026-05-04 - v12_shadow_mode.md

Status: completed

Summary:
- Added `ENABLE_AI_SHADOW` observation-only bridge with dedicated `shadowBridge` controller and interval loop.
- Added shadow state tracking fields (last send/response/error/reply/wouldDo/confidence/logId plus counters) and wired them into snapshots/state.
- Added owner shadow commands: `Ember shadow status`, `Ember shadow last`, `Ember shadow test`, `Ember shadow summary`.
- Added `shadow` capability reporting and safety-test visibility (`shadow allowed/blocked`, with AI bridge reporting unchanged/separate).
- Enforced strict v12 behavior: shadow responses are parsed and logged, but response `actions` are always ignored and never queued.

Files changed:
- `.env.example`
- `README.md`
- `src/config.ts`
- `src/index.ts`
- `src/bot/actions.ts`
- `src/bot/aiBridge.ts`
- `src/bot/commands.ts`
- `src/bot/safety.ts`
- `src/bot/shadowBridge.ts`
- `src/bot/state.ts`
- `src/bot/types.ts`
- `prompts/STATUS.md`

Commands run:
- `npm run build`

Commands to run on server:
- `cd /apps/ember-minecraft-bot`
- `git pull`
- `docker compose down`
- `docker compose up -d --build`
- `docker logs ember-minecraft-bot --tail 220`

Tests to perform:
- With `ENABLE_AI_SHADOW=false`:
  - Build passes.
  - Bot starts.
  - `Ember capabilities` shows `shadow=false`.
  - `Ember safety test` shows `shadow blocked`.
  - `Ember shadow status` says disabled.
  - `Ember shadow test` says shadow disabled.
  - No network calls are made to `SHADOW_BRIDGE_URL`.
- With `ENABLE_AI_SHADOW=true` but missing `SHADOW_BRIDGE_TOKEN`:
  - Bot starts.
  - Shadow status reports configuration problem.
  - Shadow test says bridge not configured.
  - Bot does not crash.
  - Token is not logged.
- With `ENABLE_AI_SHADOW=true` and token/url configured:
  - `Ember shadow test` sends one observation.
  - EMBER app returns shadow response.
  - `Ember shadow last` shows reply/wouldDo/confidence.
  - No action is executed.
  - Action queue remains `0`.
  - Mode stays idle unless owner commands movement/task/action.
  - Logs show shadow response metadata.
  - If EMBER app is down, bot stores last error and continues.
- Regression:
  - `Ember task report` still works.
  - `Ember task wander` still works.
  - `Ember task mine` still works.
  - `Ember task harvest` still works.
  - `Ember stop` still works.
  - AI bridge remains disabled unless explicitly enabled.

Known limitations:
- Live Minecraft integration testing was not run in this local pass; TypeScript build validation only.
- `SHADOW_CHAT_SUMMARY` is optional and should remain `false` by default to avoid chat noise.
- v11 polish carry-forward:
  - task stop wording remains a bit awkward in some paths.
  - task eat completion chat wording still needs polish.
  - task harvest/home-protection messaging can be clearer.
  - continue monitoring restart/relog count if repeated reconnects occur.

### 2026-05-04 - v13_supervised_action_requests.md

Status: completed

Summary:
- Added a dedicated supervised bridge controller (`src/bot/supervisedBridge.ts`) that sends supervised observations, validates responses, applies strict action allowlist/confidence checks, runs safety dry-runs, and queues only approved safe actions.
- Added supervised state tracking fields and counters (configured/inFlight/send/error/accepted/rejected/executed and last requested/accepted/rejected action sets), separate from shadow state.
- Added owner supervised commands:
  - `Ember supervised status`
  - `Ember supervised last`
  - `Ember supervised test`
  - `Ember supervised summary`
- Added supervised capability/safety reporting:
  - `Ember capabilities` now reports `supervised` and `aiBridge`.
  - `Ember safety test` now reports `shadow`, `supervised`, `aiBridge`, supervised allowlist, and forbidden AI scope blocking summary.
- Added supervised interval loop and result reporting support (`/api/minecraft/result`) with non-crashing failure behavior.
- Preserved v12 guarantees:
  - shadow remains observation-only
  - shadow actions remain ignored
  - no shadow action queue execution path added

Files changed:
- `.env.example`
- `README.md`
- `src/config.ts`
- `src/index.ts`
- `src/bot/actions.ts`
- `src/bot/aiBridge.ts`
- `src/bot/commands.ts`
- `src/bot/safety.ts`
- `src/bot/state.ts`
- `src/bot/types.ts`
- `src/bot/supervisedBridge.ts`
- `prompts/STATUS.md`

Commands run:
- `npm run build`

Commands to run on server:
- `cd /apps/ember-minecraft-bot`
- `git pull`
- `docker compose down`
- `docker compose up -d --build`
- `docker logs ember-minecraft-bot --tail 220`

Tests to perform:
- With `ENABLE_AI_SUPERVISED=false`:
  - Build passes.
  - Bot starts.
  - `Ember capabilities` shows `supervised=false`.
  - `Ember safety test` shows supervised blocked.
  - `Ember supervised status` says disabled.
  - `Ember supervised test` says supervised disabled.
  - No calls are made to `SUPERVISED_BRIDGE_URL`.
  - Shadow mode still works if enabled.
  - Owner commands still work.
- With `ENABLE_AI_SUPERVISED=true` but missing token:
  - Bot starts.
  - `Ember supervised status` reports `configured=false`.
  - `Ember supervised test` says bridge not configured.
  - Bot does not crash.
  - Token is not logged.
- With `ENABLE_AI_SUPERVISED=true` and token/url configured:
  - `Ember supervised test` sends one observation.
  - EMBER returns supervised response.
  - Bot validates confidence and action type against allowlist.
  - Bot rejects forbidden actions.
  - Bot queues only allowed safe actions.
  - Result is logged and reported when enabled.
  - Action queue remains bounded and safe.
  - AI bridge remains disabled unless separately enabled.
- Allowed action verification:
  - `STATUS`, `LOOK`, `EAT_IF_HUNGRY`, `GO_HOME`, `STOP`, `FLEE`, `WANDER_YARD` through supervised responses.
- Forbidden action verification:
  - MINE/BUILD/ATTACK/CRAFT/CONTAINER/BREAK/PLACE/HARVEST_CROP should be rejected, logged, and not queued.
- Regression:
  - `Ember hello` works.
  - `Ember task report/home/wander/mine/harvest` owner flows still work.
  - `Ember stop` works.
  - `Ember shadow test` and `Ember shadow last` still work.
  - AI bridge remains disabled by default.

Known limitations:
- Live Minecraft integration tests were not run in this local pass; TypeScript build validation only.
- Queue acceptance/execution counters are based on supervised pipeline acceptance and queue requests; deep post-action outcome reconciliation is still limited.
- Remote settings sync (`/api/minecraft/settings`) was not implemented in v13 and is deferred.

Safety notes:
- No full autonomy switch.
- No raw control.
- No mining/building/combat/crafting/containers from supervised AI.
- Body safety and existing action safety gates remain final authority.
- No token logging.
- No crash on invalid JSON/offline EMBER endpoint.
- No overlapping supervised calls.

Carry-forward notes:
- Shadow replies should remain short and practical.
- Shadow/supervised generation can be slow on local Ollama; long timeouts may be needed.
- Bot body and EMBER brain identity should keep converging toward one unified EMBER identity.
- No full autonomy yet.
