const { Markup } = require("telegraf");
const {
  getSetting,
  getAllSettings,
  setSetting,
  getUser,
  adjustUserBalance,
  adjustUserReferrals,
  setUserActivated,
  getAllUsers,
  getDeposit,
  approveDeposit,
  rejectDeposit,
  getPendingDeposits,
  getAllDeposits,
  getWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  getPendingWithdrawals,
  getAllWithdrawals
} = require("../store");

const { getRandomCustomerName } = require("../names");
const {
  money,
  escapeHtml,
  adminOnly,
  isAdmin,
  ADMIN_ID,
  renderUserProfile,
  getBotUsername
} = require("../helpers");

const {
  sendGroupDepositNotice,
  sendGroupWithdrawalNotice,
  sendGroupMilestoneNotice,
  sendGroupActivationNotice,
  sendRealReferralNoticeToGroup
} = require("../broadcaster");

async function showAdminDashboard(ctx) {
  const users = getAllUsers();
  const deposits = getAllDeposits();
  const withdrawals = getAllWithdrawals();

  const totalUsers = users.length;
  const activatedUsers = users.filter((u) => u.is_activated).length;
  const pendingDeps = deposits.filter((d) => d.status === "pending").length;
  const pendingWths = withdrawals.filter((w) => w.status === "pending").length;
  const totalPaid = withdrawals.filter((w) => w.status === "approved").reduce((acc, w) => acc + (w.amount || 0), 0);
  const totalRef = users.reduce((acc, u) => acc + (u.referral_count || 0), 0);

  const text =
    `👑 <b>ADMINISTRATOR CONTROL PANEL</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 <b>Total Users:</b> <b>${totalUsers}</b>\n` +
    `⚡️ <b>Activated Users ($1 Paid):</b> <b>${activatedUsers}</b>\n` +
    `🔗 <b>Total Referrals Made:</b> <b>${totalRef}</b>\n` +
    `📥 <b>Pending Deposits:</b> <b>${pendingDeps}</b>\n` +
    `💳 <b>Pending Withdrawals:</b> <b>${pendingWths}</b>\n` +
    `💰 <b>Total Paid Out:</b> <b>${money(totalPaid)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Select an action below:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(`📥 Pending Deposits (${pendingDeps})`, "adm:deposits"),
      Markup.button.callback(`💳 Pending Withdrawals (${pendingWths})`, "adm:withdrawals")
    ],
    [
      Markup.button.callback("👥 Users & Referrals", "adm:users"),
      Markup.button.callback("🔍 Find / Manage User", "adm:find_user")
    ],
    [
      Markup.button.callback("📢 Broadcast (All)", "adm:broadcast"),
      Markup.button.callback("📩 Direct Message (User)", "adm:dm_user")
    ],
    [
      Markup.button.callback("⚙️ Bot Settings", "adm:settings"),
      Markup.button.callback("🧪 Test Group Broadcast", "adm:test_broadcast")
    ],
    [
      Markup.button.callback("🚀 Promo & Share Posts", "adm:promos")
    ]
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

function registerAdminHandlers(bot) {
  // Command & Main Admin Menu
  bot.command("admin", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await showAdminDashboard(ctx);
  });

  bot.action("adm:menu", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showAdminDashboard(ctx);
  });

  // 1. Pending Deposits
  bot.action("adm:deposits", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const pending = getPendingDeposits();

    if (pending.length === 0) {
      await ctx.answerCbQuery();
      return ctx.editMessageText("📥 No pending deposits.", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
      });
    }

    const buttons = pending.slice(0, 10).map((d) => [
      Markup.button.callback(`${d.id} • ${money(d.amount)} (${d.method})`, `adm_view_dep:${d.id}`)
    ]);
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`📥 <b>Pending Deposits (${pending.length}):</b>`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons)
    });
  });

  bot.action(/^adm_view_dep:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const dep = getDeposit(ctx.match[1]);
    if (!dep) return ctx.answerCbQuery("Deposit not found.", { show_alert: true });

    const text =
      `📥 <b>DEPOSIT DETAILS: <code>${dep.id}</code></b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>User ID:</b> <code>${dep.user_id}</code>\n` +
      `💵 <b>Amount:</b> <b>${money(dep.amount)}</b>\n` +
      `⚡️ <b>Method:</b> ${dep.method}\n` +
      `📝 <b>Proof:</b> <code>${escapeHtml(dep.proof || "N/A")}</code>\n` +
      `🕒 <b>Date:</b> ${new Date(dep.created_at).toLocaleString()}`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Approve Deposit", `adm_dep_app:${dep.id}`)],
      [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${dep.id}`)],
      [Markup.button.callback("🔙 Back", "adm:deposits")]
    ]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
  });

  bot.action(/^adm_dep_app:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const depId = ctx.match[1];

    try {
      const { deposit, user } = approveDeposit(depId);
      await ctx.answerCbQuery("Deposit approved!");
      await ctx.editMessageText(
        `✅ <b>Deposit <code>${depId}</code> Approved!</b>\nUser: <code>${deposit.user_id}</code>\nAmount: <b>${money(deposit.amount)}</b>\nAccount is now ACTIVATED.`,
        { parse_mode: "HTML" }
      );

      // Notify user
      bot.telegram.sendMessage(
        deposit.user_id,
        `🎉 <b>ACCOUNT ACTIVATED SUCCESSFULLY!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Your verification deposit of <b>${money(deposit.amount)}</b> has been verified and confirmed!\n\n` +
        `🔓 <b>Lifetime automated withdrawals are now FULLY UNLOCKED on your account!</b>\n\n` +
        `Tap "💳 Withdraw" in the bot to withdraw your referral earnings!`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("💳 Withdraw My Funds", "menu_withdraw")]])
        }
      ).catch(() => {});

      // Broadcast deposit notice to group
      const settings = getAllSettings();
      if (settings.group_id) {
        sendGroupDepositNotice(user.first_name || "Community Member", deposit.amount || 1.00).catch(() => {});
      }
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true });
    }
  });

  bot.action(/^adm_dep_rej:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const depId = ctx.match[1];
    ctx.session.adminAction = { type: "reject_deposit", depositId: depId };
    await ctx.answerCbQuery();
    await ctx.reply(`Send the rejection reason for deposit <code>${depId}</code>:`, { parse_mode: "HTML" });
  });

  // 2. Pending Withdrawals
  bot.action("adm:withdrawals", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const pending = getPendingWithdrawals();

    if (pending.length === 0) {
      await ctx.answerCbQuery();
      return ctx.editMessageText("💳 No pending withdrawals.", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
      });
    }

    const buttons = pending.slice(0, 10).map((w) => [
      Markup.button.callback(`${w.id} • ${money(w.amount)} (${w.method})`, `adm_view_wth:${w.id}`)
    ]);
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`💳 <b>Pending Withdrawals (${pending.length}):</b>`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons)
    });
  });

  bot.action(/^adm_view_wth:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const w = getWithdrawal(ctx.match[1]);
    if (!w) return ctx.answerCbQuery("Withdrawal not found.", { show_alert: true });

    const text =
      `💳 <b>WITHDRAWAL DETAILS: <code>${w.id}</code></b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>User ID:</b> <code>${w.user_id}</code>\n` +
      `💵 <b>Amount:</b> <b>${money(w.amount)}</b>\n` +
      `🌐 <b>Method:</b> ${w.method}\n` +
      `📫 <b>Destination:</b> <code>${escapeHtml(w.address)}</code>\n` +
      `🕒 <b>Date:</b> ${new Date(w.created_at).toLocaleString()}`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Approve & Mark Paid", `adm_wth_app:${w.id}`)],
      [Markup.button.callback("❌ Reject & Refund", `adm_wth_rej:${w.id}`)],
      [Markup.button.callback("🔙 Back", "adm:withdrawals")]
    ]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
  });

  bot.action(/^adm_wth_app:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const withdrawId = ctx.match[1];

    try {
      const { withdrawal, user } = approveWithdrawal(withdrawId);
      await ctx.answerCbQuery("Withdrawal approved!");
      await ctx.editMessageText(
        `✅ <b>Withdrawal <code>${withdrawId}</code> Approved & Marked as Paid!</b>\n` +
        `User: <code>${withdrawal.user_id}</code>\n` +
        `Amount: <b>${money(withdrawal.amount)}</b>\n` +
        `TxID: <code>${withdrawal.txid}</code>`,
        { parse_mode: "HTML" }
      );

      // Notify user
      const isPolygon = String(withdrawal.method || "").toUpperCase().includes("POLYGON");
      const explorerUrl = isPolygon
        ? `https://polygonscan.com/tx/${withdrawal.txid}`
        : `https://bscscan.com/tx/${withdrawal.txid}`;

      bot.telegram.sendMessage(
        withdrawal.user_id,
        `🎉 <b>WITHDRAWAL SUCCESSFUL & PAID!</b> 💸\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Your withdrawal of <b>${money(withdrawal.amount)}</b> has been sent to your <b>${withdrawal.method}</b>:\n` +
        `<code>${withdrawal.address}</code>\n\n` +
        `🔗 <b>TxID:</b> <a href="${explorerUrl}">${withdrawal.txid}</a>\n\n` +
        `Thank you for earning with us! Continue sharing your link to earn more!`,
        { parse_mode: "HTML" }
      ).catch(() => {});

      // Broadcast real withdrawal notice to group
      const settings = getAllSettings();
      if (settings.group_id) {
        sendGroupWithdrawalNotice(user.first_name || "Community Member", withdrawal.amount, withdrawal.method).catch(() => {});
      }
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true });
    }
  });

  bot.action(/^adm_wth_rej:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const withdrawId = ctx.match[1];
    ctx.session.adminAction = { type: "reject_withdraw", withdrawId: withdrawId };
    await ctx.answerCbQuery();
    await ctx.reply(`Send the rejection reason for withdrawal <code>${withdrawId}</code>:`, { parse_mode: "HTML" });
  });

  // 3. Settings
  bot.action("adm:settings", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const s = getAllSettings();

    const text =
      `⚙️ <b>BOT SETTINGS CONTROL PANEL</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ <b>Bot Title:</b> ${escapeHtml(s.bot_title || "USDT Referral Earning Bot")}\n\n` +
      `👥 <b>Min Referrals for Withdraw:</b> <b>${s.referrals_required || 3} members</b>\n` +
      `💵 <b>Referrer Reward:</b> <b>${money(s.referral_reward_amount || 2.50)} per invite</b>\n` +
      `🎁 <b>Joiner Welcome Bonus:</b> <b>${money(s.welcome_bonus_amount || 2.00)}</b>\n` +
      `💳 <b>Min Withdraw Amount:</b> <b>${money(s.min_withdraw || 7.50)}</b>\n` +
      `📥 <b>Activation Deposit:</b> <b>${money(s.activation_deposit_amount || 1.00)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 <b>Binance Pay ID:</b> <code>${s.binance_pay_id || "None"}</code>\n` +
      `🟢 <b>BEP20 Address:</b> <code>${s.bep20_usdt_address?.slice(0, 10)}...</code>\n` +
      `🟣 <b>Polygon Address:</b> <code>${s.polygon_usdt_address?.slice(0, 10)}...</code>\n` +
      `📢 <b>Channel:</b> ${s.channel_link}\n` +
      `👥 <b>Group:</b> ${s.group_link}\n` +
      `🔒 <b>Force Join:</b> ${s.force_join_enabled ? "✅ ON" : "❌ OFF"}\n` +
      `📢 <b>Auto-Poster (Group Only):</b> ${s.auto_broadcast_enabled !== false ? "✅ ON" : "❌ OFF"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Tap any button below to update setting:</i>`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("👥 Min Referrals", "adm_set:referrals_required"),
        Markup.button.callback("💵 Refer Reward $", "adm_set:referral_reward_amount")
      ],
      [
        Markup.button.callback("🎁 Joining Bonus $", "adm_set:welcome_bonus_amount"),
        Markup.button.callback("💳 Min Withdraw $", "adm_set:min_withdraw")
      ],
      [
        Markup.button.callback("📥 Activation Deposit $", "adm_set:activation_deposit_amount"),
        Markup.button.callback("🟡 Binance Pay ID", "adm_set:binance_pay_id")
      ],
      [
        Markup.button.callback("🟢 BEP20 USDT", "adm_set:bep20_usdt_address"),
        Markup.button.callback("🟣 Polygon USDT", "adm_set:polygon_usdt_address")
      ],
      [
        Markup.button.callback("📢 Channel Link", "adm_set:channel_link"),
        Markup.button.callback("👥 Group Link", "adm_set:group_link")
      ],
      [
        Markup.button.callback(s.force_join_enabled ? "🔒 Force Join (Turn OFF)" : "🔒 Force Join (Turn ON)", "adm_toggle_fj"),
        Markup.button.callback(s.auto_broadcast_enabled !== false ? "📢 Auto Broadcast (Turn OFF)" : "📢 Auto Broadcast (Turn ON)", "adm_toggle_bc")
      ],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    ]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
  });

  bot.action(/^adm_set:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const key = ctx.match[1];
    ctx.session.adminAction = { type: "set_setting", key };
    await ctx.answerCbQuery();

    const descriptions = {
      referrals_required: "👥 <b>Minimum Referrals Required for Withdrawal</b>\n(e.g. <code>3</code>)",
      referral_reward_amount: "💵 <b>Referrer Reward Amount per Invite (USDT)</b>\n(e.g. <code>2.50</code>)",
      welcome_bonus_amount: "🎁 <b>New User Joining / Welcome Bonus (USDT)</b>\n(e.g. <code>2.00</code>)",
      min_withdraw: "💳 <b>Minimum Withdrawal Amount (USDT)</b>\n(e.g. <code>7.50</code>)",
      activation_deposit_amount: "📥 <b>1-Time Security Verification Deposit (USDT)</b>\n(e.g. <code>1.00</code>)",
      binance_pay_id: "🟡 <b>Admin Binance Pay ID</b>\n(e.g. <code>123456789</code>)",
      bep20_usdt_address: "🟢 <b>USDT (BEP-20 BSC) Wallet Address</b>\n(e.g. <code>0x1234...abcd</code>)",
      polygon_usdt_address: "🟣 <b>USDT (Polygon Network) Wallet Address</b>\n(e.g. <code>0x1234...abcd</code>)",
      channel_link: "📢 <b>Telegram Channel Link</b>\n(e.g. <code>https://t.me/RefferRewardss</code>)",
      group_link: "👥 <b>Telegram Group Link</b>\n(e.g. <code>https://t.me/RefferRewardes</code>)",
      bot_title: "🏷️ <b>Bot Title</b>\n(e.g. <code>USDT Referral Earning Bot</code>)"
    };

    const desc = descriptions[key] || `<b>${key}</b>`;
    await ctx.reply(`✏️ <b>Enter new value for:</b>\n${desc}\n\n<i>Type /cancel to cancel.</i>`, { parse_mode: "HTML" });
  });

  bot.action("adm_toggle_fj", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const current = Boolean(getSetting("force_join_enabled"));
    setSetting("force_join_enabled", !current);
    await ctx.answerCbQuery(`Force Join is now ${!current ? "ENABLED" : "DISABLED"}`);
    return showAdminDashboard(ctx);
  });

  bot.action("adm_toggle_bc", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const current = getSetting("auto_broadcast_enabled") !== false;
    setSetting("auto_broadcast_enabled", !current);
    await ctx.answerCbQuery(`Auto Broadcaster is now ${!current ? "ENABLED" : "DISABLED"}`);
    return showAdminDashboard(ctx);
  });

  // 4. Broadcast to All Users
  bot.action("adm:broadcast", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "broadcast" };
    await ctx.answerCbQuery();
    await ctx.reply("📢 <b>Broadcast to All Users</b>\n\nSend the message you want to broadcast to all registered bot users:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  // 5. Direct Message Specific User
  bot.action("adm:dm_user", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "dm_enter_user_id" };
    await ctx.answerCbQuery();
    await ctx.reply("📩 <b>Direct Message User</b>\n\nPlease enter the recipient's numeric <b>Telegram User ID</b>:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  // 6. Find User
  bot.action("adm:find_user", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "find_user" };
    await ctx.answerCbQuery();
    await ctx.reply("🔍 <b>Find & Manage User</b>\n\nPlease enter the user's <b>Telegram ID</b> or <b>@username</b>:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  // 7. Users & Referrals Overview & Leaderboard
  bot.action("adm:users", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const allUsers = getAllUsers();
    const totalCount = allUsers.length;
    const totalRef = allUsers.reduce((acc, u) => acc + (u.referral_count || 0), 0);
    const activatedCount = allUsers.filter((u) => u.is_activated).length;

    const sortedByRef = [...allUsers].sort((a, b) => (b.referral_count || 0) - (a.referral_count || 0));
    const top10 = sortedByRef.slice(0, 10);

    let text =
      `👥 <b>USERS & REFERRALS OVERVIEW</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Total Registered:</b> <b>${totalCount}</b> users\n` +
      `⚡️ <b>Activated ($1 Paid):</b> <b>${activatedCount}</b> users\n` +
      `🔗 <b>Total Referrals:</b> <b>${totalRef}</b> members\n\n` +
      `🏆 <b>TOP 10 REFERRERS LEADERBOARD:</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    if (top10.length === 0) {
      text += `<i>No users registered yet.</i>\n`;
    } else {
      top10.forEach((u, idx) => {
        const name = escapeHtml([u.first_name, u.last_name].filter(Boolean).join(" ") || "User");
        const uname = u.username ? `@${escapeHtml(u.username)}` : `<code>${u.id}</code>`;
        const refs = u.referral_count || 0;
        const bal = money(u.wallet_balance || 0);
        const act = u.is_activated ? "✅ Active" : "⏳ Unverified";
        text += `<b>#${idx + 1}</b> ${name} (${uname})\n` +
                `   └ 👥 <b>${refs} referrals</b> • 💰 ${bal} • ${act}\n`;
      });
    }

    text += `━━━━━━━━━━━━━━━━━━━━\n<i>Tap a user button below or use Search to inspect full user controls.</i>`;

    const userButtons = top10.slice(0, 5).map((u) => [
      Markup.button.callback(`👤 ${u.first_name || u.id} (${u.referral_count || 0} refs)`, `adm_view_user:${u.id}`)
    ]);

    const navButtons = [
      [Markup.button.callback("🔍 Find / Search User", "adm:find_user"), Markup.button.callback("📩 DM Specific User", "adm:dm_user")],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    ];

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([...userButtons, ...navButtons])
    });
  });

  // 8. Individual User Actions
  bot.action(/^adm_view_user:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    await ctx.answerCbQuery();
    const { text: profileText, kb: profileKb } = renderUserProfile(targetUser);
    await ctx.editMessageText(profileText, { parse_mode: "HTML", ...profileKb });
  });

  bot.action(/^adm_user_dm:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    ctx.session.adminAction = { type: "dm_enter_message", targetUserId: targetId };
    await ctx.answerCbQuery();
    const name = [targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ") || "User";
    await ctx.reply(`📩 <b>Send Direct Message to:</b> ${escapeHtml(name)} (<code>${targetId}</code>)\n\nType your message below:\n\n<i>Type /cancel to cancel.</i>`, {
      parse_mode: "HTML"
    });
  });

  bot.action(/^adm_user_adj:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    ctx.session.adminAction = { type: "adjust_balance", targetUserId: targetId };
    await ctx.answerCbQuery();
    await ctx.reply(`💰 <b>Adjust Balance for User:</b> <code>${targetId}</code>\nCurrent Balance: <b>${money(targetUser.wallet_balance || 0)}</b>\n\nEnter the amount to add or subtract (e.g. <code>+5</code> or <code>-2.50</code>):\n\n<i>Type /cancel to cancel.</i>`, {
      parse_mode: "HTML"
    });
  });

  // Quick Referrals Adjust (+3, +4, -1)
  bot.action(/^adm_qref:([^:]+):([-\d]+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const delta = parseInt(ctx.match[2], 10);
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    // syncBalance: if delta > 0, also add the referral bonus ($2.50 per referral) to wallet balance
    const syncBalance = delta > 0;
    const result = adjustUserReferrals(targetId, delta, syncBalance);
    if (!result) return ctx.answerCbQuery("Failed to update referrals.", { show_alert: true });

    const updated = getUser(targetId);
    const bonusNotice = syncBalance ? ` (+$${(delta * 2.5).toFixed(2)} USDT bonus added)` : "";
    await ctx.answerCbQuery(`Updated: ${delta >= 0 ? "+" : ""}${delta} referrals${bonusNotice}! Total: ${result.newCount}`, { show_alert: true });

    // Notify user in private chat
    bot.telegram.sendMessage(
      targetId,
      `<blockquote>🎉 <b>REFERRAL STATUS UPDATED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Adjustment:</b> <b>${delta >= 0 ? "+" : ""}${delta} Referrals</b>${bonusNotice}\n` +
      `👥 <b>Total Referrals:</b> <b>${result.newCount} members</b>\n` +
      `👛 <b>Wallet Balance:</b> <b>${money(result.newBalance)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Your referral statistics were updated by Administration.</i></blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    const { text: profileText, kb: profileKb } = renderUserProfile(updated);
    try {
      await ctx.editMessageText(profileText, { parse_mode: "HTML", ...profileKb });
    } catch (e) {}
  });

  // Custom Referrals Adjust Prompt
  bot.action(/^adm_user_adj_ref:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    ctx.session.adminAction = { type: "adjust_referrals", targetUserId: targetId };
    await ctx.answerCbQuery();
    await ctx.reply(
      `👥 <b>Adjust Referrals for User:</b> <code>${targetId}</code>\n` +
      `Current Referrals: <b>${targetUser.referral_count || 0} members</b>\n\n` +
      `👉 <b>Enter the number of referrals to add or remove:</b>\n` +
      `• Examples: <code>+3</code>, <code>+4</code>, <code>-1</code>, or <code>-2</code>\n\n` +
      `<i>(Tip: Adding positive referrals will also automatically credit the referral reward balance).</i>\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_user_toggle_act:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    const newStatus = !targetUser.is_activated;
    setUserActivated(targetId, newStatus);
    await ctx.answerCbQuery(newStatus ? "Account Activated! ✅" : "Account Deactivated! ❌", { show_alert: true });

    const updated = getUser(targetId);
    const { text: profileText, kb: profileKb } = renderUserProfile(updated);
    await ctx.editMessageText(profileText, { parse_mode: "HTML", ...profileKb });
  });

  // 9. Test Group Broadcast Menu & Actions
  bot.action("adm:test_broadcast", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("👥 Test Real Referral Post", "adm_test_ref")],
      [Markup.button.callback("💰 Test Deposit Post (+1.00)", "adm_test_dep")],
      [Markup.button.callback("💸 Test Withdrawal Post ($7.50)", "adm_test_wth")],
      [Markup.button.callback("🎉 Test Milestone Post (3 refs)", "adm_test_mls")],
      [Markup.button.callback("💎 Test Activation Post ($1.00)", "adm_test_act")],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    ]);
    await ctx.answerCbQuery();
    await ctx.editMessageText("🧪 <b>Choose a test post to publish to the Group:</b>\n<i>(Note: Posts go to Group only, not Channel)</i>", {
      parse_mode: "HTML",
      ...kb
    });
  });

  bot.action("adm_test_ref", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const mockRef = { id: ctx.from.id, first_name: ctx.from.first_name || "Morsalen", username: ctx.from.username || "Morsalen0220", referral_count: 1 };
    const mockNew = { id: 5588234368, first_name: "Rashid", username: "Rashid_Telegram" };
    const res = await sendRealReferralNoticeToGroup(mockRef, mockNew);
    await ctx.answerCbQuery(res.success ? "Real referral notice sent to group! 🎉" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_dep", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupDepositNotice(name, 1.00);
    await ctx.answerCbQuery(res.success ? "Deposit notice sent to group! 💰" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_wth", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupWithdrawalNotice(name, 7.50);
    await ctx.answerCbQuery(res.success ? "Withdrawal proof sent to group! 💸" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_mls", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupMilestoneNotice(name, 3, 7.50);
    await ctx.answerCbQuery(res.success ? "Milestone notice sent to group! 🎉" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_act", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupActivationNotice(name, 1.00);
    await ctx.answerCbQuery(res.success ? "Activation notice sent to group! 💎" : `Failed: ${res.error}`, { show_alert: true });
  });

  // 10. Promo & Share Posts for Admin
  bot.action("adm:promos", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showAdminPromoPosts(bot, ctx, 1);
  });

  bot.action(/^adm_promo:(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showAdminPromoPosts(bot, ctx, Number(ctx.match[1]));
  });
}

// Promotional & Share Posts Generator (Admin Only)
async function showAdminPromoPosts(bot, ctx, templateIndex = 1) {
  const botUsername = await getBotUsername(bot);
  const adminId = ADMIN_ID || ctx.from.id;
  const botRefLink = `https://t.me/${botUsername}?start=ref_${adminId}`;

  const templates = [
    {
      title: "1. 🇧🇩 বাংলা ভাইরাল পোস্ট (Super Viral)",
      buttonLabel: "1. বাংলা ভাইরাল",
      text:
`🔥 টেলিগ্রামের সেরা ইনকাম বট! 🔥

🎁 জয়েন করলেই পাচ্ছেন $2.00 USDT ওয়েলকাম বোনাস ফ্রি!
👥 প্রতি ফ্রেন্ডকে রেফার করলেই পাবেন $2.50 USDT করে!
⚡️ কোনো ইনভেস্ট ছাড়াই একদম ফ্রিতে ইনকাম শুরু করুন!
💳 Binance Pay, BEP-20 (BSC) এবং Polygon দিয়ে রিয়েল উইথড্র!

👉 এখনই ফ্রিতে ইনকাম শুরু করতে নিচের লিংকে ক্লিক করুন:
${botRefLink}

🛑 সীমিত সময়ের অফার, দ্রুত জয়েন করুন! 🚀`
    },
    {
      title: "2. 🎁 $2.00 Welcome Bonus Hook (Bangla)",
      buttonLabel: "2. বোনাস অফার",
      text:
`💎 $2.00 USDT Free Sign-Up Bonus! 💎

অনলাইনে ঘরে বসে রিয়েল ইনকামের সেরা সুযোগ!
✅ Instant $2.00 Welcome Bonus
✅ $2.50 USDT per active referral
✅ Fast & Verified automated withdrawals
✅ Binance Pay / USDT Supported

👇 নিচের লিংকে ক্লিক করে জয়েন করে এখনই বোনাস নিন:
${botRefLink}`
    },
    {
      title: "3. 🇬🇧 English: Crypto / Airdrop Hunters (High Converting)",
      buttonLabel: "3. 🇬🇧 Airdrop Promo",
      text:
`🎁 EXCLUSIVE USDT AIRDROP & EARNING EVENT 🎁

🚀 Legit & Verified Telegram Earning Protocol!
💵 Instant $2.00 USDT Welcome Bonus credited upon start!
👥 Earn $2.50 USDT for every active member you invite!
🔒 Zero Investment Needed - 100% Free to join!
⚡️ Automated Payouts via Binance Pay, BEP-20 (BSC) & Polygon!

👇 Start earning USDT right now:
${botRefLink}

⏳ Limited reward pool available - Don't miss out! 🏃‍♂️💨`
    },
    {
      title: "4. 🇬🇧 English: Daily Passive Income Hook ($15-$50 Daily)",
      buttonLabel: "4. 🇬🇧 Daily Earning",
      text:
`💰 EARN $15 - $50 DAILY IN USDT ON TELEGRAM 💰

Looking for an honest online earning opportunity?
✅ Free $2.00 Sign-Up Bonus instantly
✅ $2.50 USDT for each active invite
✅ Instant withdrawal unlocked at just 3 referrals
✅ Verified On-Chain Transactions (Binance Pay & BSC)

👉 Click the link to start today:
${botRefLink}`
    },
    {
      title: "5. 🇬🇧 English: Official Web3 Protocol Announcement",
      buttonLabel: "5. 🇬🇧 Web3 Protocol",
      text:
`🌐 OFFICIAL WEB3 USDT REFERRAL PROTOCOL 🌐

Join our decentralized referral network and start earning real USDT:
💎 Welcome Grant: $2.00 USDT
💎 Direct Referral Commission: $2.50 USDT
💎 Payout Channels: Binance Pay ID | USDT BEP-20 | Polygon
🛡️ Protected by Anti-Sybil Smart Security & Instant Dispatch

🔗 Official Access Link:
${botRefLink}`
    },
    {
      title: "6. 🇬🇧 English: Mobile / Work From Home Community Hook",
      buttonLabel: "6. 🇬🇧 Work From Home",
      text:
`📲 WORK FROM HOME: EARN CRYPTO FROM YOUR PHONE! 📲

No skills or investments required. Just invite friends and get paid:
1️⃣ Start the bot & get $2.00 USDT Free
2️⃣ Share your link & get $2.50 USDT per referral
3️⃣ Withdraw directly to Binance or Trust Wallet!

👇 Get started in seconds:
${botRefLink}`
    },
    {
      title: "7. 🇬🇧 English: Short & Punchy (For Comments, DMs, Twitter/X)",
      buttonLabel: "7. 🇬🇧 Short Promo",
      text:
`🔥 FREE USDT ALERT! Get $2.00 Welcome Bonus + $2.50 for every friend you invite! Automated Binance Pay and BEP-20 withdrawals. Claim yours now:
${botRefLink}`
    },
    {
      title: "8. ⚡️ বাংলা শর্ট মেসেজ (WhatsApp & FB কমেন্টের জন্য)",
      buttonLabel: "8. ⚡️ বাংলা শর্ট",
      text:
`টেলিগ্রাম থেকে ফ্রি ইনকাম করুন! জয়েন করলেই $2.00 ডলার বোনাস আর প্রতি রেফারে $2.50 ডলার। ১০০% রিয়েল পেমেন্ট! জয়েন লিংক:
${botRefLink}`
    }
  ];

  const currentTpl = templates[templateIndex - 1] || templates[0];
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botRefLink)}&text=${encodeURIComponent(currentTpl.text.replace(botRefLink, "").trim())}`;
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(currentTpl.text)}`;

  const text =
    `🚀 <b>PROMOTIONAL & SHARE POSTS (ADMIN ONLY)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>Current Template (${templateIndex}/${templates.length}):</b> <b>${escapeHtml(currentTpl.title)}</b>\n\n` +
    `👇 <b>নিচের বক্সে একবার ট্যাপ/ক্লিক করলেই পুরো পোস্ট ও রেফার লিংক একসাথে কপি হয়ে যাবে:</b>\n\n` +
    `<pre><code>${escapeHtml(currentTpl.text)}</code></pre>\n\n` +
    `💡 <i>কপি করে যেকোনো গ্রুপ, চ্যানেল বা ফোরামে পোস্ট করুন অথবা নিচের বাটন দিয়ে সরাসরি শেয়ার করুন:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.url("🚀 Telegram Groups / Channels", shareUrl),
      Markup.button.url("💬 WhatsApp Share", whatsappUrl)
    ],
    [
      Markup.button.callback(templateIndex === 1 ? `🔘 ${templates[0].buttonLabel}` : templates[0].buttonLabel, "adm_promo:1"),
      Markup.button.callback(templateIndex === 2 ? `🔘 ${templates[1].buttonLabel}` : templates[1].buttonLabel, "adm_promo:2")
    ],
    [
      Markup.button.callback(templateIndex === 3 ? `🔘 ${templates[2].buttonLabel}` : templates[2].buttonLabel, "adm_promo:3"),
      Markup.button.callback(templateIndex === 4 ? `🔘 ${templates[3].buttonLabel}` : templates[3].buttonLabel, "adm_promo:4")
    ],
    [
      Markup.button.callback(templateIndex === 5 ? `🔘 ${templates[4].buttonLabel}` : templates[4].buttonLabel, "adm_promo:5"),
      Markup.button.callback(templateIndex === 6 ? `🔘 ${templates[5].buttonLabel}` : templates[5].buttonLabel, "adm_promo:6")
    ],
    [
      Markup.button.callback(templateIndex === 7 ? `🔘 ${templates[6].buttonLabel}` : templates[6].buttonLabel, "adm_promo:7"),
      Markup.button.callback(templateIndex === 8 ? `🔘 ${templates[7].buttonLabel}` : templates[7].buttonLabel, "adm_promo:8")
    ],
    [
      Markup.button.callback("🔙 Back to Dashboard", "adm:menu")
    ]
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

// Handler for admin text inputs (broadcasts, settings changes, user searching, DMs)
async function handleAdminTextInput(bot, ctx, text) {
  if (!isAdmin(ctx) || !ctx.session?.adminAction) return false;

  const action = ctx.session.adminAction;
  ctx.session.adminAction = null;

  if (action.type === "set_setting") {
    let cleanVal = text.trim();

    if (action.key === "referrals_required") {
      const num = parseInt(cleanVal.replace(/[^0-9]/g, ""), 10);
      cleanVal = isNaN(num) || num < 1 ? 3 : num;
    } else if ([
      "referral_reward_amount",
      "welcome_bonus_amount",
      "min_withdraw",
      "activation_deposit_amount"
    ].includes(action.key)) {
      const num = parseFloat(cleanVal.replace(/[^0-9.]/g, ""));
      cleanVal = isNaN(num) || num < 0 ? 0 : Number(num.toFixed(2));
    }

    setSetting(action.key, cleanVal);
    await ctx.reply(
      `✅ <b>Setting Updated Successfully!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚙️ <b>Field:</b> <code>${action.key}</code>\n` +
      `📝 <b>New Value:</b> <b>${escapeHtml(String(cleanVal))}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("⚙️ Back to Settings", "adm:settings")]])
      }
    );
    return true;
  }

  if (action.type === "broadcast") {
    const users = getAllUsers();
    let sent = 0;
    await ctx.reply(`📢 Sending broadcast to ${users.length} users...`);
    for (const u of users) {
      try {
        await bot.telegram.sendMessage(u.id, text, { parse_mode: "HTML" });
        sent++;
        await new Promise((r) => setTimeout(r, 40));
      } catch (e) {}
    }
    await ctx.reply(`✅ Broadcast sent to ${sent}/${users.length} users.`);
    return true;
  }

  if (action.type === "reject_deposit") {
    try {
      const dep = rejectDeposit(action.depositId, text);
      bot.telegram.sendMessage(
        dep.user_id,
        `❌ <b>Deposit Rejected</b>\nReason: ${escapeHtml(text)}\nPlease contact Support if you believe this is an error.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      await ctx.reply(`❌ Deposit <code>${dep.id}</code> rejected.`);
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
    return true;
  }

  if (action.type === "reject_withdraw") {
    try {
      const { withdrawal } = rejectWithdrawal(action.withdrawId, text);
      bot.telegram.sendMessage(
        withdrawal.user_id,
        `⚠️ <b>Withdrawal Rejected</b>\nAmount: ${money(withdrawal.amount)}\nReason: ${escapeHtml(text)}\n\nYour balance has been refunded to your wallet.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      await ctx.reply(`❌ Withdrawal <code>${withdrawal.id}</code> rejected and balance refunded.`);
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
    return true;
  }

  if (action.type === "find_user") {
    const q = text.trim().replace(/^@/, "").toLowerCase();
    const users = getAllUsers();
    const target = users.find((u) => String(u.id) === q || (u.username && u.username.toLowerCase() === q));
    if (!target) {
      await ctx.reply(`❌ No user found matching: <code>${escapeHtml(text)}</code>`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("👥 View Users List", "adm:users")],
          [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
        ])
      });
      return true;
    }
    const { text: profileText, kb: profileKb } = renderUserProfile(target);
    await ctx.reply(profileText, { parse_mode: "HTML", ...profileKb });
    return true;
  }

  if (action.type === "dm_enter_user_id") {
    const targetId = text.trim();
    const targetUser = getUser(targetId);
    if (!targetUser) {
      await ctx.reply(`❌ No user found with ID: <code>${escapeHtml(targetId)}</code>.\nMake sure the user has started the bot at least once.`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
      });
      return true;
    }
    ctx.session.adminAction = { type: "dm_enter_message", targetUserId: targetId };
    const name = [targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ") || "Community Member";
    await ctx.reply(`👤 <b>Recipient Selected:</b> ${escapeHtml(name)} (<code>${targetId}</code>)\n\nNow send the <b>message text</b> you want to deliver to this user:\n\n<i>Type /cancel to cancel.</i>`, {
      parse_mode: "HTML"
    });
    return true;
  }

  if (action.type === "dm_enter_message") {
    const targetId = action.targetUserId;
    const targetUser = getUser(targetId);
    const name = targetUser ? ([targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ") || "User") : "User";
    try {
      await bot.telegram.sendMessage(
        targetId,
        `<blockquote>📩 <b>MESSAGE FROM ADMIN SUPPORT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${escapeHtml(text)}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Tap the button below to reply directly to Admin Support.</i></blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("💬 Reply to Admin", "user_reply_admin")]])
        }
      );
      await ctx.reply(`✅ <b>Message delivered successfully</b> to ${escapeHtml(name)} (<code>${targetId}</code>).`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
      });
    } catch (err) {
      await ctx.reply(`❌ <b>Failed to deliver message:</b> ${escapeHtml(err.message)}`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
      });
    }
    return true;
  }

  if (action.type === "adjust_balance") {
    const targetId = action.targetUserId;
    const cleanNum = text.replace("+", "").trim();
    const delta = parseFloat(cleanNum);
    if (isNaN(delta)) {
      await ctx.reply("❌ Invalid number. Please enter an amount like <code>+5.00</code> or <code>-2.00</code>.", {
        parse_mode: "HTML"
      });
      return true;
    }
    const newBal = adjustUserBalance(targetId, delta);
    if (newBal === false) {
      await ctx.reply(`❌ User <code>${targetId}</code> not found.`);
      return true;
    }

    // Notify user
    bot.telegram.sendMessage(
      targetId,
      `<blockquote>💰 <b>WALLET BALANCE ADJUSTMENT</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Adjustment:</b> <b>${delta >= 0 ? "+" : ""}${money(delta)}</b>\n` +
      `👛 <b>New Balance:</b> <b>${money(newBal)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Your wallet balance was updated by Administration.</i></blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    await ctx.reply(`✅ <b>Balance updated for user <code>${targetId}</code>!</b>\nNew Balance: <b>${money(newBal)}</b>`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("👤 View User Profile", `adm_view_user:${targetId}`)],
        [Markup.button.callback("🔙 Dashboard", "adm:menu")]
      ])
    });
    return true;
  }

  if (action.type === "adjust_referrals") {
    const targetId = action.targetUserId;
    const cleanNum = text.replace("+", "").trim();
    const delta = parseInt(cleanNum, 10);
    if (isNaN(delta) || delta === 0) {
      await ctx.reply("❌ Invalid number. Please enter a number like <code>+3</code>, <code>+4</code>, or <code>-1</code>.", {
        parse_mode: "HTML"
      });
      return true;
    }

    const syncBalance = delta > 0;
    const result = adjustUserReferrals(targetId, delta, syncBalance);
    if (!result) {
      await ctx.reply(`❌ User <code>${targetId}</code> not found.`);
      return true;
    }

    const bonusNotice = syncBalance ? ` (+$${(delta * 2.5).toFixed(2)} USDT bonus added)` : "";

    // Notify user
    bot.telegram.sendMessage(
      targetId,
      `<blockquote>👥 <b>REFERRAL STATUS UPDATED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Adjustment:</b> <b>${delta >= 0 ? "+" : ""}${delta} Referrals</b>${bonusNotice}\n` +
      `👥 <b>New Total:</b> <b>${result.newCount} members</b>\n` +
      `👛 <b>Wallet Balance:</b> <b>${money(result.newBalance)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Your referral statistics were updated by Administration.</i></blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    await ctx.reply(
      `✅ <b>Referrals updated for user <code>${targetId}</code>!</b>\n` +
      `• Adjustment: <b>${delta >= 0 ? "+" : ""}${delta}</b>${bonusNotice}\n` +
      `• New Referral Count: <b>${result.newCount} members</b>\n` +
      `• New Balance: <b>${money(result.newBalance)}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("👤 View User Profile", `adm_view_user:${targetId}`)],
          [Markup.button.callback("🔙 Dashboard", "adm:menu")]
        ])
      }
    );
    return true;
  }

  return false;
}

module.exports = {
  showAdminDashboard,
  registerAdminHandlers,
  handleAdminTextInput
};

