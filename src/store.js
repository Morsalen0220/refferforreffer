const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  isFirebaseConfigured,
  initFirebase,
  fetchFirebaseData,
  saveFirebaseData,
  listenFirebaseData
} = require("./firebase");

const file = process.env.DATABASE_FILE || "./data/bot-data.json";
fs.mkdirSync(path.dirname(file), { recursive: true });

const defaultProducts = [
  // --- Category 1: AI Max & Pro Subscriptions (ai_sub) ---
  {
    id: "claude_max_20x",
    category: "ai_sub",
    name: "Claude Max 20x (Finished Account)",
    price: 45.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 45.00 },
      { min: 5, max: 999999, price: 40.00 }
    ],
    stock: 35,
    outOfStock: false,
    description: "✅ Official Claude Max 20x Usage Limit (Finished Account)\n⚡️ Full 20x message capacity • Claude 3.7 Sonnet & Opus access\n🔒 Ready-to-use private credentials delivered instantly",
    terms: "• Full private login credentials delivered upon purchase\n• Do not violate Anthropic mass-scraping policies\n• 100% verified active 20x Max subscription"
  },
  {
    id: "chatgpt_pro_20x",
    category: "ai_sub",
    name: "ChatGPT Pro 20x ($200 Tier Account)",
    price: 55.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 55.00 },
      { min: 5, max: 999999, price: 50.00 }
    ],
    stock: 28,
    outOfStock: false,
    description: "✅ Official OpenAI ChatGPT Pro (20x / $200 Monthly Tier)\n⚡️ Unlimited GPT-4o, o1, o1-pro mode & Sora access\n🔒 Private finished account • Instant delivery",
    terms: "• Full private account credentials delivered immediately\n• Verified active ChatGPT Pro subscription"
  },
  {
    id: "chatgpt_shared_1m",
    category: "ai_sub",
    name: "ChatGPT Shared Account (1 Month)",
    price: 3.50,
    bulk_tiers: [
      { min: 1, max: 4, price: 3.50 },
      { min: 5, max: 999999, price: 3.00 }
    ],
    stock: 80,
    outOfStock: false,
    description: "✅ Official ChatGPT Plus/Pro Shared Account (1 Month Access)\n⚡️ Full access to GPT-4o, o1, DALL-E 3 & Advanced Voice\n🎁 Also available 100% FREE by inviting 30 friends!",
    terms: "• Valid for 30 days from delivery\n• Do not change shared account password"
  },
  {
    id: "grok_heavy_1m",
    category: "ai_sub",
    name: "Grok Heavy (1 Month Subscription)",
    price: 18.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 18.00 },
      { min: 5, max: 999999, price: 16.00 }
    ],
    stock: 50,
    outOfStock: false,
    description: "✅ SuperGrok / Grok Heavy 1-Month Full Access Account\n⚡️ DeepSearch, Think Mode & unrestricted image generation\n🔒 Private account ready for immediate login",
    terms: "• Valid for 30 days from delivery\n• Instant automated credential delivery"
  },
  {
    id: "byteplus_seedance",
    category: "ai_sub",
    name: "BytePlus Seedance 2.5 (Enterprise Sub)",
    price: 65.00,
    bulk_tiers: [
      { min: 1, max: 2, price: 65.00 },
      { min: 3, max: 999999, price: 58.00 }
    ],
    stock: 15,
    outOfStock: false,
    description: "✅ Verified BytePlus Enterprise Account with Seedance 2.5 Subscription\n⚡️ High-tier AI video & model generation quota\n🔒 US Corporate verified profile",
    terms: "• Full enterprise console login delivered\n• Verified active subscription status"
  },

  // --- Category 2: Cloud Trial & Enterprise Accounts (cloud_acc) ---
  {
    id: "gcp_300_usa",
    category: "cloud_acc",
    name: "Google Cloud GCP $300 (USA Region)",
    price: 15.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 15.00 },
      { min: 5, max: 999999, price: 13.50 }
    ],
    stock: 60,
    outOfStock: false,
    description: "✅ Google Cloud Platform (GCP) $300 Free Trial Account (USA IP)\n⚡️ Supports Vertex AI (Gemini/Claude), Compute VMs & Kubernetes\n🔒 Clean billing profile • Pre-paid & Unpaid stock available",
    terms: "• Full Google Cloud account login + recovery email\n• Guaranteed $300 full credit balance on initial login"
  },
  {
    id: "gcp_300_json",
    category: "cloud_acc",
    name: "GCP $300 Credit (JSON Service Key Format)",
    price: 35.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 35.00 },
      { min: 5, max: 999999, price: 32.00 }
    ],
    stock: 40,
    outOfStock: false,
    description: "✅ Google Cloud $300 Account with Ready JSON Service Account Key\n⚡️ Pre-configured for Vertex AI Gemini & Claude API calls\n🔒 Plug-and-play JSON format + full account access",
    terms: "• Delivered with JSON key + full console login\n• Verified $300 active trial credit"
  },
  {
    id: "azure_payg_gpt",
    category: "cloud_acc",
    name: "Azure Pay-As-You-Go (GPT T1–T5 All Models)",
    price: 45.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 45.00 },
      { min: 5, max: 999999, price: 40.00 }
    ],
    stock: 25,
    outOfStock: false,
    description: "✅ Microsoft Azure Pay-As-You-Go (PAYG / 跑付) Account\n⚡️ Azure OpenAI GPT-4o / o1 / GPT-4 Turbo (Tier 1 to Tier 5)\n🌍 Multi-region unlocked, all models enabled",
    terms: "• Full Azure Portal credentials delivered\n• Active PAYG billing with OpenAI quota approved"
  },
  {
    id: "azure_claude_t5",
    category: "cloud_acc",
    name: "Azure Claude Pay-As-You-Go (Tier 5)",
    price: 60.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 60.00 },
      { min: 5, max: 999999, price: 54.00 }
    ],
    stock: 18,
    outOfStock: false,
    description: "✅ Azure Pay-As-You-Go Account with Claude Tier-5 Access\n⚡️ High RPM/TPM enterprise rate limits for production AI\n🔒 Ready for immediate API & endpoint deployment",
    terms: "• Full Azure console login + API endpoint access\n• Verified T5 quota active on delivery"
  },
  {
    id: "azure_ft_200",
    category: "cloud_acc",
    name: "Azure Free Trial ($200 Credit Account)",
    price: 12.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 12.00 },
      { min: 5, max: 999999, price: 10.50 }
    ],
    stock: 30,
    outOfStock: false,
    description: "✅ Fresh Microsoft Azure Free Trial ($200 USD Credit)\n⚡️ Ideal for Windows/Linux RDP, VPS & AI testing\n🔒 Clean IP & verified payment method attached",
    terms: "• Full portal login + recovery details\n• Guaranteed $200 active credit on login"
  },
  {
    id: "azure_100k_10m",
    category: "cloud_acc",
    name: "Azure $100K Credit (10M TPM Enterprise)",
    price: 250.00,
    bulk_tiers: [
      { min: 1, max: 999999, price: 250.00 }
    ],
    stock: 5,
    outOfStock: false,
    description: "✅ Enterprise Azure Account with $100,000 Credit & 10M TPM Quota\n⚡️ Massive 10 Million Tokens-Per-Minute OpenAI throughput\n🔒 Full ownership transfer (Clean IP / Full Sale)",
    terms: "• Complete administrative ownership transfer\n• Verified 10M TPM enterprise allocation"
  },
  {
    id: "aws_5v_5rpm",
    category: "cloud_acc",
    name: "AWS Cloud 5vCPU (5 RPM AI Quota)",
    price: 18.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 18.00 },
      { min: 5, max: 999999, price: 15.50 }
    ],
    stock: 45,
    outOfStock: false,
    description: "✅ Amazon Web Services (AWS) 5vCPU Account (5 RPM Bedrock Quota)\n⚡️ EC2 + AWS Bedrock AI enabled\n📦 Bulk stock available for immediate dispatch",
    terms: "• Root login + MFA/API keys included\n• Verified active 5v 5rpm quota"
  },
  {
    id: "aws_5v_50rpm",
    category: "cloud_acc",
    name: "AWS Cloud 5vCPU (50 RPM High-Speed)",
    price: 32.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 32.00 },
      { min: 5, max: 999999, price: 28.00 }
    ],
    stock: 35,
    outOfStock: false,
    description: "✅ Amazon Web Services (AWS) 5vCPU with 50 RPM High Quota\n⚡️ High-concurrency Bedrock Claude & AI model invocation\n📦 Bulk orders supported with volume discount",
    terms: "• Full AWS root console + IAM keys\n• Guaranteed 5v 50rpm active quota"
  },

  // --- Category 3: High-Quota Official API Keys (api_key) ---
  {
    id: "vertex_gemini_key",
    category: "api_key",
    name: "Vertex AI / AI Studio Gemini Pro API Key",
    price: 12.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 12.00 },
      { min: 5, max: 999999, price: 10.00 }
    ],
    stock: 80,
    outOfStock: false,
    description: "✅ Official Google Vertex AI & AI Studio Gemini Pro API Key\n⚡️ High RPM/TPM paid-tier key (Gemini 1.5 Pro / 2.0 Flash & Pro)\n🔌 Works with Cursor, Cline, Roo-Code, Python & Node.js",
    terms: "• Instant API key token delivery\n• Guaranteed active paid-tier rate limits"
  },
  {
    id: "claude_high_key",
    category: "api_key",
    name: "Claude 3.5 / 3.7 Sonnet High-Quota API Key",
    price: 25.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 25.00 },
      { min: 5, max: 999999, price: 22.00 }
    ],
    stock: 45,
    outOfStock: false,
    description: "✅ Official Anthropic Claude High-Quota API Key (大额官Key)\n⚡️ 200K Context Window • High Tier RPM & TPM\n🔌 Plug directly into Cursor, Cline, Claude Code & SillyTavern",
    terms: "• Official sk-ant-* key delivered instantly\n• Pre-funded verified quota balance"
  },
  {
    id: "aws_bedrock_key",
    category: "api_key",
    name: "AWS Bedrock (AWSB) High-Quota Claude Key",
    price: 30.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 30.00 },
      { min: 5, max: 999999, price: 26.00 }
    ],
    stock: 38,
    outOfStock: false,
    description: "✅ AWS Bedrock Official High-Quota API Credentials (AWSB 大额官Key)\n⚡️ Unrestricted Claude 3.5/3.7 Sonnet & Opus throughput\n🔌 Includes Access Key, Secret Key & Region endpoint",
    terms: "• Instant credential delivery\n• Verified active Bedrock model access"
  },
  {
    id: "openai_official_key",
    category: "api_key",
    name: "OpenAI Official High-Quota API Key (OAI 官Key)",
    price: 22.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 22.00 },
      { min: 5, max: 999999, price: 19.00 }
    ],
    stock: 55,
    outOfStock: false,
    description: "✅ Official OpenAI High-Tier API Key (GPT-4o, o1, o3-mini)\n⚡️ High TPM/RPM Tier • Compatible with all OpenAI SDKs\n🔌 Instant token delivery",
    terms: "• Official sk-* API key delivered immediately\n• Guaranteed active balance on arrival"
  },
  {
    id: "azure_official_key",
    category: "api_key",
    name: "Azure OpenAI Official API Key (AZ 官Key)",
    price: 20.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 20.00 },
      { min: 5, max: 999999, price: 17.50 }
    ],
    stock: 50,
    outOfStock: false,
    description: "✅ Official Azure OpenAI Endpoint + High-Limit API Key\n⚡️ Enterprise SLA stability • GPT-4o & o1 deployments ready\n🔌 Low latency, zero random bans",
    terms: "• Delivered with Endpoint URL + API Key + Deployment Name\n• Verified active quota"
  },

  // --- Category 4: Global eSIM & Verification Tools (esim_tools) ---
  {
    id: "global_esim",
    category: "esim_tools",
    name: "Global eSIM Card (US/UK/CA/JP/AU/EU/IN/TW)",
    price: 8.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 8.00 },
      { min: 5, max: 999999, price: 6.50 }
    ],
    stock: 100,
    outOfStock: false,
    description: "✅ International eSIM Profile (USA, Canada, UK, Japan, Taiwan, India, France, Germany, Australia, UAE)\n⚡️ Instant QR code activation • Receive SMS & roaming data\n📱 Works on all eSIM-compatible phones",
    terms: "• Delivered with activation QR / LPA code\n• Specify preferred country with support if needed"
  },
  {
    id: "google_voice_gv",
    category: "esim_tools",
    name: "Google Voice (GV) Aged USA Account",
    price: 6.00,
    bulk_tiers: [
      { min: 1, max: 4, price: 6.00 },
      { min: 5, max: 999999, price: 5.00 }
    ],
    stock: 90,
    outOfStock: false,
    description: "✅ Aged USA Google Voice (GV) Number Account\n⚡️ Send & receive USA SMS/Calls for AI, Cloud & Social registration\n🔒 Clean permanent number with full Gmail access",
    terms: "• Full account login + recovery email included\n• Guaranteed active GV number on initial login"
  }
];

