# v13 Supervised Action Requests

## Goal
Allow AI to request actions, but never execute unless explicitly allowed and safety-approved.

## Required Env Flag
- `ALLOW_AI_SUPERVISED=false`

## Allowed AI Request Scope (initial)
- report status
- look around
- eat if hungry
- go home
- stop
- flee
- wander yard

## Forbidden Scope
- No mining/building/combat/containers from AI in this version.

## Requirements
- Every AI request must be logged.
- Every request must pass existing safety validation.
- Requests remain no-op when supervised mode is disabled.

