import type { AppConfig } from "../config";
import type { BotAction, Logger, SafetyDecision, SafetyLayer, StateStore } from "./types";

const MINING_ACTIONS = new Set<BotAction["type"]>(["MINE_BLOCK"]);
const HARVEST_ACTIONS = new Set<BotAction["type"]>(["HARVEST_BLOCK"]);
const COMBAT_ACTIONS = new Set<BotAction["type"]>(["ATTACK_ENTITY"]);
const BUILDING_ACTIONS = new Set<BotAction["type"]>(["PLACE_BLOCK"]);
const CRAFTING_ACTIONS = new Set<BotAction["type"]>(["CRAFT_ITEM"]);
const INVENTORY_ACTIONS = new Set<BotAction["type"]>(["OPEN_INVENTORY"]);
const EATING_ACTIONS = new Set<BotAction["type"]>(["EAT_FOOD"]);
const EQUIP_ACTIONS = new Set<BotAction["type"]>(["EQUIP_ITEM"]);
const FLEE_ACTIONS = new Set<BotAction["type"]>(["FLEE_DANGER"]);
const WANDER_ACTIONS = new Set<BotAction["type"]>(["WANDER_SAFE"]);
const TASK_ACTIONS = new Set<BotAction["type"]>(["START_TASK", "STOP_TASK", "REPORT_TASK"]);
const TASK_START_ACTIONS = new Set<BotAction["type"]>(["START_TASK"]);
const WANDER_BLOCKED_ACTIONS = new Set<BotAction["type"]>([
  "MINE_BLOCK",
  "HARVEST_BLOCK",
  "ATTACK_ENTITY",
  "PLACE_BLOCK",
  "OPEN_INVENTORY",
  "CRAFT_ITEM"
]);

