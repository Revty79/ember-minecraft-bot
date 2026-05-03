import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import mineflayer from "mineflayer";
import { pathfinder, Movements, goals, type PartiallyComputedPath } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";

dotenv.config();

const OWNER_USERNAME = "BIRevty";
const PROFILES_FOLDER = path.resolve(process.cwd(), "data");

const CHAT_MIN_INTERVAL_MS = 1200;
const SPAWN_ANNOUNCE_DELAY_MS = 3000;
const POSITION_WAIT_TIMEOUT_MS = 15000;
const RESPAWN_DELAY_MS = 1500;
const RESPAWN_COOLDOWN_MS = 5000;
const PATH_UPDATE_LOG_INTERVAL_MS = 2500;

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port value for ${name}: "${raw}"`);
  }
  return port;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new Error(`Invalid boolean value for ${name}: "${raw}"`);
}

function readNumberEnv(name: string, fallback: number, min?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${name}: "${raw}"`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`Invalid numeric value for ${name}: "${raw}" (must be >= ${min})`);
  }

  return value;
}

function readIntEnv(name: string, fallback: number, min?: number): number {
  const value = readNumberEnv(name, fallback, min);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid integer value for ${name}: "${value}"`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FollowState = {
  active: boolean;
  targetUsername: string | null;
};

type MovementMode = "idle" | "come" | "follow";

const host = readEnv("MINECRAFT_HOST", "10.0.0.218");
const port = readPort("MINECRAFT_PORT", 25565);
const username = readEnv("MINECRAFT_USERNAME");
const auth = readEnv("MINECRAFT_AUTH", "microsoft");
const version = process.env.MINECRAFT_VERSION?.trim() || undefined;
const announceOnSpawn = readBooleanEnv("ANNOUNCE_ON_SPAWN", true);
const maxComeDistance = readNumberEnv("MAX_COME_DISTANCE", 40, 1);
const maxFollowStartDistance = readNumberEnv("MAX_FOLLOW_START_DISTANCE", 40, 1);
const comeGoalRadius = readNumberEnv("COME_GOAL_RADIUS", 3, 1);
const followDistance = readNumberEnv("FOLLOW_DISTANCE", 3, 1);
const pathfinderTimeoutMs = readIntEnv("PATHFINDER_TIMEOUT_MS", 15000, 1000);
const stuckResetLimit = readIntEnv("STUCK_RESET_LIMIT", 3, 1);

if (auth !== "microsoft") {
  throw new Error(
    `Unsupported MINECRAFT_AUTH "${auth}". This service currently supports only "microsoft".`
  );
}

fs.mkdirSync(PROFILES_FOLDER, { recursive: true });

const bot = mineflayer.createBot({
  host,
  port,
  username,
  ...(version ? { version } : {}),
  auth: "microsoft",
  profilesFolder: PROFILES_FOLDER,
  respawn: false,
  onMsaCode: (info: { user_code: string; verification_uri: string; expires_in?: number }) => {
    const expiration = info.expires_in ? ` (expires in ${info.expires_in}s)` : "";
    console.log(
      `[auth] Use code "${info.user_code}" at ${info.verification_uri}${expiration} to authenticate.`
    );
  }
});

bot.loadPlugin(pathfinder);

const followState: FollowState = {
  active: false,
  targetUsername: null
};

let spawnCount = 0;
let deathCount = 0;
let diedSinceLastSpawn = false;
let hasAnnouncedOnline = false;
let movementReady = false;
let chatReady = false;
let readyGeneration = 0;
let respawnTimerActive = false;
let lastRespawnRequestAt = 0;
let lastChatSentAt = 0;
let kickedForChatValidation = false;
let movementMode: MovementMode = "idle";
let movementStartedAt = 0;
let stuckResetCount = 0;
let activeComeGoal: { x: number; y: number; z: number; radius: number } | null = null;
let movementTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let lastPathUpdateLogAt = 0;
let lastPathUpdateStatus = "";

const ownerLower = OWNER_USERNAME.toLowerCase();

if (version) {
  console.log(`[connect] Requested Minecraft protocol version: ${version}`);
}
console.log(`[connect] ANNOUNCE_ON_SPAWN=${String(announceOnSpawn)}`);
console.log(
  `[move] config MAX_COME_DISTANCE=${maxComeDistance} MAX_FOLLOW_START_DISTANCE=${maxFollowStartDistance} COME_GOAL_RADIUS=${comeGoalRadius} FOLLOW_DISTANCE=${followDistance} PATHFINDER_TIMEOUT_MS=${pathfinderTimeoutMs} STUCK_RESET_LIMIT=${stuckResetLimit}`
);

function isOwner(usernameToCheck: string): boolean {
  return usernameToCheck.toLowerCase() === ownerLower;
}

function isFinitePosition(position: Vec3 | undefined | null): boolean {
  if (!position) return false;
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  );
}

function formatPosition(position: Vec3): string {
  return `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`;
}

function isBotAlive(): boolean {
  const withLifeFlag = bot as unknown as { isAlive?: boolean };
  return withLifeFlag.isAlive ?? bot.health > 0;
}

async function waitForValidPosition(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (isFinitePosition(bot.entity?.position)) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function getBotPositionReadiness(): { ready: boolean; reason: string } {
  if (!movementReady) {
    return { ready: false, reason: "bot position not valid yet after respawn/death." };
  }

  const position = bot.entity?.position;
  if (!isFinitePosition(position)) {
    return {
      ready: false,
      reason: `bot position not valid yet after respawn/death. raw=${JSON.stringify(position)}`
    };
  }

  return { ready: true, reason: "ok" };
}

function getPlayerEntityByUsername(usernameToFind: string) {
  const needle = usernameToFind.toLowerCase();
  const player = Object.values(bot.players).find(
    (candidate) => candidate.username?.toLowerCase() === needle
  );
  return player?.entity;
}

function getDistanceToOwner(): { ok: true; distance: number } | { ok: false; reason: string } {
  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    return { ok: false, reason: readiness.reason };
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);
  if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
    return { ok: false, reason: "owner position unavailable" };
  }

  return {
    ok: true,
    distance: bot.entity.position.distanceTo(ownerEntity.position)
  };
}

function safeChat(message: string, reason: string, options?: { bypassRateLimit?: boolean }): boolean {
  if (!chatReady) {
    console.log(`[chat] skipped (${reason}): bot not ready to chat yet.`);
    return false;
  }

  const now = Date.now();
  const elapsedMs = now - lastChatSentAt;
  if (!options?.bypassRateLimit && elapsedMs < CHAT_MIN_INTERVAL_MS) {
    console.log(
      `[chat] skipped (${reason}): rate-limited (${elapsedMs}ms < ${CHAT_MIN_INTERVAL_MS}ms).`
    );
    return false;
  }

  try {
    bot.chat(message);
    lastChatSentAt = now;
    console.log(`[chat] send (${reason}): ${message}`);
    return true;
  } catch (error) {
    console.error(`[chat] send failed (${reason}):`, error);
    return false;
  }
}

function clearMovementState(reason: string): void {
  const previousMode = movementMode;
  const elapsedMs = movementStartedAt > 0 ? Date.now() - movementStartedAt : 0;
  const distanceInfo = getDistanceToOwner();
  const distanceLabel = distanceInfo.ok ? distanceInfo.distance.toFixed(2) : `unavailable (${distanceInfo.reason})`;

  if (movementTimeoutHandle) {
    clearTimeout(movementTimeoutHandle);
    movementTimeoutHandle = null;
  }

  followState.active = false;
  followState.targetUsername = null;
  movementMode = "idle";
  movementStartedAt = 0;
  stuckResetCount = 0;
  activeComeGoal = null;
  bot.pathfinder.stop();
  bot.pathfinder.setGoal(null);
  console.log(
    `[move] stopped mode=${previousMode} reason=${reason} elapsedMs=${elapsedMs} distance=${distanceLabel}`
  );
  console.log(`[move] Cleared movement state (${reason}).`);
}

function stopFollowing(reason: string): void {
  clearMovementState(reason);
}

function startComeTimeout(targetUsername: string): void {
  if (movementTimeoutHandle) {
    clearTimeout(movementTimeoutHandle);
  }

  movementTimeoutHandle = setTimeout(() => {
    if (movementMode !== "come") return;
    const distanceInfo = getDistanceToOwner();
    const distanceLabel = distanceInfo.ok ? distanceInfo.distance.toFixed(2) : `unavailable (${distanceInfo.reason})`;
    console.log(`[move] timeout: could not reach target in ${pathfinderTimeoutMs}ms. distance=${distanceLabel}`);
    clearMovementState("come-timeout");
    safeChat("I couldn't reach you safely.", "come-timeout", { bypassRateLimit: true });
  }, pathfinderTimeoutMs);

  console.log(`[move] come timeout started (${pathfinderTimeoutMs}ms) target=${targetUsername}`);
}

function markMovementStart(mode: MovementMode): void {
  movementMode = mode;
  movementStartedAt = Date.now();
  stuckResetCount = 0;
}

function getCurrentGoalDebugPosition(): string {
  if (movementMode === "come" && activeComeGoal) {
    return `comeGoal=(${activeComeGoal.x.toFixed(2)}, ${activeComeGoal.y.toFixed(
      2
    )}, ${activeComeGoal.z.toFixed(2)}) r=${activeComeGoal.radius}`;
  }

  if (movementMode === "follow") {
    const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);
    if (ownerEntity && isFinitePosition(ownerEntity.position)) {
      return `followOwner=${formatPosition(ownerEntity.position)} r=${followDistance}`;
    }
    return "followOwner=unavailable";
  }

  return "goal=none";
}

function scheduleRespawn(reason: string): void {
  const now = Date.now();
  if (respawnTimerActive) {
    console.log(`[life] Respawn already scheduled, skipping (${reason}).`);
    return;
  }
  if (now - lastRespawnRequestAt < RESPAWN_COOLDOWN_MS) {
    console.log(`[life] Respawn request on cooldown, skipping (${reason}).`);
    return;
  }

  respawnTimerActive = true;
  console.log("[life] Attempting respawn...");
  setTimeout(() => {
    respawnTimerActive = false;

    if (isBotAlive()) {
      console.log("[life] Respawn skipped: bot already alive.");
      return;
    }

    try {
      bot.respawn();
      lastRespawnRequestAt = Date.now();
      console.log("[life] Respawn requested.");
    } catch (error) {
      console.error("[life] Respawn request failed:", error);
    }
  }, RESPAWN_DELAY_MS);
}

async function handleSpawnReadiness(spawnLabel: string): Promise<void> {
  const generation = ++readyGeneration;
  movementReady = false;
  chatReady = false;

  const chatWarmupPromise = (async (): Promise<boolean> => {
    await sleep(SPAWN_ANNOUNCE_DELAY_MS);
    if (generation !== readyGeneration) {
      return false;
    }
    chatReady = true;
    console.log(`[chat] Chat ready after ${SPAWN_ANNOUNCE_DELAY_MS}ms warmup (${spawnLabel}).`);
    return true;
  })();

  console.log(`[life] Waiting for valid position after ${spawnLabel}...`);
  const hasValidPosition = await waitForValidPosition(POSITION_WAIT_TIMEOUT_MS);

  if (generation !== readyGeneration) {
    console.log(`[life] Position readiness check superseded (${spawnLabel}).`);
    return;
  }

  if (!hasValidPosition) {
    console.log(
      `[life] Position not ready after ${POSITION_WAIT_TIMEOUT_MS}ms (${spawnLabel}). raw=${JSON.stringify(
        bot.entity?.position
      )}`
    );
    return;
  }

  movementReady = true;
  console.log(`[life] Position ready after ${spawnLabel}: ${formatPosition(bot.entity.position)}`);

  if (!announceOnSpawn || hasAnnouncedOnline) {
    return;
  }

  const chatWarmupReady = await chatWarmupPromise;
  if (generation !== readyGeneration) {
    console.log("[chat] skipped (spawn-announce): readiness generation changed.");
    return;
  }
  if (!chatWarmupReady) {
    console.log("[chat] skipped (spawn-announce): chat warmup not ready.");
    return;
  }

  if (safeChat("EMBER is online.", "spawn-announce")) {
    hasAnnouncedOnline = true;
  }
}

function startFollowingOwner(requestor: string): void {
  console.log(`[move] Follow command received from "${requestor}".`);

  if (movementMode !== "idle") {
    clearMovementState("switch-to-follow");
  }

  if (!isOwner(requestor)) {
    safeChat("Only BIRevty can issue movement commands.", "follow-denied");
    return;
  }

  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    console.log(`[move] blocked: ${readiness.reason}`);
    safeChat("I respawned, but I am not ready to move yet.", "follow-not-ready");
    return;
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);
  if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
    console.log(
      `[move] Follow blocked: owner entity unavailable or invalid position: ${JSON.stringify(
        ownerEntity?.position
      )}`
    );
    safeChat("I can't see BIRevty right now.", "follow-no-owner");
    return;
  }

  const initialDistance = bot.entity.position.distanceTo(ownerEntity.position);
  console.log(`[move] follow distance=${initialDistance.toFixed(2)}`);
  if (initialDistance > maxFollowStartDistance) {
    console.log(
      `[move] distance blocked: follow start distance=${initialDistance.toFixed(
        2
      )} > MAX_FOLLOW_START_DISTANCE=${maxFollowStartDistance}`
    );
    safeChat("You are too far away for me to path safely yet.", "follow-too-far");
    return;
  }

  console.log(`[move] Owner entity position: ${formatPosition(ownerEntity.position)}`);
  console.log(`[move] Bot entity position before follow: ${formatPosition(bot.entity.position)}`);

  markMovementStart("follow");
  followState.active = true;
  followState.targetUsername = OWNER_USERNAME;
  bot.pathfinder.setGoal(new goals.GoalFollow(ownerEntity, followDistance), true);
  console.log(`[move] follow started with FOLLOW_DISTANCE=${followDistance}`);
  safeChat("Following BIRevty.", "follow-started");
}

function comeToOwner(requestor: string): void {
  console.log(`[move] Come command received from "${requestor}".`);

  if (movementMode !== "idle") {
    clearMovementState("switch-to-come");
  }

  if (!isOwner(requestor)) {
    safeChat("Only BIRevty can issue movement commands.", "come-denied");
    return;
  }

  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    console.log(`[move] blocked: ${readiness.reason}`);
    safeChat("I respawned, but I am not ready to move yet.", "come-not-ready");
    return;
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);
  if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
    console.log(
      `[move] Come blocked: owner entity unavailable or invalid position: ${JSON.stringify(
        ownerEntity?.position
      )}`
    );
    safeChat("I can't see BIRevty right now.", "come-no-owner");
    return;
  }

  const distance = bot.entity.position.distanceTo(ownerEntity.position);
  console.log(`[move] come distance=${distance.toFixed(2)}`);
  if (distance > maxComeDistance) {
    console.log(
      `[move] distance blocked: come distance=${distance.toFixed(2)} > MAX_COME_DISTANCE=${maxComeDistance}`
    );
    safeChat("You are too far away for me to path safely yet.", "come-too-far");
    return;
  }

  const { x, y, z } = ownerEntity.position;
  console.log(`[move] Owner entity position for come: ${formatPosition(ownerEntity.position)}`);
  console.log(`[move] Bot entity position before come: ${formatPosition(bot.entity.position)}`);
  console.log(`[move] come goal radius=${comeGoalRadius}`);

  markMovementStart("come");
  activeComeGoal = { x, y, z, radius: comeGoalRadius };
  followState.active = false;
  followState.targetUsername = null;
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, comeGoalRadius), false);
  startComeTimeout(OWNER_USERNAME);
  safeChat("Coming to BIRevty.", "come-started");
}

function requestManualRespawn(requestor: string): void {
  console.log(`[life] Manual respawn command received from "${requestor}".`);

  if (!isOwner(requestor)) {
    safeChat("Only BIRevty can issue movement commands.", "respawn-denied");
    return;
  }

  if (isBotAlive()) {
    safeChat("I am already alive.", "respawn-already-alive");
    return;
  }

  scheduleRespawn("manual command");
  safeChat("Respawn requested.", "respawn-manual-requested");
}

function sendStatus(): void {
  const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";
  const entity = bot.entity;

  if (!entity || !isFinitePosition(entity.position)) {
    console.log("[status] Invalid bot position:", entity?.position);
    safeChat(`Status: position unavailable, hp=${hp}`, "status-unavailable");
    return;
  }

  const { x, y, z } = entity.position;
  safeChat(`Status: pos=(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}), hp=${hp}`, "status-ok");
}

function sendWhereAreYou(): void {
  const dimension = bot.game?.dimension ?? "unknown";
  const world = bot.game?.levelType ?? "unknown";
  const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";
  const entity = bot.entity;

  if (!entity || !isFinitePosition(entity.position)) {
    safeChat(`I'm at an unknown position. dim=${dimension}, world=${world}, hp=${hp}`, "where-unavailable");
    return;
  }

  safeChat(
    `I am at (${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}, ${entity.position.z.toFixed(
      1
    )}) in ${dimension} (world=${world}), hp=${hp}.`,
    "where-ok"
  );
}