const defaultSettings = {
  bot_title: "Cloud & AI Resource Store",
  min_deposit_amount: 5.00,
  referrals_for_free_reward: 30,
  free_reward_title: "ChatGPT Shared Account (1 Month)",
  channel_id: process.env.FORCE_CHANNEL_ID || "-1004420926145",
  channel_link: process.env.FORCE_CHANNEL_LINK || "https://t.me/RefferRewardss",
  channel_link_text: "Join Official Channel",
  group_id: process.env.FORCE_GROUP_ID || "-1004378930616",
  group_link: process.env.FORCE_GROUP_LINK || "https://t.me/RefferRewardes",
  group_link_text: "Join Community Group",
  force_join_enabled: false,
  bep20_usdt_address: process.env.BEP20_USDT_ADDRESS || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF",
  polygon_usdt_address: process.env.POLYGON_USDT_ADDRESS || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF",
  ltc_address: process.env.LTC_ADDRESS || "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  binance_pay_id: process.env.BINANCE_PAY_ID || "350946509",
  binance_pay_enabled: true,
  support_username: process.env.SUPPORT_USERNAME || "@Morsalen0220",
  auto_broadcast_enabled: true
};

const defaults = {
  settings: defaultSettings,
  products: defaultProducts,
  stock_items: {}, // { [productId]: ["credential1", "credential2"] }
  users: {},
  deposits: [],
  orders: []
};

