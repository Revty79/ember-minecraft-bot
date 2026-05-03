import dotenv from "dotenv";
import { loadConfig } from "./config";
import { createMineflayerBot } from "./bot/createBot";
import { createLogger } from "./bot/logging";
import { createStateStore } from "./bot/state";
import { createSafetyLayer } from "./bot/safety";
import { createChatController } from "./bot/chat";
import { createPerceptionController } from "./bot/perception";
import { createMovementController } from "./bot/movement";
import { createActionController } from "./bot/actions";
import { createCommandRouter } from "./bot/commands";
import { createLifecycleController } from "./bot/lifecycle";
import { createAiBridgeController } from "./bot/aiBridge";
import type { AiBridgeController } from "./bot/types";

dotenv.config();

const logger = createLogger();
const config = loadConfig();

logger.log("config", `target=${config.minecraftHost}:${config.minecraftPort}`);
logger.log("config", `username=${config.minecraftUsername} auth=${config.minecraftAuth}`);
if (config.minecraftVersion) {
  logger.log("config", `requested version=${config.minecraftVersion}`);
}
logger.log(
  "config",
  `announce=${String(config.announceOnSpawn)} owner=${config.ownerUsername} aiBridge=${String(
    config.enableAiBridge
  )}`
);
logger.log(
  "config",
  `safety allowMining=${String(config.allowMining)} allowCombat=${String(config.allowCombat)} allowBuilding=${String(
    config.allowBuilding
  )} allowInventory=${String(config.allowInventory)}`
);
logger.log(
  "config",
  `movement maxCome=${config.maxComeDistance} maxFollowStart=${config.maxFollowStartDistance} comeRadius=${config.comeGoalRadius} followDistance=${config.followDistance} timeoutMs=${config.pathfinderTimeoutMs} stuckLimit=${config.stuckResetLimit}`
);
logger.log(
  "config",
  `movement polish minGoalRefresh=${config.minGoalRefreshDistance} repathMs=${config.followRepathIntervalMs} progressCheckMs=${config.movementProgressCheckMs} minProgress=${config.minProgressDistance}`
);
logger.log(
  "config",
  `survival dangerScanMs=${config.dangerScanIntervalMs} dangerRadius=${config.hostileDangerRadius} stopRadius=${config.hostileStopRadius} stopOnDanger=${String(
    config.stopOnDanger
  )}`
);

const bot = createMineflayerBot(config, logger);
const state = createStateStore(config);
const safety = createSafetyLayer(config, state, logger);
const chat = createChatController(bot, config, state, logger);
const perception = createPerceptionController(bot, state, logger);
const movement = createMovementController(bot, config, state, safety, chat, perception, logger);

let aiBridgeController: AiBridgeController | null = null;
const actions = createActionController(
  bot,
  config,
  state,
  chat,
  movement,
  perception,
  safety,
  logger,
  () =>
    aiBridgeController?.getStatus() ?? {
      enabled: config.enableAiBridge,
      url: config.enableAiBridge ? config.aiBridgeUrl ?? null : null,
      lastError: state.state.lastAiBridgeError
    }
);
aiBridgeController = createAiBridgeController(config, state, perception, actions, logger);

const commands = createCommandRouter(config, state, chat, actions, safety, logger);
const lifecycle = createLifecycleController(
  bot,
  config,
  state,
  chat,
  commands,
  movement,
  perception,
  actions,
  logger
);

lifecycle.bind();

const observationInterval = setInterval(() => {
  void aiBridgeController?.sendObservationToAiBridge();
}, config.observationIntervalMs);
observationInterval.unref();

let lastDangerStopAt = 0;
const dangerInterval = setInterval(() => {
  const danger = perception.getDangerSummary(config.hostileDangerRadius);
  state.setDangerSummary(danger);

  if (!config.stopOnDanger) {
    return;
  }

  if (!movement.isMoving()) {
    return;
  }

  if (danger.nearestHostileDistance === null || danger.nearestHostileDistance > config.hostileStopRadius) {
    return;
  }

  const now = Date.now();
  if (now - lastDangerStopAt < 5000) {
    return;
  }

  lastDangerStopAt = now;
  logger.warn(
    "survival",
    `danger detected nearest=${danger.nearestHostileName ?? "unknown"} distance=${danger.nearestHostileDistance.toFixed(
      1
    )} mode=${movement.getMode()}`
  );

  state.addEvent("state_update", "Danger close stop triggered", {
    danger,
    mode: movement.getMode()
  });

  actions.clearMovementActions("danger-close");
  movement.stopForDanger("danger-close");
  chat.send("Danger close. I am stopping.", "danger-stop", { bypassRateLimit: true });
}, config.dangerScanIntervalMs);
dangerInterval.unref();

const stateLogInterval = setInterval(() => {
  const snapshot = state.getBotSnapshot();
  logger.log(
    "state",
    `summary ready=${snapshot.ready} alive=${snapshot.alive} mode=${snapshot.movement.mode} queue=${snapshot.actionQueueLength} players=${snapshot.nearestPlayers.length} danger=${snapshot.dangerSummary.proximity}`
  );
}, config.stateLogIntervalMs);
stateLogInterval.unref();

function shutdown(signal: string): void {
  logger.log("connect", `Received ${signal}, shutting down...`);
  clearInterval(observationInterval);
  clearInterval(dangerInterval);
  clearInterval(stateLogInterval);
  actions.clearActionQueue("shutdown");
  movement.stop("shutdown");
  bot.quit("Shutting down");

  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
