const { Markup } = require("telegraf");
const QRCode = require("qrcode");
const {
  getAllSettings,
  getSetting,
  getUser,
  getOrCreateUser,
  getAllProducts,
  getProductsByCategory,
  getProduct,
  getUnitPrice,
  createDeposit,
  createOrder,
  claimFreeReferralReward,
  getOrder,
  getUserOrders
} = require("../store");

const {
  money,
  escapeHtml,
  isAdmin,
  ADMIN_ID,
  getBotUsername,
  makeProgressBar,
  checkMembership,
  verifyLiveMembership,
  forceJoinKeyboard,
  getMainMenuReplyKeyboard,
  welcomeText
} = require("../helpers");

const {
  sendGroupOrderNotice,
  sendGroupFreeRewardNotice
} = require("../broadcaster");

const { handleAdminTextInput } = require("./admin");

const CATEGORY_LABELS = {
  ai_sub: "🤖 AI Max & Pro Subscriptions",
  cloud_acc: "☁️ Cloud Accounts (GCP / Azure / AWS)",
  api_key: "🔑 High-Quota Official API Keys",
  esim_tools: "📱 Global eSIM & Google Voice (GV)",
  all: "📋 All Available Products"
};

// Fast helper to answer callback immediately and edit message in-place without hanging
async function renderScreen(ctx, text, kb) {
  if (ctx.callbackQuery) {
    ctx.answerCbQuery().catch(() => {});
    const msg = ctx.callbackQuery.message;
    // If previous message was a photo (no .text), delete it and send text cleanly
    if (msg && !msg.text) {
      try {
        await ctx.deleteMessage();
      } catch (e) {}
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      if (String(e.message || "").includes("message is not modified")) return;
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }
  return await ctx.reply(text, { parse_mode: "HTML", ...kb });
}

// =====================================================
// MENU: STORE CATEGORIES & PRODUCT CATALOG
// =====================================================
async function showStoreMenu(ctx, selectedCat = null) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const allProducts = getAllProducts();

  if (!selectedCat) {
    const aiCount = allProducts.filter((p) => p.category === "ai_sub" && !p.outOfStock).length;
    const cloudCount = allProducts.filter((p) => p.category === "cloud_acc" && !p.outOfStock).length;
    const keyCount = allProducts.filter((p) => p.category === "api_key" && !p.outOfStock).length;
    const esimCount = allProducts.filter((p) => p.category === "esim_tools" && !p.outOfStock).length;

    const text =
      `🛍️ <b>CLOUD &amp; AI DIGITAL STORE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👛 <b>Your Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n\n` +
      `📌 <b>Available Categories:</b>\n` +
      `• 🤖 <b>AI Subscriptions:</b> Claude Max 20x, ChatGPT Pro 20x, Grok Heavy, Seedance 2.5\n` +
      `• ☁️ <b>Cloud Accounts:</b> GCP $300 (USA / JSON), Azure PAYG (GPT T1–T5 &amp; Claude T5), Azure $100K, AWS 5v (5 RPM &amp; 50 RPM)\n` +
      `• 🔑 <b>Official API Keys:</b> Vertex/AI Studio Gemini, Claude Official, AWS Bedrock, OpenAI &amp; Azure Keys\n` +
      `• 📱 <b>eSIM &amp; Verification:</b> All-Country eSIMs &amp; USA Google Voice (GV)\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Select a category below to browse products:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback(`🤖 AI Max & Pro Accounts (${aiCount})`, "cat:ai_sub")],
      [Markup.button.callback(`☁️ Cloud Accounts: GCP / Azure / AWS (${cloudCount})`, "cat:cloud_acc")],
      [Markup.button.callback(`🔑 Official High-Quota API Keys (${keyCount})`, "cat:api_key")],
      [Markup.button.callback(`📱 Global eSIM & Google Voice (${esimCount})`, "cat:esim_tools")],
      [Markup.button.callback(`📋 View Full Catalog (${allProducts.length})`, "cat:all")],
      [Markup.button.callback("👛 My Wallet / Deposit", "menu_wallet"), Markup.button.callback("📦 My Orders", "menu_orders")]
    ]);

    return renderScreen(ctx, text, kb);
  }

  let products = [];
  let title = CATEGORY_LABELS[selectedCat] || "🛍️ Product Catalog";
  if (selectedCat === "api_cloud") {
    title = "🔑 API Keys & Cloud Accounts";
    products = allProducts.filter((p) => p.category === "api_key" || p.category === "cloud_acc");
  } else {
    products = getProductsByCategory(selectedCat);
  }

  const text =
    `${title}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👛 <b>Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `📦 <b>Products Listed:</b> <b>${products.length}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Tap any product below to view specs, bulk rates &amp; order:</i>`;

  const buttons = products.map((p) => {
    const statusIcon = p.outOfStock || (p.stock || 0) <= 0 ? "🔴 [Out]" : "🟢";
    return [
      Markup.button.callback(
        `${statusIcon} ${p.name} — $${Number(p.price).toFixed(2)}`,
        `prod:${p.id}`
      )
    ];
  });

  buttons.push([
    Markup.button.callback("🔙 All Categories", "menu_store"),
    Markup.button.callback("👛 Deposit Funds", "menu_deposit")
  ]);

  const kb = Markup.inlineKeyboard(buttons);
  return renderScreen(ctx, text, kb);
}

// =====================================================
// PRODUCT DETAILS & QUANTITY SELECTION
// =====================================================
async function showProductDetails(ctx, productId) {
  const product = getProduct(productId);
  if (!product) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery("❌ Product not found.", { show_alert: true });
    }
    return ctx.reply("❌ Product not found.");
  }

  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const stockCount = Number(product.stock || 0);
  const inStock = !product.outOfStock && stockCount > 0;

  let bulkInfo = "";
  if (Array.isArray(product.bulk_tiers) && product.bulk_tiers.length > 1) {
    const bulkTier = product.bulk_tiers[product.bulk_tiers.length - 1];
    bulkInfo = `📦 <b>Bulk Price (${bulkTier.min}+ units):</b> <b>${money(bulkTier.price)} / each</b>\n`;
  }

  const text =
    `📦 <b>${escapeHtml(product.name)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 <b>Unit Price:</b> <b>${money(product.price)}</b>\n` +
    bulkInfo +
    `📊 <b>Available Stock:</b> ${inStock ? `<b>${stockCount} Units Available 🟢</b>` : `<b>Out of Stock 🔴</b>`}\n` +
    `👛 <b>Your Wallet Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 <b>Product Details:</b>\n${escapeHtml(product.description || "")}\n\n` +
    `🛡️ <b>Terms &amp; Guarantee:</b>\n<i>${escapeHtml(product.terms || "• Verified active on delivery")}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <i>Choose quantity below to purchase:</i>`;

  const rows = [];
  if (inStock) {
    const p1 = getUnitPrice(product, 1);
    const p2 = getUnitPrice(product, 2) * 2;
    const p5 = getUnitPrice(product, 5) * 5;

    rows.push([
      Markup.button.callback(`🛒 Buy 1x ($${p1.toFixed(2)})`, `buy_qty:${product.id}:1`),
      Markup.button.callback(`🛒 Buy 2x ($${p2.toFixed(2)})`, `buy_qty:${product.id}:2`)
    ]);
    if (stockCount >= 5) {
      rows.push([
        Markup.button.callback(`📦 Buy 5x Bulk ($${p5.toFixed(2)})`, `buy_qty:${product.id}:5`),
        Markup.button.callback("🔢 Custom Quantity", `buy_custom:${product.id}`)
      ]);
    } else {
      rows.push([Markup.button.callback("🔢 Custom Quantity", `buy_custom:${product.id}`)]);
    }
  }

  rows.push([
    Markup.button.callback(`📥 Deposit ${money(product.price)}`, `dep_quick:${Number(product.price).toFixed(2)}`),
    Markup.button.callback("🔙 Back to Store", `cat:${product.category || "all"}`)
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

// =====================================================
// PROCESS PRODUCT PURCHASE
// =====================================================
async function handlePurchase(bot, ctx, productId, quantity) {
  const product = getProduct(productId);
  if (!product) {
    if (ctx.callbackQuery) return ctx.answerCbQuery("Product not found.", { show_alert: true });
    return ctx.reply("❌ Product not found.");
  }

  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const stockCount = Number(product.stock || 0);

  if (product.outOfStock || stockCount < qty) {
    const msg = `❌ Insufficient stock for ${product.name}. Available: ${stockCount} unit(s).`;
    if (ctx.callbackQuery) return ctx.answerCbQuery(msg, { show_alert: true });
    return ctx.reply(msg);
  }

  const unitPrice = getUnitPrice(product, qty);
  const totalPrice = Number((unitPrice * qty).toFixed(2));
  const balance = Number(user.wallet_balance || 0);

  if (balance < totalPrice) {
    const needed = Number((totalPrice - balance).toFixed(2));
    const text =
      `⚠️ <b>INSUFFICIENT WALLET BALANCE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Product:</b> <b>${escapeHtml(product.name)}</b>\n` +
      `🔢 <b>Quantity:</b> <b>${qty}x</b> (${money(unitPrice)} each)\n` +
      `💵 <b>Total Order Cost:</b> <b>${money(totalPrice)}</b>\n` +
      `👛 <b>Your Current Balance:</b> <b>${money(balance)}</b>\n` +
      `❗ <b>Amount Needed:</b> <b>${money(needed)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Tap below to deposit <b>${money(needed)}</b> (or full <b>${money(totalPrice)}</b>) via Binance Pay, USDT BEP-20, or Polygon:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback(`📥 Deposit ${money(needed)} Now`, `dep_quick:${needed.toFixed(2)}`)],
      [Markup.button.callback(`📥 Deposit ${money(totalPrice)}`, `dep_quick:${totalPrice.toFixed(2)}`)],
      [Markup.button.callback("🔙 Back to Product", `prod:${product.id}`)]
    ]);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Insufficient wallet balance. Please deposit first.");
      try {
        return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
      } catch (e) {
        return await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
    }
    return await ctx.reply(text, { parse_mode: "HTML", ...kb });
  }

  try {
    const { order, user: updatedUser } = createOrder({
      user_id: user.id,
      product_id: product.id,
      quantity: qty
    });

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("🎉 Order confirmed!");
    }

    const hasCredentials = Array.isArray(order.delivered_items) && order.delivered_items.length > 0;
    const credBlock = hasCredentials
      ? `\n🔑 <b>Delivered Credentials / License:</b>\n<pre><code>${escapeHtml(order.delivered_items.join("\n\n"))}</code></pre>\n`
      : `\n⚡️ <b>Delivery Status:</b> <b>Priority Dispatch Queued</b>\n<i>Your account credentials / JSON / API key are being prepared and will be delivered right here in your chat shortly!</i>\n`;

    const receiptText =
      `🎉 <b>ORDER CONFIRMED &amp; PAID!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 <b>Order Code:</b> <code>${order.id}</code>\n` +
      `📦 <b>Product:</b> <b>${escapeHtml(order.product_name)}</b>\n` +
      `🔢 <b>Quantity:</b> <b>${order.quantity}x</b>\n` +
      `💵 <b>Total Paid:</b> <b>${money(order.total_price)}</b>\n` +
      `👛 <b>Remaining Balance:</b> <b>${money(updatedUser.wallet_balance)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━` +
      credBlock +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Save your Order Code (<code>${order.id}</code>). You can view or recover your orders anytime under 📦 My Orders!</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("📦 View My Orders", "menu_orders"), Markup.button.callback("🛍️ Continue Shopping", "menu_store")],
      [Markup.button.callback("📞 Contact Admin Support", "user_reply_admin")]
    ]);

    await ctx.reply(receiptText, { parse_mode: "HTML", ...kb });

    // Notify Admin
    const adminkb = hasCredentials
      ? Markup.inlineKeyboard([
          [Markup.button.callback("📩 Message Buyer", `adm_user_dm:${user.id}`)],
          [Markup.button.callback("👤 View Buyer Profile", `adm_view_user:${user.id}`)]
        ])
      : Markup.inlineKeyboard([
          [Markup.button.callback("📤 Deliver Credentials Now", `adm_ord_fulfill:${order.id}`)],
          [Markup.button.callback("❌ Refund Order", `adm_ord_refund:${order.id}`)],
          [Markup.button.callback("📩 Message Buyer", `adm_user_dm:${user.id}`)]
        ]);

    bot.telegram.sendMessage(
      ADMIN_ID,
      `🔔 <b>NEW PRODUCT ORDER!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 <b>Order ID:</b> <code>${order.id}</code>\n` +
      `👤 <b>Buyer:</b> ${escapeHtml(user.first_name || "User")} (${user.username ? `@${escapeHtml(user.username)}` : `ID: <code>${user.id}</code>`})\n` +
      `📦 <b>Product:</b> <b>${escapeHtml(order.product_name)}</b>\n` +
      `🔢 <b>Quantity:</b> <b>${order.quantity}x</b>\n` +
      `💵 <b>Total Paid:</b> <b>${money(order.total_price)}</b>\n` +
      `⚡️ <b>Status:</b> ${hasCredentials ? "✅ Auto-Delivered from Stock" : "⏳ Awaiting Credential Dispatch"}`,
      { parse_mode: "HTML", ...adminkb }
    ).catch(() => {});

    // Broadcast live purchase to group
    const settings = getAllSettings();
    if (settings.group_id || settings.group_link) {
      sendGroupOrderNotice(
        user.first_name || "Verified Buyer",
        order.product_name,
        order.quantity,
        order.total_price,
        order.unit_price,
        false
      ).catch(() => {});
    }
  } catch (err) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery(`❌ Error: ${err.message}`, { show_alert: true });
    }
    return ctx.reply(`❌ Order failed: ${err.message}`);
  }
}

// =====================================================
// MENU: WALLET & DEPOSIT
// =====================================================
async function showWalletScreen(ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;

  const text =
    `👛 <b>MY WALLET &amp; BALANCE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Account Holder:</b> ${escapeHtml(user.first_name || "User")}\n` +
    `🆔 <b>Telegram ID:</b> <code>${user.id}</code>\n\n` +
    `💵 <b>Available Balance:</b> <b>${money(user.wallet_balance || 0)}</b>\n` +
    `📥 <b>Total Deposited:</b> <b>${money(user.total_deposited || 0)}</b>\n` +
    `🛒 <b>Total Spent:</b> <b>${money(user.total_spent || 0)}</b>\n` +
    `📦 <b>Completed Orders:</b> <b>${user.orders_count || 0}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡️ <i>Select an amount below to top up your wallet via USDT (BEP-20 / Polygon), Litecoin (LTC)${getSetting("binance_pay_enabled") !== false ? ", or Binance Pay" : ""}:</i>`;

  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback("➕ $15 USDT", "dep_quick:15.00"),
      Markup.button.callback("➕ $18 USDT", "dep_quick:18.00"),
      Markup.button.callback("➕ $35 USDT", "dep_quick:35.00")
    ],
    [
      Markup.button.callback("➕ $45 USDT", "dep_quick:45.00"),
      Markup.button.callback("➕ $55 USDT", "dep_quick:55.00"),
      Markup.button.callback("➕ $100 USDT", "dep_quick:100.00")
    ],
    [Markup.button.callback("✏️ Enter Custom Deposit Amount", "dep_custom_amt")],
    [Markup.button.callback("🛍️ Browse Products", "menu_store"), Markup.button.callback("📦 My Orders", "menu_orders")]
  ]);

  return renderScreen(ctx, text, kb);
}

async function showDepositMethodSelector(ctx, amount) {
  const amt = Math.max(1, Number(amount) || 15);
  ctx.session = ctx.session || {};
  ctx.session.depositAmount = amt;
  const settings = getAllSettings();
  const isBinanceEnabled = settings.binance_pay_enabled !== false;

  const text =
    `📥 <b>TOP UP WALLET BALANCE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 <b>Deposit Amount:</b> <b>${money(amt)}</b>\n\n` +
    `👇 <i>Choose your preferred payment method below:</i>`;

  const methodButtons = [];
  if (isBinanceEnabled) {
    methodButtons.push([Markup.button.callback("🟡 Binance Pay ID (0% Fee)", `dep_method:BINANCE_PAY:${amt.toFixed(2)}`)]);
  }
  methodButtons.push(
    [Markup.button.callback("🟢 USDT (BEP-20 / BSC Network)", `dep_method:USDT_BEP20:${amt.toFixed(2)}`)],
    [Markup.button.callback("🟣 USDT (Polygon Network)", `dep_method:USDT_POLYGON:${amt.toFixed(2)}`)],
    [Markup.button.callback("⚪️ Litecoin (LTC Network)", `dep_method:LTC_COIN:${amt.toFixed(2)}`)],
    [Markup.button.callback("🔙 Back to Wallet", "menu_wallet")]
  );

  const kb = Markup.inlineKeyboard(methodButtons);
  return renderScreen(ctx, text, kb);
}

// =====================================================
// MENU: MY ORDERS & RECOVERY
// =====================================================
async function showOrdersScreen(ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const orders = getUserOrders(user.id);

  let text =
    `📦 <b>MY ORDERS &amp; PURCHASES</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  if (orders.length === 0) {
    text += `<i>You haven't placed any orders yet.</i>\n\nTap <b>🛍️ Browse Store</b> below to explore our AI &amp; Cloud accounts!`;
  } else {
    orders.slice(0, 8).forEach((o) => {
      const statusBadge =
        o.status === "delivered"
          ? "✅ Delivered"
          : o.status === "refunded"
          ? "❌ Refunded"
          : "⏳ Processing";
      text +=
        `🆔 <code>${o.id}</code>\n` +
        `• <b>${escapeHtml(o.product_name)}</b> (${o.quantity}x) — <b>${money(o.total_price)}</b>\n` +
        `• Status: <b>${statusBadge}</b>\n\n`;
    });
    text += `💡 <i>Tap any order below or use "🔍 Lookup Order Code" to view delivered credentials:</i>`;
  }

  const orderButtons = orders.slice(0, 5).map((o) => [
    Markup.button.callback(`📄 ${o.id} • ${o.product_name.slice(0, 22)}`, `view_ord:${o.id}`)
  ]);

  orderButtons.push([
    Markup.button.callback("🔍 Lookup / Recover by Order Code", "menu_recover")
  ]);
  orderButtons.push([
    Markup.button.callback("🛍️ Browse Store", "menu_store"),
    Markup.button.callback("👛 My Wallet", "menu_wallet")
  ]);

  const kb = Markup.inlineKeyboard(orderButtons);

  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      return await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  }
  return await ctx.reply(text, { parse_mode: "HTML", ...kb });
}

// =====================================================
// MENU: 30-REFERRAL FREE CHATGPT SHARED (1 MONTH)
// =====================================================
async function showReferralScreen(bot, ctx) {
  const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
  const settings = getAllSettings();
  const reqRefs = Number(settings.referrals_for_free_reward || 30);
  const rewardTitle = settings.free_reward_title || "ChatGPT Shared Account (1 Month)";
  const botUsername = await getBotUsername(bot);
  const refLink = `https://t.me/${botUsername}?start=ref_${user.id}`;

  const totalRefs = Number(user.referral_count || 0);
  const claimedCount = Number(user.claimed_free_rewards || 0);
  const earnedTotal = Math.floor(totalRefs / reqRefs);
  const availableToClaim = Math.max(0, earnedTotal - claimedCount);
  const nextMilestone = (claimedCount + 1) * reqRefs;
  const remaining = Math.max(0, nextMilestone - totalRefs);
  const progressBar = makeProgressBar(totalRefs, reqRefs);

  const shareText = encodeURIComponent(
    `🔥 Get Claude Max 20x, ChatGPT Pro 20x, GCP $300, Azure PAYG & Official API Keys — OR invite ${reqRefs} friends to get a FREE ChatGPT Shared Account (1 Month)! 👇`
  );
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${shareText}`;

  const text =
    `🎁 <b>INVITE &amp; EARN FREE CHATGPT SHARED (1 MONTH)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 <b>Free Milestone Reward:</b> <b>1x ${escapeHtml(rewardTitle)}</b>\n` +
    `🎯 <b>Required Referrals:</b> <b>${reqRefs} Friends = 1 Free Account</b>\n\n` +
    `📊 <b>Your Referral Progress:</b>\n` +
    `${progressBar}\n\n` +
    `👥 <b>Total Invited Friends:</b> <b>${totalRefs}</b>\n` +
    `🎁 <b>Free Accounts Claimed:</b> <b>${claimedCount}</b>\n` +
    `⏳ <b>Remaining for Next Free Account:</b> <b>${availableToClaim > 0 ? "0 (Ready to Claim! 🎉)" : `${remaining} more friend(s)`}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <b>Your Personal Referral Link (Tap to copy):</b>\n` +
    `<code>${refLink}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>Share your link with friends or groups! Every ${reqRefs} friends who start the bot using your link unlocks <b>1 FREE ${escapeHtml(rewardTitle)}</b> (or buy it directly in the store anytime)!</i>`;

  const rows = [];
  if (availableToClaim > 0) {
    rows.push([
      Markup.button.callback(
        `🎉 Claim Free ChatGPT Shared Account (1M) (${availableToClaim} Ready)`,
        "claim_free_chatgpt"
      )
    ]);
  }
  rows.push([Markup.button.url("📤 Share Referral Link on Telegram", shareUrl)]);
  rows.push([
    Markup.button.callback("🛒 Buy Directly ($3.50)", "prod:chatgpt_shared_1m"),
    Markup.button.callback("🛍️ Browse Store", "menu_store")
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

// =====================================================
// REGISTER ALL USER HANDLERS
// =====================================================
function registerUserHandlers(bot) {
  // /START Command (with ref_<id> referral tracking)
  bot.start(async (ctx) => {
    ctx.session = {};
    const payload = String(ctx.startPayload || "").trim();
    let referrerId = null;
    if (payload.startsWith("ref_")) {
      referrerId = payload.replace("ref_", "").trim();
    } else if (/^\d+$/.test(payload)) {
      referrerId = payload;
    }

    const { user, isNew, referrerId: validRefId, referrerNewCount } = getOrCreateUser(ctx.from, referrerId);
    const settings = getAllSettings();
    const reqRefs = Number(settings.referrals_for_free_reward || 30);

    // Notify Referrer when a new user joins via their link
    if (isNew && validRefId) {
      const progress = makeProgressBar(referrerNewCount, reqRefs);
      const canClaimNow = referrerNewCount >= reqRefs && referrerNewCount % reqRefs === 0;
      bot.telegram.sendMessage(
        validRefId,
        `🎉 <b>New Referral Joined!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>New Member:</b> <b>${escapeHtml(ctx.from.first_name || "Friend")}</b>\n` +
        `👥 <b>Your Total Referrals:</b> <b>${referrerNewCount} / ${reqRefs}</b>\n` +
        `📊 <b>Progress:</b> ${progress}\n\n` +
        (canClaimNow
          ? `🎁 <b>CONGRATULATIONS! You reached ${referrerNewCount} referrals! Tap below to claim your FREE ChatGPT Shared Account (1 Month)!</b>`
          : `🔥 <i>Invite ${Math.max(0, reqRefs - (referrerNewCount % reqRefs))} more friend(s) to unlock your FREE ChatGPT Shared Account (1 Month)!</i>`),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🎁 Open Free ChatGPT Referral Center", "menu_refer")]
          ])
        }
      ).catch(() => {});
    }

    const joined = await checkMembership(bot, ctx);
    if (!joined) {
      const chText = escapeHtml(settings.channel_link_text || "Join Official Channel");
      const gpText = escapeHtml(settings.group_link_text || "Join Community Group");
      return ctx.reply(
        `⚠️ <b>Welcome!</b> To access the store, please join our official Channel and Group first:\n\n` +
        `📢 <b>Channel:</b> <a href="${escapeHtml(settings.channel_link || "https://t.me/")}">${chText}</a>\n` +
        `👥 <b>Group:</b> <a href="${escapeHtml(settings.group_link || "https://t.me/")}">${gpText}</a>\n\n` +
        `👇 <i>After joining both, tap "Check / I Have Joined" below:</i>`,
        {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          link_preview_options: { is_disabled: true },
          ...forceJoinKeyboard()
        }
      );
    }

    await ctx.reply(welcomeText(user), {
      parse_mode: "HTML",
      ...getMainMenuReplyKeyboard()
    });
  });

  // Check Membership Callback
  bot.action("check_membership", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { ok, channelOk, groupOk } = await verifyLiveMembership(bot, ctx, userId, true);
    if (!ok) {
      if (!channelOk && !groupOk) {
        return ctx.answerCbQuery("❌ Please join both our Channel & Group first!", { show_alert: true });
      }
      if (!channelOk) {
        return ctx.answerCbQuery("❌ Please join our Channel first!", { show_alert: true });
      }
      return ctx.answerCbQuery("❌ Please join our Group first!", { show_alert: true });
    }

    await ctx.answerCbQuery("🎉 Verified successfully!");
    try {
      await ctx.deleteMessage();
    } catch (err) {}

    const { user } = getOrCreateUser(ctx.from);
    await ctx.reply(
      `🎉 <b>Membership verified!</b>\n\n` + welcomeText(user),
      {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard()
      }
    );
  });

  // Force Join Middleware
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || "";
    const cbData = ctx.callbackQuery?.data || "";

    if (isAdmin(ctx)) {
      if (text.startsWith("/admin") || text.startsWith("/promo") || cbData.startsWith("adm") || ctx.session?.adminAction) {
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
          const chText = escapeHtml(settings.channel_link_text || "Join Official Channel");
          const gpText = escapeHtml(settings.group_link_text || "Join Community Group");
          return ctx.reply(
            `⚠️ <b>Access Denied!</b>\nYou must join our Channel and Group before using the store.\n\n` +
            `📢 <b>Channel:</b> <a href="${escapeHtml(settings.channel_link || "https://t.me/")}">${chText}</a>\n` +
            `👥 <b>Group:</b> <a href="${escapeHtml(settings.group_link || "https://t.me/")}">${gpText}</a>\n\n` +
            `👇 <i>Tap below after joining:</i>`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
              link_preview_options: { is_disabled: true },
              ...forceJoinKeyboard()
            }
          );
        }
      }
    }

    return next();
  });

  // Main Store & Category Navigation
  bot.hears("🛍️ Buy Products", (ctx) => showStoreMenu(ctx, null));
  bot.hears("🛍️ Buy", (ctx) => showStoreMenu(ctx, null));
  bot.command("buy", (ctx) => showStoreMenu(ctx, null));
  bot.command("products", (ctx) => showStoreMenu(ctx, "all"));
  bot.action("menu_store", (ctx) => showStoreMenu(ctx, null));

  bot.hears("🔑 API Keys & Cloud", (ctx) => showStoreMenu(ctx, "api_cloud"));
  bot.command("apikey", (ctx) => showStoreMenu(ctx, "api_key"));
  bot.command("cloud", (ctx) => showStoreMenu(ctx, "cloud_acc"));

  // 30-Referral Free ChatGPT Shared Account (1 Month)
  bot.hears("🎁 Free ChatGPT (30 Refs)", (ctx) => showReferralScreen(bot, ctx));
  bot.hears("🎁 Refer & Earn", (ctx) => showReferralScreen(bot, ctx));
  bot.command("refer", (ctx) => showReferralScreen(bot, ctx));
  bot.action("menu_refer", async (ctx) => {
    await ctx.answerCbQuery();
    await showReferralScreen(bot, ctx);
  });

  bot.action("claim_free_chatgpt", async (ctx) => {
    const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
    try {
      const { order, user: updatedUser } = claimFreeReferralReward(user.id);
      await ctx.answerCbQuery("🎉 Free ChatGPT Shared Account (1M) Claimed!");

      const hasCredentials = Array.isArray(order.delivered_items) && order.delivered_items.length > 0;
      const credBlock = hasCredentials
        ? `\n🔑 <b>Delivered Account Credentials:</b>\n<pre><code>${escapeHtml(order.delivered_items.join("\n\n"))}</code></pre>\n`
        : `\n⚡️ <b>Delivery Status:</b> <b>Priority Dispatch Queued</b>\n<i>Your FREE 1-Month ChatGPT Shared Account login details are being dispatched right here in your chat!</i>\n`;

      const receiptText =
        `🎁 <b>FREE REFERRAL REWARD CLAIMED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Reward Order Code:</b> <code>${order.id}</code>\n` +
        `📦 <b>Reward:</b> <b>${escapeHtml(order.product_name)}</b>\n` +
        `💵 <b>Cost:</b> <b>$0.00 USDT (30 Referrals Completed 🎉)</b>\n` +
        `👥 <b>Your Total Referrals:</b> <b>${updatedUser.referral_count || 0}</b>\n` +
        `🎁 <b>Total Free Accounts Claimed:</b> <b>${updatedUser.claimed_free_rewards || 1}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━` +
        credBlock +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 <i>You can view your reward anytime under 📦 My Orders!</i>`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("📦 View My Orders", "menu_orders"), Markup.button.callback("🎁 Referral Center", "menu_refer")],
        [Markup.button.callback("📞 Contact Admin Support", "user_reply_admin")]
      ]);

      await ctx.reply(receiptText, { parse_mode: "HTML", ...kb });

      // Notify Admin to fulfill or confirm
      const adminKb = hasCredentials
        ? Markup.inlineKeyboard([
            [Markup.button.callback("📩 Message Winner", `adm_user_dm:${user.id}`)],
            [Markup.button.callback("👤 View User Profile", `adm_view_user:${user.id}`)]
          ])
        : Markup.inlineKeyboard([
            [Markup.button.callback("📤 Deliver Free ChatGPT Credentials", `adm_ord_fulfill:${order.id}`)],
            [Markup.button.callback("📩 Message Winner", `adm_user_dm:${user.id}`)],
            [Markup.button.callback("👤 View User Profile", `adm_view_user:${user.id}`)]
          ]);

      bot.telegram.sendMessage(
        ADMIN_ID,
        `🎁 <b>30-REFERRAL FREE CHATGPT CLAIMED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Order ID:</b> <code>${order.id}</code>\n` +
        `👤 <b>User:</b> ${escapeHtml(user.first_name || "User")} (${user.username ? `@${escapeHtml(user.username)}` : `ID: <code>${user.id}</code>`})\n` +
        `👥 <b>Total Referrals:</b> <b>${updatedUser.referral_count || 0}</b>\n` +
        `📦 <b>Reward:</b> <b>${escapeHtml(order.product_name)}</b>\n` +
        `⚡️ <b>Status:</b> ${hasCredentials ? "✅ Auto-Delivered from Stock" : "⏳ Awaiting Credential Dispatch"}`,
        { parse_mode: "HTML", ...adminKb }
      ).catch(() => {});

      const settings = getAllSettings();
      if (settings.group_id || settings.group_link) {
        sendGroupFreeRewardNotice(
          user.first_name || "Verified Member",
          "ChatGPT Shared Account (1 Month)",
          Number(settings.referrals_for_free_reward || 30)
        ).catch(() => {});
      }
    } catch (err) {
      return ctx.answerCbQuery(`⚠️ ${err.message}`, { show_alert: true });
    }
  });

  bot.action(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showStoreMenu(ctx, ctx.match[1]);
  });

  bot.action(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showProductDetails(ctx, ctx.match[1]);
  });

  bot.action(/^buy_qty:([^:]+):(\d+)$/, async (ctx) => {
    const productId = ctx.match[1];
    const qty = parseInt(ctx.match[2], 10);
    await handlePurchase(bot, ctx, productId, qty);
  });

  bot.action(/^buy_custom:(.+)$/, async (ctx) => {
    const product = getProduct(ctx.match[1]);
    if (!product) return ctx.answerCbQuery("Product not found.", { show_alert: true });

    ctx.session.customBuyProduct = product.id;
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔢 <b>Custom Quantity Order: ${escapeHtml(product.name)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Base Price:</b> <b>${money(product.price)}</b>\n` +
      `📊 <b>Available Stock:</b> <b>${product.stock || 0} units</b>\n\n` +
      `👇 <b>Reply with the quantity you want to buy (e.g. <code>3</code> or <code>10</code>):</b>\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // Wallet & Deposits
  bot.hears("👛 Wallet", (ctx) => showWalletScreen(ctx));
  bot.hears("💰 Balance", (ctx) => showWalletScreen(ctx));
  bot.command("wallet", (ctx) => showWalletScreen(ctx));
  bot.command("balance", (ctx) => showWalletScreen(ctx));
  bot.command("deposit", (ctx) => showWalletScreen(ctx));
  bot.action("menu_wallet", (ctx) => showWalletScreen(ctx));
  bot.action("menu_deposit", (ctx) => showWalletScreen(ctx));

  bot.action(/^dep_quick:([0-9.]+)$/, async (ctx) => {
    const amt = parseFloat(ctx.match[1]);
    await ctx.answerCbQuery();
    await showDepositMethodSelector(ctx, amt);
  });

  bot.action("dep_custom_amt", async (ctx) => {
    ctx.session.awaitingCustomDepositAmount = true;
    await ctx.answerCbQuery();
    await ctx.reply(
      `💵 <b>Custom Wallet Deposit</b>\n\n` +
      `Please reply with the amount in USDT you wish to deposit (e.g. <code>25</code> or <code>60</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^dep_method:([^:]+):(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    const actAmount = parseFloat(ctx.match[2]) || 15.00;
    const settings = getAllSettings();

    if (method === "BINANCE_PAY" && settings.binance_pay_enabled === false) {
      return ctx.answerCbQuery("⚠️ Binance Pay deposit is currently disabled. Please use USDT or Litecoin (LTC).", {
        show_alert: true
      });
    }

    ctx.answerCbQuery().catch(() => {});

    if (method === "BINANCE_PAY") {
      const payId = settings.binance_pay_id || "350946509";
      const text =
        `🟡 <b>DEPOSIT VIA BINANCE PAY</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount to Send:</b> <b>${money(actAmount)}</b>\n` +
        `🆔 <b>Binance Pay ID:</b> <code>${payId}</code> (Tap to copy)\n\n` +
        `📌 <b>Instructions:</b>\n` +
        `1. Open Binance App ➔ Pay ➔ Send.\n` +
        `2. Paste Pay ID: <code>${payId}</code>\n` +
        `3. Send <b>${money(actAmount)}</b>.\n` +
        `4. Copy your <b>Binance Order ID</b>.\n` +
        `5. Tap "✅ I Have Paid" below and send your Order ID or screenshot.`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("✅ I Have Paid / Submit Proof", `dep_submit:BINANCE_PAY:${actAmount.toFixed(2)}`)],
        [Markup.button.callback("🔙 Back", `dep_quick:${actAmount.toFixed(2)}`)]
      ]);

      return renderScreen(ctx, text, kb);
    } else if (method === "LTC_COIN") {
      const ltcAddress = settings.ltc_address || "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      const text =
        `⚪️ <b>DEPOSIT VIA LITECOIN (LTC NETWORK)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount to Send:</b> <b>$${actAmount.toFixed(2)} USD worth of LTC</b>\n` +
        `🌐 <b>Network:</b> <b>Litecoin (LTC Native Network)</b>\n` +
        `📫 <b>LTC Deposit Address (Tap to copy):</b>\n<code>${ltcAddress}</code>\n\n` +
        `⚠️ <i>Send Litecoin (LTC) worth <b>$${actAmount.toFixed(2)} USD</b> on the official Litecoin network.</i>\n\n` +
        `👇 <i>After sending payment, tap "✅ I Have Paid" below to submit your LTC TxID or receipt:</i>`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("✅ I Have Paid / Submit Proof", `dep_submit:LTC_COIN:${actAmount.toFixed(2)}`)],
        [Markup.button.callback("📱 Show QR Code", `dep_qr:LTC_COIN:${actAmount.toFixed(2)}`)],
        [Markup.button.callback("🔙 Back", `dep_quick:${actAmount.toFixed(2)}`)]
      ]);

      return renderScreen(ctx, text, kb);
    } else {
      const isBep20 = method === "USDT_BEP20";
      const address = isBep20
        ? settings.bep20_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF"
        : settings.polygon_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF";
      const networkName = isBep20 ? "BNB Smart Chain (BEP-20)" : "Polygon (MATIC / POL)";

      const text =
        `${isBep20 ? "🟢" : "🟣"} <b>DEPOSIT VIA USDT (${networkName})</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 <b>Amount to Send:</b> <b>${money(actAmount)}</b>\n` +
        `🌐 <b>Network:</b> <b>${networkName}</b>\n` +
        `📫 <b>Deposit Address (Tap to copy):</b>\n<code>${address}</code>\n\n` +
        `⚠️ <i>Send only USDT on ${networkName}.</i>\n\n` +
        `👇 <i>After sending payment, tap "✅ I Have Paid" below to submit your TxID or receipt:</i>`;

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("✅ I Have Paid / Submit Proof", `dep_submit:${method}:${actAmount.toFixed(2)}`)],
        [Markup.button.callback("📱 Show QR Code", `dep_qr:${method}:${actAmount.toFixed(2)}`)],
        [Markup.button.callback("🔙 Back", `dep_quick:${actAmount.toFixed(2)}`)]
      ]);

      return renderScreen(ctx, text, kb);
    }
  });

  bot.action(/^dep_qr:([^:]+):(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    const actAmount = parseFloat(ctx.match[2]) || 15.00;
    const settings = getAllSettings();
    ctx.answerCbQuery("Generating QR Code...").catch(() => {});

    const address =
      method === "LTC_COIN"
        ? settings.ltc_address || "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
        : method === "USDT_BEP20"
        ? settings.bep20_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF"
        : settings.polygon_usdt_address || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF";

    const label =
      method === "LTC_COIN" ? "Litecoin (LTC)" : method === "USDT_BEP20" ? "USDT (BEP-20)" : "USDT (Polygon)";

    try {
      const qrBuffer = await QRCode.toBuffer(address, { width: 320, margin: 2 });
      await ctx.replyWithPhoto(
        { source: qrBuffer },
        {
          caption: `📱 <b>${label} QR Code (${money(actAmount)})</b>\n<code>${address}</code>`,
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ I Have Paid / Submit Proof", `dep_submit:${method}:${actAmount.toFixed(2)}`)]
          ])
        }
      );
    } catch (e) {
      await ctx.reply(`📫 <b>${label} Address:</b>\n<code>${address}</code>`, { parse_mode: "HTML" });
    }
  });

  bot.action(/^dep_submit:([^:]+):(.+)$/, async (ctx) => {
    const method = ctx.match[1];
    const amount = parseFloat(ctx.match[2]) || 15.00;
    ctx.session.depositState = {
      method,
      amount,
      step: "awaiting_proof"
    };
    const text =
      `📝 <b>SUBMIT DEPOSIT PROOF (${money(amount)})</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 <b>Selected Method:</b> <b>${escapeHtml(method)}</b>\n\n` +
      `👇 Please reply with your payment <b>Transaction ID (TxID)</b>, <b>Binance Order ID</b>, or send a <b>Screenshot image</b> of your transfer receipt.\n\n` +
      `<i>Type /cancel to cancel.</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🔙 Back to Payment Details", `dep_method:${method}:${amount.toFixed(2)}`)]
    ]);

    return renderScreen(ctx, text, kb);
  });

  // Orders & Order Recovery
  bot.hears("📦 My Orders", (ctx) => showOrdersScreen(ctx));
  bot.command("orders", (ctx) => showOrdersScreen(ctx));
  bot.action("menu_orders", (ctx) => showOrdersScreen(ctx));

  bot.action(/^view_ord:(.+)$/, async (ctx) => {
    const ord = getOrder(ctx.match[1]);
    if (!ord) return ctx.answerCbQuery("Order not found.", { show_alert: true });

    const hasCreds = Array.isArray(ord.delivered_items) && ord.delivered_items.length > 0;
    const credsText = hasCreds
      ? `\n🔑 <b>Delivered Credentials / Key:</b>\n<pre><code>${escapeHtml(ord.delivered_items.join("\n\n"))}</code></pre>\n`
      : `\n⏳ <b>Status:</b> Priority Dispatch in progress. Credentials will be sent to your chat shortly.\n`;

    const text =
      `📄 <b>ORDER DETAILS: <code>${ord.id}</code></b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Product:</b> <b>${escapeHtml(ord.product_name)}</b>\n` +
      `🔢 <b>Quantity:</b> <b>${ord.quantity}x</b>\n` +
      `💵 <b>Total Paid:</b> <b>${money(ord.total_price)}</b>\n` +
      `🕒 <b>Date:</b> ${new Date(ord.created_at).toLocaleString()}\n` +
      `━━━━━━━━━━━━━━━━━━━━` +
      credsText;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🔙 Back to Orders", "menu_orders"), Markup.button.callback("📞 Support", "user_reply_admin")]
    ]);

    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
    } catch (e) {
      await ctx.reply(text, { parse_mode: "HTML", ...kb });
    }
  });

  bot.action("menu_recover", async (ctx) => {
    ctx.session.awaitingRecoverOrderCode = true;
    await ctx.answerCbQuery();
    await ctx.reply(
      `🔍 <b>Order Recovery &amp; Lookup</b>\n\n` +
      `Please reply with your <b>Order Code</b> (e.g. <code>ORD-2026/11/07-A1B2C3</code>):\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // Live Proofs Screen
  async function showLiveProofsScreen(ctx) {
    const settings = getAllSettings();
    const gpText = escapeHtml(settings.group_link_text || "Join Community Group");
    const chText = escapeHtml(settings.channel_link_text || "Join Official Channel");
    const text =
      `📊 <b>LIVE ORDERS &amp; TRANSACTION PROOFS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `All completed orders for Claude Max 20x, ChatGPT Pro 20x, GCP $300, Azure PAYG, AWS 5v, and API keys are published live in our community group!\n\n` +
      `🌐 <b>Store Highlights:</b>\n` +
      `• <b>Claude Max 20x &amp; ChatGPT Pro 20x:</b> Finished Private Accounts\n` +
      `• <b>Google Cloud $300:</b> USA Region &amp; JSON Service Key Format\n` +
      `• <b>Azure &amp; AWS:</b> PAYG GPT T1–T5, Claude T5, AWS 5v 50RPM\n` +
      `• <b>Official API Keys:</b> Vertex Gemini, Claude, Bedrock, OpenAI, Azure\n\n` +
      `👥 <b>Live Proofs Group:</b> <a href="${escapeHtml(settings.group_link || "https://t.me/")}">${gpText}</a>\n` +
      `📢 <b>Official Channel:</b> <a href="${escapeHtml(settings.channel_link || "https://t.me/")}">${chText}</a>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Tap below to view real-time buyer proofs in our group:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.url("👥 View Live Proofs in Community Group", settings.group_link || "https://t.me/")],
      [Markup.button.callback("🛍️ Browse Products", "menu_store")]
    ]);

    const extra = {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
      ...kb
    };

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, extra);
      } catch (e) {
        await ctx.reply(text, extra);
      }
    } else {
      await ctx.reply(text, extra);
    }
  }

  // FAQ Screen
  async function showFaqScreen(ctx) {
    const text =
      `❓ <b>FREQUENTLY ASKED QUESTIONS (FAQ)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>1. What products are available in this store?</b>\n` +
      `• <b>AI Max Accounts:</b> Claude Max 20x ($45), ChatGPT Pro 20x ($55), Grok Heavy 1M ($18), BytePlus Seedance 2.5 ($65)\n` +
      `• <b>Cloud Accounts:</b> GCP $300 USA ($15), GCP $300 JSON ($35), Azure PAYG GPT T1–T5 ($45), Azure Claude T5 ($60), Azure FT ($12), Azure $100K 10M TPM ($250), AWS 5v 5RPM ($18) &amp; 50RPM ($32)\n` +
      `• <b>Official API Keys:</b> Vertex/AI Studio Gemini, Claude High-Quota, AWS Bedrock, OpenAI &amp; Azure Official Keys\n` +
      `• <b>Global eSIM &amp; GV:</b> International eSIM cards ($8) &amp; USA Google Voice ($6)\n\n` +
      `<b>2. How do I purchase a product?</b>\n` +
      `Top up your <b>👛 Wallet</b> via Binance Pay, USDT (BEP-20), or Polygon, then select any product under <b>🛍️ Buy Products</b> for instant checkout.\n\n` +
      `<b>3. Do you offer bulk/wholesale discounts?</b>\n` +
      `Yes! Ordering 5+ units automatically applies our bulk wholesale pricing.\n\n` +
      `<b>4. Need custom bulk stock or escrow support?</b>\n` +
      `Contact our 24/7 admin desk under <b>📞 Support</b>.`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🛍️ Open Product Catalog", "menu_store")],
      [Markup.button.callback("👛 My Wallet", "menu_wallet")]
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
    const gpText = escapeHtml(settings.group_link_text || "Join Community Group");
    const chText = escapeHtml(settings.channel_link_text || "Join Official Channel");

    const text =
      `📞 <b>24/7 CUSTOMER &amp; WHOLESALE SUPPORT</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Need help with an order, bulk stock inquiry, or wallet deposit?\n\n` +
      `👤 <b>Direct Admin:</b> <a href="https://t.me/${escapeHtml(cleanSupport)}">@${escapeHtml(cleanSupport)}</a>\n` +
      `👥 <b>Community Group:</b> <a href="${escapeHtml(settings.group_link || "https://t.me/")}">${gpText}</a>\n` +
      `📢 <b>Official Channel:</b> <a href="${escapeHtml(settings.channel_link || "https://t.me/")}">${chText}</a>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 <i>Choose an option below to reach us:</i>`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.url("💬 Chat with Support Agent", `https://t.me/${cleanSupport}`)],
      [
        Markup.button.url("👥 Community Group", settings.group_link || "https://t.me/"),
        Markup.button.url("📢 Official Channel", settings.channel_link || "https://t.me/")
      ],
      [Markup.button.callback("✍️ Message Admin Directly via Bot", "user_reply_admin")],
      [Markup.button.callback("❓ View FAQ", "menu_faq")]
    ]);

    const extra = {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
      ...kb
    };

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, extra);
      } catch (e) {
        await ctx.reply(text, extra);
      }
    } else {
      await ctx.reply(text, extra);
    }
  }

  bot.hears("📊 Live Proofs", (ctx) => showLiveProofsScreen(ctx));
  bot.command("proofs", (ctx) => showLiveProofsScreen(ctx));

  bot.hears("📞 Support", (ctx) => showSupportScreen(ctx));
  bot.command("support", (ctx) => showSupportScreen(ctx));

  bot.command("faq", (ctx) => showFaqScreen(ctx));
  bot.action("menu_faq", (ctx) => showFaqScreen(ctx));

  bot.action("user_reply_admin", async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.userAction = { type: "reply_admin" };
    await ctx.answerCbQuery();
    await ctx.reply(
      `✍️ <b>Message to Admin Support:</b>\n\n` +
      `Please type your message below. It will be delivered directly to the Store Admin.\n\n` +
      `<i>Type /cancel to cancel.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // TEXT HANDLER
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text.trim();

    if (text === "/cancel") {
      ctx.session = {};
      return ctx.reply("❌ Action canceled.", getMainMenuReplyKeyboard());
    }

    // Check if this text is for an Admin action
    const wasAdminAction = await handleAdminTextInput(bot, ctx, text);
    if (wasAdminAction) return;

    // 1. Custom Deposit Amount Input
    if (ctx.session?.awaitingCustomDepositAmount) {
      ctx.session.awaitingCustomDepositAmount = false;
      const amt = parseFloat(text.replace(/[^0-9.]/g, ""));
      if (isNaN(amt) || amt < 1) {
        return ctx.reply("❌ Invalid amount. Please enter a valid number (minimum 1 USDT).");
      }
      return showDepositMethodSelector(ctx, amt);
    }

    // 2. Custom Buy Quantity Input
    if (ctx.session?.customBuyProduct) {
      const prodId = ctx.session.customBuyProduct;
      ctx.session.customBuyProduct = null;
      const qty = parseInt(text.replace(/[^0-9]/g, ""), 10);
      if (isNaN(qty) || qty < 1) {
        return ctx.reply("❌ Invalid quantity. Please enter a whole number (e.g. 1, 5, 10).");
      }
      return handlePurchase(bot, ctx, prodId, qty);
    }

    // 3. Order Recovery Input
    if (ctx.session?.awaitingRecoverOrderCode) {
      ctx.session.awaitingRecoverOrderCode = false;
      const ord = getOrder(text);
      if (!ord) {
        return ctx.reply(`❌ No order found matching code: <code>${escapeHtml(text)}</code>`, {
          parse_mode: "HTML"
        });
      }
      const hasCreds = Array.isArray(ord.delivered_items) && ord.delivered_items.length > 0;
      const credsText = hasCreds
        ? `\n🔑 <b>Delivered Credentials / Key:</b>\n<pre><code>${escapeHtml(ord.delivered_items.join("\n\n"))}</code></pre>`
        : `\n⏳ <b>Status:</b> Priority Dispatch in progress.`;

      return ctx.reply(
        `✅ <b>ORDER RECOVERED: <code>${ord.id}</code></b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 <b>Product:</b> <b>${escapeHtml(ord.product_name)}</b>\n` +
        `🔢 <b>Quantity:</b> <b>${ord.quantity}x</b>\n` +
        `💵 <b>Total Paid:</b> <b>${money(ord.total_price)}</b>` +
        credsText,
        { parse_mode: "HTML" }
      );
    }

    // 4. User sending message directly to Admin
    if (ctx.session?.userAction?.type === "reply_admin") {
      ctx.session.userAction = null;
      const adminId = ADMIN_ID || getSetting("admin_telegram_id");
      const user = ctx.from;
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "User";
      const username = user.username ? `@${user.username}` : "None";

      if (adminId) {
        bot.telegram.sendMessage(
          adminId,
          `<blockquote>💬 <b>NEW BUYER MESSAGE RECEIVED</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>From:</b> <b>${escapeHtml(name)}</b> (${username})\n` +
          `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
          `📝 <b>Message:</b>\n${escapeHtml(text)}</blockquote>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("📩 Reply to Buyer", `adm_user_dm:${user.id}`)],
              [Markup.button.callback("👤 View Buyer Profile", `adm_view_user:${user.id}`)]
            ])
          }
        ).catch(() => {});
      }

      return ctx.reply("✅ <b>Your message has been sent to Admin Support!</b>\nWe will reply to you shortly.", {
        parse_mode: "HTML",
        ...getMainMenuReplyKeyboard()
      });
    }

    // 5. User Deposit Proof Submission (TxID text)
    if (ctx.session?.depositState?.step === "awaiting_proof") {
      const { method, amount } = ctx.session.depositState;
      ctx.session.depositState = null;

      const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
      const deposit = createDeposit({
        user_id: user.id,
        user_name: user.username ? `@${user.username}` : user.first_name,
        amount: amount || 15.00,
        method,
        proof: text
      });

      await ctx.reply(
        `✅ <b>Deposit Proof Submitted!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Deposit ID:</b> <code>${deposit.id}</code>\n` +
        `💵 <b>Amount:</b> <b>${money(deposit.amount)}</b>\n` +
        `⚡️ <b>Method:</b> ${method}\n` +
        `📝 <b>Proof:</b> <code>${escapeHtml(text)}</code>\n\n` +
        `⏳ <i>Our admin team will verify your payment and credit your wallet balance shortly!</i>`,
        {
          parse_mode: "HTML",
          ...getMainMenuReplyKeyboard()
        }
      );

      // Notify Admin
      bot.telegram.sendMessage(
        ADMIN_ID,
        `🔔 <b>NEW WALLET DEPOSIT REQUEST!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>ID:</b> <code>${deposit.id}</code>\n` +
        `👤 <b>Buyer:</b> @${user.username || user.first_name} (ID: <code>${user.id}</code>)\n` +
        `💵 <b>Amount:</b> <b>${money(deposit.amount)}</b>\n` +
        `🌐 <b>Method:</b> ${method}\n` +
        `📝 <b>Proof:</b> <code>${escapeHtml(text)}</code>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`✅ Approve & Credit ${money(deposit.amount)}`, `adm_dep_app:${deposit.id}`)],
            [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${deposit.id}`)]
          ])
        }
      ).catch(() => {});

      return;
    }

    return next();
  });

  // Photo upload handler for deposits
  bot.on("photo", async (ctx) => {
    if (ctx.session?.depositState?.step === "awaiting_proof") {
      const { method, amount } = ctx.session.depositState;
      ctx.session.depositState = null;

      const user = getUser(ctx.from.id) || getOrCreateUser(ctx.from).user;
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      const caption = ctx.message.caption || "Screenshot payment receipt";

      const deposit = createDeposit({
        user_id: user.id,
        user_name: user.username ? `@${user.username}` : user.first_name,
        amount: amount || 15.00,
        method,
        proof: caption,
        photo_file_id: largestPhoto.file_id
      });

      await ctx.reply(
        `✅ <b>Deposit Screenshot Received!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <b>Deposit ID:</b> <code>${deposit.id}</code>\n` +
        `💵 <b>Amount:</b> <b>${money(deposit.amount)}</b>\n` +
        `⚡️ <b>Method:</b> ${method}\n\n` +
        `⏳ <i>Our admin team will review your receipt and credit your wallet balance shortly!</i>`,
        {
          parse_mode: "HTML",
          ...getMainMenuReplyKeyboard()
        }
      );

      // Forward receipt to Admin
      bot.telegram.sendPhoto(ADMIN_ID, largestPhoto.file_id, {
        caption:
          `🔔 <b>NEW WALLET DEPOSIT (SCREENSHOT)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 <b>ID:</b> <code>${deposit.id}</code>\n` +
          `👤 <b>Buyer:</b> @${user.username || user.first_name} (ID: <code>${user.id}</code>)\n` +
          `💵 <b>Amount:</b> <b>${money(deposit.amount)}</b>\n` +
          `🌐 <b>Method:</b> ${method}\n` +
          `📝 <b>Caption:</b> ${escapeHtml(caption)}`,
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Approve & Credit ${money(deposit.amount)}`, `adm_dep_app:${deposit.id}`)],
          [Markup.button.callback("❌ Reject Deposit", `adm_dep_rej:${deposit.id}`)]
        ])
      }).catch(() => {});
    }
  });
}

module.exports = {
  showStoreMenu,
  showProductDetails,
  showWalletScreen,
  showOrdersScreen,
  showReferralScreen,
  registerUserHandlers
};
