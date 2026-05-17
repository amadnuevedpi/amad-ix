// ════════════════════════════════════════════════════════════════
//  amad-firebase.js  —  AMAD-IX  v2  (Real-time Edition)
//  Firebase Realtime Database + Authentication
//  Fixes: save, cross-browser sync, edit requests, flags
// ════════════════════════════════════════════════════════════════

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth,
         signInWithEmailAndPassword,
         signOut,
         onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getDatabase,
         ref       as dbRef,
         set, get, update, remove,
         onValue,  off,
         serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';

// ── Config ───────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAEOWLp8_C3BmgOBc8eId3-bYsL-ezWyfM",
  authDomain:        "amad-ix.firebaseapp.com",
  databaseURL:       "https://amad-ix-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "amad-ix",
  storageBucket:     "amad-ix.firebasestorage.app",
  messagingSenderId: "167267361749",
  appId:             "1:167267361749:web:02bb40e1cf8a1e0b6cd35c"
};

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);
const rtdb  = getDatabase(fbApp);

// ── Market → Email map ───────────────────────────────────────
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

// ── Track active listeners so we can detach on logout ────────
const _listeners = [];

// ════════════════════════════════════════════════════════════
//  AUTH — LOGIN
// ════════════════════════════════════════════════════════════
window.sbLogin = async function(marketId, password) {
  try {
    const email = MARKET_EMAILS[marketId];
    if (!email) {
      console.error('[FB] No email for market:', marketId);
      return { ok: false, reason: 'no-user' };
    }
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return {
      ok:   true,
      user: {
        uid:      cred.user.uid,
        email:    cred.user.email,
        marketId: marketId,
        role: marketId === '__admin__'    ? 'admin'
            : marketId === '__verifier__' ? 'verifier'
            : 'encoder'
      }
    };
  } catch(e) {
    console.error('[FB] login error:', e.code, e.message);
    return {
      ok:     false,
      reason: e.code === 'auth/too-many-requests'      ? 'too-many'
            : e.code === 'auth/user-not-found'         ? 'no-user'
            : e.code === 'auth/network-request-failed' ? 'network'
            : 'wrong-password'
    };
  }
};

// ── LOGOUT ──────────────────────────────────────────────────
window.sbLogout = async function() {
  _detachAllListeners();
  try { await signOut(auth); } catch(e) { console.warn('[FB] signOut:', e); }
};

// ════════════════════════════════════════════════════════════
//  BOOT — initial load + attach real-time listeners
// ════════════════════════════════════════════════════════════
window.sbBootApp = async function(user) {
  _showProgress('Connecting to Firebase...', 10);

  try {
    const isAdmin    = user.marketId === '__admin__';
    const isVerifier = user.marketId === '__verifier__';

    // 1. Load locked days
    _showProgress('Loading locked days...', 20);
    await _loadSavedDays();

    // 2. Load price entries
    _showProgress('Loading price data...', 40);
    if (isAdmin || isVerifier) {
      await _loadAllEntries();
    } else {
      await _loadMarketEntries(user.marketId);
    }

    // 3. Load edit requests
    _showProgress('Loading edit requests...', 60);
    await _loadEditRequests(user.marketId, isAdmin, isVerifier);

    // 4. Load flags
    _showProgress('Loading flags...', 75);
    await _loadFlags(user.marketId, isAdmin, isVerifier);

    // 5. Build UI
    _showProgress('Building interface...', 88);
    buildUI();

    // 6. Attach real-time listeners
    _showProgress('Starting real-time sync...', 95);
    _attachListeners(user.marketId, isAdmin, isVerifier);

    _hideProgress();

    setTimeout(() => {
      if (window.autoFlagAll)    autoFlagAll();
      if (window.updateCounters) updateCounters();
    }, 400);

    showToast('✅ Firebase connected — real-time sync active');

  } catch(e) {
    _hideProgress();
    console.error('[FB] Boot error:', e);
    showToast('⚠ Cloud load failed: ' + e.message, 'err');
    buildUI();
  }
};

