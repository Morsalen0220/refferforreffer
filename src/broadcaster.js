const { Markup } = require("telegraf");
const {
  getAllSettings,
  setSetting,
  getAllProducts,
  getProduct,
  getUnitPrice,
  updateProduct,
  getRandomRestockQuantity,
  deductProductStockAndAutoRestock
} = require("./store");
const { getRandomCustomerName } = require("./names");
const { getRealCryptoTransactionProof } = require("./realTransactions");
const { money, escapeHtml, getBotUsername, getChatTargetCandidates } = require("./helpers");

let botInstance = null;
let isBroadcasterStarted = false;

// Rolling 20-minute window tracker to strictly cap auto-posts at maximum 3 per 20 minutes
const TWENTY_MINUTES_MS = 20 * 60 * 1000;
const MAX_POSTS_PER_20_MINS = 3;
let autoPostTimestamps = [];

function setBroadcasterBot(bot) {
  botInstance = bot;
}

// Send message specifically to the designated Community Group (not Channel)
async function sendToGroupOnly(msg, keyboard) {
  if (!botInstance) return { success: false, error: "Bot not initialized" };

  const settings = getAllSettings();
  const candidates = getChatTargetCandidates(settings.group_id, settings.group_link);

  if (candidates.length === 0) {
    return { success: false, error: "No group_id or public group_link configured in settings" };
  }

  let lastError = "Unknown error";
  for (const target of candidates) {
    try {
      const res = await botInstance.telegram.sendMessage(target, msg, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true },
        ...keyboard
      });
      if (res?.chat?.id && String(res.chat.id) !== String(settings.group_id)) {
        setSetting("group_id", String(res.chat.id));
      }
      console.log(`📢 [Group Auto-Poster] Successfully sent notice to Group (${res?.chat?.id || target})`);
      return { success: true, messageId: res.message_id };
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`[Group Auto-Poster Error] Failed candidate (${target}):`, lastError);
    }
  }

  return { success: false, error: lastError };
}

