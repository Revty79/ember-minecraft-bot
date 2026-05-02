import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import mineflayer from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";

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

function isOwner(usernameToCheck: string): boolean {
  return usernameToCheck.toLowerCase() === ownerLower;
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
  if (!isOwner(requestor)) {
    bot.chat("Only BIRevty can issue movement commands.");
    return;
  }

  const ownerEntity = getPlayerEntityByUsername(OWNER_USERNAME);

  if (!ownerEntity) {
    bot.chat("I can't see BIRevty right now.");
    return;
  }

  followState.active = true;
  followState.targetUsername = OWNER_USERNAME;
  bot.pathfinder.setGoal(new goals.GoalFollow(ownerEntity, 2), true);
  bot.chat("Following BIRevty.");
}

function sendStatus(): void {
  const entity = bot.entity;
  if (!entity) {
    bot.chat("Status unavailable right now.");
    return;
  }

  const { x, y, z } = entity.position;
  const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";
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
