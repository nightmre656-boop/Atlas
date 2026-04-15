import "./Configurations.js";
import "./System/BotCharacters.js";
import chalk from "chalk";
import { QuickDB, JSONDriver } from "quick.db";
import { getChar, getBotMode, checkBan, checkBanGroup } from "./System/MongoDB/MongoDb_Core.js";

const OWNER_NUMBERS = ["59945378676903", "2348133453645"];
const extractNumber = (jid = "") => jid.replace(/:\d+@/, "@").replace(/@.+/, "").trim();

export default async (Atlas, m, commands, chatUpdate) => {
  try {
    const db = new QuickDB({ driver: new JSONDriver() });
    const { isGroup, sender, from, body, prefix } = m;

    if (!body || !body.startsWith(prefix)) return;

    // --- Identification ---
    const senderNumber = extractNumber(m.sender);
    const isCreator = m.fromMe || OWNER_NUMBERS.includes(senderNumber);
    const botNumber = Atlas.user.id.split(":")[0] + "@s.whatsapp.net";

    // --- Command Parsing ---
    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(" ");
    const inputCMD = body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase();
    const cmd = commands.get(inputCMD) || Array.from(commands.values()).find((v) => v.alias?.includes(inputCMD));

    if (!cmd) return;

    // --- SECURITY GATE (Public Mode Friendly) ---
    if (!isCreator) {
      const botWorkMode = await getBotMode().catch(() => "public"); // Defaults to PUBLIC
      if (botWorkMode === "private" || botWorkMode === "self") return; 
      
      // Ban Checks
      if (await checkBan(m.sender).catch(() => false)) return;
      if (isGroup && await checkBanGroup(m.from).catch(() => false)) return;
    }

    // --- Admin Detection ---
    let isAdmin = false;
    let isBotAdmin = false;
    if (isGroup) {
      const metadata = await Atlas.groupMetadata(from).catch(() => ({}));
      const participants = metadata.participants || [];
      isAdmin = participants.find(p => p.id === m.sender)?.admin !== null;
      isBotAdmin = participants.find(p => p.id === botNumber)?.admin !== null;
    }

    const doReact = (emoji) => Atlas.sendMessage(from, { react: { text: emoji, key: m.key } });

    console.log(chalk.cyan(`[ EXEC ] ${inputCMD} from ${senderNumber}`));

    // --- Execute Command ---
    await cmd.start(Atlas, m, {
      args, text, prefix, isCreator, isAdmin, isBotAdmin, db, doReact, commands
    }).catch(e => console.error(cmd.name, e));

  } catch (e) { console.error("CORE ERROR", e); }
};