// ════════════════════════════════════════════════════════════
//  INITIAL DATA LOADERS (one-time reads on boot)
// ════════════════════════════════════════════════════════════

async function _loadSavedDays() {
  const snap = await get(dbRef(rtdb, 'saved_days'));
  if (!snap.exists()) return;
  const val = snap.val() || {};
  Object.entries(val).forEach(([mkt, wks]) => {
    Object.entries(wks || {}).forEach(([wk, days]) => {
      Object.entries(days || {}).forEach(([d, data]) => {
        if (data && data.saved) savedDays.add(mkt + '__' + wk + '__' + d);
      });
    });
  });
  console.log('[FB] Loaded', savedDays.size, 'locked days');
}

async function _loadAllEntries() {
  const snap = await get(dbRef(rtdb, 'entries'));
  if (!snap.exists()) return;
  _parseEntriesSnap(snap.val() || {});
  console.log('[FB] Loaded all market entries');
}

async function _loadMarketEntries(marketId) {
  const snap = await get(dbRef(rtdb, 'entries/' + marketId));
  if (!snap.exists()) return;
  _parseEntriesSnap({ [marketId]: snap.val() || {} });
  console.log('[FB] Loaded entries for', marketId);
}

async function _loadEditRequests(marketId, isAdmin, isVerifier) {
  const snap = await get(dbRef(rtdb, 'edit_requests'));
  if (!snap.exists()) return;
  editRequests.length = 0;
  Object.entries(snap.val() || {}).forEach(([id, row]) => {
    if (!row) return;
    if (!isAdmin && !isVerifier && row.mkt !== marketId) return;
    editRequests.unshift({ id, ...row });
  });
  console.log('[FB] Loaded', editRequests.length, 'edit requests');
}

async function _loadFlags(marketId, isAdmin, isVerifier) {
  const snap = await get(dbRef(rtdb, 'flags'));
  if (!snap.exists()) return;
  Object.entries(snap.val() || {}).forEach(([key, row]) => {
    if (!row || row.status !== 'open') return;
    if (!isAdmin && !isVerifier && row.mkt !== marketId) return;
    flags[key] = { key, ...row };
  });
  console.log('[FB] Loaded', Object.keys(flags).length, 'open flags');
}

function _parseEntriesSnap(allData) {
  Object.entries(allData).forEach(([mkt, wks]) => {
    if (!db[mkt]) db[mkt] = {};
    Object.entries(wks || {}).forEach(([wk, cids]) => {
      if (!db[mkt][wk]) db[mkt][wk] = {};
      Object.entries(cids || {}).forEach(([cid, days]) => {
        if (!db[mkt][wk][cid]) db[mkt][wk][cid] = {};
        Object.entries(days || {}).forEach(([day, dayData]) => {
          if (!dayData) return;
          db[mkt][wk][cid][parseInt(day)] = {
            inputs: dayData.inputs || ['','','','','',''],
            notes:  dayData.notes  || ''
          };
        });
      });
    });
  });
}

// ════════════════════════════════════════════════════════════
//  REAL-TIME LISTENERS — the core of cross-browser sync
// ════════════════════════════════════════════════════════════

