# AMAD IX — DA-RFO IX Market Price Monitoring System

> **Stack:** Plain HTML · Vanilla JS · Supabase (PostgreSQL) · GitHub Pages  
> **Cost:** ₱0 — everything on free tiers

---

## Table of Contents

1. [GitHub Setup](#1-github-setup)
2. [Supabase Setup](#2-supabase-setup)
3. [Connect the App to Supabase](#3-connect-the-app-to-supabase)
4. [Deploy to GitHub Pages](#4-deploy-to-github-pages)
5. [Repository Structure](#5-repository-structure)
6. [Daily Workflow](#6-daily-workflow-for-your-team)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. GitHub Setup

### Step 1 — Create a GitHub account
Go to **https://github.com** and sign up.  
Use your official email (e.g. `your.name@da.gov.ph`).

### Step 2 — Create the repository

1. Click the **+** button (top-right) → **New repository**
2. Fill in:
   - **Repository name:** `amad-ix`
   - **Description:** `DA-RFO IX Market Price Monitoring System`
   - **Visibility:** `Private` ← keep it private
   - ✅ Check **Add a README file**
3. Click **Create repository**

### Step 3 — Upload your files

On the repository page:
1. Click **Add file** → **Upload files**
2. Drag and drop these files:
   - `index.html` ← your main app file (rename amad_ix_v7.html to index.html)
   - `amad-supabase.js` ← the Supabase adapter (from the `supabase/` folder)
3. Write a commit message: `Initial upload — AMAD IX v7`
4. Click **Commit changes**

### Step 4 — Invite collaborators (optional)

Go to **Settings → Collaborators → Add people**  
Add anyone who needs to edit the code (e.g. your IT person).

---

## 2. Supabase Setup

### Step 1 — Create a Supabase account
Go to **https://supabase.com** → **Start your project** → sign in with GitHub.

### Step 2 — Create a new project

1. Click **New project**
2. Fill in:
   - **Name:** `amad-ix`
   - **Database Password:** use a strong password (save it somewhere safe!)
   - **Region:** `Southeast Asia (Singapore)` ← closest to Region IX
3. Click **Create new project** — wait ~2 minutes for it to spin up

### Step 3 — Run the database schema

1. In the left sidebar, click **SQL Editor**
2. Click **New query**
3. Open the file `supabase/schema.sql` from this repository
4. Copy the entire contents and paste it into the SQL Editor
5. Click **Run** (or press Ctrl+Enter)
6. You should see: `Success. No rows returned`

This creates all your tables: `users`, `markets`, `commodities`, `entries`, `saved_days`, `flags`, `edit_requests`.

### Step 4 — Get your API keys

1. In the left sidebar, click **Project Settings** → **API**
2. Copy two values:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`

> ⚠️ Never share the `service_role` key. The `anon` key is safe for the browser.

---

## 3. Connect the App to Supabase

### Step 1 — Edit `amad-supabase.js`

Open the file and replace the top two lines:

```js
// BEFORE
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';

// AFTER (use your actual values)
const SUPABASE_URL  = 'https://abcdefghijkl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

### Step 2 — Add the Supabase CDN to `index.html`

Open `index.html`. Find the `<head>` tag and add these two lines right before `</head>`:

```html
<!-- Supabase client -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<!-- AMAD Supabase adapter -->
<script src="amad-supabase.js"></script>
```

### Step 3 — Wire up the login function

Find the `doLogin()` function in `index.html`.  
Replace the password-check block with the Supabase login call:

```js
async function doLogin() {
  const marketId = document.getElementById('loginMarket').value;
  const password = document.getElementById('loginPass').value;

  if (!marketId) { showLoginErr('Select your market/station'); return; }
  if (!password) { showLoginErr('Enter your password'); return; }

  // ── Supabase login ──
  const { ok, user, error } = await sbLogin(marketId, password);
  if (!ok) { showLoginErr('Invalid password'); return; }

  // Set session variables (same as before)
  curRole       = user.role;
  curUserMarket = user.market_id;
  curMkt        = user.role === 'encoder' ? user.market_id : (dataMkts()[0]?.id || '');

  document.getElementById('loginOverlay').style.display = 'none';
  applyRoleUI();

  // Load data from Supabase
  await sbBootApp(user);

  rebuildCurrentPane();
  updateCounters();
}
```

### Step 4 — Wire up `saveAll()`

Inside your existing `saveAll()` function, add Supabase calls after the local saves:

```js
async function saveAll() {
  try {
    // ... existing local save code stays ...

    // ── Sync to Supabase ──
    // 1. Save the day lock
    await sbSaveDay(curMkt, curWeek, curDay);

    // 2. Save all entries for this day
    const coms = dataComs().filter(c => c.id);
    for (const com of coms) {
      const inputs = getInp(curMkt, curWeek, com.id, curDay);
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i] !== '' && inputs[i] != null) {
          await sbSaveEntry(curMkt, curWeek, curDay, com.id, i, inputs[i]);
        }
      }
    }

    showToast('✅ Saved & synced to cloud database');
  } catch(e) {
    showToast('❌ ' + e.message, 'err');
  }
}
```

### Step 5 — Wire up flag saves

At the end of `autoFlagCell()` and `manualFlag()`, add:

```js
// After creating/updating a flag:
await sbSaveFlag(flags[key]);
```

And in `resolveFlag()`:

```js
// After changing flag status:
await sbSaveFlag(flags[fKey]);
```

---

## 4. Deploy to GitHub Pages

This makes your app accessible at a real URL — no server needed.

### Step 1 — Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → scroll down to **Pages** (left sidebar)
3. Under **Source**, select:
   - **Branch:** `main`
   - **Folder:** `/ (root)`
4. Click **Save**

### Step 2 — Access your app

After ~1 minute, your app will be live at:
```
https://YOUR-GITHUB-USERNAME.github.io/amad-ix/
```

Share this URL with all your encoders. They can bookmark it.

### Step 3 — Update the app

Whenever you make changes to `index.html`:
1. Go to the repository on GitHub
2. Click `index.html` → click the ✏️ pencil icon (Edit)
3. Make your changes
4. Click **Commit changes**

The live URL updates automatically within 1–2 minutes.

---

## 5. Repository Structure

```
amad-ix/
│
├── index.html              ← The entire app (your amad_ix_v7.html renamed)
├── amad-supabase.js        ← Supabase data adapter
├── README.md               ← This file
│
└── supabase/
    ├── schema.sql          ← Database tables + RLS policies + seed data
    └── amad-supabase.js    ← (same file, kept here as reference)
```

---

## 6. Daily Workflow for Your Team

| Who | What they do |
|-----|-------------|
| **Encoder** | Opens the URL → logs in with market + password → encodes prices → clicks Save |
| **Verifier** | Opens the URL → logs in → sees 🚩 Flags button → reviews flagged entries → adds remarks |
| **Admin** | Opens the URL → logs in → approves/rejects edit requests → manages users |

### How data flows

```
Encoder types price
      ↓
App checks for outliers → auto-flags if >25% deviation
      ↓
Flag appears in Encoder's "My Flagged Entries" panel
Encoder corrects it → correction sent to Verifier
      ↓
Verifier sees correction in Flag panel with original vs corrected value
Verifier adds remark → marks as Verified or Resolved
      ↓
Admin sees everything across all markets
```

### Passwords — change these immediately!

After setup, tell each encoder to log in and change their password via **🔑 My Account**.

Default passwords (from schema.sql):
- Admin: `admin2025`
- Verifier: `verify`
- All encoders: `1234`

---

## 7. Troubleshooting

**"Failed to fetch" or blank data after login**
- Check that your `SUPABASE_URL` and `SUPABASE_ANON` are correct in `amad-supabase.js`
- Make sure you ran `schema.sql` in the SQL Editor without errors

**"Row not found" or login fails**
- Go to Supabase → Table Editor → `users` table — make sure the seed data is there
- Try running the `INSERT INTO public.users...` section of schema.sql again

**Changes not showing for other users**
- Real-time requires the Supabase Realtime feature to be enabled
- Go to Supabase → Database → Replication → enable `supabase_realtime` publication for tables: `entries`, `flags`, `edit_requests`

**GitHub Pages shows 404**
- Make sure your main file is named exactly `index.html` (not `Index.html`)
- Wait 2–3 minutes after enabling Pages for the first deployment

**I updated index.html but the live site didn't change**
- GitHub Pages can take up to 5 minutes to rebuild
- Hard-refresh your browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

---

## Security Notes

- The Supabase `anon` key in `amad-supabase.js` is safe to expose — it is a **public** key
- Row Level Security (RLS) is enabled on all tables — this is your actual protection layer
- For production, upgrade the password system to use hashed passwords (bcrypt)
- Keep the repository **Private** on GitHub so the code is not publicly browsable

---

*AMAD IX · DA-RFO IX · Region IX · Market Price Monitoring System*
