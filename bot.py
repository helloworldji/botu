import asyncio
import logging
import os
import aiohttp
from aiohttp import web
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode, ChatAction

# High-speed event loop setup for Linux/Render
try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
except ImportError:
    pass

# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------
# Token is stripped of any accidental whitespace
API_TOKEN = '8377073485:AAG5syeWrjdYS71Nc4VoqZQnwBkum3tMwto'.strip() 

ADMIN_ID = 8175884349

# ---------------------------------------------------------
# SETUP
# ---------------------------------------------------------
logging.basicConfig(level=logging.INFO)

# Initialize Bot with HTML parsing
bot = Bot(
    token=API_TOKEN, 
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
dp = Dispatcher()
user_ids = set()

# ---------------------------------------------------------
# WEB SERVER FOR RENDER UPTIME
# ---------------------------------------------------------
async def health_check(request):
    """
    Simple route for Uptime Robot to ping.
    """
    return web.Response(text="Bot is ALIVE and Running!", status=200)

async def start_web_server():
    """
    Starts a background web server to satisfy Render's port requirement.
    """
    app = web.Application()
    app.router.add_get('/', health_check)
    runner = web.AppRunner(app)
    await runner.setup()
    
    # Render provides the PORT environment variable
    port = int(os.environ.get("PORT", 8080))
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    logging.info(f"✅ Web Server started on port {port}")

# ---------------------------------------------------------
# UI HELPER FUNCTIONS
# ---------------------------------------------------------
def get_main_menu():
    """Start screen buttons"""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔍 Search Number", callback_data="start_search")],
        [InlineKeyboardButton(text="📞 Support", url="https://t.me/aadi_io")]
    ])

def get_result_keyboard():
    """Buttons attached to search results"""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🗑️ Close Result", callback_data="delete_msg")]
    ])

def clean_data(value):
    """Helper to clean None/Null values"""
    if value is None or value == "null" or value == "":
        return "N/A"
    return str(value).replace('!', ' ').strip()

def format_response_ui(data_list):
    """
    Formats the JSON into a beautiful 'Tree-Style' UI
    """
    if not data_list or not isinstance(data_list, list):
        return "❌ <b>No Data Found.</b>\n<i>The number doesn't exist in our premium database.</i>"

    count = len(data_list)
    output_text = f"💎 <b>PREMIUM INFO RESULT</b>\n"
    output_text += f"<i>Successfully fetched {count} record(s).</i>\n"

    for i, item in enumerate(data_list):
        # Extract and Clean Data
        name = clean_data(item.get('name'))
        fname = clean_data(item.get('fname'))
        mobile = clean_data(item.get('mobile'))
        alt = clean_data(item.get('alt'))
        uid = clean_data(item.get('uid'))
        user_id = clean_data(item.get('id'))
        email = clean_data(item.get('email'))
        circle = clean_data(item.get('circle'))
        address = clean_data(item.get('address'))

        # Visual Separator for multiple results
        if i > 0: output_text += "\n══════════════════════\n"

        output_text += (
            f"\n<b>👤 PERSON #{i+1}</b>\n"
            f"╭─ 🆔 <b>Identity Info</b>\n"
            f"│  ├ <b>Name:</b> {name}\n"
            f"│  └ <b>Father:</b> {fname}\n"
            f"│\n"
            f"├─ 🔒 <b>Secure IDs</b>\n"
            f"│  ├ <b>UID:</b> <code>{uid}</code>\n"
            f"│  └ <b>ID:</b> {user_id}\n"
            f"│\n"
            f"├─ 📞 <b>Contact Data</b>\n"
            f"│  ├ <b>Mobile:</b> <code>{mobile}</code>\n"
            f"│  ├ <b>Alt:</b> {alt}\n"
            f"│  └ <b>Email:</b> {email}\n"
            f"│\n"
            f"╰─ 📍 <b>Address Info</b>\n"
            f"   ├ <b>Circle:</b> {circle}\n"
            f"   └ <b>Addr:</b> {address}\n"
        )
        
        # Limit check
        if len(output_text) > 3800:
            output_text += "\n⚠️ <i>Display limit reached.</i>"
            break

    return output_text

