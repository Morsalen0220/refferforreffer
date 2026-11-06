const { Markup } = require("telegraf");
const { getAllSettings } = require("./store");

const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

const money = (amount) => `${Number(amount || 0).toFixed(2)} USDT`;

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isAdmin(ctx) {
  return String(ctx.from?.id) === ADMIN_ID;
}

function adminOnly(ctx) {
  if (!isAdmin(ctx)) {
    ctx.reply("❌ Access denied.");
    return false;
  }
  return true;
}

// Cached bot username
let cachedBotUsername = null;
async function getBotUsername(bot) {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await bot.telegram.getMe();
    cachedBotUsername = me.username;
    return me.username;
  } catch (e) {
    return "CloudAIStore_Bot";
  }
}

// Check if user has joined required channel/group via live Telegram API
async function verifyLiveMembership(bot, ctx, userId) {
  const settings = getAllSettings();
  if (!settings.force_join_enabled) {
    return { ok: true, channelOk: true, groupOk: true };
  }

  if (String(userId) === ADMIN_ID) {
    return { ok: true, channelOk: true, groupOk: true };
  }

  const validStatuses = ["creator", "administrator", "member", "restricted"];
  let channelOk = false;
  let groupOk = false;

  // 1. Channel
  if (settings.channel_id) {
    try {
      const member = await bot.telegram.getChatMember(settings.channel_id, userId);
      channelOk = validStatuses.includes(member?.status);
    } catch (e) {
      channelOk = false;
    }
  } else {
    channelOk = true;
  }

  // 2. Group
  if (settings.group_id) {
    try {
      const member = await bot.telegram.getChatMember(settings.group_id, userId);
      groupOk = validStatuses.includes(member?.status);
    } catch (e) {
      groupOk = false;
    }
  } else {
    groupOk = true;
  }

  return { ok: channelOk && groupOk, channelOk, groupOk };
}

async function checkMembership(bot, ctx) {
  const settings = getAllSettings();
  if (!settings.force_join_enabled) return true;
  const userId = ctx.from?.id;
  if (!userId) return true;
  const { ok } = await verifyLiveMembership(bot, ctx, userId);
  return ok;
}

function forceJoinKeyboard() {
  const settings = getAllSettings();
  return Markup.inlineKeyboard([
    [Markup.button.url("📢 Join Channel", settings.channel_link || "https://t.me/")],
    [Markup.button.url("👥 Join Group", settings.group_link || "https://t.me/")],
    [Markup.button.callback("✅ Check / I Have Joined", "check_membership")]
  ]);
}

function makeProgressBar(current, target) {
  const safeTarget = Math.max(1, Number(target || 30));
  const rem = Number(current || 0) % safeTarget;
  const pct = rem === 0 && Number(current || 0) > 0 ? 1 : Math.min(1, rem / safeTarget);
  const totalBlocks = 10;
  const filled = Math.round(pct * totalBlocks);
  const empty = totalBlocks - filled;
  return `[${"🟩".repeat(filled)}${"⬜".repeat(empty)}] (${rem}/${safeTarget})`;
}

function getMainMenuReplyKeyboard() {
  return Markup.keyboard([
    ["🛍️ Buy Products", "🔑 API Keys & Cloud"],
    ["🎁 Free ChatGPT (30 Refs)", "👛 Wallet"],
    ["📦 My Orders", "📊 Live Proofs", "📞 Support"]
  ]).resize();
}

function welcomeText(user) {
  const settings = getAllSettings();
  const reqRefs = Number(settings.referrals_for_free_reward || 30);

  return (
    `👋 Welcome, <b>${escapeHtml(user.first_name || "Friend")}</b>!\n` +
    `to <b>${escapeHtml(settings.bot_title || "Cloud & AI Resource Store")}</b> 🌐\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 <b>AI Max & Pro Accounts:</b> Claude Max 20x, ChatGPT Pro 20x ($200 Tier), ChatGPT Shared (1M), Grok Heavy 1M, BytePlus Seedance 2.5\n` +
    `☁️ <b>Cloud & Enterprise:</b> GCP $300 (USA / JSON Format), Azure PAYG (GPT T1–T5 & Claude T5), Azure $100K (10M TPM), AWS 5v (5 RPM & 50 RPM)\n` +
    `🔑 <b>High-Quota Official API Keys:</b> Vertex/AI Studio Gemini, Claude Official Key, AWS Bedrock, OpenAI & Azure Keys\n` +
    `📱 <b>Global eSIM & GV:</b> All-Country eSIM Cards & USA Google Voice Accounts\n` +
    `🎁 <b>Referral Reward:</b> Invite <b>${reqRefs} friends</b> = Get <b>1 FREE ChatGPT Shared Account (1 Month)</b>!\n` +
    `⚡️ <b>24/7 Automated Delivery:</b> USDT (BEP-20 & Polygon), Litecoin (LTC)${settings.binance_pay_enabled !== false ? " & Binance Pay" : ""} Supported\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👛 <b>Your Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b> | 👥 <b>Referrals:</b> <b>${user.referral_count || 0}/${reqRefs}</b>\n` +
    `👇 <i>Choose an option from the menu below to browse & order:</i>`
  );
}

function renderUserProfile(user) {
  const settings = getAllSettings();
  const reqRefs = Number(settings.referrals_for_free_reward || 30);
  const joined = user.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A";
  const username = user.username ? `@${user.username}` : "None";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed";

  const text =
    `👤 <b>USER PROFILE: <code>${user.id}</code></b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏷️ <b>Name:</b> ${escapeHtml(name)}\n` +
    `📱 <b>Username:</b> ${username}\n` +
    `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
    `📅 <b>Joined:</b> ${joined}\n` +
    `👛 <b>Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `📥 <b>Total Deposited:</b> <b>${money(user.total_deposited || 0)}</b>\n` +
    `🛒 <b>Total Spent:</b> <b>${money(user.total_spent || 0)}</b>\n` +
    `📦 <b>Total Orders:</b> <b>${user.orders_count || 0}</b>\n` +
    `👥 <b>Total Referrals:</b> <b>${user.referral_count || 0}</b> (Target: ${reqRefs})\n` +
    `🎁 <b>Claimed Free ChatGPT (1M):</b> <b>${user.claimed_free_rewards || 0}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Quick actions for this user:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback("💰 Adjust Balance (+/-)", `adm_user_adj:${user.id}`),
      Markup.button.callback("📩 Send DM", `adm_user_dm:${user.id}`)
    ],
    [
      Markup.button.callback("➕ +5 Refs", `adm_qref:${user.id}:5`),
      Markup.button.callback(`➕ +${reqRefs} Refs`, `adm_qref:${user.id}:${reqRefs}`),
      Markup.button.callback("➖ -1 Ref", `adm_qref:${user.id}:-1`),
      Markup.button.callback("✏️ Custom Ref", `adm_user_adj_ref:${user.id}`)
    ],
    [
      Markup.button.callback("👥 View Users List", "adm:users"),
      Markup.button.callback("🔙 Dashboard", "adm:menu")
    ]
  ]);

  return { text, kb };
}

module.exports = {
  ADMIN_ID,
  money,
  escapeHtml,
  isAdmin,
  adminOnly,
  getBotUsername,
  verifyLiveMembership,
  checkMembership,
  forceJoinKeyboard,
  makeProgressBar,
  getMainMenuReplyKeyboard,
  welcomeText,
  renderUserProfile
};
