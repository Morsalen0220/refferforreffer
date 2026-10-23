const { Markup } = require("telegraf");
const { getAllSettings } = require("./store");
const { getRandomCustomerName } = require("./names");
const { getRealCryptoTransactionProof } = require("./realTransactions");
const { money, escapeHtml, getBotUsername } = require("./helpers");

let botInstance = null;
let isBroadcasterStarted = false;

function setBroadcasterBot(bot) {
  botInstance = bot;
}

// Send message specifically to the designated Community Group (not Channel)
async function sendToGroupOnly(msg, keyboard) {
  if (!botInstance) return { success: false, error: "Bot not initialized" };

  const settings = getAllSettings();
  const groupId = settings.group_id;

  if (!groupId) {
    return { success: false, error: "No group_id configured in settings" };
  }

  try {
    const res = await botInstance.telegram.sendMessage(groupId, msg, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
      ...keyboard
    });
    console.log(`📢 [Group Auto-Poster] Successfully sent notice to Group (${groupId})`);
    return { success: true, messageId: res.message_id };
  } catch (err) {
    console.error(`[Group Auto-Poster Error] Failed to send to Group (${groupId}):`, err.message);
    return { success: false, error: err.message };
  }
}

// 1. Realtime Deposit Notice (Always 1.00 USDT & Full clickable TxID)
async function sendGroupDepositNotice(customerName, amount = 1.00, methodLabel = null) {
  const txProof = getRealCryptoTransactionProof();
  const label = methodLabel || txProof.methodLabel;
  const botUsername = await getBotUsername(botInstance);

  const msg =
    `<blockquote>💰 <b>WALLET DEPOSIT CONFIRMED</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Customer:</b> <b>${escapeHtml(customerName)}</b>\n` +
    `💵 <b>Amount:</b> <b>+1.00 USDT</b>\n` +
    `🌐 <b>Method:</b> ${txProof.gatewayIcon} <b>${label}</b>\n` +
    `🔗 <b>TxID:</b> <a href="${txProof.txUrl}">${txProof.txId}</a>\n` +
    `✅ <b>Status:</b> <b>Success (Credited)</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚡️ <i>Deposit verified &amp; credited to wallet balance!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🚀 Start Earning Now", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

let withdrawalHistory = [];

// 2. Realtime Withdrawal Notice (Full clickable TxID)
async function sendGroupWithdrawalNotice(customerName, amount = 7.50, methodLabel = null) {
  const txProof = getRealCryptoTransactionProof();
  const label = methodLabel || txProof.methodLabel;
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const msg =
    `<blockquote>💸 <b>WITHDRAWAL PROCESSED &amp; PAID</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Customer:</b> <b>${escapeHtml(customerName)}</b>\n` +
    `💵 <b>Amount Paid:</b> <b>${money(amount)}</b>\n` +
    `🌐 <b>Method:</b> ${txProof.gatewayIcon} <b>${label}</b>\n` +
    `🔗 <b>TxID:</b> <a href="${txProof.txUrl}">${txProof.txId}</a>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `✅ <b>Status:</b> <b>Confirmed &amp; Dispatched</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 <i>Earn $2.50 for every referral! Instant payouts at 3 invites.</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🚀 Start Earning Now", `https://t.me/${botUsername}`)]]);
  const res = await sendToGroupOnly(msg, keyboard);
  if (res.success) {
    withdrawalHistory.push(Date.now());
  }
  return res;
}

