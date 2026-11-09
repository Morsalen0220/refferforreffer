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
      if (ctx.callbackQuery?.message && !ctx.callbackQuery.message.text) {
        try {
          await ctx.deleteMessage();
        } catch (e) {}
        return ctx.reply("📥 No pending wallet deposits.", {
          ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
        });
      }
      return ctx.editMessageText("📥 No pending wallet deposits.", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "adm:menu")]])
      });
    }

    const buttons = pending.slice(0, 10).map((d) => [
      Markup.button.callback(
        `${d.photo_file_id ? "📸" : "🔢"} ${d.id} • ${money(d.amount)} (${d.method})`,
        `adm_view_dep:${d.id}`
      )
    ]);
    buttons.push([Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]);

    await ctx.answerCbQuery();
    if (ctx.callbackQuery?.message && !ctx.callbackQuery.message.text) {
      try {
        await ctx.deleteMessage();
      } catch (e) {}
      return ctx.reply(`📥 <b>Pending Wallet Deposits (${pending.length}):</b>`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      });
    }
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
      `👤 <b>User ID:</b> <code>${dep.user_id}</code> (${escapeHtml(dep.user_name || "Buyer")})\n` +
      `💵 <b>Amount:</b> <b>${money(dep.amount)}</b>\n` +
      `⚡️ <b>Method:</b> ${dep.method}\n` +
      `📸 <b>Proof Type:</b> <b>${dep.photo_file_id ? "Screenshot Image Attached" : "Text TxID / Order ID"}</b>\n` +
      `📝 <b>Proof / Caption:</b> <code>${escapeHtml(dep.proof || "N/A")}</code>\n` +
      `🕒 <b>Date:</b> ${new Date(dep.created_at).toLocaleString()}`;

    const kbRows = [
      [Markup.button.callback(`✅ Approve & Credit ${money(dep.amount)}`, `adm_dep_app:${dep.id}`)],
      [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${dep.id}`)],
      [Markup.button.callback("📩 Message Buyer", `adm_user_dm:${dep.user_id}`)],
      [Markup.button.callback("🔙 Back to Pending Deposits", "adm:deposits")]
    ];
    const kb = Markup.inlineKeyboard(kbRows);

    await ctx.answerCbQuery();
    if (dep.photo_file_id) {
      try {
        await ctx.deleteMessage();
      } catch (e) {}
      try {
        return await ctx.replyWithPhoto(dep.photo_file_id, {
          caption: text,
          parse_mode: "HTML",
          ...kb
        });
      } catch (err) {
        return await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    }

    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  });

  bot.action(/^adm_dep_app:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const depId = ctx.match[1];

    try {
      const { deposit, user } = approveDeposit(depId);
      await ctx.answerCbQuery("Deposit approved & credited!");
      const approvedText =
        `✅ <b>Deposit <code>${depId}</code> Approved!</b>\n` +
        `👤 <b>User:</b> <code>${deposit.user_id}</code>\n` +
        `💵 <b>Credited:</b> <b>+${money(deposit.amount)}</b>\n` +
        `👛 <b>New Wallet Balance:</b> <b>${money(user?.wallet_balance || 0)}</b>`;

      const backKb = Markup.inlineKeyboard([
        [Markup.button.callback("📥 Pending Deposits", "adm:deposits"), Markup.button.callback("👑 Dashboard", "adm:menu")]
      ]);

      if (ctx.callbackQuery?.message && !ctx.callbackQuery.message.text) {
        try {
          await ctx.editMessageCaption(approvedText, { parse_mode: "HTML", ...backKb });
        } catch (e) {
          await ctx.reply(approvedText, { parse_mode: "HTML", ...backKb });
        }
      } else {
        try {
          await ctx.editMessageText(approvedText, { parse_mode: "HTML", ...backKb });
        } catch (e) {
          await ctx.reply(approvedText, { parse_mode: "HTML", ...backKb });
        }
      }

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
      if (settings.group_id) {
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
      `🔴 <b>TRC20 USDT Address:</b> <code>${(s.trc20_usdt_address || "TGeB...").slice(0, 14)}...</code>\n` +
      `🟢 <b>BEP20 USDT Address:</b> <code>${s.bep20_usdt_address?.slice(0, 12)}...</code>\n` +
      `🟣 <b>Polygon USDT Address:</b> <code>${s.polygon_usdt_address?.slice(0, 12)}...</code>\n` +
      `⚪️ <b>Litecoin (LTC) Address:</b> <code>${(s.ltc_address || "ltc1q...").slice(0, 14)}...</code>\n` +
      `📢 <b>Channel:</b> ${s.channel_link}\n` +
      `👥 <b>Group:</b> ${s.group_link}\n` +
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
        Markup.button.callback("🔴 TRC20 USDT", "adm_set:trc20_usdt_address")
      ],
      [
        Markup.button.callback("🟢 BEP20 USDT", "adm_set:bep20_usdt_address"),
        Markup.button.callback("🟣 Polygon USDT", "adm_set:polygon_usdt_address")
      ],
      [
        Markup.button.callback("⚪️ LTC Address", "adm_set:ltc_address"),
        Markup.button.callback("📞 Support Handle", "adm_set:support_username")
      ],
      [
        Markup.button.callback("🏷️ Store Title", "adm_set:bot_title"),
        Markup.button.callback("📢 Channel Link", "adm_set:channel_link")
      ],
      [
        Markup.button.callback("👥 Group Link", "adm_set:group_link")
      ],
      [
        Markup.button.callback(s.force_join_enabled ? "🔒 Force Join (Turn OFF)" : "🔒 Force Join (Turn ON)", "adm_toggle_fj"),
        Markup.button.callback(s.auto_broadcast_enabled !== false ? "📢 Auto Broadcast (Turn OFF)" : "📢 Auto Broadcast (Turn ON)", "adm_toggle_bc")
      ],
      [Markup.button.callback("🔙 Back to Dashboard", "adm:menu")]
    ]);

    if (ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        return await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    }
    return await ctx.reply(text, { parse_mode: "HTML", ...kb });
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

  bot.action(/^adm_promo_cat:(.+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showPromoCatalogMenu(ctx, ctx.match[1]);
  });

  bot.action(/^adm_promo_view:([^:]+):(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    await showPromoTemplateView(bot, ctx, ctx.match[1], Number(ctx.match[2]));
  });

  bot.action(/^adm_promo_copy:([^:]+):(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery("📋 Ready-to-copy promo sent below!");
    const targetId = ctx.match[1];
    const postNum = Number(ctx.match[2]);
    const botUsername = await getBotUsername(bot);
    const storeLink = `https://t.me/${botUsername}`;
    const settings = getAllSettings();
    const templates = buildPromoTemplates(targetId, storeLink, settings);
    const chosen = templates[postNum - 1] || templates[0];
    await ctx.reply(chosen.htmlText, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.url("🛒 Buy Instantly in Bot", storeLink)]])
    });
  });

  bot.action(/^adm_promo_send:(grp|chn|all_users):([^:]+):(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    const dest = ctx.match[1]; // 'grp' | 'chn' | 'all_users'
    const targetId = ctx.match[2];
    const postNum = Number(ctx.match[3]);

    const settings = getAllSettings();
    const botUsername = await getBotUsername(bot);
    const storeLink = `https://t.me/${botUsername}`;
    const templates = buildPromoTemplates(targetId, storeLink, settings);
    const chosen = templates[postNum - 1] || templates[0];

    if (dest === "all_users") {
      const users = getAllUsers();
      await ctx.answerCbQuery(`📢 Broadcasting Promo #${postNum} to ${users.length} users...`);
      let sent = 0;
      for (const u of users) {
        try {
          await bot.telegram.sendMessage(u.id, chosen.htmlText, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...Markup.inlineKeyboard([[Markup.button.url("🛒 Buy Instantly in Bot", storeLink)]])
          });
          sent++;
          await new Promise((r) => setTimeout(r, 40));
        } catch (e) {}
      }
      await ctx.reply(`✅ Promo Post #${postNum} broadcasted to <b>${sent} / ${users.length}</b> registered users!`, {
        parse_mode: "HTML"
      });
      return;
    }

    const chatId = dest === "grp" ? settings.group_id : settings.channel_id;
    if (!chatId) {
      return ctx.answerCbQuery(`❌ No ${dest === "grp" ? "group_id" : "channel_id"} configured in settings!`, {
        show_alert: true
      });
    }

    try {
      await bot.telegram.sendMessage(chatId, chosen.htmlText, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([[Markup.button.url("🛒 Buy Instantly in Bot", storeLink)]])
      });
      await ctx.answerCbQuery(`✅ Promo Post #${postNum} published to ${dest === "grp" ? "Group" : "Channel"}!`, {
        show_alert: true
      });
    } catch (err) {
      await ctx.answerCbQuery(`❌ Failed to post: ${err.message}`, { show_alert: true });
    }
  });
}

