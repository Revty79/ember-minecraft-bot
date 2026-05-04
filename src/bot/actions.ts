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
  "MINE_BLOCK",
  "STOP_MINING",
  "LOOK_AT_OWNER"
]);

const SCAFFOLDED_CAPABILITY_ACTIONS = new Set<BotAction["type"]>([
  "ATTACK_ENTITY",
  "PLACE_BLOCK",
  "OPEN_INVENTORY"
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
    case "MINE_BLOCK":
      return "MINE_BLOCK";
    case "STOP_MINING":
      return "STOP_MINING";
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

  function validateTargetSafety(blockPosition: Vec3, blockName: string): { allowed: boolean; reason?: string } {
    if (!state.state.alive) {
      return { allowed: false, reason: "I am not alive right now." };
    }

    if (!movement.isEntityPositionHealthy() || !isFinitePosition(bot.entity?.position)) {
      return { allowed: false, reason: "My position is not valid for mining yet." };
    }

    if (hasDangerForMining()) {
      return { allowed: false, reason: "It is not safe to mine right now." };
    }

    if (hasLowHealthForMining()) {
      return { allowed: false, reason: "My health is too low for mining." };
    }

    if (state.state.food !== null && state.state.food < config.lowFoodEatThreshold) {
      return { allowed: false, reason: "My food is too low for safe mining." };
    }

    const distance = bot.entity.position.distanceTo(blockPosition);
    if (distance > config.miningMaxDistance) {
      return { allowed: false, reason: "That block is too far away to mine safely." };
    }

    if (!isValidMiningBlockName(blockName)) {
      return { allowed: false, reason: "That block is not in my safe mining list." };
    }

    const botFloor = bot.entity.position.floored();
    if (
      blockPosition.x === botFloor.x &&
      blockPosition.z === botFloor.z &&
      (blockPosition.y === botFloor.y || blockPosition.y === botFloor.y + 1 || blockPosition.y < botFloor.y)
    ) {
      return { allowed: false, reason: "I will not mine blocks at or below my own position." };
    }

    const home = state.state.homeRecord
      ? new Vec3(state.state.homeRecord.x, state.state.homeRecord.y, state.state.homeRecord.z)
      : state.state.homePosition
        ? new Vec3(state.state.homePosition.x, state.state.homePosition.y, state.state.homePosition.z)
        : null;
    if (home) {
      const homeDistance = home.distanceTo(blockPosition);
      if (homeDistance <= config.homeProtectionRadius) {
        return { allowed: false, reason: "I will not mine inside my home area yet." };
      }
    }

    return { allowed: true };
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

  function getMineableOreSummary(radius: number): { ores: { name: string; count: number }[]; reason: string } {
    const visible = perception.getNearbyOresSummary(radius);
    if (visible.length === 0) {
      return { ores: [], reason: "none visible" };
    }

    if (!config.allowMining) {
      return { ores: [], reason: "mining disabled" };
    }
    if (!state.state.alive || !movement.isEntityPositionHealthy()) {
      return { ores: [], reason: "not ready" };
    }
    if (hasDangerForMining()) {
      return { ores: [], reason: "unsafe" };
    }

    const pickaxe = getBestPickaxe(bot);
    if (config.requireToolForOres && !pickaxe) {
      return { ores: [], reason: "no pickaxe" };
    }

    const nearestOre = perception.getNearestOre(radius);
    if (!nearestOre) {
      return { ores: [], reason: "none visible" };
    }
    if (nearestOre.distance > config.miningMaxDistance) {
      return { ores: [], reason: "too far" };
    }

    const allowed = visible.filter((ore) => config.miningAllowedBlocks.includes(ore.name));
    if (allowed.length === 0) {
      return { ores: [], reason: "not allowed list" };
    }

    return { ores: allowed, reason: "allowed" };
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
    if (safeAction.type === "STOP_MINING") {
      stopMiningNow(`requested-by-${requestedBy}`);
      clearMovementActions("stop-mining");
      chat.send("Mining stopped.", "mine-stop");
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
          "Commands: hello, help, capabilities, status, vitals, hunger, danger, threat, where are you, nearby, look, movement. Owner: inventory, equipment, food, eat, equip food/pickaxe/shovel/axe, mine front/block/ore, mine stop, ore report, block, ores nearby, come, follow me, stop, flee, respawn, distance, obstacle, set home, home, stay home, home status, clear home, recover, safety test, state, debug, ai status, action queue.",
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
          )}, flee=${String(caps.flee)}, inventoryRead=${String(caps.inventoryRead)}, equipment=${String(
            caps.equipment
          )}, eating=${String(caps.eating)}, mining=${String(caps.mining)}, combat=${String(caps.combat)}, building=${String(
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

        let targetVec: Vec3 | null = null;
        let targetName: string | null = null;

        if (action.mode === "ore") {
          const nearestOre = perception.getNearestOre(6);
          if (!nearestOre) {
            chat.send("I do not see a nearby ore to mine.", "mine-ore-none");
            return false;
          }
          targetVec = new Vec3(nearestOre.position.x, nearestOre.position.y, nearestOre.position.z);
          targetName = nearestOre.name;
        } else {
          const obstacle = perception.getImmediateObstacles();
          const candidates = [obstacle.blockFrontFeet.position, obstacle.blockFrontHead.position].filter(
            (entry): entry is { x: number; y: number; z: number } => entry !== null
          );
          for (const candidate of candidates) {
            const block = bot.blockAt(new Vec3(candidate.x, candidate.y, candidate.z));
            const blockName = block?.name?.toLowerCase() ?? null;
            if (!blockName) continue;
            const classification = perception.classifyBlock(blockName);
            if (classification === "air" || classification === "passable" || classification === "fluid") continue;
            targetVec = new Vec3(candidate.x, candidate.y, candidate.z);
            targetName = blockName;
            break;
          }
        }

        if (!targetVec || !targetName) {
          chat.send("No safe front block found to mine.", "mine-no-target");
          return false;
        }

        const safety = validateTargetSafety(targetVec, targetName);
        if (!safety.allowed) {
          if (action.mode === "ore" && safety.reason !== "I will not mine inside my home area yet.") {
            chat.send("I can see ore, but I cannot mine it safely yet.", "mine-ore-unsafe");
          } else {
            chat.send(safety.reason ?? "I cannot mine that block safely.", "mine-unsafe");
          }
          return false;
        }

        if (action.mode === "ore") {
          const moved = await moveNearBlock(targetVec);
          if (!moved) {
            stopMiningNow("move-near-failed");
            chat.send("I can see ore, but I cannot mine it safely yet.", "mine-ore-move-failed");
            return false;
          }
        }

        const toolDecision = await equipRequiredToolForBlock(targetName);
        if (!toolDecision.ok) {
          chat.send(toolDecision.reason ?? "I cannot equip the required tool.", "mine-tool-failed");
          return false;
        }

        const blockToDig = bot.blockAt(targetVec);
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
          await bot.lookAt(targetVec.offset(0.5, 0.5, 0.5), true);
          logger.log(
            "mining",
            `start block=${blockToDig.name} pos=(${targetVec.x},${targetVec.y},${targetVec.z})`
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
            ? `none (${mineable.reason})`
            : mineable.ores
                .slice(0, 6)
                .map((ore) => `${ore.name} x${ore.count}`)
                .join(", ");

        chat.send(`Visible ores: ${visibleText}. Mineable now: ${mineableText}.`, "ore-report");
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
        const equip = safety.validateAction(item.requestedBy, { type: "EQUIP_ITEM", category: "pickaxe" }, { dryRun: true });

        const miningWord = mining.allowed ? "allowed" : "blocked";
        const combatWord = combat.allowed ? "allowed" : "blocked";
        const buildingWord = building.allowed ? "allowed" : "blocked";
        const inventoryWord = inventory.allowed ? "allowed" : "blocked";
        const eatingWord = eating.allowed ? "allowed" : "blocked";
        const equipWord = equip.allowed ? "allowed" : "blocked";

        const result =
          miningWord === "blocked" &&
          combatWord === "blocked" &&
          buildingWord === "blocked" &&
          inventoryWord === "blocked" &&
          eatingWord === "blocked" &&
          equipWord === "blocked"
            ? "Safety test: mining blocked, combat blocked, building blocked, inventory blocked."
            : `Safety test: mining ${miningWord}, equip ${equipWord}, eating ${eatingWord}, combat ${combatWord}, building ${buildingWord}, inventory ${inventoryWord}.`;

        logger.log("safety", "Safety test results", {
          mining,
          combat,
          building,
          inventory,
          eating,
          equip
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


