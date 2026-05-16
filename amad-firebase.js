// ════════════════════════════════════════════════════════
//  amad-firebase.js — AMAD-IX  (Realtime Database version)
//  Matches your Firebase project: amad-ix
// ════════════════════════════════════════════════════════

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth,
         signInWithEmailAndPassword,
         signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getDatabase, ref, set, get,
         update, onValue, child }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';

// ── Config ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAEOWLp8_C3BmgOBc8eId3-bYsL-ezWyfM",
  authDomain:        "amad-ix.firebaseapp.com",
  databaseURL:       "https://amad-ix-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "amad-ix",
  storageBucket:     "amad-ix.firebasestorage.app",
  messagingSenderId: "167267361749",
  appId:             "1:167267361749:web:02bb40e1cf8a1e0b6cd35c"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const rtdb  = getDatabase(fbApp);

// ── Email map ─────────────────────────────────────────────
const MARKET_EMAILS = {
  '__admin__':    'admin@darfo9.gov.ph',
  '__verifier__': 'verifier@darfo9.gov.ph',
  'zc_main':      'zc_main@darfo9.gov.ph',
  'zc_sta':       'zc_sta@darfo9.gov.ph',
  'agora':        'agora@darfo9.gov.ph',
  'ipil':         'ipil@darfo9.gov.ph',
  'dipolog':      'dipolog@darfo9.gov.ph',
  'imelda':       'imelda@darfo9.gov.ph',
  'tampilisan':   'tampilisan@darfo9.gov.ph',
  'liloy':        'liloy@darfo9.gov.ph',
  'sindangan':    'sindangan@darfo9.gov.ph',
  'molave':       'molave@darfo9.gov.ph',
  'isabela':      'isabela@darfo9.gov.ph',
  'jolo':         'jolo@darfo9.gov.ph',
};

// ════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════
window.sbLogin = async function(marketId, password) {
  try {
    const email = MARKET_EMAILS[marketId];
    if (!email) return { ok: false };
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return {
      ok: true,
      user: {
        uid:      cred.user.uid,
        email:    cred.user.email,
        marketId: marketId,
        role:     marketId === '__admin__'    ? 'admin'
                : marketId === '__verifier__' ? 'verifier'
                : 'encoder'
      }
    };
  } catch(e) {
    console.error('[FB] login:', e.code, e.message);
    return { ok: false };
  }
};

// ════════════════════════════════════════════════════════
//  BOOT — load all data after login
// ════════════════════════════════════════════════════════
window.sbBootApp = async function(user) {
  _showProgress('Loading data from Firebase...');
  try {
    const isAdmin    = user.marketId === '__admin__';
    const isVerifier = user.marketId === '__verifier__';

    if (isAdmin || isVerifier) {
      // Load all markets
      const snap = await get(ref(rtdb, 'entries'));
      _loadEntriesSnap(snap);
    } else {
      // Load only this encoder's market
      const snap = await get(ref(rtdb, 'entries/' + user.marketId));
      _loadMarketSnap(user.marketId, snap);
    }

    // Load locked days
    try {
      const sdSnap = await get(ref(rtdb, 'saved_days'));
      if (sdSnap.exists()) {
        const val = sdSnap.val() || {};
        Object.entries(val).forEach(([mkt, wks]) => {
          Object.entries(wks).forEach(([wk, days]) => {
            Object.keys(days).forEach(d => {
              savedDays.add(mkt + '__' + wk + '__' + d);
            });
          });
        });
      }
    } catch(e) { console.warn('[FB] saved_days load:', e); }

    _hideProgress();
    buildUI();
    setTimeout(() => {
      if (window.autoFlagAll)   autoFlagAll();
      if (window.updateCounters) updateCounters();
    }, 300);

    showToast('✅ Firebase data loaded successfully');

  } catch(e) {
    _hideProgress();
    console.error('[FB] boot error:', e);
    showToast('⚠ Working offline — cloud load failed', 'info');
    buildUI();
  }
};

// ── Parse full entries snapshot (admin/verifier) ──────────
function _loadEntriesSnap(snap) {
  if (!snap.exists()) return;
  const all = snap.val() || {};
  Object.entries(all).forEach(([mkt, wks]) => {
    if (!db[mkt]) db[mkt] = {};
    Object.entries(wks).forEach(([wk, cids]) => {
      if (!db[mkt][wk]) db[mkt][wk] = {};
      Object.entries(cids).forEach(([cid, days]) => {
        if (!db[mkt][wk][cid]) db[mkt][wk][cid] = {};
        Object.entries(days).forEach(([day, dayData]) => {
          const d = parseInt(day);
          db[mkt][wk][cid][d] = {
            inputs: dayData.inputs || ['','','','','',''],
            notes:  dayData.notes  || ''
          };
        });
      });
    });
  });
}

