import dotenv from "dotenv";
import { loadConfig } from "./config";
import { createMineflayerBot } from "./bot/createBot";
import { loadHomeRecord } from "./bot/homeStore";
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
import { createShadowBridgeController } from "./bot/shadowBridge";
import type { AiBridgeController, ShadowBridgeController } from "./bot/types";

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
  `announce=${String(config.announceOnSpawn)} owner=${config.ownerUsername} aiBridge=${String(config.enableAiBridge)} shadow=${String(config.enableAiShadow)}`
);
logger.log(
  "config",
  `shadow intervalMs=${config.shadowObservationIntervalMs} sendWhileMoving=${String(config.shadowSendWhileMoving)} recentEvents=${config.shadowSendRecentEvents} timeoutMs=${config.shadowTimeoutMs} logResponse=${String(config.shadowLogResponse)} chatSummary=${String(config.shadowChatSummary)}`
);
logger.log(
  "config",
  `safety allowMining=${String(config.allowMining)} allowCombat=${String(config.allowCombat)} allowBuilding=${String(
    config.allowBuilding
  )} allowInventory=${String(config.allowInventory)} allowEating=${String(config.allowEating)} allowEquip=${String(
    config.allowEquip
  )} allowFlee=${String(config.allowFlee)} allowHarvest=${String(config.allowHarvest)} allowCropHarvest=${String(
    config.allowCropHarvest
  )} taskSystem=${String(config.enableTaskSystem)} taskOwnerOnly=${String(config.taskOwnerOnly)}`
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
  )} fleeDistance=${config.fleeDistance} fleeHomeRadius=${config.fleeHomeRadius} fleeToHome=${String(
    config.fleeToHome
  )} fleeToOwner=${String(config.fleeToOwner)}`
);
logger.log(
  "config",
  `mining ownerOnly=${String(config.mineOwnerOnly)} maxDistance=${config.miningMaxDistance} timeoutMs=${config.miningTimeoutMs} lowHpStop=${config.lowHealthStopThreshold} lowFoodEatThreshold=${config.lowFoodEatThreshold} homeProtectionRadius=${config.homeProtectionRadius}`
);
logger.log(
  "config",
  `mining allowList=${config.miningAllowedBlocks.join(",")} forbidList=${config.miningForbiddenBlocks.join(",")} requireToolStone=${String(
    config.requireToolForStone
  )} requireToolOres=${String(config.requireToolForOres)} previewMaxDistance=${config.minePreviewMaxDistance} targetRaycast=${config.blockTargetRaycastDistance}`
);
logger.log(
  "config",
  `harvest ownerOnly=${String(config.harvestOwnerOnly)} maxDistance=${config.harvestMaxDistance} timeoutMs=${config.harvestTimeoutMs} allowCropHarvest=${String(
    config.allowCropHarvest
  )} requireMatureCrops=${String(config.requireMatureCrops)} replantCrops=${String(config.replantCrops)}`
);
logger.log(
  "config",
  `harvest allowList=${config.harvestAllowedBlocks.join(",")} forbidList=${config.harvestForbiddenBlocks.join(",")}`
);
logger.log(
  "config",
  `stability notReadyChatCooldownMs=${config.notReadyChatCooldownMs} invalidPositionRecoveryMs=${config.invalidPositionRecoveryMs} stateLogOnlyOnChange=${String(
    config.stateLogOnlyOnChange
  )} homeFilePath=${config.homeFilePath}`
);

const bot = createMineflayerBot(config, logger);
const state = createStateStore(config);

const persistedHome = loadHomeRecord(config.homeFilePath, logger);
if (persistedHome) {
  state.setHomeRecord(persistedHome);
  state.setHomePosition({
    x: persistedHome.x,
    y: persistedHome.y,
    z: persistedHome.z
  });
  logger.log("state", `Loaded persisted home from ${config.homeFilePath}`);
}

const safety = createSafetyLayer(config, state, logger);
const chat = createChatController(bot, config, state, logger);
const perception = createPerceptionController(bot, state, logger);
const movement = createMovementController(bot, config, state, safety, chat, perception, logger);

let aiBridgeController: AiBridgeController | null = null;
let shadowBridgeController: ShadowBridgeController | null = null;
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
    },
  () =>
    shadowBridgeController?.getStatus() ?? {
      enabled: config.enableAiShadow,
      configured: Boolean(config.shadowBridgeUrl?.trim()) && Boolean(config.shadowBridgeToken.trim()),
      url: config.shadowBridgeUrl ?? null,
      lastSentAt: state.state.shadowLastSentAt,
      lastResponseAt: state.state.shadowLastResponseAt,
      lastError: state.state.shadowLastError,
      lastReply: state.state.shadowLastReply,
      lastWouldDo: state.state.shadowLastWouldDo,
      lastConfidence: state.state.shadowLastConfidence,
      lastLogId: state.state.shadowLastLogId,
      sendCount: state.state.shadowSendCount,
      errorCount: state.state.shadowErrorCount,
      inFlight: false
    },
  () =>
    shadowBridgeController?.sendObservationToShadowBridge({ force: true, reason: "manual-test" }) ??
    Promise.resolve({
      code: "error",
      message: "Shadow bridge is not initialized."
    })
);
aiBridgeController = createAiBridgeController(config, bot, state, perception, actions, logger);
shadowBridgeController = createShadowBridgeController(config, bot, state, chat, movement, perception, actions, logger);

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

const shadowObservationInterval = setInterval(() => {
  void shadowBridgeController?.sendObservationToShadowBridge({ reason: "interval" });
}, config.shadowObservationIntervalMs);
shadowObservationInterval.unref();

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

  if (config.allowFlee) {
    logger.warn("survival", "Danger close. Attempting flee action.");
    actions.queueAction("SYSTEM", { type: "FLEE_DANGER" });
  }
}, config.dangerScanIntervalMs);
dangerInterval.unref();

const HEARTBEAT_EVERY_UNCHANGED = 6;
let unchangedCount = 0;
let lastSummaryFingerprint = "";

const stateLogInterval = setInterval(() => {
  const snapshot = state.getBotSnapshot();
  const fingerprint = JSON.stringify({
    ready: snapshot.ready,
    alive: snapshot.alive,
    mode: snapshot.movement.mode,
    stuck: snapshot.movement.stuckCount,
    queue: snapshot.actionQueueLength,
    running: snapshot.runningAction,
    pos: snapshot.position,
    danger: snapshot.dangerSummary.proximity,
    blocked: snapshot.blockedReason,
    error: snapshot.lastError
  });

  const summary =
    `summary ready=${snapshot.ready} alive=${snapshot.alive} mode=${snapshot.movement.mode} queue=${snapshot.actionQueueLength} ` +
    `players=${snapshot.nearestPlayers.length} danger=${snapshot.dangerSummary.proximity}`;

  if (!config.stateLogOnlyOnChange) {
    logger.log("state", summary);
    return;
  }

  if (fingerprint !== lastSummaryFingerprint) {
    lastSummaryFingerprint = fingerprint;
    unchangedCount = 0;
    logger.log("state", summary);
    return;
  }

  unchangedCount += 1;
  if (unchangedCount >= HEARTBEAT_EVERY_UNCHANGED) {
    unchangedCount = 0;
    logger.log("state", `${summary} (unchanged)`);
  }
}, config.stateLogIntervalMs);
stateLogInterval.unref();

function shutdown(signal: string): void {
  logger.log("connect", `Received ${signal}, shutting down...`);
  clearInterval(observationInterval);
  clearInterval(shadowObservationInterval);
  clearInterval(dangerInterval);
  clearInterval(stateLogInterval);
  actions.clearActionQueue("shutdown");
  movement.stop("shutdown");
  bot.quit("Shutting down");

  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
