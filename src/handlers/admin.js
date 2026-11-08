const { Markup } = require("telegraf");
const {
  getSetting,
  getAllSettings,
  setSetting,
  getUser,
  adjustUserBalance,
  adjustUserReferrals,
  getAllUsers,
  getAllProducts,
  getProduct,
  getUnitPrice,
  updateProduct,
  addProductStockItems,
  getDeposit,
  approveDeposit,
  rejectDeposit,
  getPendingDeposits,
  getAllDeposits,
  getOrder,
  getPendingOrders,
  getAllOrders,
  fulfillOrder,
  refundOrder
} = require("../store");

const { getRandomCustomerName } = require("../names");
const {
  money,
  escapeHtml,
  adminOnly,
  isAdmin,
  extractTelegramUsername,
  getChatTargetCandidates,
  renderUserProfile,
  getBotUsername
} = require("../helpers");

const {
  sendGroupDepositNotice,
  sendGroupOrderNotice,
  sendGroupRestockNotice
} = require("../broadcaster");

async function showAdminDashboard(ctx) {
  const users = getAllUsers();
  const deposits = getAllDeposits();
  const orders = getAllOrders();
  const products = getAllProducts();

  const totalUsers = users.length;
  const pendingDeps = deposits.filter((d) => d.status === "pending").length;
  const pendingOrds = orders.filter((o) => o.status === "processing").length;
  const totalOrders = orders.length;
  const totalRevenue = orders
    .filter((o) => o.status !== "refunded")
    .reduce((acc, o) => acc + Number(o.total_price || 0), 0);
  const inStockProducts = products.filter((p) => !p.outOfStock && (p.stock || 0) > 0).length;

  const text =
    `👑 <b>STORE ADMINISTRATOR PANEL</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 <b>Total Registered Users:</b> <b>${totalUsers}</b>\n` +
    `📦 <b>Active Products in Stock:</b> <b>${inStockProducts} / ${products.length}</b>\n` +
    `🛒 <b>Total Orders Placed:</b> <b>${totalOrders}</b>\n` +
    `⏳ <b>Orders Awaiting Dispatch:</b> <b>${pendingOrds}</b>\n` +
    `📥 <b>Pending Wallet Deposits:</b> <b>${pendingDeps}</b>\n` +
    `💰 <b>Total Store Sales:</b> <b>${money(totalRevenue)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Select an action below:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(`📦 Products & Stock (${products.length})`, "adm:products"),
      Markup.button.callback(`🛒 Orders (${pendingOrds} Pending)`, "adm:orders")
    ],
    [
      Markup.button.callback(`📥 Pending Deposits (${pendingDeps})`, "adm:deposits"),
      Markup.button.callback("👥 Buyers & Users", "adm:users")
    ],
    [
      Markup.button.callback("🔍 Find User", "adm:find_user"),
      Markup.button.callback("📩 Direct Message (User)", "adm:dm_user")
    ],
    [
      Markup.button.callback("📢 Broadcast (All)", "adm:broadcast"),
      Markup.button.callback("⚙️ Store Settings", "adm:settings")
    ],
    [
      Markup.button.callback("🧪 Test Group Broadcast", "adm:test_broadcast"),
      Markup.button.callback("🚀 Promo", "adm:promos")
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
  bot.command("admin", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await showAdminDashboard(ctx);
  });

  bot.action("adm:menu", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showAdminDashboard(ctx);
  });

  // =====================================================
  // 1. MANAGE PRODUCTS & STOCK
  // =====================================================
  bot.action("adm:products", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const products = getAllProducts();

    const buttons = products.map((p) => {
      const icon = p.outOfStock || (p.stock || 0) <= 0 ? "🔴" : "🟢";
      return [
        Markup.button.callback(
          `${icon} ${p.name.slice(0, 26)} ($${Number(p.price).toFixed(0)} • ${p.stock || 0})`,
          `adm_prod:${p.id}`
        )
      ];
    });
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `📦 <b>MANAGE PRODUCTS &amp; INVENTORY (${products.length}):</b>\n` +
      `<i>Tap any product below to edit price, update stock count, or preload credentials/keys:</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    );
  });

  bot.action(/^adm_prod:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const p = getProduct(ctx.match[1]);
    if (!p) return ctx.answerCbQuery("Product not found.", { show_alert: true });

    const inStock = !p.outOfStock && (p.stock || 0) > 0;
    const text =
      `📦 <b>PRODUCT MANAGEMENT</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ <b>Name:</b> <b>${escapeHtml(p.name)}</b>\n` +
      `🆔 <b>ID:</b> <code>${p.id}</code>\n` +
      `📂 <b>Category:</b> <code>${p.category}</code>\n` +
      `💵 <b>Unit Price:</b> <b>${money(p.price)}</b>\n` +
      `📊 <b>Stock Count:</b> <b>${p.stock || 0} units</b> (${inStock ? "🟢 In Stock" : "🔴 Out of Stock"})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 <b>Description:</b>\n${escapeHtml(p.description || "")}`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback("💵 Edit Price", `adm_p_price:${p.id}`),
        Markup.button.callback("📊 Set Stock Count", `adm_p_stock:${p.id}`)
      ],
      [
        Markup.button.callback("🔑 Add Preloaded Keys/Accounts", `adm_p_keys:${p.id}`),
        Markup.button.callback(inStock ? "🔴 Mark Out of Stock" : "🟢 Mark In Stock (+25)", `adm_p_toggle:${p.id}`)
      ],
      [Markup.button.callback("🔙 Back to Products", "adm:products")]
    ]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
  });

  bot.action(/^adm_p_price:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const p = getProduct(ctx.match[1]);
    if (!p) return ctx.answerCbQuery("Not found");
    ctx.session.adminAction = { type: "edit_product_price", productId: p.id };
    await ctx.answerCbQuery();
    await ctx.reply(
      `💵 <b>Edit Price for:</b> ${escapeHtml(p.name)}\n` +
      `Current Price: <b>${money(p.price)}</b>\n\n` +
      `Send the new price in USDT (e.g. <code>45</code> or <code>15.50</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_p_stock:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const p = getProduct(ctx.match[1]);
    if (!p) return ctx.answerCbQuery("Not found");
    ctx.session.adminAction = { type: "edit_product_stock", productId: p.id };
    await ctx.answerCbQuery();
    await ctx.reply(
      `📊 <b>Set Stock Count for:</b> ${escapeHtml(p.name)}\n` +
      `Current Stock: <b>${p.stock || 0} units</b>\n\n` +
      `Send the new available stock number (e.g. <code>50</code> or <code>0</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_p_keys:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const p = getProduct(ctx.match[1]);
    if (!p) return ctx.answerCbQuery("Not found");
    ctx.session.adminAction = { type: "add_product_keys", productId: p.id };
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔑 <b>Add Preloaded Accounts / Keys for:</b> ${escapeHtml(p.name)}\n\n` +
      `Send the credentials or API keys below (<b>1 item per line</b>).\n` +
      `When a buyer orders this product, the bot will automatically dispense these lines instantly!\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_p_toggle:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const p = getProduct(ctx.match[1]);
    if (!p) return ctx.answerCbQuery("Not found");

    const inStock = !p.outOfStock && (p.stock || 0) > 0;
    const updated = updateProduct(p.id, {
      stock: inStock ? 0 : 25,
      outOfStock: inStock
    });
    await ctx.answerCbQuery(updated.outOfStock ? "Marked Out of Stock 🔴" : "Marked In Stock (25 units) 🟢");
    return ctx.editMessageText(
      `✅ Updated <b>${escapeHtml(updated.name)}</b> stock to <b>${updated.stock}</b>.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Product", `adm_prod:${p.id}`)]])
      }
    );
  });

  // =====================================================
  // 2. ORDERS MANAGEMENT & FULFILLMENT
  // =====================================================
  bot.action("adm:orders", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const pending = getPendingOrders();
    const all = getAllOrders().slice(-10).reverse();
    const list = pending.length > 0 ? pending : all;

    if (list.length === 0) {
      await ctx.answerCbQuery();
      return ctx.editMessageText("🛒 No orders placed yet.", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
      });
    }

    const buttons = list.slice(0, 10).map((o) => {
      const badge = o.status === "delivered" ? "✅" : o.status === "refunded" ? "❌" : "⏳";
      return [
        Markup.button.callback(
          `${badge} ${o.id} • ${o.product_name.slice(0, 18)} ($${Number(o.total_price).toFixed(0)})`,
          `adm_view_ord:${o.id}`
        )
      ];
    });
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🛒 <b>STORE ORDERS (${pending.length} Awaiting Dispatch / ${all.length} Recent):</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    );
  });

  bot.action(/^adm_view_ord:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const o = getOrder(ctx.match[1]);
    if (!o) return ctx.answerCbQuery("Order not found.", { show_alert: true });

    const text =
      `🛒 <b>ORDER DETAILS: <code>${o.id}</code></b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Buyer ID:</b> <code>${o.user_id}</code> (${escapeHtml(o.user_name || "")})\n` +
      `📦 <b>Product:</b> <b>${escapeHtml(o.product_name)}</b>\n` +
      `🔢 <b>Quantity:</b> <b>${o.quantity}x</b>\n` +
      `💵 <b>Total Paid:</b> <b>${money(o.total_price)}</b>\n` +
      `📊 <b>Status:</b> <b>${o.status.toUpperCase()}</b>\n` +
      `🕒 <b>Date:</b> ${new Date(o.created_at).toLocaleString()}`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("📤 Deliver Credentials / Key", `adm_ord_fulfill:${o.id}`)],
      [Markup.button.callback("❌ Refund Order to Wallet", `adm_ord_refund:${o.id}`)],
      [Markup.button.callback("📩 Message Buyer", `adm_user_dm:${o.user_id}`)],
      [Markup.button.callback("🔙 Back to Orders", "adm:orders")]
    ]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
  });

  bot.action(/^adm_ord_fulfill:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const ordId = ctx.match[1];
    const ord = getOrder(ordId);
    if (!ord) return ctx.answerCbQuery("Order not found.", { show_alert: true });

    ctx.session.adminAction = { type: "fulfill_order", orderId: ord.id };
    await ctx.answerCbQuery();
    await ctx.reply(
      `📤 <b>Deliver Credentials for Order <code>${ord.id}</code></b>\n` +
      `Product: <b>${escapeHtml(ord.product_name)} (${ord.quantity}x)</b>\n\n` +
      `Reply with the account credentials, JSON key, or API key to send directly to the buyer:\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_ord_refund:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const ordId = ctx.match[1];
    try {
      const { order, user } = refundOrder(ordId, "Order refunded to wallet by Admin");
      await ctx.answerCbQuery("Order refunded!");
      await ctx.editMessageText(
        `✅ <b>Order <code>${order.id}</code> Refunded!</b>\n` +
        `Credited <b>${money(order.total_price)}</b> back to user <code>${order.user_id}</code>.`,
        { parse_mode: "HTML" }
      );

      bot.telegram.sendMessage(
        order.user_id,
        `💳 <b>ORDER REFUNDED TO WALLET</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Order ID:</b> <code>${order.id}</code>\n` +
        `📦 <b>Product:</b> ${escapeHtml(order.product_name)}\n` +
        `💵 <b>Refunded Amount:</b> <b>+${money(order.total_price)}</b>\n` +
        `👛 <b>New Wallet Balance:</b> <b>${money(user?.wallet_balance || 0)}</b>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    } catch (err) {
      await ctx.answerCbQuery(`Error: ${err.message}`, { show_alert: true });
    }
  });

  // =====================================================
  // 3. PENDING DEPOSITS
  // =====================================================
  bot.action("adm:deposits", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const pending = getPendingDeposits();

    if (pending.length === 0) {
      await ctx.answerCbQuery();
      return ctx.editMessageText("📥 No pending wallet deposits.", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
      });
    }

    const buttons = pending.slice(0, 10).map((d) => [
      Markup.button.callback(`${d.id} • ${money(d.amount)} (${d.method})`, `adm_view_dep:${d.id}`)
    ]);
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`📥 <b>Pending Wallet Deposits (${pending.length}):</b>`, {
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
      [Markup.button.callback(`✅ Approve & Credit ${money(dep.amount)}`, `adm_dep_app:${dep.id}`)],
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
      await ctx.answerCbQuery("Deposit approved & credited!");
      await ctx.editMessageText(
        `✅ <b>Deposit <code>${depId}</code> Approved!</b>\n` +
        `User: <code>${deposit.user_id}</code>\n` +
        `Credited: <b>+${money(deposit.amount)}</b>\n` +
        `New Wallet Balance: <b>${money(user?.wallet_balance || 0)}</b>`,
        { parse_mode: "HTML" }
      );

      bot.telegram.sendMessage(
        deposit.user_id,
        `🎉 <b>WALLET DEPOSIT CONFIRMED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount Credited:</b> <b>+${money(deposit.amount)}</b>\n` +
        `👛 <b>Available Balance:</b> <b>${money(user?.wallet_balance || 0)}</b>\n\n` +
        `👇 <i>Tap below to browse our catalog and place your order:</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍️ Browse Store & Buy Now", "menu_store")]])
        }
      ).catch(() => {});

      const settings = getAllSettings();
      if (settings.group_id || settings.group_link) {
        sendGroupDepositNotice(user?.first_name || "Verified Buyer", deposit.amount).catch(() => {});
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

  // =====================================================
  // 4. SETTINGS
  // =====================================================
  async function showAdminSettings(ctx) {
    const s = getAllSettings();
    const bpayEnabled = s.binance_pay_enabled !== false;

    const text =
      `⚙️ <b>STORE SETTINGS PANEL</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ <b>Store Title:</b> ${escapeHtml(s.bot_title || "Cloud & AI Resource Store")}\n` +
      `🟡 <b>Binance Pay Deposit:</b> ${bpayEnabled ? "✅ ON (Enabled)" : "❌ OFF (Hidden)"}\n` +
      `🆔 <b>Binance Pay ID:</b> <code>${s.binance_pay_id || "None"}</code>\n` +
      `🟢 <b>BEP20 USDT Address:</b> <code>${s.bep20_usdt_address?.slice(0, 12)}...</code>\n` +
      `🟣 <b>Polygon USDT Address:</b> <code>${s.polygon_usdt_address?.slice(0, 12)}...</code>\n` +
      `⚪️ <b>Litecoin (LTC) Address:</b> <code>${(s.ltc_address || "ltc1q...").slice(0, 14)}...</code>\n` +
      `📢 <b>Channel ID:</b> <code>${escapeHtml(s.channel_id || "Not Set")}</code>\n` +
      `📢 <b>Channel Link:</b> <a href="${escapeHtml(s.channel_link || "https://t.me/")}">${escapeHtml(s.channel_link_text || "Join Official Channel")}</a>\n` +
      `👥 <b>Group ID:</b> <code>${escapeHtml(s.group_id || "Not Set")}</code>\n` +
      `👥 <b>Group Link:</b> <a href="${escapeHtml(s.group_link || "https://t.me/")}">${escapeHtml(s.group_link_text || "Join Community Group")}</a>\n` +
      `📞 <b>Support Admin:</b> ${escapeHtml(s.support_username || "@Morsalen0220")}\n` +
      `🔒 <b>Force Join:</b> ${s.force_join_enabled ? "✅ ON" : "❌ OFF"}\n` +
      `📢 <b>Group Auto-Poster:</b> ${s.auto_broadcast_enabled !== false ? "✅ ON" : "❌ OFF"}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Tap any button below to update setting:</i>`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          bpayEnabled ? "🟡 Binance Pay: ON (Tap to OFF)" : "🟡 Binance Pay: OFF (Tap to ON)",
          "adm_toggle_bpay"
        )
      ],
      [
        Markup.button.callback("🟡 Binance Pay ID", "adm_set:binance_pay_id"),
        Markup.button.callback("⚪️ LTC Address", "adm_set:ltc_address")
      ],
      [
        Markup.button.callback("🟢 BEP20 USDT", "adm_set:bep20_usdt_address"),
        Markup.button.callback("🟣 Polygon USDT", "adm_set:polygon_usdt_address")
      ],
      [
        Markup.button.callback("🏷️ Store Title", "adm_set:bot_title"),
        Markup.button.callback("📞 Support Handle", "adm_set:support_username")
      ],
      [
        Markup.button.callback("📢 Channel ID", "adm_set:channel_id"),
        Markup.button.callback("👥 Group ID", "adm_set:group_id")
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

    const extra = {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
      ...kb
    };

    if (ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(text, extra);
      } catch (e) {
        return await ctx.reply(text, extra);
      }
    }
    return await ctx.reply(text, extra);
  }

  bot.action("adm:settings", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    return showAdminSettings(ctx);
  });

  bot.action("adm_toggle_bpay", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const current = getSetting("binance_pay_enabled") !== false;
    setSetting("binance_pay_enabled", !current);
    await ctx.answerCbQuery(`Binance Pay Deposit is now ${!current ? "ON ✅" : "OFF ❌"}`);
    return showAdminSettings(ctx);
  });

  bot.action(/^adm_set:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const key = ctx.match[1];
    ctx.session.adminAction = { type: "set_setting", key };
    await ctx.answerCbQuery();

    if (key === "group_link" || key === "channel_link") {
      const label = key === "group_link" ? "Group" : "Channel";
      const defaultText = key === "group_link" ? "Join Community Group" : "Join Official Channel";
      return await ctx.reply(
        `✏️ <b>Update ${label} Hyperlink:</b>\n\n` +
        `• <b>শুধু লিংক দিলে:</b> <code>https://t.me/YourLink</code> (অটোমেটিক <b>"${defaultText}"</b> লেখার ভেতর লিংক লুকানো থাকবে)\n` +
        `• <b>কাস্টম লেখাসহ হাইপারলিংক দিতে চাইলে:</b>\n` +
        `<code>Click Here | https://t.me/YourLink</code>\n` +
        `অথবা <code>[Click Here](https://t.me/YourLink)</code>\n\n` +
        `<i>Type /cancel to cancel.</i>`,
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    }

    await ctx.reply(`✏️ <b>Enter new value for <code>${key}</code>:</b>\n\n<i>Type /cancel to cancel.</i>`, { parse_mode: "HTML" });
  });

  bot.action("adm_toggle_fj", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const current = Boolean(getSetting("force_join_enabled"));
    setSetting("force_join_enabled", !current);
    await ctx.answerCbQuery(`Force Join is now ${!current ? "ENABLED" : "DISABLED"}`);
    return showAdminSettings(ctx);
  });

  bot.action("adm_toggle_bc", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const current = getSetting("auto_broadcast_enabled") !== false;
    setSetting("auto_broadcast_enabled", !current);
    await ctx.answerCbQuery(`Auto Broadcaster is now ${!current ? "ENABLED" : "DISABLED"}`);
    return showAdminSettings(ctx);
  });

  // =====================================================
  // 5. USERS, SEARCH & BROADCAST
  // =====================================================
  bot.action("adm:broadcast", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "broadcast" };
    await ctx.answerCbQuery();
    await ctx.reply("📢 <b>Broadcast to All Users</b>\n\nSend the announcement message to broadcast to all users:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  bot.action("adm:dm_user", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "dm_enter_user_id" };
    await ctx.answerCbQuery();
    await ctx.reply("📩 <b>Direct Message User</b>\n\nEnter the recipient's numeric <b>Telegram User ID</b>:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  bot.action("adm:find_user", async (ctx) => {
    if (!adminOnly(ctx)) return;
    ctx.session.adminAction = { type: "find_user" };
    await ctx.answerCbQuery();
    await ctx.reply("🔍 <b>Find &amp; Manage User</b>\n\nEnter the user's <b>Telegram ID</b> or <b>@username</b>:\n\n<i>Type /cancel to cancel.</i>", {
      parse_mode: "HTML"
    });
  });

  bot.action("adm:users", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const allUsers = getAllUsers();
    const sorted = [...allUsers].sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
    const top10 = sorted.slice(0, 10);

    let text =
      `👥 <b>BUYERS &amp; USERS OVERVIEW</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Total Users:</b> <b>${allUsers.length}</b>\n\n` +
      `🏆 <b>TOP BUYERS:</b>\n`;

    if (top10.length === 0) {
      text += `<i>No users registered yet.</i>\n`;
    } else {
      top10.forEach((u, idx) => {
        const name = escapeHtml([u.first_name, u.last_name].filter(Boolean).join(" ") || "User");
        const uname = u.username ? `@${escapeHtml(u.username)}` : `<code>${u.id}</code>`;
        text += `<b>#${idx + 1}</b> ${name} (${uname}) — 👛 ${money(u.wallet_balance || 0)} • 🛒 Spent: ${money(u.total_spent || 0)}\n`;
      });
    }

    const userButtons = top10.slice(0, 5).map((u) => [
      Markup.button.callback(`👤 ${u.first_name || u.id} (Bal: $${Number(u.wallet_balance || 0).toFixed(2)})`, `adm_view_user:${u.id}`)
    ]);

    userButtons.push(
      [Markup.button.callback("🔍 Search User", "adm:find_user"), Markup.button.callback("📩 DM User", "adm:dm_user")],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    );

    await ctx.answerCbQuery();
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(userButtons)
    });
  });

  bot.action(/^adm_view_user:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetUser = getUser(ctx.match[1]);
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
    await ctx.reply(
      `💰 <b>Adjust Balance for User:</b> <code>${targetId}</code>\n` +
      `Current Balance: <b>${money(targetUser.wallet_balance || 0)}</b>\n\n` +
      `Enter amount to add or subtract (e.g. <code>+45</code> or <code>-15</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^adm_qref:([^:]+):(-?\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const delta = parseInt(ctx.match[2], 10);
    const newRefCount = adjustUserReferrals(targetId, delta);
    if (newRefCount === false) {
      return ctx.answerCbQuery("User not found.", { show_alert: true });
    }
    await ctx.answerCbQuery(`✅ Referrals updated: ${newRefCount}`);
    const updatedUser = getUser(targetId);
    const { text: profileText, kb: profileKb } = renderUserProfile(updatedUser);
    try {
      await ctx.editMessageText(profileText, { parse_mode: "HTML", ...profileKb });
    } catch (e) {}
  });

  bot.action(/^adm_user_adj_ref:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const targetId = ctx.match[1];
    const targetUser = getUser(targetId);
    if (!targetUser) return ctx.answerCbQuery("User not found.", { show_alert: true });

    ctx.session.adminAction = { type: "adjust_referrals", targetUserId: targetId };
    await ctx.answerCbQuery();
    await ctx.reply(
      `👥 <b>Adjust Referrals for User:</b> <code>${targetId}</code>\n` +
      `Current Referrals: <b>${targetUser.referral_count || 0}</b>\n\n` +
      `Enter number of referrals to add or subtract (e.g. <code>+30</code> or <code>-5</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // =====================================================
  // 6. TEST GROUP BROADCAST & PROMO POSTS
  // =====================================================
  bot.action("adm:test_broadcast", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🛍️ Test Order Delivered (Claude Max 20x)", "adm_test_ord")],
      [Markup.button.callback("☁️ Test Order Delivered (GCP $300 USA)", "adm_test_gcp")],
      [Markup.button.callback("💰 Test Wallet Deposit (+$55.00)", "adm_test_dep")],
      [Markup.button.callback("🔥 Test Stock Restock (AWS 5v 50RPM)", "adm_test_rst")],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    ]);
    await ctx.answerCbQuery();
    await ctx.editMessageText("🧪 <b>Choose a test proof post to publish to the Group:</b>", {
      parse_mode: "HTML",
      ...kb
    });
  });

  bot.action("adm_test_ord", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupOrderNotice(name, "Claude Max 20x (Finished Account)", 1, 45.00);
    await ctx.answerCbQuery(res.success ? "Order proof sent to group! 🛍️" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_gcp", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupOrderNotice(name, "Google Cloud GCP $300 (USA Region)", 2, 30.00);
    await ctx.answerCbQuery(res.success ? "GCP $300 order proof sent to group! ☁️" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_dep", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const name = getRandomCustomerName();
    const res = await sendGroupDepositNotice(name, 55.00);
    await ctx.answerCbQuery(res.success ? "Deposit notice sent to group! 💰" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.action("adm_test_rst", async (ctx) => {
    if (!adminOnly(ctx)) return;
    const res = await sendGroupRestockNotice("AWS Cloud 5vCPU (50 RPM High-Speed)", 30, 32.00);
    await ctx.answerCbQuery(res.success ? "Restock alert sent to group! 🔥" : `Failed: ${res.error}`, { show_alert: true });
  });

  bot.command("promo", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await showPromoCatalogMenu(ctx);
  });

  bot.action("adm:promos", async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showPromoCatalogMenu(ctx);
  });

  bot.action(/^adm_promo_view:([^:]+):(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showPromoTemplateView(bot, ctx, ctx.match[1], Number(ctx.match[2]));
  });

  bot.action(/^adm_promo_send:(grp|chn):([^:]+):(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const dest = ctx.match[1]; // 'grp' | 'chn'
    const targetId = ctx.match[2];
    const postNum = Number(ctx.match[3]);

    const settings = getAllSettings();
    const candidates =
      dest === "grp"
        ? getChatTargetCandidates(settings.group_id, settings.group_link)
        : getChatTargetCandidates(settings.channel_id, settings.channel_link);

    if (candidates.length === 0) {
      return ctx.answerCbQuery(`❌ No ${dest === "grp" ? "Group" : "Channel"} ID or link configured in settings!`, {
        show_alert: true
      });
    }

    const botUsername = await getBotUsername(bot);
    const storeLink = `https://t.me/${botUsername}`;
    const templates = buildPromoTemplates(targetId, storeLink, settings);
    const chosen = templates[postNum - 1] || templates[0];

    let lastErr = "Unknown error";
    for (const chatTarget of candidates) {
      try {
        const res = await bot.telegram.sendMessage(chatTarget, chosen.htmlText, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([[Markup.button.url("🛒 Buy Instantly in Bot", storeLink)]])
        });
        if (res?.chat?.id) {
          setSetting(dest === "grp" ? "group_id" : "channel_id", String(res.chat.id));
        }
        return await ctx.answerCbQuery(`✅ Promo Post #${postNum} published to ${dest === "grp" ? "Group" : "Channel"}!`, {
          show_alert: true
        });
      } catch (err) {
        lastErr = err.message || String(err);
      }
    }

    await ctx.answerCbQuery(`❌ Failed to post: ${lastErr}`, { show_alert: true });
  });

  // Quick command in any Group or Channel to bind it as the active Group/Channel
  bot.command("setgroup", async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
      setSetting("group_id", String(ctx.chat.id));
      if (ctx.chat.username) {
        setSetting("group_link", `https://t.me/${ctx.chat.username}`);
      }
      await ctx.reply(`✅ Group connected! Active <code>group_id</code> set to <code>${ctx.chat.id}</code>.`, {
        parse_mode: "HTML"
      });
    }
  });

  // Automatically detect when bot is added to a Group or Channel and save its Chat ID
  bot.on("my_chat_member", async (ctx) => {
    try {
      const chat = ctx.myChatMember?.chat;
      const newStatus = ctx.myChatMember?.new_chat_member?.status;
      if (!chat || !["member", "administrator"].includes(newStatus)) return;

      if (chat.type === "group" || chat.type === "supergroup") {
        setSetting("group_id", String(chat.id));
        if (chat.username) {
          setSetting("group_link", `https://t.me/${chat.username}`);
        }
        console.log(`✅ Auto-connected Group: ${chat.title} (${chat.id})`);
      } else if (chat.type === "channel") {
        setSetting("channel_id", String(chat.id));
        if (chat.username) {
          setSetting("channel_link", `https://t.me/${chat.username}`);
        }
        console.log(`✅ Auto-connected Channel: ${chat.title} (${chat.id})`);
      }
    } catch (e) {}
  });
}

