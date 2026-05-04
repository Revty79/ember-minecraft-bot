import type { Bot } from "mineflayer";
import { Movements, goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import type { AppConfig } from "../config";
import { clearHomeRecord, saveHomeRecord } from "./homeStore";
import { isEntityPositionHealthy, isPositionValid } from "./position";
import type {
  ChatController,
  HomeRecord,
  Logger,
  MovementController,
  MovementMode,
  PerceptionController,
  SafetyLayer,
  StateStore,
  Vec3Snapshot
} from "./types";

type GoalPoint = {
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
  return isPositionValid(position as unknown as { x: unknown; y: unknown; z: unknown } | null | undefined);
}

function formatPosition(position: Vec3): string {
  return `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`;
}

function toSnapshot(position: Vec3): Vec3Snapshot {
  return {
    x: position.x,
    y: position.y,
    z: position.z
  };
}

function computeDistance(a: Vec3Snapshot, b: Vec3Snapshot): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  let activeComeGoal: GoalPoint | null = null;
  let activeHomeGoal: GoalPoint | null = null;
  let activeFleeGoal: GoalPoint | null = null;
  let movementTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let respawnTimerActive = false;
  let lastRespawnRequestAt = 0;
  let movementsApplied = false;

  let lastFollowRepathAt = 0;
  let lastFollowTargetPosition: Vec3Snapshot | null = null;

  let progressAnchor: Vec3Snapshot | null = null;
  let lastProgressCheckAt = 0;
  let stayHomeEnabled = false;

  function getMode(): MovementMode {
    return movementMode;
  }

  function isMoving(): boolean {
    return movementMode !== "idle";
  }

  function updateMovementState(mode: MovementMode): void {
    movementMode = mode;
    state.setMovementMode(mode);

    if (mode === "idle") {
      state.setMovementStartedAt(null);
      state.setMovementTimeoutAt(null);
      state.setMovementStuckCount(0);
      state.setMovementNoProgressCount(0);
      state.setMovementLastProgressAt(null);
      state.setMovementGoal(null);
      state.setCurrentGoal(null);
      state.setFollowTarget(null);
      activeComeGoal = null;
      activeHomeGoal = null;
      activeFleeGoal = null;
      followTarget = null;
      progressAnchor = null;
      lastProgressCheckAt = 0;
      lastFollowRepathAt = 0;
      lastFollowTargetPosition = null;
      return;
    }

    const now = nowIso();
    state.setMovementStartedAt(now);
    state.setMovementStuckCount(0);
    state.setMovementNoProgressCount(0);
    state.setMovementLastProgressAt(now);
    progressAnchor = null;
    lastProgressCheckAt = 0;
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

    if (movementMode === "home" && activeHomeGoal) {
      return `HomeGoal(${activeHomeGoal.x.toFixed(1)}, ${activeHomeGoal.y.toFixed(
        1
      )}, ${activeHomeGoal.z.toFixed(1)}, r=${activeHomeGoal.radius.toFixed(1)})`;
    }

    if (movementMode === "flee" && activeFleeGoal) {
      return `FleeGoal(${activeFleeGoal.x.toFixed(1)}, ${activeFleeGoal.y.toFixed(
        1
      )}, ${activeFleeGoal.z.toFixed(1)}, r=${activeFleeGoal.radius.toFixed(1)})`;
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

    if (!isEntityPositionHealthy(bot)) {
      return {
        ready: false,
        reason: `bot position not valid yet after respawn/death. raw=${JSON.stringify(bot.entity?.position)}`
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

  function stopForDanger(reason: string): void {
    clearMovementState(reason);
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
        logger.error("life", `[life] respawn failed: ${message}`);
      }
    }, config.respawnDelayMs);
  }

  function startMovementTimeout(mode: "come" | "home" | "flee"): void {
    if (movementTimeoutHandle) {
      clearTimeout(movementTimeoutHandle);
    }

    const timeoutAt = Date.now() + config.pathfinderTimeoutMs;
    state.setMovementTimeoutAt(new Date(timeoutAt).toISOString());

    movementTimeoutHandle = setTimeout(() => {
      if (movementMode !== mode) return;

      const distance = getDistanceToOwner();
      const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
      logger.warn(
        "move",
        `timeout: mode=${mode} exceeded ${config.pathfinderTimeoutMs}ms distance=${distanceLabel}`
      );
      clearMovementState(`${mode}-timeout`);
      if (mode === "home") {
        chat.send("I couldn't reach home safely.", "home-timeout", { bypassRateLimit: true });
      } else if (mode === "flee") {
        chat.send("I couldn't reach a safer spot.", "flee-timeout", { bypassRateLimit: true });
      } else {
        chat.send("I couldn't reach you safely.", "come-timeout", { bypassRateLimit: true });
      }
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

  function handleStuck(reason: string, includeNoProgress = false): void {
    if (movementMode === "idle") {
      return;
    }

    const stuckCount = state.state.movement.stuckCount + 1;
    state.setMovementStuckCount(stuckCount);
    if (includeNoProgress) {
      state.setMovementNoProgressCount(state.state.movement.noProgressCount + 1);
    }

    const distance = getDistanceToOwner();
    const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
    const botPos = bot.entity?.position && isFinitePosition(bot.entity.position)
      ? formatPosition(bot.entity.position)
      : "unavailable";

    logger.warn(
      "move",
      `stuck count=${stuckCount}/${config.stuckResetLimit} mode=${movementMode} reason=${reason} bot=${botPos} goal=${getCurrentGoalDescription()} distance=${distanceLabel}`
    );

    state.addEvent("movement_stuck", "Movement stuck signal", {
      stuckCount,
      mode: movementMode,
      reason,
      goal: getCurrentGoalDescription(),
      distance
    });

    if (stuckCount < config.stuckResetLimit) {
      return;
    }

    const obstacle = perception.getImmediateObstacles();
    if (obstacle.frontPassable === false && obstacle.stepUpPossible === true) {
      logger.warn("move", "step-up blocked: front blocked and step-up looked possible.");
    }
    logger.warn("perception", "Obstacle report on stuck stop.", obstacle);
    state.addEvent("obstacle_detected", "Obstacle report captured on stuck limit", obstacle);

    clearMovementState("stuck-limit-reached");
    chat.send("I'm blocked and stopped moving.", "stuck-limit", { bypassRateLimit: true });
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

    const followDistance = distanceOverride ?? config.followDistance;
    state.setMovementGoal(`GoalFollow(${config.ownerUsername}, ${followDistance})`);
    bot.pathfinder.setGoal(new goals.GoalFollow(ownerEntity, followDistance), true);

    lastFollowRepathAt = Date.now();
    lastFollowTargetPosition = toSnapshot(ownerEntity.position);

    logger.log("move", `movement start mode=follow owner=${config.ownerUsername} distance=${followDistance}`);
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

    updateMovementState("come");
    activeComeGoal = { x, y, z, radius };
    state.setCurrentGoal(`Come to ${config.ownerUsername}`);
    state.setMovementGoal(`GoalNear(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}, ${radius})`);

    logger.log("move", `come distance=${distance.toFixed(2)} goalRadius=${radius}`);
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, radius), false);
    startMovementTimeout("come");
    chat.send(`Coming to ${config.ownerUsername}.`, "come-started");
    return true;
  }

  function setHome(requestor: string): boolean {
    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "set-home-denied");
      return false;
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready || !isFinitePosition(bot.entity?.position)) {
      logger.warn("move", `set-home blocked: ${readiness.reason}`);
      chat.send("I am not ready to set home yet.", "set-home-not-ready");
      return false;
    }

    const home = toSnapshot(bot.entity.position);
    const record: HomeRecord = {
      x: home.x,
      y: home.y,
      z: home.z,
      dimension: state.state.dimension,
      world: state.state.world,
      timestamp: nowIso(),
      setBy: requestor
    };

    const persisted = saveHomeRecord(config.homeFilePath, record, logger);
    if (!persisted) {
      chat.send("Failed to persist home.", "set-home-save-failed");
      return false;
    }

    state.setHomePosition(home);
    state.setHomeRecord(record);
    logger.log("move", `home set at (${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)})`);
    state.addEvent("state_update", "Home position set", record);
    chat.send("Home set.", "set-home");
    return true;
  }

  function clearHome(requestor: string): boolean {
    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "clear-home-denied");
      return false;
    }

    const cleared = clearHomeRecord(config.homeFilePath, logger);
    if (!cleared) {
      chat.send("Failed to clear home.", "clear-home-failed");
      return false;
    }

    state.setHomePosition(null);
    state.setHomeRecord(null);
    state.addEvent("state_update", "Home cleared", {
      clearedBy: requestor
    });
    logger.log("move", "home cleared");
    chat.send("Home cleared.", "clear-home");
    return true;
  }

  function goHome(requestor: string): boolean {
    if (!safety.isOwner(requestor) && !safety.isPrivilegedRequester(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "home-denied");
      return false;
    }

    const record = state.state.homeRecord;
    const home = record
      ? { x: record.x, y: record.y, z: record.z }
      : state.state.homePosition;

    if (!home) {
      chat.send("Home is not set yet.", "home-not-set");
      return false;
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready || !isFinitePosition(bot.entity?.position)) {
      logger.warn("move", `home blocked: ${readiness.reason}`);
      chat.send("I am not ready to move yet.", "home-not-ready");
      return false;
    }

    const danger = state.state.dangerSummary;
    if (
      config.stopOnDanger &&
      danger.nearestHostileDistance !== null &&
      danger.nearestHostileDistance <= config.hostileStopRadius
    ) {
      chat.send("Danger is too close. I will not path home right now.", "home-danger-blocked");
      return false;
    }

    const botPos = toSnapshot(bot.entity.position);
    const distance = computeDistance(botPos, home);
    if (distance > config.maxComeDistance) {
      logger.warn("move", `home blocked: distance=${distance.toFixed(2)} > ${config.maxComeDistance.toFixed(2)}`);
      chat.send("Home is too far away for safe pathing right now.", "home-too-far");
      return false;
    }

    if (movementMode !== "idle") {
      clearMovementState("switch-to-home");
    }

    updateMovementState("home");
    activeHomeGoal = {
      x: home.x,
      y: home.y,
      z: home.z,
      radius: config.comeGoalRadius
    };

    state.setCurrentGoal("Return home");
    state.setMovementGoal(
      `GoalNear(${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)}, ${config.comeGoalRadius})`
    );

    logger.log("move", `home start distance=${distance.toFixed(2)} radius=${config.comeGoalRadius}`);
    bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, config.comeGoalRadius), false);
    startMovementTimeout("home");
    chat.send("Returning home.", "home-start");
    return true;
  }

  function setStayHome(requestor: string): boolean {
    if (!safety.isOwner(requestor) && !safety.isPrivilegedRequester(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "stay-home-denied");
      return false;
    }

    const record = state.state.homeRecord;
    const home = record ? { x: record.x, y: record.y, z: record.z } : state.state.homePosition;
    if (!home) {
      chat.send("Home is not set yet.", "stay-home-missing-home");
      return false;
    }

    stayHomeEnabled = true;
    state.setCurrentGoal("Stay near home");
    state.addEvent("state_update", "Stay-home mode enabled", {
      enabledBy: requestor
    });
    logger.log("move", `stay-home enabled by ${requestor}`);
    chat.send("Stay-home mode enabled.", "stay-home-enabled");

    if (movementMode === "idle" && isFinitePosition(bot.entity?.position)) {
      const botPos = toSnapshot(bot.entity.position);
      const homeDistance = computeDistance(botPos, home);
      if (homeDistance > config.fleeHomeRadius) {
        void Promise.resolve().then(() => goHome("SYSTEM"));
      }
    }

    return true;
  }

  function resolveFleeGoal(): GoalPoint | null {
    if (!isFinitePosition(bot.entity?.position)) {
      return null;
    }

    const botPos = toSnapshot(bot.entity.position);
    if (config.fleeToHome) {
      const homeRecord = state.state.homeRecord;
      const home = homeRecord
        ? { x: homeRecord.x, y: homeRecord.y, z: homeRecord.z }
        : state.state.homePosition;

      if (home) {
        const homeDistance = computeDistance(botPos, home);
        if (homeDistance <= config.fleeDistance) {
          return {
            x: home.x,
            y: home.y,
            z: home.z,
            radius: config.fleeHomeRadius
          };
        }
      }
    }

    if (config.fleeToOwner) {
      const ownerEntity = getPlayerEntityByUsername(config.ownerUsername);
      if (ownerEntity && isFinitePosition(ownerEntity.position)) {
        const ownerDistance = bot.entity.position.distanceTo(ownerEntity.position);
        if (ownerDistance <= config.fleeDistance) {
          return {
            x: ownerEntity.position.x,
            y: ownerEntity.position.y,
            z: ownerEntity.position.z,
            radius: Math.max(config.followDistance, 2)
          };
        }
      }
    }

    return null;
  }

  function startFleeFromDanger(requestor: string): boolean {
    const allowChatReply = requestor !== "SYSTEM" && requestor !== "AI";

    if (!safety.isOwner(requestor) && !safety.isPrivilegedRequester(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "flee-denied");
      return false;
    }

    if (movementMode !== "idle") {
      clearMovementState("switch-to-flee");
    }

    const readiness = getBotPositionReadiness();
    if (!readiness.ready) {
      logger.warn("move", `blocked: ${readiness.reason}`);
      if (allowChatReply) {
        chat.send("I respawned, but I am not ready to move yet.", "flee-not-ready");
      }
      return false;
    }

    const fleeGoal = resolveFleeGoal();
    if (!fleeGoal) {
      logger.warn("survival", "No safe flee goal available. Stopping movement.");
      clearMovementState("flee-no-target");
      if (allowChatReply) {
        chat.send("Danger close. I am stopping.", "flee-no-target");
      }
      return false;
    }

    if (!isFinitePosition(bot.entity?.position)) {
      if (allowChatReply) {
        chat.send("I am not ready to flee yet.", "flee-no-position");
      }
      return false;
    }

    const distance = computeDistance(toSnapshot(bot.entity.position), {
      x: fleeGoal.x,
      y: fleeGoal.y,
      z: fleeGoal.z
    });
    updateMovementState("flee");
    activeFleeGoal = fleeGoal;
    state.setCurrentGoal("Flee danger");
    state.setMovementGoal(
      `GoalNear(${fleeGoal.x.toFixed(1)}, ${fleeGoal.y.toFixed(1)}, ${fleeGoal.z.toFixed(1)}, ${fleeGoal.radius})`
    );

    logger.warn(
      "survival",
      `flee start target=(${fleeGoal.x.toFixed(1)}, ${fleeGoal.y.toFixed(1)}, ${fleeGoal.z.toFixed(
        1
      )}) radius=${fleeGoal.radius} distance=${distance.toFixed(2)}`
    );
    bot.pathfinder.setGoal(new goals.GoalNear(fleeGoal.x, fleeGoal.y, fleeGoal.z, fleeGoal.radius), false);
    startMovementTimeout("flee");
    if (allowChatReply) {
      chat.send("Fleeing to a safer spot.", "flee-started");
    }
    return true;
  }

  function stop(reason: string): void {
    if (reason.includes("stop command")) {
      stayHomeEnabled = false;
      state.addEvent("state_update", "Stay-home mode disabled", {
        reason
      });
    }
    clearMovementState(reason);
  }

  function tryRespawn(requestor: string): boolean {
    logger.log("life", `Manual respawn command received from "${requestor}".`);

    if (!safety.isOwner(requestor)) {
      chat.send(`Only ${config.ownerUsername} can issue movement commands.`, "respawn-denied");
      return false;
    }

    if (isBotAlive(bot)) {
      if (!isEntityPositionHealthy(bot)) {
        chat.send("I am alive but my position is invalid. Use Ember recover.", "respawn-invalid-alive");
        return false;
      }
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
    clearMovementState("spawn-reset");
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
    if (reason === "stuck") {
      handleStuck("path_reset:stuck");
    }
  }

  function onGoalReached(goalName: string): void {
    const distance = getDistanceToOwner();
    const distanceLabel = distance === null ? "unavailable" : distance.toFixed(2);
    logger.log("move", `goal reached name=${goalName} distance=${distanceLabel}`);

    if (movementMode === "come") {
      clearMovementState("come-goal-reached");
      return;
    }

    if (movementMode === "home") {
      clearMovementState("home-goal-reached");
      chat.send("Reached home.", "home-reached", { bypassRateLimit: true });
      return;
    }

    if (movementMode === "flee") {
      clearMovementState("flee-goal-reached");
      chat.send("Reached a safer spot.", "flee-reached", { bypassRateLimit: true });
    }
  }

  function onPhysicsTick(): void {
    if (movementMode !== "idle" && isFinitePosition(bot.entity?.position)) {
      const now = Date.now();
      const currentPosition = toSnapshot(bot.entity.position);

      if (!progressAnchor) {
        progressAnchor = currentPosition;
        lastProgressCheckAt = now;
        state.setMovementLastProgressAt(nowIso());
      } else if (now - lastProgressCheckAt >= config.movementProgressCheckMs) {
        const movedDistance = computeDistance(progressAnchor, currentPosition);
        lastProgressCheckAt = now;
        progressAnchor = currentPosition;
        state.setMovementLastProgressAt(nowIso());

        if (movedDistance < config.minProgressDistance) {
          logger.warn(
            "move",
            `no progress mode=${movementMode} moved=${movedDistance.toFixed(2)} < ${config.minProgressDistance.toFixed(2)} over ${config.movementProgressCheckMs}ms`
          );
          handleStuck("no-progress", true);
        } else {
          state.setMovementNoProgressCount(0);
          state.setMovementStuckCount(0);
        }
      }
    }

    if (stayHomeEnabled && movementMode === "idle" && isFinitePosition(bot.entity?.position)) {
      const homeRecord = state.state.homeRecord;
      const home = homeRecord
        ? { x: homeRecord.x, y: homeRecord.y, z: homeRecord.z }
        : state.state.homePosition;

      if (home) {
        const danger = state.state.dangerSummary;
        if (
          config.stopOnDanger &&
          danger.nearestHostileDistance !== null &&
          danger.nearestHostileDistance <= config.hostileStopRadius
        ) {
          return;
        }

        const botPos = toSnapshot(bot.entity.position);
        const distanceHome = computeDistance(botPos, home);
        if (distanceHome > config.fleeHomeRadius) {
          logger.log("move", `stay-home drift detected distance=${distanceHome.toFixed(2)}. Returning home.`);
          goHome("SYSTEM");
        }
      }
    }

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

    const now = Date.now();
    if (now - lastFollowRepathAt < config.followRepathIntervalMs) {
      return;
    }

    const targetSnapshot = toSnapshot(targetEntity.position);
    if (lastFollowTargetPosition) {
      const delta = computeDistance(lastFollowTargetPosition, targetSnapshot);
      if (delta < config.minGoalRefreshDistance) {
        return;
      }
    }

    logger.log("move", `follow refresh distance=${currentDistance.toFixed(2)} target moved.`);
    bot.pathfinder.setGoal(new goals.GoalFollow(targetEntity, config.followDistance), true);
    state.setMovementGoal(`GoalFollow(${followTarget}, ${config.followDistance})`);
    lastFollowTargetPosition = targetSnapshot;
    lastFollowRepathAt = now;
  }

  return {
    applyConservativeMovements,
    waitForValidPosition,
    clearMovementState,
    startComeToOwner,
    startFollowOwner,
    setHome,
    clearHome,
    goHome,
    setStayHome,
    startFleeFromDanger,
    stop,
    stopForDanger,
    tryRespawn,
    lookAtOwner,
    onSpawn,
    onDeath,
    onPathReset,
    onGoalReached,
    onPhysicsTick,
    getDistanceToOwner,
    getCurrentGoalDescription,
    getMode,
    isMoving,
    isStayHomeEnabled: () => stayHomeEnabled,
    isEntityPositionHealthy: () => isEntityPositionHealthy(bot)
  };
}
