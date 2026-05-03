import fs from "node:fs";
import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import type { AppConfig } from "../config";
import type { Logger } from "./types";

export function createMineflayerBot(config: AppConfig, logger: Logger): Bot {
  fs.mkdirSync(config.profilesFolder, { recursive: true });

  const bot = mineflayer.createBot({
    host: config.minecraftHost,
    port: config.minecraftPort,
    username: config.minecraftUsername,
    ...(config.minecraftVersion ? { version: config.minecraftVersion } : {}),
    auth: config.minecraftAuth,
    profilesFolder: config.profilesFolder,
    respawn: false,
    onMsaCode: (info: { user_code: string; verification_uri: string; expires_in?: number }) => {
      const expiresPart = info.expires_in ? ` (expires in ${info.expires_in}s)` : "";
      logger.log(
        "connect",
        `Use code "${info.user_code}" at ${info.verification_uri}${expiresPart} to authenticate.`
      );
    }
  });

  bot.loadPlugin(pathfinder);
  return bot;
}
