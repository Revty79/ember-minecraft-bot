import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type {
  BlockSummary,
  DangerSummary,
  EntitySummary,
  ImmediateObstacleReport,
  ObstacleBlockInfo,
  PerceptionController,
  PerceptionSnapshot,
  PlayerSummary,
  StateStore,
  Vec3Snapshot,
  Logger
} from "./types";

const HOSTILE_MOBS = new Set<string>([
  "zombie",
  "husk",
  "drowned",
  "skeleton",
  "stray",
  "creeper",
  "spider",
  "cave_spider",
  "enderman",
  "witch",
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "phantom",
  "slime",
  "magma_cube",
  "warden",
  "zombified_piglin"
]);

const PASSABLE_BLOCKS = new Set<string>([
  "air",
  "cave_air",
  "void_air",
  "water",
  "flowing_water",
  "lava",
  "flowing_lava",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "vine",
  "snow",
  "torch",
  "wall_torch",
  "redstone_torch",
  "wall_redstone_torch"
]);

function toVec3Snapshot(position: { x: number; y: number; z: number } | null | undefined): Vec3Snapshot | null {
  if (!position) return null;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return null;
  return {
    x: Number(position.x),
    y: Number(position.y),
    z: Number(position.z)
  };
}

function blockInfo(bot: Bot, position: Vec3 | null): ObstacleBlockInfo {
  if (!position) {
    return {
      position: null,
      name: null,
      boundingBox: null
    };
  }

  const block = bot.blockAt(position);
  return {
    position: toVec3Snapshot(position),
    name: block?.name ?? null,
    boundingBox: block?.boundingBox ?? null
  };
}

function isFluid(name: string | null): boolean {
  if (!name) return false;
  return name.includes("water") || name.includes("lava");
}

function isPassableBlock(name: string | null, boundingBox: string | null): boolean | null {
  if (!name) return null;
  if (PASSABLE_BLOCKS.has(name)) return true;
  if (boundingBox === "empty") return true;
  return false;
}

