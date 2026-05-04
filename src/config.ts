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
  allowEating: boolean;
  allowEquip: boolean;
  allowFlee: boolean;
  allowHarvest: boolean;
  allowCropHarvest: boolean;
  allowWander: boolean;
  replantCrops: boolean;
  requireMatureCrops: boolean;
  mineOwnerOnly: boolean;
  harvestOwnerOnly: boolean;
  wanderOwnerOnly: boolean;
  wanderCenterMode: "home";
  profilesFolder: string;

  maxComeDistance: number;
  maxFollowStartDistance: number;
  comeGoalRadius: number;
  followDistance: number;
  pathfinderTimeoutMs: number;
  stuckResetLimit: number;

  dangerScanIntervalMs: number;
  hostileDangerRadius: number;
  hostileStopRadius: number;
  stopOnDanger: boolean;

  minGoalRefreshDistance: number;
  followRepathIntervalMs: number;
  movementProgressCheckMs: number;
  minProgressDistance: number;
  notReadyChatCooldownMs: number;
  invalidPositionRecoveryMs: number;
  stateLogOnlyOnChange: boolean;
  homeFilePath: string;
  fleeDistance: number;
  fleeHomeRadius: number;
  fleeToHome: boolean;
  fleeToOwner: boolean;
  miningMaxDistance: number;
  miningTimeoutMs: number;
  miningAllowedBlocks: string[];
  miningForbiddenBlocks: string[];
  requireToolForStone: boolean;
  requireToolForOres: boolean;
  lowHealthStopThreshold: number;
  lowFoodEatThreshold: number;
  homeProtectionRadius: number;
  harvestMaxDistance: number;
  harvestTimeoutMs: number;
  harvestAllowedBlocks: string[];
  harvestForbiddenBlocks: string[];
  minePreviewMaxDistance: number;
  blockTargetRaycastDistance: number;
  wanderRadius: number;
  wanderMaxDurationMs: number;
  wanderStepRadius: number;
  wanderPauseMs: number;
  wanderMaxSteps: number;
  wanderStopOnDanger: boolean;
  wanderStopOnLowHealth: boolean;
  wanderLowHealthThreshold: number;
  wanderStopOnLowFood: boolean;
  wanderLowFoodThreshold: number;
  wanderAllowMining: boolean;
  wanderAllowHarvest: boolean;
  wanderAllowCombat: boolean;
  wanderAllowBuilding: boolean;
  wanderAllowContainers: boolean;
  wanderRequireHome: boolean;
  wanderRespectHomeProtection: boolean;

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

