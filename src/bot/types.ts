import type { Bot } from "mineflayer";

export type LogPrefix =
  | "config"
  | "connect"
  | "recovery"
  | "life"
  | "chat"
  | "command"
  | "action"
  | "safety"
  | "move"
  | "pathfinder"
  | "mining"
  | "perception"
  | "ai"
  | "state"
  | "survival";

export interface Logger {
  log: (prefix: LogPrefix, message: string, data?: unknown) => void;
  warn: (prefix: LogPrefix, message: string, data?: unknown) => void;
  error: (prefix: LogPrefix, message: string, data?: unknown) => void;
}

export interface Vec3Snapshot {
  x: number;
  y: number;
  z: number;
}

export interface PlayerSummary {
  username: string;
  distance: number;
  position: Vec3Snapshot | null;
}

export interface EntitySummary {
  id: number;
  type: string;
  name: string;
  displayName: string | null;
  distance: number;
  position: Vec3Snapshot | null;
}

export interface BlockSummary {
  name: string;
  count: number;
}

export interface NearbyBlockTarget {
  name: string;
  position: Vec3Snapshot;
  distance: number;
}

export interface ObstacleBlockInfo {
  position: Vec3Snapshot | null;
  name: string | null;
  boundingBox: string | null;
}

export interface ImmediateObstacleReport {
  botPosition: Vec3Snapshot | null;
  yaw: number | null;
  pitch: number | null;
  forwardVector: Vec3Snapshot | null;
  blockBelow: ObstacleBlockInfo;
  blockAtFeet: ObstacleBlockInfo;
  blockAtHead: ObstacleBlockInfo;
  blockFrontFeet: ObstacleBlockInfo;
  blockFrontHead: ObstacleBlockInfo;
  blockFrontStepUp: ObstacleBlockInfo;
  blockFrontStepDown: ObstacleBlockInfo;
  fluidAtFeet: string | null;
  fluidFrontFeet: string | null;
  fluidFrontStepDown: string | null;
  frontPassable: boolean | null;
  stepUpPossible: boolean | null;
  appearsStuck: boolean;
}

export type DangerProximity = "none" | "far" | "medium" | "close" | "critical";

export interface DangerSummary {
  hostileCount: number;
  nearestHostileName: string | null;
  nearestHostileDistance: number | null;
  proximity: DangerProximity;
}

export type HungerStatus = "full" | "okay" | "hungry" | "starving";

export interface FoodItemSummary {
  name: string;
  count: number;
}

export interface InventorySummary {
  totalSlots: number;
  usedSlots: number;
  emptySlots: number;
  heldItem: string | null;
  foodCount: number;
  toolCount: number;
  weaponCount: number;
  armorCount: number;
  importantMaterials: Record<string, number>;
  foodItems: FoodItemSummary[];
}

export type BlockClass =
  | "air"
  | "passable"
  | "solid"
  | "fluid"
  | "ore"
  | "dirt"
  | "stone"
  | "log"
  | "leaves"
  | "container"
  | "utility"
  | "dangerous"
  | "forbidden"
  | "unknown";

export interface ClassifiedBlock {
  name: string | null;
  classification: BlockClass;
}

export interface ToolSummary {
  pickaxe: string | null;
  shovel: string | null;
  axe: string | null;
  weapon: string | null;
}

export interface ArmorSummary {
  head: string | null;
  torso: string | null;
  legs: string | null;
  feet: string | null;
}

export interface EquipmentSummary {
  heldItem: string | null;
  tools: ToolSummary;
  armor: ArmorSummary;
}

export interface CapabilitySummary {
  movement: boolean;
  perception: boolean;
  home: boolean;
  flee: boolean;
  inventoryRead: boolean;
  equipment: boolean;
  eating: boolean;
  mining: boolean;
  harvesting: boolean;
  cropHarvesting: boolean;
  combat: boolean;
  building: boolean;
  crafting: boolean;
  containers: boolean;
  ai: boolean;
}

export interface HomeRecord {
  x: number;
  y: number;
  z: number;
  dimension: string | null;
  world: string | null;
  timestamp: string;
  setBy: string;
}

export interface PerceptionSnapshot {
  timestamp: string;
  nearbyPlayers: PlayerSummary[];
  nearbyEntities: EntitySummary[];
  nearbyHostileMobs: EntitySummary[];
  nearbyBlocksSummary: BlockSummary[];
  immediateObstacles: ImmediateObstacleReport;
  dangerSummary: DangerSummary;
}