// =====================================================
// PROMO GENERATOR (2 POSTS FOR ALL PRODUCTS + 2 POSTS PER PRODUCT)
// =====================================================
async function showPromoCatalogMenu(ctx) {
  const products = getAllProducts();

  const text =
    `🚀 <b>PROMO POSTS MANAGER (ADMIN)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• <b>🌟 All Products Promo:</b> 2 Ready Full-Catalog Posts\n` +
    `• <b>📦 Individual Products (${products.length}):</b> 2 Ready Posts for Every Product (based on live price &amp; bulk rate)\n\n` +
    `👇 <i>Select <b>All Products Promo</b> or any product below to view, copy, or 1-click post to Group/Channel:</i>`;

  const rows = [
    [Markup.button.callback("🌟 All Products Promo (2 Ready Posts)", "adm_promo_view:all:1")]
  ];

  products.forEach((p) => {
    rows.push([
      Markup.button.callback(
        `📦 ${p.name.slice(0, 28)} ($${Number(p.price).toFixed(0)}) • 2 Posts`,
        `adm_promo_view:${p.id}:1`
      )
    ]);
  });

  rows.push([Markup.button.callback("🔙 Back to Admin Dashboard", "adm:menu")]);

  const kb = Markup.inlineKeyboard(rows);
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }
  return await ctx.reply(text, { parse_mode: "HTML", ...kb });
}

