# v14 Inventory and Containers Scaffold

## Goal
Add controlled inventory/container scaffolding with strict default-off posture.

## Commands
- `Ember inventory detailed`
- `Ember hand`
- `Ember container status`
- `Ember open container` (targeted only and gated)
- Deposit/withdraw as scaffold only.

## Safety Requirements
- `ALLOW_CONTAINERS=false` by default.
- No container interaction unless allowed and owner-commanded.
- No autonomous container use.
- No AI container control.

## Constraints
- Read-only inventory remains allowed.
- No crafting/building/combat expansion in this prompt.

