import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { AppConfig } from "../config";
import { getBestPickaxe, getEquipmentSummary, getFoodItems, getInventorySummary } from "./inventory";
import type {
  ActionController,
  BlockClass,
  BlockSummary,
  ChatController,
  Logger,
  MovementController,
  PerceptionController,
  ShadowBridgeController,
  ShadowBridgeStatus,
  ShadowConfidence,
  ShadowObservation,
  ShadowSendOutcome,
  StateStore,
  Vec3Snapshot
} from "./types";

const SKIP_LOG_INTERVAL_MS = 30_000;
const CONFIG_LOG_INTERVAL_MS = 60_000;

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

function asShadowConfidence(value: unknown): ShadowConfidence | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
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

function mineableOreSummary(
  config: AppConfig,
  visibleOres: BlockSummary[],
  state: StateStore,
  hasPickaxe: boolean
): BlockSummary[] {
  if (!config.allowMining) return [];
  if (!state.state.alive || !state.state.ready || !state.state.position) return [];
  const proximity = state.state.dangerSummary.proximity;
  if (proximity === "close" || proximity === "critical") return [];
  if (config.requireToolForOres && !hasPickaxe) return [];

  return visibleOres.filter(
    (ore) => config.miningAllowedBlocks.includes(ore.name) && !config.miningForbiddenBlocks.includes(ore.name)
  );
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

export function createShadowBridgeController(
  config: AppConfig,
  bot: Bot,
  state: StateStore,
  chat: ChatController,
  movement: MovementController,
  perception: PerceptionController,
  actions: ActionController,
  logger: Logger
): ShadowBridgeController {
  let inFlight = false;
  let lastConfigLogAt = 0;
  const skipLogAtByReason: Partial<Record<ShadowSendOutcome["code"], number>> = {};

  function buildObservation(): ShadowObservation {
    const snapshot = state.getBotSnapshot();
    const perceptionSnapshot = perception.getPerceptionSnapshot();
    const visibleOres = perception.getNearbyOresSummary(6);
    const bestPickaxe = getBestPickaxe(bot);
    const hasPickaxe = Boolean(bestPickaxe);
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
      mode: "shadow",
      build: {
        version: process.env.npm_package_version ?? null
      },
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
      mining: {
        enabled: config.allowMining,
        allowedBlocks: [...config.miningAllowedBlocks],
        forbiddenBlocks: [...config.miningForbiddenBlocks],
        maxDistance: config.miningMaxDistance,
        homeProtectionRadius: config.homeProtectionRadius,
        previewMaxDistance: config.minePreviewMaxDistance,
        mineableOres: mineableOreSummary(config, visibleOres, state, hasPickaxe)
      },
      harvesting: {
        enabled: config.allowHarvest,
        cropHarvestingEnabled: config.allowCropHarvest,
        replantEnabled: config.replantCrops,
        allowedBlocks: [...config.harvestAllowedBlocks],
        forbiddenBlocks: [...config.harvestForbiddenBlocks],
        maxDistance: config.harvestMaxDistance
      },
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
      actionQueue: actions.getActionQueueSummary(),
      recentEvents: state.getRecentEvents(config.shadowSendRecentEvents)
    };
  }

  function trackError(message: string): void {
    state.setShadowState({
      shadowLastError: message,
      shadowErrorCount: state.state.shadowErrorCount + 1
    });
  }

  function maybeLogConfigError(message: string): void {
    const now = Date.now();
    if (now - lastConfigLogAt < CONFIG_LOG_INTERVAL_MS) return;
    lastConfigLogAt = now;
    logger.error("shadow", message);
  }

  function maybeLogSkip(code: ShadowSendOutcome["code"], message: string): void {
    const now = Date.now();
    const last = skipLogAtByReason[code] ?? 0;
    if (now - last < SKIP_LOG_INTERVAL_MS) return;
    skipLogAtByReason[code] = now;
    logger.log("shadow", message);
  }

  async function sendObservationToShadowBridge(
    options?: { force?: boolean; reason?: string }
  ): Promise<ShadowSendOutcome> {
    const force = options?.force === true;

    if (!config.enableAiShadow) {
      const message = "Shadow bridge send skipped: ENABLE_AI_SHADOW=false.";
      maybeLogSkip("skipped_disabled", message);
      state.addEvent("shadow_skipped", message);
      return { code: "skipped_disabled", message };
    }

    if (inFlight) {
      const message = "Shadow bridge send skipped: previous request still in flight.";
      maybeLogSkip("skipped_in_flight", message);
      state.addEvent("shadow_skipped", message);
      return { code: "skipped_in_flight", message };
    }

    if (!force && (!state.state.ready || !state.state.alive)) {
      const message = "Shadow bridge send skipped: bot is not ready/alive.";
      maybeLogSkip("skipped_not_ready", message);
      state.addEvent("shadow_skipped", message, {
        ready: state.state.ready,
        alive: state.state.alive
      });
      return { code: "skipped_not_ready", message };
    }

    if (!force && !config.shadowSendWhileMoving && movement.isMoving()) {
      const message = "Shadow bridge send skipped: moving and SHADOW_SEND_WHILE_MOVING=false.";
      maybeLogSkip("skipped_moving", message);
      state.addEvent("shadow_skipped", message, {
        mode: movement.getMode()
      });
      return { code: "skipped_moving", message };
    }

    const url = config.shadowBridgeUrl?.trim() ?? "";
    const token = config.shadowBridgeToken?.trim() ?? "";
    if (!url || !token) {
      const message = "Shadow bridge is enabled but SHADOW_BRIDGE_URL or SHADOW_BRIDGE_TOKEN is missing.";
      trackError(message);
      maybeLogConfigError(message);
      state.addEvent("shadow_error", message, {
        hasUrl: Boolean(url),
        hasToken: Boolean(token)
      });
      return { code: "skipped_unconfigured", message };
    }

    const observation = buildObservation();
    const sentAt = nowIso();
    inFlight = true;
    state.setShadowState({
      shadowLastSentAt: sentAt,
      shadowLastError: null,
      shadowSendCount: state.state.shadowSendCount + 1
    });
    state.addEvent("shadow_sent", "Shadow observation sent.", {
      reason: options?.reason ?? "interval"
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.shadowTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(observation),
        signal: abortController.signal
      });

      const bodyText = await response.text();
      if (!response.ok) {
        const snippet = bodyText.slice(0, 280);
        throw new Error(`Shadow bridge response ${response.status}: ${snippet}`);
      }

      const responseAt = nowIso();
      state.setShadowState({
        shadowLastResponseAt: responseAt,
        shadowLastError: null
      });

      if (!bodyText.trim()) {
        return {
          code: "sent",
          message: "Shadow observation sent. Response body was empty."
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        const message = "Shadow bridge response was not valid JSON.";
        trackError(message);
        state.addEvent("shadow_error", message);
        logger.error("shadow", message);
        return { code: "error", message };
      }

      if (!payload || typeof payload !== "object") {
        const message = "Shadow bridge response JSON was not an object.";
        trackError(message);
        state.addEvent("shadow_error", message);
        logger.error("shadow", message);
        return { code: "error", message };
      }

      const body = payload as {
        mode?: unknown;
        executed?: unknown;
        reply?: unknown;
        wouldDo?: unknown;
        confidence?: unknown;
        allowedActionTypes?: unknown;
        actions?: unknown;
        logId?: unknown;
      };

      const reply = asOptionalText(body.reply);
      const wouldDo = asOptionalText(body.wouldDo);
      const confidence = asShadowConfidence(body.confidence);
      const logId = asOptionalText(body.logId);
      const executed = body.executed === true;
      const actionCount = Array.isArray(body.actions) ? body.actions.length : 0;

      state.setShadowState({
        shadowLastReply: reply,
        shadowLastWouldDo: wouldDo,
        shadowLastConfidence: confidence,
        shadowLastLogId: logId,
        shadowLastError: null
      });

      state.addEvent("shadow_response", "Shadow response received.", {
        mode: body.mode,
        executed,
        actionCount,
        confidence,
        logId
      });

      if (config.shadowLogResponse) {
        logger.log("shadow", "Shadow response", {
          reply,
          wouldDo,
          confidence,
          logId,
          executed,
          actionCount
        });
      }

      if (executed) {
        logger.warn("shadow", "Shadow response reported executed=true; ignoring in shadow mode.");
      }

      if (actionCount > 0) {
        logger.warn("shadow", `Shadow response included ${actionCount} action(s); ignored in v12.`);
      }

      if (config.shadowChatSummary) {
        const summaryText = reply ?? wouldDo;
        if (summaryText) {
          chat.send(`Shadow: ${summarizeForChat(summaryText)}`, "shadow-chat-summary");
        }
      }

      return {
        code: "sent",
        message: "Shadow observation sent and response processed."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackError(message);
      state.addEvent("shadow_error", "Shadow bridge call failed.", {
        error: message
      });
      logger.error("shadow", `bridge call failed: ${message}`);
      return { code: "error", message };
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  function getStatus(): ShadowBridgeStatus {
    const url = config.shadowBridgeUrl?.trim() ?? "";
    const token = config.shadowBridgeToken?.trim() ?? "";
    return {
      enabled: config.enableAiShadow,
      configured: Boolean(url) && Boolean(token),
      url: url.length > 0 ? url : null,
      lastSentAt: state.state.shadowLastSentAt,
      lastResponseAt: state.state.shadowLastResponseAt,
      lastError: state.state.shadowLastError,
      lastReply: state.state.shadowLastReply,
      lastWouldDo: state.state.shadowLastWouldDo,
      lastConfidence: state.state.shadowLastConfidence,
      lastLogId: state.state.shadowLastLogId,
      sendCount: state.state.shadowSendCount,
      errorCount: state.state.shadowErrorCount,
      inFlight
    };
  }

  return {
    getStatus,
    sendObservationToShadowBridge,
    buildObservation
  };
}
