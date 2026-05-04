# v15 Building and Crafting Scaffold

## Goal
Add controlled, owner-commanded building/crafting scaffolding with strict default-off behavior.

## Scope
- Place one block at a targeted safe location.
- Craft one simple item when recipe/materials are available.

## Constraints
- No free building.
- No AI building.
- No structure building.
- No lava/water/redstone operations.
- No destructive replacement behavior.

## Safety Requirements
- Default OFF via env flags.
- Owner-only control.
- Safety validation before each action.

