# EMBER Prompt Roadmap Status

## Queue
- [x] v10.2_safe_yard_reliability.md
- [x] v11_task_system.md
- [ ] v12_shadow_mode.md
- [ ] v13_supervised_action_requests.md
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
