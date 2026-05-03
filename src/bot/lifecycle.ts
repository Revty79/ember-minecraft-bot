import type { Bot } from "mineflayer";
import type { PartiallyComputedPath } from "mineflayer-pathfinder";
import type { AppConfig } from "../config";
import type {
  ActionController,
  ChatController,
  CommandRouter,
  LifecycleController,
  Logger,
  MovementController,
  PerceptionController,
  StateStore
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function isFinitePosition(position: { x: number; y: number; z: number } | null | undefined): boolean {
  if (!position) return false;
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function isBotAlive(bot: Bot): boolean {
  const runtime = bot as unknown as { isAlive?: boolean };
  return runtime.isAlive ?? bot.health > 0;
}

export function createLifecycleController(
  bot: Bot,
  config: AppConfig,
  state: StateStore,
  chat: ChatController,
  commands: CommandRouter,
  movement: MovementController,
  perception: PerceptionController,
  actions: ActionController,
  logger: Logger
): LifecycleController {
  let spawnCount = 0;
  let diedSinceLastSpawn = false;
  let readyGeneration = 0;
  let announcedOnline = false;
  let announcePendingAfterLogin = false;
  let kickedForChatValidation = false;
  let lastPathUpdateLogAt = 0;
  let lastPathUpdateStatus = "";

  async function handleSpawnReadiness(spawnLabel: string, generation: number): Promise<void> {
    chat.setChatReady(false);
    state.setReady(false);

    const ready = await movement.onSpawn(spawnLabel);
    if (generation !== readyGeneration) {
      logger.log("life", `Spawn readiness superseded (${spawnLabel}).`);
      return;
    }

    if (!ready) {
      return;
    }

    await sleep(config.spawnAnnounceDelayMs);
    if (generation !== readyGeneration) {
      logger.log("chat", `chat warmup superseded (${spawnLabel}).`);
      return;
    }

    chat.setChatReady(true);
    logger.log("chat", `Chat ready after ${config.spawnAnnounceDelayMs}ms warmup (${spawnLabel}).`);

    if (!config.announceOnSpawn || announcedOnline || !announcePendingAfterLogin) {
      return;
    }

    const announced = chat.send("EMBER is online.", "spawn-announce");
    if (announced) {
      announcedOnline = true;
      announcePendingAfterLogin = false;
    }
  }

  function bind(): void {
    bot.on("login", () => {
      state.setConnected(true);
      state.setAlive(true);
      state.setSpawned(false);
      state.setReady(false);
      announcePendingAfterLogin = true;

      logger.log("connect", `Logged in as ${bot.username} -> ${config.minecraftHost}:${config.minecraftPort}`);
      state.addEvent("login", "Bot logged in", {
        username: bot.username,
        host: config.minecraftHost,
        port: config.minecraftPort,
        version: config.minecraftVersion ?? "auto"
      });
    });

    bot.on("spawn", () => {
      spawnCount += 1;
      const spawnLabel =
        spawnCount === 1
          ? "first spawn after login"
          : diedSinceLastSpawn
            ? "respawn after death"
            : "additional spawn event";

      state.setSpawned(true);
      state.setAlive(true);
      diedSinceLastSpawn = false;

      logger.log("connect", `Bot spawned in world (${spawnLabel}).`);
      state.addEvent("spawn", `Spawn event: ${spawnLabel}`);

      movement.applyConservativeMovements();

      readyGeneration += 1;
      const generation = readyGeneration;
      void handleSpawnReadiness(spawnLabel, generation);
    });

    bot.on("respawn", () => {
      logger.log("life", "Respawn packet/event received.");
      state.addEvent("respawn", "Respawn event received.");
    });

    bot.on("death", () => {
      diedSinceLastSpawn = true;
      state.setAlive(false);
      state.setLastDeathTimestamp(nowIso());
      chat.setChatReady(false);

      logger.log("life", "Bot died.");
      state.addEvent("death", "Bot died.");

      actions.clearActionQueue("death");
      movement.onDeath();
    });

    bot.on("goal_reached", (goal) => {
      const goalName = goal?.constructor?.name ?? "unknown";
      logger.log("pathfinder", `goal_reached: ${goalName}`);
      movement.onGoalReached(goalName);
    });

    bot.on("path_update", (result: PartiallyComputedPath) => {
      const status = result?.status ?? "unknown";
      const pathLength = Array.isArray(result?.path) ? result.path.length : 0;
      const timeMs = typeof result?.time === "number" ? result.time.toFixed(0) : "n/a";
      const now = Date.now();

      const shouldLog =
        status !== lastPathUpdateStatus || now - lastPathUpdateLogAt >= config.pathUpdateLogIntervalMs;

      if (!shouldLog) {
        return;
      }

      lastPathUpdateStatus = status;
      lastPathUpdateLogAt = now;
      logger.log("pathfinder", `path_update: status=${status} steps=${pathLength} timeMs=${timeMs}`);
    });

    bot.on("path_reset", (reason) => {
      const reasonText = String(reason);
      logger.log("pathfinder", `path_reset: reason=${reasonText}`);
      movement.onPathReset(reasonText);
    });

    bot.on("path_stop", () => {
      logger.log("pathfinder", "path_stop");
    });

    const runtimeEvents = bot as unknown as {
      on: (eventName: string, listener: (...args: unknown[]) => void) => void;
    };

    runtimeEvents.on("stuck", (...args: unknown[]) => {
      logger.warn("pathfinder", "stuck event", args);
    });

    runtimeEvents.on("cannot_find", (...args: unknown[]) => {
      logger.warn("pathfinder", "cannot_find event", args);
    });

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      commands.routeChatMessage({ username, message });
    });

    bot.on("physicTick", () => {
      const health = Number.isFinite(bot.health) ? bot.health : null;
      const runtime = bot as unknown as {
        food?: number;
        foodSaturation?: number;
        saturation?: number;
        oxygenLevel?: number;
      };
      const entityRuntime = bot.entity as unknown as {
        onGround?: boolean;
        isInWater?: boolean;
        isInLava?: boolean;
        isOnFire?: boolean;
      };
      const food = Number.isFinite(runtime.food) ? Number(runtime.food) : null;
      const saturationRaw =
        Number.isFinite(runtime.foodSaturation) ? Number(runtime.foodSaturation) :
        Number.isFinite(runtime.saturation) ? Number(runtime.saturation) :
        null;
      const oxygen = Number.isFinite(runtime.oxygenLevel) ? Number(runtime.oxygenLevel) : null;

      state.setHealthAndFood(health, food);
      state.setVitalsDetails({
        saturation: saturationRaw,
        oxygen,
        onFire: typeof entityRuntime?.isOnFire === "boolean" ? entityRuntime.isOnFire : null,
        inLava: typeof entityRuntime?.isInLava === "boolean" ? entityRuntime.isInLava : null,
        inWater: typeof entityRuntime?.isInWater === "boolean" ? entityRuntime.isInWater : null,
        onGround: typeof entityRuntime?.onGround === "boolean" ? entityRuntime.onGround : null
      });
      state.setAlive(isBotAlive(bot));

      const position = bot.entity?.position;
      if (isFinitePosition(position)) {
        state.setPosition({
          x: position.x,
          y: position.y,
          z: position.z
        });
      }

      state.setWorldInfo(bot.game?.dimension ?? null, bot.game?.levelType ?? null);
      state.setNearestPlayers(perception.getNearbyPlayers(24).slice(0, 5));

      movement.onPhysicsTick();
    });

    bot.on("kicked", (reason, loggedIn) => {
      const reasonText = JSON.stringify(reason);
      logger.error("connect", `kicked loggedIn=${loggedIn} reason=${reasonText}`);
      state.addEvent("kicked", "Bot kicked from server", {
        loggedIn,
        reason
      });

      if (reasonText.includes("multiplayer.disconnect.chat_validation_failed")) {
        kickedForChatValidation = true;
        logger.error(
          "connect",
          "Detected chat validation failure kick. Quitting so Docker can restart cleanly."
        );
        actions.clearActionQueue("chat-validation-failed");
        movement.stop("chat-validation-kick");
        bot.quit("chat validation failed");
      }
    });

    bot.on("end", (reason) => {
      state.setConnected(false);
      state.setSpawned(false);
      state.setReady(false);
      state.setAlive(false);

      logger.log("connect", `Connection ended: ${reason ?? "unknown"}`);
      state.addEvent("disconnect", "Connection ended", {
        reason
      });

      if (kickedForChatValidation) {
        logger.error(
          "connect",
          "Exiting process due to chat validation kick; Docker should restart the service."
        );
        process.exit(1);
      }
    });

    bot.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      state.setLastError(message);
      state.addEvent("error", "Bot error", {
        message
      });
      logger.error("connect", `error: ${message}`);
    });
  }

  return {
    bind
  };
}
