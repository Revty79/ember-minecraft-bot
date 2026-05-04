import type { AppConfig } from "../config";
import type { Bot } from "mineflayer";
import { getBestPickaxe, getEquipmentSummary, getFoodItems } from "./inventory";
import { Vec3 } from "vec3";
import type {
  ActionController,
  AiActionRequest,
  AiBridgeController,
  AiObservation,
  BlockClass,
  BlockSummary,
  BotAction,
  Logger,
  PerceptionController,
  Vec3Snapshot,
  StateStore
} from "./types";

const DISABLED_LOG_INTERVAL_MS = 60_000;

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  return value;
}

function asBotAction(value: unknown): BotAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const action = value as {
    type?: unknown;
    message?: unknown;
    reason?: unknown;
    radius?: unknown;
    distance?: unknown;
    blockName?: unknown;
    entityName?: unknown;
    itemName?: unknown;
    category?: unknown;
    mode?: unknown;
    force?: unknown;
  };

  if (typeof action.type !== "string") {
    return null;
  }

  switch (action.type) {
    case "CHAT": {
      if (typeof action.message !== "string") return null;
      return {
        type: "CHAT",
        message: action.message,
        reason: typeof action.reason === "string" ? action.reason : "ai-bridge"
      };
    }

    case "COME_TO_OWNER": {
      return {
        type: "COME_TO_OWNER",
        radius: asOptionalNumber(action.radius)
      };
    }

    case "FOLLOW_OWNER": {
      return {
        type: "FOLLOW_OWNER",
        distance: asOptionalNumber(action.distance)
      };
    }

    case "MINE_BLOCK": {
      return {
        type: "MINE_BLOCK",
        blockName: asOptionalString(action.blockName),
        mode: action.mode === "front" || action.mode === "ore" ? action.mode : undefined
      };
    }

    case "HARVEST_BLOCK": {
      return {
        type: "HARVEST_BLOCK",
        mode: action.mode === "front" || action.mode === "grass" || action.mode === "crop" ? action.mode : undefined
      };
    }

    case "ATTACK_ENTITY": {
      return {
        type: "ATTACK_ENTITY",
        entityName: asOptionalString(action.entityName)
      };
    }

    case "PLACE_BLOCK": {
      return {
        type: "PLACE_BLOCK",
        blockName: asOptionalString(action.blockName)
      };
    }

    case "OPEN_INVENTORY":
    case "STOP_HARVEST":
    case "STOP_MOVING":
    case "STOP_MINING":
    case "RESPAWN":
    case "LOOK_AT_OWNER":
    case "SET_HOME":
    case "GO_HOME":
    case "SET_STAY_HOME":
    case "FLEE_DANGER":
    case "CLEAR_HOME":
    case "RECOVER":
    case "REPORT_STATE":
    case "REPORT_OBSTACLE":
    case "REPORT_STATUS":
    case "REPORT_WHERE_ARE_YOU":
    case "REPORT_NEARBY":
    case "REPORT_LOOK":
    case "REPORT_HELP":
    case "REPORT_DISTANCE":
    case "REPORT_DEBUG":
    case "REPORT_AI_STATUS":
    case "REPORT_ACTION_QUEUE":
    case "REPORT_CAPABILITIES":
    case "REPORT_VITALS":
    case "REPORT_HUNGER":
    case "REPORT_DANGER":
    case "REPORT_THREAT":
    case "REPORT_INVENTORY":
    case "REPORT_EQUIPMENT":
    case "REPORT_FOOD":
    case "REPORT_MOVEMENT":
    case "REPORT_TARGET":
    case "REPORT_BLOCK":
    case "REPORT_ORES_NEARBY":
    case "REPORT_ORE_REPORT":
    case "REPORT_HARVEST_REPORT":
    case "REPORT_HOME_STATUS":
    case "REPORT_SAFETY_TEST": {
      return {
        type: action.type
      } as BotAction;
    }

    case "EQUIP_ITEM": {
      return {
        type: "EQUIP_ITEM",
        itemName: asOptionalString(action.itemName),
        category:
          action.category === "food" ||
          action.category === "pickaxe" ||
          action.category === "shovel" ||
          action.category === "axe"
            ? action.category
            : undefined
      };
    }

    case "EAT_FOOD": {
      return {
        type: "EAT_FOOD",
        itemName: asOptionalString(action.itemName),
        force: action.force === true ? true : undefined
      };
    }

    case "CRAFT_ITEM": {
      return {
        type: "CRAFT_ITEM",
        itemName: asOptionalString(action.itemName)
      };
    }

    default:
      return null;
  }
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

