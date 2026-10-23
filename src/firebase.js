const admin = require("firebase-admin");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");

let dbInstance = null;
let isInitialized = false;

function parseServiceAccount() {
  let account = null;

  // 1. Check Environment Variable (FIREBASE_SERVICE_ACCOUNT or FIREBASE_CONFIG_BASE64)
  const envVal = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_CONFIG_BASE64;
  
  if (envVal) {
    let raw = envVal.trim();
    
    // যদি শুরুতে বা শেষে ভুলবশত অতিরিক্ত কোটেশন (" বা ') চলে আসে, তা রিমুভ করা
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1).trim();
    }
    if (raw.endsWith('}"')) {
      raw = raw.slice(0, -1).trim();
    }

    if (raw.startsWith("{")) {
      try {
        account = JSON.parse(raw);
        console.log("✅ Loaded Firebase credentials from ENV (JSON format)");
      } catch (e) {
        // যদি আসল newline থাকার কারণে JSON.parse ফেইল করে, তা ঠিক করে আবার চেষ্টা করা
        try {
          const fixedRaw = raw.replace(/\r?\n/g, "\\n");
          account = JSON.parse(fixedRaw);
          console.log("✅ Loaded Firebase credentials from ENV (Fixed multiline JSON)");
        } catch (e2) {
          console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:", e2.message);
        }
      }
    } else {
      // Base64 ডিকোড করার চেষ্টা
      try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        account = JSON.parse(decoded);
        console.log("✅ Loaded Firebase credentials from ENV (Base64 format)");
      } catch (e) {
        console.error("❌ Failed to decode base64 FIREBASE_SERVICE_ACCOUNT:", e.message);
      }
    }
  }

  // 2. Fallback to Local File (শুধুমাত্র লোকাল পিসির জন্য)
  if (!account) {
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
    if (fs.existsSync(keyPath)) {
      try {
        account = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        console.log(`⚠️ Loaded Firebase credentials from local file: ${keyPath}`);
      } catch (e) {
        console.error(`❌ Failed to read Firebase service account from ${keyPath}:`, e.message);
      }
    }
  }

  // 3. CRITICAL: Normalize private_key newlines & accidental quotes
  if (account && typeof account.private_key === "string") {
    account.private_key = account.private_key
      .replace(/^["']|["']$/g, "") // শুরু বা শেষের ভুল কোটেশন সরানো
      .replace(/\\n/g, "\n");      // টেক্সট \n কে আসল লাইন ব্রেকে রূপান্তর
  }

  return account;
}

function isFirebaseConfigured() {
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  const serviceAccount = parseServiceAccount();
  return Boolean(dbUrl && serviceAccount);
}

function initFirebase() {
  if (isInitialized) return dbInstance;

  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  const serviceAccount = parseServiceAccount();

  if (!dbUrl || !serviceAccount) {
    console.log("ℹ️ Firebase credentials not provided. Using local storage (./data/bot-data.json).");
    return null;
  }

  try {
    // কোন Key ID ও Email লোড হচ্ছে তা লগে দেখানো
    console.log(`🔑 Initializing Firebase with Key ID: ${serviceAccount.private_key_id} (${serviceAccount.client_email})`);

    const apps = admin.apps || (typeof admin.getApps === "function" ? admin.getApps() : []);
    if (!apps.length) {
      const certFn = admin.credential && admin.credential.cert ? admin.credential.cert : admin.cert;
      admin.initializeApp({
        credential: certFn(serviceAccount),
        databaseURL: dbUrl.trim().replace(/^["']|["']$/g, "")
      });
    }
    dbInstance = getDatabase();
    isInitialized = true;
    console.log("🔥 Connected to Google Firebase Realtime Database successfully!");
    return dbInstance;
  } catch (err) {
    console.error("❌ Firebase initialization error:", err.message);
    return null;
  }
}

// Fetch all bot data from Firebase
async function fetchFirebaseData() {
  const db = initFirebase();
  if (!db) return null;

  try {
    const snapshot = await db.ref("botData").once("value");
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (err) {
    console.error("Error reading from Firebase:", err.message);
    return null;
  }
}

// Save all bot data to Firebase
let syncTimeout = null;
function saveFirebaseData(data) {
  const db = initFirebase();
  if (!db) return;

  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    try {
      await db.ref("botData").set(data);
    } catch (err) {
      console.error("Error saving to Firebase:", err.message);
    }
  }, 200);
}

// Listen to real-time changes made directly in Firebase Console
function listenFirebaseData(callback) {
  const db = initFirebase();
  if (!db || typeof callback !== "function") return;

  db.ref("botData").on("value", (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  }, (err) => {
    console.error("Firebase live listener error:", err.message);
  });
}

module.exports = {
  isFirebaseConfigured,
  initFirebase,
  fetchFirebaseData,
  saveFirebaseData,
  listenFirebaseData
};