function _attachListeners(marketId, isAdmin, isVerifier) {
  _detachAllListeners();

  // ── LISTENER 1: Entries ──────────────────────────────────
  const entriesPath = (isAdmin || isVerifier)
    ? 'entries'
    : 'entries/' + marketId;

  const entRef = dbRef(rtdb, entriesPath);
  onValue(entRef, snap => {
    if (!snap.exists()) return;
    const val     = snap.val() || {};
    const allData = (isAdmin || isVerifier) ? val : { [marketId]: val };
    _parseEntriesSnap(allData);

    clearTimeout(window._rebuildTimer);
    window._rebuildTimer = setTimeout(() => {
      if (window.rebuildCurrentPane) rebuildCurrentPane();
      if (window.updateStatus)       updateStatus();
      if (window.autoFlagAll)        autoFlagAll();
      if (window.updateCounters)     updateCounters();
    }, 500);
    console.log('[FB:live] Entries synced');
  });
  _listeners.push(entRef);

  // ── LISTENER 2: Edit Requests ────────────────────────────
  const erRef = dbRef(rtdb, 'edit_requests');
  onValue(erRef, snap => {
    const val     = snap.val() || {};
    const prevLen = editRequests.length;
    editRequests.length = 0;

    Object.entries(val).forEach(([id, row]) => {
      if (!row) return;
      if (!isAdmin && !isVerifier && row.mkt !== marketId) return;
      editRequests.unshift({ id, ...row });
    });

    const newPending = editRequests.filter(r => r.status === 'pending').length;

    // Notify ADMIN/VERIFIER of new pending requests
    if ((isAdmin || isVerifier) && editRequests.length > prevLen && newPending > 0) {
      const btn = document.getElementById('approvalBtn');
      if (btn) {
        btn.style.display   = 'inline-flex';
        btn.style.boxShadow = '0 0 0 6px rgba(212,168,67,0.7)';
        setTimeout(() => { btn.style.boxShadow = ''; }, 3500);
      }
      showToast('📋 New edit request from an encoder!', 'info');
    }

    // Notify ENCODER when request approved or rejected
    if (!isAdmin && !isVerifier) {
      editRequests.forEach(req => {
        if (req.mkt !== marketId) return;
        const rejKey = '_rej_shown_' + req.id;

        if (req.status === 'approved') {
          const key = req.mkt + '__' + req.wk + '__' + req.day;
          if (savedDays.has(key)) {
            savedDays.delete(key);
            localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
            if (window.rebuildCurrentPane) rebuildCurrentPane();
            showToast('✅ Your edit was APPROVED — ' +
              (DAYS[req.day] || '') + ' is now unlocked!', 'info');
          }
        } else if (req.status === 'rejected' && !sessionStorage.getItem(rejKey)) {
          sessionStorage.setItem(rejKey, '1');
          showToast('❌ Edit request REJECTED' +
            (req.reason ? ': ' + req.reason : ''), 'err');
        }
      });
    }

    if (window.updateCounters) updateCounters();
    if (document.getElementById('approvalPanel')?.classList.contains('open') &&
        window.renderApprovalBody) renderApprovalBody();
    console.log('[FB:live] Edit requests synced:', editRequests.length);
  });
  _listeners.push(erRef);

  // ── LISTENER 3: Flags ────────────────────────────────────
  const flRef = dbRef(rtdb, 'flags');
  onValue(flRef, snap => {
    // Clear and reload
    Object.keys(flags).forEach(k => { delete flags[k]; });

    const val          = snap.val() || {};
    let   newFlagCount = 0;

    Object.entries(val).forEach(([key, row]) => {
      if (!row || row.status !== 'open') return;
      if (!isAdmin && !isVerifier && row.mkt !== marketId) return;
      flags[key] = { key, ...row };
      newFlagCount++;
    });

    // Notify ENCODER of flags in their market
    if (!isAdmin && !isVerifier) {
      const myFlags  = Object.values(flags).filter(f => f.mkt === marketId);
      const redCount = myFlags.filter(f => f.color === 'red').length;
      const ambCount = myFlags.filter(f => f.color === 'amber').length;

      if (myFlags.length > 0) {
        const fb = document.getElementById('flagBtn');
        if (fb) {
          fb.style.display    = 'inline-flex';
          fb.style.background = redCount > 0
            ? 'linear-gradient(135deg,#8b0000,#c62828)'
            : 'linear-gradient(135deg,#7a3000,#c97000)';
          fb.style.boxShadow  = '0 0 0 5px rgba(198,40,40,0.6)';
          setTimeout(() => { fb.style.boxShadow = ''; }, 3000);
        }
        if (redCount > 0) {
          showToast('🚩 ' + redCount + ' flagged entr' +
            (redCount > 1 ? 'ies' : 'y') +
            ' in your market — open 🚩 Flags panel', 'info');
        } else if (ambCount > 0) {
          showToast('⚠ ' + ambCount + ' amber warning' +
            (ambCount > 1 ? 's' : '') + ' — open 🚩 Flags panel', 'info');
        }
      }
    }

    // Notify ADMIN/VERIFIER
    if ((isAdmin || isVerifier) && newFlagCount > 0) {
      const fb = document.getElementById('flagBtn');
      if (fb) fb.style.display = 'inline-flex';
    }

    // Recolor DOM cells
    clearTimeout(window._flagTimer);
    window._flagTimer = setTimeout(() => {
      if (window.autoFlagAll)    autoFlagAll();
      if (window.updateCounters) updateCounters();
    }, 300);

    if (document.getElementById('flagPanel')?.classList.contains('open') &&
        window.renderFlagBody) renderFlagBody();
    console.log('[FB:live] Flags synced:', newFlagCount, 'open');
  });
  _listeners.push(flRef);

  // ── LISTENER 4: Saved Days ───────────────────────────────
  const sdRef = dbRef(rtdb, 'saved_days');
  onValue(sdRef, snap => {
    savedDays.clear();
    if (!snap.exists()) return;
    Object.entries(snap.val() || {}).forEach(([mkt, wks]) => {
      Object.entries(wks || {}).forEach(([wk, days]) => {
        Object.entries(days || {}).forEach(([d, data]) => {
          if (data && data.saved) savedDays.add(mkt + '__' + wk + '__' + d);
        });
      });
    });
    localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
    console.log('[FB:live] Saved days synced:', savedDays.size);
  });
  _listeners.push(sdRef);

  console.log('[FB] ✅ All 4 real-time listeners attached');
}