// 1. Realtime Wallet Deposit Notice (Matches exact live product price)
async function sendGroupDepositNotice(customerName, amount = 45.00, methodLabel = null, targetProductName = null) {
  const settings = getAllSettings();
  const txProof = getRealCryptoTransactionProof(settings.binance_pay_enabled !== false);
  const label = methodLabel || txProof.methodLabel;
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const productLine = targetProductName
    ? `📦 <b>For Product:</b> <b>${escapeHtml(targetProductName)}</b>\n`
    : "";

  const msg =
    `<blockquote>💰 <b>WALLET DEPOSIT CONFIRMED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Buyer:</b> <b>${escapeHtml(customerName)}</b>\n` +
    productLine +
    `💵 <b>Amount Credited:</b> <b>+${money(amount)}</b>\n` +
    `🌐 <b>Method:</b> ${txProof.gatewayIcon} <b>${label}</b>\n` +
    `🔗 <b>TxID:</b> <a href="${txProof.txUrl}">${txProof.txId}</a>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `✅ <b>Status:</b> <b>Instant Wallet Credit</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡️ <i>Fund your wallet &amp; buy AI / Cloud accounts with instant delivery!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🛍️ Open Cloud & AI Store", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// 2. Realtime Product Order Completed Notice (Auto deducts stock & auto restocks >60 when 0)
async function sendGroupOrderNotice(
  customerName,
  productName = "Claude Max 20x (Finished Account)",
  quantity = 1,
  totalAmount = 45.00,
  unitPrice = null,
  deductFromStore = true
) {
  const settings = getAllSettings();
  const txProof = getRealCryptoTransactionProof(settings.binance_pay_enabled !== false);
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const calcUnit = unitPrice !== null ? Number(unitPrice) : Number((Number(totalAmount) / Math.max(1, quantity)).toFixed(2));

  let stockResult = null;
  if (deductFromStore) {
    stockResult = deductProductStockAndAutoRestock(productName, quantity);
  } else {
    const existingProd = getAllProducts().find((p) => p.id === productName || p.name === productName);
    if (existingProd) {
      stockResult = {
        product: existingProd,
        remainingBeforeRestock: existingProd.stock,
        autoRestocked: false,
        restockedAmount: 0
      };
    }
  }

  const remainingLine = stockResult
    ? `📊 <b>Remaining Stock:</b> <b>${
        stockResult.autoRestocked
          ? `0 Left (Sold Out ➔ Auto-Restocking!)`
          : `${stockResult.remainingBeforeRestock} Units Left`
      }</b>\n`
    : "";

  const msg =
    `<blockquote>🛍️ <b>NEW ORDER DELIVERED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Buyer:</b> <b>${escapeHtml(customerName)}</b>\n` +
    `📦 <b>Product:</b> <b>${escapeHtml(productName)}</b>\n` +
    `🏷️ <b>Unit Price:</b> <b>${money(calcUnit)}</b>${quantity >= 5 ? " <i>(Bulk Rate)</i>" : ""}\n` +
    `🔢 <b>Quantity:</b> <b>${quantity}x Unit(s)</b>\n` +
    `💵 <b>Total Paid:</b> <b>${money(totalAmount)}</b>\n` +
    remainingLine +
    `🌐 <b>Payment:</b> ${txProof.gatewayIcon} <b>${txProof.methodLabel}</b>\n` +
    `🔗 <b>TxID:</b> <a href="${txProof.txUrl}">${txProof.txId}</a>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `✅ <b>Delivery:</b> <b>Dispatched Instantly ⚡️</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🚀 <i>Claude Max 20x • ChatGPT Pro • GCP $300 • Azure PAYG • AWS 5v in stock!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🛒 Buy Instantly in Bot", `https://t.me/${botUsername}`)]]);
  const sendRes = await sendToGroupOnly(msg, keyboard);

  // If stock hit 0 during this sell post, announce the new >60 auto-restocked batch!
  if (stockResult && stockResult.autoRestocked && stockResult.product) {
    const prod = stockResult.product;
    const bulkUnit = getUnitPrice(prod, 5);
    setTimeout(() => {
      sendGroupRestockNotice(prod.name, stockResult.restockedAmount, prod.price, bulkUnit).catch(() => {});
    }, 3500);
  }

  return sendRes;
}

// 3. Stock Restock Notice (Uses exact product price & bulk tier price)
async function sendGroupRestockNotice(productName = "Google Cloud GCP $300 (USA Region)", addedUnits = 25, unitPrice = 15.00, bulkPrice = null) {
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const bulkLine = bulkPrice && bulkPrice < unitPrice
    ? `📦 <b>Bulk Price (5+):</b> <b>${money(bulkPrice)} / each</b>\n`
    : "";

  const msg =
    `<blockquote>🔥 <b>FRESH BATCH RESTOCKED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>Product:</b> <b>${escapeHtml(productName)}</b>\n` +
    `➕ <b>Added Stock:</b> <b>+${addedUnits} Fresh Units</b>\n` +
    `💵 <b>Unit Price:</b> <b>${money(unitPrice)}</b>\n` +
    bulkLine +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `⚡️ <b>Status:</b> <b>Verified &amp; Ready for Instant Delivery</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>Tap below to grab yours before stock runs out!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🛍️ Order Now", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// 4. Free 30-Referral ChatGPT Shared Account (1 Month) Reward Notice
async function sendGroupFreeRewardNotice(userName = "Verified Member", rewardTitle = "ChatGPT Shared Account (1 Month)", refCount = 30) {
  const botUsername = await getBotUsername(botInstance);
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const msg =
    `<blockquote>🎁 <b>FREE REFERRAL REWARD CLAIMED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Winner:</b> <b>${escapeHtml(userName)}</b>\n` +
    `🏆 <b>Free Reward:</b> <b>1x ${escapeHtml(rewardTitle)}</b>\n` +
    `👥 <b>Milestone:</b> <b>${refCount} Referrals Completed!</b>\n` +
    `💵 <b>Cost:</b> <b>$0.00 USDT (100% FREE 🎁)</b>\n` +
    `🕒 <b>Time:</b> <code>${timeStr}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥 <i>Invite ${refCount} friends to the bot &amp; claim your FREE ChatGPT Shared Account (1 Month)!</i></blockquote>`;

  const keyboard = Markup.inlineKeyboard([[Markup.button.url("🎁 Claim Free ChatGPT (1M)", `https://t.me/${botUsername}`)]]);
  return sendToGroupOnly(msg, keyboard);
}

// Background scheduler for group auto broadcasts
// STRICT LIMIT: Maximum 3 posts per 20 minutes (spaced ~7 to 9.5 minutes apart)
function scheduleNextGroupBroadcast(isFirstRun = false) {
  // First run: 30-45 seconds; subsequent runs: 6m 45s to 9m 30s (405,000ms to 570,000ms)
  const minMs = isFirstRun ? 30 * 1000 : 405 * 1000;
  const maxMs = isFirstRun ? 45 * 1000 : 570 * 1000;
  const delayMs = Math.floor(minMs + Math.random() * (maxMs - minMs));

  setTimeout(async () => {
    try {
      const settings = getAllSettings();
      if (settings.auto_broadcast_enabled !== false && (settings.group_id || settings.group_link)) {
        const now = Date.now();
        // Purge timestamps older than 20 minutes
        autoPostTimestamps = autoPostTimestamps.filter((ts) => now - ts < TWENTY_MINUTES_MS);

        // Enforce strict cap: never exceed 3 posts within any 20-minute window
        if (autoPostTimestamps.length < MAX_POSTS_PER_20_MINS) {
          const products = getAllProducts().filter((p) => !p.outOfStock);
          if (products.length > 0) {
            const name = getRandomCustomerName();
            const prod = products[Math.floor(Math.random() * products.length)];
            const roll = Math.random();

            const qtyOptions = prod.price >= 100 ? [1] : [1, 1, 1, 1, 2, 3, 5];
            const qty = qtyOptions[Math.floor(Math.random() * qtyOptions.length)];

            const exactUnitPrice = getUnitPrice(prod, qty);
            const exactTotalPrice = Number((exactUnitPrice * qty).toFixed(2));

            let res = { success: false };
            if (roll < 0.72) {
              res = await sendGroupOrderNotice(name, prod.name, qty, exactTotalPrice, exactUnitPrice, true);
            } else if (roll < 0.92) {
              res = await sendGroupDepositNotice(name, exactTotalPrice, null, `${prod.name}${qty > 1 ? ` (${qty}x)` : ""}`);
            } else {
              const batch = getRandomRestockQuantity(); // Strictly > 60 (61 to 120 units)
              updateProduct(prod.id, { stock: batch, outOfStock: false });
              const bulkUnit = getUnitPrice(prod, 5);
              res = await sendGroupRestockNotice(prod.name, batch, prod.price, bulkUnit);
            }

            if (res && res.success) {
              autoPostTimestamps.push(Date.now());
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
  sendGroupOrderNotice,
  sendGroupRestockNotice,
  sendGroupFreeRewardNotice,
  startGroupBroadcaster
};
