import fs from "node:fs";
import path from "node:path";
import type { HomeRecord, Logger } from "./types";

function isValidHomeRecord(value: unknown): value is HomeRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<HomeRecord>;
  return (
    typeof record.x === "number" &&
    Number.isFinite(record.x) &&
    typeof record.y === "number" &&
    Number.isFinite(record.y) &&
    typeof record.z === "number" &&
    Number.isFinite(record.z) &&
    (record.dimension === null || typeof record.dimension === "string") &&
    (record.world === null || typeof record.world === "string") &&
    typeof record.timestamp === "string" &&
    typeof record.setBy === "string"
  );
}

export function loadHomeRecord(homeFilePath: string, logger: Logger): HomeRecord | null {
  try {
    if (!fs.existsSync(homeFilePath)) {
      return null;
    }

    const raw = fs.readFileSync(homeFilePath, "utf8").trim();
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isValidHomeRecord(parsed)) {
      logger.warn("state", `Home file exists but is invalid: ${homeFilePath}`);
      return null;
    }

    return parsed;
  } catch (error) {
    logger.error("state", `Failed to load home file: ${homeFilePath}`, {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export function saveHomeRecord(homeFilePath: string, record: HomeRecord, logger: Logger): boolean {
  try {
    const directory = path.dirname(homeFilePath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(homeFilePath, JSON.stringify(record, null, 2), "utf8");
    return true;
  } catch (error) {
    logger.error("state", `Failed to save home file: ${homeFilePath}`, {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export function clearHomeRecord(homeFilePath: string, logger: Logger): boolean {
  try {
    if (fs.existsSync(homeFilePath)) {
      fs.unlinkSync(homeFilePath);
    }
    return true;
  } catch (error) {
    logger.error("state", `Failed to clear home file: ${homeFilePath}`, {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