// =====================================================
// PROMO GENERATOR (BEAUTIFULLY ORGANIZED FOR ALL PRODUCTS & CATEGORIES)
// =====================================================
const PROMO_CATEGORY_META = {
  ai_sub: { icon: "🤖", label: "AI Max & Pro Subscriptions", short: "AI Subscriptions" },
  cloud_acc: { icon: "☁️", label: "Cloud Trial & Enterprise Accounts", short: "Cloud Accounts" },
  api_key: { icon: "🔑", label: "High-Quota Official API Keys", short: "Official API Keys" },
  esim_tools: { icon: "📱", label: "Global eSIM & Google Voice (GV)", short: "eSIM & Google Voice" }
};

const PRODUCT_MARKETING_HOOKS = {
  claude_max_20x: {
    badge: "👑 #1 BESTSELLER AI SUB",
    headline: "CLAUDE MAX 20X — OFFICIAL FINISHED ACCOUNT",
    subhook: "Unleash 20x higher usage limits on Claude 3.7 Sonnet & Opus without rate-limit interruptions!",
    useCases: "Full-stack coding, heavy codebase architecture, research & agency workflows."
  },
  chatgpt_pro_20x: {
    badge: "🚀 $200/MO TIER UNLOCKED",
    headline: "CHATGPT PRO 20X ($200 TIER FINISHED ACCOUNT)",
    subhook: "Unlimited access to OpenAI o1-pro, GPT-4o, Advanced Voice & Sora video generation!",
    useCases: "Deep reasoning, enterprise research, AI engineering & unlimited daily prompts."
  },
  chatgpt_shared_1m: {
    badge: "🔥 BUDGET & FREE REWARD PICK",
    headline: "CHATGPT PLUS/PRO SHARED ACCOUNT (30 DAYS)",
    subhook: "Enjoy premium GPT-4o, o1 & DALL-E 3 at a fraction of the price — or claim 100% FREE with 30 referrals!",
    useCases: "Students, daily productivity, copywriting & image generation."
  },
  grok_heavy_1m: {
    badge: "⚡️ UNRESTRICTED SUPERGROK",
    headline: "GROK HEAVY / SUPERGROK 1-MONTH SUBSCRIPTION",
    subhook: "Real-time DeepSearch, Think Mode & unfiltered high-speed AI generation!",
    useCases: "Real-time market analysis, viral content creation & deep reasoning."
  },
  byteplus_seedance: {
    badge: "🎬 ENTERPRISE AI VIDEO",
    headline: "BYTEPLUS SEEDANCE 2.5 ENTERPRISE SUBSCRIPTION",
    subhook: "US Corporate verified account with high-tier Seedance 2.5 AI video & model quota!",
    useCases: "AI video studios, commercial generation & high-volume media teams."
  },
  gcp_300_usa: {
    badge: "☁️ USA CLEAN IP CLOUD",
    headline: "GOOGLE CLOUD PLATFORM (GCP) $300 CREDIT ACCOUNT",
    subhook: "Fresh $300 USD Free Trial on clean USA IP — supports Vertex AI (Gemini/Claude) & Compute VMs!",
    useCases: "Vertex AI model deployment, cloud VPS/RDP, Kubernetes & API hosting."
  },
  gcp_300_json: {
    badge: "🔌 PLUG & PLAY VERTEX JSON",
    headline: "GCP $300 CREDIT + READY JSON SERVICE ACCOUNT KEY",
    subhook: "Pre-configured JSON key ready for immediate Vertex AI Gemini & Claude API calls!",
    useCases: "Developers needing zero-setup JSON credentials + full console access."
  },
  azure_payg_gpt: {
    badge: "🌍 MULTI-REGION PAYG",
    headline: "AZURE PAY-AS-YOU-GO (GPT T1–T5 ALL MODELS)",
    subhook: "Active Azure PAYG billing with unlocked OpenAI GPT-4o, o1 & GPT-4 Turbo across regions!",
    useCases: "Production SaaS apps, high-concurrency chatbots & enterprise AI pipelines."
  },
  azure_claude_t5: {
    badge: "💎 TIER-5 ENTERPRISE QUOTA",
    headline: "AZURE PAY-AS-YOU-GO — CLAUDE TIER-5 ACCESS",
    subhook: "Maximum enterprise RPM/TPM rate limits for uninterrupted production Claude workloads!",
    useCases: "High-traffic AI agents, coding platforms & enterprise API consumers."
  },
  azure_ft_200: {
    badge: "💻 RDP & CLOUD STARTER",
    headline: "MICROSOFT AZURE FREE TRIAL ($200 USD CREDIT)",
    subhook: "Fresh $200 Azure credit with clean IP & verified billing — spin up Windows/Linux VMs in minutes!",
    useCases: "Windows RDP, Linux VPS servers, cloud hosting & AI sandbox testing."
  },
  azure_100k_10m: {
    badge: "🏛️ $100,000 ENTERPRISE TITAN",
    headline: "AZURE $100K CREDIT ACCOUNT (10M TPM QUOTA)",
    subhook: "Full administrative ownership transfer with $100,000 USD credit & 10 Million TPM throughput!",
    useCases: "Large AI startups, LLM aggregators & ultra-scale production clusters."
  },
  aws_5v_5rpm: {
    badge: "📦 BEDROCK AI READY",
    headline: "AWS CLOUD 5vCPU ACCOUNT (5 RPM BEDROCK QUOTA)",
    subhook: "Root AWS console + IAM keys with EC2 & Amazon Bedrock AI models pre-enabled!",
    useCases: "Cloud compute instances, Bedrock Claude testing & automated scripts."
  },
  aws_5v_50rpm: {
    badge: "🚀 50 RPM HIGH-CONCURRENCY",
    headline: "AWS CLOUD 5vCPU (50 RPM HIGH-SPEED BEDROCK)",
    subhook: "10x higher invocation speed (50 RPM) for heavy Amazon Bedrock Claude & EC2 workloads!",
    useCases: "High-speed AI inference, multi-user coding tools & production servers."
  },
  vertex_gemini_key: {
    badge: "✨ PAID-TIER GEMINI KEY",
    headline: "VERTEX AI / AI STUDIO GEMINI PRO OFFICIAL API KEY",
    subhook: "High RPM/TPM paid-tier key for Gemini 1.5 Pro & 2.0 Flash/Pro — plug straight into Cursor & Cline!",
    useCases: "Cursor IDE, Cline, Roo-Code, Python/Node.js SDKs & multimodal apps."
  },
  claude_high_key: {
    badge: "🔥 200K CONTEXT OFFICIAL KEY",
    headline: "CLAUDE 3.5 / 3.7 SONNET HIGH-QUOTA OFFICIAL API KEY",
    subhook: "Official sk-ant-* high-quota key with full 200K context window & top-tier rate limits!",
    useCases: "Cursor, Claude Code, Cline, SillyTavern & automated code generation."
  },
  aws_bedrock_key: {
    badge: "🛡️ ZERO-BAN BEDROCK KEY",
    headline: "AWS BEDROCK (AWSB) HIGH-QUOTA CLAUDE API CREDENTIALS",
    subhook: "Unrestricted Claude 3.5/3.7 Sonnet & Opus throughput via official AWS Bedrock endpoints!",
    useCases: "Developers wanting rock-solid AWS SLA stability with zero random bans."
  },
  openai_official_key: {
    badge: "⚡ OFFICIAL SK-* HIGH TIER",
    headline: "OPENAI OFFICIAL HIGH-QUOTA API KEY (GPT-4o / o1 / o3)",
    subhook: "Pre-funded official OpenAI API key compatible with every OpenAI SDK & AI client!",
    useCases: "NextChat, LibreChat, Cursor, custom GPT agents & production backends."
  },
  azure_official_key: {
    badge: "🏢 ENTERPRISE SLA ENDPOINT",
    headline: "AZURE OPENAI OFFICIAL API KEY + ENDPOINT URL",
    subhook: "Low-latency enterprise GPT-4o & o1 deployment with dedicated endpoint & API key!",
    useCases: "Privacy-first enterprise apps, high-uptime bots & commercial SaaS."
  },
  global_esim: {
    badge: "🌍 10+ COUNTRIES QR ESIM",
    headline: "GLOBAL eSIM CARD (US / UK / CA / JP / AU / EU / IN / TW)",
    subhook: "Instant QR code activation for international SMS verification & roaming data on any eSIM phone!",
    useCases: "Cloud/AI account verification, international travel & global OTP reception."
  },
  google_voice_gv: {
    badge: "📱 AGED USA PERMANENT #",
    headline: "GOOGLE VOICE (GV) AGED USA NUMBER ACCOUNT",
    subhook: "Clean, permanent USA phone number with full Gmail access for seamless SMS & Call verification!",
    useCases: "Registering AI platforms, cloud trials, social media & US business services."
  }
};