export type MovementMode = "idle" | "come" | "follow" | "home" | "flee";

export interface MovementState {
  mode: MovementMode;
  followTarget: string | null;
  startedAt: string | null;
  stuckCount: number;
  noProgressCount: number;
  lastPathResetReason: string | null;
  lastKnownGoal: string | null;
  timeoutAt: string | null;
  lastProgressAt: string | null;
}

export interface SafetyFlags {
  allowMining: boolean;
  allowCombat: boolean;
  allowBuilding: boolean;
  allowInventory: boolean;
  allowEating: boolean;
  allowEquip: boolean;
  allowFlee: boolean;
  allowHarvest: boolean;
  allowCropHarvest: boolean;
}

export interface BotState {
  username: string;
  connected: boolean;
  spawned: boolean;
  ready: boolean;
  alive: boolean;
  dead: boolean;
  health: number | null;
  food: number | null;
  saturation: number | null;
  hungerStatus: HungerStatus;
  oxygen: number | null;
  onFire: boolean | null;
  inLava: boolean | null;
  inWater: boolean | null;
  onGround: boolean | null;
  position: Vec3Snapshot | null;
  homePosition: Vec3Snapshot | null;
  homeRecord: HomeRecord | null;
  dimension: string | null;
  world: string | null;
  nearestPlayers: PlayerSummary[];
  dangerSummary: DangerSummary;
  capabilities: CapabilitySummary;
  currentGoal: string | null;
  currentAction: string | null;
  movement: MovementState;
  lastError: string | null;
  lastDeathTimestamp: string | null;
  lastChatTimestamp: string | null;
  lastCommandReceived: string | null;
  safetyFlags: SafetyFlags;
  aiBridgeEnabled: boolean;
  aiBridgeUrl: string | null;
  lastAiBridgeError: string | null;
  actionQueueLength: number;
  runningAction: string | null;
  blockedReason: string | null;
}

export interface BotSnapshot extends BotState {
  timestamp: string;
}

export type BotEventType =
  | "login"
  | "spawn"
  | "death"
  | "respawn"
  | "kicked"
  | "disconnect"
  | "chat_command"
  | "action_started"
  | "action_completed"
  | "movement_stuck"
  | "obstacle_detected"
  | "safety_rejection"
  | "ai_bridge_skipped"
  | "ai_bridge_sent"
  | "ai_bridge_error"
  | "state_update"
  | "error";

export interface BotEvent {
  id: number;
  timestamp: string;
  type: BotEventType;
  message: string;
  data?: unknown;
}

export type BotAction =
  | { type: "CHAT"; message: string; reason?: string }
  | { type: "COME_TO_OWNER"; radius?: number }
  | { type: "FOLLOW_OWNER"; distance?: number }
  | { type: "STOP_MOVING" }
  | { type: "RESPAWN" }
  | { type: "LOOK_AT_OWNER" }
  | { type: "SET_HOME" }
  | { type: "GO_HOME" }
  | { type: "SET_STAY_HOME" }
  | { type: "FLEE_DANGER" }
  | { type: "CLEAR_HOME" }
  | { type: "RECOVER" }
  | { type: "REPORT_STATE" }
  | { type: "REPORT_OBSTACLE" }
  | { type: "REPORT_STATUS" }
  | { type: "REPORT_WHERE_ARE_YOU" }
  | { type: "REPORT_NEARBY" }
  | { type: "REPORT_LOOK" }
  | { type: "REPORT_HELP" }
  | { type: "REPORT_DISTANCE" }
  | { type: "REPORT_DEBUG" }
  | { type: "REPORT_AI_STATUS" }
  | { type: "REPORT_ACTION_QUEUE" }
  | { type: "REPORT_CAPABILITIES" }
  | { type: "REPORT_VITALS" }
  | { type: "REPORT_HUNGER" }
  | { type: "REPORT_DANGER" }
  | { type: "REPORT_THREAT" }
  | { type: "REPORT_INVENTORY" }
  | { type: "REPORT_EQUIPMENT" }
  | { type: "REPORT_FOOD" }
  | { type: "REPORT_MOVEMENT" }
  | { type: "REPORT_TARGET" }
  | { type: "REPORT_BLOCK" }
  | { type: "REPORT_ORES_NEARBY" }
  | { type: "REPORT_ORE_REPORT" }
  | { type: "REPORT_HARVEST_REPORT" }
  | { type: "REPORT_HOME_STATUS" }
  | { type: "REPORT_SAFETY_TEST" }
  | { type: "MINE_BLOCK"; blockName?: string; mode?: "front" | "ore" }
  | { type: "STOP_MINING" }
  | { type: "HARVEST_BLOCK"; mode?: "front" | "grass" | "crop" }
  | { type: "STOP_HARVEST" }
  | { type: "ATTACK_ENTITY"; entityName?: string }
  | { type: "PLACE_BLOCK"; blockName?: string }
  | { type: "CRAFT_ITEM"; itemName?: string }
  | { type: "OPEN_INVENTORY" }
  | { type: "EQUIP_ITEM"; itemName?: string; category?: "food" | "pickaxe" | "shovel" | "axe" }
  | { type: "EAT_FOOD"; itemName?: string; force?: boolean };