let memoryDb = null;

function normalizeDb(raw) {
  if (!raw || typeof raw !== "object") return structuredClone(defaults);

  if (!raw.settings || typeof raw.settings !== "object") {
    raw.settings = structuredClone(defaultSettings);
  } else {
    raw.settings = { ...defaultSettings, ...raw.settings };
    if (process.env.FORCE_GROUP_ID && raw.settings.group_id === "-1004378930616") {
      raw.settings.group_id = process.env.FORCE_GROUP_ID;
    }
    if (process.env.FORCE_GROUP_LINK && raw.settings.group_link === "https://t.me/RefferRewardes") {
      raw.settings.group_link = process.env.FORCE_GROUP_LINK;
    }
    if (process.env.FORCE_CHANNEL_ID && raw.settings.channel_id === "-1004420926145") {
      raw.settings.channel_id = process.env.FORCE_CHANNEL_ID;
    }
    if (process.env.FORCE_CHANNEL_LINK && raw.settings.channel_link === "https://t.me/RefferRewardss") {
      raw.settings.channel_link = process.env.FORCE_CHANNEL_LINK;
    }
  }

  // Ensure new AI/Cloud products are loaded if missing or outdated
  const hasNewCatalog =
    Array.isArray(raw.products) &&
    raw.products.some((p) => p && p.id === "claude_max_20x") &&
    raw.products.some((p) => p && p.id === "chatgpt_shared_1m");

  if (!hasNewCatalog) {
    raw.products = structuredClone(defaultProducts);
  }

  if (!raw.stock_items || typeof raw.stock_items !== "object") {
    raw.stock_items = {};
  }

  if (!raw.users || typeof raw.users !== "object") raw.users = {};

  if (!Array.isArray(raw.deposits)) {
    if (raw.deposits && typeof raw.deposits === "object") raw.deposits = Object.values(raw.deposits);
    else raw.deposits = [];
  }

  if (!Array.isArray(raw.orders)) {
    if (raw.orders && typeof raw.orders === "object") raw.orders = Object.values(raw.orders);
    else raw.orders = [];
  }

  return raw;
}