function sendDistanceToOwner(): void {
  const distanceInfo = getDistanceToOwner();
  if (!distanceInfo.ok) {
    console.log(`[move] distance command unavailable: ${distanceInfo.reason}`);
    safeChat("Distance unavailable right now.", "distance-unavailable");
    return;
  }

  safeChat(`Distance to BIRevty: ${distanceInfo.distance.toFixed(1)} blocks.`, "distance-ok");
}

bot.once("spawn", () => {
  const movement = new Movements(bot);
  movement.canDig = false;
  movement.canOpenDoors = false;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.maxDropDown = 2;
  movement.infiniteLiquidDropdownDistance = false;
  movement.allowFreeMotion = true;
  bot.pathfinder.setMovements(movement);
  console.log("[move] conservative movement profile applied.");
});

bot.on("login", () => {
  console.log(`[connect] Logged in as ${bot.username} -> ${host}:${port}`);
});

bot.on("spawn", () => {
  spawnCount += 1;
  const spawnLabel =
    spawnCount === 1
      ? "first spawn after login"
      : diedSinceLastSpawn
        ? "respawn after death"
        : "additional spawn event";

  console.log(`[connect] Bot spawned in world (${spawnLabel}).`);
  diedSinceLastSpawn = false;

  void handleSpawnReadiness(spawnLabel);
});