export function createSafetyLayer(config: AppConfig, state: StateStore, logger: Logger): SafetyLayer {
  const actionTimestamps: number[] = [];
  const ownerLower = config.ownerUsername.toLowerCase();

  const ownerOnlyTypes = new Set<BotAction["type"]>([
    "COME_TO_OWNER",
    "FOLLOW_OWNER",
    "STOP_MOVING",
    "RESPAWN",
    "LOOK_AT_OWNER",
    "SET_HOME",
    "GO_HOME",
    "SET_STAY_HOME",
    "FLEE_DANGER",
    "WANDER_SAFE",
    "STOP_WANDER",
    "MINE_BLOCK",
    "STOP_MINING",
    "HARVEST_BLOCK",
    "STOP_HARVEST",
    "EQUIP_ITEM",
    "EAT_FOOD",
    "CLEAR_HOME",
    "RECOVER",
    "REPORT_STATE",
    "REPORT_OBSTACLE",
    "REPORT_DISTANCE",
    "REPORT_DEBUG",
    "REPORT_AI_STATUS",
    "REPORT_SHADOW_STATUS",
    "REPORT_SHADOW_LAST",
    "REPORT_SHADOW_TEST",
    "REPORT_SHADOW_SUMMARY",
    "REPORT_ACTION_QUEUE",
    "REPORT_HOME_STATUS",
    "REPORT_SAFETY_TEST",
    "REPORT_INVENTORY",
    "REPORT_EQUIPMENT",
    "REPORT_FOOD",
    "REPORT_HUNGER",
    "REPORT_THREAT",
    "REPORT_TARGET",
    "REPORT_HARVEST_REPORT",
    "REPORT_YARD_STATUS",
    "REPORT_YARD_CHECK",
    "REPORT_TASK",
    "REPORT_BLOCK",
    "REPORT_ORES_NEARBY",
    "REPORT_ORE_REPORT",
    "START_TASK",
    "STOP_TASK"
  ]);

  function isOwner(username: string): boolean {
    return username.toLowerCase() === ownerLower;
  }

  function isPrivilegedRequester(requestor: string): boolean {
    if (isOwner(requestor)) return true;
    return requestor === "SYSTEM" || requestor === "AI";
  }

  function normalizeChatMessage(message: string): string {
    if (message.length <= config.maxChatLength) return message;
    return message.slice(0, config.maxChatLength);
  }

  function recordActionRateUsage(): void {
    const now = Date.now();
    actionTimestamps.push(now);

    const oneMinuteAgo = now - 60_000;
    while (actionTimestamps.length > 0 && actionTimestamps[0] < oneMinuteAgo) {
      actionTimestamps.shift();
    }
  }

  function canRunAnotherAction(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    while (actionTimestamps.length > 0 && actionTimestamps[0] < oneMinuteAgo) {
      actionTimestamps.shift();
    }
    return actionTimestamps.length < config.maxActionsPerMinute;
  }

  function reject(reason: string, requestor: string, action: BotAction): SafetyDecision {
    state.setBlockedReason(reason);
    state.addEvent("safety_rejection", reason, {
      requestor,
      action
    });
    logger.warn("safety", reason, { requestor, action });
    return { allowed: false, reason };
  }

  function validateCapabilityFlags(action: BotAction, requestor: string): SafetyDecision {
    if (!config.allowMining && MINING_ACTIONS.has(action.type)) {
      return reject("Mining is disabled by safety settings.", requestor, action);
    }

    if (!config.allowHarvest && HARVEST_ACTIONS.has(action.type)) {
      return reject("Harvesting is disabled by safety settings.", requestor, action);
    }

    if (action.type === "HARVEST_BLOCK" && action.mode === "crop" && !config.allowCropHarvest) {
      return reject("Crop harvesting is disabled by safety settings.", requestor, action);
    }

    if (!config.allowCombat && COMBAT_ACTIONS.has(action.type)) {
      return reject("Combat actions are disabled by policy.", requestor, action);
    }

    if (!config.allowBuilding && BUILDING_ACTIONS.has(action.type)) {
      return reject("Building actions are disabled by policy.", requestor, action);
    }

    if (CRAFTING_ACTIONS.has(action.type)) {
      return reject("Crafting actions are disabled by policy.", requestor, action);
    }

    if (!config.allowInventory && INVENTORY_ACTIONS.has(action.type)) {
      return reject("Inventory actions are disabled by policy.", requestor, action);
    }

    if (!config.allowEating && EATING_ACTIONS.has(action.type)) {
      return reject("Eating is disabled by safety settings.", requestor, action);
    }

    if (!config.allowEquip && EQUIP_ACTIONS.has(action.type)) {
      return reject("Equipment use is disabled by safety settings.", requestor, action);
    }

    if (!config.allowFlee && FLEE_ACTIONS.has(action.type)) {
      return reject("Flee actions are disabled by policy.", requestor, action);
    }

    if (!config.allowWander && WANDER_ACTIONS.has(action.type)) {
      return reject("Wandering is disabled by safety settings.", requestor, action);
    }

    if (!config.enableTaskSystem && TASK_START_ACTIONS.has(action.type)) {
      return reject("Task system is disabled by safety settings.", requestor, action);
    }

    return { allowed: true, action };
  }

  function validateAction(requestor: string, action: BotAction, options?: { dryRun?: boolean }): SafetyDecision {
    const dryRun = options?.dryRun ?? false;

    if (!dryRun && !canRunAnotherAction()) {
      return reject("Action rate limit reached.", requestor, action);
    }

    if (ownerOnlyTypes.has(action.type) && !isOwner(requestor) && !isPrivilegedRequester(requestor)) {
      return reject("Only owner can run that action.", requestor, action);
    }

    if (
      config.mineOwnerOnly &&
      action.type === "MINE_BLOCK" &&
      !isOwner(requestor)
    ) {
      return reject("Only owner can run mining actions.", requestor, action);
    }

    if (
      config.harvestOwnerOnly &&
      action.type === "HARVEST_BLOCK" &&
      !isOwner(requestor)
    ) {
      return reject("Only owner can run harvesting actions.", requestor, action);
    }

    if (config.wanderOwnerOnly && action.type === "WANDER_SAFE" && !isOwner(requestor)) {
      return reject("Only owner can run wandering actions.", requestor, action);
    }

    if (config.taskOwnerOnly && TASK_ACTIONS.has(action.type) && !isOwner(requestor)) {
      return reject("Only owner can run task actions.", requestor, action);
    }

    if (state.state.movement.mode === "wander" && WANDER_BLOCKED_ACTIONS.has(action.type)) {
      return reject("That action is blocked while wandering.", requestor, action);
    }

    const capabilityDecision = validateCapabilityFlags(action, requestor);
    if (!capabilityDecision.allowed) {
      return capabilityDecision;
    }

    const normalizedAction: BotAction =
      action.type === "CHAT"
        ? {
            ...action,
            message: normalizeChatMessage(action.message)
          }
        : action;

    if (!dryRun) {
      recordActionRateUsage();
      state.setBlockedReason(null);
    }

    return { allowed: true, action: normalizedAction };
  }

  return {
    isOwner,
    isPrivilegedRequester,
    normalizeChatMessage,
    validateAction
  };
}
