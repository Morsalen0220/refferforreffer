require("dotenv").config();

const express = require("express");
const { Telegraf, session } = require("telegraf");

const { initStore } = require("./store");
const { startGroupBroadcaster } = require("./broadcaster");
const { registerUserHandlers } = require("./handlers/user");
const { registerAdminHandlers } = require("./handlers/admin");

// =====================================================
// ENVIRONMENT VALIDATION
// =====================================================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

if (!TOKEN) {
  throw new Error("Missing BOT_TOKEN in .env");
}

if (!ADMIN_ID) {
  throw new Error("Missing ADMIN_TELEGRAM_ID in .env");
}

// =====================================================
// TELEGRAF INSTANCE & MIDDLEWARE
// =====================================================
const bot = new Telegraf(TOKEN);

bot.catch((err, ctx) => {
  console.error(`[Telegraf Error] update_id=${ctx?.update?.update_id}:`, err.message || err);
});

bot.use(
  session({
    defaultSession: () => ({})
  })
);

bot.use((ctx, next) => {
  ctx.session ??= {};
  return next();
});

// =====================================================
// REGISTER BOT MODULES
// =====================================================
// 1. Admin Control Panel Handlers (/admin, approvals, broadcasts, settings)
registerAdminHandlers(bot);

// 2. User Dashboard Handlers (/start, referrals, withdraw, deposit, support)
registerUserHandlers(bot);

// =====================================================
// EXPRESS HEALTH-CHECK SERVER & BOT LAUNCH
// =====================================================
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("USDT Referral & Earning Telegram Bot is running!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;

let server;
let isShuttingDown = false;

async function startApp() {
  // 1. Load Firebase / Local DB snapshot
  await initStore();

  // 2. Start automated social proof broadcaster for Group
  startGroupBroadcaster(bot);

  // 3. Register official Telegram native Bot Menu Commands (smooth background sync with retry)
  const registerCommandsWithRetry = async (retries = 3) => {
    try {
      await bot.telegram.setMyCommands([
        { command: "start", description: "🚀 Open Main Dashboard" },
        { command: "balance", description: "💰 View Wallet Balance & Referral Stats" },
        { command: "refer", description: "👥 Get Referral Link & Progress" },
        { command: "withdraw", description: "💳 Request Instant Withdrawal" },
        { command: "proofs", description: "📊 View Live Payment Proofs" },
        { command: "faq", description: "❓ Frequently Asked Questions & Rules" },
        { command: "support", description: "📞 24/7 Official Customer Support" }
      ]);
      console.log("✅ Official Telegram Bot Commands menu registered successfully!");
    } catch (err) {
      if (retries > 0) {
        setTimeout(() => registerCommandsWithRetry(retries - 1), 4000);
      }
    }
  };

  setTimeout(() => registerCommandsWithRetry(3), 2500);

  // 4. Webhook vs Polling Mode
  if (WEBHOOK_URL) {
    const cleanUrl = WEBHOOK_URL.replace(/\/+$/, "");
    const secretPath = `/webhook/${bot.secretPathComponent ? bot.secretPathComponent() : "telegraf"}`;
    app.use(bot.webhookCallback(secretPath));

    server = app.listen(PORT, "0.0.0.0", async () => {
      console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
      try {
        await bot.telegram.setWebhook(`${cleanUrl}${secretPath}`);
        console.log(`Telegram webhook registered at: ${cleanUrl}${secretPath}`);
      } catch (err) {
        console.error("Failed to register Telegram webhook:", err.message);
      }
    });
  } else {
    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`HTTP server listening on 0.0.0.0:${PORT}`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${PORT} in use; skipping extra HTTP listener.`);
      } else {
        console.error("HTTP server error:", err);
      }
    });

    const launchBot = () => {
      if (isShuttingDown) return;
      bot.launch({
        dropPendingUpdates: false
      })
        .catch((error) => {
          console.error("Bot launch network glitch:", error.message || error);
          if (!isShuttingDown) {
            console.log("Reconnecting in 4 seconds...");
            setTimeout(launchBot, 4000);
          }
        });

      console.log("🚀 USDT Referral & Earning Telegram Bot started successfully (polling mode).");
    };

    launchBot();
  }
}

// Graceful shutdown
process.once("SIGINT", () => {
  isShuttingDown = true;
  bot.stop("SIGINT");
  if (server) server.close();
});

process.once("SIGTERM", () => {
  isShuttingDown = true;
  bot.stop("SIGTERM");
  if (server) server.close();
});

startApp();