// 3. Realtime Milestone Notice (e.g. 3, 6, 9 referrals reached)
async function sendGroupMilestoneNotice(customerName, referralsCount = 3, rewardAmount = 7.50) {
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const msg =
    `<blockquote>🎉 <b>REFERRAL MILESTONE COMPLETED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Member:</b> <b>${escapeHtml(customerName)}</b>\n` +
    `👥 <b>Total Referrals:</b> <b>${referralsCount} Members Joined</b>\n` +
    `💰 <b>Total Earned:</b> <b>${money(rewardAmount)} Added to Wallet</b>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `⚡️ <b>Status:</b> <b>Ready for Immediate Payout</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>Invite 3 friends and unlock immediate USDT payouts!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("👥 Get Your Invite Link", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// 4. Realtime Activation Deposit Notice
async function sendGroupActivationNotice(customerName, amount = 1.00) {
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const msg =
    `<blockquote>💎 <b>ACCOUNT VERIFIED &amp; ACTIVATED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Member:</b> <b>${escapeHtml(customerName)}</b>\n` +
    `📥 <b>Deposit Amount:</b> <b>${money(amount)}</b>\n` +
    `🛡️ <b>Type:</b> <b>1-Time Anti-Bot Verification</b>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `🔓 <b>Withdrawals:</b> <b>Fully Unlocked ✅</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡️ <i>Guaranteed, automated &amp; verified payouts!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("⚡️ Start Earning Now", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// 5. Real Referral Joined Notice in Group (triggers whenever an actual user joins via someone's link)
async function sendRealReferralNoticeToGroup(refUser, newUser) {
  const settings = getAllSettings();
  if (!settings.group_id) return { success: false, error: "No group_id configured" };
  const botUsername = await getBotUsername(botInstance);
  const refName = [refUser.first_name, refUser.last_name].filter(Boolean).join(" ") || "Community Member";
  const newName = [newUser.first_name, newUser.last_name].filter(Boolean).join(" ") || "New Member";
  const refCount = refUser.referral_count || 1;
  const req = Number(settings.referrals_required || 3);
  const rewardAmount = Number(settings.referral_reward_amount || 2.50);
  const welcomeBonus = Number(settings.welcome_bonus_amount || 2.00);

  // Direct user profile link: if has @username link directly to https://t.me/username, otherwise tg://user?id=ID
  const refLink = refUser.username ? `https://t.me/${refUser.username.replace(/^@/, "")}` : `tg://user?id=${refUser.id}`;
  const newLink = newUser.username ? `https://t.me/${newUser.username.replace(/^@/, "")}` : `tg://user?id=${newUser.id}`;

  const msg =
    `<blockquote>🎉 <b>REAL REFERRAL JOINED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Referrer:</b> <a href="${refLink}"><b>${escapeHtml(refName)}</b></a>\n` +
    `👥 <b>New Member:</b> <a href="${newLink}"><b>${escapeHtml(newName)}</b></a>\n` +
    `💵 <b>Referrer Reward:</b> <b>+${money(rewardAmount)} Added</b>\n` +
    `🎁 <b>Joiner Welcome Bonus:</b> <b>+${money(welcomeBonus)} Credited</b>\n` +
    `📈 <b>Referrer Progress:</b> <b>${refCount} / ${req} Referrals</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 <i>Invite your friends and earn $2.50 for every referral! Withdraw at 3 invites.</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("👥 Get Your Invite Link", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// 6. Automated Single Referral Join Notice (for group background auto-posting)
async function sendGroupSingleReferralNotice(referrerName, newMemberName, refCount = 1) {
  const settings = getAllSettings();
  const req = Number(settings.referrals_required || 3);
  const rewardAmount = Number(settings.referral_reward_amount || 2.50);
  const welcomeBonus = Number(settings.welcome_bonus_amount || 2.00);
  const botUsername = await getBotUsername(botInstance);

  const msg =
    `<blockquote>🎉 <b>NEW REFERRAL JOINED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Referrer:</b> <b>${escapeHtml(referrerName)}</b>\n` +
    `👥 <b>New Member:</b> <b>${escapeHtml(newMemberName)}</b>\n` +
    `💵 <b>Referrer Reward:</b> <b>+${money(rewardAmount)} Added</b>\n` +
    `🎁 <b>Joiner Welcome Bonus:</b> <b>+${money(welcomeBonus)} Credited</b>\n` +
    `📈 <b>Referrer Progress:</b> <b>${refCount} / ${req} Referrals</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 <i>Invite your friends and earn $2.50 for every referral! Withdraw at 3 invites.</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("👥 Get Your Invite Link", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// Background scheduler for group auto broadcasts
// GUARANTEED: Minimum 3 withdrawal posts every 10 minutes (often 4 to 6 times per 10 mins)
function scheduleNextGroupBroadcast(isFirstRun = false) {
  // First run: 15-25 seconds; subsequent runs: 75 to 160 seconds (1m 15s to 2m 40s)
  // This guarantees 4 to 7 broadcast cycles every 10 minutes.
  const minMs = isFirstRun ? 15 * 1000 : 75 * 1000;
  const maxMs = isFirstRun ? 25 * 1000 : 160 * 1000;
  const delayMs = Math.floor(minMs + Math.random() * (maxMs - minMs));

  setTimeout(async () => {
    try {
      const settings = getAllSettings();
      if (settings.auto_broadcast_enabled !== false && settings.group_id) {
        // Purge timestamps older than 10 minutes
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        withdrawalHistory = withdrawalHistory.filter((ts) => ts > tenMinutesAgo);

        // Count how many withdrawals were posted in the rolling 10-minute window
        const recentWithdrawals = withdrawalHistory.length;

        // "kokhono 2 bar kokhono 1 bar" -> randomly 1 or 2 messages
        const postCount = Math.random() < 0.40 ? 2 : 1;

        for (let i = 0; i < postCount; i++) {
          if (i > 0) {
            // Short realistic delay between the two messages (3 to 6 seconds)
            await new Promise((r) => setTimeout(r, Math.floor(3000 + Math.random() * 3000)));
          }

          const name = getRandomCustomerName();

          // GUARANTEE RULE:
          // If fewer than 3 withdrawals were sent in the last 10 minutes,
          // ALWAYS send a withdrawal post immediately to meet the quota!
          // If 3 or more have already been sent, still send withdrawals 75% of the time!
          const mustSendWithdrawal = recentWithdrawals < 3;
          const roll = Math.random();

          if (mustSendWithdrawal || roll < 0.75) {
            // 1. Withdrawal Processed & Paid (Guaranteed min 3 per 10 mins, typically 4-6)
            const withdrawAmounts = [7.50, 7.50, 10.00, 12.50, 7.50, 15.00, 7.50, 20.00];
            const amount = withdrawAmounts[Math.floor(Math.random() * withdrawAmounts.length)];
            await sendGroupWithdrawalNotice(name, amount);
          } else if (roll < 0.90) {
            // 2. Deposit Confirmed (Always 1.00 USDT)
            await sendGroupDepositNotice(name, 1.00);
          } else {
            // 3. Referral Join / Milestone
            if (Math.random() < 0.70) {
              const refName = getRandomCustomerName();
              const newName = getRandomCustomerName();
              const currentRef = Math.random() < 0.65 ? 1 : 2;
              await sendGroupSingleReferralNotice(refName, newName, currentRef);
            } else {
              const refCounts = [3, 3, 6];
              const ref = refCounts[Math.floor(Math.random() * refCounts.length)];
              await sendGroupMilestoneNotice(name, ref, ref * 2.50);
            }
          }
        }
      }
    } catch (e) {
      console.error("Auto broadcast loop error:", e);
    }
    scheduleNextGroupBroadcast(false);
  }, delayMs);
}

function startGroupBroadcaster(bot) {
  setBroadcasterBot(bot);
  if (!isBroadcasterStarted) {
    isBroadcasterStarted = true;
    scheduleNextGroupBroadcast(true);
  }
}

module.exports = {
  setBroadcasterBot,
  sendToGroupOnly,
  sendGroupDepositNotice,
  sendGroupWithdrawalNotice,
  sendGroupMilestoneNotice,
  sendGroupActivationNotice,
  sendRealReferralNoticeToGroup,
  sendGroupSingleReferralNotice,
  startGroupBroadcaster
};

