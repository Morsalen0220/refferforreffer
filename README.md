# USDT Referral & Earning Telegram Bot (Node.js 20+)

An automated Telegram Earning Bot where users invite friends to earn USDT rewards with built-in anti-fraud verification, manual/crypto deposit approvals, withdrawal processing, and automated social proof broadcasts to Telegram groups.

---

## 🚀 Key Features & Flow

### 1. 👥 Referral Earning System ($8 for 10 Invites)
- Every user gets a personalized referral link: `https://t.me/<bot_username>?start=ref_<userId>`.
- **Earning Target:** When a user completes **10 referrals**, **$8.00 USDT** is automatically credited to their wallet balance.
- Visual progress bar (`[🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜] 3/10`) tracking progress in real time.
- **Before 10 referrals:** The user is **never** asked or prompted to deposit anything.

### 2. 🛡️ 1-Time Security Verification ($1 Activation)
- When a user reaches **10 referrals** and attempts to withdraw their **$8.00 earnings**, the bot prompts them to complete a **1-time verification deposit of $1.00 USDT** (to prevent bot/fake accounts and activate instant automated withdrawals).
- Payment options:
  - **Binance Pay ID**
  - **USDT (BEP-20 / Binance Smart Chain)** with dynamic QR code
  - **USDT (Polygon Network)** with dynamic QR code
- Customer submits their Transaction Hash (TxID), Order ID, or screenshot receipt.
- Admin verifies and approves the deposit with 1 click in Telegram.
- Once approved, the user's account is permanently **Activated** for withdrawals.

### 3. 💳 Withdrawal System
- Users with an activated account can withdraw their earnings directly to:
  - Binance Pay ID
  - USDT (BEP-20)
  - USDT (Polygon)
- Admin receives instant notifications with **Approve & Mark Paid** or **Reject & Refund** buttons.

### 4. 📢 Automated Group Social Proof Broadcaster
- Built-in background broadcaster automatically publishes realistic, high-converting payment proofs into your connected Telegram community group every 1.5–4 minutes:
  1. **Withdrawal Proofs**: Verified payouts with real on-chain BSCScan & PolygonScan hashes and international names.
  2. **Milestone Completed Proofs**: Congratulates members who completed 10 referrals and unlocked $8.00.
  3. **Account Activation Proofs**: Confirms $1.00 verification deposits and account activations.
- Real admin approvals also trigger live group posts automatically!

### 5. 👑 Admin Dashboard (`/admin`)
- Send `/admin` from the configured admin Telegram account to:
  - View live bot statistics (Total Users, Total Referrals, Activated Wallets, Total Paid Out).
  - Review & Approve/Reject pending **Deposits**.
  - Review & Approve/Reject pending **Withdrawals**.
  - Update Binance Pay ID, BEP20 address, Polygon address, channel/group links.
  - Change referral targets (default 10) & reward amounts (default $8.00).
  - Toggle Force-Join and Group Auto-Poster ON/OFF.
  - Broadcast announcement messages to all users.
  - Test group broadcast messages on demand.

---

## 🛠️ Installation & Setup

1. Copy `.env.example` to `.env` and fill in your details:
   - `BOT_TOKEN`: From [@BotFather](https://t.me/BotFather)
   - `ADMIN_TELEGRAM_ID`: Your numeric Telegram ID (from [@userinfobot](https://t.me/userinfobot))
   - `FORCE_CHANNEL_ID` & `FORCE_GROUP_ID`: Your Telegram Channel and Group IDs
   - `BINANCE_PAY_ID`, `BEP20_USDT_ADDRESS`, `POLYGON_USDT_ADDRESS`

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the bot:
   ```bash
   npm start
   ```

---

## ☁️ Cloud Deployment (Render / Railway / VPS)

- The bot includes a built-in Express server listening on `PORT` (default 3000) with `GET /` and `GET /health` endpoints to keep cloud hosting alive.
- Works in **polling mode** by default, or automatic **webhook mode** if `WEBHOOK_URL` / `RENDER_EXTERNAL_URL` is set in `.env`.
- Supports optional **Google Firebase Realtime Database** for persistent cloud storage across restarts.