function loadLocalFile() {
  if (!fs.existsSync(file)) {
    const fresh = structuredClone(defaults);
    try {
      fs.writeFileSync(file, JSON.stringify(fresh, null, 2), "utf8");
    } catch (e) {}
    return fresh;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const normalized = normalizeDb(parsed);
    try {
      fs.writeFileSync(file, JSON.stringify(normalized, null, 2), "utf8");
    } catch (e) {}
    return normalized;
  } catch (err) {
    console.error("Error reading local database file, using defaults:", err.message);
    return structuredClone(defaults);
  }
}

let localWriteTimeout = null;
function scheduleLocalFileWrite(db) {
  if (localWriteTimeout) clearTimeout(localWriteTimeout);
  localWriteTimeout = setTimeout(() => {
    fs.promises.writeFile(file, JSON.stringify(db, null, 2), "utf8").catch((e) => {
      console.error("Local file write error:", e.message);
    });
  }, 500);
}

async function initStore() {
  if (isFirebaseConfigured()) {
    try {
      initFirebase();
      const remoteData = await fetchFirebaseData();
      if (remoteData && (remoteData.users || remoteData.settings || remoteData.products || remoteData.orders)) {
        console.log("📥 Loaded database snapshot from Google Firebase Realtime Database!");
        memoryDb = normalizeDb(remoteData);
        scheduleLocalFileWrite(memoryDb);
      } else {
        console.log("📤 Initializing Firebase Realtime Database with local database seed...");
        memoryDb = loadLocalFile();
        saveFirebaseData(memoryDb);
      }

      listenFirebaseData((remoteUpdated) => {
        if (remoteUpdated) {
          memoryDb = normalizeDb(remoteUpdated);
          scheduleLocalFileWrite(memoryDb);
        }
      });
      return memoryDb;
    } catch (e) {
      console.error("Firebase startup sync error, falling back to local file:", e.message);
      memoryDb = loadLocalFile();
      return memoryDb;
    }
  } else {
    memoryDb = loadLocalFile();
    return memoryDb;
  }
}

