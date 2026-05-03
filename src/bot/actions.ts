import type { Bot } from "mineflayer";
import type { AppConfig } from "../config";
import type {
  ActionController,
  ActionQueueItem,
  ActionQueueSummary,
  AiBridgeStatus,
  BotAction,
  ChatController,
  Logger,
  MovementController,
  PerceptionController,
  SafetyLayer,
  StateStore
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
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
    default:
      return action.type;
  }
}

function isFinitePosition(position: { x: number; y: number; z: number } | null | undefined): boolean {
  if (!position) return false;
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
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

      if (!safety.isPrivilegedRequester(requestedBy)) {
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
        movement.stop("stop command");
        chat.send("Stopping.", "stop");
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
          "Commands: hello, help, status, where are you, nearby, look. Owner: come, follow me, stop, respawn, distance, obstacle, state, debug, ai status, action queue.",
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
        const stuck = obstacle.appearsStuck ? "yes" : "no";
        chat.send(`Obstacle: front=${feet}/${head}, stuck=${stuck}.`, "obstacle");
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

      default: {
        const unknownType = action satisfies never;
        logger.warn("action", `Unhandled action type: ${String(unknownType)}`);
        return false;
      }
    }
  }

  syncQueueState();

  return {
    queueAction,
    clearActionQueue,
    getActionQueueSummary
  };
}
