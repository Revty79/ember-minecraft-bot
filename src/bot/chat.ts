import type { Bot } from "mineflayer";
import type { AppConfig } from "../config";
import { isEntityPositionHealthy } from "./position";
import type { ChatController, Logger, StateStore } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export function createChatController(
  bot: Bot,
  config: AppConfig,
  state: StateStore,
  logger: Logger
): ChatController {
  let chatReady = false;
  let lastChatSentAt = 0;
  let lastNotReadyChatAt = 0;
  let lastNotReadyLogAt = 0;

  function setChatReady(ready: boolean): void {
    chatReady = ready;
  }

  function isChatReady(): boolean {
    return chatReady;
  }

  function send(
    message: string,
    reason: string,
    options?: { bypassRateLimit?: boolean; bypassNotReadyCooldown?: boolean }
  ): boolean {
    const trimmed = message.trim();
    if (!trimmed) {
      logger.warn("chat", `skipped (${reason}): empty message.`);
      return false;
    }

    const safeMessage =
      trimmed.length > config.maxChatLength ? trimmed.slice(0, config.maxChatLength) : trimmed;

    const notReadyState = !state.state.spawned || !state.state.ready || !isEntityPositionHealthy(bot);
    const now = Date.now();

    if (!chatReady) {
      if (now - lastNotReadyLogAt >= config.notReadyChatCooldownMs) {
        logger.log("chat", `skipped (${reason}): bot not ready to chat yet.`);
        lastNotReadyLogAt = now;
      }
      return false;
    }

    if (notReadyState) {
      if (!options?.bypassNotReadyCooldown && now - lastNotReadyChatAt < config.notReadyChatCooldownMs) {
        if (now - lastNotReadyLogAt >= config.notReadyChatCooldownMs) {
          logger.log("chat", `skipped (${reason}): not-ready cooldown active.`);
          lastNotReadyLogAt = now;
        }
        return false;
      }
      lastNotReadyChatAt = now;
    }

    const elapsed = now - lastChatSentAt;
    if (!options?.bypassRateLimit && elapsed < config.chatMinIntervalMs) {
      logger.log(
        "chat",
        `skipped (${reason}): rate-limited (${elapsed}ms < ${config.chatMinIntervalMs}ms).`
      );
      return false;
    }

    try {
      bot.chat(safeMessage);
      lastChatSentAt = now;
      state.setLastChatTimestamp(nowIso());
      logger.log("chat", `send (${reason}): ${safeMessage}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.setLastError(errorMessage);
      state.addEvent("error", "Chat send failed", {
        reason,
        error: errorMessage
      });
      logger.error("chat", `send failed (${reason}): ${errorMessage}`);
      return false;
    }
  }

  return {
    setChatReady,
    isChatReady,
    send
  };
}
