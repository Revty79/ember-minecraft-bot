# v12 Shadow Mode

## Goal

Add AI shadow mode only.

EMBER AI can observe the Minecraft bot body and say what she would do, but no AI actions are executed in this version.

Shadow mode is observation + suggestion + logging.

It is NOT control.
It is NOT supervised mode.
It is NOT autonomy.
It is NOT task execution.
It is NOT action execution.

## Current Project Context

The bot already has:
- safe movement
- home/stay-home
- flee
- eating/equipment
- safe mining
- safe harvesting
- safe yard wandering
- v11 task system
- action queue
- bot state snapshots
- AI bridge scaffold currently disabled
- safety gates for combat/building/crafting/containers/AI

EMBER chat app will expose a brain-side endpoint, likely:

POST /api/minecraft/shadow

But this repo must not assume implementation details beyond a stable HTTP URL and token.

## Required Env Flags

Add safe defaults:

ENABLE_AI_SHADOW=false
SHADOW_BRIDGE_URL=http://10.0.0.218:3004/api/minecraft/shadow
SHADOW_BRIDGE_TOKEN=
SHADOW_OBSERVATION_INTERVAL_MS=10000
SHADOW_SEND_WHILE_MOVING=true
SHADOW_SEND_RECENT_EVENTS=25
SHADOW_TIMEOUT_MS=15000
SHADOW_LOG_RESPONSE=true
SHADOW_CHAT_SUMMARY=false

Rules:
- ENABLE_AI_SHADOW=false by default.
- If ENABLE_AI_SHADOW=false, no shadow calls are sent.
- If ENABLE_AI_SHADOW=true but SHADOW_BRIDGE_URL or SHADOW_BRIDGE_TOKEN is missing, log a clear error and do not spam chat.
- Never print the token in logs.
- SHADOW_CHAT_SUMMARY=false by default so EMBER does not spam Minecraft chat.

## Required Additions

### 1. Shadow status state

Track:

shadowEnabled
shadowBridgeUrl
shadowLastSentAt
shadowLastResponseAt
shadowLastError
shadowLastReply
shadowLastWouldDo
shadowLastConfidence
shadowLastLogId
shadowSendCount
shadowErrorCount

Add this to state snapshots if appropriate.

### 2. Shadow observation payload

Build a clean observation payload for the EMBER chat app.

Include:
- timestamp
- source: "ember-minecraft-bot"
- mode: "shadow"
- bot version/build if available
- bot snapshot
- current task state
- movement state
- vitals
- hunger/food
- equipment
- inventory food summary
- danger summary
- nearby players
- nearby entities/hostiles if available
- perception snapshot
- target block summary
- mining capability summary
- harvest capability summary
- yard/home state
- current safety flags
- action queue summary
- recent events

Use existing state/perception/action summaries where possible.
Do not include secrets.
Do not include SHADOW_BRIDGE_TOKEN.

### 3. Shadow bridge client

Create a dedicated shadow controller/client, for example:

src/bot/shadowBridge.ts

Responsibilities:
- build observation
- send POST to SHADOW_BRIDGE_URL
- add Authorization: Bearer <SHADOW_BRIDGE_TOKEN>
- timeout using SHADOW_TIMEOUT_MS
- parse response defensively
- update shadow state
- log reply/wouldDo/confidence
- never execute actions from response

Expected response shape from EMBER app:

{
  "mode": "shadow",
  "executed": false,
  "reply": "...",
  "wouldDo": "...",
  "confidence": "low" | "medium" | "high",
  "allowedActionTypes": [],
  "actions": [],
  "logId": "optional"
}

Behavior:
- If response has actions, ignore them in v12.
- If executed=true, log warning but do not treat it as body execution.
- If response is invalid JSON, log error and continue.
- If endpoint fails, store last error and continue.
- Do not crash the bot due to shadow bridge errors.

### 4. Shadow interval loop

When ENABLE_AI_SHADOW=true:
- send observation every SHADOW_OBSERVATION_INTERVAL_MS
- do not send if bot is not ready/alive unless the observation is useful and safe
- do not overlap calls; if one is in flight, skip the next interval
- respect SHADOW_SEND_WHILE_MOVING
  - if false and bot is moving, skip
  - if true, send while moving too

Log skipped sends in debug-style logs, but avoid spam.

### 5. Commands

Add owner-only or safe report commands:

#### Ember shadow status

Shows:
- enabled/disabled
- bridge URL host/path only, no token
- last sent time
- last response time
- last error
- send count
- error count

