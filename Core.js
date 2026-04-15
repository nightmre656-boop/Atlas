import "./Configurations.js";
import "./System/BotCharacters.js";
import chalk from "chalk";
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

// ✅ Owner numbers
const OWNER_NUMBERS = ["59945378676903", "2348133453645"];

/**
 * ✅ Extract plain number from any JID format
 * Works for both DM and GROUP senders
 * "2348133453645:3@s.whatsapp.net" → "2348133453645"
 * "2348133453645@s.whatsapp.net"   → "2348133453645"
 */
const extractNumber = (jid = "") => {
  return jid.replace(/:\d+@/, "@").replace(/@.+/, "").trim();
};

const sanitize = (jid) => {
  if (!jid) return "";
  const [user, server] = jid.split("@");
  return `${user.split(":")[0]}@${server}`;
};

export default async (Atlas, m, commands, chatUpdate) => {
  try {
    const jsonDriver = new JSONDriver();
    const db = new QuickDB({ driver: jsonDriver });

    const { type, isGroup, sender, from } = m;

    // --- Body Resolution ---
    let body =
      type === "buttonsResponseMessage"
        ? m.message?.[type]?.selectedButtonId
        : type === "listResponseMessage"
          ? m.message?.[type]?.singleSelectReply?.selectedRowId
          : type === "templateButtonReplyMessage"
            ? m.message?.[type]?.selectedId
            : m.text;

    if (!body && m.message?.conversation) body = m.message.conversation;
    if (!body && m.message?.extendedTextMessage?.text) body = m.message.extendedTextMessage.text;

    // --- Group Metadata ---
    const metadata = m.isGroup
      ? await Atlas.groupMetadata(from).catch(() => ({}))
      : {};

    const pushname = m.pushName || "User";
    const participants = m.isGroup ? metadata.participants || [] : [];
    const quoted = m.quoted ? m.quoted : m;

    // --- Bot Identity ---
    const botNumber = await Atlas.decodeJid(Atlas.user.id);
    const botIdClean = sanitize(botNumber);
    const botLid = Atlas.user?.lid ? sanitize(Atlas.user.lid) : botIdClean;

    // --- Admin Detection ---
    const groupAdmins = m.isGroup
      ? participants
          .filter((p) => p.admin === "admin" || p.admin === "superadmin")
          .map((p) => p.id)
      : [];
    const isBotAdmin = m.isGroup
      ? groupAdmins.includes(botIdClean) || groupAdmins.includes(botLid)
      : false;
    const isAdmin = m.isGroup ? groupAdmins.includes(m.sender) : false;

    // ✅ OWNER CHECK — uses key.participant for groups, remoteJid for DMs
    const isGroup2 = m.key?.remoteJid?.endsWith("@g.us");
    const realSenderJid = isGroup2
      ? (m.key?.participant || m.sender || "")
      : (m.key?.remoteJid || m.sender || "");

    const senderNumber = extractNumber(realSenderJid);
    const isCreator =
      m.key?.fromMe === true ||
      OWNER_NUMBERS.includes(senderNumber);

    // --- Command Parsing ---
    const isCmd = body?.startsWith(prefix);
    if (!isCmd) return;

    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(" ");
    const inputCMD = body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase();

    const cmd =
      commands.get(inputCMD) ||
      Array.from(commands.values()).find((v) => v.alias?.includes(inputCMD));

    if (!cmd) return;

    // --- Logger ---
    const chatType = m.isGroup ? "GROUP" : "DM";
    console.log(chalk.cyan(`[ CMD ] [${chatType}] ${pushname} (${senderNumber}): ${body}`));

    // --- Helpers ---
    const doReact = async (emoji) => {
      return Atlas.sendMessage(m.from, {
        react: { text: emoji, key: m.key },
      }).catch(() => null);
    };

    // --- Character / Bot Identity Setup ---
    let CharacterSelection = "0";
    try { CharacterSelection = await getChar(); }
    catch { CharacterSelection = "0"; }

    const charConfig = global["charID" + CharacterSelection] || global["charID0"] || {};
    global.botName = charConfig.botName || "Atlas Bot";
    global.botVideo = charConfig.botVideo || null;
    global.botImage1 = charConfig.botImage1 || null;

    // --- Security Gate ---
    if (!isCreator) {
      const botWorkMode = await getBotMode().catch(() => "private");
      if (botWorkMode === "private" || botWorkMode === "self") return;
      if (await checkBan(m.sender).catch(() => false)) return;
      if (m.isGroup && await checkBanGroup(m.from).catch(() => false)) return;
    }

    // --- Command Execution ---
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
      mentionByTag:
        m.mentionedJid ||
        m.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
        [],
      mime: (quoted.msg || m.msg)?.mimetype || "",
      toUpper: (query) => query.replace(/^\w/, (c) => c.toUpperCase()),
    }).catch((err) => {
      console.error(chalk.red(`[ CMD ERROR ] ${cmd.name}:`), err.message);
    });

  } catch (e) {
    console.error(chalk.red("[ CORE ERROR ]"), e.message);
  }
};
