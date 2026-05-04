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

    if (normalized === "ember capabilities") {
      actions.queueAction(username, { type: "REPORT_CAPABILITIES" });
      return;
    }

    if (normalized === "ember status") {
      actions.queueAction(username, { type: "REPORT_STATUS" });
      return;
    }

    if (normalized === "ember vitals") {
      actions.queueAction(username, { type: "REPORT_VITALS" });
      return;
    }

    if (normalized === "ember danger") {
      actions.queueAction(username, { type: "REPORT_DANGER" });
      return;
    }

    if (normalized === "ember threat") {
      actions.queueAction(username, { type: "REPORT_THREAT" });
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

    if (normalized === "ember movement") {
      actions.queueAction(username, { type: "REPORT_MOVEMENT" });
      return;
    }

    if (normalized === "ember target") {
      queueOwnerOnlyCommand(username, { type: "REPORT_TARGET" }, "target");
      return;
    }

    if (normalized === "ember hunger") {
      actions.queueAction(username, { type: "REPORT_HUNGER" });
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

    if (normalized === "ember task stop") {
      queueOwnerOnlyCommand(username, { type: "STOP_TASK" }, "task-stop");
      return;
    }

    if (normalized === "ember task report" || normalized === "ember task status") {
      queueOwnerOnlyCommand(username, { type: "REPORT_TASK" }, "task-report");
      return;
    }

    if (normalized === "ember task go home" || normalized === "ember task home") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "go_home" }, "task-go-home");
      return;
    }

    if (normalized === "ember task follow owner" || normalized === "ember task follow") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "follow_owner" }, "task-follow-owner");
      return;
    }

    if (normalized === "ember task eat if hungry" || normalized === "ember task eat") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "eat_if_hungry" }, "task-eat-if-hungry");
      return;
    }

    if (normalized === "ember task wander once" || normalized === "ember task wander") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "wander_yard_once" }, "task-wander-once");
      return;
    }

    if (normalized === "ember task harvest once" || normalized === "ember task harvest") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "harvest_one_target" }, "task-harvest-once");
      return;
    }

    if (normalized === "ember task mine once" || normalized === "ember task mine") {
      queueOwnerOnlyCommand(username, { type: "START_TASK", task: "mine_one_safe_target" }, "task-mine-once");
      return;
    }

    if (normalized === "ember wander stop") {
      queueOwnerOnlyCommand(username, { type: "STOP_WANDER" }, "wander-stop");
      return;
    }

    if (normalized === "ember respawn") {
      queueOwnerOnlyCommand(username, { type: "RESPAWN" }, "respawn");
      return;
    }

    if (normalized === "ember set home") {
      queueOwnerOnlyCommand(username, { type: "SET_HOME" }, "set-home");
      return;
    }

    if (normalized === "ember stay home") {
      queueOwnerOnlyCommand(username, { type: "SET_STAY_HOME" }, "stay-home");
      return;
    }

    if (normalized === "ember wander home") {
      queueOwnerOnlyCommand(username, { type: "WANDER_SAFE", center: "home" }, "wander-home");
      return;
    }

    if (normalized === "ember wander") {
      queueOwnerOnlyCommand(username, { type: "WANDER_SAFE" }, "wander");
      return;
    }

    if (normalized === "ember yard status") {
      queueOwnerOnlyCommand(username, { type: "REPORT_YARD_STATUS" }, "yard-status");
      return;
    }

    if (normalized === "ember yard check") {
      queueOwnerOnlyCommand(username, { type: "REPORT_YARD_CHECK" }, "yard-check");
      return;
    }

    if (normalized === "ember home status") {
      queueOwnerOnlyCommand(username, { type: "REPORT_HOME_STATUS" }, "home-status");
      return;
    }

    if (normalized === "ember clear home") {
      queueOwnerOnlyCommand(username, { type: "CLEAR_HOME" }, "clear-home");
      return;
    }

    if (normalized === "ember home") {
      queueOwnerOnlyCommand(username, { type: "GO_HOME" }, "home");
      return;
    }

    if (normalized === "ember recover") {
      queueOwnerOnlyCommand(username, { type: "RECOVER" }, "recover");
      return;
    }

    if (normalized === "ember inventory") {
      queueOwnerOnlyCommand(username, { type: "REPORT_INVENTORY" }, "inventory");
      return;
    }

    if (normalized === "ember equipment") {
      queueOwnerOnlyCommand(username, { type: "REPORT_EQUIPMENT" }, "equipment");
      return;
    }

    if (normalized === "ember food") {
      queueOwnerOnlyCommand(username, { type: "REPORT_FOOD" }, "food");
      return;
    }

    if (normalized === "ember eat force") {
      queueOwnerOnlyCommand(username, { type: "EAT_FOOD", force: true }, "eat-force");
      return;
    }

    if (normalized === "ember eat") {
      queueOwnerOnlyCommand(username, { type: "EAT_FOOD" }, "eat");
      return;
    }

    if (normalized === "ember equip food") {
      queueOwnerOnlyCommand(username, { type: "EQUIP_ITEM", category: "food" }, "equip-food");
      return;
    }

    if (normalized === "ember equip pickaxe") {
      queueOwnerOnlyCommand(username, { type: "EQUIP_ITEM", category: "pickaxe" }, "equip-pickaxe");
      return;
    }

    if (normalized === "ember equip shovel") {
      queueOwnerOnlyCommand(username, { type: "EQUIP_ITEM", category: "shovel" }, "equip-shovel");
      return;
    }

    if (normalized === "ember equip axe") {
      queueOwnerOnlyCommand(username, { type: "EQUIP_ITEM", category: "axe" }, "equip-axe");
      return;
    }

    if (normalized === "ember flee") {
      queueOwnerOnlyCommand(username, { type: "FLEE_DANGER" }, "flee");
      return;
    }

    if (normalized === "ember mine stop") {
      queueOwnerOnlyCommand(username, { type: "STOP_MINING" }, "mine-stop");
      return;
    }

    if (normalized === "ember mine front" || normalized === "ember mine block") {
      queueOwnerOnlyCommand(username, { type: "MINE_BLOCK", mode: "front" }, "mine-front");
      return;
    }

    if (normalized === "ember mine ore") {
      queueOwnerOnlyCommand(username, { type: "MINE_BLOCK", mode: "ore" }, "mine-ore");
      return;
    }

    if (normalized === "ember ore report") {
      queueOwnerOnlyCommand(username, { type: "REPORT_ORE_REPORT" }, "ore-report");
      return;
    }

    if (normalized === "ember harvest report") {
      queueOwnerOnlyCommand(username, { type: "REPORT_HARVEST_REPORT" }, "harvest-report");
      return;
    }

    if (normalized === "ember harvest stop") {
      queueOwnerOnlyCommand(username, { type: "STOP_HARVEST" }, "harvest-stop");
      return;
    }

    if (normalized === "ember harvest front") {
      queueOwnerOnlyCommand(username, { type: "HARVEST_BLOCK", mode: "front" }, "harvest-front");
      return;
    }

    if (normalized === "ember harvest grass") {
      queueOwnerOnlyCommand(username, { type: "HARVEST_BLOCK", mode: "grass" }, "harvest-grass");
      return;
    }

    if (normalized === "ember harvest crop") {
      queueOwnerOnlyCommand(username, { type: "HARVEST_BLOCK", mode: "crop" }, "harvest-crop");
      return;
    }

    if (normalized === "ember safety test") {
      queueOwnerOnlyCommand(username, { type: "REPORT_SAFETY_TEST" }, "safety-test");
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

    if (normalized === "ember block") {
      queueOwnerOnlyCommand(username, { type: "REPORT_BLOCK" }, "block");
      return;
    }

    if (normalized === "ember ores nearby") {
      queueOwnerOnlyCommand(username, { type: "REPORT_ORES_NEARBY" }, "ores-nearby");
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

    if (normalized === "ember shadow status") {
      queueOwnerOnlyCommand(username, { type: "REPORT_SHADOW_STATUS" }, "shadow-status");
      return;
    }

    if (normalized === "ember shadow last") {
      queueOwnerOnlyCommand(username, { type: "REPORT_SHADOW_LAST" }, "shadow-last");
      return;
    }

    if (normalized === "ember shadow test") {
      queueOwnerOnlyCommand(username, { type: "REPORT_SHADOW_TEST" }, "shadow-test");
      return;
    }

    if (normalized === "ember shadow summary") {
      queueOwnerOnlyCommand(username, { type: "REPORT_SHADOW_SUMMARY" }, "shadow-summary");
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
