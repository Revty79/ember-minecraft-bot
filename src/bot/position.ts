import type { Bot } from "mineflayer";

export type PositionLike = {
  x: unknown;
  y: unknown;
  z: unknown;
} | null | undefined;

export function isPositionValid(position: PositionLike): position is { x: number; y: number; z: number } {
  if (!position) {
    return false;
  }

  if (typeof position.x !== "number" || typeof position.y !== "number" || typeof position.z !== "number") {
    return false;
  }

  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

export function isEntityPositionHealthy(bot: Bot): boolean {
  const position = bot.entity?.position as PositionLike;
  return isPositionValid(position);
}