async function showPromoCatalogMenu(ctx, selectedCat = null) {
  const products = getAllProducts();
  const inStockCount = products.filter((p) => !p.outOfStock && (p.stock || 0) > 0).length;

  if (!selectedCat) {
    const aiCount = products.filter((p) => p.category === "ai_sub").length;
    const cloudCount = products.filter((p) => p.category === "cloud_acc").length;
    const keyCount = products.filter((p) => p.category === "api_key").length;
    const esimCount = products.filter((p) => p.category === "esim_tools").length;

    const text =
      `🚀 <b>ADMIN MARKETING &amp; PROMO STUDIO</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Total Store Catalog:</b> <b>${products.length} Products</b> (🟢 ${inStockCount} In Stock)\n` +
      `✨ <b>Ready-to-Post Formats:</b>\n` +
      `• 🌟 <b>Full Store Megaposts:</b> 3 High-Converting All-in-One Catalog Ads\n` +
      `• 📂 <b>Category Promo Packs:</b> Dedicated Ads for AI, Cloud, API Keys &amp; eSIM\n` +
      `• 🏷️ <b>Individual Product Ads:</b> 3 Custom Marketing Posts for Every Single Product\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Choose a marketing pack or browse by category below:</i>`;

    const rows = [
      [Markup.button.callback("🌟 All Products Mega Promo (3 Full-Catalog Posts)", "adm_promo_view:all:1")],
      [
        Markup.button.callback(`🤖 AI Subscriptions (${aiCount})`, "adm_promo_cat:ai_sub"),
        Markup.button.callback(`☁️ Cloud Accounts (${cloudCount})`, "adm_promo_cat:cloud_acc")
      ],
      [
        Markup.button.callback(`🔑 Official API Keys (${keyCount})`, "adm_promo_cat:api_key"),
        Markup.button.callback(`📱 eSIM & GV (${esimCount})`, "adm_promo_cat:esim_tools")
      ],
      [Markup.button.callback(`📋 List All ${products.length} Individual Products`, "adm_promo_cat:all_list")],
      [Markup.button.callback("🔙 Back to Admin Dashboard", "adm:menu")]
    ];

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

  const isAllList = selectedCat === "all_list";
  const catMeta = PROMO_CATEGORY_META[selectedCat] || { icon: "📋", label: "All Store Products", short: "All Products" };
  const filtered = isAllList ? products : products.filter((p) => p.category === selectedCat);

  const text =
    `${catMeta.icon} <b>PROMO STUDIO: ${catMeta.label.toUpperCase()}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>Products in Section:</b> <b>${filtered.length}</b>\n` +
    `💡 <i>Tap the Category Megapost or select any product below to generate 3 high-converting marketing ads (with live prices, bulk discounts &amp; 1-click Group/Channel/DM publishing):</i>`;

  const rows = [];
  if (!isAllList && PROMO_CATEGORY_META[selectedCat]) {
    rows.push([
      Markup.button.callback(
        `🌟 ${catMeta.short} — Category Mega Promo (2 Posts)`,
        `adm_promo_view:cat_${selectedCat}:1`
      )
    ]);
  } else {
    rows.push([
      Markup.button.callback("🌟 All Products Mega Promo (3 Posts)", "adm_promo_view:all:1")
    ]);
  }

  filtered.forEach((p) => {
    const bulk = getUnitPrice(p, 5);
    const bulkTag = bulk < p.price ? ` • Bulk $${bulk.toFixed(0)}` : "";
    const statusDot = p.outOfStock || (p.stock || 0) <= 0 ? "🔴" : "🟢";
    rows.push([
      Markup.button.callback(
        `${statusDot} ${p.name.slice(0, 27)} ($${Number(p.price).toFixed(2)}${bulkTag})`,
        `adm_promo_view:${p.id}:1`
      )
    ]);
  });

  rows.push([
    Markup.button.callback("🔙 Promo Categories", "adm:promos"),
    Markup.button.callback("👑 Admin Dashboard", "adm:menu")
  ]);

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
  const payMethods = `USDT (TRC-20 / BEP-20 / Polygon), Litecoin (LTC)${settings.binance_pay_enabled !== false ? " & Binance Pay (0% Fee)" : ""}`;
  const supportHandle = settings.support_username || "@Morsalen0220";
  const channelLink = settings.channel_link || "https://t.me/RefferRewardss";
  const groupLink = settings.group_link || "https://t.me/RefferRewardes";

  const fmtCatalogLine = (p) => {
    const unit = Number(p.price).toFixed(2);
    const bulk = getUnitPrice(p, 5);
    const bulkStr = bulk < p.price ? ` <i>(5+ Bulk: $${bulk.toFixed(2)})</i>` : "";
    return `▫️ <b>${escapeHtml(p.name)}</b> — <b>$${unit}</b>${bulkStr}`;
  };

  const fmtPlainLine = (p) => {
    const unit = Number(p.price).toFixed(2);
    const bulk = getUnitPrice(p, 5);
    const bulkStr = bulk < p.price ? ` (Bulk 5+: $${bulk.toFixed(2)})` : "";
    return `• ${p.name} — $${unit}${bulkStr}`;
  };

  // 1. ALL PRODUCTS FULL-CATALOG MEGAPOSTS (3 VARIATIONS)
  if (targetId === "all") {
    const aiProds = products.filter((p) => p.category === "ai_sub");
    const cloudProds = products.filter((p) => p.category === "cloud_acc");
    const keyProds = products.filter((p) => p.category === "api_key");
    const esimProds = products.filter((p) => p.category === "esim_tools");

    const post1Plain =
`👑 OFFICIAL CLOUD & AI RESOURCE STORE — FULL CATALOG 👑
━━━━━━━━━━━━━━━━━━━━
🤖 AI MAX & PRO SUBSCRIPTIONS:
${aiProds.map(fmtPlainLine).join("\n")}

☁️ CLOUD TRIAL & ENTERPRISE ACCOUNTS:
${cloudProds.map(fmtPlainLine).join("\n")}

🔑 HIGH-QUOTA OFFICIAL API KEYS:
${keyProds.map(fmtPlainLine).join("\n")}

📱 GLOBAL eSIM & VERIFICATION TOOLS:
${esimProds.map(fmtPlainLine).join("\n")}
━━━━━━━━━━━━━━━━━━━━
🎁 BONUS: Invite 30 Friends = 1 FREE ChatGPT Shared Account (1M)!
💳 Payment: ${payMethods}
📞 24/7 Support: ${supportHandle}
⚡️ Instant Automated Delivery via Bot:
👉 ${storeLink}`;

    const post1Html =
`👑 <b>OFFICIAL CLOUD &amp; AI RESOURCE STORE — FULL CATALOG</b> 👑
━━━━━━━━━━━━━━━━━━━━
🤖 <b>AI MAX &amp; PRO SUBSCRIPTIONS:</b>
${aiProds.map(fmtCatalogLine).join("\n")}

☁️ <b>CLOUD TRIAL &amp; ENTERPRISE ACCOUNTS:</b>
${cloudProds.map(fmtCatalogLine).join("\n")}

🔑 <b>HIGH-QUOTA OFFICIAL API KEYS:</b>
${keyProds.map(fmtCatalogLine).join("\n")}

📱 <b>GLOBAL eSIM &amp; VERIFICATION TOOLS:</b>
${esimProds.map(fmtCatalogLine).join("\n")}
━━━━━━━━━━━━━━━━━━━━
🎁 <b>FREE REWARD:</b> Invite 30 Friends = <b>1x FREE ChatGPT Shared (1M)!</b>
💳 <b>Payment:</b> ${escapeHtml(payMethods)}
📞 <b>Support:</b> ${escapeHtml(supportHandle)}
⚡️ <b>24/7 Instant Automated Delivery via Bot:</b>
👉 ${storeLink}`;

    const post2Plain =
`🔥 FLASH WHOLESALE & RETAIL STOCK (大量现货 • 自动发货) 🔥
━━━━━━━━━━━━━━━━━━━━
${products.map((p, i) => `${i + 1}. ${p.name} — $${Number(p.price).toFixed(2)} [🟢 ${p.stock || 0} Ready]`).join("\n")}
━━━━━━━━━━━━━━━━━━━━
📦 Automatic Bulk Discounts on 5+ Units at Checkout!
💰 Accepted: ${payMethods}
📢 Updates: ${channelLink} | Proofs: ${groupLink}
🛒 Order Instantly 24/7 in Our Automated Bot:
👉 ${storeLink}`;

    const post2Html =
`🔥 <b>FLASH WHOLESALE &amp; RETAIL STOCK (大量现货 • 自动发货)</b> 🔥
━━━━━━━━━━━━━━━━━━━━
${products.map((p, i) => `<b>${i + 1}.</b> ${escapeHtml(p.name)} — <b>$${Number(p.price).toFixed(2)}</b> <code>[🟢 ${p.stock || 0} Left]</code>`).join("\n")}
━━━━━━━━━━━━━━━━━━━━
📦 <b>Wholesale:</b> Automatic Bulk Discount on 5+ Units!
💰 <b>Accepted:</b> ${escapeHtml(payMethods)}
📢 <a href="${channelLink}">Official Channel</a> • <a href="${groupLink}">Live Order Proofs</a>
🛒 <b>Order Instantly 24/7 in Our Automated Bot:</b>
👉 ${storeLink}`;

    const post3Plain =
`⚡️ STOP OVERPAYING FOR AI, CLOUD & API KEYS! ⚡️
━━━━━━━━━━━━━━━━━━━━
Why wait hours for manual sellers when you can get instant automated delivery in 2 seconds?

🏆 OUR TOP BESTSELLERS TODAY:
• Claude Max 20x (Finished Account) — $45.00
• ChatGPT Pro 20x ($200 Monthly Tier) — $55.00
• Google Cloud GCP $300 (USA / JSON) — from $15.00
• Azure PAYG (GPT T1–T5 & Claude T5) — from $45.00
• AWS 5vCPU (5 RPM & 50 RPM Bedrock) — from $18.00
• Official Gemini, Claude, OpenAI & Bedrock API Keys — from $12.00
• Global eSIM & Aged USA Google Voice — from $6.00

🎁 OR Invite 30 Friends to Unlock 1 FREE ChatGPT Shared Account (1M)!
━━━━━━━━━━━━━━━━━━━━
💳 Zero-Fee Binance Pay, USDT (TRC20/BEP20/Polygon) & LTC
👉 Start Shopping Now: ${storeLink}`;

    const post3Html =
`⚡️ <b>STOP OVERPAYING FOR AI, CLOUD &amp; API KEYS!</b> ⚡️
━━━━━━━━━━━━━━━━━━━━
<i>Why wait hours for manual sellers when you can get instant automated delivery in 2 seconds?</i>

🏆 <b>OUR TOP BESTSELLERS TODAY:</b>
🔥 <b>Claude Max 20x (Finished Account)</b> — <b>$45.00</b>
🚀 <b>ChatGPT Pro 20x ($200 Monthly Tier)</b> — <b>$55.00</b>
☁️ <b>Google Cloud GCP $300 (USA / JSON)</b> — <b>from $15.00</b>
💎 <b>Azure PAYG (GPT T1–T5 &amp; Claude T5)</b> — <b>from $45.00</b>
📦 <b>AWS 5vCPU (5 RPM &amp; 50 RPM Bedrock)</b> — <b>from $18.00</b>
🔑 <b>Official Gemini, Claude, OpenAI &amp; AWSB Keys</b> — <b>from $12.00</b>
📱 <b>Global eSIM &amp; Aged USA Google Voice</b> — <b>from $6.00</b>

🎁 <b>BONUS:</b> Invite 30 Friends = <b>1x FREE ChatGPT Shared (1M)!</b>
━━━━━━━━━━━━━━━━━━━━
💳 <b>Payment:</b> ${escapeHtml(payMethods)}
👉 <b>Start Shopping Now:</b> ${storeLink}`;

    return [
      {
        title: "🌟 All Products — Post #1 (Categorized Master Catalog)",
        plainText: post1Plain,
        htmlText: `<blockquote>${post1Html}</blockquote>`
      },
      {
        title: "🌟 All Products — Post #2 (Live Inventory & Wholesale Price List)",
        plainText: post2Plain,
        htmlText: `<blockquote>${post2Html}</blockquote>`
      },
      {
        title: "🌟 All Products — Post #3 (High-Converting Bestseller Hook)",
        plainText: post3Plain,
        htmlText: `<blockquote>${post3Html}</blockquote>`
      }
    ];
  }

  // 2. CATEGORY-SPECIFIC PROMO PACKS (cat_ai_sub, cat_cloud_acc, cat_api_key, cat_esim_tools)
  if (targetId.startsWith("cat_")) {
    const catKey = targetId.replace("cat_", "");
    const meta = PROMO_CATEGORY_META[catKey] || { icon: "📦", label: "Store Category", short: "Category" };
    const catProds = products.filter((p) => p.category === catKey);

    const catPost1Plain =
`${meta.icon} ${meta.label.toUpperCase()} — IN STOCK NOW! ${meta.icon}
━━━━━━━━━━━━━━━━━━━━
${catProds.map((p) => {
  const bulk = getUnitPrice(p, 5);
  const bulkTxt = bulk < p.price ? ` | Bulk 5+: $${bulk.toFixed(2)}` : "";
  const firstDesc = (p.description || "").split("\n")[0] || "";
  return `🔥 ${p.name}\n   💵 Price: $${Number(p.price).toFixed(2)} USDT${bulkTxt} (Stock: ${p.stock || 0})\n   ${firstDesc}`;
}).join("\n\n")}
━━━━━━━━━━━━━━━━━━━━
💳 Payment: ${payMethods}
📞 Admin Support: ${supportHandle}
⚡️ 24/7 Instant Automated Delivery via Bot:
👉 ${storeLink}`;

    const catPost1Html =
`${meta.icon} <b>${escapeHtml(meta.label.toUpperCase())} — IN STOCK NOW!</b> ${meta.icon}
━━━━━━━━━━━━━━━━━━━━
${catProds.map((p) => {
  const bulk = getUnitPrice(p, 5);
  const bulkTxt = bulk < p.price ? ` • <i>Bulk 5+: $${bulk.toFixed(2)}</i>` : "";
  const firstDesc = escapeHtml((p.description || "").split("\n")[0] || "");
  return `🔥 <b>${escapeHtml(p.name)}</b>\n   💵 <b>$${Number(p.price).toFixed(2)} USDT</b>${bulkTxt} <code>[${p.stock || 0} Ready]</code>\n   <i>${firstDesc}</i>`;
}).join("\n\n")}
━━━━━━━━━━━━━━━━━━━━
💳 <b>Payment:</b> ${escapeHtml(payMethods)}
📞 <b>Support:</b> ${escapeHtml(supportHandle)}
⚡️ <b>24/7 Instant Automated Delivery via Bot:</b>
👉 ${storeLink}`;

    const catPost2Plain =
`🚀 WHOLESALE & RETAIL RESTOCK: ${meta.label.toUpperCase()} 🚀
━━━━━━━━━━━━━━━━━━━━
${catProds.map(fmtPlainLine).join("\n")}
━━━━━━━━━━━━━━━━━━━━
✅ 100% Verified Active Credentials & Keys
✅ Automatic Volume Discounts on 5+ Units
✅ Instant Automated Dispatch 24/7
👉 Order Now: ${storeLink}`;

    const catPost2Html =
`🚀 <b>WHOLESALE &amp; RETAIL RESTOCK: ${escapeHtml(meta.label.toUpperCase())}</b> 🚀
━━━━━━━━━━━━━━━━━━━━
${catProds.map(fmtCatalogLine).join("\n")}
━━━━━━━━━━━━━━━━━━━━
✅ <b>100% Verified Active Credentials &amp; Keys</b>
✅ <b>Automatic Volume Discounts on 5+ Units</b>
✅ <b>Instant Automated Dispatch 24/7</b>
👉 <b>Order Now:</b> ${storeLink}`;

    return [
      {
        title: `${meta.icon} ${meta.short} — Post #1 (Detailed Category Showcase)`,
        plainText: catPost1Plain,
        htmlText: `<blockquote>${catPost1Html}</blockquote>`
      },
      {
        title: `${meta.icon} ${meta.short} — Post #2 (Clean Price & Wholesale List)`,
        plainText: catPost2Plain,
        htmlText: `<blockquote>${catPost2Html}</blockquote>`
      }
    ];
  }

  // 3. INDIVIDUAL PRODUCT MARKETING ADS (3 VARIATIONS FOR EVERY PRODUCT)
  const p = getProduct(targetId) || products[0];
  const unitPrice = Number(p.price || 15);
  const bulkPrice = getUnitPrice(p, 5);
  const hasBulk = bulkPrice < unitPrice;
  const savingsPer5 = hasBulk ? Number(((unitPrice - bulkPrice) * 5).toFixed(2)) : 0;
  const stockCount = Number(p.stock || 0);
  const hook = PRODUCT_MARKETING_HOOKS[p.id] || {
    badge: "🔥 VERIFIED PREMIUM STOCK",
    headline: p.name.toUpperCase(),
    subhook: "100% Official, tested and ready for instant automated delivery!",
    useCases: "Developers, agencies, power users & cloud engineers."
  };

  const post1Plain =
`${hook.badge}
🔥 ${hook.headline} 🔥
━━━━━━━━━━━━━━━━━━━━
💡 ${hook.subhook}

💵 Retail Price: $${unitPrice.toFixed(2)} USDT${hasBulk ? `\n📦 Wholesale (5+ Units): $${bulkPrice.toFixed(2)} USDT / each (Save $${savingsPer5.toFixed(2)} on 5x!)` : ""}
📊 Live Inventory: ${stockCount} Verified Units Ready 🟢
━━━━━━━━━━━━━━━━━━━━
✨ KEY FEATURES & SPECS:
${p.description}

🎯 IDEAL FOR:
• ${hook.useCases}

🛡️ WARRANTY & TERMS:
${p.terms}
━━━━━━━━━━━━━━━━━━━━
💳 Accepted: ${payMethods}
📞 24/7 Support: ${supportHandle}
⚡️ 2-Second Automated Delivery in Bot:
👉 ${storeLink}`;

  const post1Html =
`<b>${escapeHtml(hook.badge)}</b>
🔥 <b>${escapeHtml(hook.headline)}</b> 🔥
━━━━━━━━━━━━━━━━━━━━
💡 <i>${escapeHtml(hook.subhook)}</i>

💵 <b>Retail Price:</b> <b>$${unitPrice.toFixed(2)} USDT</b>${hasBulk ? `\n📦 <b>Wholesale (5+ Units):</b> <b>$${bulkPrice.toFixed(2)} USDT / each</b> <i>(Save $${savingsPer5.toFixed(2)} on 5x!)</i>` : ""}
📊 <b>Live Inventory:</b> <b>${stockCount} Verified Units Ready 🟢</b>
━━━━━━━━━━━━━━━━━━━━
✨ <b>KEY FEATURES &amp; SPECS:</b>
${escapeHtml(p.description)}

🎯 <b>IDEAL FOR:</b>
• ${escapeHtml(hook.useCases)}

🛡️ <b>WARRANTY &amp; TERMS:</b>
<i>${escapeHtml(p.terms)}</i>
━━━━━━━━━━━━━━━━━━━━
💳 <b>Accepted:</b> ${escapeHtml(payMethods)}
📞 <b>Support:</b> ${escapeHtml(supportHandle)}
⚡️ <b>2-Second Automated Delivery in Bot:</b>
👉 ${storeLink}`;

  const post2Plain =
`⚡️ FLASH RESTOCK ALERT: ${p.name.toUpperCase()} ⚡️
━━━━━━━━━━━━━━━━━━━━
Fresh verified batch just loaded into our automated dispensary!

📦 Product: ${p.name}
💰 Single Unit: $${unitPrice.toFixed(2)} USDT${hasBulk ? `\n🔥 Bulk 5+ Rate: $${bulkPrice.toFixed(2)} USDT / each` : ""}
🟢 Available Stock: ${stockCount} Units

${p.description}

✅ Instant Automated Delivery (No waiting for manual sellers!)
💳 Pay via ${payMethods}
🛒 Grab yours now before this batch sells out:
👉 ${storeLink}`;

  const post2Html =
`⚡️ <b>FLASH RESTOCK ALERT: ${escapeHtml(p.name.toUpperCase())}</b> ⚡️
━━━━━━━━━━━━━━━━━━━━
<i>Fresh verified batch just loaded into our automated dispensary!</i>

📦 <b>Product:</b> <b>${escapeHtml(p.name)}</b>
💰 <b>Single Unit:</b> <b>$${unitPrice.toFixed(2)} USDT</b>${hasBulk ? `\n🔥 <b>Bulk 5+ Rate:</b> <b>$${bulkPrice.toFixed(2)} USDT / each</b>` : ""}
🟢 <b>Available Stock:</b> <b>${stockCount} Units</b>

${escapeHtml(p.description)}

✅ <b>Instant Automated Delivery</b> <i>(Zero waiting!)</i>
💳 <b>Pay via:</b> ${escapeHtml(payMethods)}
🛒 <b>Grab yours now before this batch sells out:</b>
👉 ${storeLink}`;

  const post3Plain =
`💎 SHORT & PUNCHY AD: ${p.name}
━━━━━━━━━━━━━━━━━━━━
🚀 Need ${p.name}? We have ${stockCount} fresh units in stock right now!
• Price: $${unitPrice.toFixed(2)} USDT${hasBulk ? ` (Bulk 5+: $${bulkPrice.toFixed(2)})` : ""}
• Use Case: ${hook.useCases}
• Delivery: 100% Automated 24/7 via Telegram Bot
👉 Order in 1 Click: ${storeLink}`;

  const post3Html =
`💎 <b>READY STOCK: ${escapeHtml(p.name)}</b>
━━━━━━━━━━━━━━━━━━━━
🚀 <i>${escapeHtml(hook.subhook)}</i>

• 💵 <b>Price:</b> <b>$${unitPrice.toFixed(2)} USDT</b>${hasBulk ? ` <i>(Bulk 5+: $${bulkPrice.toFixed(2)})</i>` : ""}
• 📊 <b>Stock:</b> <b>${stockCount} Units Available 🟢</b>
• 🎯 <b>Best For:</b> ${escapeHtml(hook.useCases)}
• ⚡️ <b>Delivery:</b> Instant 24/7 Automated Bot

👉 <b>Order in 1 Click:</b> ${storeLink}`;

  return [
    {
      title: `📦 ${p.name} — Post #1 (Full High-Converting Spotlight)`,
      plainText: post1Plain,
      htmlText: `<blockquote>${post1Html}</blockquote>`
    },
    {
      title: `📦 ${p.name} — Post #2 (Flash Restock & Wholesale Alert)`,
      plainText: post2Plain,
      htmlText: `<blockquote>${post2Html}</blockquote>`
    },
    {
      title: `📦 ${p.name} — Post #3 (Short Punchy Social Ad)`,
      plainText: post3Plain,
      htmlText: `<blockquote>${post3Html}</blockquote>`
    }
  ];
}

async function showPromoTemplateView(bot, ctx, targetId = "all", postNumber = 1) {
  const botUsername = await getBotUsername(bot);
  const storeLink = `https://t.me/${botUsername}`;
  const settings = getAllSettings();

  const templates = buildPromoTemplates(targetId, storeLink, settings);
  const maxPosts = templates.length;
  const idx = Math.min(Math.max(0, postNumber - 1), maxPosts - 1);
  const currentTpl = templates[idx];

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(storeLink)}&text=${encodeURIComponent(currentTpl.plainText.replace(storeLink, "").trim())}`;

  const text =
    `🚀 <b>ADMIN PROMO STUDIO (${idx + 1} / ${maxPosts})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>${escapeHtml(currentTpl.title)}</b>\n\n` +
    `👇 <b>Tap inside the code box below to 1-tap copy the full text:</b>\n\n` +
    `<pre><code>${escapeHtml(currentTpl.plainText)}</code></pre>\n\n` +
    `💡 <i>Switch styles or publish directly to your Group, Channel, or All Bot Users with 1 click:</i>`;

  const tabRow = templates.map((_, i) =>
    Markup.button.callback(
      idx === i ? `🔘 Style #${i + 1}` : `⚪️ Style #${i + 1}`,
      `adm_promo_view:${targetId}:${i + 1}`
    )
  );

  const productObj = !targetId.startsWith("cat_") && targetId !== "all" ? getProduct(targetId) : null;
  const backCallback = productObj
    ? `adm_promo_cat:${productObj.category}`
    : targetId.startsWith("cat_")
    ? `adm_promo_cat:${targetId.replace("cat_", "")}`
    : "adm:promos";

  const kb = Markup.inlineKeyboard([
    tabRow,
    [
      Markup.button.callback("📤 Post to Group", `adm_promo_send:grp:${targetId}:${idx + 1}`),
      Markup.button.callback("📢 Post to Channel", `adm_promo_send:chn:${targetId}:${idx + 1}`)
    ],
    [
      Markup.button.callback("📣 Broadcast to All Users", `adm_promo_send:all_users:${targetId}:${idx + 1}`),
      Markup.button.callback("📋 Preview Formatted Ad", `adm_promo_copy:${targetId}:${idx + 1}`)
    ],
    [
      Markup.button.url("🚀 Forward / Share to Any Chat", shareUrl)
    ],
    [
      Markup.button.callback("🔙 Back to Promo Catalog", backCallback),
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
    const cleanVal = text.trim();
    setSetting(action.key, cleanVal);
    await ctx.reply(
      `✅ <b>Setting Updated!</b>\n` +
      `⚙️ <b>Field:</b> <code>${action.key}</code>\n` +
      `📝 <b>New Value:</b> <b>${escapeHtml(String(cleanVal))}</b>`,
      {
        parse_mode: "HTML",
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
