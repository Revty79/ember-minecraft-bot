import type { Bot } from "mineflayer";
import { Movements, goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import type { AppConfig } from "../config";
import type {
  ChatController,
  Logger,
  MovementController,
  MovementMode,
  PerceptionController,
  SafetyLayer,
  StateStore
} from "./types";

type ComeGoal = {
  x: number;
  y: number;
  z: number;
  radius: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFinitePosition(position: Vec3 | null | undefined): boolean {
  if (!position) return false;
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function formatPosition(position: Vec3): string {
  return `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`;
}

function isBotAlive(bot: Bot): boolean {
  const runtime = bot as unknown as { isAlive?: boolean };
  return runtime.isAlive ?? bot.health > 0;
}

export function createMovementController(
  bot: Bot,
  config: AppConfig,
  state: StateStore,
  safety: SafetyLayer,
  chat: ChatController,
  perception: PerceptionController,
  logger: Logger
): MovementController {
  let movementMode: MovementMode = "idle";
  let followTarget: string | null = null;
  let activeComeGoal: ComeGoal | null = null;
  let movementTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let respawnTimerActive = false;
  let lastRespawnRequestAt = 0;
  let movementsApplied = false;

  function updateMovementState(mode: MovementMode): void {
    movementMode = mode;
    state.setMovementMode(mode);
    if (mode === "idle") {
      state.setMovementStartedAt(null);
      state.setMovementTimeoutAt(null);
      state.setMovementStuckCount(0);
      state.setMovementGoal(null);
      state.setCurrentGoal(null);
      state.setFollowTarget(null);
    } else {
      state.setMovementStartedAt(nowIso());
      state.setMovementStuckCount(0);
    }
  }

  function getPlayerEntityByUsername(usernameToFind: string) {
    const needle = usernameToFind.toLowerCase();
    const player = Object.values(bot.players).find(
      (candidate) => candidate.username?.toLowerCase() === needle
    );
    return player?.entity;
  }

  function getCurrentGoalDescription(): string {
    if (movementMode === "come" && activeComeGoal) {
      return `GoalNear(${activeComeGoal.x.toFixed(1)}, ${activeComeGoal.y.toFixed(
        1
      )}, ${activeComeGoal.z.toFixed(1)}, r=${activeComeGoal.radius.toFixed(1)})`;
    }

    if (movementMode === "follow") {
      const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
      if (ownerEntity && isFinitePosition(ownerEntity.position)) {
        return `GoalFollow(${config.ownerUsername}, dist=${config.followDistance.toFixed(1)}) @ ${formatPosition(
          ownerEntity.position
        )}`;
      }
      return `GoalFollow(${config.ownerUsername})`;
    }

    return "none";
  }

  function getBotPositionReadiness(): { ready: boolean; reason: string } {
    if (!state.state.ready) {
      return { ready: false, reason: "bot position not valid yet after respawn/death." };
    }

    const position = bot.entity?.position;
    if (!isFinitePosition(position)) {
      return {
        ready: false,
        reason: `bot position not valid yet after respawn/death. raw=${JSON.stringify(position)}`
      };
    }

    return { ready: true, reason: "ok" };
  }

  function getDistanceToOwner(): number | null {
    const readiness = getBotPositionReadiness();
    if (!readiness.ready) return null;

    const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
    if (!ownerEntity || !isFinitePosition(ownerEntity.position)) return null;

    return bot.entity.position.distanceTo(ownerEntity.position);
  }

  function stopPathfinder(reason: string): void {
    if (movementTimeoutHandle) {
      clearTimeout(movementTimeoutHandle);
      movementTimeoutHandle = null;
    }

    bot.pathfinder.stop();
    bot.pathfinder.setGoal(null);
    updateMovementState("idle");
    activeComeGoal = null;
    followTarget = null;
    logger.log("move", `stopped reason=${reason}`);
  }

  function clearMovementState(reason: string): void {
    const previousMode = movementMode;
    const distance = getDistanceToOwner();
    const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
    const goal = getCurrentGoalDescription();
    stopPathfinder(reason);
    logger.log(
      "move",
      `cleared movement state mode=${previousMode} reason=${reason} goal=${goal} distance=${distanceLabel}`
    );
  }

  function scheduleRespawn(reason: string): void {
    const now = Date.now();
    if (respawnTimerActive) {
      logger.log("life", `Respawn already scheduled, skipping (${reason}).`);
      return;
    }

    if (now - lastRespawnRequestAt < config.respawnCooldownMs) {
      logger.log("life", `Respawn request on cooldown, skipping (${reason}).`);
      return;
    }

    respawnTimerActive = true;
    logger.log("life", "Attempting respawn...");

    setTimeout(() => {
      respawnTimerActive = false;

      if (isBotAlive(bot)) {
        logger.log("life", "Respawn skipped: bot already alive.");
        return;
      }

      try {
        bot.respawn();
        lastRespawnRequestAt = Date.now();
        logger.log("life", "Respawn requested.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.setLastError(message);
        logger.error("life", `Respawn request failed: ${message}`);
      }
    }, config.respawnDelayMs);
  }

  function startComeTimeout(): void {
    if (movementTimeoutHandle) {
      clearTimeout(movementTimeoutHandle);
    }

    const timeoutAt = Date.now() + config.pathfinderTimeoutMs;
    state.setMovementTimeoutAt(new Date(timeoutAt).toISOString());

    movementTimeoutHandle = setTimeout(() => {
      if (movementMode !== "come") return;

      const distance = getDistanceToOwner();
      const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
      logger.warn(
        "move",
        `timeout: could not reach owner in ${config.pathfinderTimeoutMs}ms distance=${distanceLabel}`
      );
      clearMovementState("come-timeout");
      chat.send("I couldn't reach you safely.", "come-timeout", { bypassRateLimit: true });
    }, config.pathfinderTimeoutMs);
  }

  function applyConservativeMovements(): void {
    if (movementsApplied) return;
    const movement = new Movements(bot);
    movement.canDig = false;
    movement.canOpenDoors = false;
    movement.allowSprinting = false;
    movement.allowParkour = false;
    movement.allow1by1towers = false;
    movement.maxDropDown = 2;
    movement.infiniteLiquidDropdownDistance = false;
    movement.allowFreeMotion = true;
    bot.pathfinder.setMovements(movement);
    movementsApplied = true;
    logger.log("move", "conservative movement profile applied.");
  }

  async function waitForValidPosition(timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const position = bot.entity?.position;
      if (isFinitePosition(position)) {
        state.setPosition({
          x: position.x,
          y: position.y,
          z: position.z
        });
        return true;
      }

      await sleep(100);
    }

    return false;
  }

  function startFollowOwner(requestor: string, distanceOverride?: number): boolean {
    logger.log("move", `Follow command received from "${requestor}".`);

    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "follow-denied");
      return false;
    }

    if (movementMode !== "idle") {
      clearMovementState("switch-to-follow");
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready) {
      logger.warn("move", `blocked: ${readiness.reason}`);
      chat.send("I respawned, but I am not ready to move yet.", "follow-not-ready");
      return false;
    }

    const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
    if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
      logger.warn("move", "follow blocked: owner position unavailable", {
        ownerPosition: ownerEntity?.position
      });
      chat.send(`I can't see ${config.ownerUsername} right now.`, "follow-owner-missing");
      return false;
    }

    const distance = bot.entity.position.distanceTo(ownerEntity.position);
    logger.log("move", `follow distance=${distance.toFixed(2)}`);

    if (distance > config.maxFollowStartDistance) {
      logger.warn(
        "move",
        `distance blocked: follow distance=${distance.toFixed(2)} > ${config.maxFollowStartDistance.toFixed(
          2
        )}`
      );
      chat.send("You are too far away for me to path safely yet.", "follow-distance-blocked");
      return false;
    }

    updateMovementState("follow");
    followTarget = config.ownerUsername;
    state.setFollowTarget(followTarget);
    state.setCurrentGoal(`Follow ${config.ownerUsername}`);
    state.setMovementGoal(`GoalFollow(${config.ownerUsername}, ${distanceOverride ?? config.followDistance})`);

    const followDistance = distanceOverride ?? config.followDistance;
    bot.pathfinder.setGoal(new goals.GoalFollow(ownerEntity, followDistance), true);

    logger.log("move", `follow start owner=${config.ownerUsername} distance=${followDistance}`);
    chat.send(`Following ${config.ownerUsername}.`, "follow-started");
    return true;
  }

  function startComeToOwner(requestor: string, radiusOverride?: number): boolean {
    logger.log("move", `Come command received from "${requestor}".`);

    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "come-denied");
      return false;
    }

    if (movementMode !== "idle") {
      clearMovementState("switch-to-come");
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready) {
      logger.warn("move", `blocked: ${readiness.reason}`);
      chat.send("I respawned, but I am not ready to move yet.", "come-not-ready");
      return false;
    }

    const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
    if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
      logger.warn("move", "come blocked: owner position unavailable", {
        ownerPosition: ownerEntity?.position
      });
      chat.send(`I can't see ${config.ownerUsername} right now.`, "come-owner-missing");
      return false;
    }

    const distance = bot.entity.position.distanceTo(ownerEntity.position);
    logger.log("move", `come distance=${distance.toFixed(2)}`);

    if (distance > config.maxComeDistance) {
      logger.warn(
        "move",
        `distance blocked: come distance=${distance.toFixed(2)} > ${config.maxComeDistance.toFixed(2)}`
      );
      chat.send("You are too far away for me to path safely yet.", "come-distance-blocked");
      return false;
    }

    const radius = radiusOverride ?? config.comeGoalRadius;
    const { x, y, z } = ownerEntity.position;

    logger.log("move", `come goal radius=${radius}`);
    updateMovementState("come");
    followTarget = null;
    activeComeGoal = { x, y, z, radius };
    state.setCurrentGoal(`Come to ${config.ownerUsername}`);
    state.setMovementGoal(`GoalNear(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}, ${radius})`);

    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, radius), false);
    startComeTimeout();

    chat.send(`Coming to ${config.ownerUsername}.`, "come-started");
    return true;
  }

  function stop(reason: string): void {
    clearMovementState(reason);
  }

  function tryRespawn(requestor: string): boolean {
    logger.log("life", `Manual respawn command received from "${requestor}".`);

    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "respawn-denied");
      return false;
    }

    if (isBotAlive(bot)) {
      chat.send("I am already alive.", "respawn-alive");
      return false;
    }

    scheduleRespawn("manual command");
    chat.send("Respawn requested.", "respawn-requested");
    return true;
  }

  async function lookAtOwner(): Promise<boolean> {
    const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
    if (!ownerEntity || !isFinitePosition(ownerEntity.position)) {
      logger.warn("move", "look-at-owner skipped: owner entity unavailable.");
      return false;
    }

    try {
      await bot.lookAt(ownerEntity.position.offset(0, 1.6, 0), true);
      logger.log("move", `Looked at ${config.ownerUsername}.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("move", `look-at-owner failed: ${message}`);
      return false;
    }
  }

  async function onSpawn(spawnLabel: string): Promise<boolean> {
    state.setReady(false);
    logger.log("life", `Waiting for valid position after ${spawnLabel}...`);

    const valid = await waitForValidPosition(config.positionWaitTimeoutMs);
    if (!valid) {
      logger.warn(
        "life",
        `Position not ready after ${config.positionWaitTimeoutMs}ms (${spawnLabel})`,
        {
          rawPosition: bot.entity?.position
        }
      );
      return false;
    }

    const position = bot.entity?.position;
    if (position && isFinitePosition(position)) {
      state.setPosition({ x: position.x, y: position.y, z: position.z });
      logger.log("life", `Position ready after ${spawnLabel}: ${formatPosition(position)}`);
    }

    state.setReady(true);
    return true;
  }

  function onDeath(): void {
    state.setReady(false);
    state.setAlive(false);
    clearMovementState("death");
    scheduleRespawn("death event");
  }

  function onPathReset(reason: string): void {
    state.setMovementPathResetReason(reason);

    if (reason !== "stuck") {
      return;
    }

    if (movementMode === "idle") {
      return;
    }

    const stuckCount = state.state.movement.stuckCount + 1;
    state.setMovementStuckCount(stuckCount);
    const distance = getDistanceToOwner();
    const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
    const botPos = bot.entity?.position && isFinitePosition(bot.entity.position)
      ? formatPosition(bot.entity.position)
      : "unavailable";

    logger.warn(
      "move",
      `stuck reset ${stuckCount}/${config.stuckResetLimit} mode=${movementMode} bot=${botPos} goal=${getCurrentGoalDescription()} distance=${distanceLabel}`
    );
    state.addEvent("movement_stuck", "Pathfinder reported stuck reset", {
      stuckCount,
      mode: movementMode,
      botPosition: botPos,
      goal: getCurrentGoalDescription(),
      distance
    });

    if (stuckCount < config.stuckResetLimit) {
      return;
    }

    const obstacle = perception.getImmediateObstacles();
    logger.warn("perception", "Obstacle report on stuck stop.", obstacle);
    state.addEvent("obstacle_detected", "Obstacle report captured on stuck limit", obstacle);

    clearMovementState("stuck-limit-reached");
    chat.send("I'm blocked and stopped moving.", "stuck-limit", { bypassRateLimit: true });
  }

  function onGoalReached(goalName: string): void {
    const distance = getDistanceToOwner();
    const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
    logger.log("move", `goal reached name=${goalName} distance=${distanceLabel}`);

    if (movementMode === "come") {
      clearMovementState("come-goal-reached");
    }
  }

  function onPhysicsTick(): void {
    if (movementMode !== "follow" || !followTarget) {
      return;
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready) {
      logger.warn("move", `blocked: ${readiness.reason}`);
      clearMovementState("follow-not-ready");
      return;
    }

    const targetEntity = getPlayerEntityByUsername(followTarget);
    if (!targetEntity || !isFinitePosition(targetEntity.position)) {
      logger.warn("move", "follow stopped: target entity unavailable.");
      clearMovementState("follow-target-unavailable");
      return;
    }

    const currentDistance = bot.entity.position.distanceTo(targetEntity.position);
    if (currentDistance <= config.followDistance + 1) {
      return;
    }

    const currentGoal = (bot.pathfinder as unknown as { goal?: unknown }).goal;
    const hasGoalFollow = currentGoal instanceof goals.GoalFollow;
    const goalEntity = currentGoal as { entity?: unknown };
    const needsGoalRefresh = !hasGoalFollow || goalEntity.entity !== targetEntity;

    if (!needsGoalRefresh) {
      return;
    }

    logger.log("move", `follow refresh distance=${currentDistance.toFixed(2)} target moved.`);
    bot.pathfinder.setGoal(new goals.GoalFollow(targetEntity, config.followDistance), true);
    state.setMovementGoal(`GoalFollow(${followTarget}, ${config.followDistance})`);
  }

  return {
    applyConservativeMovements,
    waitForValidPosition,
    clearMovementState,
    startComeToOwner,
    startFollowOwner,
    stop,
    tryRespawn,
    lookAtOwner,
    onSpawn,
    onDeath,
    onPathReset,
    onGoalReached,
    onPhysicsTick,
    getDistanceToOwner,
    getCurrentGoalDescription
  };
}