function buildPromoTemplates(targetId, storeLink, settings) {
  const products = getAllProducts();
  const payMethods = `USDT (BEP-20 / Polygon), Litecoin (LTC)${settings.binance_pay_enabled !== false ? " & Binance Pay" : ""}`;

  if (targetId === "all") {
    const aiProds = products.filter((p) => p.category === "ai_sub");
    const cloudProds = products.filter((p) => p.category === "cloud_acc");
    const keyProds = products.filter((p) => p.category === "api_key");
    const esimProds = products.filter((p) => p.category === "esim_tools");

    const fmtLine = (p) => {
      const bulk = getUnitPrice(p, 5);
      const bulkStr = bulk < p.price ? ` (Bulk 5+: $${bulk.toFixed(2)})` : "";
      return `• ${p.name} — $${Number(p.price).toFixed(2)}${bulkStr}`;
    };

    const post1Plain =
`🔥 OFFICIAL CLOUD & AI RESOURCE STORE — FULL CATALOG 🔥
━━━━━━━━━━━━━━━━━━━━
🤖 AI Max & Pro Subscriptions:
${aiProds.map(fmtLine).join("\n")}

☁️ Cloud Trial & Enterprise Accounts:
${cloudProds.map(fmtLine).join("\n")}

🔑 High-Quota Official API Keys:
${keyProds.map(fmtLine).join("\n")}

📱 Global eSIM & Verification:
${esimProds.map(fmtLine).join("\n")}
━━━━━━━━━━━━━━━━━━━━
💳 Payment: ${payMethods}
⚡️ 24/7 Instant Automated Delivery via Bot:
👉 ${storeLink}`;

    const post2Plain =
`🚀 FLASH WHOLESALE & RETAIL STOCK (大量现货 • 自动发货) 🚀
━━━━━━━━━━━━━━━━━━━━
${products.map((p) => `✅ ${p.name}: $${Number(p.price).toFixed(2)} (Stock: ${p.stock || 0})`).join("\n")}
━━━━━━━━━━━━━━━━━━━━
📦 Bulk 5+ Orders: Automatic Wholesale Discount Applied!
💰 Accepted: ${payMethods}
🛒 Order Instantly 24/7 in Our Automated Bot:
👉 ${storeLink}`;

    return [
      {
        title: "🌟 All Products — Post #1 (Categorized Full Catalog)",
        plainText: post1Plain,
        htmlText: `<blockquote>${escapeHtml(post1Plain)}</blockquote>`
      },
      {
        title: "🌟 All Products — Post #2 (Flash Stock & Wholesale List)",
        plainText: post2Plain,
        htmlText: `<blockquote>${escapeHtml(post2Plain)}</blockquote>`
      }
    ];
  }

  const p = getProduct(targetId) || products[0];
  const unitPrice = Number(p.price || 15);
  const bulkPrice = getUnitPrice(p, 5);
  const hasBulk = bulkPrice < unitPrice;
  const stockCount = Number(p.stock || 0);

  const post1Plain =
`🔥 ${p.name.toUpperCase()} — IN STOCK NOW! 🔥
━━━━━━━━━━━━━━━━━━━━
💵 Retail Price: $${unitPrice.toFixed(2)} USDT${hasBulk ? `\n📦 Bulk Price (5+ Units): $${bulkPrice.toFixed(2)} USDT / each` : ""}
📊 Live Stock Available: ${stockCount} Units Ready 🟢
━━━━━━━━━━━━━━━━━━━━
📝 Product Highlights:
${p.description}

🛡️ Guarantee & Terms:
${p.terms}
━━━━━━━━━━━━━━━━━━━━
💳 Accepted Payments: ${payMethods}
⚡️ 24/7 Instant Automated Delivery via Bot:
👉 ${storeLink}`;

  const post2Plain =
`⚡️ FLASH DEAL & RESTOCK: ${p.name} ⚡️
━━━━━━━━━━━━━━━━━━━━
✅ Verified & Ready for Immediate Dispatch!
💰 Single Unit: $${unitPrice.toFixed(2)} USDT${hasBulk ? ` | Bulk (5+): $${bulkPrice.toFixed(2)} USDT` : ""}
📦 Current Inventory: ${stockCount} Fresh Units

${p.description}

💳 Pay via ${payMethods}
🛒 Grab yours now before stock runs out:
👉 ${storeLink}`;

  return [
    {
      title: `📦 ${p.name} — Post #1 (Detailed Feature Promo)`,
      plainText: post1Plain,
      htmlText: `<blockquote>${escapeHtml(post1Plain)}</blockquote>`
    },
    {
      title: `📦 ${p.name} — Post #2 (Flash Restock & Deal Promo)`,
      plainText: post2Plain,
      htmlText: `<blockquote>${escapeHtml(post2Plain)}</blockquote>`
    }
  ];
}