export interface ActionQueueItem {
  id: number;
  createdAt: string;
  requestedBy: string;
  action: BotAction;
}

export interface ActionQueueSummary {
  queued: number;
  running: string | null;
  next: string | null;
}

export interface CommandInput {
  username: string;
  message: string;
}

export interface AiObservation {
  timestamp: string;
  bot: BotSnapshot;
  perception: PerceptionSnapshot;
  survival: {
    vitals: {
      health: number | null;
      maxHealth: number;
      food: number | null;
      maxFood: number;
      saturation: number | null;
      oxygen: number | null;
      alive: boolean;
      danger: DangerProximity;
      position: Vec3Snapshot | null;
    };
    equipment: EquipmentSummary;
    food: FoodItemSummary[];
    mining: {
      enabled: boolean;
      allowedBlocks: string[];
      forbiddenBlocks: string[];
      maxDistance: number;
      homeProtectionRadius: number;
      previewMaxDistance: number;
    };
    harvesting: {
      enabled: boolean;
      cropHarvestingEnabled: boolean;
      replantEnabled: boolean;
      allowedBlocks: string[];
      forbiddenBlocks: string[];
      maxDistance: number;
    };
    visibleOres: BlockSummary[];
    mineableOres: BlockSummary[];
    targetBlock: {
      name: string | null;
      category: BlockClass | null;
      distance: number | null;
    };
    homeProtection: {
      enabled: boolean;
      homeSet: boolean;
    };
    safetyFlags: SafetyFlags;
  };
  actionQueue: ActionQueueSummary;
  recentEvents: BotEvent[];
}

export interface AiActionRequest {
  actions: BotAction[];
  say?: string;
}

export interface AiBridgeStatus {
  enabled: boolean;
  url: string | null;
  lastError: string | null;
}

export interface StateStore {
  state: BotState;
  setConnected: (value: boolean) => void;
  setSpawned: (value: boolean) => void;
  setReady: (value: boolean) => void;
  setAlive: (value: boolean) => void;
  setHealthAndFood: (health: number | null, food: number | null) => void;
  setVitalsDetails: (details: {
    saturation: number | null;
    hungerStatus: HungerStatus;
    oxygen: number | null;
    onFire: boolean | null;
    inLava: boolean | null;
    inWater: boolean | null;
    onGround: boolean | null;
  }) => void;
  setPosition: (position: Vec3Snapshot | null) => void;
  setHomePosition: (position: Vec3Snapshot | null) => void;
  setHomeRecord: (record: HomeRecord | null) => void;
  setWorldInfo: (dimension: string | null, world: string | null) => void;
  setNearestPlayers: (players: PlayerSummary[]) => void;
  setDangerSummary: (danger: DangerSummary) => void;
  setCapabilities: (capabilities: CapabilitySummary) => void;
  setCurrentGoal: (goal: string | null) => void;
  setCurrentAction: (action: string | null) => void;
  setMovementMode: (mode: MovementMode) => void;
  setMovementStuckCount: (value: number) => void;
  setMovementNoProgressCount: (value: number) => void;
  setMovementPathResetReason: (reason: string | null) => void;
  setMovementGoal: (goal: string | null) => void;
  setMovementTimeoutAt: (timeoutAt: string | null) => void;
  setMovementStartedAt: (startedAt: string | null) => void;
  setMovementLastProgressAt: (timestamp: string | null) => void;
  setFollowTarget: (target: string | null) => void;
  setLastError: (message: string | null) => void;
  setLastDeathTimestamp: (isoTimestamp: string | null) => void;
  setLastChatTimestamp: (isoTimestamp: string | null) => void;
  setLastCommandReceived: (message: string | null) => void;
  setAiBridgeError: (message: string | null) => void;
  setActionQueueInfo: (queueLength: number, runningAction: string | null) => void;
  setBlockedReason: (reason: string | null) => void;
  getBotSnapshot: () => BotSnapshot;
  addEvent: (type: BotEventType, message: string, data?: unknown) => void;
  getRecentEvents: (limit?: number) => BotEvent[];
}

