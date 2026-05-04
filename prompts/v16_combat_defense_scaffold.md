# v16 Combat Defense Scaffold

## Goal
Add defensive combat scaffold only, with flee-first behavior and strict safety gating.

## Required Env Flags
- `ALLOW_COMBAT=false`
- `DEFENSE_ONLY=true`

## Required Controls
- Max engagement radius.
- Stop on low health.
- Flee when overwhelmed.
- Owner commands:
  - `Ember defend`
  - `Ember combat stop`

## Constraints
- No hunting.
- No attacking passive mobs.
- No autonomous combat behavior outside defensive gating.

