# v12 Shadow Mode

## Goal
Add AI shadow mode only. EMBER AI can observe and suggest what it would do, but no AI actions are executed.

## Required Env Flags
- `ENABLE_AI_SHADOW=false`
- `SHADOW_BRIDGE_URL=...`

## Required Additions
- Shadow observation payload.
- Shadow response logging.
- `Ember shadow status`.
- `Ember shadow last`.

## Strict Behavior
- AI suggestions are never executed in this version.
- Keep owner-commanded control model as primary.
- Keep dangerous capabilities gated and OFF by default.

