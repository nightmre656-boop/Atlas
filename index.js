import "./Configurations.js";
import ffmpegStatic from "ffmpeg-static";
process.env.FFMPEG_PATH = ffmpegStatic;
import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
} from "@whiskeysockets/baileys";
import MongoAuth from "./System/MongoAuth/MongoAuth.js";
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
import qrcodeTerminal from "qrcode-terminal";
import mongoose from "mongoose";
import chalk from "chalk";
import { readcommands, commands } from "./System/ReadCommands.js";
import core from "./Core.js";
import { getPluginURLs } from "./System/MongoDB/MongoDb_Core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;
commands.prefix = global.prefa;

let QR_GENERATE = "invalid";
let status = "initializing";
let AtlasSocket = null;

// Global LID → JID cache
global.lidToJidMap = new Map();

// Standalone decodeJid — defined once, reused everywhere
const decodeJid = (jid) => {
  if (!jid) return jid;
  if (/:\d+@/gi.test(jid)) {
    const decode = jidDecode(jid) || {};
    return (
      (decode.user && decode.server && decode.user + "@" + decode.server) || jid
    );
  }
  return jid;
};

const store = {
  contacts: {},
  messages: {},
  bind(ev) {
    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) store.contacts[contact.id] = contact;
    });
    ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.remoteJid) continue;
        const jid = msg.key.remoteJid;
        if (!store.messages[jid]) store.messages[jid] = {};
        store.messages[jid][msg.key.id] = msg;
      }
    });
  },
};

// ── Plugin installer ─────────────────────────────────────────────────────────
// Called ONCE at startup — not on every reconnect
async function installPlugin() {
  console.log(chalk.cyan(`[ ATLAS ] Checking plugins...`));
  try {
    const plugins = await getPluginURLs();
    for (const url of plugins) {
      const name = url.split("/").pop();
      const { body } = await got(url);
      fs.writeFileSync(join(__dirname, "Plugins", name), body);
    }
  } catch (e) {
    console.log(chalk.red("[ ATLAS ] Plugin install error: " + e.message));
  }
}

// ── Reconnect backoff state ──────────────────────────────────────────────────
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000; // cap at 30 seconds

function getReconnectDelay() {
  // Exponential backoff: 2s → 4s → 8s → 16s → 30s (capped)
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  return delay;
}

// ── WhatsApp socket ──────────────────────────────────────────────────────────
const startAtlas = async (mongoAuth, clearState) => {
  const { state, saveCreds } = await mongoAuth.init();
  const { version } = await fetchLatestBaileysVersion();

  const Atlas = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    version,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    printQRInTerminal: false,
    keepAliveIntervalMs: 25_000, // prevents silent disconnects
  });

  // Attach decodeJid BEFORE any event fires
  Atlas.decodeJid = decodeJid;
  AtlasSocket = Atlas;

  store.bind(Atlas.ev);
  Atlas.ev.on("creds.update", saveCreds);
  Atlas.serializeM = (m) => smsg(Atlas, m, store);

  // ── Connection events ────────────────────────────────────────────────────
  Atlas.ev.on("connection.update", async (update) => {
    const { lastDisconnect, connection, qr } = update;

    if (connection) {
      status = connection;
      console.log(chalk.cyan(`[ ATLAS ] Server Status => ${connection}`));
    }

    if (qr) {
      QR_GENERATE = qr;
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      reconnectAttempts = 0; // reset backoff on success
      console.log(chalk.green("[ ATLAS ] Connected Successfully! ✓"));
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "Unknown";
      console.log(chalk.red(`[ ATLAS ] Disconnected — Code: ${statusCode} | Reason: ${reason}`));

      // Logged out — wipe session and start fresh
      if (statusCode === DisconnectReason.loggedOut) {
        console.log(chalk.red("[ ATLAS ] Logged out. Clearing session..."));
        await clearState();
        reconnectAttempts = 0;
        startAtlas(mongoAuth, clearState);
        return;
      }

      // Fatal errors — do not auto-reconnect
      if (
        statusCode === DisconnectReason.forbidden ||
        statusCode === DisconnectReason.badSession
      ) {
        console.log(chalk.red("[ ATLAS ] Fatal disconnect. Manual intervention required."));
        return;
      }

      // Everything else — reconnect with exponential backoff
      const delay = getReconnectDelay();
      console.log(
        chalk.yellow(`[ ATLAS ] Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts})`)
      );
      setTimeout(() => startAtlas(mongoAuth, clearState), delay);
    }
  });

  // ── Incoming messages ────────────────────────────────────────────────────
  Atlas.ev.on("messages.upsert", async (chatUpdate) => {
    if (chatUpdate.type !== "notify") return;
    const msg = chatUpdate.messages[0];
    if (!msg.message) return;

    // Safety net — should never trigger but guards edge cases
    if (typeof Atlas.decodeJid !== "function") Atlas.decodeJid = decodeJid;

    const m = serialize(Atlas, msg);
    core(Atlas, m, commands, chatUpdate);
  });
};

// ── Bootstrap (runs once) ────────────────────────────────────────────────────
const bootstrap = async () => {
  // 1. Connect to MongoDB
  try {
    await mongoose.connect(mongodb);
    console.log(chalk.green(`[ ATLAS ] MongoDB connected ✓`));
  } catch (err) {
    console.error(chalk.red(`[ ERROR ] MongoDB: ${err.message}`));
    process.exit(1);
  }

  // 2. Set up MongoAuth once
  const mongoAuth = new MongoAuth(sessionId);
  const { clearState } = await mongoAuth.init();

  // 3. Print banner
  console.log(figlet.textSync("ATLAS-MD", { font: "Small" }));

  // 4. Install plugins ONCE
  await installPlugin();

  // 5. Load commands ONCE
  await readcommands();

  // 6. Start WhatsApp socket
  await startAtlas(mongoAuth, clearState);
};

bootstrap();

// ── Express API ──────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json({ status }));

app.get("/api/qr", async (req, res) => {
  if (status === "open") return res.json({ status: "connected" });
  if (QR_GENERATE === "invalid") return res.json({ status: "loading" });
  const qrDataUrl = await qrcode.toDataURL(QR_GENERATE);
  res.json({ status: "qr", qr: qrDataUrl });
});

app.listen(PORT, () =>
  console.log(chalk.yellow(`[ SERVER ] Running on port ${PORT}`))
);
