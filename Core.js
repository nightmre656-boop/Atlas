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

    // --- Body Resolution ---
    let body =
      type == "buttonsResponseMessage"
        ? m.message[type].selectedButtonId
        : type == "listResponseMessage"
          ? m.message[type].singleSelectReply.selectedRowId
          : type == "templateButtonReplyMessage"
            ? m.message[type].selectedId
            : m.text;

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

    // --- Admin & Permissions ---
    const groupAdmins = m.isGroup 
      ? participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").map((p) => p.id) 
      : [];
    const isBotAdmin = m.isGroup ? groupAdmins.includes(botIdClean) || groupAdmins.includes(botLid) : false;
    const isAdmin = m.isGroup ? groupAdmins.includes(m.sender) : false;

    // --- DANTE OWNER OVERRIDE (LID Fix) ---
    const isCreator = 
      m.sender.includes("59945378676903") || 
      m.sender.includes("2348133453645") || 
      m.key.fromMe;

    const isCmd = body?.startsWith(prefix);
    const args = body ? body.trim().split(/ +/).slice(1) : [];
    const text = args.join(" ");
    const inputCMD = body ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : "";

    const cmd = commands.get(inputCMD) || Array.from(commands.values()).find((v) => v.alias.includes(inputCMD));

    // --- Global Helpers ---
    const doReact = async (emoji) => {
      return await Atlas.sendMessage(m.from, { react: { text: emoji, key: m.key } });
    };

    // --- Character Setup (Fixes ReferenceError: botName) ---
    let CharacterSelection = "0";
    try { 
      CharacterSelection = await getChar(); 
    } catch { 
      CharacterSelection = "0"; 
    }
    const charConfig = global["charID" + CharacterSelection] || global["charID0"];
    
    global.botName = charConfig.botName || "Atlas Bot";
    global.botVideo = charConfig.botVideo;
    global.botImage1 = charConfig.botImage1;

    // --- Logger ---
    if (isCmd) {
      console.log(chalk.cyan(`[ EXEC ] ${pushname}: ${body}`));
    }

    if (!cmd) return;

    // --- Security Gate ---
    if (!isCreator) {
        const botWorkMode = await getBotMode();
        if (botWorkMode === "private" || botWorkMode === "self") return;
        if (await checkBan(m.sender)) return;
        if (await checkBanGroup(m.from)) return;
    }

    // --- Command Execution ---
    try {
      await cmd.start(Atlas, m, {
        name: global.botName,
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
        doReact, 
        isBotAdmin,
        prefix,
        db,
        command: cmd.name,
        commands,
        // Mention & Media Fixes for Reaction Plugins
        mentionByTag: m.mentionedJid || (m.message?.extendedTextMessage?.contextInfo?.mentionedJid) || [],
        mime: (quoted.msg || m.msg)?.mimetype || "",
        toUpper: (query) => query.replace(/^\w/, (c) => c.toUpperCase())
      });
    } catch (err) {
      console.error(chalk.red("[ CMD ERROR ]"), err);
    }

  } catch (e) {
    console.error(chalk.red("[ CORE ERROR ]"), e);
  }
};
