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

// Fast 90-second cache for verified channel/group membership so every button tap is 0ms instant
const membershipCache = new Map();
const MEMBERSHIP_TTL_MS = 90 * 1000;

// Check if user has joined required channel/group via live Telegram API (parallel + cached)
async function verifyLiveMembership(bot, ctx, userId, forceRefresh = false) {
  const settings = getAllSettings();
  if (!settings.force_join_enabled) {
    return { ok: true, channelOk: true, groupOk: true };
  }

  if (String(userId) === ADMIN_ID) {
    return { ok: true, channelOk: true, groupOk: true };
  }

  const cacheKey = String(userId);
  if (!forceRefresh && membershipCache.has(cacheKey)) {
    const cached = membershipCache.get(cacheKey);
    if (Date.now() - cached.ts < MEMBERSHIP_TTL_MS && cached.ok) {
      return cached;
    }
  }

  const validStatuses = ["creator", "administrator", "member", "restricted"];

  const checkSingleChat = async (chatId) => {
    if (!chatId) return true;
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500));
      const member = await Promise.race([bot.telegram.getChatMember(chatId, userId), timeout]);
      return validStatuses.includes(member?.status);
    } catch (e) {
      return false;
    }
  };

  const [channelOk, groupOk] = await Promise.all([
    checkSingleChat(settings.channel_id),
    checkSingleChat(settings.group_id)
  ]);

  const result = { ok: channelOk && groupOk, channelOk, groupOk, ts: Date.now() };
  if (result.ok) {
    membershipCache.set(cacheKey, result);
  } else {
    membershipCache.delete(cacheKey);
  }
  return result;
}

async function checkMembership(bot, ctx) {
  const settings = getAllSettings();
  if (!settings.force_join_enabled) return true;
  const userId = ctx.from?.id;
  if (!userId) return true;
  const { ok } = await verifyLiveMembership(bot, ctx, userId, false);
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
    ["🎁 Refer", "👛 Wallet"],
    ["📦 My Orders", "📊 Live Proofs", "📞 Support"]
  ]).resize();
}

function welcomeText(user) {
  const settings = getAllSettings();
  const groupLink = settings.group_link || "https://t.me/RefferRewardes";
  const channelLink = settings.channel_link || "https://t.me/RefferRewardss";

  return (
    `👋 Welcome, <b>${escapeHtml(user.first_name || "Friend")}</b>!\n` +
    `to <b>${escapeHtml(settings.bot_title || "Cloud & AI Resource Store")}</b> 🌐\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 <b>AI Max &amp; Pro Accounts:</b> Claude Max 20x, ChatGPT Pro 20x ($200 Tier), ChatGPT Shared (1M), Grok Heavy 1M, BytePlus Seedance 2.5\n` +
    `☁️ <b>Cloud &amp; Enterprise:</b> GCP $300 (USA / JSON Format), Azure PAYG (GPT T1–T5 &amp; Claude T5), Azure $100K (10M TPM), AWS 5v (5 RPM &amp; 50 RPM)\n` +
    `🔑 <b>High-Quota Official API Keys:</b> Vertex/AI Studio Gemini, Claude Official Key, AWS Bedrock, OpenAI &amp; Azure Keys\n` +
    `📱 <b>Global eSIM &amp; GV:</b> All-Country eSIM Cards &amp; USA Google Voice Accounts\n` +
    `⚡️ <b>24/7 Automated Delivery:</b> USDT (TRC-20, BEP-20 &amp; Polygon), Litecoin (LTC)${settings.binance_pay_enabled !== false ? " &amp; Binance Pay" : ""} Supported\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 <b><a href="${groupLink}">Join Our Community Group</a></b>\n` +
    `📢 <b><a href="${channelLink}">Join Our Official Channel</a></b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👛 <b>Your Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `👇 <i>Choose an option from the menu below to browse &amp; order:</i>`
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
