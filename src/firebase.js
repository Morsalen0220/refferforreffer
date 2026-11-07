const admin = require("firebase-admin");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");

let dbInstance = null;
let isInitialized = false;
let cachedAccount = undefined;
let lastLocalSaveTime = 0;

function parseServiceAccount() {
  if (cachedAccount !== undefined) return cachedAccount;

  let account = null;
  const envVal = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_CONFIG_BASE64;

  if (envVal) {
    let raw = envVal.trim();
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
        try {
          const fixedRaw = raw.replace(/\r?\n/g, "\\n");
          account = JSON.parse(fixedRaw);
          console.log("✅ Loaded Firebase credentials from ENV (Fixed multiline JSON)");
        } catch (e2) {
          console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:", e2.message);
        }
      }
    } else {
      try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        account = JSON.parse(decoded);
        console.log("✅ Loaded Firebase credentials from ENV (Base64 format)");
      } catch (e) {
        console.error("❌ Failed to decode base64 FIREBASE_SERVICE_ACCOUNT:", e.message);
      }
    }
  }

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

  if (account && typeof account.private_key === "string") {
    account.private_key = account.private_key
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n");
  }

  cachedAccount = account || null;
  return cachedAccount;
}

function isFirebaseConfigured() {
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) return false;
  const serviceAccount = parseServiceAccount();
  return Boolean(dbUrl && serviceAccount);
}

function initFirebase() {
  if (isInitialized) return dbInstance;

  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  const serviceAccount = parseServiceAccount();

  if (!dbUrl || !serviceAccount) {
    isInitialized = true;
    console.log("ℹ️ Firebase credentials not provided. Using fast local storage (./data/bot-data.json).");
    return null;
  }

  try {
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
    isInitialized = true;
    console.error("❌ Firebase initialization error:", err.message);
    return null;
  }
}

// Fetch all bot data from Firebase with a 6-second timeout so startup never hangs
async function fetchFirebaseData() {
  const db = initFirebase();
  if (!db) return null;

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firebase fetch timed out after 6s")), 6000)
    );
    const snapshot = await Promise.race([db.ref("botData").once("value"), timeoutPromise]);
    if (snapshot && snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (err) {
    console.error("Error reading from Firebase:", err.message);
    return null;
  }
}

// Debounced non-blocking save to Firebase (1.5s debounce prevents spamming network on rapid clicks)
let syncTimeout = null;
function saveFirebaseData(data) {
  const db = initFirebase();
  if (!db) return;

  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    try {
      lastLocalSaveTime = Date.now();
      await db.ref("botData").set(data);
    } catch (err) {
      console.error("Error saving to Firebase:", err.message);
    }
  }, 1500);
}

// Listen to external changes in Firebase Console without echoing our own saves
function listenFirebaseData(callback) {
  const db = initFirebase();
  if (!db || typeof callback !== "function") return;

  db.ref("botData").on(
    "value",
    (snapshot) => {
      // Ignore echo triggered by our own save within the last 3 seconds
      if (Date.now() - lastLocalSaveTime < 3000) return;
      if (snapshot.exists()) {
        callback(snapshot.val());
      }
    },
    (err) => {
      console.error("Firebase live listener error:", err.message);
    }
  );
}

module.exports = {
  isFirebaseConfigured,
  initFirebase,
  fetchFirebaseData,
  saveFirebaseData,
  listenFirebaseData
};