export interface ChatController {
  setChatReady: (ready: boolean) => void;
  isChatReady: () => boolean;
  send: (
    message: string,
    reason: string,
    options?: { bypassRateLimit?: boolean; bypassNotReadyCooldown?: boolean }
  ) => boolean;
}

export interface SafetyDecision {
  allowed: boolean;
  reason?: string;
  action?: BotAction;
}

export interface SafetyLayer {
  isOwner: (username: string) => boolean;
  isPrivilegedRequester: (requestor: string) => boolean;
  normalizeChatMessage: (message: string) => string;
  validateAction: (requestor: string, action: BotAction, options?: { dryRun?: boolean }) => SafetyDecision;
}

export interface MovementController {
  applyConservativeMovements: () => void;
  waitForValidPosition: (timeoutMs: number) => Promise<boolean>;
  clearMovementState: (reason: string) => void;
  startComeToOwner: (requestor: string, radiusOverride?: number) => boolean;
  startFollowOwner: (requestor: string, distanceOverride?: number) => boolean;
  setHome: (requestor: string) => boolean;
  clearHome: (requestor: string) => boolean;
  goHome: (requestor: string) => boolean;
  setStayHome: (requestor: string) => boolean;
  startFleeFromDanger: (requestor: string) => boolean;
  stop: (reason: string) => void;
  stopForDanger: (reason: string) => void;
  tryRespawn: (requestor: string) => boolean;
  lookAtOwner: () => Promise<boolean>;
  onSpawn: (spawnLabel: string) => Promise<boolean>;
  onDeath: () => void;
  onPathReset: (reason: string) => void;
  onGoalReached: (goalName: string) => void;
  onPhysicsTick: () => void;
  getDistanceToOwner: () => number | null;
  getCurrentGoalDescription: () => string;
  getMode: () => MovementMode;
  isMoving: () => boolean;
  isStayHomeEnabled: () => boolean;
  isEntityPositionHealthy: () => boolean;
}

export interface PerceptionController {
  getNearbyPlayers: (radius: number) => PlayerSummary[];
  getNearbyEntities: (radius: number) => EntitySummary[];
  getNearbyHostileMobs: (radius: number) => EntitySummary[];
  getNearbyBlocksSummary: (radius: number) => BlockSummary[];
  getNearbyBlocksByName: (name: string, radius: number) => BlockSummary[];
  getNearbyOresSummary: (radius: number) => BlockSummary[];
  getNearestOre: (radius: number) => NearbyBlockTarget | null;
  classifyBlock: (blockName: string | null) => BlockClass;
  getBlockInFront: () => ClassifiedBlock;
  getImmediateObstacles: () => ImmediateObstacleReport;
  getDangerSummary: (radius?: number) => DangerSummary;
  getPerceptionSnapshot: () => PerceptionSnapshot;
}

export interface ActionController {
  queueAction: (requestedBy: string, action: BotAction) => void;
  clearActionQueue: (reason: string) => void;
  clearMovementActions: (reason: string) => void;
  getActionQueueSummary: () => ActionQueueSummary;
}

export interface AiBridgeController {
  getStatus: () => AiBridgeStatus;
  sendObservationToAiBridge: () => Promise<void>;
  buildObservation: () => AiObservation;
}

export interface CommandRouter {
  routeChatMessage: (input: CommandInput) => void;
}

export interface LifecycleController {
  bind: () => void;
}

export interface BotRuntime {
  bot: Bot;
  state: StateStore;
  chat: ChatController;
  movement: MovementController;
  perception: PerceptionController;
  actions: ActionController;
  aiBridge: AiBridgeController;
  commands: CommandRouter;
  lifecycle: LifecycleController;
}
