import "./Configurations.js";
import ffmpegStatic from "ffmpeg-static";
process.env.FFMPEG_PATH = ffmpegStatic;
import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import fs from "fs";
import figlet from "figlet";
import pino from "pino";
import { Boom } from "@hapi/boom";
import { serialize } from "./System/whatsapp.js";
import { smsg } from "./System/Function2.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import got from "got";
import express from "express";
import qrcode from "qrcode";
import mongoose from "mongoose";
import chalk from "chalk";
import { readcommands, commands } from "./System/ReadCommands.js";
import core from "./Core.js";
import { getPluginURLs } from "./System/MongoDB/MongoDb_Core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

global.worktype = "private";
commands.prefix = global.prefa;

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

let QR_GENERATE = "invalid";
let status = "initializing";
const mongodb = global.mongodb;

global.decodeJid = (jid) => {
  if (!jid) return jid;
  if (/:\d+@/gi.test(jid)) {
    const decode = jidDecode(jid) || {};
    return (
      (decode.user && decode.server && decode.user + "@" + decode.server) || jid
    );
  }
  return jid;
};

// ✅ Safe store
const store = {
  contacts: {},
  messages: {},
  bind(ev) {
    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) store.contacts[contact.id] = contact;
    });
    ev.on("messages.upsert", ({ messages }) => {
      if (!store.messages) store.messages = {};
      const m = messages[0];
      if (!m || !m.message) return;
      const jid = m.key.remoteJid;
      if (!jid) return;
      if (!store.messages[jid]) store.messages[jid] = [];
      store.messages[jid].push(m);
    });
  },
};

async function installPlugin() {
  try {
    const plugins = await getPluginURLs();
    for (const url of plugins) {
      const name = url.split("/").pop();
      const { body } = await got(url);
      fs.writeFileSync(join(__dirname, "Plugins", name), body);
    }
  } catch (e) {
    console.log(chalk.red("[ PLUGIN ERROR ] " + e.message));
  }
}

const startAtlas = async () => {
  const { default: MongoAuth } = await import("./System/MongoAuth/MongoAuth.js");
  const mongoAuth = new MongoAuth(process.env.SESSION_ID || "atlas_session");
  const { state, saveCreds, clearState } = await mongoAuth.init();
  const { version } = await fetchLatestBaileysVersion();

  const Atlas = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    version,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    printQRInTerminal: false,
    getMessage: async (key) => {
      if (store.messages) {
        const msgs = store.messages[key.remoteJid];
        if (msgs) return msgs.find((m) => m.key.id === key.id)?.message;
      }
      return { conversation: "" };
    },
  });

  Atlas.decodeJid = global.decodeJid;
  store.bind(Atlas.ev);

  Atlas.setStatus = async (st) => {
    try { return await Atlas.updateProfileStatus(st); }
    catch { return await Atlas.sendPresenceUpdate(st); }
  };

  Atlas.sendText = async (jid, text, quoted = "", options = {}) => {
    return Atlas.sendMessage(jid, { text, ...options }, { quoted });
  };

  Atlas.ev.on("creds.update", saveCreds);
  Atlas.serializeM = (m) => smsg(Atlas, m, store);

  Atlas.ev.on("connection.update", async (update) => {
    const { lastDisconnect, connection, qr } = update;
    if (connection) status = connection;
    if (qr) {
      QR_GENERATE = qr;
      console.log(chalk.yellow("[ QR ] Scan the QR at your web URL"));
    }
    if (connection === "open") {
      console.log(chalk.green("[ STATUS ] Dante is Online ✓"));
    }
    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(chalk.red(`[ DISCONNECTED ] Code: ${statusCode}`));
      if (statusCode === DisconnectReason.loggedOut) {
        console.log(chalk.red("[ LOGGED OUT ] Clearing session..."));
        await clearState();
      }
      startAtlas();
    }
  });

  // ✅ MAIN MESSAGE HANDLER
  Atlas.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      if (chatUpdate.type !== "notify") return;

      const msg = chatUpdate.messages[0];
      if (!msg || !msg.message) return;
      if (msg.message.protocolMessage) return;

      const m = serialize(Atlas, msg);
      if (!m) return;

      const isFromMe = msg.key.fromMe === true;

      // ✅ THE KEY FIX:
      // Groups  → real sender lives in msg.key.participant
      // DMs     → real sender lives in msg.key.remoteJid
      const isGroup = msg.key.remoteJid?.endsWith("@g.us");
      const realSenderJid = isGroup
        ? (msg.key.participant || m.sender || "")
        : (msg.key.remoteJid || m.sender || "");

      const senderNumber = extractNumber(realSenderJid);
      const isOwner = OWNER_NUMBERS.includes(senderNumber);

      if (!isFromMe && !isOwner) return; // Silently ignore non-owners

      const chatType = isGroup ? "GROUP" : "DM";
      console.log(
        chalk.green(`[ EXEC ] [${chatType}] (${senderNumber}): ${m.body || "(media)"}`)
      );

      core(Atlas, m, commands, chatUpdate);

    } catch (err) {
      console.log(chalk.red("[ MSG ERROR ] " + err.message));
    }
  });
};

// ✅ Web UI
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head><title>Atlas-MD Dante</title></head>
    <body style="background:#0a0a0a;color:white;text-align:center;padding-top:80px;font-family:monospace;">
      <h1 style="color:#00ff88;letter-spacing:4px;">ATLAS-MD DANTE</h1>
      <p style="color:#888;">Private Mode — Owner Only</p>
      <div id="qr" style="margin-top:30px;"></div>
      <p id="st" style="color:#888;margin-top:20px;">Checking status...</p>
      <script>
        async function update() {
          try {
            const r = await fetch('/api/qr');
            const d = await r.json();
            const qr = document.getElementById('qr');
            const st = document.getElementById('st');
            if (d.status === 'qr') {
              qr.innerHTML = '<img src="' + d.qr + '" style="background:white;padding:12px;border-radius:8px;"/>';
              st.textContent = 'Scan the QR code with WhatsApp';
              st.style.color = '#ffcc00';
            } else if (d.status === 'connected') {
              qr.innerHTML = '<h2 style="color:#00ff88;font-size:3em;">✓ ONLINE</h2>';
              st.textContent = 'Bot is connected and running';
              st.style.color = '#00ff88';
            } else {
              st.textContent = 'Initializing... please wait';
            }
          } catch(e) {}
        }
        setInterval(update, 4000);
        update();
      </script>
    </body>
    </html>
  `);
});

app.get("/api/qr", async (req, res) => {
  if (status === "open") return res.json({ status: "connected" });
  if (QR_GENERATE === "invalid") return res.json({ status: "loading" });
  try {
    res.json({ status: "qr", qr: await qrcode.toDataURL(QR_GENERATE) });
  } catch {
    res.json({ status: "loading" });
  }
});

// ✅ Bootstrap
const bootstrap = async () => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(chalk.yellow(`[ SERVER ] Running on port ${PORT}`));
  });

  console.log(chalk.cyan(figlet.textSync("DANTE", { font: "Small" })));

  try {
    await mongoose.connect(mongodb);
    console.log(chalk.cyan("[ DB ] MongoDB Connected ✓"));

    await installPlugin();
    await readcommands();
    console.log(chalk.cyan("[ COMMANDS ] Loaded ✓"));

    await startAtlas();
  } catch (e) {
    console.error(chalk.red("[ CRITICAL ERROR ]"), e);
    process.exit(1);
  }
};

bootstrap();