function _detachAllListeners() {
  _listeners.forEach(r => { try { off(r); } catch(e) {} });
  _listeners.length = 0;
  console.log('[FB] Listeners detached');
}

// ════════════════════════════════════════════════════════════
//  SAVE — batch write market+week+day
// ════════════════════════════════════════════════════════════
window.sbSaveDayBatch = async function(mkt, weekKey, dayIdx) {
  const coms    = window.dataComs ? dataComs() : [];
  const updates = {};
  let   count   = 0;

  coms.forEach(com => {
    if (!com.id) return;
    const inputs = window.getInp  ? getInp(mkt, weekKey, com.id, dayIdx)  : [];
    const notes  = window.getNotes ? getNotes(mkt, weekKey, com.id, dayIdx) : '';
    const hasData = inputs.some(v => v !== '' && v != null);
    if (!hasData) return;

    updates['entries/' + mkt + '/' + weekKey + '/' + com.id + '/' + dayIdx] = {
      inputs:  inputs.map(v => (v === '' || v == null) ? null : parseFloat(v)),
      notes:   notes || null,
      savedAt: new Date().toISOString(),
      savedBy: mkt
    };
    count++;
  });

  if (count === 0) {
    console.warn('[FB] Nothing to save — enter prices first');
    return 0;
  }

  await update(dbRef(rtdb), updates);
  console.log('[FB] ✅ Saved', count, 'entries →', mkt, weekKey, 'day', dayIdx);
  return count;
};

// ── LOCK DAY ────────────────────────────────────────────────
window.sbSaveDay = async function(mkt, weekKey, dayIdx) {
  try {
    await set(
      dbRef(rtdb, 'saved_days/' + mkt + '/' + weekKey + '/' + dayIdx),
      { saved: true, at: new Date().toISOString(), by: mkt }
    );
  } catch(e) { console.warn('[FB] lock day:', e.message); }
};

// ── UNLOCK DAY ──────────────────────────────────────────────
window.sbUnlockDay = async function(mkt, weekKey, dayIdx) {
  try {
    await remove(dbRef(rtdb, 'saved_days/' + mkt + '/' + weekKey + '/' + dayIdx));
  } catch(e) { console.warn('[FB] unlock day:', e.message); }
};

