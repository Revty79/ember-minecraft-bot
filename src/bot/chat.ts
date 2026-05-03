import type { Bot } from "mineflayer";
import type { AppConfig } from "../config";
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

  function setChatReady(ready: boolean): void {
    chatReady = ready;
  }

  function isChatReady(): boolean {
    return chatReady;
  }

  function send(message: string, reason: string, options?: { bypassRateLimit?: boolean }): boolean {
    const trimmed = message.trim();
    if (!trimmed) {
      logger.warn("chat", `skipped (${reason}): empty message.`);
      return false;
    }

    const safeMessage =
      trimmed.length > config.maxChatLength ? trimmed.slice(0, config.maxChatLength) : trimmed;

    if (!chatReady) {
      logger.log("chat", `skipped (${reason}): bot not ready to chat yet.`);
      return false;
    }

    if (!state.state.spawned || !state.state.ready) {
      logger.log("chat", `skipped (${reason}): bot not fully spawned/ready.`);
      return false;
    }

    const now = Date.now();
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
