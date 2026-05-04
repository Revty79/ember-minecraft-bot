import type { AppConfig } from "../config";
import type {
  BotEvent,
  BotEventType,
  BotSnapshot,
  BotState,
  CapabilitySummary,
  DangerSummary,
  HomeRecord,
  MovementMode,
  PlayerSummary,
  StateStore,
  Vec3Snapshot
} from "./types";

const MAX_EVENTS = 100;

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultDangerSummary(): DangerSummary {
  return {
    hostileCount: 0,
    nearestHostileName: null,
    nearestHostileDistance: null,
    proximity: "none"
  };
}

function createCapabilities(config: AppConfig): CapabilitySummary {
  return {
    movement: true,
    perception: true,
    home: true,
    flee: config.allowFlee,
    inventoryRead: true,
    eating: config.allowEating,
    mining: config.allowMining,
    combat: config.allowCombat,
    building: config.allowBuilding,
    containers: config.allowInventory,
    ai: config.enableAiBridge
  };
}

function createInitialState(config: AppConfig): BotState {
  return {
    username: config.minecraftUsername,
    connected: false,
    spawned: false,
    ready: false,
    alive: false,
    dead: false,
    health: null,
    food: null,
    saturation: null,
    hungerStatus: "okay",
    oxygen: null,
    onFire: null,
    inLava: null,
    inWater: null,
    onGround: null,
    position: null,
    homePosition: null,
    homeRecord: null,
    dimension: null,
    world: null,
    nearestPlayers: [],
    dangerSummary: createDefaultDangerSummary(),
    capabilities: createCapabilities(config),
    currentGoal: null,
    currentAction: null,
    movement: {
      mode: "idle",
      followTarget: null,
      startedAt: null,
      stuckCount: 0,
      noProgressCount: 0,
      lastPathResetReason: null,
      lastKnownGoal: null,
      timeoutAt: null,
      lastProgressAt: null
    },
    lastError: null,
    lastDeathTimestamp: null,
    lastChatTimestamp: null,
    lastCommandReceived: null,
    safetyFlags: {
      allowMining: config.allowMining,
      allowCombat: config.allowCombat,
      allowBuilding: config.allowBuilding,
      allowInventory: config.allowInventory,
      allowEating: config.allowEating,
      allowFlee: config.allowFlee
    },
    aiBridgeEnabled: config.enableAiBridge,
    aiBridgeUrl: config.enableAiBridge ? config.aiBridgeUrl ?? null : null,
    lastAiBridgeError: null,
    actionQueueLength: 0,
    runningAction: null,
    blockedReason: null
  };
}

