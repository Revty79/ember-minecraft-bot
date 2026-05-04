import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import type { AppConfig } from "../config";
import { Vec3 } from "vec3";
import {
  getArmorSummary,
  getBestAxe,
  getBestPickaxe,
  getBestShovel,
  getEquipmentSummary,
  getFoodItems,
  getInventorySummary,
  pickBestFoodItem
} from "./inventory";
import type {
  ActionController,
  ActionQueueItem,
  ActionQueueSummary,
  AiBridgeStatus,
  BlockClass,
  BotAction,
  ChatController,
  DangerSummary,
  Logger,
  MovementController,
  MovementMode,
  PerceptionController,
  SafetyLayer,
  StateStore
} from "./types";

const MOVEMENT_ACTION_TYPES = new Set<BotAction["type"]>([
  "COME_TO_OWNER",
  "FOLLOW_OWNER",
  "STOP_MOVING",
  "GO_HOME",
  "SET_STAY_HOME",
  "FLEE_DANGER",
  "WANDER_SAFE",
  "MINE_BLOCK",
  "HARVEST_BLOCK",
  "STOP_WANDER",
  "STOP_MINING",
  "STOP_HARVEST",
  "LOOK_AT_OWNER"
]);

const SCAFFOLDED_CAPABILITY_ACTIONS = new Set<BotAction["type"]>([
  "ATTACK_ENTITY",
  "PLACE_BLOCK",
  "CRAFT_ITEM",
  "OPEN_INVENTORY"
]);

const HARVEST_HOME_EXEMPT_BLOCKS = new Set<string>(["grass", "short_grass", "tall_grass", "fern", "large_fern"]);
const HARVEST_GRASS_BLOCKS = new Set<string>(["grass", "short_grass", "tall_grass", "fern", "large_fern"]);
const CROP_MATURITY_AGES: Record<string, number> = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3
};

type TargetBlockInfo = {
  block: NonNullable<ReturnType<Bot["blockAt"]>>;
  name: string;
  position: Vec3;
  distance: number;
  classification: BlockClass;
};

