import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { AppConfig } from "../config";
import { getEquipmentSummary, getFoodItems, getInventorySummary } from "./inventory";
import type {
  ActionController,
  BlockClass,
  BotAction,
  ChatController,
  Logger,
  MovementController,
  PerceptionController,
  SafetyLayer,
  StateStore,
  SupervisedActionResult,
  SupervisedActionType,
  SupervisedBridgeController,
  SupervisedBridgeStatus,
  SupervisedConfidence,
  SupervisedObservation,
  SupervisedSendOutcome,
  Vec3Snapshot
} from "./types";

const SKIP_LOG_INTERVAL_MS = 30_000;
const CONFIG_LOG_INTERVAL_MS = 60_000;
const SUPERVISED_REQUESTOR = "SUPERVISED_AI";
const FORBIDDEN_SCOPES = [
  "mining",
  "building",
  "combat",
  "crafting",
  "containers",
  "raw_movement_control",
  "raw_keyboard_mouse_control",
  "arbitrary_ai_chat"
];

type ParsedSupervisedResponseAction = {
  requestedAction: string;
  reason: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function round1(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
}

function computeDistance(a: Vec3Snapshot, b: Vec3Snapshot): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function asOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function summarizeForChat(value: string, maxLength = 150): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function targetBlockSummary(
  bot: Bot,
  perception: PerceptionController,
  maxDistance: number
): { name: string | null; category: BlockClass | null; distance: number | null } {
  if (!bot.entity) {
    return { name: null, category: null, distance: null };
  }

  const fromCursor = bot.blockAtCursor(maxDistance);
  if (fromCursor) {
    const category = perception.classifyBlock(fromCursor.name);
    const distance = bot.entity.position.distanceTo(fromCursor.position);
    return {
      name: fromCursor.name,
      category,
      distance: round1(distance)
    };
  }

  const obstacle = perception.getImmediateObstacles();
  const front = obstacle.blockFrontFeet.position;
  if (!front) {
    return { name: null, category: null, distance: null };
  }

  const block = bot.blockAt(new Vec3(front.x, front.y, front.z));
  if (!block) {
    return { name: null, category: null, distance: null };
  }

  return {
    name: block.name,
    category: perception.classifyBlock(block.name),
    distance: round1(bot.entity.position.distanceTo(block.position))
  };
}

function confidenceRank(value: SupervisedConfidence): number {
  if (value === "low") return 1;
  if (value === "medium") return 2;
  return 3;
}

function asConfidence(value: unknown): SupervisedConfidence | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function normalizeSupervisedActionType(value: string): SupervisedActionType | null {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "status":
    case "report_status":
      return "STATUS";
    case "look":
    case "look_around":
      return "LOOK";
    case "eat":
    case "eat_if_hungry":
      return "EAT_IF_HUNGRY";
    case "home":
    case "go_home":
      return "GO_HOME";
    case "stop":
      return "STOP";
    case "flee":
      return "FLEE";
    case "wander":
    case "wander_yard":
      return "WANDER_YARD";
    default:
      return null;
  }
}

function toBotAction(type: SupervisedActionType): BotAction {
  switch (type) {
    case "STATUS":
      return { type: "REPORT_STATUS" };
    case "LOOK":
      return { type: "REPORT_LOOK" };
    case "EAT_IF_HUNGRY":
      return { type: "EAT_FOOD" };
    case "GO_HOME":
      return { type: "GO_HOME" };
    case "STOP":
      return { type: "STOP_MOVING" };
    case "FLEE":
      return { type: "FLEE_DANGER" };
    case "WANDER_YARD":
      return { type: "WANDER_SAFE", center: "home" };
  }
}