bot.on("respawn", () => {
  console.log("[life] Respawn packet/event received.");
});

bot.on("death", () => {
  deathCount += 1;
  diedSinceLastSpawn = true;
  movementReady = false;
  chatReady = false;

  console.log("[life] Bot died.");
  console.log(`[life] Death count=${deathCount}`);
  stopFollowing("death");
  scheduleRespawn("death event");
});

bot.on("goal_reached", (goal) => {
  console.log(`[pathfinder] goal_reached: ${goal?.constructor?.name ?? "unknown"}`);
  const distanceInfo = getDistanceToOwner();
  if (distanceInfo.ok) {
    console.log(`[move] current distance=${distanceInfo.distance.toFixed(2)}`);
  }

  if (movementMode === "come") {
    clearMovementState("come-goal-reached");
  }
});

bot.on("path_update", (result: PartiallyComputedPath) => {
  const status = result?.status ?? "unknown";
  const pathLength = Array.isArray(result?.path) ? result.path.length : 0;
  const timeMs = typeof result?.time === "number" ? result.time.toFixed(0) : "n/a";
  const now = Date.now();
  const shouldLog =
    status !== lastPathUpdateStatus || now - lastPathUpdateLogAt >= PATH_UPDATE_LOG_INTERVAL_MS;

  if (shouldLog) {
    lastPathUpdateStatus = status;
    lastPathUpdateLogAt = now;
    console.log(`[pathfinder] path_update: status=${status} steps=${pathLength} timeMs=${timeMs}`);
  }
});

