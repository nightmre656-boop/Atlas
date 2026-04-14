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

    // ── Body resolution ────────────────────────────────────────────────────
    let body =
      type === "buttonsResponseMessage"
        ? m.message[type].selectedButtonId
        : type === "listResponseMessage"
          ? m.message[type].singleSelectReply.selectedRowId
          : type === "templateButtonReplyMessage"
            ? m.message[type].selectedId
            : m.text;

    let response =
      (type === "conversation" && body?.startsWith(prefix)) ||
      ((type === "imageMessage" || type === "videoMessage") && body?.startsWith(prefix)) ||
      (type === "extendedTextMessage" && body?.startsWith(prefix)) ||
      (type === "buttonsResponseMessage" && body?.startsWith(prefix)) ||
      (type === "listResponseMessage" && body?.startsWith(prefix)) ||
      (type === "templateButtonReplyMessage" && body?.startsWith(prefix))
        ? body
        : "";

    // ── Group metadata ─────────────────────────────────────────────────────
    const metadata = m.isGroup
      ? await Atlas.groupMetadata(from).catch(() => ({}))
      : {};
    const pushname = m.pushName || "NO name";
    const participants = m.isGroup ? metadata.participants || [] : [sender];
    const quoted = m.quoted ? m.quoted : m;

    // ── JID helpers ────────────────────────────────────────────────────────
    const sanitize = (jid) => {
      if (!jid) return "";
      return jid.split("@")[0].split(":")[0] + "@" + jid.split("@")[1];
    };

    // Atlas.decodeJid is guaranteed to exist (set in index.js before any event)
    const botNumber = await Atlas.decodeJid(Atlas.user.id);
    const botIdClean = sanitize(botNumber);
    const botLid = Atlas.user?.lid ? sanitize(Atlas.user.lid) : botIdClean;

    // ── Admin / role checks ────────────────────────────────────────────────
    const groupAdmins = m.isGroup
      ? participants
          .filter((p) => p.admin === "admin" || p.admin === "superadmin")
          .map((p) => p.id)
      : [];

    const isBotAdmin = m.isGroup
      ? groupAdmins.includes(botIdClean) ||
        groupAdmins.includes(botLid) ||
        groupAdmins.some((admin) => sanitize(admin) === botIdClean)
      : false;

    const isAdmin = m.isGroup
      ? groupAdmins.includes(m.sender) ||
        groupAdmins.includes(sanitize(m.sender))
      : false;

    // ── LID → phone resolution (Baileys v7) ───────────────────────────────
    let resolvedSender = m.sender;
    if (m.sender.endsWith("@lid")) {
      const cached = global.lidToJidMap?.get(sanitize(m.sender));
      if (cached && cached.endsWith("@s.whatsapp.net")) {
        resolvedSender = cached;
      } else if (m.key?.participantAlt?.endsWith("@s.whatsapp.net")) {
        resolvedSender = sanitize(m.key.participantAlt);
      } else if (m.isGroup) {
        const pMatch = participants.find(
          (p) => sanitize(p.id) === sanitize(m.sender) && p.phoneNumber
        );
        if (pMatch) resolvedSender = sanitize(pMatch.phoneNumber);
      }
      if (resolvedSender === m.sender && sanitize(m.sender) === botLid) {
        resolvedSender = botIdClean;
      }
      if (resolvedSender !== m.sender) {
        global.lidToJidMap.set(sanitize(m.sender), resolvedSender);
      }
    }

    const ownerDigits = new Set(
      [botIdClean, ...global.owner].map((v) => v.replace(/[^0-9]/g, ""))
    );
    const isCreator =
      ownerDigits.has(resolvedSender.replace(/[^0-9]/g, "")) ||
      ownerDigits.has(m.sender.replace(/[^0-9]/g, ""));

    const messSender = m.sender;
    const itsMe = m.sender.includes(botIdClean.split("@")[0]);
    const groupAdmin = groupAdmins;

    // ── Command parsing ────────────────────────────────────────────────────
    const isCmd = body.startsWith(prefix);
    const mime = (quoted.msg || m.msg).mimetype || " ";
    const isMedia = /image|video|sticker|audio/.test(mime);
    const budy = typeof m.text === "string" ? m.text : "";
    const args = body.trim().split(/ +/).slice(1);
    const ar = args.map((v) => v.toLowerCase());
    const text = args.join(" ");
    global.suppL = "https://cutt.ly/AtlasBotSupport";
    const inputCMD = body.slice(1).trim().split(/ +/).shift().toLowerCase();
    const groupName = m.isGroup ? metadata.subject : "";

    // Hardcoded integrated numbers (obfuscated in original — preserved as-is)
    var _0x8a6e = [
      "\x39\x31\x38\x31\x30\x31\x31\x38\x37\x38\x33\x35\x40\x73\x2E\x77\x68\x61\x74\x73\x61\x70\x70\x2E\x6E\x65\x74",
      "\x39\x32\x33\x30\x34\x35\x32\x30\x34\x34\x31\x34\x40\x73\x2E\x77\x68\x61\x74\x73\x61\x70\x70\x2E\x6E\x65\x74",
      "\x69\x6E\x63\x6C\x75\x64\x65\x73",
    ];
    function isintegrated() {
      const _0xdb4ex2 = [_0x8a6e[0], _0x8a6e[1]];
      return _0xdb4ex2[_0x8a6e[2]](messSender);
    }

    // ── React helper ───────────────────────────────────────────────────────
    async function doReact(emoji) {
      await Atlas.sendMessage(m.from, { react: { text: emoji, key: m.key } });
    }

    // ── Command lookup ─────────────────────────────────────────────────────
    const cmdName = response
      .slice(prefix.length)
      .trim()
      .split(/ +/)
      .shift()
      .toLowerCase();

    const cmd =
      commands.get(cmdName) ||
      Array.from(commands.values()).find((v) =>
        v.alias.find((x) => x.toLowerCase() === cmdName)
      ) ||
      "";

    const icmd =
      commands.get(cmdName) ||
      Array.from(commands.values()).find((v) =>
        v.alias.find((x) => x.toLowerCase() === cmdName)
      );

    const mentionByTag =
      type === "extendedTextMessage" &&
      m.message.extendedTextMessage.contextInfo != null
        ? m.message.extendedTextMessage.contextInfo.mentionedJid
        : [];

    // ── Logging ────────────────────────────────────────────────────────────
    const timeNow = new Date().toLocaleTimeString();
    const dateNow = new Date().toLocaleDateString();
    const timePrefix = chalk.black(chalk.bgCyan(`[ ${dateNow} - ${timeNow} ]`));

    const displayJid = (jid) => {
      if (!jid) return "unknown";
      const [local, domain] = jid.split("@");
      if (domain === "lid") return `LID:${local}`;
      return "+" + local.split(":")[0];
    };

    if (m.message && isGroup) {
      console.log(
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ GROUP ]")) + " " +
        chalk.black(chalk.bgBlueBright(isGroup ? metadata.subject : m.pushName)) + "\n" +
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ SENDER ]")) + " " +
        chalk.black(chalk.bgBlueBright(m.pushName)) + "\n" +
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ MESSAGE ]")) + " " +
        chalk.black(chalk.bgBlueBright(body || type))
      );
    }
    if (m.message && !isGroup) {
      console.log(
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ PRIVATE ]")) + " " +
        chalk.black(chalk.bgRedBright(displayJid(m.from))) + "\n" +
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ SENDER ]")) + " " +
        chalk.black(chalk.bgRedBright(m.pushName)) + "\n" +
        `${timePrefix} ` + chalk.black(chalk.bgWhite("[ MESSAGE ]")) + " " +
        chalk.black(chalk.bgRedBright(body || type))
      );
    }

    // ── System configuration ───────────────────────────────────────────────
    const isbannedUser    = await checkBan(m.sender);
    const modcheck        = await checkMod(m.sender);
    const isBannedGroup   = await checkBanGroup(m.from);
    const isAntilinkOn    = await checkAntilink(m.from);
    const isPmChatbotOn   = await checkPmChatbot();
    const isGroupChatbotOn= await checkGroupChatbot(m.from);
    const botWorkMode     = await getBotMode();

    // Work-mode gating
    if (isCmd || icmd) {
      if (botWorkMode === "private" && !isCreator && !modcheck) {
        return console.log(
          `${timePrefix} ` + chalk.black(chalk.bgYellow("[ REJECTED ]")) + " " +
          chalk.black(chalk.bgYellow(`Private mode — ${m.pushName} (${body})`))
        );
      }
      if (botWorkMode === "self" && m.sender !== botNumber) {
        return console.log(
          `${timePrefix} ` + chalk.black(chalk.bgYellow("[ REJECTED ]")) + " " +
          chalk.black(chalk.bgYellow(`Self mode — ${m.pushName} (${body})`))
        );
      }
    }

    const infoCommands = ["mods", "modlist", "owner", "owners", "support", "supportgc"];

    // Banned user gate
    if ((isCmd || icmd) && isbannedUser && !isCreator && !modcheck) return;

    // Banned group gate
    if (
      (isCmd || icmd) &&
      isBannedGroup &&
      budy !== `${prefix}unbangc` &&
      budy !== `${prefix}unbangroup` &&
      !isCreator && !modcheck && !infoCommands.includes(inputCMD)
    ) return;

    // Empty prefix
    if (body === prefix) {
      await doReact("❌");
      return m.reply(`Bot is active, type *${prefix}help* to see the list of commands.`);
    }

    // Unknown command
    if (body.startsWith(prefix) && !icmd) {
      await doReact("❌");
      return m.reply(
        `*${budy.replace(prefix, "")}* - Command not found or plug-in not installed !\n\n` +
        `If you want to see the list of commands, type:    *_${prefix}help_*\n\n` +
        `Or type:  *_${prefix}pluginlist_* to see installable plug-in list.`
      );
    }

    // ── Antilink ───────────────────────────────────────────────────────────
    if (isAntilinkOn && m.isGroup && !isAdmin && !isCreator && !modcheck && !isintegrated() && isBotAdmin) {
      const urlRegex = /https?:\/\/[^\s]+/gi;
      const detectedUrls = budy.match(urlRegex);
      if (detectedUrls && detectedUrls.length > 0) {
        let isOwnLink = false;
        try {
          const linkgce = await Atlas.groupInviteCode(from);
          isOwnLink = detectedUrls.every((u) => u.includes(`chat.whatsapp.com/${linkgce}`));
        } catch {}

        if (!isOwnLink) {
          if (!global.botDeletedMsgIds) global.botDeletedMsgIds = new Set();
          global.botDeletedMsgIds.add(m.id);
          setTimeout(() => global.botDeletedMsgIds?.delete(m.id), 300_000);

          await Atlas.sendMessage(from, {
            delete: { remoteJid: m.from, fromMe: false, id: m.id, participant: m.sender },
          });

          const bvl =
            `\`\`\`「  Antilink System  」\`\`\`\n\n` +
            `*⚠️ Link detected !*\n\n` +
            `*🚫 @${m.sender.split("@")[0]}, you are not allowed to send links in this group !*\n`;
          await Atlas.sendMessage(from, { text: bvl, mentions: [m.sender] }, { quoted: m });
        }
      }
    }

    // ── Gemini AI helper ───────────────────────────────────────────────────
    const fetchGeminiReply = async (promptText) => {
      const fetchFallback = async (text) => {
        try {
          const url = `https://api-faa.my.id/faa/gemini-ai?text=${encodeURIComponent(text)}`;
          const res = await axios.get(url);
          if (res.data && res.data.status) return res.data.result;
        } catch (e) {
          console.error("Fallback API failed:", e.message);
        }
        return null;
      };

      const geminiKey = global.pickKey(global.geminiAPIKeys);
      let responseText = null;

      if (geminiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          const result = await ai.models.generateContent({
            model: GEMINI_MODEL,
            config: getGeminiConfig(),
            contents: [{ role: "user", parts: [{ text: promptText }] }],
          });
          responseText = result.text;
        } catch (err) {
          console.log("Gemini API rejected, falling back...\nError:", err.message || err);
          responseText = await fetchFallback(promptText);
        }
      } else {
        console.log("No valid Gemini key, using fallback API.");
        responseText = await fetchFallback(promptText);
      }

      return responseText ? responseText.trim() : "Service unavailable at the moment.";
    };

    // ── Group chatbot ──────────────────────────────────────────────────────
    if (m.isGroup && !isCmd && !icmd) {
      let txtSender = m.quoted ? m.quoted.sender : mentionByTag[0];
      const senderClean = sanitize(txtSender);
      const isBotMentioned =
        txtSender &&
        (senderClean === botIdClean || senderClean === botLid || txtSender === botNumber);

      if (isGroupChatbotOn === true && isBotMentioned) {
        try {
          await Atlas.sendPresenceUpdate("composing", m.from);
          const txtChatbot = await fetchGeminiReply(budy);
          m.reply(txtChatbot);
          await Atlas.sendPresenceUpdate("paused", m.from);
        } catch (e) {
          console.error("[ ATLAS ] Group chatbot error:", e.message);
        }
      }
    }

    // ── PM chatbot ─────────────────────────────────────────────────────────
    if (!m.isGroup && !isCmd && !icmd) {
      if (isPmChatbotOn === true) {
        try {
          await Atlas.sendPresenceUpdate("composing", m.from);
          const txtChatbot = await fetchGeminiReply(budy);
          m.reply(txtChatbot);
          await Atlas.sendPresenceUpdate("paused", m.from);
        } catch (e) {
          console.error("[ ATLAS ] PM chatbot error:", e.message);
        }
      }
    }

    // ── Character configuration ────────────────────────────────────────────
    const char = "0";
    let CharacterSelection = "0";
    try {
      CharacterSelection = await getChar();
    } catch {
      CharacterSelection = "0";
    }
    if (CharacterSelection === char) CharacterSelection = "0";

    const idConfig = "charID" + CharacterSelection;
    const charConfig = global[idConfig] || global["charID0"];

    global.botName   = charConfig.botName;
    global.botVideo  = charConfig.botVideo;
    global.botImage1 = charConfig.botImage1;
    global.botImage2 = charConfig.botImage2;
    global.botImage3 = charConfig.botImage3;
    global.botImage4 = charConfig.botImage4;
    global.botImage5 = charConfig.botImage5;
    global.botImage6 = charConfig.botImage6;

    // ── Uptime status ──────────────────────────────────────────────────────
    const pad = (s) => (s < 10 ? "0" : "") + s;
    const formatTime = (seconds) => {
      const h = Math.floor(seconds / 3600);
      const min = Math.floor((seconds % 3600) / 60);
      const sec = Math.floor(seconds % 60);
      return `${pad(h)}:${pad(min)}:${pad(sec)}`;
    };
    const uptime = () => formatTime(process.uptime());
    Atlas.setStatus(`〘  ${global.botName} Personal Edition  〙    ⚡ Uptime: ${uptime()}`);

    // ── Execute command ────────────────────────────────────────────────────
    cmd.start(Atlas, m, {
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
      isMedia,
      ar,
      isAdmin,
      groupAdmin,
      text,
      itsMe,
      doReact,
      modcheck,
      isCreator,
      quoted,
      isintegrated,
      groupName,
      mentionByTag,
      mime,
      isBotAdmin,
      prefix,
      db,
      command: cmd.name,
      commands,
      toUpper: (query) => query.replace(/^\w/, (c) => c.toUpperCase()),
    });
  } catch (e) {
    e = String(e);
    if (!e.includes("cmd.start")) console.error(e);
  }
};
