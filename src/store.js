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

const defaultSettings = {
  bot_title: "USDT Referral Earning Bot",
  referrals_required: 3,
  referral_reward_amount: 2.50,
  welcome_bonus_amount: 2.00,
  activation_deposit_amount: 1.00,
  min_withdraw: 7.50,
  channel_id: process.env.FORCE_CHANNEL_ID || "-1004420926145",
  channel_link: process.env.FORCE_CHANNEL_LINK || "https://t.me/RefferRewardss",
  group_id: process.env.FORCE_GROUP_ID || "-1004378930616",
  group_link: process.env.FORCE_GROUP_LINK || "https://t.me/RefferRewardes",
  force_join_enabled: false,
  bep20_usdt_address: process.env.BEP20_USDT_ADDRESS || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF",
  polygon_usdt_address: process.env.POLYGON_USDT_ADDRESS || "0xC3fC8C91A5B26C71DcD0aC1F34944FB298bCeBbF",
  binance_pay_id: process.env.BINANCE_PAY_ID || "123456789",
  support_username: process.env.SUPPORT_USERNAME || "@Morsalen0220",
  auto_broadcast_enabled: true
};

const defaults = {
  settings: defaultSettings,
  users: {},
  deposits: [],
  withdrawals: []
};

let memoryDb = null;

function normalizeDb(raw) {
  if (!raw || typeof raw !== "object") return structuredClone(defaults);

  if (!raw.settings || typeof raw.settings !== "object") {
    raw.settings = structuredClone(defaultSettings);
  } else {
    raw.settings = { ...defaultSettings, ...raw.settings };
  }

  if (!raw.users || typeof raw.users !== "object") raw.users = {};

  if (!Array.isArray(raw.deposits)) {
    if (raw.deposits && typeof raw.deposits === "object") raw.deposits = Object.values(raw.deposits);
    else raw.deposits = [];
  }

  if (!Array.isArray(raw.withdrawals)) {
    if (raw.withdrawals && typeof raw.withdrawals === "object") raw.withdrawals = Object.values(raw.withdrawals);
    else raw.withdrawals = [];
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
    return normalizeDb(parsed);
  } catch (err) {
    console.error("Error reading local database file, using defaults:", err.message);
    return structuredClone(defaults);
  }
}

