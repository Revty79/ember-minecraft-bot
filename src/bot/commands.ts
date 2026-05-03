import type { AppConfig } from "../config";
import type { ActionController, ChatController, CommandInput, CommandRouter, Logger, SafetyLayer, StateStore } from "./types";

export function createCommandRouter(
  config: AppConfig,
  state: StateStore,
  chat: ChatController,
  actions: ActionController,
  safety: SafetyLayer,
  logger: Logger
): CommandRouter {
  function queueOwnerOnlyCommand(
    username: string,
    action: Parameters<ActionController["queueAction"]>[1],
    commandName: string
  ): void {
    if (!safety.isOwner(username)) {
      chat.send(`Only ${config.ownerUsername} can use that command.`, `${commandName}-denied`);
      return;
    }

    actions.queueAction(username, action);
  }

  function routeChatMessage(input: CommandInput): void {
    const username = input.username;
    const rawMessage = input.message.trim();
    const normalized = rawMessage.toLowerCase();

    if (!normalized.startsWith("ember")) {
      return;
    }

    state.setLastCommandReceived(`${username}: ${rawMessage}`);
    state.addEvent("chat_command", "Chat command received", {
      username,
      message: rawMessage
    });

    logger.log("command", `received from=${username} command=${rawMessage}`);

    if (normalized === "ember hello") {
      actions.queueAction(username, { type: "CHAT", message: "Hello. I'm here.", reason: "hello" });
      return;
    }

    if (normalized === "ember help") {
      actions.queueAction(username, { type: "REPORT_HELP" });
      return;
    }

    if (normalized === "ember status") {
      actions.queueAction(username, { type: "REPORT_STATUS" });
      return;
    }

    if (normalized === "ember where are you") {
      actions.queueAction(username, { type: "REPORT_WHERE_ARE_YOU" });
      return;
    }

    if (normalized === "ember nearby") {
      actions.queueAction(username, { type: "REPORT_NEARBY" });
      return;
    }

    if (normalized === "ember look") {
      actions.queueAction(username, { type: "REPORT_LOOK" });
      return;
    }

    if (normalized === "ember come") {
      queueOwnerOnlyCommand(username, { type: "COME_TO_OWNER" }, "come");
      return;
    }

    if (normalized === "ember follow me") {
      queueOwnerOnlyCommand(username, { type: "FOLLOW_OWNER" }, "follow");
      return;
    }

    if (normalized === "ember stop") {
      queueOwnerOnlyCommand(username, { type: "STOP_MOVING" }, "stop");
      return;
    }

    if (normalized === "ember respawn") {
      queueOwnerOnlyCommand(username, { type: "RESPAWN" }, "respawn");
      return;
    }

    if (normalized === "ember distance") {
      queueOwnerOnlyCommand(username, { type: "REPORT_DISTANCE" }, "distance");
      return;
    }

    if (normalized === "ember obstacle") {
      queueOwnerOnlyCommand(username, { type: "REPORT_OBSTACLE" }, "obstacle");
      return;
    }

    if (normalized === "ember state") {
      queueOwnerOnlyCommand(username, { type: "REPORT_STATE" }, "state");
      return;
    }

    if (normalized === "ember debug") {
      queueOwnerOnlyCommand(username, { type: "REPORT_DEBUG" }, "debug");
      return;
    }

    if (normalized === "ember ai status") {
      queueOwnerOnlyCommand(username, { type: "REPORT_AI_STATUS" }, "ai-status");
      return;
    }

    if (normalized === "ember action queue") {
      queueOwnerOnlyCommand(username, { type: "REPORT_ACTION_QUEUE" }, "action-queue");
      return;
    }

    chat.send("Unknown Ember command. Try: Ember help", "unknown-command");
  }

  return {
    routeChatMessage
  };
}