function parseRequestedActions(value: unknown): ParsedSupervisedResponseAction[] {
  if (!Array.isArray(value)) return [];
  const parsed: ParsedSupervisedResponseAction[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const actionText = item.trim();
      if (actionText.length > 0) {
        parsed.push({
          requestedAction: actionText,
          reason: null
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const candidate = item as { type?: unknown; reason?: unknown };
    if (typeof candidate.type !== "string" || candidate.type.trim().length === 0) continue;
    parsed.push({
      requestedAction: candidate.type.trim(),
      reason: asOptionalText(candidate.reason)
    });
  }
  return parsed;
}

function hasHomeState(state: StateStore): boolean {
  return Boolean(state.state.homeRecord || state.state.homePosition);
}

function shouldAllowFleeByDanger(state: StateStore): boolean {
  const proximity = state.state.dangerSummary.proximity;
  return proximity === "medium" || proximity === "close" || proximity === "critical";
}

function deriveResultUrl(supervisedUrl: string | null | undefined): string | null {
  if (!supervisedUrl) return null;
  try {
    const parsed = new URL(supervisedUrl);
    parsed.pathname = "/api/minecraft/result";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function createSupervisedBridgeController(
  config: AppConfig,
  bot: Bot,
  state: StateStore,
  chat: ChatController,
  movement: MovementController,
  perception: PerceptionController,
  actions: ActionController,
  safety: SafetyLayer,
  logger: Logger
): SupervisedBridgeController {
  let inFlight = false;
  let lastConfigLogAt = 0;
  const skipLogAtByReason: Record<string, number> = {};
  const allowedActionsSet = new Set<SupervisedActionType>();

  for (const configuredAction of config.supervisedAllowedActions) {
    const normalized = normalizeSupervisedActionType(configuredAction);
    if (normalized) {
      allowedActionsSet.add(normalized);
    }
  }

  const allowedActions = Array.from(allowedActionsSet.values());

  function buildObservation(): SupervisedObservation {
    const snapshot = state.getBotSnapshot();
    const perceptionSnapshot = perception.getPerceptionSnapshot();
    const targetBlock = targetBlockSummary(bot, perception, config.minePreviewMaxDistance);
    const roundedPosition: Vec3Snapshot | null = snapshot.position
      ? {
          x: Number(snapshot.position.x.toFixed(1)),
          y: Number(snapshot.position.y.toFixed(1)),
          z: Number(snapshot.position.z.toFixed(1))
        }
      : null;
    const homePosition: Vec3Snapshot | null = state.state.homeRecord
      ? {
          x: state.state.homeRecord.x,
          y: state.state.homeRecord.y,
          z: state.state.homeRecord.z
        }
      : state.state.homePosition
        ? { ...state.state.homePosition }
        : null;
    const distanceFromHome =
      roundedPosition && homePosition ? round1(computeDistance(roundedPosition, homePosition)) : null;
    const insideRadius = distanceFromHome === null ? null : distanceFromHome <= config.wanderRadius;

    return {
      timestamp: nowIso(),
      source: "ember-minecraft-bot",
      mode: "supervised",
      build: {
        version: process.env.npm_package_version ?? null
      },
      botUsername: snapshot.username,
      ownerUsername: config.ownerUsername,
      bot: snapshot,
      task: { ...snapshot.task },
      movement: { ...snapshot.movement },
      vitals: {
        health: round1(snapshot.health),
        maxHealth: 20,
        food: snapshot.food === null ? null : Math.round(snapshot.food),
        maxFood: 20,
        saturation: round1(snapshot.saturation),
        oxygen: snapshot.oxygen === null ? null : Math.round(snapshot.oxygen),
        alive: snapshot.alive,
        danger: snapshot.dangerSummary.proximity,
        position: roundedPosition
      },
      hungerFood: {
        hungerStatus: snapshot.hungerStatus,
        foodItems: getFoodItems(bot)
      },
      equipment: getEquipmentSummary(bot),
      inventory: getInventorySummary(bot),
      dangerSummary: { ...snapshot.dangerSummary },
      nearbyPlayers: perceptionSnapshot.nearbyPlayers.map((entry) => ({ ...entry })),
      nearbyEntities: perceptionSnapshot.nearbyEntities.map((entry) => ({ ...entry })),
      nearbyHostiles: perceptionSnapshot.nearbyHostileMobs.map((entry) => ({ ...entry })),
      perception: perceptionSnapshot,
      targetBlock,
      yard: {
        enabled: config.allowWander,
        centerMode: config.wanderCenterMode,
        radius: config.wanderRadius,
        homePosition,
        distanceFromHome,
        insideRadius,
        active: snapshot.movement.wanderActive,
        steps: snapshot.movement.wanderSteps,
        maxSteps: snapshot.movement.wanderMaxSteps,
        endsAt: snapshot.movement.wanderEndsAt,
        lastStopReason: snapshot.movement.wanderLastStopReason
      },
      safetyFlags: { ...snapshot.safetyFlags },
      capabilities: { ...snapshot.capabilities },
      actionQueue: actions.getActionQueueSummary(),
      recentEvents: state.getRecentEvents(config.shadowSendRecentEvents),
      supervised: {
        allowedActions,
        forbiddenScopes: [...FORBIDDEN_SCOPES]
      }
    };
  }

  function maybeLogConfigError(message: string): void {
    const now = Date.now();
    if (now - lastConfigLogAt < CONFIG_LOG_INTERVAL_MS) return;
    lastConfigLogAt = now;
    logger.error("supervised", message);
  }

  function maybeLogSkip(code: string, message: string): void {
    const now = Date.now();
    const last = skipLogAtByReason[code] ?? 0;
    if (now - last < SKIP_LOG_INTERVAL_MS) return;
    skipLogAtByReason[code] = now;
    logger.log("supervised", message);
  }

  function updateCounts(result: SupervisedActionResult): void {
    const nextAccepted = state.state.supervisedAcceptedCount + (result.accepted ? 1 : 0);
    const nextRejected = state.state.supervisedRejectedCount + (result.accepted ? 0 : 1);
    const nextExecuted = state.state.supervisedExecutedCount + (result.executed ? 1 : 0);
    state.setSupervisedState({
      supervisedAcceptedCount: nextAccepted,
      supervisedRejectedCount: nextRejected,
      supervisedExecutedCount: nextExecuted
    });
  }

  async function maybeReportResult(logId: string | null, result: SupervisedActionResult): Promise<void> {
    if (!config.supervisedReportResults) return;
    const token = config.supervisedBridgeToken?.trim() ?? "";
    const resultUrl = deriveResultUrl(config.supervisedBridgeUrl);
    if (!resultUrl || !token) return;

    const queueSummary = actions.getActionQueueSummary();
    const payload = {
      timestamp: nowIso(),
      source: "ember-minecraft-bot",
      mode: "supervised",
      logId,
      requestedAction: result.requestedAction,
      normalizedAction: result.normalizedAction,
      accepted: result.accepted,
      executed: result.executed,
      success: result.success,
      rejectionReason: result.accepted ? null : result.reason,
      safetyReason: result.accepted ? null : result.reason,
      botResultSummary: result.reason,
      actionId: null,
      finalMode: movement.getMode(),
      actionQueue: queueSummary
    };

    try {
      const response = await fetch(resultUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`result response ${response.status}: ${body.slice(0, 280)}`);
      }
      state.addEvent("supervised_result_sent", "Supervised result reported.", {
        requestedAction: result.requestedAction,
        accepted: result.accepted,
        success: result.success
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("supervised", `result reporting failed: ${message}`);
      state.addEvent("supervised_result_error", "Supervised result reporting failed.", {
        error: message
      });
    }
  }

  function evaluateQueuedAction(
    requestedAction: ParsedSupervisedResponseAction,
    minConfidence: SupervisedConfidence,
    responseConfidence: SupervisedConfidence,
    allowedActionSet: Set<SupervisedActionType>
  ): SupervisedActionResult {
    const requestedName = requestedAction.requestedAction;
    const normalizedAction = normalizeSupervisedActionType(requestedName);

    if (!normalizedAction) {
      return {
        requestedAction: requestedName,
        normalizedAction: null,
        accepted: false,
        executed: false,
        success: false,
        reason: "Rejected: action is unsupported or forbidden in supervised mode.",
        queuedAction: null
      };
    }

    if (!allowedActionSet.has(normalizedAction)) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: "Rejected: action is not in SUPERVISED_ALLOWED_ACTIONS.",
        queuedAction: null
      };
    }

    if (confidenceRank(responseConfidence) < confidenceRank(minConfidence)) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: `Rejected: confidence ${responseConfidence} is below required ${minConfidence}.`,
        queuedAction: null
      };
    }

    if (config.supervisedRequireSafeState && normalizedAction !== "STOP") {
      if (!state.state.ready || !state.state.alive || !movement.isEntityPositionHealthy()) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: supervised safe-state gate requires ready/alive/healthy position.",
          queuedAction: null
        };
      }
    }

    if (normalizedAction === "GO_HOME" && !hasHomeState(state)) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: "Rejected: home is not set.",
        queuedAction: null
      };
    }

    if (normalizedAction === "WANDER_YARD") {
      if (!hasHomeState(state)) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: wander yard requires a home position.",
          queuedAction: null
        };
      }
      if (state.state.dangerSummary.proximity !== "none") {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: wander yard blocked while danger is nearby.",
          queuedAction: null
        };
      }
      if (state.state.health !== null && state.state.health <= config.wanderLowHealthThreshold) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: wander yard blocked due to low health.",
          queuedAction: null
        };
      }
      if (state.state.food !== null && state.state.food <= config.wanderLowFoodThreshold) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: wander yard blocked due to low food.",
          queuedAction: null
        };
      }
    }

    if (normalizedAction === "EAT_IF_HUNGRY") {
      if (state.state.food !== null && state.state.food >= 20) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: bot is not hungry.",
          queuedAction: null
        };
      }
      const availableFood = getFoodItems(bot).reduce((sum, entry) => sum + entry.count, 0);
      if (availableFood <= 0) {
        return {
          requestedAction: requestedName,
          normalizedAction,
          accepted: false,
          executed: false,
          success: false,
          reason: "Rejected: no food available.",
          queuedAction: null
        };
      }
    }

    if (normalizedAction === "FLEE" && !shouldAllowFleeByDanger(state)) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: "Rejected: flee request requires nearby danger.",
        queuedAction: null
      };
    }

    const queueSummary = actions.getActionQueueSummary();
    const queueBusy = queueSummary.queued > 0 || queueSummary.running !== null;
    const busyOverride = normalizedAction === "STOP" || normalizedAction === "FLEE";
    if (queueBusy && !busyOverride) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: "Rejected: action queue is busy.",
        queuedAction: null
      };
    }

    const mappedAction = toBotAction(normalizedAction);
    const dryRun = safety.validateAction(SUPERVISED_REQUESTOR, mappedAction, { dryRun: true });
    if (!dryRun.allowed) {
      return {
        requestedAction: requestedName,
        normalizedAction,
        accepted: false,
        executed: false,
        success: false,
        reason: `Rejected by safety: ${dryRun.reason ?? "blocked"}`,
        queuedAction: null
      };
    }

    actions.queueAction(SUPERVISED_REQUESTOR, mappedAction);
    return {
      requestedAction: requestedName,
      normalizedAction,
      accepted: true,
      executed: true,
      success: true,
      reason: `Accepted: mapped to ${mappedAction.type}.`,
      queuedAction: mappedAction.type
    };
  }

  async function sendObservationToSupervisedBridge(
    options?: { force?: boolean; reason?: string }
  ): Promise<SupervisedSendOutcome> {
    const force = options?.force === true;
    const configuredUrl = config.supervisedBridgeUrl?.trim() ?? "";
    const configuredToken = config.supervisedBridgeToken?.trim() ?? "";
    const configured = Boolean(configuredUrl) && Boolean(configuredToken);

    if (!config.enableAiSupervised) {
      const message = "Supervised bridge send skipped: ENABLE_AI_SUPERVISED=false.";
      maybeLogSkip("disabled", message);
      state.addEvent("supervised_skipped", message);
      return { code: "skipped_disabled", message, results: [] };
    }

    if (inFlight) {
      const message = "Supervised bridge send skipped: previous request still in flight.";
      maybeLogSkip("in_flight", message);
      state.addEvent("supervised_skipped", message);
      return { code: "skipped_in_flight", message, results: [] };
    }

    if (!force && (!state.state.ready || !state.state.alive)) {
      const message = "Supervised bridge send skipped: bot is not ready/alive.";
      maybeLogSkip("not_ready", message);
      state.addEvent("supervised_skipped", message, {
        ready: state.state.ready,
        alive: state.state.alive
      });
      return { code: "skipped_not_ready", message, results: [] };
    }

    if (!force && !config.supervisedSendWhileMoving && movement.isMoving()) {
      const message = "Supervised bridge send skipped: moving and SUPERVISED_SEND_WHILE_MOVING=false.";
      maybeLogSkip("moving", message);
      state.addEvent("supervised_skipped", message, {
        mode: movement.getMode()
      });
      return { code: "skipped_moving", message, results: [] };
    }

    if (!configured) {
      const message = "Supervised bridge is enabled but SUPERVISED_BRIDGE_URL or SUPERVISED_BRIDGE_TOKEN is missing.";
      state.setSupervisedState({
        supervisedLastError: message,
        supervisedErrorCount: state.state.supervisedErrorCount + 1,
        supervisedConfigured: false
      });
      maybeLogConfigError(message);
      state.addEvent("supervised_error", message, {
        hasUrl: Boolean(configuredUrl),
        hasToken: Boolean(configuredToken)
      });
      return { code: "skipped_unconfigured", message, results: [] };
    }

    const observation = buildObservation();
    inFlight = true;
    state.setSupervisedState({
      supervisedInFlight: true,
      supervisedLastSentAt: nowIso(),
      supervisedLastError: null,
      supervisedConfigured: true,
      supervisedSendCount: state.state.supervisedSendCount + 1
    });
    state.addEvent("supervised_sent", "Supervised observation sent.", {
      reason: options?.reason ?? "interval"
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.supervisedTimeoutMs);

    try {
      const response = await fetch(configuredUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${configuredToken}`
        },
        body: JSON.stringify(observation),
        signal: abortController.signal
      });

      const bodyText = await response.text();
      if (!response.ok) {
        const snippet = bodyText.slice(0, 280);
        throw new Error(`Supervised bridge response ${response.status}: ${snippet}`);
      }

      if (!bodyText.trim()) {
        state.setSupervisedState({
          supervisedLastResponseAt: nowIso()
        });
        return {
          code: "sent_no_actions",
          message: "Supervised observation sent. Response was empty.",
          results: []
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        const message = "Supervised bridge response was not valid JSON.";
        state.setSupervisedState({
          supervisedLastError: message,
          supervisedErrorCount: state.state.supervisedErrorCount + 1
        });
        state.addEvent("supervised_error", message);
        logger.error("supervised", message);
        return { code: "error", message, results: [] };
      }

      if (!payload || typeof payload !== "object") {
        const message = "Supervised bridge response JSON was not an object.";
        state.setSupervisedState({
          supervisedLastError: message,
          supervisedErrorCount: state.state.supervisedErrorCount + 1
        });
        state.addEvent("supervised_error", message);
        logger.error("supervised", message);
        return { code: "error", message, results: [] };
      }

      const body = payload as {
        mode?: unknown;
        enabled?: unknown;
        executed?: unknown;
        reply?: unknown;
        wouldDo?: unknown;
        confidence?: unknown;
        actions?: unknown;
        logId?: unknown;
      };

      if (body.mode !== "supervised") {
        const message = `Supervised bridge response mode was not supervised (got ${String(body.mode)}).`;
        state.setSupervisedState({
          supervisedLastError: message,
          supervisedErrorCount: state.state.supervisedErrorCount + 1
        });
        state.addEvent("supervised_error", message);
        logger.error("supervised", message);
        return { code: "error", message, results: [] };
      }

      const responseEnabled = body.enabled !== false;
      const reply = asOptionalText(body.reply);
      const wouldDo = asOptionalText(body.wouldDo);
      const confidence = asConfidence(body.confidence);
      const logId = asOptionalText(body.logId);
      const declaredExecuted = body.executed === true;
      const requestedActions = parseRequestedActions(body.actions);
      const results: SupervisedActionResult[] = [];

      state.setSupervisedState({
        supervisedLastResponseAt: nowIso(),
        supervisedLastReply: reply,
        supervisedLastWouldDo: wouldDo,
        supervisedLastConfidence: confidence,
        supervisedLastLogId: logId,
        supervisedLastRequestedActions: requestedActions.map((entry) => entry.requestedAction),
        supervisedLastAcceptedActions: [],
        supervisedLastRejectedActions: [],
        supervisedLastError: null
      });

      state.addEvent("supervised_response", "Supervised response received.", {
        confidence,
        declaredExecuted,
        actionCount: requestedActions.length,
        logId
      });

      if (declaredExecuted) {
        logger.warn("supervised", "Supervised response reported executed=true; body remains final executor.");
      }

      if (config.supervisedLogResponse) {
        logger.log("supervised", "Supervised response", {
          reply,
          wouldDo,
          confidence,
          requestedActions: requestedActions.map((entry) => entry.requestedAction),
          logId
        });
      }

      if (!responseEnabled) {
        return {
          code: "sent_no_actions",
          message: "Supervised response disabled execution.",
          results
        };
      }

      if (!confidence) {
        const message = "Supervised response missing or invalid confidence.";
        state.setSupervisedState({
          supervisedLastError: message,
          supervisedErrorCount: state.state.supervisedErrorCount + 1
        });
        logger.error("supervised", message);
        return { code: "error", message, results };
      }

      if (requestedActions.length === 0) {
        return {
          code: "sent_no_actions",
          message: "Supervised response contained no actions.",
          results
        };
      }

      const extra = requestedActions.slice(config.supervisedMaxActions);
      const evaluated = requestedActions.slice(0, config.supervisedMaxActions);
      for (const ignored of extra) {
        const rejected: SupervisedActionResult = {
          requestedAction: ignored.requestedAction,
          normalizedAction: normalizeSupervisedActionType(ignored.requestedAction),
          accepted: false,
          executed: false,
          success: false,
          reason: `Rejected: SUPERVISED_MAX_ACTIONS=${config.supervisedMaxActions} limit reached.`,
          queuedAction: null
        };
        updateCounts(rejected);
        results.push(rejected);
        state.addEvent("supervised_action_rejected", rejected.reason, {
          requestedAction: rejected.requestedAction
        });
        await maybeReportResult(logId, rejected);
      }

      for (const requested of evaluated) {
        const result = evaluateQueuedAction(
          requested,
          config.supervisedMinConfidence,
          confidence,
          allowedActionsSet
        );
        updateCounts(result);
        if (result.accepted) {
          state.addEvent("supervised_action_accepted", result.reason, {
            requestedAction: result.requestedAction,
            normalizedAction: result.normalizedAction,
            queuedAction: result.queuedAction
          });
        } else {
          state.addEvent("supervised_action_rejected", result.reason, {
            requestedAction: result.requestedAction,
            normalizedAction: result.normalizedAction
          });
        }
        results.push(result);
        await maybeReportResult(logId, result);
      }

      state.setSupervisedState({
        supervisedLastAcceptedActions: results.filter((entry) => entry.accepted).map((entry) => entry.requestedAction),
        supervisedLastRejectedActions: results
          .filter((entry) => !entry.accepted)
          .map((entry) => `${entry.requestedAction}: ${entry.reason}`)
      });

      if (config.supervisedChatSummary) {
        const summaryText = reply ?? wouldDo;
        if (summaryText) {
          chat.send(`Supervised: ${summarizeForChat(summaryText)}`, "supervised-chat-summary");
        }
      }

      const acceptedCount = results.filter((entry) => entry.accepted).length;
      const rejectedCount = results.length - acceptedCount;
      return {
        code: "sent",
        message: `Supervised response evaluated: accepted=${acceptedCount}, rejected=${rejectedCount}.`,
        results
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.setSupervisedState({
        supervisedLastError: message,
        supervisedErrorCount: state.state.supervisedErrorCount + 1
      });
      state.addEvent("supervised_error", "Supervised bridge call failed.", {
        error: message
      });
      logger.error("supervised", `bridge call failed: ${message}`);
      return { code: "error", message, results: [] };
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      state.setSupervisedState({
        supervisedInFlight: false
      });
    }
  }

  function getStatus(): SupervisedBridgeStatus {
    const url = config.supervisedBridgeUrl?.trim() ?? "";
    const token = config.supervisedBridgeToken?.trim() ?? "";
    const configured = Boolean(url) && Boolean(token);

    return {
      enabled: config.enableAiSupervised,
      configured,
      url: url.length > 0 ? url : null,
      minConfidence: config.supervisedMinConfidence,
      maxActions: config.supervisedMaxActions,
      allowedActions,
      lastSentAt: state.state.supervisedLastSentAt,
      lastResponseAt: state.state.supervisedLastResponseAt,
      lastError: state.state.supervisedLastError,
      lastReply: state.state.supervisedLastReply,
      lastWouldDo: state.state.supervisedLastWouldDo,
      lastConfidence: state.state.supervisedLastConfidence,
      lastLogId: state.state.supervisedLastLogId,
      sendCount: state.state.supervisedSendCount,
      errorCount: state.state.supervisedErrorCount,
      acceptedCount: state.state.supervisedAcceptedCount,
      rejectedCount: state.state.supervisedRejectedCount,
      executedCount: state.state.supervisedExecutedCount,
      lastRequestedActions: [...state.state.supervisedLastRequestedActions],
      lastAcceptedActions: [...state.state.supervisedLastAcceptedActions],
      lastRejectedActions: [...state.state.supervisedLastRejectedActions],
      inFlight
    };
  }

  return {
    getStatus,
    sendObservationToSupervisedBridge,
    buildObservation
  };
}
