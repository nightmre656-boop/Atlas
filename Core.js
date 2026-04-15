import "./Configurations.js";
import chalk from "chalk";
import { getBotMode, checkBan, checkBanGroup } from "./System/MongoDB/MongoDb_Core.js";

const OWNER_NUMBERS = ["59945378676903", "2348133453645"];

export default async (Atlas, m, commands, chatUpdate) => {
  try {
    const { isGroup, from, body, prefix } = m;
    if (!body || !body.startsWith(prefix)) return;

    const senderNumber = m.sender.split("@")[0];
    const isCreator = m.fromMe || OWNER_NUMBERS.includes(senderNumber);

    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(" ");
    const inputCMD = body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase();
    const cmd = commands.get(inputCMD) || Array.from(commands.values()).find((v) => v.alias?.includes(inputCMD));

    if (!cmd) return;

    // --- Public Security Gate ---
    if (!isCreator) {
      const mode = await getBotMode().catch(() => "public");
      if (mode === "private" || mode === "self") return;
      if (await checkBan(m.sender).catch(() => false)) return;
      if (isGroup && await checkBanGroup(from).catch(() => false)) return;
    }

    // --- Admin Detection ---
    let isAdmin = false, isBotAdmin = false;
    if (isGroup) {
      const metadata = await Atlas.groupMetadata(from).catch(() => ({}));
      const participants = metadata.participants || [];
      const botId = Atlas.user.id.split(":")[0] + "@s.whatsapp.net";
      isAdmin = participants.find(p => p.id === m.sender)?.admin !== null;
      isBotAdmin = participants.find(p => p.id === botId)?.admin !== null;
    }

    const doReact = (emoji) => Atlas.sendMessage(from, { react: { text: emoji, key: m.key } });

    console.log(chalk.cyan(`[ EXEC ] ${inputCMD.toUpperCase()} | ${senderNumber}`));

    // Execute Command
    await cmd.start(Atlas, m, {
      args, text, prefix, isCreator, isAdmin, isBotAdmin, doReact, commands,
      pushName: m.pushName || "User"
    }).catch(e => console.error(chalk.red(`[ CMD ERR ] ${cmd.name}:`), e.message));

  } catch (e) { console.error(chalk.red("[ CORE ERR ]"), e.message); }
};