// ── Parse single market snapshot (encoder) ────────────────
function _loadMarketSnap(mkt, snap) {
  if (!snap.exists()) return;
  if (!db[mkt]) db[mkt] = {};
  const wks = snap.val() || {};
  Object.entries(wks).forEach(([wk, cids]) => {
    if (!db[mkt][wk]) db[mkt][wk] = {};
    Object.entries(cids).forEach(([cid, days]) => {
      if (!db[mkt][wk][cid]) db[mkt][wk][cid] = {};
      Object.entries(days).forEach(([day, dayData]) => {
        const d = parseInt(day);
        db[mkt][wk][cid][d] = {
          inputs: dayData.inputs || ['','','','','',''],
          notes:  dayData.notes  || ''
        };
      });
    });
  });
}

// ════════════════════════════════════════════════════════
//  SAVE  —  batch write one market+week+day
// ════════════════════════════════════════════════════════
window.sbSaveDayBatch = async function(mkt, weekKey, dayIdx) {
  const coms     = window.dataComs ? dataComs() : [];
  const updates  = {};
  let   count    = 0;

  coms.forEach(com => {
    if (!com.id) return;
    const inputs = window.getInp ? getInp(mkt, weekKey, com.id, dayIdx) : [];
    const path   = 'entries/' + mkt + '/' + weekKey + '/' + com.id + '/' + dayIdx;

    // Always write the full inputs array (null = empty)
    const row = { inputs: inputs.map(v => v === '' || v == null ? null : parseFloat(v)) };

    // Only add note if it exists
    const notes = window.getNotes ? getNotes(mkt, weekKey, com.id, dayIdx) : '';
    if (notes) row.notes = notes;

    updates[path] = row;
    count++;
  });

  await update(ref(rtdb), updates);
  console.log('[FB] Saved', count, 'commodities →', mkt, weekKey, 'day', dayIdx);
  return count;
};

// ════════════════════════════════════════════════════════
//  LOCK DAY
// ════════════════════════════════════════════════════════
window.sbSaveDay = async function(mkt, weekKey, dayIdx) {
  try {
    await set(
      ref(rtdb, 'saved_days/' + mkt + '/' + weekKey + '/' + dayIdx),
      { saved: true, at: new Date().toISOString(), by: mkt }
    );
  } catch(e) { console.warn('[FB] lock day:', e); }
};

// ════════════════════════════════════════════════════════
//  PROGRESS OVERLAY
// ════════════════════════════════════════════════════════
function _showProgress(msg) {
  let el = document.getElementById('_fbProg');
  if (!el) {
    el = document.createElement('div');
    el.id = '_fbProg';
    el.style.cssText = 'position:fixed;inset:0;z-index:9998;' +
      'background:rgba(10,29,46,0.88);display:flex;' +
      'align-items:center;justify-content:center;' +
      'flex-direction:column;gap:14px';
    el.innerHTML =
      '<div style="width:46px;height:46px;border:4px solid rgba(255,255,255,0.15);' +
      'border-top-color:#2ba899;border-radius:50%;' +
      'animation:spin .7s linear infinite"></div>' +
      '<div id="_fbProgMsg" style="color:#e0faf7;font-family:Barlow Condensed,sans-serif;' +
      'font-size:14px;font-weight:700;letter-spacing:1px">' + msg + '</div>' +
      '<div style="color:rgba(255,255,255,0.35);font-size:10px">AMAD-IX · Firebase</div>';
    document.body.appendChild(el);
  } else {
    const m = document.getElementById('_fbProgMsg');
    if (m) m.textContent = msg;
  }
}
function _hideProgress() {
  const el = document.getElementById('_fbProg');
  if (el) el.remove();
}

// ════════════════════════════════════════════════════════
//  AUTO SESSION EXPIRY CHECK
// ════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (!user && window.curRole) {
    console.warn('[FB] Session expired');
    curRole = null;
    const ov = document.getElementById('loginOverlay');
    if (ov) ov.style.display = 'flex';
    if (window.showToast) showToast('⏏ Session expired — please sign in again', 'info');
  }
});

console.log('[Firebase] amad-firebase.js ready ✅');