async function showPromoTemplateView(bot, ctx, targetId = "all", postNumber = 1) {
  const botUsername = await getBotUsername(bot);
  const storeLink = `https://t.me/${botUsername}`;
  const settings = getAllSettings();

  const templates = buildPromoTemplates(targetId, storeLink, settings);
  const idx = postNumber === 2 ? 1 : 0;
  const currentTpl = templates[idx];

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(storeLink)}&text=${encodeURIComponent(currentTpl.plainText.replace(storeLink, "").trim())}`;

  const text =
    `🚀 <b>READY PROMO POST (${idx + 1}/2)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>${escapeHtml(currentTpl.title)}</b>\n\n` +
    `👇 <b>Tap inside the box below to copy the full post:</b>\n\n` +
    `<pre><code>${escapeHtml(currentTpl.plainText)}</code></pre>\n\n` +
    `💡 <i>Use the buttons below to switch between Post #1 &amp; Post #2, or publish directly to your Group/Channel with 1 click:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(idx === 0 ? "🔘 Post #1 (Selected)" : "⚪️ View Post #1", `adm_promo_view:${targetId}:1`),
      Markup.button.callback(idx === 1 ? "🔘 Post #2 (Selected)" : "⚪️ View Post #2", `adm_promo_view:${targetId}:2`)
    ],
    [
      Markup.button.callback("📤 Post to Group Now", `adm_promo_send:grp:${targetId}:${idx + 1}`),
      Markup.button.callback("📢 Post to Channel Now", `adm_promo_send:chn:${targetId}:${idx + 1}`)
    ],
    [
      Markup.button.url("🚀 Share to Any Telegram Chat", shareUrl)
    ],
    [
      Markup.button.callback("🔙 Back to Promo List", "adm:promos"),
      Markup.button.callback("👑 Admin Dashboard", "adm:menu")
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

async function handleAdminTextInput(bot, ctx, text) {
  if (!isAdmin(ctx) || !ctx.session?.adminAction) return false;

  const action = ctx.session.adminAction;
  ctx.session.adminAction = null;

  if (action.type === "set_setting") {
    let cleanVal = text.trim();
    let customLabel = null;

    if (action.key === "group_link" || action.key === "channel_link") {
      // Support [Label](https://t.me/...) format
      const mdMatch = cleanVal.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      // Support <a href="https://t.me/...">Label</a> format
      const htmlMatch = cleanVal.match(/^<a\s+href=["']([^"']+)["'][^>]*>([\s\S]+?)<\/a>$/i);
      // Support "Label | https://t.me/..." format
      const pipeParts = cleanVal.includes("|") ? cleanVal.split("|").map((s) => s.trim()) : null;

      if (mdMatch) {
        customLabel = mdMatch[1].trim();
        cleanVal = mdMatch[2].trim();
      } else if (htmlMatch) {
        cleanVal = htmlMatch[1].trim();
        customLabel = htmlMatch[2].trim();
      } else if (pipeParts && pipeParts.length >= 2 && pipeParts[0] && pipeParts[1]) {
        customLabel = pipeParts[0];
        cleanVal = pipeParts.slice(1).join("|").trim();
      }

      if (cleanVal.startsWith("@")) {
        cleanVal = `https://t.me/${cleanVal.slice(1)}`;
      } else if (/^[a-zA-Z0-9_]{4,64}$/.test(cleanVal)) {
        cleanVal = `https://t.me/${cleanVal}`;
      }

      if (customLabel) {
        setSetting(action.key === "group_link" ? "group_link_text" : "channel_link_text", customLabel);
      }

      const handle = extractTelegramUsername(cleanVal);
      if (handle) {
        setSetting(action.key === "group_link" ? "group_id" : "channel_id", handle);
      }
    } else if (action.key === "group_id" || action.key === "channel_id") {
      const handle = extractTelegramUsername(cleanVal);
      if (handle) {
        cleanVal = handle;
      }
    }

    setSetting(action.key, cleanVal);
    const displayLabel =
      customLabel ||
      (action.key === "group_link"
        ? getSetting("group_link_text") || "Join Community Group"
        : action.key === "channel_link"
        ? getSetting("channel_link_text") || "Join Official Channel"
        : null);

    await ctx.reply(
      `✅ <b>Setting Updated!</b>\n` +
      `⚙️ <b>Field:</b> <code>${action.key}</code>\n` +
      (displayLabel && (action.key === "group_link" || action.key === "channel_link")
        ? `🔗 <b>Hyperlink Preview:</b> <a href="${escapeHtml(String(cleanVal))}">${escapeHtml(displayLabel)}</a>\n`
        : `📝 <b>New Value:</b> <b>${escapeHtml(String(cleanVal))}</b>\n`),
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([[Markup.button.callback("⚙️ Back to Settings", "adm:settings")]])
      }
    );
    return true;
  }

  if (action.type === "edit_product_price") {
    const num = parseFloat(text.replace(/[^0-9.]/g, ""));
    if (isNaN(num) || num <= 0) {
      await ctx.reply("❌ Invalid price.");
      return true;
    }
    const p = getProduct(action.productId);
    if (!p) return true;
    const bulkPrice = Number((num * 0.9).toFixed(2));
    const updated = updateProduct(p.id, {
      price: Number(num.toFixed(2)),
      bulk_tiers: [
        { min: 1, max: 4, price: Number(num.toFixed(2)) },
        { min: 5, max: 999999, price: bulkPrice }
      ]
    });
    await ctx.reply(
      `✅ Updated price for <b>${escapeHtml(updated.name)}</b> to <b>${money(updated.price)}</b> (Bulk 5+: ${money(bulkPrice)}).`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Product", `adm_prod:${p.id}`)]])
      }
    );
    return true;
  }

  if (action.type === "edit_product_stock") {
    const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
    if (isNaN(num) || num < 0) {
      await ctx.reply("❌ Invalid stock number.");
      return true;
    }
    const updated = updateProduct(action.productId, { stock: num, outOfStock: num <= 0 });
    await ctx.reply(
      `✅ Updated stock for <b>${escapeHtml(updated.name)}</b> to <b>${updated.stock} units</b>.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Product", `adm_prod:${updated.id}`)]])
      }
    );
    return true;
  }

  if (action.type === "add_product_keys") {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      await ctx.reply("❌ No valid lines provided.");
      return true;
    }
    const res = addProductStockItems(action.productId, lines);
    await ctx.reply(
      `✅ Added <b>${res.added}</b> preloaded item(s)! Total Stock is now <b>${res.totalStock} units</b>.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Product", `adm_prod:${action.productId}`)]])
      }
    );
    return true;
  }

  if (action.type === "fulfill_order") {
    try {
      const ord = fulfillOrder(action.orderId, text);
      await bot.telegram.sendMessage(
        ord.user_id,
        `🎉 <b>YOUR ORDER HAS BEEN DELIVERED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Order Code:</b> <code>${ord.id}</code>\n` +
        `📦 <b>Product:</b> <b>${escapeHtml(ord.product_name)}</b> (${ord.quantity}x)\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔑 <b>Account Credentials / API Key:</b>\n` +
        `<pre><code>${escapeHtml(text)}</code></pre>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Thank you for shopping with us!</i>`,
        { parse_mode: "HTML" }
      );
      await ctx.reply(`✅ Credentials delivered to buyer for order <code>${ord.id}</code>!`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🛒 Back to Orders", "adm:orders")]])
      });
    } catch (err) {
      await ctx.reply(`❌ Failed to fulfill order: ${err.message}`);
    }
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
        `❌ <b>Deposit Rejected</b>\nReason: ${escapeHtml(text)}\nPlease contact Support if you need assistance.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      await ctx.reply(`❌ Deposit <code>${dep.id}</code> rejected.`);
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
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
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
      await ctx.reply(`❌ No user found with ID: <code>${escapeHtml(targetId)}</code>.`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
      });
      return true;
    }
    ctx.session.adminAction = { type: "dm_enter_message", targetUserId: targetId };
    const name = [targetUser.first_name, targetUser.last_name].filter(Boolean).join(" ") || "Buyer";
    await ctx.reply(`👤 <b>Recipient:</b> ${escapeHtml(name)} (<code>${targetId}</code>)\n\nSend the message text to deliver:\n\n<i>Type /cancel to cancel.</i>`, {
      parse_mode: "HTML"
    });
    return true;
  }

  if (action.type === "dm_enter_message") {
    const targetId = action.targetUserId;
    try {
      await bot.telegram.sendMessage(
        targetId,
        `<blockquote>📩 <b>MESSAGE FROM STORE ADMIN</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${escapeHtml(text)}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Tap below to reply directly to Admin Support.</i></blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("💬 Reply to Admin", "user_reply_admin")]])
        }
      );
      await ctx.reply(`✅ Message delivered to <code>${targetId}</code>.`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]])
      });
    } catch (err) {
      await ctx.reply(`❌ Failed to deliver message: ${escapeHtml(err.message)}`);
    }
    return true;
  }

  if (action.type === "adjust_balance") {
    const targetId = action.targetUserId;
    const delta = parseFloat(text.replace("+", "").trim());
    if (isNaN(delta)) {
      await ctx.reply("❌ Invalid number. Enter e.g. <code>+45</code> or <code>-15</code>.", { parse_mode: "HTML" });
      return true;
    }
    const newBal = adjustUserBalance(targetId, delta);
    if (newBal === false) {
      await ctx.reply(`❌ User <code>${targetId}</code> not found.`);
      return true;
    }

    bot.telegram.sendMessage(
      targetId,
      `<blockquote>💰 <b>WALLET BALANCE UPDATED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Adjustment:</b> <b>${delta >= 0 ? "+" : ""}${money(delta)}</b>\n` +
      `👛 <b>New Balance:</b> <b>${money(newBal)}</b></blockquote>`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    await ctx.reply(`✅ Balance updated for <code>${targetId}</code>! New Balance: <b>${money(newBal)}</b>`, {
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
    const delta = parseInt(text.replace("+", "").trim(), 10);
    if (isNaN(delta)) {
      await ctx.reply("❌ Invalid number. Enter e.g. <code>+30</code> or <code>-5</code>.", { parse_mode: "HTML" });
      return true;
    }
    const newRefCount = adjustUserReferrals(targetId, delta);
    if (newRefCount === false) {
      await ctx.reply(`❌ User <code>${targetId}</code> not found.`);
      return true;
    }
    await ctx.reply(`✅ Referrals updated for <code>${targetId}</code>! New Referral Count: <b>${newRefCount}</b>`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("👤 View User Profile", `adm_view_user:${targetId}`)],
        [Markup.button.callback("🔙 Dashboard", "adm:menu")]
      ])
    });
    return true;
  }

  return false;
}

module.exports = {
  showAdminDashboard,
  registerAdminHandlers,
  handleAdminTextInput
};