bot.on("path_reset", (reason) => {
  console.log(`[pathfinder] path_reset: reason=${String(reason)}`);

  if (reason !== "stuck") return;
  if (movementMode === "idle") return;

  stuckResetCount += 1;
  const botPos = isFinitePosition(bot.entity?.position) ? formatPosition(bot.entity.position) : "unavailable";
  const goalPos = getCurrentGoalDebugPosition();
  const distanceInfo = getDistanceToOwner();
  const distanceLabel = distanceInfo.ok ? distanceInfo.distance.toFixed(2) : `unavailable (${distanceInfo.reason})`;

  console.log(
    `[move] stuck reset ${stuckResetCount}/${stuckResetLimit} mode=${movementMode} bot=${botPos} ${goalPos} distance=${distanceLabel}`
  );

  if (stuckResetCount < stuckResetLimit) {
    return;
  }

  console.log(
    `[move] stuck limit reached. stopping movement. stuckCount=${stuckResetCount} bot=${botPos} ${goalPos}`
  );
  clearMovementState("stuck-limit-reached");
  safeChat("I'm stuck and stopped moving.", "stuck-limit", { bypassRateLimit: true });
});

bot.on("path_stop", () => {
  console.log("[pathfinder] path_stop");
});

// Some pathfinder builds emit additional movement-failure events.
const botRuntimeEvents = bot as unknown as {
  on: (eventName: string, listener: (...args: unknown[]) => void) => void;
};

