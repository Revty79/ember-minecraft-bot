import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import mineflayer from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";

dotenv.config();

const OWNER_USERNAME = "BIRevty";
const PROFILES_FOLDER = path.resolve(process.cwd(), "data");

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

type FollowState = {
  active: boolean;
  targetUsername: string | null;
};

const host = readEnv("MINECRAFT_HOST", "10.0.0.218");
const port = readPort("MINECRAFT_PORT", 25565);
const username = readEnv("MINECRAFT_USERNAME");
const auth = readEnv("MINECRAFT_AUTH", "microsoft");
const version = process.env.MINECRAFT_VERSION?.trim() || undefined;

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

const ownerLower = OWNER_USERNAME.toLowerCase();

if (version) {
  console.log(`[connect] Requested Minecraft protocol version: ${version}`);
}

function isOwner(usernameToCheck: string): boolean {
  return usernameToCheck.toLowerCase() === ownerLower;
}

function isFinitePosition(position: Vec3 | undefined): boolean {
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

function getBotPositionReadiness(): { ready: boolean; reason: string } {
  if (!bot.entity) {
    return { ready: false, reason: "bot.entity is missing" };
  }
  if (!isFinitePosition(bot.entity.position)) {
    return {
      ready: false,
      reason: `bot.entity.position is invalid: ${JSON.stringify(bot.entity.position)}`
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

function stopFollowing(): void {
  followState.active = false;
  followState.targetUsername = null;
  bot.pathfinder.stop();
  bot.pathfinder.setGoal(null);
}

function startFollowingOwner(requestor: string): void {
  console.log(`[move] Follow command received from "${requestor}".`);

  if (!isOwner(requestor)) {
    bot.chat("Only BIRevty can issue movement commands.");
    return;
  }

  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    console.log(`[move] Follow blocked: ${readiness.reason}`);
    bot.chat("I am online, but my position is not ready yet.");
    return;
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);

  if (!ownerEntity) {
    console.log("[move] Follow blocked: owner entity not visible.");
    bot.chat("I can't see BIRevty right now.");
    return;
  }

  console.log(`[move] Owner entity position: ${formatPosition(ownerEntity.position)}`);
  console.log(`[move] Bot entity position before follow: ${formatPosition(bot.entity.position)}`);

  followState.active = true;
  followState.targetUsername = OWNER_USERNAME;
  bot.pathfinder.setGoal(new goals.GoalFollow(ownerEntity, 2), true);
  bot.chat("Following BIRevty.");
}

function comeToOwner(requestor: string): void {
  console.log(`[move] Come command received from "${requestor}".`);

  if (!isOwner(requestor)) {
    bot.chat("Only BIRevty can issue movement commands.");
    return;
  }

  const readiness = getBotPositionReadiness();
  if (!readiness.ready) {
    console.log(`[move] Come blocked: ${readiness.reason}`);
    bot.chat("I am online, but my position is not ready yet.");
    return;
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);
  if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
    console.log(
      `[move] Come blocked: owner entity unavailable or invalid position: ${JSON.stringify(
        ownerEntity?.position
      )}`
    );
    bot.chat("I can't see BIRevty right now.");
    return;
  }

  const { x, y, z } = ownerEntity.position;
  console.log(`[move] Owner entity position for come: ${formatPosition(ownerEntity.position)}`);
  console.log(`[move] Bot entity position before come: ${formatPosition(bot.entity.position)}`);
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1), false);
  bot.chat("Coming to BIRevty.");
}

function sendStatus(): void {
  const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";
  const entity = bot.entity;

  if (!entity || !isFinitePosition(entity.position)) {
    console.log("[status] Invalid bot position:", entity?.position);
    bot.chat(`Status: position unavailable, hp=${hp}`);
    return;
  }

  const { x, y, z } = entity.position;
  bot.chat(`Status: pos=(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}), hp=${hp}`);
}

bot.once("spawn", () => {
  const movement = new Movements(bot);
  movement.canDig = false;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  bot.pathfinder.setMovements(movement);
});

bot.on("login", () => {
  console.log(`[connect] Logged in as ${bot.username} -> ${host}:${port}`);
});

bot.on("spawn", () => {
  console.log("[connect] Bot spawned in world.");
  bot.chat("EMBER is online.");
});

bot.on("goal_reached", (goal) => {
  console.log(`[pathfinder] goal_reached: ${goal?.constructor?.name ?? "unknown"}`);
});

bot.on("path_update", (result: { status?: string; path?: Array<unknown>; time?: number }) => {
  const status = result?.status ?? "unknown";
  const pathLength = Array.isArray(result?.path) ? result.path.length : 0;
  const timeMs = typeof result?.time === "number" ? result.time.toFixed(0) : "n/a";
  console.log(`[pathfinder] path_update: status=${status} steps=${pathLength} timeMs=${timeMs}`);
});

bot.on("path_reset", (reason: unknown) => {
  console.log(`[pathfinder] path_reset: reason=${String(reason)}`);
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
});

bot.on("kicked", (reason, loggedIn) => {
  console.error(`[kick] loggedIn=${loggedIn} reason=${JSON.stringify(reason)}`);
});

bot.on("error", (err) => {
  console.error("[error]", err);
});

bot.on("chat", (chatUsername, message) => {
  if (chatUsername === bot.username) return;

  const normalized = message.trim().toLowerCase();
  const ownerCommand = isOwner(chatUsername);

  if (normalized === "ember hello") {
    bot.chat("Hello. I'm here.");
    return;
  }

  if (normalized === "ember status") {
    sendStatus();
    return;
  }

  if (normalized === "ember follow me") {
    if (!ownerCommand) {
      bot.chat("Only BIRevty can issue movement commands.");
      return;
    }
    startFollowingOwner(chatUsername);
    return;
  }

  if (normalized === "ember come") {
    if (!ownerCommand) {
      bot.chat("Only BIRevty can issue movement commands.");
      return;
    }
    comeToOwner(chatUsername);
    return;
  }

  if (normalized === "ember stop") {
    if (!ownerCommand) {
      bot.chat("Only BIRevty can issue movement commands.");
      return;
    }
    stopFollowing();
    bot.chat("Stopping.");
  }
});

bot.on("physicTick", () => {
  if (!followState.active || !followState.targetUsername) return;
  const target = getPlayerEntityByUsername(followState.targetUsername);
  if (!target) {
    console.log("[move] Follow stopped: target entity no longer available.");
    stopFollowing();
    return;
  }
  const currentGoal = bot.pathfinder.goal;
  const needsGoalRefresh =
    !(currentGoal instanceof goals.GoalFollow) || (currentGoal as { entity?: unknown }).entity !== target;
  if (needsGoalRefresh) {
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
  }
});

function shutdown(signal: string): void {
  console.log(`[shutdown] Received ${signal}, quitting bot...`);
  stopFollowing();
  bot.quit("Shutting down");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