async def fetch_api_data(number):
    """
    Fetches data from the API using the simple hardcoded structure.
    """
    # Simply constructing the URL as requested: key=ForApp
    url = f"https://danger-vip-key.shop/api.php?key=ForApp&number={number}"
    
    async with aiohttp.ClientSession() as session:
        try:
            # Increased timeout to 30 seconds to fix API Errors
            async with session.get(url, verify_ssl=False, timeout=30) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logging.error(f"API returned status: {response.status}")
                    return None
        except Exception as e:
            logging.error(f"API Error: {type(e).__name__} - {e}")
            return None

# ---------------------------------------------------------
# HANDLERS
# ---------------------------------------------------------

@dp.message(Command("start"))
async def cmd_start(message: Message):
    user_ids.add(message.from_user.id)
    
    welcome_msg = (
        f"👋 <b>Welcome, {message.from_user.first_name}!</b>\n\n"
        "💎 <b>Premium Mobile Info Bot</b>\n"
        "I provide instant access to owner details from the central database.\n\n"
        "👇 <b>Click the button below to start searching.</b>\n\n"
        "━━━━━━━━━━━━━━━━━━\n"
        "👨‍💻 <b>Powered By:</b> @aadi_io"
    )
    await message.answer(welcome_msg, reply_markup=get_main_menu())

@dp.callback_query(F.data == "start_search")
async def on_search_click(callback: CallbackQuery):
    """
    Handles the Search button click
    """
    await callback.message.answer("⌨️ <b>Please type the 10-digit mobile number now:</b>")
    await callback.answer() # Removes the loading animation on the button

@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
        
    admin_text = (
        "🛡️ <b>ADMIN DASHBOARD</b>\n\n"
        "👥 <b>Users:</b> Use /stats\n"
        "📢 <b>Broadcast:</b> Reply to any msg with /broadcast"
    )
    await message.answer(admin_text)

@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(f"📊 <b>Active Users:</b> {len(user_ids)}")

@dp.message(Command("broadcast"))
async def cmd_broadcast(message: Message):
    if message.from_user.id != ADMIN_ID: return

    if message.reply_to_message:
        target_msg = message.reply_to_message
        is_reply = True
    else:
        parts = message.text.split(maxsplit=1)
        if len(parts) < 2:
            await message.answer("⚠️ Usage: Reply to a msg or send <code>/broadcast text</code>")
            return
        text_to_send = parts[1]
        is_reply = False

    status = await message.answer("🚀 <b>Processing Broadcast...</b>")
    # Fixed Syntax Error Here (added the 0)
    count, failed = 0, 0
    
    for uid in user_ids:
        try:
            if is_reply:
                await target_msg.copy_to(chat_id=uid)
            else:
                await bot.send_message(uid, f"📢 <b>NOTICE:</b>\n\n{text_to_send}")
            count += 1
            await asyncio.sleep(0.05)
        except:
            failed += 1

    await status.edit_text(f"✅ <b>Done!</b> Sent: {count} | Failed: {failed}")

# Callback to delete message (Clean UI)
@dp.callback_query(F.data == "delete_msg")
async def process_callback_delete(callback_query: CallbackQuery):
    await bot.delete_message(chat_id=callback_query.message.chat.id, message_id=callback_query.message.message_id)
    await callback_query.answer("Message closed")

@dp.message(F.text)
async def handle_verification(message: Message):
    # Visual Polish: Send 'Typing' action
    await bot.send_chat_action(chat_id=message.chat.id, action=ChatAction.TYPING)

    if not message.text.isdigit() or len(message.text) < 10:
        await message.answer("⚠️ <b>Invalid Number</b>\nPlease send a valid 10-digit mobile number.")
        return

    # Use a placeholder message for better UX
    wait_msg = await message.answer("🔍 <b>Scanning Database...</b>\n<i>Fetching premium details...</i>")
    
    api_data = await fetch_api_data(message.text)
    
    # Process
    result_text = format_response_ui(api_data)
    
    # If successful, show with Close button, otherwise just text
    kb = get_result_keyboard() if "RESULT" in result_text else None
    
    await wait_msg.edit_text(result_text, reply_markup=kb)

# ---------------------------------------------------------
# EXECUTION
# ---------------------------------------------------------
async def main():
    await bot.delete_webhook(drop_pending_updates=True)
    
    # Start the dummy web server for Render Uptime
    await start_web_server()
    
    print("🚀 Premium Bot Running with Web Server...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Bot stopped")