export function createPerceptionController(bot: Bot, state: StateStore, logger: Logger): PerceptionController {
  let lastPosition: Vec3Snapshot | null = null;
  let lastPositionTimestamp = Date.now();

  function getBotPosition(): Vec3Snapshot | null {
    return toVec3Snapshot(bot.entity?.position);
  }

  function computeDistance(a: Vec3Snapshot, b: Vec3Snapshot): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function getNearbyPlayers(radius: number): PlayerSummary[] {
    const botPos = getBotPosition();
    if (!botPos) return [];

    const players: PlayerSummary[] = [];
    for (const player of Object.values(bot.players)) {
      const pos = toVec3Snapshot(player.entity?.position);
      if (!pos) continue;

      const distance = computeDistance(botPos, pos);
      if (distance > radius) continue;

      players.push({
        username: player.username,
        distance,
        position: pos
      });
    }

    return players.sort((a, b) => a.distance - b.distance);
  }

  function getNearbyEntities(radius: number): EntitySummary[] {
    const botPos = getBotPosition();
    if (!botPos) return [];

    const entities: EntitySummary[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (bot.entity && entity.id === bot.entity.id) continue;

      const pos = toVec3Snapshot(entity.position);
      if (!pos) continue;

      const distance = computeDistance(botPos, pos);
      if (distance > radius) continue;

      entities.push({
        id: entity.id,
        type: entity.type ? String(entity.type) : "unknown",
        name: entity.name ?? "unknown",
        mobType: entity.mobType ?? null,
        distance,
        position: pos
      });
    }

    return entities.sort((a, b) => a.distance - b.distance);
  }

  function getNearbyHostileMobs(radius: number): EntitySummary[] {
    return getNearbyEntities(radius).filter((entity) => {
      const name = entity.name.toLowerCase();
      const mobType = entity.mobType?.toLowerCase() ?? "";
      if (HOSTILE_MOBS.has(name)) return true;
      if (HOSTILE_MOBS.has(mobType)) return true;
      if (mobType === "hostile") return true;
      return false;
    });
  }

  function getDangerSummary(radius = 24): DangerSummary {
    const hostiles = getNearbyHostileMobs(radius);
    if (hostiles.length === 0) {
      return {
        hostileCount: 0,
        nearestHostileName: null,
        nearestHostileDistance: null,
        proximity: "none"
      };
    }

    const nearest = hostiles[0];
    const distance = nearest.distance;

    let proximity: DangerSummary["proximity"] = "far";
    if (distance <= 4) {
      proximity = "close";
    } else if (distance <= 10) {
      proximity = "medium";
    }

    return {
      hostileCount: hostiles.length,
      nearestHostileName: nearest.name,
      nearestHostileDistance: distance,
      proximity
    };
  }

  function getNearbyBlocksSummary(radius: number): BlockSummary[] {
    if (!bot.entity) return [];

    const sampledRadius = Math.min(Math.max(Math.floor(radius), 1), 6);
    const center = bot.entity.position.floored();
    const counts = new Map<string, number>();

    for (let dx = -sampledRadius; dx <= sampledRadius; dx += 1) {
      for (let dy = -sampledRadius; dy <= sampledRadius; dy += 1) {
        for (let dz = -sampledRadius; dz <= sampledRadius; dz += 1) {
          const pos = new Vec3(center.x + dx, center.y + dy, center.z + dz);
          const block = bot.blockAt(pos);
          if (!block) continue;
          if (block.name === "air" || block.name === "cave_air" || block.name === "void_air") continue;
          counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
        }
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }

  function getImmediateObstacles(): ImmediateObstacleReport {
    const position = bot.entity?.position;
    const pos = toVec3Snapshot(position);
    const yaw = bot.entity ? bot.entity.yaw : null;
    const pitch = bot.entity ? bot.entity.pitch : null;

    let blockBelow: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockAtFeet: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockAtHead: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockFrontFeet: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockFrontHead: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockFrontStepUp: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let blockFrontStepDown: ObstacleBlockInfo = { position: null, name: null, boundingBox: null };
    let fluidAtFeet: string | null = null;
    let fluidFrontFeet: string | null = null;
    let fluidFrontStepDown: string | null = null;
    let frontPassable: boolean | null = null;
    let stepUpPossible: boolean | null = null;
    let forwardVector: Vec3Snapshot | null = null;
    let appearsStuck = state.state.movement.stuckCount > 0 || state.state.movement.noProgressCount > 0;

    if (position && pos && Number.isFinite(yaw ?? Number.NaN)) {
      const floored = position.floored();
      const forwardX = -Math.sin(yaw as number);
      const forwardZ = -Math.cos(yaw as number);
      forwardVector = {
        x: Number(forwardX.toFixed(4)),
        y: 0,
        z: Number(forwardZ.toFixed(4))
      };

      const frontX = Math.floor(position.x + forwardX);
      const frontZ = Math.floor(position.z + forwardZ);
      const feetY = Math.floor(position.y);

      blockBelow = blockInfo(bot, new Vec3(floored.x, floored.y - 1, floored.z));
      blockAtFeet = blockInfo(bot, new Vec3(floored.x, floored.y, floored.z));
      blockAtHead = blockInfo(bot, new Vec3(floored.x, floored.y + 1, floored.z));
      blockFrontFeet = blockInfo(bot, new Vec3(frontX, feetY, frontZ));
      blockFrontHead = blockInfo(bot, new Vec3(frontX, feetY + 1, frontZ));
      blockFrontStepUp = blockInfo(bot, new Vec3(frontX, feetY + 1, frontZ));
      blockFrontStepDown = blockInfo(bot, new Vec3(frontX, feetY - 1, frontZ));
      const blockFrontStepUpHead = blockInfo(bot, new Vec3(frontX, feetY + 2, frontZ));

      fluidAtFeet = isFluid(blockAtFeet.name) ? blockAtFeet.name : null;
      fluidFrontFeet = isFluid(blockFrontFeet.name) ? blockFrontFeet.name : null;
      fluidFrontStepDown = isFluid(blockFrontStepDown.name) ? blockFrontStepDown.name : null;

      const frontFeetPassable = isPassableBlock(blockFrontFeet.name, blockFrontFeet.boundingBox);
      const frontHeadPassable = isPassableBlock(blockFrontHead.name, blockFrontHead.boundingBox);
      if (frontFeetPassable !== null && frontHeadPassable !== null) {
        frontPassable = frontFeetPassable && frontHeadPassable;
      }

      const stepSpacePassable = isPassableBlock(blockFrontStepUp.name, blockFrontStepUp.boundingBox);
      const stepHeadPassable = isPassableBlock(blockFrontStepUpHead.name, blockFrontStepUpHead.boundingBox);
      if (frontFeetPassable !== null && stepSpacePassable !== null && stepHeadPassable !== null) {
        stepUpPossible = !frontFeetPassable && stepSpacePassable && stepHeadPassable;
      }

      const now = Date.now();
      if (state.state.movement.mode !== "idle") {
        if (lastPosition) {
          const movedDistance = computeDistance(pos, lastPosition);
          if (movedDistance < 0.05 && now - lastPositionTimestamp > 3500) {
            appearsStuck = true;
          }
          if (movedDistance >= 0.05) {
            lastPositionTimestamp = now;
          }
        } else {
          lastPositionTimestamp = now;
        }
      } else {
        lastPositionTimestamp = now;
      }
      lastPosition = pos;
    }

    const report: ImmediateObstacleReport = {
      botPosition: pos,
      yaw: Number.isFinite(yaw ?? Number.NaN) ? (yaw as number) : null,
      pitch: Number.isFinite(pitch ?? Number.NaN) ? (pitch as number) : null,
      forwardVector,
      blockBelow,
      blockAtFeet,
      blockAtHead,
      blockFrontFeet,
      blockFrontHead,
      blockFrontStepUp,
      blockFrontStepDown,
      fluidAtFeet,
      fluidFrontFeet,
      fluidFrontStepDown,
      frontPassable,
      stepUpPossible,
      appearsStuck
    };

    if (appearsStuck) {
      logger.warn("perception", "Obstacle report indicates potential stuck state.", report);
    }

    return report;
  }

  function getPerceptionSnapshot(): PerceptionSnapshot {
    const snapshot: PerceptionSnapshot = {
      timestamp: new Date().toISOString(),
      nearbyPlayers: getNearbyPlayers(24),
      nearbyEntities: getNearbyEntities(24),
      nearbyHostileMobs: getNearbyHostileMobs(24),
      nearbyBlocksSummary: getNearbyBlocksSummary(4),
      immediateObstacles: getImmediateObstacles(),
      dangerSummary: getDangerSummary(24)
    };
    return snapshot;
  }

  return {
    getNearbyPlayers,
    getNearbyEntities,
    getNearbyHostileMobs,
    getNearbyBlocksSummary,
    getImmediateObstacles,
    getDangerSummary,
    getPerceptionSnapshot
  };
}