export function createStateStore(config: AppConfig): StateStore {
  const state = createInitialState(config);
  const events: BotEvent[] = [];
  let eventCounter = 0;

  function addEvent(type: BotEventType, message: string, data?: unknown): void {
    eventCounter += 1;
    const event: BotEvent = {
      id: eventCounter,
      timestamp: nowIso(),
      type,
      message,
      data
    };
    events.push(event);
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
  }

  function setConnected(value: boolean): void {
    state.connected = value;
    if (!value) {
      state.ready = false;
      state.spawned = false;
    }
  }

  function setSpawned(value: boolean): void {
    state.spawned = value;
  }

  function setReady(value: boolean): void {
    state.ready = value;
  }

  function setAlive(value: boolean): void {
    state.alive = value;
    state.dead = !value;
  }

  function setHealthAndFood(health: number | null, food: number | null): void {
    state.health = health;
    state.food = food;
  }

  function setVitalsDetails(details: {
    saturation: number | null;
    hungerStatus: "full" | "okay" | "hungry" | "starving";
    oxygen: number | null;
    onFire: boolean | null;
    inLava: boolean | null;
    inWater: boolean | null;
    onGround: boolean | null;
  }): void {
    state.saturation = details.saturation;
    state.hungerStatus = details.hungerStatus;
    state.oxygen = details.oxygen;
    state.onFire = details.onFire;
    state.inLava = details.inLava;
    state.inWater = details.inWater;
    state.onGround = details.onGround;
  }

  function setPosition(position: Vec3Snapshot | null): void {
    state.position = position;
  }

  function setHomePosition(position: Vec3Snapshot | null): void {
    state.homePosition = position;
  }

  function setHomeRecord(record: HomeRecord | null): void {
    state.homeRecord = record ? { ...record } : null;
  }

  function setWorldInfo(dimension: string | null, world: string | null): void {
    state.dimension = dimension;
    state.world = world;
  }

  function setNearestPlayers(players: PlayerSummary[]): void {
    state.nearestPlayers = players;
  }

  function setDangerSummary(danger: DangerSummary): void {
    state.dangerSummary = { ...danger };
  }

  function setCapabilities(capabilities: CapabilitySummary): void {
    state.capabilities = { ...capabilities };
  }

  function setCurrentGoal(goal: string | null): void {
    state.currentGoal = goal;
  }

  function setCurrentAction(action: string | null): void {
    state.currentAction = action;
  }

  function setMovementMode(mode: MovementMode): void {
    state.movement.mode = mode;
  }

  function setMovementStuckCount(value: number): void {
    state.movement.stuckCount = value;
  }

  function setMovementNoProgressCount(value: number): void {
    state.movement.noProgressCount = value;
  }

  function setMovementPathResetReason(reason: string | null): void {
    state.movement.lastPathResetReason = reason;
  }

  function setMovementGoal(goal: string | null): void {
    state.movement.lastKnownGoal = goal;
  }

  function setMovementTimeoutAt(timeoutAt: string | null): void {
    state.movement.timeoutAt = timeoutAt;
  }

  function setMovementStartedAt(startedAt: string | null): void {
    state.movement.startedAt = startedAt;
  }

  function setMovementLastProgressAt(timestamp: string | null): void {
    state.movement.lastProgressAt = timestamp;
  }

  function setFollowTarget(target: string | null): void {
    state.movement.followTarget = target;
  }

  function setLastError(message: string | null): void {
    state.lastError = message;
  }

  function setLastDeathTimestamp(isoTimestamp: string | null): void {
    state.lastDeathTimestamp = isoTimestamp;
  }

  function setLastChatTimestamp(isoTimestamp: string | null): void {
    state.lastChatTimestamp = isoTimestamp;
  }

  function setLastCommandReceived(message: string | null): void {
    state.lastCommandReceived = message;
  }

  function setAiBridgeError(message: string | null): void {
    state.lastAiBridgeError = message;
  }

  function setActionQueueInfo(queueLength: number, runningAction: string | null): void {
    state.actionQueueLength = queueLength;
    state.runningAction = runningAction;
  }

  function setBlockedReason(reason: string | null): void {
    state.blockedReason = reason;
  }

  function getBotSnapshot(): BotSnapshot {
    return {
      ...state,
      timestamp: nowIso(),
      nearestPlayers: state.nearestPlayers.map((player) => ({ ...player })),
      position: state.position ? { ...state.position } : null,
      homePosition: state.homePosition ? { ...state.homePosition } : null,
      homeRecord: state.homeRecord ? { ...state.homeRecord } : null,
      dangerSummary: { ...state.dangerSummary },
      capabilities: { ...state.capabilities },
      movement: { ...state.movement },
      safetyFlags: { ...state.safetyFlags }
    };
  }

  function getRecentEvents(limit = 20): BotEvent[] {
    const start = Math.max(0, events.length - limit);
    return events.slice(start).map((event) => ({ ...event }));
  }

  return {
    state,
    setConnected,
    setSpawned,
    setReady,
    setAlive,
    setHealthAndFood,
    setVitalsDetails,
    setPosition,
    setHomePosition,
    setHomeRecord,
    setWorldInfo,
    setNearestPlayers,
    setDangerSummary,
    setCapabilities,
    setCurrentGoal,
    setCurrentAction,
    setMovementMode,
    setMovementStuckCount,
    setMovementNoProgressCount,
    setMovementPathResetReason,
    setMovementGoal,
    setMovementTimeoutAt,
    setMovementStartedAt,
    setMovementLastProgressAt,
    setFollowTarget,
    setLastError,
    setLastDeathTimestamp,
    setLastChatTimestamp,
    setLastCommandReceived,
    setAiBridgeError,
    setActionQueueInfo,
    setBlockedReason,
    getBotSnapshot,
    addEvent,
    getRecentEvents
  };
}