type ActionValidation = {
  allowed: boolean;
  reason: string;
  code: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeAction(action: BotAction): string {
  switch (action.type) {
    case "CHAT":
      return `CHAT(${action.reason ?? "chat"})`;
    case "COME_TO_OWNER":
      return "COME_TO_OWNER";
    case "FOLLOW_OWNER":
      return "FOLLOW_OWNER";
    case "STOP_MOVING":
      return "STOP_MOVING";
    case "RESPAWN":
      return "RESPAWN";
    case "LOOK_AT_OWNER":
      return "LOOK_AT_OWNER";
    case "SET_HOME":
      return "SET_HOME";
    case "GO_HOME":
      return "GO_HOME";
    case "SET_STAY_HOME":
      return "SET_STAY_HOME";
    case "FLEE_DANGER":
      return "FLEE_DANGER";
    case "WANDER_SAFE":
      return "WANDER_SAFE";
    case "MINE_BLOCK":
      return "MINE_BLOCK";
    case "STOP_WANDER":
      return "STOP_WANDER";
    case "STOP_MINING":
      return "STOP_MINING";
    case "HARVEST_BLOCK":
      return "HARVEST_BLOCK";
    case "STOP_HARVEST":
      return "STOP_HARVEST";
    case "EQUIP_ITEM":
      return "EQUIP_ITEM";
    case "EAT_FOOD":
      return "EAT_FOOD";
    case "RECOVER":
      return "RECOVER";
    default:
      return action.type;
  }
}

function formatDanger(danger: DangerSummary): string {
  if (danger.hostileCount === 0 || danger.nearestHostileDistance === null || !danger.nearestHostileName) {
    return "no hostiles nearby";
  }
  return `${danger.nearestHostileName} at ${danger.nearestHostileDistance.toFixed(1)} (${danger.proximity})`;
}

function formatFoodItems(foodItems: { name: string; count: number }[]): string {
  if (foodItems.length === 0) {
    return "Food: none.";
  }

  const text = foodItems
    .slice(0, 5)
    .map((entry) => `${entry.name} x${entry.count}`)
    .join(", ");
  return `Food: ${text}`;
}

function isFinitePosition(position: { x: number; y: number; z: number } | null | undefined): boolean {
  if (!position) return false;
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function hungerStatusFromFood(food: number | null): "full" | "okay" | "hungry" | "starving" {
  if (food === null) return "okay";
  if (food >= 19) return "full";
  if (food >= 13) return "okay";
  if (food >= 7) return "hungry";
  return "starving";
}

function movementModeLabel(mode: MovementMode, stuckCount: number): string {
  if (stuckCount > 0) return "stuck";
  if (mode === "come") return "coming";
  if (mode === "follow") return "following";
  if (mode === "flee") return "fleeing";
  return mode;
}

function toOneDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return value.toFixed(1);
}

function toWhole(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return Math.round(value).toString();
}

const ORE_NAMES = new Set<string>([
  "coal_ore",
  "deepslate_coal_ore",
  "iron_ore",
  "deepslate_iron_ore",
  "copper_ore",
  "deepslate_copper_ore",
  "gold_ore",
  "deepslate_gold_ore",
  "redstone_ore",
  "deepslate_redstone_ore",
  "lapis_ore",
  "deepslate_lapis_ore",
  "diamond_ore",
  "deepslate_diamond_ore",
  "emerald_ore",
  "deepslate_emerald_ore",
  "nether_gold_ore",
  "nether_quartz_ore",
  "ancient_debris"
]);

const STONE_LIKE_NAMES = new Set<string>([
  "stone",
  "cobblestone",
  "deepslate",
  "cobbled_deepslate",
  "blackstone"
]);

const FORBIDDEN_NAME_HINTS = ["chest", "barrel", "door", "trapdoor", "bed", "furnace", "crafting_table"];

function normalizeItemName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePickaxeTier(pickaxeName: string | null): number {
  const name = normalizeItemName(pickaxeName);
  if (!name) return 0;
  if (name.includes("netherite_pickaxe")) return 6;
  if (name.includes("diamond_pickaxe")) return 5;
  if (name.includes("iron_pickaxe")) return 4;
  if (name.includes("stone_pickaxe")) return 3;
  if (name.includes("golden_pickaxe")) return 2;
  if (name.includes("wooden_pickaxe")) return 1;
  return 0;
}

function requiredPickaxeTierForBlock(blockName: string): number {
  const name = blockName.toLowerCase();
  if (name.includes("diamond_ore") || name.includes("emerald_ore") || name.includes("gold_ore")) return 4;
  if (name.includes("redstone_ore") || name.includes("iron_ore") || name.includes("lapis_ore")) return 3;
  if (name.includes("copper_ore") || name.includes("coal_ore")) return 1;
  if (name.includes("stone") || name.includes("deepslate")) return 1;
  return 0;
}

export function createActionController(
  bot: Bot,
  config: AppConfig,
  state: StateStore,
  chat: ChatController,
  movement: MovementController,
  perception: PerceptionController,
  safety: SafetyLayer,
  logger: Logger,
  getAiStatus: () => AiBridgeStatus
): ActionController {
  const queue: ActionQueueItem[] = [];
  let actionId = 0;
  let running: ActionQueueItem | null = null;
  let miningActive = false;
  let miningCancelled = false;
  let miningTargetName: string | null = null;
  let miningTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let harvestActive = false;
  let harvestCancelled = false;
  let harvestTargetName: string | null = null;
  let harvestTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function getHomePositionVector(): Vec3 | null {
    if (state.state.homeRecord) {
      return new Vec3(state.state.homeRecord.x, state.state.homeRecord.y, state.state.homeRecord.z);
    }
    if (state.state.homePosition) {
      return new Vec3(state.state.homePosition.x, state.state.homePosition.y, state.state.homePosition.z);
    }
    return null;
  }

  function isBlockAtOwnFeetOrHead(position: Vec3): boolean {
    if (!isFinitePosition(bot.entity?.position)) {
      return false;
    }

    const botFloor = bot.entity.position.floored();
    return (
      position.x === botFloor.x &&
      position.z === botFloor.z &&
      (position.y === botFloor.y || position.y === botFloor.y + 1)
    );
  }

  function isBlockTooNearHome(position: Vec3): boolean {
    const home = getHomePositionVector();
    if (!home || config.homeProtectionRadius <= 0) {
      return false;
    }
    return home.distanceTo(position) <= config.homeProtectionRadius;
  }

  function getTargetBlockFromView(maxDistance: number, includePassable = false): TargetBlockInfo | null {
    if (!isFinitePosition(bot.entity?.position)) {
      return null;
    }

    const fromCursor = bot.blockAtCursor(maxDistance);
    if (fromCursor) {
      const classification = perception.classifyBlock(fromCursor.name);
      if (
        classification !== "air" &&
        classification !== "fluid" &&
        (includePassable || classification !== "passable")
      ) {
        return {
          block: fromCursor,
          name: fromCursor.name.toLowerCase(),
          position: fromCursor.position,
          distance: bot.entity.position.distanceTo(fromCursor.position),
          classification
        };
      }
    }

    const obstacle = perception.getImmediateObstacles();
    const candidates = [obstacle.blockFrontFeet.position, obstacle.blockFrontHead.position].filter(
      (entry): entry is { x: number; y: number; z: number } => entry !== null
    );

    for (const candidate of candidates) {
      const block = bot.blockAt(new Vec3(candidate.x, candidate.y, candidate.z));
      if (!block) continue;
      const classification = perception.classifyBlock(block.name);
      if (classification === "air" || classification === "fluid" || (!includePassable && classification === "passable")) continue;
      return {
        block,
        name: block.name.toLowerCase(),
        position: block.position,
        distance: bot.entity.position.distanceTo(block.position),
        classification
      };
    }

    return null;
  }

  function getPassableFrontTarget(maxDistance: number): TargetBlockInfo | null {
    if (!isFinitePosition(bot.entity?.position)) {
      return null;
    }

    const candidates: TargetBlockInfo[] = [];
    const obstacle = perception.getImmediateObstacles();
    const directCandidates = [
      obstacle.blockFrontFeet.position,
      obstacle.blockFrontHead.position,
      obstacle.blockAtFeet.position
    ].filter((entry): entry is { x: number; y: number; z: number } => entry !== null);

    for (const entry of directCandidates) {
      const block = bot.blockAt(new Vec3(entry.x, entry.y, entry.z));
      if (!block) continue;
      const name = block.name.toLowerCase();
      if (!HARVEST_GRASS_BLOCKS.has(name) && !config.harvestAllowedBlocks.includes(name)) continue;
      candidates.push({
        block,
        name,
        position: block.position,
        distance: bot.entity.position.distanceTo(block.position),
        classification: perception.classifyBlock(name)
      });
    }

    const around = Math.max(1, Math.min(Math.floor(maxDistance), 2));
    const center = bot.entity.position.floored();
    for (let dx = -around; dx <= around; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -around; dz <= around; dz += 1) {
          const pos = new Vec3(center.x + dx, center.y + dy, center.z + dz);
          const block = bot.blockAt(pos);
          if (!block) continue;
          const name = block.name.toLowerCase();
          if (!HARVEST_GRASS_BLOCKS.has(name) && !config.harvestAllowedBlocks.includes(name)) continue;
          candidates.push({
            block,
            name,
            position: block.position,
            distance: bot.entity.position.distanceTo(block.position),
            classification: perception.classifyBlock(name)
          });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
    return candidates[0] ?? null;
  }

  function getHarvestTarget(mode: "front" | "grass" | "crop"): TargetBlockInfo | null {
    const direct = getTargetBlockFromView(config.blockTargetRaycastDistance);
    if (direct) {
      return direct;
    }

    if (mode === "front" || mode === "grass") {
      return getPassableFrontTarget(config.blockTargetRaycastDistance);
    }

    return null;
  }

  function summarizeTargetBlock(target: TargetBlockInfo | null): {
    name: string | null;
    category: BlockClass | null;
    distance: number | null;
  } {
    if (!target) {
      return { name: null, category: null, distance: null };
    }

    return {
      name: target.name,
      category: target.classification,
      distance: target.distance
    };
  }

  function stopMiningNow(reason: string): void {
    if (!miningActive && !miningTimeoutHandle) return;

    miningCancelled = true;
    if (miningTimeoutHandle) {
      clearTimeout(miningTimeoutHandle);
      miningTimeoutHandle = null;
    }
    try {
      bot.stopDigging();
    } catch {
      // ignore stopDigging errors
    }
    try {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    } catch {
      // ignore pathfinder stop errors
    }
    movement.clearMovementState(`mining-stop:${reason}`);
    miningActive = false;
    const target = miningTargetName;
    miningTargetName = null;
    logger.warn("action", `mining stopped reason=${reason} target=${target ?? "none"}`);
  }

  function stopHarvestNow(reason: string): void {
    if (!harvestActive && !harvestTimeoutHandle) return;

    harvestCancelled = true;
    if (harvestTimeoutHandle) {
      clearTimeout(harvestTimeoutHandle);
      harvestTimeoutHandle = null;
    }
    try {
      bot.stopDigging();
    } catch {
      // ignore stopDigging errors
    }
    try {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    } catch {
      // ignore pathfinder stop errors
    }
    movement.clearMovementState(`harvest-stop:${reason}`);
    harvestActive = false;
    const target = harvestTargetName;
    harvestTargetName = null;
    logger.warn("action", `harvest stopped reason=${reason} target=${target ?? "none"}`);
  }

  function hasDangerForMining(): boolean {
    const danger = perception.getDangerSummary(config.hostileDangerRadius);
    state.setDangerSummary(danger);
    return danger.proximity === "close" || danger.proximity === "critical";
  }

  function hasLowHealthForMining(): boolean {
    return Number.isFinite(bot.health) && bot.health <= config.lowHealthStopThreshold;
  }

  function isValidMiningBlockName(name: string): boolean {
    const normalized = name.toLowerCase();
    if (config.miningForbiddenBlocks.includes(normalized)) return false;
    for (const hint of FORBIDDEN_NAME_HINTS) {
      if (normalized.includes(hint)) return false;
    }
    return config.miningAllowedBlocks.includes(normalized);
  }

  function requiresPickaxeForBlock(name: string): boolean {
    const normalized = name.toLowerCase();
    if (ORE_NAMES.has(normalized)) {
      return config.requireToolForOres;
    }
    if (STONE_LIKE_NAMES.has(normalized) || normalized.includes("stone") || normalized.includes("deepslate")) {
      return config.requireToolForStone;
    }
    return false;
  }

  function isForbiddenByNameHints(name: string): boolean {
    const normalized = name.toLowerCase();
    for (const hint of FORBIDDEN_NAME_HINTS) {
      if (normalized.includes(hint)) {
        return true;
      }
    }
    return false;
  }

  function validateMiningTarget(target: TargetBlockInfo): ActionValidation {
    if (!state.state.alive) {
      return { allowed: false, reason: "I am not alive right now.", code: "not-alive" };
    }

    if (!movement.isEntityPositionHealthy() || !isFinitePosition(bot.entity?.position)) {
      return { allowed: false, reason: "My position is not valid for mining yet.", code: "position-invalid" };
    }

    if (hasDangerForMining()) {
      return {
        allowed: false,
        reason: "I will not mine that block because danger is nearby.",
        code: "danger-nearby"
      };
    }

    if (hasLowHealthForMining()) {
      return {
        allowed: false,
        reason: "I will not mine that block because my health is too low.",
        code: "low-health"
      };
    }

    if (state.state.food !== null && state.state.food < config.lowFoodEatThreshold) {
      return { allowed: false, reason: "My food is too low for safe mining.", code: "low-food" };
    }

    if (target.distance > config.miningMaxDistance) {
      return {
        allowed: false,
        reason: "I will not mine that block because it is too far away.",
        code: "too-far"
      };
    }

    if (!isValidMiningBlockName(target.name)) {
      return { allowed: false, reason: "That block is not in my safe mining list.", code: "not-allowed-list" };
    }

    if (isBlockAtOwnFeetOrHead(target.position)) {
      return {
        allowed: false,
        reason: "I will not mine that block because it is at my feet/head.",
        code: "at-feet-or-head"
      };
    }

    if (isBlockTooNearHome(target.position)) {
      return { allowed: false, reason: "I will not mine inside my home area yet.", code: "home-protected" };
    }

    return { allowed: true, reason: "allowed", code: "allowed" };
  }

  function isHarvestAllowedByName(name: string): boolean {
    const normalized = name.toLowerCase();
    if (config.harvestForbiddenBlocks.includes(normalized)) return false;
    if (isForbiddenByNameHints(normalized)) return false;
    return config.harvestAllowedBlocks.includes(normalized);
  }

  function getCropAge(target: TargetBlockInfo): number | null {
    const properties = target.block.getProperties();
    const age = properties.age;
    if (typeof age !== "number" || !Number.isFinite(age)) {
      return null;
    }
    return age;
  }

  function validateCropMaturity(target: TargetBlockInfo): ActionValidation {
    if (!config.allowCropHarvest) {
      return {
        allowed: false,
        reason: "Crop harvesting is disabled by safety settings.",
        code: "crop-disabled"
      };
    }

    const requiredAge = CROP_MATURITY_AGES[target.name];
    if (requiredAge === undefined) {
      return {
        allowed: false,
        reason: "That target is not a supported crop.",
        code: "crop-unsupported"
      };
    }

    if (!config.requireMatureCrops) {
      return { allowed: true, reason: "allowed", code: "allowed" };
    }

    const age = getCropAge(target);
    if (age === null) {
      return {
        allowed: false,
        reason: "I cannot confirm that crop is mature yet.",
        code: "crop-age-unknown"
      };
    }

    if (age < requiredAge) {
      return {
        allowed: false,
        reason: "I cannot confirm that crop is mature yet.",
        code: "crop-not-mature"
      };
    }

    return { allowed: true, reason: "allowed", code: "allowed" };
  }

  function validateHarvestTarget(target: TargetBlockInfo, mode: "front" | "grass" | "crop"): ActionValidation {
    if (!state.state.alive) {
      return { allowed: false, reason: "I am not alive right now.", code: "not-alive" };
    }

    if (!movement.isEntityPositionHealthy() || !isFinitePosition(bot.entity?.position)) {
      return { allowed: false, reason: "My position is not valid yet.", code: "position-invalid" };
    }

    const danger = perception.getDangerSummary(config.hostileDangerRadius);
    state.setDangerSummary(danger);
    if (danger.proximity === "close" || danger.proximity === "critical") {
      return {
        allowed: false,
        reason: "I will not harvest while danger is nearby.",
        code: "danger-nearby"
      };
    }

    if (hasLowHealthForMining()) {
      return {
        allowed: false,
        reason: "I will not harvest because my health is too low.",
        code: "low-health"
      };
    }

    if (target.distance > config.harvestMaxDistance) {
      return {
        allowed: false,
        reason: "I will not harvest that block because it is too far away.",
        code: "too-far"
      };
    }

    if (!isHarvestAllowedByName(target.name)) {
      return {
        allowed: false,
        reason: "That block is not in my safe harvest list.",
        code: "not-allowed-list"
      };
    }

    if (mode === "grass" && !HARVEST_GRASS_BLOCKS.has(target.name)) {
      return {
        allowed: false,
        reason: "Harvest grass only works on short_grass, grass, tall_grass, or fern.",
        code: "grass-mode-mismatch"
      };
    }

    if (mode === "crop") {
      const cropDecision = validateCropMaturity(target);
      if (!cropDecision.allowed) {
        return cropDecision;
      }
    }

    if (isBlockTooNearHome(target.position) && !HARVEST_HOME_EXEMPT_BLOCKS.has(target.name)) {
      return {
        allowed: false,
        reason: "I will not harvest inside my home area yet.",
        code: "home-protected"
      };
    }

    return { allowed: true, reason: "allowed", code: "allowed" };
  }

  async function moveNearBlock(blockPosition: Vec3): Promise<boolean> {
    if (!isFinitePosition(bot.entity?.position)) return false;
    const currentDistance = bot.entity.position.distanceTo(blockPosition);
    if (currentDistance <= 3) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (value: boolean): void => {
        if (resolved) return;
        resolved = true;
        bot.removeListener("goal_reached", onGoalReached);
        bot.removeListener("path_reset", onPathReset);
        resolve(value);
      };

      const onGoalReached = (): void => {
        done(true);
      };
      const onPathReset = (reason: unknown): void => {
        if (String(reason) === "stuck") {
          done(false);
        }
      };

      bot.on("goal_reached", onGoalReached);
      bot.on("path_reset", onPathReset);
      bot.pathfinder.setGoal(new goals.GoalNear(blockPosition.x, blockPosition.y, blockPosition.z, 2), false);

      const timeout = setTimeout(() => {
        done(false);
      }, Math.min(config.miningTimeoutMs, 6000));
      timeout.unref();
    });
  }

  async function equipRequiredToolForBlock(blockName: string): Promise<{ ok: boolean; reason?: string }> {
    if (!requiresPickaxeForBlock(blockName)) {
      return { ok: true };
    }

    const bestPickaxe = getBestPickaxe(bot);
    if (!bestPickaxe) {
      return { ok: false, reason: "I need a pickaxe for that block." };
    }

    const requiredTier = requiredPickaxeTierForBlock(blockName);
    const availableTier = normalizePickaxeTier(bestPickaxe.name);
    if (requiredTier > 0 && availableTier < requiredTier) {
      return { ok: false, reason: "My pickaxe is not strong enough for that block." };
    }

    if (!config.allowEquip) {
      return { ok: false, reason: "Equipment use is disabled by safety settings." };
    }

    try {
      await bot.equip(bestPickaxe, "hand");
      logger.log("action", `equipped ${bestPickaxe.name} for mining`);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `Failed to equip tool: ${message}` };
    }
  }

  function collectOreTargets(radius: number): TargetBlockInfo[] {
    if (!isFinitePosition(bot.entity?.position)) {
      return [];
    }

    const center = bot.entity.position.floored();
    const sampledRadius = Math.min(Math.max(Math.floor(radius), 1), 8);
    const targets: TargetBlockInfo[] = [];

    for (let dx = -sampledRadius; dx <= sampledRadius; dx += 1) {
      for (let dy = -sampledRadius; dy <= sampledRadius; dy += 1) {
        for (let dz = -sampledRadius; dz <= sampledRadius; dz += 1) {
          const pos = new Vec3(center.x + dx, center.y + dy, center.z + dz);
          const block = bot.blockAt(pos);
          if (!block) continue;
          const name = block.name.toLowerCase();
          if (!ORE_NAMES.has(name)) continue;
          targets.push({
            block,
            name,
            position: block.position,
            distance: bot.entity.position.distanceTo(block.position),
            classification: perception.classifyBlock(name)
          });
        }
      }
    }

    targets.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
    return targets;
  }

  function getMineableOreSummary(radius: number): { ores: { name: string; count: number }[]; reason: string } {
    const oreTargets = collectOreTargets(radius);
    if (oreTargets.length === 0) {
      return { ores: [], reason: "none visible" };
    }

    if (!config.allowMining) {
      return { ores: [], reason: "mining disabled." };
    }
    if (!state.state.alive || !movement.isEntityPositionHealthy()) {
      return { ores: [], reason: "not ready." };
    }
    if (hasDangerForMining()) {
      return { ores: [], reason: "unsafe." };
    }
    if (hasLowHealthForMining()) {
      return { ores: [], reason: "health too low." };
    }

    const mineableCounts = new Map<string, number>();
    let firstFailureReason = "";

    for (const target of oreTargets) {
      const decision = validateMiningTarget(target);
      if (!decision.allowed) {
        if (!firstFailureReason) {
          firstFailureReason = decision.reason;
        }
        continue;
      }
      mineableCounts.set(target.name, (mineableCounts.get(target.name) ?? 0) + 1);
    }

    const mineable = Array.from(mineableCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    if (mineable.length === 0) {
      if (firstFailureReason) {
        return { ores: [], reason: firstFailureReason };
      }
      return { ores: [], reason: "no safe ore target found." };
    }

    return { ores: mineable, reason: "one or more ores are allowed and safe right now." };
  }

  function normalizeReasonText(reason: string): string {
    return reason.endsWith(".") ? reason.slice(0, -1) : reason;
  }

  function getMiningPreview(target: TargetBlockInfo | null): { mineable: boolean; reason: string } {
    if (!target) {
      return { mineable: false, reason: "no target block" };
    }
    if (!config.allowMining) {
      return { mineable: false, reason: "mining disabled" };
    }

    const decision = validateMiningTarget(target);
    if (!decision.allowed) {
      return { mineable: false, reason: normalizeReasonText(decision.reason) };
    }
    return { mineable: true, reason: "allowed" };
  }

  function getHarvestPreview(target: TargetBlockInfo | null): { harvestable: boolean; reason: string } {
    if (!target) {
      return { harvestable: false, reason: "no target block" };
    }
    if (!config.allowHarvest) {
      return { harvestable: false, reason: "harvesting disabled" };
    }

    const decision = validateHarvestTarget(target, "front");
    if (!decision.allowed) {
      return { harvestable: false, reason: normalizeReasonText(decision.reason) };
    }
    return { harvestable: true, reason: "allowed" };
  }

  function getHomeCenterSnapshot(): { x: number; y: number; z: number } | null {
    if (state.state.homeRecord) {
      return {
        x: state.state.homeRecord.x,
        y: state.state.homeRecord.y,
        z: state.state.homeRecord.z
      };
    }
    return state.state.homePosition ? { ...state.state.homePosition } : null;
  }

  function getYardCheckSummary(): {
    homeSet: boolean;
    insideRadius: boolean | null;
    danger: "none" | "nearby";
    health: "okay" | "low";
    food: "okay" | "low";
    terrain: "safe" | "unsafe" | "unknown";
    flatOnly: boolean;
    targetAttempts: number;
    blockBelow: string;
    blockAtFeet: string;
    blockAtHead: string;
    currentPositionSafe: boolean | null;
  } {
    const home = getHomeCenterSnapshot();
    const insideRadius = home ? movement.isInsideYardRadius() : null;
    const danger = perception.getDangerSummary(config.hostileDangerRadius);
    state.setDangerSummary(danger);

    const healthLow =
      Number.isFinite(bot.health) && bot.health <= config.wanderLowHealthThreshold;
    const foodLow =
      state.state.food !== null &&
      Number.isFinite(state.state.food) &&
      state.state.food <= config.wanderLowFoodThreshold;

    const obstacle = perception.getImmediateObstacles();
    const terrainUnsafe =
      obstacle.fluidAtFeet !== null ||
      obstacle.fluidFrontFeet !== null ||
      obstacle.fluidFrontStepDown !== null ||
      state.state.inLava === true;
    const belowName = obstacle.blockBelow.name ?? "unknown";
    const feetName = obstacle.blockAtFeet.name ?? "unknown";
    const headName = obstacle.blockAtHead.name ?? "unknown";
    const belowClass = perception.classifyBlock(obstacle.blockBelow.name);
    const feetClass = perception.classifyBlock(obstacle.blockAtFeet.name);
    const headClass = perception.classifyBlock(obstacle.blockAtHead.name);
    const positionSafe =
      !isFinitePosition(bot.entity?.position)
        ? null
        : !terrainUnsafe &&
          (feetClass === "air" || feetClass === "passable") &&
          (headClass === "air" || headClass === "passable") &&
          (belowClass === "solid" ||
            belowClass === "dirt" ||
            belowClass === "stone" ||
            belowClass === "log" ||
            belowClass === "ore");
    const terrain =
      !isFinitePosition(bot.entity?.position) ? "unknown" : terrainUnsafe ? "unsafe" : "safe";

    return {
      homeSet: Boolean(home),
      insideRadius,
      danger: danger.proximity === "none" ? "none" : "nearby",
      health: healthLow ? "low" : "okay",
      food: foodLow ? "low" : "okay",
      terrain,
      flatOnly: config.wanderFlatOnly,
      targetAttempts: config.wanderTargetAttempts,
      blockBelow: belowName,
      blockAtFeet: feetName,
      blockAtHead: headName,
      currentPositionSafe: positionSafe
    };
  }

  function getActionQueueSummary(): ActionQueueSummary {
    return {
      queued: queue.length,
      running: running ? describeAction(running.action) : null,
      next: queue[0] ? describeAction(queue[0].action) : null
    };
  }

  function syncQueueState(): void {
    const runningAction = running ? describeAction(running.action) : null;
    state.setActionQueueInfo(queue.length, runningAction);
  }

  function queueAction(requestedBy: string, action: BotAction): void {
    const decision = safety.validateAction(requestedBy, action);
    if (!decision.allowed) {
      const reason = decision.reason ?? "Action blocked by safety.";
      logger.warn("safety", `Action rejected for ${requestedBy}: ${reason}`, action);

      if (requestedBy !== "SYSTEM" && requestedBy !== "AI") {
        chat.send(reason, "safety-rejected");
      }
      return;
    }

    const safeAction = decision.action ?? action;
    if (safeAction.type === "STOP_MOVING" || safeAction.type === "STOP_WANDER") {
      stopMiningNow(`requested-by-${requestedBy}`);
      stopHarvestNow(`requested-by-${requestedBy}`);
      clearMovementActions("stop-immediate");
      movement.stop("stop command");
      chat.send("Stopped.", "stop");
      return;
    }

    if (safeAction.type === "STOP_MINING") {
      stopMiningNow(`requested-by-${requestedBy}`);
      clearMovementActions("stop-mining");
      chat.send("Mining stopped.", "mine-stop");
      return;
    }

    if (safeAction.type === "STOP_HARVEST") {
      stopHarvestNow(`requested-by-${requestedBy}`);
      clearMovementActions("stop-harvest");
      chat.send("Harvest stopped.", "harvest-stop");
      return;
    }

    actionId += 1;

    const item: ActionQueueItem = {
      id: actionId,
      createdAt: nowIso(),
      requestedBy,
      action: safeAction
    };

    queue.push(item);
    syncQueueState();
    logger.log("action", `queued id=${item.id} by=${requestedBy} action=${describeAction(item.action)}`);

    void processQueue();
  }

  function clearActionQueue(reason: string): void {
    const dropped = queue.length;
    queue.splice(0, queue.length);
    syncQueueState();
    state.addEvent("state_update", "Action queue cleared", {
      reason,
      dropped
    });
    logger.log("action", `queue cleared reason=${reason} dropped=${dropped}`);
  }

  function clearMovementActions(reason: string): void {
    const kept: ActionQueueItem[] = [];
    let removed = 0;

    for (const item of queue) {
      if (MOVEMENT_ACTION_TYPES.has(item.action.type)) {
        removed += 1;
        continue;
      }
      kept.push(item);
    }

    queue.splice(0, queue.length, ...kept);
    syncQueueState();

    if (removed > 0) {
      logger.log("action", `movement actions cleared reason=${reason} removed=${removed}`);
      state.addEvent("state_update", "Movement actions cleared", {
        reason,
        removed
      });
    }
  }

  async function processQueue(): Promise<void> {
    if (running) return;

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;

      running = item;
      syncQueueState();
      state.setCurrentAction(describeAction(item.action));
      state.addEvent("action_started", `Action started: ${describeAction(item.action)}`, {
        id: item.id,
        requestedBy: item.requestedBy,
        action: item.action
      });
      logger.log(
        "action",
        `start id=${item.id} by=${item.requestedBy} action=${describeAction(item.action)}`
      );

      let success = false;
      let errorMessage: string | null = null;

      try {
        success = await runAction(item);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        state.setLastError(errorMessage);
        state.addEvent("error", "Action execution error", {
          id: item.id,
          action: item.action,
          error: errorMessage
        });
        logger.error("action", `error id=${item.id} action=${describeAction(item.action)}: ${errorMessage}`);
      }

      state.addEvent("action_completed", `Action completed: ${describeAction(item.action)}`, {
        id: item.id,
        success,
        error: errorMessage
      });
      logger.log("action", `done id=${item.id} success=${success} action=${describeAction(item.action)}`);

      running = null;
      state.setCurrentAction(null);
      syncQueueState();
    }
  }

  async function runAction(item: ActionQueueItem): Promise<boolean> {
    const { action } = item;

    switch (action.type) {
      case "CHAT": {
        return chat.send(action.message, action.reason ?? "action-chat");
      }

      case "COME_TO_OWNER": {
        return movement.startComeToOwner(item.requestedBy, action.radius);
      }

      case "FOLLOW_OWNER": {
        return movement.startFollowOwner(item.requestedBy, action.distance);
      }

      case "STOP_MOVING": {
        stopMiningNow("stop-command");
        stopHarvestNow("stop-command");
        clearMovementActions("stop");
        movement.stop("stop command");
        chat.send("Stopped.", "stop");
        return true;
      }

      case "STOP_MINING": {
        stopMiningNow("stop-mining-action");
        chat.send("Mining stopped.", "mine-stop");
        return true;
      }

      case "STOP_HARVEST": {
        stopHarvestNow("stop-harvest-action");
        chat.send("Harvest stopped.", "harvest-stop");
        return true;
      }

      case "STOP_WANDER": {
        movement.stopWander("stop command");
        chat.send("Stopped.", "stop");
        return true;
      }

      case "RESPAWN": {
        return movement.tryRespawn(item.requestedBy);
      }

      case "LOOK_AT_OWNER": {
        const looked = await movement.lookAtOwner();
        if (!looked) {
          chat.send(`I can't see ${config.ownerUsername} right now.`, "look-at-owner-failed");
        }
        return looked;
      }

      case "SET_HOME": {
        return movement.setHome(item.requestedBy);
      }

      case "GO_HOME": {
        return movement.goHome(item.requestedBy);
      }

      case "SET_STAY_HOME": {
        return movement.setStayHome(item.requestedBy);
      }

      case "FLEE_DANGER": {
        return movement.startFleeFromDanger(item.requestedBy);
      }

      case "WANDER_SAFE": {
        return movement.startWanderSafe(item.requestedBy, action.center);
      }

      case "RECOVER": {
        logger.log("survival", "Recovery requested.");
        stopMiningNow("recover");
        stopHarvestNow("recover");
        clearMovementActions("recover");
        clearActionQueue("recover");
        movement.stop("recover");

        const snapshot = state.getBotSnapshot();
        if (!snapshot.alive) {
          const requested = movement.tryRespawn(item.requestedBy);
          if (!requested) {
            chat.send("Recover: respawn request failed.", "recover-respawn-failed");
            return false;
          }
          chat.send("Recover: respawn requested.", "recover-respawn");
          return true;
        }

        if (!movement.isEntityPositionHealthy()) {
          chat.send("Recovering my position.", "recover-invalid-position", {
            bypassRateLimit: true,
            bypassNotReadyCooldown: true
          });
          state.setReady(false);
          logger.warn("life", "Recover requested with invalid live position. Quitting for clean restart.");
          setTimeout(() => {
            bot.quit("Invalid position recovery");
          }, 300).unref();
          return true;
        }

        const pos = snapshot.position
          ? `(${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)})`
          : "unknown";
        chat.send(
          `Recover: ready=${snapshot.ready}, alive=${snapshot.alive}, hp=${snapshot.health ?? "unknown"}, food=${snapshot.food ?? "unknown"}, pos=${pos}.`,
          "recover-alive"
        );
        return true;
      }

      case "REPORT_STATUS": {
        const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";
        if (!isFinitePosition(bot.entity?.position)) {
          logger.warn("state", "Status requested with invalid position.", {
            rawPosition: bot.entity?.position
          });
          chat.send(`Status: position unavailable, hp=${hp}`, "status-unavailable");
          return true;
        }

        const pos = bot.entity.position;
        chat.send(
          `Status: pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), hp=${hp}`,
          "status-ok"
        );
        return true;
      }

      case "REPORT_WHERE_ARE_YOU": {
        const dimension = bot.game?.dimension ?? "unknown";
        const world = bot.game?.levelType ?? "unknown";
        const hp = Number.isFinite(bot.health) ? bot.health.toFixed(1) : "unknown";

        if (!isFinitePosition(bot.entity?.position)) {
          chat.send(`I'm at an unknown position. dim=${dimension}, world=${world}, hp=${hp}`, "where-unknown");
          return true;
        }

        const pos = bot.entity.position;
        chat.send(
          `I am at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(
            1
          )}) in ${dimension} (world=${world}), hp=${hp}.`,
          "where-ok"
        );
        return true;
      }

      case "REPORT_NEARBY": {
        const players = perception
          .getNearbyPlayers(20)
          .filter((player) => player.username.toLowerCase() !== bot.username.toLowerCase());
        const hostiles = perception.getNearbyHostileMobs(20);

        const playersText = players.length
          ? players
              .slice(0, 3)
              .map((player) => `${player.username}:${player.distance.toFixed(1)}`)
              .join(", ")
          : "none";

        const hostilesText = hostiles.length
          ? hostiles
              .slice(0, 3)
              .map((mob) => `${mob.name}:${mob.distance.toFixed(1)}`)
              .join(", ")
          : "none";

        chat.send(`Nearby players=${playersText}; hostiles=${hostilesText}.`, "nearby");
        return true;
      }

      case "REPORT_LOOK": {
        const players = perception
          .getNearbyPlayers(16)
          .filter((player) => player.username.toLowerCase() !== bot.username.toLowerCase());
        const hostiles = perception.getNearbyHostileMobs(16);
        const obstacles = perception.getImmediateObstacles();

        const frontFeet = obstacles.blockFrontFeet.name ?? "unknown";
        const frontHead = obstacles.blockFrontHead.name ?? "unknown";
        chat.send(
          `I see ${players.length} players and ${hostiles.length} hostiles. Front blocks: ${frontFeet}/${frontHead}.`,
          "look"
        );
        return true;
      }

      case "REPORT_HELP": {
        chat.send(
          "Commands: hello, help, capabilities, status, vitals, hunger, danger, threat, where are you, nearby, look, movement. Owner: target, inventory, equipment, food, eat, equip food/pickaxe/shovel/axe, mine front/block/ore, mine stop, ore report, harvest report/front/grass/crop, harvest stop, wander, wander home, wander stop, yard status, yard check, block, ores nearby, come, follow me, stop, flee, respawn, distance, obstacle, set home, home, stay home, home status, clear home, recover, safety test, state, debug, ai status, action queue.",
          "help"
        );
        return true;
      }

      case "REPORT_DISTANCE": {
        const distance = movement.getDistanceToOwner();
        if (distance === null) {
          chat.send("Distance unavailable right now.", "distance-unavailable");
          return true;
        }

        chat.send(`Distance to ${config.ownerUsername}: ${distance.toFixed(1)} blocks.`, "distance");
        return true;
      }

      case "REPORT_OBSTACLE": {
        const obstacle = perception.getImmediateObstacles();
        state.addEvent("obstacle_detected", "Obstacle command snapshot captured", obstacle);
        logger.log("perception", "Obstacle snapshot", obstacle);

        const feet = obstacle.blockFrontFeet.name ?? "unknown";
        const head = obstacle.blockFrontHead.name ?? "unknown";
        const below = obstacle.blockBelow.name ?? "unknown";
        const passable = obstacle.frontPassable === null ? "unknown" : String(obstacle.frontPassable);
        const stuck = obstacle.appearsStuck ? "yes" : "no";
        chat.send(`Obstacle: front=${feet}/${head}, below=${below}, passable=${passable}, stuck=${stuck}.`, "obstacle");
        return true;
      }

      case "REPORT_STATE": {
        const snapshot = state.getBotSnapshot();
        logger.log("state", "Bot snapshot", snapshot);
        chat.send(
          `State: ready=${snapshot.ready}, alive=${snapshot.alive}, mode=${snapshot.movement.mode}, queue=${snapshot.actionQueueLength}.`,
          "state"
        );
        return true;
      }

      case "REPORT_DEBUG": {
        const events = state.getRecentEvents(10);
        logger.log("state", "Recent events", events);
        const summary = events.map((event) => event.type).join(", ") || "none";
        chat.send(`Recent events: ${summary}.`, "debug");
        return true;
      }

      case "REPORT_AI_STATUS": {
        const aiStatus = getAiStatus();
        const queueSummary = getActionQueueSummary();
        const errorText = aiStatus.lastError ?? "none";

        if (!aiStatus.enabled) {
          chat.send(
            `AI bridge: disabled. queue=${queueSummary.queued}. lastError=${errorText}.`,
            "ai-status"
          );
          return true;
        }

        chat.send(
          `AI bridge: enabled (${aiStatus.url ?? "unknown"}). queue=${queueSummary.queued}. lastError=${errorText}.`,
          "ai-status"
        );
        return true;
      }

      case "REPORT_ACTION_QUEUE": {
        const summary = getActionQueueSummary();
        chat.send(
          `Action queue: queued=${summary.queued}, running=${summary.running ?? "none"}, next=${summary.next ?? "none"}.`,
          "action-queue"
        );
        return true;
      }

      case "REPORT_CAPABILITIES": {
        const caps = state.state.capabilities;
        chat.send(
          `Capabilities: movement=${String(caps.movement)}, perception=${String(caps.perception)}, home=${String(
            caps.home
          )}, flee=${String(caps.flee)}, wandering=${String(caps.wandering)}, inventoryRead=${String(caps.inventoryRead)}, equipment=${String(
            caps.equipment
          )}, eating=${String(caps.eating)}, mining=${String(caps.mining)}, harvesting=${String(
            caps.harvesting
          )}, cropHarvesting=${String(caps.cropHarvesting)}, combat=${String(caps.combat)}, building=${String(
            caps.building
          )}, crafting=${String(caps.crafting)}, containers=${String(caps.containers)}, ai=${String(caps.ai)}.`,
          "capabilities"
        );
        return true;
      }

      case "REPORT_VITALS": {
        const snapshot = state.getBotSnapshot();
        const pos = snapshot.position
          ? `${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)}`
          : "unknown";
        const dangerText =
          snapshot.dangerSummary.proximity === "none"
            ? "none"
            : formatDanger(snapshot.dangerSummary);
        const saturationText =
          snapshot.saturation === null || !Number.isFinite(snapshot.saturation)
            ? "unknown"
            : Number(snapshot.saturation.toFixed(1)).toString();

        chat.send(
          `Health: ${toOneDecimal(snapshot.health)}/20 | Food: ${toWhole(snapshot.food)}/20 | Saturation: ${saturationText} | Oxygen: ${toWhole(
            snapshot.oxygen
          )} | Alive: ${String(snapshot.alive)} | Danger: ${dangerText} | Position: ${pos}`,
          "vitals"
        );
        return true;
      }

      case "REPORT_DANGER": {
        const danger = perception.getDangerSummary(config.hostileDangerRadius);
        state.setDangerSummary(danger);

        if (danger.hostileCount === 0 || danger.nearestHostileDistance === null || !danger.nearestHostileName) {
          chat.send("Danger: no hostiles nearby.", "danger-none");
          return true;
        }

        chat.send(
          `Danger: nearest ${danger.nearestHostileName} at ${danger.nearestHostileDistance.toFixed(
            1
          )} blocks (${danger.proximity}).`,
          "danger-report"
        );
        return true;
      }

      case "REPORT_THREAT": {
        const danger = perception.getDangerSummary(config.hostileDangerRadius);
        state.setDangerSummary(danger);

        if (danger.hostileCount === 0 || danger.nearestHostileDistance === null || !danger.nearestHostileName) {
          chat.send("Threat: none.", "threat-none");
          return true;
        }

        chat.send(
          `Threat: ${danger.proximity}. nearest ${danger.nearestHostileName} at ${danger.nearestHostileDistance.toFixed(
            1
          )} blocks.`,
          "threat-report"
        );
        return true;
      }

      case "REPORT_MOVEMENT": {
        const snapshot = state.getBotSnapshot();
        const mode = movementModeLabel(snapshot.movement.mode, snapshot.movement.stuckCount);
        const goal = snapshot.movement.lastKnownGoal ?? snapshot.currentGoal ?? "none";
        const distance = movement.getDistanceToOwner();
        const distanceText = distance === null ? "unavailable" : distance.toFixed(1);
        const stayHome = movement.isStayHomeEnabled();

        chat.send(
          `Movement: mode=${mode}, goal=${goal}, stuckCount=${snapshot.movement.stuckCount}, distanceToOwner=${distanceText}, stayHome=${String(
            stayHome
          )}.`,
          "movement"
        );
        return true;
      }

      case "REPORT_YARD_STATUS": {
        const home = getHomeCenterSnapshot();
        const distanceFromHome = movement.getDistanceToHome();
        const inside = movement.isInsideYardRadius();
        const homeText = home
          ? `(${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)})`
          : "not set";
        const distanceText = distanceFromHome === null ? "unavailable" : distanceFromHome.toFixed(1);
        const insideText = inside === null ? "unknown" : inside ? "yes" : "no";

        chat.send(
          `Yard: home=${homeText}, radius=${config.wanderRadius.toFixed(1)}, distance=${distanceText}, inside=${insideText}, wanderingEnabled=${String(
            config.allowWander
          )}, active=${String(state.state.movement.wanderActive)}.`,
          "yard-status"
        );
        return true;
      }

      case "REPORT_YARD_CHECK": {
        const yard = getYardCheckSummary();
        const homeText = yard.homeSet ? "yes" : "no";
        const insideText = yard.insideRadius === null ? "unknown" : yard.insideRadius ? "yes" : "no";
        const currentSafeText =
          yard.currentPositionSafe === null ? "unknown" : yard.currentPositionSafe ? "yes" : "no";

        chat.send(
          `Yard check: home set=${homeText}, inside radius=${insideText}, flatOnly=${String(
            yard.flatOnly
          )}, targetAttempts=${yard.targetAttempts}, danger=${yard.danger}, health=${yard.health}, food=${yard.food}, terrain=${yard.terrain}, currentSafe=${currentSafeText}, blocks=${yard.blockBelow}/${yard.blockAtFeet}/${yard.blockAtHead}.`,
          "yard-check"
        );
        return true;
      }

      case "REPORT_INVENTORY": {
        const summary = getInventorySummary(bot);
        logger.log("state", "Inventory summary", summary);

        chat.send(
          `Inventory: empty=${summary.emptySlots}/${summary.totalSlots}, held=${summary.heldItem ?? "none"}, food=${summary.foodCount}, tools=${summary.toolCount}, weapons=${summary.weaponCount}, armor=${summary.armorCount}.`,
          "inventory"
        );
        return true;
      }

      case "REPORT_EQUIPMENT": {
        const equipment = getEquipmentSummary(bot);
        const armor = getArmorSummary(bot);
        const armorText =
          [armor.head, armor.torso, armor.legs, armor.feet].filter((piece) => piece !== null).join("/") || "none";

        chat.send(
          `Held: ${equipment.heldItem ?? "none"}. Pickaxe: ${equipment.tools.pickaxe ?? "none"}. Shovel: ${equipment.tools.shovel ?? "none"}. Axe: ${equipment.tools.axe ?? "none"}. Armor: ${armorText}.`,
          "equipment"
        );
        return true;
      }

      case "REPORT_FOOD": {
        const foodItems = getFoodItems(bot);
        logger.log("survival", "Food inventory summary", foodItems);
        chat.send(formatFoodItems(foodItems), "food");
        return true;
      }

      case "REPORT_HUNGER": {
        const snapshot = state.getBotSnapshot();
        const hungerStatus = snapshot.hungerStatus || hungerStatusFromFood(snapshot.food);
        chat.send(
          `Hunger: food=${snapshot.food ?? "unknown"}, saturation=${snapshot.saturation ?? "unknown"}, status=${hungerStatus}.`,
          "hunger"
        );
        return true;
      }

      case "EQUIP_ITEM": {
        if (!config.allowEquip) {
          chat.send("Equipment use is disabled by safety settings.", "equip-disabled");
          return false;
        }

        const category = action.category ?? normalizeItemName(action.itemName);
        let itemToEquip = null;

        if (category === "food") {
          itemToEquip = pickBestFoodItem(bot);
        } else if (category === "pickaxe") {
          itemToEquip = getBestPickaxe(bot);
        } else if (category === "shovel") {
          itemToEquip = getBestShovel(bot);
        } else if (category === "axe") {
          itemToEquip = getBestAxe(bot);
        } else {
          const targetName = normalizeItemName(action.itemName);
          if (targetName) {
            itemToEquip =
              bot.inventory
                ?.items?.()
                ?.find((candidate) => candidate.name.toLowerCase() === targetName) ?? null;
          }
        }

        if (!itemToEquip) {
          chat.send("I do not have that item to equip.", "equip-missing");
          return false;
        }

        try {
          await bot.equip(itemToEquip, "hand");
          chat.send(`Equipped ${itemToEquip.name}.`, "equip-success");
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("action", `Failed to equip ${itemToEquip.name}: ${message}`);
          chat.send("I could not equip that item.", "equip-failed");
          return false;
        }
      }

      case "EAT_FOOD": {
        if (!config.allowEating) {
          chat.send("Eating is disabled by safety settings.", "eat-disabled");
          return false;
        }

        if (!state.state.alive) {
          chat.send("I cannot eat while not alive.", "eat-not-alive");
          return false;
        }

        if (!movement.isEntityPositionHealthy()) {
          chat.send("My position is not ready for eating yet.", "eat-not-ready");
          return false;
        }

        const isForce = action.force === true;
        if (!isForce && state.state.food !== null && state.state.food >= 20) {
          chat.send("I am not hungry.", "eat-not-hungry");
          return false;
        }

        const selectedFood = pickBestFoodItem(bot, action.itemName);
        if (!selectedFood) {
          chat.send("I do not have food.", "eat-no-food");
          return false;
        }

        try {
          await bot.equip(selectedFood, "hand");
          chat.send(`Eating ${selectedFood.name}.`, "eat-start");
          bot.activateItem();
          await sleep(1600);
          bot.deactivateItem();
          logger.log("survival", `Ate food item ${selectedFood.name}`);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("survival", `Failed to eat ${selectedFood.name}: ${message}`);
          chat.send("I could not eat right now.", "eat-failed");
          return false;
        }
      }

      case "MINE_BLOCK": {
        if (!config.allowMining) {
          chat.send("Mining is disabled by safety settings.", "mine-disabled");
          return false;
        }

        if (movement.getMode() !== "idle") {
          movement.stop("mining-start");
        }

        if (!state.state.alive) {
          chat.send("I cannot mine while not alive.", "mine-not-alive");
          return false;
        }

        if (!movement.isEntityPositionHealthy() || !isFinitePosition(bot.entity?.position)) {
          chat.send("My position is not valid for mining yet.", "mine-not-ready");
          return false;
        }

        let target: TargetBlockInfo | null = null;

        if (action.mode === "ore") {
          const oreTargets = collectOreTargets(6);
          if (oreTargets.length === 0) {
            chat.send("I do not see a nearby ore to mine.", "mine-ore-none");
            return false;
          }

          let selected: TargetBlockInfo | null = null;
          let rejectedReason = "";
          for (const ore of oreTargets) {
            const decision = validateMiningTarget(ore);
            if (decision.allowed) {
              selected = ore;
              break;
            }
            if (!rejectedReason) {
              rejectedReason = decision.reason;
            }
          }

          if (!selected) {
            logger.warn("mining", "mine ore rejected", { rejectedReason });
            chat.send("I can see ore, but I cannot mine it safely yet.", "mine-ore-unsafe");
            return false;
          }

          target = selected;
        } else {
          target = getTargetBlockFromView(config.blockTargetRaycastDistance);
        }

        if (!target) {
          chat.send("No safe front block found to mine.", "mine-no-target");
          return false;
        }

        const safetyDecision = validateMiningTarget(target);
        if (!safetyDecision.allowed) {
          if (action.mode === "ore" && safetyDecision.code !== "home-protected") {
            chat.send("I can see ore, but I cannot mine it safely yet.", "mine-ore-unsafe");
          } else {
            chat.send(safetyDecision.reason, "mine-unsafe");
          }
          return false;
        }

        if (action.mode === "ore") {
          const moved = await moveNearBlock(target.position);
          if (!moved) {
            stopMiningNow("move-near-failed");
            chat.send("I can see ore, but I cannot mine it safely yet.", "mine-ore-move-failed");
            return false;
          }
        }

        const toolDecision = await equipRequiredToolForBlock(target.name);
        if (!toolDecision.ok) {
          const reason =
            toolDecision.reason === "Equipment use is disabled by safety settings."
              ? "Equipment use is disabled, and I need a tool for that block."
              : toolDecision.reason ?? "I cannot equip the required tool.";
          chat.send(reason, "mine-tool-failed");
          return false;
        }

        const blockToDig = bot.blockAt(target.position);
        if (!blockToDig) {
          chat.send("That block is no longer available.", "mine-missing-block");
          return false;
        }
        if (!bot.canDigBlock(blockToDig)) {
          chat.send("I cannot dig that block safely.", "mine-cannot-dig");
          return false;
        }

        miningCancelled = false;
        miningActive = true;
        miningTargetName = blockToDig.name;

        const timeoutPromise = new Promise<never>((_, reject) => {
          miningTimeoutHandle = setTimeout(() => {
            miningCancelled = true;
            stopMiningNow("timeout");
            reject(new Error("mining-timeout"));
          }, config.miningTimeoutMs);
          miningTimeoutHandle.unref();
        });

        let cancelledReason = "";
        const safetyMonitor = setInterval(() => {
          if (!movement.isEntityPositionHealthy()) {
            cancelledReason = "invalid-position";
            miningCancelled = true;
          } else if (hasDangerForMining()) {
            cancelledReason = "danger";
            miningCancelled = true;
          } else if (hasLowHealthForMining()) {
            cancelledReason = "low-health";
            miningCancelled = true;
          }

          if (miningCancelled) {
            stopMiningNow(cancelledReason || "cancelled");
          }
        }, 250);
        safetyMonitor.unref();

        try {
          await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
          logger.log(
            "mining",
            `start block=${blockToDig.name} pos=(${target.position.x},${target.position.y},${target.position.z})`
          );
          await Promise.race([bot.dig(blockToDig, true), timeoutPromise]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("mining", `dig failed: ${message}`);
          if (!miningCancelled) {
            chat.send("I could not mine that block.", "mine-failed");
          }
          miningActive = false;
          if (miningTimeoutHandle) {
            clearTimeout(miningTimeoutHandle);
            miningTimeoutHandle = null;
          }
          clearInterval(safetyMonitor);
          return false;
        }

        clearInterval(safetyMonitor);
        if (miningTimeoutHandle) {
          clearTimeout(miningTimeoutHandle);
          miningTimeoutHandle = null;
        }

        if (miningCancelled) {
          chat.send("Mining stopped for safety.", "mine-stopped-safety");
          miningActive = false;
          miningTargetName = null;
          return false;
        }

        miningActive = false;
        miningTargetName = null;
        chat.send(`Mined ${blockToDig.name}.`, "mine-success");
        return true;
      }

      case "REPORT_TARGET": {
        const target =
          getTargetBlockFromView(config.blockTargetRaycastDistance) ??
          getPassableFrontTarget(config.blockTargetRaycastDistance);
        if (!target) {
          chat.send("No solid target block in range.", "target-none");
          return true;
        }

        const minePreview = getMiningPreview(target);
        const harvestPreview = getHarvestPreview(target);
        logger.log("perception", "Target preview", {
          target: summarizeTargetBlock(target),
          minePreview,
          harvestPreview
        });

        const mineText = minePreview.mineable ? "yes" : `no - ${minePreview.reason}`;
        const harvestText = harvestPreview.harvestable ? "yes" : `no - ${harvestPreview.reason}`;

        chat.send(
          `Target: ${target.name} at ${target.distance.toFixed(1)} blocks. Category: ${target.classification}. Mineable: ${mineText}. Harvestable: ${harvestText}.`,
          "target"
        );
        return true;
      }

      case "REPORT_BLOCK": {
        const obstacle = perception.getImmediateObstacles();
        const front = perception.getBlockInFront();
        const below = obstacle.blockBelow.name ?? "unknown";
        const feet = obstacle.blockAtFeet.name ?? "unknown";
        const head = obstacle.blockAtHead.name ?? "unknown";
        chat.send(
          `Block: front=${front.name ?? "unknown"}(${front.classification}), below=${below}, feet=${feet}, head=${head}.`,
          "block"
        );
        return true;
      }

      case "REPORT_ORES_NEARBY": {
        const ores = perception.getNearbyOresSummary(6);
        if (ores.length === 0) {
          chat.send("Ores nearby: none visible.", "ores-none");
          return true;
        }

        const oreText = ores
          .slice(0, 5)
          .map((ore) => `${ore.name} x${ore.count}`)
          .join(", ");
        chat.send(`Ores nearby: ${oreText}`, "ores-report");
        return true;
      }

      case "REPORT_ORE_REPORT": {
        const visibleOres = perception.getNearbyOresSummary(6);
        const visibleText =
          visibleOres.length === 0
            ? "none"
            : visibleOres
                .slice(0, 6)
                .map((ore) => `${ore.name} x${ore.count}`)
                .join(", ");

        const mineable = getMineableOreSummary(6);
        const mineableText =
          mineable.ores.length === 0
            ? "none"
            : mineable.ores
                .slice(0, 6)
                .map((ore) => `${ore.name} x${ore.count}`)
                .join(", ");

        chat.send(
          `Visible ores: ${visibleText}. Mineable now: ${mineableText}. Reason: ${mineable.reason}`,
          "ore-report"
        );
        return true;
      }

      case "REPORT_HARVEST_REPORT": {
        const target = getHarvestTarget("front");
        const harvestPreview = getHarvestPreview(target);
        const allowedList = config.harvestAllowedBlocks.slice(0, 10).join(", ");
        const harvestEnabled = config.allowHarvest ? "enabled" : "disabled";
        const cropEnabled = config.allowCropHarvest ? "enabled" : "disabled";
        const replantEnabled = config.replantCrops ? "enabled" : "disabled";
        const targetText = harvestPreview.harvestable ? "yes" : `no (${harvestPreview.reason})`;

        chat.send(
          `Harvesting: ${harvestEnabled}. Allowed: ${allowedList}. Crop harvesting: ${cropEnabled}. Replanting: ${replantEnabled}. Target harvestable: ${targetText}.`,
          "harvest-report"
        );
        return true;
      }

      case "HARVEST_BLOCK": {
        if (!config.allowHarvest) {
          chat.send("Harvesting is disabled by safety settings.", "harvest-disabled");
          return false;
        }

        if (movement.getMode() !== "idle") {
          movement.stop("harvest-start");
        }

        if (!state.state.alive) {
          chat.send("I cannot harvest while not alive.", "harvest-not-alive");
          return false;
        }

        if (!movement.isEntityPositionHealthy() || !isFinitePosition(bot.entity?.position)) {
          chat.send("My position is not valid yet.", "harvest-not-ready");
          return false;
        }

        const mode = action.mode ?? "front";
        const target = getHarvestTarget(mode);
        if (!target) {
          chat.send("No harvestable target block in range.", "harvest-no-target");
          return false;
        }

        const decision = validateHarvestTarget(target, mode);
        if (!decision.allowed) {
          chat.send(decision.reason, "harvest-unsafe");
          return false;
        }

        if (!bot.canDigBlock(target.block)) {
          chat.send("I cannot harvest that block safely.", "harvest-cannot-dig");
          return false;
        }

        harvestCancelled = false;
        harvestActive = true;
        harvestTargetName = target.block.name;

        const timeoutPromise = new Promise<never>((_, reject) => {
          harvestTimeoutHandle = setTimeout(() => {
            harvestCancelled = true;
            stopHarvestNow("timeout");
            reject(new Error("harvest-timeout"));
          }, config.harvestTimeoutMs);
          harvestTimeoutHandle.unref();
        });

        let cancelledReason = "";
        const safetyMonitor = setInterval(() => {
          if (!movement.isEntityPositionHealthy()) {
            cancelledReason = "invalid-position";
            harvestCancelled = true;
          } else if (hasDangerForMining()) {
            cancelledReason = "danger";
            harvestCancelled = true;
          } else if (hasLowHealthForMining()) {
            cancelledReason = "low-health";
            harvestCancelled = true;
          }

          if (harvestCancelled) {
            stopHarvestNow(cancelledReason || "cancelled");
          }
        }, 250);
        safetyMonitor.unref();

        try {
          await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
          logger.log(
            "survival",
            `harvest start block=${target.block.name} pos=(${target.position.x},${target.position.y},${target.position.z}) mode=${mode}`
          );
          await Promise.race([bot.dig(target.block, true), timeoutPromise]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("survival", `harvest failed: ${message}`);
          if (!harvestCancelled) {
            chat.send("I could not harvest that block.", "harvest-failed");
          }
          harvestActive = false;
          if (harvestTimeoutHandle) {
            clearTimeout(harvestTimeoutHandle);
            harvestTimeoutHandle = null;
          }
          clearInterval(safetyMonitor);
          return false;
        }

        clearInterval(safetyMonitor);
        if (harvestTimeoutHandle) {
          clearTimeout(harvestTimeoutHandle);
          harvestTimeoutHandle = null;
        }

        if (harvestCancelled) {
          chat.send("Harvest stopped for safety.", "harvest-stopped-safety");
          harvestActive = false;
          harvestTargetName = null;
          return false;
        }

        harvestActive = false;
        harvestTargetName = null;
        chat.send(`Harvested ${target.block.name}.`, "harvest-success");
        return true;
      }

      case "REPORT_HOME_STATUS": {
        const home = state.state.homeRecord;
        if (!home) {
          chat.send("No home point set.", "home-status-empty");
          return true;
        }

        chat.send(
          `Home is set at (${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)}) in ${home.dimension ?? "unknown"}.`,
          "home-status"
        );
        return true;
      }

      case "CLEAR_HOME": {
        return movement.clearHome(item.requestedBy);
      }

      case "REPORT_SAFETY_TEST": {
        const mining = safety.validateAction(item.requestedBy, { type: "MINE_BLOCK" }, { dryRun: true });
        const harvesting = safety.validateAction(
          item.requestedBy,
          { type: "HARVEST_BLOCK", mode: "front" },
          { dryRun: true }
        );
        const cropHarvesting = safety.validateAction(
          item.requestedBy,
          { type: "HARVEST_BLOCK", mode: "crop" },
          { dryRun: true }
        );
        const combat = safety.validateAction(item.requestedBy, { type: "ATTACK_ENTITY" }, { dryRun: true });
        const building = safety.validateAction(item.requestedBy, { type: "PLACE_BLOCK" }, { dryRun: true });
        const crafting = safety.validateAction(item.requestedBy, { type: "CRAFT_ITEM", itemName: "oak_planks" }, { dryRun: true });
        const inventory = safety.validateAction(item.requestedBy, { type: "OPEN_INVENTORY" }, { dryRun: true });
        const eating = safety.validateAction(item.requestedBy, { type: "EAT_FOOD" }, { dryRun: true });
        const equip = safety.validateAction(item.requestedBy, { type: "EQUIP_ITEM", category: "pickaxe" }, { dryRun: true });
        const wandering = safety.validateAction(item.requestedBy, { type: "WANDER_SAFE", center: "home" }, { dryRun: true });

        const miningWord = mining.allowed ? "allowed" : "blocked";
        const harvestingWord = harvesting.allowed ? "allowed" : "blocked";
        const cropHarvestingWord = cropHarvesting.allowed ? "allowed" : "blocked";
        const combatWord = combat.allowed ? "allowed" : "blocked";
        const buildingWord = building.allowed ? "allowed" : "blocked";
        const craftingWord = crafting.allowed ? "allowed" : "blocked";
        const inventoryWord = inventory.allowed ? "allowed" : "blocked";
        const eatingWord = eating.allowed ? "allowed" : "blocked";
        const equipWord = equip.allowed ? "allowed" : "blocked";
        const wanderingWord = wandering.allowed ? "allowed" : "blocked";
        const aiWord = config.enableAiBridge ? "allowed" : "blocked";
        const inventoryReadWord = "allowed";

        const result = `Safety test: eating ${eatingWord}, equip ${equipWord}, mining ${miningWord}, harvesting ${harvestingWord}, cropHarvesting ${cropHarvestingWord}, wandering ${wanderingWord}, combat ${combatWord}, building ${buildingWord}, crafting ${craftingWord}, containers ${inventoryWord}, ai ${aiWord}, inventoryRead ${inventoryReadWord}.`;

        logger.log("safety", "Safety test results", {
          mining,
          harvesting,
          cropHarvesting,
          combat,
          building,
          crafting,
          inventory,
          eating,
          equip,
          wandering
        });
        chat.send(result, "safety-test");
        return true;
      }

      default: {
        if (SCAFFOLDED_CAPABILITY_ACTIONS.has(action.type)) {
          logger.warn("action", `Capability action scaffold invoked but not implemented: ${action.type}`);
          chat.send(`${action.type} is scaffolded but not implemented yet.`, "capability-scaffold");
          return false;
        }

        logger.warn("action", `Unhandled action type: ${String((action as BotAction).type)}`);
        return false;
      }
    }
  }

  syncQueueState();

  return {
    queueAction,
    clearActionQueue,
    clearMovementActions,
    getActionQueueSummary
  };
}