function load() {
  if (!memoryDb) {
    memoryDb = loadLocalFile();
  }
  return memoryDb;
}

function save(db) {
  memoryDb = db;
  scheduleLocalFileWrite(db);
  if (isFirebaseConfigured()) {
    saveFirebaseData(db);
  }
}

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
function getSetting(k) {
  const db = load();
  return db.settings[k] ?? "";
}

function getAllSettings() {
  return load().settings;
}

function setSetting(k, v) {
  const db = load();
  db.settings[k] = v;
  save(db);
}

// ----------------------------------------------------
// USERS
// ----------------------------------------------------
function getUser(userId) {
  const db = load();
  return db.users[String(userId)] || null;
}

function getOrCreateUser(telegramUser, referrerId = null) {
  const db = load();
  const idStr = String(telegramUser.id);
  let isNew = false;
  let validReferrer = null;
  let refUser = null;
  let referrerNewCount = 0;

  if (!db.users[idStr]) {
    isNew = true;

    if (referrerId && String(referrerId) !== idStr && db.users[String(referrerId)]) {
      validReferrer = String(referrerId);
      refUser = db.users[validReferrer];
      if (!Array.isArray(refUser.referrals)) refUser.referrals = [];

      if (!refUser.referrals.includes(idStr)) {
        refUser.referrals.push(idStr);
        refUser.referral_count = (refUser.referral_count || 0) + 1;
        referrerNewCount = refUser.referral_count;
      }
    }

    db.users[idStr] = {
      id: telegramUser.id,
      username: telegramUser.username || "",
      first_name: telegramUser.first_name || "",
      last_name: telegramUser.last_name || "",
      wallet_balance: 0.0,
      total_deposited: 0.0,
      total_spent: 0.0,
      orders_count: 0,
      referral_count: 0,
      referrals: [],
      referred_by: validReferrer,
      claimed_free_rewards: 0,
      created_at: new Date().toISOString()
    };
    save(db);
  } else {
    let changed = false;
    if (telegramUser.username && db.users[idStr].username !== telegramUser.username) {
      db.users[idStr].username = telegramUser.username;
      changed = true;
    }
    if (telegramUser.first_name && db.users[idStr].first_name !== telegramUser.first_name) {
      db.users[idStr].first_name = telegramUser.first_name;
      changed = true;
    }
    if (!Array.isArray(db.users[idStr].referrals)) {
      db.users[idStr].referrals = [];
      changed = true;
    }
    if (typeof db.users[idStr].claimed_free_rewards !== "number") {
      db.users[idStr].claimed_free_rewards = 0;
      changed = true;
    }
    if (changed) save(db);
  }

  return {
    user: db.users[idStr],
    isNew,
    referrerId: validReferrer,
    refUser,
    referrerNewCount
  };
}

