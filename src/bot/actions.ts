import type { Bot } from "mineflayer";
import type { AppConfig } from "../config";
import { getFoodItems, getInventorySummary, pickBestFoodItem } from "./inventory";
import type {
  ActionController,
  ActionQueueItem,
  ActionQueueSummary,
  AiBridgeStatus,
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
  "LOOK_AT_OWNER"
]);

const SCAFFOLDED_CAPABILITY_ACTIONS = new Set<BotAction["type"]>([
  "MINE_BLOCK",
  "ATTACK_ENTITY",
  "PLACE_BLOCK",
  "OPEN_INVENTORY",
  "EQUIP_ITEM"
]);

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
        clearMovementActions("stop");
        movement.stop("stop command");
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

      case "RECOVER": {
        logger.log("survival", "Recovery requested.");
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
          "Commands: hello, help, capabilities, status, vitals, hunger, danger, threat, where are you, nearby, look, movement. Owner: inventory, food, eat, block, ores nearby, come, follow me, stop, flee, respawn, distance, obstacle, set home, home, stay home, home status, clear home, recover, safety test, state, debug, ai status, action queue.",
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
          )}, flee=${String(caps.flee)}, inventoryRead=${String(caps.inventoryRead)}, eating=${String(
            caps.eating
          )}, mining=${String(caps.mining)}, combat=${String(caps.combat)}, building=${String(
            caps.building
          )}, containers=${String(caps.containers)}, ai=${String(caps.ai)}.`,
          "capabilities"
        );
        return true;
      }

      case "REPORT_VITALS": {
        const snapshot = state.getBotSnapshot();
        const pos = snapshot.position
          ? `(${snapshot.position.x.toFixed(1)}, ${snapshot.position.y.toFixed(1)}, ${snapshot.position.z.toFixed(1)})`
          : "unknown";
        const dangerText = formatDanger(snapshot.dangerSummary);

        chat.send(
          `Vitals: hp=${snapshot.health ?? "unknown"}, food=${snapshot.food ?? "unknown"}, sat=${snapshot.saturation ?? "unknown"}, hunger=${snapshot.hungerStatus}, oxy=${snapshot.oxygen ?? "unknown"}, alive=${snapshot.alive}, pos=${pos}, danger=${dangerText}.`,
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

      case "REPORT_INVENTORY": {
        const summary = getInventorySummary(bot);
        logger.log("state", "Inventory summary", summary);

        chat.send(
          `Inventory: empty=${summary.emptySlots}/${summary.totalSlots}, held=${summary.heldItem ?? "none"}, food=${summary.foodCount}, tools=${summary.toolCount}, weapons=${summary.weaponCount}, armor=${summary.armorCount}.`,
          "inventory"
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

      case "EAT_FOOD": {
        if (!config.allowEating) {
          chat.send("Eating is disabled by safety settings.", "eat-disabled");
          return false;
        }

        const selectedFood = pickBestFoodItem(bot, action.itemName);
        if (!selectedFood) {
          chat.send("Food: none.", "eat-no-food");
          return false;
        }

        try {
          await bot.equip(selectedFood, "hand");
          bot.activateItem();
          await sleep(1600);
          bot.deactivateItem();
          logger.log("survival", `Ate food item ${selectedFood.name}`);
          chat.send(`Ate ${selectedFood.name}.`, "eat-success");
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("survival", `Failed to eat ${selectedFood.name}: ${message}`);
          chat.send("I could not eat right now.", "eat-failed");
          return false;
        }
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
        const combat = safety.validateAction(item.requestedBy, { type: "ATTACK_ENTITY" }, { dryRun: true });
        const building = safety.validateAction(item.requestedBy, { type: "PLACE_BLOCK" }, { dryRun: true });
        const inventory = safety.validateAction(item.requestedBy, { type: "OPEN_INVENTORY" }, { dryRun: true });
        const eating = safety.validateAction(item.requestedBy, { type: "EAT_FOOD" }, { dryRun: true });

        const miningWord = mining.allowed ? "allowed" : "blocked";
        const combatWord = combat.allowed ? "allowed" : "blocked";
        const buildingWord = building.allowed ? "allowed" : "blocked";
        const inventoryWord = inventory.allowed ? "allowed" : "blocked";
        const eatingWord = eating.allowed ? "allowed" : "blocked";

        const result =
          miningWord === "blocked" &&
          combatWord === "blocked" &&
          buildingWord === "blocked" &&
          inventoryWord === "blocked" &&
          eatingWord === "blocked"
            ? "Safety test: mining blocked, combat blocked, building blocked, inventory blocked."
            : `Safety test: mining ${miningWord}, combat ${combatWord}, building ${buildingWord}, inventory ${inventoryWord}, eating ${eatingWord}.`;

        logger.log("safety", "Safety test results", {
          mining,
          combat,
          building,
          inventory,
          eating
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