function round1(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
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

export function createAiBridgeController(
  config: AppConfig,
  bot: Bot,
  state: StateStore,
  perception: PerceptionController,
  actions: ActionController,
  logger: Logger
): AiBridgeController {
  let lastDisabledLogAt = 0;

  function buildObservation(): AiObservation {
    const snapshot = state.getBotSnapshot();
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

    return {
      timestamp: new Date().toISOString(),
      bot: snapshot,
      perception: perception.getPerceptionSnapshot(),
      survival: {
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
        equipment: getEquipmentSummary(bot),
        food: getFoodItems(bot),
        mining: {
          enabled: config.allowMining,
          allowedBlocks: [...config.miningAllowedBlocks],
          forbiddenBlocks: [...config.miningForbiddenBlocks],
          maxDistance: config.miningMaxDistance,
          homeProtectionRadius: config.homeProtectionRadius,
          previewMaxDistance: config.minePreviewMaxDistance
        },
        harvesting: {
          enabled: config.allowHarvest,
          cropHarvestingEnabled: config.allowCropHarvest,
          replantEnabled: config.replantCrops,
          allowedBlocks: [...config.harvestAllowedBlocks],
          forbiddenBlocks: [...config.harvestForbiddenBlocks],
          maxDistance: config.harvestMaxDistance
        },
        visibleOres,
        mineableOres: mineableOreSummary(config, visibleOres, state, hasPickaxe),
        targetBlock,
        homeProtection: {
          enabled: config.homeProtectionRadius > 0,
          homeSet: Boolean(state.state.homeRecord || state.state.homePosition)
        },
        safetyFlags: { ...snapshot.safetyFlags }
      },
      actionQueue: actions.getActionQueueSummary(),
      recentEvents: state.getRecentEvents(25)
    };
  }

  async function sendObservationToAiBridge(): Promise<void> {
    if (!config.enableAiBridge) {
      const now = Date.now();
      if (now - lastDisabledLogAt >= DISABLED_LOG_INTERVAL_MS) {
        logger.log("ai", "bridge disabled");
        state.addEvent("ai_bridge_skipped", "AI bridge disabled; observation send skipped.");
        lastDisabledLogAt = now;
      }
      return;
    }

    const url = config.aiBridgeUrl;
    if (!url) {
      const errorMessage = "AI bridge enabled but AI_BRIDGE_URL is missing.";
      state.setAiBridgeError(errorMessage);
      state.addEvent("ai_bridge_error", errorMessage);
      logger.error("ai", errorMessage);
      return;
    }

    const observation = buildObservation();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.aiBridgeTimeoutMs);

    try {
      logger.log("ai", `sending observation to ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(observation),
        signal: controller.signal
      });

      const bodyText = await response.text();
      if (!response.ok) {
        const snippet = bodyText.slice(0, 280);
        throw new Error(`AI bridge response ${response.status}: ${snippet}`);
      }

      state.setAiBridgeError(null);
      state.addEvent("ai_bridge_sent", "AI bridge observation sent.", {
        url,
        status: response.status
      });

      if (!bodyText.trim()) {
        return;
      }

      let payload: AiActionRequest;
      try {
        payload = JSON.parse(bodyText) as AiActionRequest;
      } catch {
        logger.warn("ai", "AI bridge response was not JSON; ignoring body.");
        return;
      }

      if (typeof payload.say === "string" && payload.say.trim().length > 0) {
        logger.log("ai", "AI bridge requested say message.");
        actions.queueAction("AI", {
          type: "CHAT",
          message: payload.say,
          reason: "ai-bridge-say"
        });
      }

      if (Array.isArray(payload.actions)) {
        for (const rawAction of payload.actions) {
          const parsedAction = asBotAction(rawAction);
          if (!parsedAction) {
            logger.warn("ai", "AI requested invalid action; ignored.", rawAction);
            continue;
          }

          logger.log("ai", `AI requested action ${parsedAction.type}`);
          actions.queueAction("AI", parsedAction);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.setAiBridgeError(message);
      state.addEvent("ai_bridge_error", "AI bridge call failed.", {
        error: message
      });
      logger.error("ai", `bridge call failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    getStatus: () => ({
      enabled: config.enableAiBridge,
      url: config.enableAiBridge ? config.aiBridgeUrl ?? null : null,
      lastError: state.state.lastAiBridgeError
    }),
    buildObservation,
    sendObservationToAiBridge
  };
}