function adjustUserReferrals(userId, deltaCount) {
  const db = load();
  const idStr = String(userId);
  if (!db.users[idStr]) return false;

  const current = Number(db.users[idStr].referral_count || 0);
  const updated = Math.max(0, current + Number(deltaCount));
  db.users[idStr].referral_count = updated;
  save(db);
  return updated;
}

function claimFreeReferralReward(userId) {
  const db = load();
  const idStr = String(userId);
  const user = db.users[idStr];
  if (!user) throw new Error("User not found");

  const reqRefs = Number(db.settings.referrals_for_free_reward || 30);
  const totalRefs = Number(user.referral_count || 0);
  const claimed = Number(user.claimed_free_rewards || 0);
  const totalEarnedRewards = Math.floor(totalRefs / reqRefs);

  if (totalEarnedRewards <= claimed) {
    throw new Error(`You need ${reqRefs * (claimed + 1) - totalRefs} more referral(s) to claim a free ChatGPT Shared Account (1 Month).`);
  }

  user.claimed_free_rewards = claimed + 1;
  user.orders_count = (user.orders_count || 0) + 1;

  // Check if preloaded credentials exist for chatgpt_shared_1m
  const availableKeys = Array.isArray(db.stock_items["chatgpt_shared_1m"]) ? db.stock_items["chatgpt_shared_1m"] : [];
  const dispensedItems = [];
  if (availableKeys.length > 0) {
    dispensedItems.push(availableKeys.shift());
    const prod = db.products.find((p) => p.id === "chatgpt_shared_1m");
    if (prod && prod.stock > 0) prod.stock -= 1;
  }

  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const orderCode = `FREE-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const order = {
    id: orderCode,
    user_id: user.id,
    user_name: user.username ? `@${user.username}` : user.first_name,
    product_id: "chatgpt_shared_1m",
    product_name: "ChatGPT Shared Account (1 Month) [30-Ref Free Reward]",
    category: "ai_sub",
    quantity: 1,
    unit_price: 0,
    total_price: 0,
    delivered_items: dispensedItems,
    status: dispensedItems.length > 0 ? "delivered" : "processing",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.orders.push(order);
  save(db);
  return { order, user };
}

function adjustUserBalance(userId, deltaAmount) {
  const db = load();
  const idStr = String(userId);
  if (!db.users[idStr]) return false;

  const current = Number(db.users[idStr].wallet_balance || 0);
  const updated = Math.max(0, Number((current + Number(deltaAmount)).toFixed(2)));
  db.users[idStr].wallet_balance = updated;
  save(db);
  return updated;
}

function getAllUsers() {
  return Object.values(load().users);
}

// ----------------------------------------------------
// PRODUCTS & STOCK
// ----------------------------------------------------
function getAllProducts() {
  return load().products || [];
}

function getProductsByCategory(category) {
  const all = getAllProducts();
  if (!category || category === "all") return all;
  return all.filter((p) => p.category === category);
}

function getProduct(productId) {
  return getAllProducts().find((p) => p.id === productId) || null;
}

function getUnitPrice(product, quantity = 1) {
  const qty = Math.max(1, Number(quantity) || 1);
  if (Array.isArray(product.bulk_tiers) && product.bulk_tiers.length > 0) {
    const matched = product.bulk_tiers.find((t) => qty >= Number(t.min || 1) && qty <= Number(t.max || 999999));
    if (matched) return Number(matched.price);
  }
  return Number(product.price || 0);
}

function updateProduct(productId, updates) {
  const db = load();
  const idx = db.products.findIndex((p) => p.id === productId);
  if (idx === -1) return null;

  db.products[idx] = { ...db.products[idx], ...updates };
  if (typeof updates.stock === "number") {
    db.products[idx].outOfStock = updates.stock <= 0;
  }
  save(db);
  return db.products[idx];
}

function addProduct(productData) {
  const db = load();
  const id = productData.id || `prod_${crypto.randomBytes(3).toString("hex")}`;
  const newProd = {
    id,
    category: productData.category || "ai_sub",
    name: productData.name,
    price: Number(productData.price || 10),
    bulk_tiers: productData.bulk_tiers || [
      { min: 1, max: 999999, price: Number(productData.price || 10) }
    ],
    stock: Number(productData.stock ?? 20),
    outOfStock: Number(productData.stock ?? 20) <= 0,
    description: productData.description || "✅ Official verified product • Instant delivery",
    terms: productData.terms || "• Verified active on delivery\n• 24/7 support available"
  };
  db.products.push(newProd);
  save(db);
  return newProd;
}

function getRandomRestockQuantity() {
  // Random stock strictly above 60 (61 to 120 units)
  return Math.floor(61 + Math.random() * 60);
}

function deductProductStockAndAutoRestock(productIdOrName, quantity = 1) {
  const db = load();
  const prod = db.products.find(
    (p) => p.id === productIdOrName || p.name === productIdOrName
  );
  if (!prod) return null;

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const prevStock = Math.max(0, Number(prod.stock || 0));
  const remaining = Math.max(0, prevStock - qty);

  if (remaining <= 0) {
    const newStock = getRandomRestockQuantity();
    prod.stock = newStock;
    prod.outOfStock = false;
    save(db);
    return {
      product: prod,
      deducted: qty,
      remainingBeforeRestock: 0,
      autoRestocked: true,
      restockedAmount: newStock,
      currentStock: newStock
    };
  }

  prod.stock = remaining;
  prod.outOfStock = false;
  save(db);
  return {
    product: prod,
    deducted: qty,
    remainingBeforeRestock: remaining,
    autoRestocked: false,
    restockedAmount: 0,
    currentStock: remaining
  };
}

function addProductStockItems(productId, itemsArray) {
  const db = load();
  const prod = db.products.find((p) => p.id === productId);
  if (!prod) return null;

  if (!Array.isArray(db.stock_items[productId])) {
    db.stock_items[productId] = [];
  }
  const cleanItems = itemsArray.map((s) => String(s).trim()).filter(Boolean);
  db.stock_items[productId].push(...cleanItems);
  prod.stock = (Number(prod.stock) || 0) + cleanItems.length;
  prod.outOfStock = prod.stock <= 0;
  save(db);
  return { added: cleanItems.length, totalStock: prod.stock };
}

// ----------------------------------------------------
// DEPOSITS (WALLET TOP-UP)
// ----------------------------------------------------
function createDeposit(depositData) {
  const db = load();
  const depositId = `DEP${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const deposit = {
    id: depositId,
    user_id: depositData.user_id,
    user_name: depositData.user_name || "",
    amount: Number(Number(depositData.amount || 10).toFixed(2)),
    method: depositData.method, // 'BINANCE_PAY' | 'USDT_BEP20' | 'USDT_POLYGON'
    proof: depositData.proof || "",
    photo_file_id: depositData.photo_file_id || null,
    status: "pending", // pending, approved, rejected
    reject_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.deposits.push(deposit);
  save(db);
  return deposit;
}

function getDeposit(depositId) {
  return load().deposits.find((d) => d.id === depositId);
}

function approveDeposit(depositId) {
  const db = load();
  const deposit = db.deposits.find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.status === "approved") throw new Error("Deposit already approved");

  deposit.status = "approved";
  deposit.updated_at = new Date().toISOString();

  const user = db.users[String(deposit.user_id)];
  if (user) {
    const amt = Number(deposit.amount || 0);
    user.wallet_balance = Number(((user.wallet_balance || 0) + amt).toFixed(2));
    user.total_deposited = Number(((user.total_deposited || 0) + amt).toFixed(2));
  }

  save(db);
  return { deposit, user };
}

function rejectDeposit(depositId, reason = "Invalid transaction ID or payment not received") {
  const db = load();
  const deposit = db.deposits.find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  deposit.status = "rejected";
  deposit.reject_reason = reason;
  deposit.updated_at = new Date().toISOString();
  save(db);
  return deposit;
}

function getPendingDeposits() {
  return load().deposits.filter((d) => d.status === "pending").reverse();
}

function getUserDeposits(userId) {
  return load().deposits.filter((d) => String(d.user_id) === String(userId)).slice(-10).reverse();
}

function getAllDeposits() {
  return load().deposits;
}

// ----------------------------------------------------
// ORDERS (PRODUCT PURCHASES)
// ----------------------------------------------------
function createOrder({ user_id, product_id, quantity = 1 }) {
  const db = load();
  const user = db.users[String(user_id)];
  if (!user) throw new Error("User not found");

  const product = db.products.find((p) => p.id === product_id);
  if (!product) throw new Error("Product not found");

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  if (product.outOfStock || (Number(product.stock) || 0) < qty) {
    throw new Error(`Insufficient stock (Available: ${product.stock || 0})`);
  }

  const unitPrice = getUnitPrice(product, qty);
  const totalPrice = Number((unitPrice * qty).toFixed(2));

  if ((Number(user.wallet_balance) || 0) < totalPrice) {
    throw new Error(`Insufficient wallet balance. Need ${totalPrice.toFixed(2)} USDT`);
  }

  // Deduct balance & stock
  user.wallet_balance = Number(((user.wallet_balance || 0) - totalPrice).toFixed(2));
  user.total_spent = Number(((user.total_spent || 0) + totalPrice).toFixed(2));
  user.orders_count = (user.orders_count || 0) + 1;

  product.stock = Math.max(0, (Number(product.stock) || 0) - qty);
  if (product.stock <= 0) {
    product.stock = getRandomRestockQuantity();
    product.outOfStock = false;
  } else {
    product.outOfStock = false;
  }

  // Check if pre-loaded credentials exist in stock_items
  const availableKeys = Array.isArray(db.stock_items[product_id]) ? db.stock_items[product_id] : [];
  const dispensedItems = [];
  for (let i = 0; i < qty; i++) {
    if (availableKeys.length > 0) {
      dispensedItems.push(availableKeys.shift());
    }
  }

  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const orderCode = `ORD-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const isAutoDelivered = dispensedItems.length === qty;

  const order = {
    id: orderCode,
    user_id: user.id,
    user_name: user.username ? `@${user.username}` : user.first_name,
    product_id: product.id,
    product_name: product.name,
    category: product.category,
    quantity: qty,
    unit_price: unitPrice,
    total_price: totalPrice,
    delivered_items: dispensedItems,
    status: isAutoDelivered ? "delivered" : "processing", // delivered | processing | completed | refunded
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.orders.push(order);
  save(db);
  return { order, user, product };
}

function getOrder(orderId) {
  const clean = String(orderId || "").trim().toUpperCase();
  return load().orders.find((o) => String(o.id).toUpperCase() === clean) || null;
}

function getUserOrders(userId) {
  return load().orders.filter((o) => String(o.user_id) === String(userId)).slice(-15).reverse();
}

function getPendingOrders() {
  return load().orders.filter((o) => o.status === "processing").reverse();
}

function getAllOrders() {
  return load().orders || [];
}

function fulfillOrder(orderId, deliveryText) {
  const db = load();
  const order = db.orders.find((o) => String(o.id).toUpperCase() === String(orderId).toUpperCase());
  if (!order) throw new Error("Order not found");

  order.delivered_items = [String(deliveryText).trim()];
  order.status = "delivered";
  order.updated_at = new Date().toISOString();
  save(db);
  return order;
}

function refundOrder(orderId, reason = "Out of stock / Refunded by Admin") {
  const db = load();
  const order = db.orders.find((o) => String(o.id).toUpperCase() === String(orderId).toUpperCase());
  if (!order) throw new Error("Order not found");
  if (order.status === "refunded") throw new Error("Order already refunded");

  order.status = "refunded";
  order.refund_reason = reason;
  order.updated_at = new Date().toISOString();

  const user = db.users[String(order.user_id)];
  if (user) {
    user.wallet_balance = Number(((user.wallet_balance || 0) + Number(order.total_price || 0)).toFixed(2));
  }

  save(db);
  return { order, user };
}

module.exports = {
  initStore,
  getSetting,
  getAllSettings,
  setSetting,
  getUser,
  getOrCreateUser,
  adjustUserBalance,
  adjustUserReferrals,
  claimFreeReferralReward,
  getAllUsers,
  getAllProducts,
  getProductsByCategory,
  getProduct,
  getUnitPrice,
  updateProduct,
  addProduct,
  addProductStockItems,
  getRandomRestockQuantity,
  deductProductStockAndAutoRestock,
  createDeposit,
  getDeposit,
  approveDeposit,
  rejectDeposit,
  getPendingDeposits,
  getUserDeposits,
  getAllDeposits,
  createOrder,
  getOrder,
  getUserOrders,
  getPendingOrders,
  getAllOrders,
  fulfillOrder,
  refundOrder
};