botRuntimeEvents.on("stuck", (...args: unknown[]) => {
  console.log("[pathfinder] stuck event:", ...args);
});

botRuntimeEvents.on("cannot_find", (...args: unknown[]) => {
  console.log("[pathfinder] cannot_find event:", ...args);
});

bot.on("end", (reason) => {
  console.log(`[disconnect] Connection ended: ${reason ?? "unknown"}`);
  if (kickedForChatValidation) {
    console.error("[connect] Exiting process due to chat validation kick; Docker should restart the service.");
    process.exit(1);
  }
});

bot.on("kicked", (reason, loggedIn) => {
  const reasonText = JSON.stringify(reason);
  console.error(`[kick] loggedIn=${loggedIn} reason=${reasonText}`);

  if (reasonText.includes("multiplayer.disconnect.chat_validation_failed")) {
    kickedForChatValidation = true;
    console.error("[kick] Detected chat validation failure kick. Quitting so Docker can restart cleanly.");
    stopFollowing("chat-validation-kick");
    bot.quit("chat validation failed");
  }
});

bot.on("error", (err) => {
  console.error("[error]", err);
});

bot.on("chat", (chatUsername, message) => {
  if (chatUsername === bot.username) return;

  const normalized = message.trim().toLowerCase();
  const ownerCommand = isOwner(chatUsername);

  if (normalized === "ember hello") {
    safeChat("Hello. I'm here.", "hello");
    return;
  }

  if (normalized === "ember status") {
    sendStatus();
    return;
  }

  if (normalized === "ember where are you") {
    sendWhereAreYou();
    return;
  }

  if (normalized === "ember distance") {
    if (!ownerCommand) {
      safeChat("Only BIRevty can issue movement commands.", "distance-denied");
      return;
    }
    sendDistanceToOwner();
    return;
  }

  if (normalized === "ember follow me") {
    if (!ownerCommand) {
      safeChat("Only BIRevty can issue movement commands.", "follow-denied");
      return;
    }
    startFollowingOwner(chatUsername);
    return;
  }

  if (normalized === "ember come") {
    if (!ownerCommand) {
      safeChat("Only BIRevty can issue movement commands.", "come-denied");
      return;
    }
    comeToOwner(chatUsername);
    return;
  }

  if (normalized === "ember respawn") {
    if (!ownerCommand) {
      safeChat("Only BIRevty can issue movement commands.", "respawn-denied");
      return;
    }
    requestManualRespawn(chatUsername);
    return;
  }

  if (normalized === "ember stop") {
    if (!ownerCommand) {
      safeChat("Only BIRevty can issue movement commands.", "stop-denied");
      return;
    }
    stopFollowing("stop command");
    safeChat("Stopping.", "stop");
  }
});

bot.on("physicTick", () => {
  if (!followState.active || !followState.targetUsername) return;

  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    console.log(`[move] Follow paused: ${readiness.reason}`);
    stopFollowing("follow-paused-not-ready");
    return;
  }

  const target = getPlayerEntityByUsername(followState.targetUsername);
  if (!target || !isFinitePosition(target.position)) {
    console.log("[move] Follow stopped: target entity no longer available.");
    stopFollowing("target-unavailable");
    return;
  }

  const currentDistance = bot.entity.position.distanceTo(target.position);
  if (currentDistance <= followDistance + 1) {
    return;
  }

  const currentGoal = bot.pathfinder.goal;
  const needsGoalRefresh =
    !(currentGoal instanceof goals.GoalFollow) || (currentGoal as { entity?: unknown }).entity !== target;
  if (needsGoalRefresh) {
    console.log(`[move] follow refresh: distance=${currentDistance.toFixed(2)} target moved.`);
    bot.pathfinder.setGoal(new goals.GoalFollow(target, followDistance), true);
  }
});

function shutdown(signal: string): void {
  console.log(`[shutdown] Received ${signal}, quitting bot...`);
  stopFollowing("shutdown");
  bot.quit("Shutting down");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
