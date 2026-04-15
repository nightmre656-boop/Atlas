import dotenv from "dotenv";
dotenv.config({ override: true });

const stripEnv = (val, fallback = "") => {
  if (!val) return fallback;
  return val.split("#")[0].trim() || fallback;
};

const parseKeys = (envVal, ...placeholders) => {
  if (!envVal) return [];
  return envVal
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && !placeholders.includes(k));
};

global.pickKey = (keys) => {
  if (!keys || keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
};

// --- OWNER & PERMISSIONS ---
// Use MONGODB_URI to match Railway best practices
global.mongodb = process.env.MONGODB_URI || process.env.MONGODB || "mongodb://localhost:27017/atlas";
let mods = process.env.MODS ? process.env.MODS.split(",") : ["918101187835"]; 
global.owner = mods; 

// --- BOT MODES ---
// We set this to 'public' so it works in groups. 
// The bot's core.js usually handles the permission check for 'private' vs 'public'.
global.worktype = stripEnv(process.env.WORK_TYPE, "public"); 

global.sessionId = stripEnv(process.env.SESSION_ID, "ok");
global.prefa = stripEnv(process.env.PREFIX, ".");
global.packname = stripEnv(process.env.PACKNAME, "Atlas Bot");
global.author = stripEnv(process.env.AUTHOR, "by: Team Atlas");
global.port = stripEnv(process.env.PORT, "8080");

// API Pools
global.geminiAPIKeys = parseKeys(process.env.GEMINI_API, "Put your gemini API key here");
global.openAiAPIKeys = parseKeys(process.env.OPENAI_API, "Put your openai API key here");
global.claudeAPIKeys = parseKeys(process.env.CLAUDE_API, "Put your claude API key here");
global.tenorAPIKeys = parseKeys(process.env.TENOR_API_KEY || "AIzaSyCyouca1_KKy4W_MG1xsPzuku5oa8W358c");

Object.defineProperty(global, "tenorApiKey", {
  get() {
    return global.pickKey(global.tenorAPIKeys) || "AIzaSyCyouca1_KKy4W_MG1xsPzuku5oa8W358c";
  },
  configurable: true,
});

export default {
  mongodb: global.mongodb,
  worktype: global.worktype
};