Example:
Shadow: enabled=true, lastSent=..., lastResponse=..., confidence=medium, errors=0.

#### Ember shadow last

Shows:
- last reply
- last wouldDo
- confidence
- logId if present

If no response yet:
No shadow response yet.

#### Ember shadow test

Owner-only.
Immediately sends one observation to the shadow endpoint if enabled and configured.

If disabled:
Shadow mode is disabled by safety settings.

If missing token/url:
Shadow bridge is not configured.

Expected:
- sends exactly one observation
- updates last shadow fields
- does not execute actions

#### Ember shadow summary

Optional.
Short one-line summary of current shadow state.

### 6. Capabilities update

Update:

Ember capabilities

Add:

shadow=true/false

Based on ENABLE_AI_SHADOW.

Keep ai=false unless the existing AI execution bridge is enabled.
Shadow is not AI control.

### 7. Safety test update

Update:

Ember safety test

Include:

shadow allowed/blocked

Example:
shadow blocked, ai blocked

or:
shadow allowed, ai blocked

Important:
AI blocked must remain blocked unless ENABLE_AI_BRIDGE=true.

### 8. AI bridge separation

Do not confuse:
- ENABLE_AI_BRIDGE = current/future action bridge
- ENABLE_AI_SHADOW = observation-only shadow bridge

In v12:
- ENABLE_AI_SHADOW may be true
- ENABLE_AI_BRIDGE should remain false
- shadow responses must never queue actions

Do not route shadow responses into action queue.

### 9. README update

Document:
- Shadow mode purpose
- Env vars
- Difference between shadow and AI bridge
- Commands:
  - Ember shadow status
  - Ember shadow last
  - Ember shadow test
  - Ember shadow summary
- Example .env
- Example expected response
- Safety guarantee:
  - no shadow action execution in v12

### 10. .env.example update

Add:

ENABLE_AI_SHADOW=false
SHADOW_BRIDGE_URL=http://10.0.0.218:3004/api/minecraft/shadow
SHADOW_BRIDGE_TOKEN=
SHADOW_OBSERVATION_INTERVAL_MS=10000
SHADOW_SEND_WHILE_MOVING=true
SHADOW_SEND_RECENT_EVENTS=25
SHADOW_TIMEOUT_MS=15000
SHADOW_LOG_RESPONSE=true
SHADOW_CHAT_SUMMARY=false

Keep:

ENABLE_AI_BRIDGE=false

### 11. STATUS.md update

After implementation:
- mark v12 complete only if build passes
- add run log
- list files changed
- list commands to run
- list test checklist
- list known limitations
- include v11 polish carry-forward notes:
  - task stop wording awkward
  - task eat completion chat polish
  - task harvest/home-protection clarity
  - monitor restart/relog count if repeated

Do not continue to v13 unless explicitly instructed.

## Strict Behavior

- AI suggestions are never executed in this version.
- Shadow response actions are ignored.
- No action queue entries are created from shadow.
- Owner-commanded control remains primary.
- Dangerous capabilities remain gated and OFF by default.
- Combat/building/crafting/containers remain blocked.
- ENABLE_AI_BRIDGE remains false unless manually changed later.
- No autonomy.
- No supervised mode.
- No full autonomy switch in v12.
- No raw keyboard/movement control.
- No Minecraft chat spam by default.
- Bot must continue running if the EMBER app is offline.

## Test Checklist

With ENABLE_AI_SHADOW=false:
- Build passes.
- Bot starts.
- Ember capabilities shows shadow=false.
- Ember safety test shows shadow blocked.
- Ember shadow status says disabled.
- Ember shadow test says shadow disabled.
- No network calls are made to SHADOW_BRIDGE_URL.

With ENABLE_AI_SHADOW=true but missing SHADOW_BRIDGE_TOKEN:
- Bot starts.
- Shadow status reports configuration problem.
- Shadow test says bridge not configured.
- Bot does not crash.
- Token is not logged.

With ENABLE_AI_SHADOW=true and token/url configured:
- Ember shadow test sends one observation.
- EMBER app returns shadow response.
- Ember shadow last shows reply/wouldDo/confidence.
- No action is executed.
- action queue remains 0.
- mode stays idle unless owner commanded something.
- Logs show shadow response.
- If EMBER app is down, bot stores last error and continues.

Regression tests:
- Ember task report still works.
- Ember task wander still works.
- Ember task mine still works.
- Ember task harvest still works.
- Ember stop still works.
- AI bridge remains disabled.