async function initStore() {
  if (isFirebaseConfigured()) {
    try {
      initFirebase();
      const remoteData = await fetchFirebaseData();
      if (remoteData && (remoteData.users || remoteData.settings || remoteData.withdrawals || remoteData.deposits)) {
        console.log("📥 Loaded database snapshot from Google Firebase Realtime Database!");
        memoryDb = normalizeDb(remoteData);
        try {
          fs.writeFileSync(file, JSON.stringify(memoryDb, null, 2), "utf8");
        } catch (e) {}
      } else {
        console.log("📤 Initializing Firebase Realtime Database with local database seed...");
        memoryDb = loadLocalFile();
        saveFirebaseData(memoryDb);
      }

      listenFirebaseData((remoteUpdated) => {
        if (remoteUpdated) {
          memoryDb = normalizeDb(remoteUpdated);
          try {
            fs.writeFileSync(file, JSON.stringify(memoryDb, null, 2), "utf8");
          } catch (e) {}
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
  try {
    fs.writeFileSync(file, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("Local file write error:", e.message);
  }
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
// USERS & REFERRAL
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
  let referrerNewCount = 0;
  let refUser = null;

  const rewardPerRef = Number(db.settings.referral_reward_amount || 2.50);
  const welcomeBonus = Number(db.settings.welcome_bonus_amount || 2.00);

  // ANTI-CHEAT CHECK:
  // If the user already exists in the database/Firebase, they can NEVER be counted as a new referral.
  if (!db.users[idStr]) {
    isNew = true;

    // Verify referrer: must exist in database, cannot be self-referral
    if (referrerId && String(referrerId) !== idStr && db.users[String(referrerId)]) {
      validReferrer = String(referrerId);
      refUser = db.users[validReferrer];
      if (!Array.isArray(refUser.referrals)) refUser.referrals = [];

      // Anti-duplicate check: verify this account hasn't already been recorded
      if (!refUser.referrals.includes(idStr)) {
        refUser.referrals.push(idStr);
        refUser.referral_count = (refUser.referral_count || 0) + 1;
        referrerNewCount = refUser.referral_count;

        // Reward the referrer: +$2.50 USDT per referral
        refUser.wallet_balance = Number(((refUser.wallet_balance || 0) + rewardPerRef).toFixed(2));
        refUser.total_earned = Number(((refUser.total_earned || 0) + rewardPerRef).toFixed(2));
      }
    }

    // Joiner Welcome Bonus: +$2.00 USDT if joined via a referral link!
    const initialBalance = validReferrer ? welcomeBonus : 0.0;

    db.users[idStr] = {
      id: telegramUser.id,
      username: telegramUser.username || "",
      first_name: telegramUser.first_name || "",
      last_name: telegramUser.last_name || "",
      wallet_balance: initialBalance,
      referral_count: 0,
      referrals: [],
      referred_by: validReferrer,
      total_earned: initialBalance,
      total_withdrawn: 0.0,
      is_activated: false,
      created_at: new Date().toISOString()
    };
    save(db);
  } else {
    // Existing user: NEVER award referral bonuses again on subsequent /start
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
    if (changed) save(db);
  }

  return {
    user: db.users[idStr],
    isNew,
    referrerId: validReferrer,
    refUser,
    referrerNewCount,
    rewardPerRef,
    welcomeBonus
  };
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

function adjustUserReferrals(userId, deltaCount, syncBalance = false) {
  const db = load();
  const idStr = String(userId);
  if (!db.users[idStr]) return false;

  const current = Number(db.users[idStr].referral_count || 0);
  const updated = Math.max(0, current + Number(deltaCount));
  db.users[idStr].referral_count = updated;

  let balanceUpdated = false;
  let newBalance = Number(db.users[idStr].wallet_balance || 0);

  if (syncBalance) {
    const rewardPerRef = Number(db.settings.referral_reward_amount || 2.50);
    const balanceDelta = Number((Number(deltaCount) * rewardPerRef).toFixed(2));
    newBalance = Math.max(0, Number((newBalance + balanceDelta).toFixed(2)));
    db.users[idStr].wallet_balance = newBalance;
    if (balanceDelta > 0) {
      db.users[idStr].total_earned = Number(((db.users[idStr].total_earned || 0) + balanceDelta).toFixed(2));
    }
    balanceUpdated = true;
  }

  save(db);
  return { newCount: updated, newBalance, balanceUpdated };
}

function setUserActivated(userId, isActivated = true) {
  const db = load();
  const idStr = String(userId);
  if (db.users[idStr]) {
    db.users[idStr].is_activated = Boolean(isActivated);
    save(db);
    return true;
  }
  return false;
}

function getAllUsers() {
  return Object.values(load().users);
}

// ----------------------------------------------------
// DEPOSITS ($1.00 ACTIVATION)
// ----------------------------------------------------
function createDeposit(depositData) {
  const db = load();
  const depositId = `DEP${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const deposit = {
    id: depositId,
    user_id: depositData.user_id,
    user_name: depositData.user_name || "",
    amount: Number(depositData.amount) || Number(db.settings.activation_deposit_amount || 1.00),
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
  return load().deposits.find(d => d.id === depositId);
}

function approveDeposit(depositId) {
  const db = load();
  const deposit = db.deposits.find(d => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.status === "approved") throw new Error("Deposit already approved");

  deposit.status = "approved";
  deposit.updated_at = new Date().toISOString();

  // Activate the user for withdrawals
  const user = db.users[String(deposit.user_id)];
  if (user) {
    user.is_activated = true;
  }

  save(db);
  return { deposit, user };
}

function rejectDeposit(depositId, reason = "Invalid transaction ID or payment not received") {
  const db = load();
  const deposit = db.deposits.find(d => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  deposit.status = "rejected";
  deposit.reject_reason = reason;
  deposit.updated_at = new Date().toISOString();
  save(db);
  return deposit;
}

function getPendingDeposits() {
  return load().deposits.filter(d => d.status === "pending").reverse();
}

function getUserDeposits(userId) {
  return load().deposits.filter(d => String(d.user_id) === String(userId)).slice(-10).reverse();
}

function getAllDeposits() {
  return load().deposits;
}

// ----------------------------------------------------
// WITHDRAWALS ($8.00 / USER BALANCE)
// ----------------------------------------------------
function createWithdrawal(withdrawData) {
  const db = load();
  const userIdStr = String(withdrawData.user_id);
  const user = db.users[userIdStr];
  if (!user) throw new Error("User not found");

  const amount = Number(withdrawData.amount);
  if ((user.wallet_balance || 0) < amount) {
    throw new Error("Insufficient balance for withdrawal");
  }

  // Deduct balance upon requesting withdrawal
  user.wallet_balance = Number(((user.wallet_balance || 0) - amount).toFixed(2));

  const withdrawId = `WTH${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const withdrawal = {
    id: withdrawId,
    user_id: user.id,
    user_name: withdrawData.user_name || (user.username ? `@${user.username}` : user.first_name),
    amount: amount,
    method: withdrawData.method, // 'BINANCE_PAY' | 'USDT_BEP20' | 'USDT_POLYGON'
    address: withdrawData.address,
    status: "pending", // pending, approved, rejected
    txid: null,
    reject_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.withdrawals.push(withdrawal);
  save(db);
  return { withdrawal, user };
}

function getWithdrawal(withdrawId) {
  return load().withdrawals.find(w => w.id === withdrawId);
}

function approveWithdrawal(withdrawId, txid = null) {
  const db = load();
  const withdrawal = db.withdrawals.find(w => w.id === withdrawId);
  if (!withdrawal) throw new Error("Withdrawal not found");
  if (withdrawal.status === "approved") throw new Error("Withdrawal already approved");

  withdrawal.status = "approved";
  withdrawal.txid = txid || `0x${crypto.randomBytes(32).toString("hex")}`;
  withdrawal.updated_at = new Date().toISOString();

  const user = db.users[String(withdrawal.user_id)];
  if (user) {
    user.total_withdrawn = Number(((user.total_withdrawn || 0) + Number(withdrawal.amount)).toFixed(2));
  }

  save(db);
  return { withdrawal, user };
}

function rejectWithdrawal(withdrawId, reason = "Information incorrect or account flagged") {
  const db = load();
  const withdrawal = db.withdrawals.find(w => w.id === withdrawId);
  if (!withdrawal) throw new Error("Withdrawal not found");
  if (withdrawal.status === "approved") throw new Error("Cannot reject an already approved withdrawal");

  withdrawal.status = "rejected";
  withdrawal.reject_reason = reason;
  withdrawal.updated_at = new Date().toISOString();

  // Refund balance back to user
  const user = db.users[String(withdrawal.user_id)];
  if (user) {
    user.wallet_balance = Number(((user.wallet_balance || 0) + Number(withdrawal.amount)).toFixed(2));
  }

  save(db);
  return { withdrawal, user };
}

function getPendingWithdrawals() {
  return load().withdrawals.filter(w => w.status === "pending").reverse();
}

function getUserWithdrawals(userId) {
  return load().withdrawals.filter(w => String(w.user_id) === String(userId)).slice(-10).reverse();
}

function getAllWithdrawals() {
  return load().withdrawals;
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
  setUserActivated,
  getAllUsers,
  createDeposit,
  getDeposit,
  approveDeposit,
  rejectDeposit,
  getPendingDeposits,
  getUserDeposits,
  getAllDeposits,
  createWithdrawal,
  getWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  getPendingWithdrawals,
  getUserWithdrawals,
  getAllWithdrawals
};