// ════════════════════════════════════════════════════════════
//  EDIT REQUESTS
// ════════════════════════════════════════════════════════════
window.sbSaveEditRequest = async function(req) {
  try {
    await set(dbRef(rtdb, 'edit_requests/' + req.id), {
      mkt:         req.mkt         || null,
      wk:          req.wk          || null,
      day:         req.day         != null ? req.day : null,
      date:        req.date        || null,
      marketLabel: req.marketLabel || null,
      encoder:     req.encoder     || req.mkt || null,
      status:      req.status      || 'pending',
      reason:      req.reason      || null,
      cid:         req.cid         || null,
      commodity:   req.commodity   || null,
      idx:         req.idx         != null ? req.idx : null,
      oldVal:      req.oldVal      != null ? req.oldVal : null,
      newVal:      req.newVal      != null ? req.newVal : null,
      flagKey:     req.flagKey     || null,
      resolvedAt:  req.resolvedAt  || null,
      resolvedBy:  req.resolvedBy  || null,
      ts:          req.ts          || new Date().toISOString(),
    });
  } catch(e) { console.error('[FB] save edit request:', e.message); }
};

// ════════════════════════════════════════════════════════════
//  FLAGS
// ════════════════════════════════════════════════════════════
window.sbSaveFlag = async function(f) {
  try {
    await set(dbRef(rtdb, 'flags/' + f.key), {
      mkt:              f.mkt           || null,
      wk:               f.wk            || null,
      cid:              f.cid           || null,
      day:              f.day           != null ? f.day : null,
      idx:              f.idx           != null ? f.idx : null,
      value:            f.value         != null ? f.value : null,
      correctedVal:     f.correctedVal  != null ? f.correctedVal : null,
      type:             f.type          || 'manual',
      color:            f.color         || 'red',
      severity:         f.severity      || 'auto',
      msg:              f.msg           || '',
      remarks:          f.remarks       || null,
      status:           f.status        || 'open',
      raisedBy:         f.raisedBy      || 'system',
      encoderCorrected: !!f.encoderCorrected,
      correctedAt:      f.correctedAt   || null,
      resolvedAt:       f.resolvedAt    || null,
      resolvedBy:       f.resolvedBy    || null,
      rowAvg:           f.rowAvg        != null ? parseFloat(f.rowAvg) : null,
      marketLabel:      f.marketLabel   || null,
      commodity:        f.commodity     || null,
      spec:             f.spec          || null,
      ts:               f.ts            || new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
    });
  } catch(e) { console.error('[FB] save flag:', e.message); }
};

