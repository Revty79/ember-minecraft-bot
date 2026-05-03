import type { AppConfig } from "../config";
import type { BotAction, Logger, SafetyDecision, SafetyLayer, StateStore } from "./types";

export function createSafetyLayer(config: AppConfig, state: StateStore, logger: Logger): SafetyLayer {
  const actionTimestamps: number[] = [];
  const ownerLower = config.ownerUsername.toLowerCase();

  const ownerOnlyTypes = new Set<BotAction["type"]>([
    "COME_TO_OWNER",
    "FOLLOW_OWNER",
    "STOP_MOVING",
    "RESPAWN",
    "LOOK_AT_OWNER",
    "REPORT_STATE",
    "REPORT_OBSTACLE",
    "REPORT_DISTANCE",
    "REPORT_DEBUG",
    "REPORT_AI_STATUS",
    "REPORT_ACTION_QUEUE"
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
    if (!config.allowMining && action.type === "CHAT" && action.message.toLowerCase().includes("mining")) {
      return reject("Mining actions are disabled by policy.", requestor, action);
    }

    if (!config.allowCombat && action.type === "CHAT" && action.message.toLowerCase().includes("combat")) {
      return reject("Combat actions are disabled by policy.", requestor, action);
    }

    if (!config.allowBuilding && action.type === "CHAT" && action.message.toLowerCase().includes("building")) {
      return reject("Building actions are disabled by policy.", requestor, action);
    }

    if (!config.allowInventory && action.type === "CHAT" && action.message.toLowerCase().includes("inventory")) {
      return reject("Inventory actions are disabled by policy.", requestor, action);
    }

    return { allowed: true, action };
  }

  function validateAction(requestor: string, action: BotAction): SafetyDecision {
    if (!canRunAnotherAction()) {
      return reject("Action rate limit reached.", requestor, action);
    }

    if (ownerOnlyTypes.has(action.type) && !isOwner(requestor)) {
      return reject("Only owner can run that action.", requestor, action);
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

    recordActionRateUsage();
    state.setBlockedReason(null);
    return { allowed: true, action: normalizedAction };
  }

  return {
    isOwner,
    isPrivilegedRequester,
    normalizeChatMessage,
    validateAction
  };
}