function readCsvList(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  const raw = value && value.length > 0 ? value : fallback.join(",");
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
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
  const allowEating = readBoolean("ALLOW_EATING", false);
  const allowEquip = readBoolean("ALLOW_EQUIP", false);
  const allowFlee = readBoolean("ALLOW_FLEE", true);
  const allowHarvest = readBoolean("ALLOW_HARVEST", false);
  const allowCropHarvest = readBoolean("ALLOW_CROP_HARVEST", false);
  const allowWander = readBoolean("ALLOW_WANDER", false);
  const replantCrops = readBoolean("REPLANT_CROPS", false);
  const requireMatureCrops = readBoolean("REQUIRE_MATURE_CROPS", true);
  const mineOwnerOnly = readBoolean("MINE_OWNER_ONLY", true);
  const harvestOwnerOnly = readBoolean("HARVEST_OWNER_ONLY", true);
  const wanderOwnerOnly = readBoolean("WANDER_OWNER_ONLY", true);
  const wanderCenterModeRaw = readEnv("WANDER_CENTER_MODE", "home").toLowerCase();
  if (wanderCenterModeRaw !== "home") {
    throw new Error(`Invalid WANDER_CENTER_MODE "${wanderCenterModeRaw}". Supported: home`);
  }
  const wanderCenterMode: "home" = "home";

  const maxComeDistance = readNumber("MAX_COME_DISTANCE", 40, 1);
  const maxFollowStartDistance = readNumber("MAX_FOLLOW_START_DISTANCE", 40, 1);
  const comeGoalRadius = readNumber("COME_GOAL_RADIUS", 3, 1);
  const followDistance = readNumber("FOLLOW_DISTANCE", 3, 1);
  const pathfinderTimeoutMs = readInteger("PATHFINDER_TIMEOUT_MS", 15000, 1000);
  const stuckResetLimit = readInteger("STUCK_RESET_LIMIT", 3, 1);

  const dangerScanIntervalMs = readInteger("DANGER_SCAN_INTERVAL_MS", 3000, 250);
  const hostileDangerRadius = readNumber("HOSTILE_DANGER_RADIUS", 10, 1);
  const hostileStopRadius = readNumber("HOSTILE_STOP_RADIUS", 4, 1);
  const stopOnDanger = readBoolean("STOP_ON_DANGER", true);

  const minGoalRefreshDistance = readNumber("MIN_GOAL_REFRESH_DISTANCE", 2, 0.1);
  const followRepathIntervalMs = readInteger("FOLLOW_REPATH_INTERVAL_MS", 1500, 100);
  const movementProgressCheckMs = readInteger("MOVEMENT_PROGRESS_CHECK_MS", 2000, 250);
  const minProgressDistance = readNumber("MIN_PROGRESS_DISTANCE", 0.5, 0.01);
  const notReadyChatCooldownMs = readInteger("NOT_READY_CHAT_COOLDOWN_MS", 10000, 0);
  const invalidPositionRecoveryMs = readInteger("INVALID_POSITION_RECOVERY_MS", 5000, 1000);
  const stateLogOnlyOnChange = readBoolean("STATE_LOG_ONLY_ON_CHANGE", true);
  const homeFilePath = path.resolve(process.cwd(), readEnv("HOME_FILE_PATH", "./data/home.json"));
  const fleeDistance = readNumber("FLEE_DISTANCE", 12, 1);
  const fleeHomeRadius = readNumber("FLEE_HOME_RADIUS", 6, 1);
  const fleeToHome = readBoolean("FLEE_TO_HOME", true);
  const fleeToOwner = readBoolean("FLEE_TO_OWNER", true);
  const miningMaxDistance = readNumber("MINING_MAX_DISTANCE", 5, 1);
  const miningTimeoutMs = readInteger("MINING_TIMEOUT_MS", 10000, 1000);
  const miningAllowedBlocks = readCsvList("MINING_ALLOWED_BLOCKS", [
    "dirt",
    "grass_block",
    "snow",
    "stone",
    "coal_ore",
    "copper_ore",
    "iron_ore"
  ]);
  const miningForbiddenBlocks = readCsvList("MINING_FORBIDDEN_BLOCKS", [
    "bedrock",
    "water",
    "lava",
    "fire",
    "chest",
    "barrel",
    "furnace",
    "crafting_table",
    "door",
    "trapdoor"
  ]);
  const requireToolForStone = readBoolean("REQUIRE_TOOL_FOR_STONE", true);
  const requireToolForOres = readBoolean("REQUIRE_TOOL_FOR_ORES", true);
  const lowHealthStopThreshold = readNumber("LOW_HEALTH_STOP_THRESHOLD", 8, 1);
  const lowFoodEatThreshold = readNumber("LOW_FOOD_EAT_THRESHOLD", 14, 1);
  const homeProtectionRadius = readNumber("HOME_PROTECTION_RADIUS", 6, 0);
  const harvestMaxDistance = readNumber("HARVEST_MAX_DISTANCE", 5, 1);
  const harvestTimeoutMs = readInteger("HARVEST_TIMEOUT_MS", 10000, 1000);
  const harvestAllowedBlocks = readCsvList("HARVEST_ALLOWED_BLOCKS", [
    "grass",
    "fern",
    "tall_grass",
    "wheat",
    "carrots",
    "potatoes",
    "beetroots",
    "pumpkin",
    "melon"
  ]);
  const harvestForbiddenBlocks = readCsvList("HARVEST_FORBIDDEN_BLOCKS", [
    "chest",
    "barrel",
    "furnace",
    "crafting_table",
    "door",
    "trapdoor",
    "bedrock",
    "water",
    "lava",
    "fire"
  ]);
  const minePreviewMaxDistance = readNumber("MINE_PREVIEW_MAX_DISTANCE", 5, 1);
  const blockTargetRaycastDistance = readNumber("BLOCK_TARGET_RAYCAST_DISTANCE", 5, 1);
  const wanderRadius = readNumber("WANDER_RADIUS", 8, 1);
  const wanderMaxDurationMs = readInteger("WANDER_MAX_DURATION_MS", 30000, 1000);
  const wanderStepRadius = readNumber("WANDER_STEP_RADIUS", 4, 1);
  const wanderPauseMs = readInteger("WANDER_PAUSE_MS", 2000, 0);
  const wanderMaxSteps = readInteger("WANDER_MAX_STEPS", 8, 1);
  const wanderStopOnDanger = readBoolean("WANDER_STOP_ON_DANGER", true);
  const wanderStopOnLowHealth = readBoolean("WANDER_STOP_ON_LOW_HEALTH", true);
  const wanderLowHealthThreshold = readNumber("WANDER_LOW_HEALTH_THRESHOLD", 10, 1);
  const wanderStopOnLowFood = readBoolean("WANDER_STOP_ON_LOW_FOOD", true);
  const wanderLowFoodThreshold = readNumber("WANDER_LOW_FOOD_THRESHOLD", 8, 0);
  const wanderAllowMining = readBoolean("WANDER_ALLOW_MINING", false);
  const wanderAllowHarvest = readBoolean("WANDER_ALLOW_HARVEST", false);
  const wanderAllowCombat = readBoolean("WANDER_ALLOW_COMBAT", false);
  const wanderAllowBuilding = readBoolean("WANDER_ALLOW_BUILDING", false);
  const wanderAllowContainers = readBoolean("WANDER_ALLOW_CONTAINERS", false);
  const wanderRequireHome = readBoolean("WANDER_REQUIRE_HOME", true);
  const wanderRespectHomeProtection = readBoolean("WANDER_RESPECT_HOME_PROTECTION", true);

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
    allowEating,
    allowEquip,
    allowFlee,
    allowHarvest,
    allowCropHarvest,
    allowWander,
    replantCrops,
    requireMatureCrops,
    mineOwnerOnly,
    harvestOwnerOnly,
    wanderOwnerOnly,
    wanderCenterMode,
    profilesFolder: path.resolve(process.cwd(), "data"),
    maxComeDistance,
    maxFollowStartDistance,
    comeGoalRadius,
    followDistance,
    pathfinderTimeoutMs,
    stuckResetLimit,
    dangerScanIntervalMs,
    hostileDangerRadius,
    hostileStopRadius,
    stopOnDanger,
    minGoalRefreshDistance,
    followRepathIntervalMs,
    movementProgressCheckMs,
    minProgressDistance,
    notReadyChatCooldownMs,
    invalidPositionRecoveryMs,
    stateLogOnlyOnChange,
    homeFilePath,
    fleeDistance,
    fleeHomeRadius,
    fleeToHome,
    fleeToOwner,
    miningMaxDistance,
    miningTimeoutMs,
    miningAllowedBlocks,
    miningForbiddenBlocks,
    requireToolForStone,
    requireToolForOres,
    lowHealthStopThreshold,
    lowFoodEatThreshold,
    homeProtectionRadius,
    harvestMaxDistance,
    harvestTimeoutMs,
    harvestAllowedBlocks,
    harvestForbiddenBlocks,
    minePreviewMaxDistance,
    blockTargetRaycastDistance,
    wanderRadius,
    wanderMaxDurationMs,
    wanderStepRadius,
    wanderPauseMs,
    wanderMaxSteps,
    wanderStopOnDanger,
    wanderStopOnLowHealth,
    wanderLowHealthThreshold,
    wanderStopOnLowFood,
    wanderLowFoodThreshold,
    wanderAllowMining,
    wanderAllowHarvest,
    wanderAllowCombat,
    wanderAllowBuilding,
    wanderAllowContainers,
    wanderRequireHome,
    wanderRespectHomeProtection,
    chatMinIntervalMs,
    spawnAnnounceDelayMs,
    positionWaitTimeoutMs,
    respawnDelayMs,
    respawnCooldownMs,
    pathUpdateLogIntervalMs,
    aiBridgeTimeoutMs
  };
}
