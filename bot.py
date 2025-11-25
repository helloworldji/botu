import asyncio
import logging
import aiohttp
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import Message
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------
# Replace with your Bot Token from @BotFather
API_TOKEN = 'YOUR_BOT_TOKEN_HERE' 

# Your Admin ID (Replace with your telegram ID: 8175884349)
ADMIN_ID = 8175884349

# PASTE YOUR API URL HERE
# Ensure the URL accepts parameters like ?key=ForApp&number=...
API_BASE_URL = "YOUR_API_URL_HERE" 
API_KEY = "ForApp"

# ---------------------------------------------------------
# SETUP
# ---------------------------------------------------------
logging.basicConfig(level=logging.INFO)

bot = Bot(
    token=API_TOKEN, 
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
dp = Dispatcher()

# Mock Database for User Stats
user_ids = set()

# ---------------------------------------------------------
# HELPER FUNCTIONS
# ---------------------------------------------------------
async def fetch_api_data(number):
    """
    Fetches data using the specific parameters required.
    """
    # Construct the full URL. 
    # Warning: Ensure your API URL is valid.
    url = f"{API_BASE_URL}?key={API_KEY}&number={number}"
    
    async with aiohttp.ClientSession() as session:
        try:
            # We use verify_ssl=False only if the API has certificate issues, 
            # otherwise remove it for security.
            async with session.get(url, verify_ssl=False) as response:
                if response.status == 200:
                    # The API returns a JSON list based on your snippet
                    return await response.json()
                return None
        except Exception as e:
            logging.error(f"API Error: {e}")
            return None

def format_response(data_list):
    """
    Formats the specific JSON structure provided:
    [{"fname": "...", "mobile": "...", "address": "...", ...}]
    """
    if not data_list or not isinstance(data_list, list):
        return "❌ <b>No records found or Invalid API Response.</b>"

    output_text = f"🔍 <b>FOUND {len(data_list)} RECORD(S)</b>\n"
    output_text += "━━━━━━━━━━━━━━━━━━\n"

    # Iterate through ALL items found (removed the [:5] limit)
    for item in data_list:
        # Extracting ALL fields
        fname = item.get('fname', 'N/A')
        name = item.get('name', 'N/A')
        mobile = item.get('mobile', 'N/A')
        alt_mobile = item.get('alt', 'N/A') # Added Alt Number
        uid = item.get('uid', 'N/A')
        user_id = item.get('id', 'N/A')     # Added ID
        email = item.get('email', 'N/A')    # Added Email
        circle = item.get('circle', 'N/A')
        
        # Clean up the '!' separators in address
        address = item.get('address', 'N/A').replace('!', ' ') 

        record_text = (
            f"👤 <b>Name:</b> {name}\n"
            f"👨‍👦 <b>Father Name:</b> {fname}\n"
            f"🆔 <b>UID:</b> <code>{uid}</code> | <b>ID:</b> {user_id}\n"
            f"📞 <b>Mobile:</b> <code>{mobile}</code>\n"
            f"☎️ <b>Alt Mobile:</b> {alt_mobile}\n"
            f"📧 <b>Email:</b> {email}\n"
            f"📍 <b>Circle:</b> {circle}\n"
            f"🏠 <b>Address:</b> {address}\n"
            "━━━━━━━━━━━━━━━━━━\n"
        )
        
        # Check length to avoid telegram 4096 char limit crash
        if len(output_text) + len(record_text) > 4000:
            output_text += "\n⚠️ <i>Output truncated due to Telegram limit.</i>"
            break
            
        output_text += record_text

    output_text += f"🤖 <i>Verified by Admin</i>"
    return output_text

# ---------------------------------------------------------
# HANDLERS
# ---------------------------------------------------------

@dp.message(Command("start"))
async def cmd_start(message: Message):
    user_ids.add(message.from_user.id)
    await message.answer(
        f"👋 Welcome <b>{message.from_user.first_name}</b>\n\n"
        "🎓 <b>Student Verification System</b>\n"
        "Send a <b>Mobile Number</b> to verify details."
    )

@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
        
    admin_text = (
        "🔐 <b>ADMIN CONTROLS</b>\n\n"
        "/stats - User count\n"
        "/broadcast [msg] - Alert all users\n"
        "/logs - (Simulated) View recent errors"
    )
    await message.answer(admin_text)

@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(f"📊 <b>System Users:</b> {len(user_ids)}")

@dp.message(Command("broadcast"))
async def cmd_broadcast(message: Message):
    if message.from_user.id != ADMIN_ID:
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("⚠️ Usage: <code>/broadcast Message</code>")
        return

    msg = parts[1]
    sent = 0
    status = await message.answer("🚀 Broadcasting...")

    for uid in user_ids:
        try:
            await bot.send_message(uid, f"📢 <b>NOTICE:</b>\n{msg}")
            sent += 1
            await asyncio.sleep(0.05)
        except:
            pass

    await status.edit_text(f"✅ Sent to {sent} users.")

@dp.message(F.text)
async def handle_verification(message: Message):
    # Ensure it's a number (basic validation)
    if not message.text.isdigit():
        await message.answer("⚠️ Send a valid <b>Numeric ID/Phone</b>.")
        return

    wait_msg = await message.answer("⏳ <b>Verifying Database...</b>")
    
    # Fetch Data
    api_data = await fetch_api_data(message.text)
    
    # Format and Reply
    result_text = format_response(api_data)
    await wait_msg.edit_text(result_text)

# ---------------------------------------------------------
# EXECUTION
# ---------------------------------------------------------
async def main():
    # Remove webhook if exists (useful when switching from webhook to polling)
    await bot.delete_webhook(drop_pending_updates=True)
    print("🚀 Verification Bot Running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Bot stopped")