// ════════════════════════════════════════════════════════════
//  PATCHES — wire Firebase saves into existing JS functions
// ════════════════════════════════════════════════════════════
function _applyPatches() {

  // Patch: requestEditForDate
  window.requestEditForDate = async function(mktId, wkKey, dayIdx) {
    if (curRole !== 'encoder') {
      showToast('❌ Only encoders can request edits', 'err'); return;
    }
    const existing = editRequests.find(r =>
      r.mkt === mktId && r.wk === wkKey &&
      r.day === dayIdx && r.status === 'pending');
    if (existing) {
      showToast('⏳ A request for this date is already pending', 'info'); return;
    }
    const mk      = dataMkts().find(m => m.id === mktId);
    const dd      = dayDate(dayIdx);
    const dateLbl = dd
      ? dd.toLocaleDateString('en-PH', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';
    const req = {
      id: 'req_' + genId(), mkt: mktId, wk: wkKey, day: dayIdx,
      date: dateLbl, encoder: mktId, marketLabel: mk?.label || mktId,
      status: 'pending', reason: '', ts: new Date().toISOString(),
    };
    editRequests.push(req);
    await sbSaveEditRequest(req);
    showToast('📋 Edit request sent — waiting for admin approval', 'info');
    updateCounters();
    renderApprovalBody();
  };

  // Patch: approveDateRequest
  window.approveDateRequest = async function(reqId) {
    const req = editRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    req.status = 'approved';
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = curRole;
    const dayKey = req.mkt + '__' + req.wk + '__' + req.day;
    savedDays.delete(dayKey);
    localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
    await sbUnlockDay(req.mkt, req.wk, req.day);
    await sbSaveEditRequest(req);
    showToast('✅ Approved — ' + DAYS[req.day] + ' unlocked for ' + req.marketLabel);
    if (req.mkt === curMkt) rebuildCurrentPane();
    renderApprovalBody();
    updateCounters();
  };

  // Patch: rejectDateRequest
  window.rejectDateRequest = async function(reqId) {
    const req = editRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    req.status = 'rejected';
    req.reason = document.getElementById('reason-' + reqId)?.value || '';
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = curRole;
    await sbSaveEditRequest(req);
    showToast('🗑 Rejected — ' + req.marketLabel + ' ' + DAYS[req.day]);
    renderApprovalBody();
    updateCounters();
  };

  // Patch: autoFlagCell — persist new system flags
  const _origAutoFlag = window.autoFlagCell;
  window.autoFlagCell = function(mkt, wk, cid, day, idx, value) {
    _origAutoFlag.call(this, mkt, wk, cid, day, idx, value);
    const f = flags[flagKey(mkt, wk, cid, day, idx)];
    if (f && f.status === 'open' && f.raisedBy === 'system') {
      sbSaveFlag(f).catch(e => console.warn('[FB] autoFlag:', e.message));
    }
  };

  // Patch: resolveFlag — persist status changes
  const _origResolve = window.resolveFlag;
  window.resolveFlag = function(key, action) {
    _origResolve.call(this, key, action);
    const f = flags[key];
    if (f) sbSaveFlag(f).catch(e => console.warn('[FB] resolveFlag:', e.message));
  };

  // Patch: manualFlag — persist manual flags
  const _origManual = window.manualFlag;
  window.manualFlag = function(mkt, wk, cid, day, idx, value, remarks) {
    _origManual.call(this, mkt, wk, cid, day, idx, value, remarks);
    const f = flags[flagKey(mkt, wk, cid, day, idx)];
    if (f) sbSaveFlag(f).catch(e => console.warn('[FB] manualFlag:', e.message));
  };

  // Patch: submitFlagCorrection — persist encoder correction
  const _origSubmit = window.submitFlagCorrection;
  window.submitFlagCorrection = function(fKey) {
    _origSubmit.call(this, fKey);
    const f = flags[fKey];
    if (f) sbSaveFlag(f).catch(e => console.warn('[FB] correction:', e.message));
  };

  // Patch: acknowledgeCorrection
  const _origAck = window.acknowledgeCorrection;
  window.acknowledgeCorrection = function(reqId) {
    _origAck.call(this, reqId);
    const req = editRequests.find(r => r.id === reqId);
    if (req) sbSaveEditRequest(req).catch(e => console.warn('[FB] ack:', e.message));
  };

  // Patch: notifyFlagCorrection — save the correction notification
  const _origNotify = window.notifyFlagCorrection;
  window.notifyFlagCorrection = function(fKey, mkt, wk, cid, day, idx, oldVal, newVal) {
    _origNotify.call(this, fKey, mkt, wk, cid, day, idx, oldVal, newVal);
    const corr = editRequests.find(r =>
      r.status === 'correction' && r.flagKey === fKey && r.newVal === newVal);
    if (corr) sbSaveEditRequest(corr).catch(e => console.warn('[FB] notifyCorr:', e.message));
  };

  // Patch: saveFlagRemark
  const _origRemark = window.saveFlagRemark;
  window.saveFlagRemark = function(fKey) {
    _origRemark.call(this, fKey);
    const f = flags[fKey];
    if (f) sbSaveFlag(f).catch(e => console.warn('[FB] remark:', e.message));
  };

  console.log('[FB] ✅ All patches applied');
}

// ════════════════════════════════════════════════════════════
//  saveAll — full replacement
// ════════════════════════════════════════════════════════════
window.saveAll = async function() {
  const btn = document.querySelector('.btn-gn');
  if (btn) { btn.textContent = '⏳ Saving...'; btn.disabled = true; }

  try {
    const skip = ['regional', 'provincial', 'analytics', 'manage'];
    if (skip.includes(curMkt)) {
      showToast('ℹ️ Switch to a market tab to save data', 'info');
      return;
    }

    const count = await sbSaveDayBatch(curMkt, curWeek, curDay);

    // Lock day for encoder only
    if (curRole === 'encoder') {
      const hasData = db[curMkt]?.[curWeek] &&
        Object.values(db[curMkt][curWeek]).some(c =>
          c[curDay]?.inputs?.some(v => v !== '' && v != null));
      if (hasData) {
        const key = curMkt + '__' + curWeek + '__' + curDay;
        savedDays.add(key);
        await sbSaveDay(curMkt, curWeek, curDay);
      }
    }

    try {
      localStorage.setItem('amad9v5_state',
        JSON.stringify({ curMkt, curYear, curWeek, curDay, curPeriod, analyticsScope }));
      localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
    } catch(e) {}

    const el = document.getElementById('sbSave');
    if (el) el.textContent = new Date().toLocaleTimeString('en-PH');

    const dd = dayDate(curDay);
    const dl = dd
      ? dd.toLocaleDateString('en-PH', { day:'2-digit', month:'2-digit', year:'numeric' })
      : 'today';

    showToast('✅ ' + DAYS[curDay] + ' (' + dl + ') — ' + count + ' entries saved');
    rebuildCurrentPane();

  } catch(e) {
    console.error('[FB] saveAll:', e);
    showToast('❌ Save failed: ' + e.message, 'err');
  } finally {
    if (btn) { btn.textContent = '💾 Save'; btn.disabled = false; }
  }
};

// ════════════════════════════════════════════════════════════
//  PROGRESS OVERLAY
// ════════════════════════════════════════════════════════════
function _showProgress(msg, pct) {
  let el = document.getElementById('_fbProg');
  if (!el) {
    el = document.createElement('div');
    el.id = '_fbProg';
    el.style.cssText = 'position:fixed;inset:0;z-index:9998;' +
      'background:rgba(10,29,46,0.92);display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;gap:12px';
    el.innerHTML = `
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;
        font-weight:900;letter-spacing:3px;color:#2ba899">AMAD IX</div>
      <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.1);
        border-top-color:#2ba899;border-radius:50%;
        animation:spin .7s linear infinite"></div>
      <div id="_fbProgMsg" style="color:#e0faf7;font-family:'Barlow Condensed',sans-serif;
        font-size:13px;font-weight:700;letter-spacing:1px;text-align:center">${msg}</div>
      <div style="width:240px;height:4px;background:rgba(255,255,255,0.1);
        border-radius:2px;overflow:hidden">
        <div id="_fbProgBar" style="height:100%;width:${pct||0}%;
          background:linear-gradient(90deg,#1a5c6e,#2ba899);
          border-radius:2px;transition:width .3s"></div>
      </div>
      <div id="_fbProgPct" style="color:rgba(255,255,255,0.4);font-size:10px">${pct||0}%</div>`;
    document.body.appendChild(el);
  } else {
    const m = document.getElementById('_fbProgMsg');
    const b = document.getElementById('_fbProgBar');
    const p = document.getElementById('_fbProgPct');
    if (m) m.textContent = msg;
    if (b) b.style.width = (pct || 0) + '%';
    if (p) p.textContent = (pct || 0) + '%';
  }
}

function _hideProgress() {
  const el = document.getElementById('_fbProg');
  if (el) el.remove();
}

// ════════════════════════════════════════════════════════════
//  SESSION EXPIRY
// ════════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (!user && window.curRole) {
    _detachAllListeners();
    curRole = null;
    const ov = document.getElementById('loginOverlay');
    if (ov) ov.style.display = 'flex';
    if (window.showToast) showToast('⏏ Session expired — please sign in again', 'info');
  }
});

// Apply patches after main script loads
setTimeout(_applyPatches, 250);

console.log('[Firebase] amad-firebase.js v2 loaded ✅');
