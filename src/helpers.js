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

function makeProgressBar(current, target) {
  const totalBars = 10;
  const ratio = Math.min(1, Math.max(0, current / target));
  const filled = Math.round(ratio * totalBars);
  const empty = totalBars - filled;
  return "🟩".repeat(filled) + "⬜".repeat(empty);
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
    return "EarnUSDT_Bot";
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

function getMainMenuReplyKeyboard(user = null) {
  const settings = getAllSettings();
  const req = Number(settings.referrals_required || 3);
  const refCount = Number(user?.referral_count || 0);
  const isActivated = Boolean(user?.is_activated);

  // Deposit ($1) ONLY shows when user has at least 3 referrals and is NOT activated yet
  const isEligibleForDeposit = refCount >= req && !isActivated;

  if (isEligibleForDeposit) {
    return Markup.keyboard([
      ["💰 Balance", "👥 Refer & Earn"],
      ["💳 Withdraw", "📥 Deposit ($1)"],
      ["📊 Live Proofs", "📞 Support"]
    ]).resize();
  }

  // When user has LESS than 3 referrals (or is already activated):
  // Deposit ($1) is COMPLETELY HIDDEN!
  return Markup.keyboard([
    ["💰 Balance", "👥 Refer & Earn"],
    ["💳 Withdraw", "📊 Live Proofs"],
    ["📞 Support"]
  ]).resize();
}

function welcomeText(user) {
  const settings = getAllSettings();
  const req = Number(settings.referrals_required || 3);
  const rewardPerRef = Number(settings.referral_reward_amount || 2.50);
  const welcomeBonus = Number(settings.welcome_bonus_amount || 2.00);

  let bonusLine = "";
  if (user.referred_by) {
    bonusLine = `🎁 <b>Verified Joiner Bonus:</b> <b>+${money(welcomeBonus)}</b> has been credited to your wallet balance for joining via official referral link!\n\n`;
  }

  return (
    `👋 Welcome, <b>${escapeHtml(user.first_name || "Friend")}</b>!\n` +
    `to the official <b>${escapeHtml(settings.bot_title || "USDT Referral Earning Protocol")}</b> 🌐\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    bonusLine +
    `💎 <b>Referrer Reward:</b> <b>+${money(rewardPerRef)} USDT</b> per active member invited\n` +
    `🎁 <b>Welcome Bonus:</b> <b>+${money(welcomeBonus)} USDT</b> credited upon joining\n` +
    `🔓 <b>Withdrawal Goal:</b> Invite only <b>${req} active members</b> to unlock payout\n` +
    `⚡️ <b>Automated Payouts:</b> Binance Pay, BEP-20 (BSC) & Polygon Network\n` +
    `🛡️ <b>Anti-Sybil Protected:</b> 100% On-Chain Verified Settlements\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Choose an option from the menu below to get started:</i>`
  );
}

function renderUserProfile(user) {
  const refCount = user.referral_count || (Array.isArray(user.referrals) ? user.referrals.length : 0);
  const status = user.is_activated ? "✅ Activated ($1 Paid)" : "❌ Unactivated";
  const joined = user.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A";
  const username = user.username ? `@${user.username}` : "None";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed";
  const refBy = user.referred_by ? `<code>${user.referred_by}</code>` : "None";

  const text =
    `👤 <b>USER PROFILE: <code>${user.id}</code></b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏷️ <b>Name:</b> ${escapeHtml(name)}\n` +
    `📱 <b>Username:</b> ${username}\n` +
    `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
    `📅 <b>Joined:</b> ${joined}\n` +
    `👥 <b>Total Referrals:</b> <b>${refCount}</b> members\n` +
    `🔗 <b>Referred By:</b> ${refBy}\n` +
    `💰 <b>Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `💵 <b>Total Earned:</b> <b>${money(user.total_earned || 0)}</b>\n` +
    `💸 <b>Total Withdrawn:</b> <b>${money(user.total_withdrawn || 0)}</b>\n` +
    `🛡️ <b>Activation Status:</b> <b>${status}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Quick actions for this user:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback("➕ Quick +3 Refs", `adm_qref:${user.id}:3`),
      Markup.button.callback("➕ Quick +4 Refs", `adm_qref:${user.id}:4`),
      Markup.button.callback("➖ Quick -1 Ref", `adm_qref:${user.id}:-1`)
    ],
    [
      Markup.button.callback("👥 Custom Referrals (+/-)", `adm_user_adj_ref:${user.id}`),
      Markup.button.callback("💰 Adjust Balance", `adm_user_adj:${user.id}`)
    ],
    [
      Markup.button.callback(user.is_activated ? "🔒 Deactivate Account" : "🔓 Activate Account (Verify)", `adm_user_toggle_act:${user.id}`),
      Markup.button.callback("📩 Send DM", `adm_user_dm:${user.id}`)
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
  makeProgressBar,
  getBotUsername,
  verifyLiveMembership,
  checkMembership,
  forceJoinKeyboard,
  getMainMenuReplyKeyboard,
  welcomeText,
  renderUserProfile
};

