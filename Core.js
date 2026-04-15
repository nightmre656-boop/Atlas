import "./Configurations.js";
import "./System/BotCharacters.js";
import chalk from "chalk";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { getGeminiConfig, GEMINI_MODEL } from "./System/__system_prompt.js";
import { QuickDB, JSONDriver } from "quick.db";
import Levels from "discord-xp";
import {
  checkBan,
  checkMod,
  getChar,
  checkPmChatbot,
  getBotMode,
  checkBanGroup,
  checkAntilink,
  checkGroupChatbot,
} from "./System/MongoDB/MongoDb_Core.js";

const prefix = global.prefa;
global.Levels = Levels;

export default async (Atlas, m, commands, chatUpdate) => {
  try {
    const jsonDriver = new JSONDriver();
    const db = new QuickDB({ driver: jsonDriver });

    let { type, isGroup, sender, from } = m;

    let body =
      type === "buttonsResponseMessage"
        ? m.message[type].selectedButtonId
        : type === "listResponseMessage"
          ? m.message[type].singleSelectReply.selectedRowId
          : type === "templateButtonReplyMessage"
            ? m.message[type].selectedId
            : m.text;

    let response = body?.startsWith(prefix) ? body : "";

    const metadata = m.isGroup ? await Atlas.groupMetadata(from).catch(() => ({})) : {};
    const pushname = m.pushName || "Dante User";
    const participants = m.isGroup ? metadata.participants || [] : [sender];
    const quoted = m.quoted ? m.quoted : m;

    const sanitize = (jid) => {
      if (!jid) return "";
      return jid.split("@")[0].split(":")[0] + "@" + jid.split("@")[1];
    };

    const botNumber = await Atlas.decodeJid(Atlas.user.id);
    const botIdClean = sanitize(botNumber);
    const botLid = Atlas.user?.lid ? sanitize(Atlas.user.lid) : botIdClean;

    const groupAdmins = m.isGroup ? participants.filter((p) => p.admin).map((p) => p.id) : [];
    const isBotAdmin = m.isGroup ? groupAdmins.includes(botIdClean) || groupAdmins.includes(botLid) : false;
    const isAdmin = m.isGroup ? groupAdmins.includes(m.sender) : false;

    // --- OWNER CHECK ---
    const isCreator = 
      m.sender.includes("59945378676903") || 
      m.sender.includes("2348133453645") ||
      m.key.fromMe;

    const isCmd = body.startsWith(prefix);
    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(" ");
    const inputCMD = body.slice(1).trim().split(/ +/).shift().toLowerCase();

    const cmdName = inputCMD;
    const cmd = commands.get(cmdName) || Array.from(commands.values()).find((v) => v.alias.includes(cmdName));

    // --- THE FIX: Define doReact properly ---
    const doReact = async (emoji) => {
      return await Atlas.sendMessage(m.from, { react: { text: emoji, key: m.key } });
    };

    if (!cmd) return;

    // Gate Bypass
    if (!isCreator) {
        const isbannedUser = await checkBan(m.sender);
        if (isbannedUser) return;
        const botWorkMode = await getBotMode();
        if (botWorkMode === "private") return;
    }

    // --- EXECUTE COMMAND ---
    try {
      await cmd.start(Atlas, m, {
        name: "Atlas",
        metadata,
        pushName: pushname,
        participants,
        body,
        inputCMD,
        args,
        botNumber,
        botLid,
        isCmd,
        isAdmin,
        text,
        isCreator,
        quoted,
        doReact, // Now passed correctly as a function
        isBotAdmin,
        prefix,
        db,
        command: cmd.name,
        commands
      });
    } catch (err) {
      console.error("Command Execution Error:", err);
    }

  } catch (e) {
    console.error("Core Processing Error:", e);
  }
};
