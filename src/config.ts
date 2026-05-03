import path from "node:path";

export interface AppConfig {
  minecraftHost: string;
  minecraftPort: number;
  minecraftUsername: string;
  minecraftAuth: "microsoft";
  minecraftVersion?: string;
  announceOnSpawn: boolean;
  ownerUsername: string;
  enableAiBridge: boolean;
  aiBridgeUrl?: string;
  observationIntervalMs: number;
  stateLogIntervalMs: number;
  maxChatLength: number;
  maxActionsPerMinute: number;
  allowMining: boolean;
  allowCombat: boolean;
  allowBuilding: boolean;
  allowInventory: boolean;
  profilesFolder: string;

  // v0.4 movement defaults kept for compatibility.
  maxComeDistance: number;
  maxFollowStartDistance: number;
  comeGoalRadius: number;
  followDistance: number;
  pathfinderTimeoutMs: number;
  stuckResetLimit: number;

  // Internal hardening knobs.
  chatMinIntervalMs: number;
  spawnAnnounceDelayMs: number;
  positionWaitTimeoutMs: number;
  respawnDelayMs: number;
  respawnCooldownMs: number;
  pathUpdateLogIntervalMs: number;
  aiBridgeTimeoutMs: number;
}

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function readPort(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port value for ${name}: "${value}"`);
  }
  return parsed;
}

function readNumber(name: string, fallback: number, min?: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${name}: "${value}"`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`Invalid numeric value for ${name}: "${value}" (must be >= ${min})`);
  }
  return parsed;
}

function readInteger(name: string, fallback: number, min?: number): number {
  const parsed = readNumber(name, fallback, min);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value for ${name}: "${parsed}"`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const normalized = value.toLowerCase();

  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new Error(`Invalid boolean value for ${name}: "${value}"`);
}

export function loadConfig(): AppConfig {
  const minecraftHost = readEnv("MINECRAFT_HOST", "10.0.0.218");
  const minecraftPort = readPort("MINECRAFT_PORT", 25565);
  const minecraftUsername = readEnv("MINECRAFT_USERNAME");
  const minecraftAuthRaw = readEnv("MINECRAFT_AUTH", "microsoft");
  const minecraftVersion = process.env.MINECRAFT_VERSION?.trim() || undefined;
  const announceOnSpawn = readBoolean("ANNOUNCE_ON_SPAWN", true);
  const ownerUsername = readEnv("OWNER_USERNAME", "BIRevty");
  const enableAiBridge = readBoolean("ENABLE_AI_BRIDGE", false);
  const aiBridgeUrl = process.env.AI_BRIDGE_URL?.trim() || "http://127.0.0.1:3004/api/minecraft";
  const observationIntervalMs = readInteger("OBSERVATION_INTERVAL_MS", 5000, 250);
  const stateLogIntervalMs = readInteger("STATE_LOG_INTERVAL_MS", 10000, 1000);
  const maxChatLength = readInteger("MAX_CHAT_LENGTH", 220, 8);
  const maxActionsPerMinute = readInteger("MAX_ACTIONS_PER_MINUTE", 20, 1);
  const allowMining = readBoolean("ALLOW_MINING", false);
  const allowCombat = readBoolean("ALLOW_COMBAT", false);
  const allowBuilding = readBoolean("ALLOW_BUILDING", false);
  const allowInventory = readBoolean("ALLOW_INVENTORY", false);

  const maxComeDistance = readNumber("MAX_COME_DISTANCE", 40, 1);
  const maxFollowStartDistance = readNumber("MAX_FOLLOW_START_DISTANCE", 40, 1);
  const comeGoalRadius = readNumber("COME_GOAL_RADIUS", 3, 1);
  const followDistance = readNumber("FOLLOW_DISTANCE", 3, 1);
  const pathfinderTimeoutMs = readInteger("PATHFINDER_TIMEOUT_MS", 15000, 1000);
  const stuckResetLimit = readInteger("STUCK_RESET_LIMIT", 3, 1);

  const chatMinIntervalMs = readInteger("CHAT_MIN_INTERVAL_MS", 1200, 0);
  const spawnAnnounceDelayMs = readInteger("SPAWN_ANNOUNCE_DELAY_MS", 3000, 0);
  const positionWaitTimeoutMs = readInteger("POSITION_WAIT_TIMEOUT_MS", 15000, 1000);
  const respawnDelayMs = readInteger("RESPAWN_DELAY_MS", 1500, 100);
  const respawnCooldownMs = readInteger("RESPAWN_COOLDOWN_MS", 5000, 100);
  const pathUpdateLogIntervalMs = readInteger("PATH_UPDATE_LOG_INTERVAL_MS", 2500, 0);
  const aiBridgeTimeoutMs = readInteger("AI_BRIDGE_TIMEOUT_MS", 4000, 250);

  if (minecraftAuthRaw !== "microsoft") {
    throw new Error(
      `Unsupported MINECRAFT_AUTH "${minecraftAuthRaw}". This service currently supports only "microsoft".`
    );
  }

  if (enableAiBridge && !aiBridgeUrl) {
    throw new Error("AI_BRIDGE_URL is required when ENABLE_AI_BRIDGE=true");
  }

  return {
    minecraftHost,
    minecraftPort,
    minecraftUsername,
    minecraftAuth: "microsoft",
    minecraftVersion,
    announceOnSpawn,
    ownerUsername,
    enableAiBridge,
    aiBridgeUrl,
    observationIntervalMs,
    stateLogIntervalMs,
    maxChatLength,
    maxActionsPerMinute,
    allowMining,
    allowCombat,
    allowBuilding,
    allowInventory,
    profilesFolder: path.resolve(process.cwd(), "data"),
    maxComeDistance,
    maxFollowStartDistance,
    comeGoalRadius,
    followDistance,
    pathfinderTimeoutMs,
    stuckResetLimit,
    chatMinIntervalMs,
    spawnAnnounceDelayMs,
    positionWaitTimeoutMs,
    respawnDelayMs,
    respawnCooldownMs,
    pathUpdateLogIntervalMs,
    aiBridgeTimeoutMs
  };
}
