# v11 Task System

## Goal
Add a simple one-shot, owner-commanded task system. Each task executes a single objective and then stops.

## Task Examples
- go home
- follow owner
- eat if hungry
- wander yard once
- harvest one target
- mine one safe target

## Constraints
- No multi-step autonomy.
- No background loops.
- No AI execution changes.

## Required Additions
- Task state tracking.
- `Ember task report`.
- `Ember task stop`.
- Owner-only command routing for task execution.
- Safety validation per task action.

## Required Guardrails
- Dangerous capabilities stay gated by env vars and default OFF.
- No combat/building/containers/crafting unless explicitly enabled by future prompts.

