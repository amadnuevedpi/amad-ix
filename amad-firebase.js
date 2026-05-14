// ══════════════════════════════════════════════════════════════════
// amad-firebase.js  —  AMAD IX · Firebase Data Adapter  v1
// Replaces: amad-supabase.js
// Requires: Firebase Realtime Database + Firebase Authentication
//
// SETUP:
//   1. Replace FIREBASE_CONFIG below with your project's config
//   2. Remove the <script src="amad-supabase.js"> tag from index.html
//   3. Add these two lines before </body> in index.html:
//      <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
//      <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
//      <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>
//      <script src="amad-firebase.js"></script>
// ══════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────
// ★ REPLACE THIS with your Firebase project config
// ─────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────────────
// User → market mapping  (matches the emails you created in Auth)
// Format: "marketId": "email@domain.com"
// ─────────────────────────────────────────────────────────────────
const MARKET_EMAILS = {
  "__admin__":    "admin@darfo9.gov.ph",
  "__verifier__": "verifier@darfo9.gov.ph",
  "zc_main":      "zc_main@darfo9.gov.ph",
  "zc_sta":       "zc_sta@darfo9.gov.ph",
  "agora":        "agora@darfo9.gov.ph",
  "ipil":         "ipil@darfo9.gov.ph",
  "dipolog":      "dipolog@darfo9.gov.ph",
  "imelda":       "imelda@darfo9.gov.ph",
  "tampilisan":   "tampilisan@darfo9.gov.ph",
  "liloy":        "liloy@darfo9.gov.ph",
  "sindangan":    "sindangan@darfo9.gov.ph",
  "molave":       "molave@darfo9.gov.ph",
  "isabela":      "isabela@darfo9.gov.ph",
  "jolo":         "jolo@darfo9.gov.ph",
};

// ─────────────────────────────────────────────────────────────────
// Initialize Firebase
// ─────────────────────────────────────────────────────────────────
if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
const _auth = firebase.auth();
const _db   = firebase.database();

// Convenience: typed database refs
const ref  = path => _db.ref(path);
const eRef = (mkt, wk, cid, day, idx) =>
  ref(`entries/${mkt}/${wk}/${cid}/${day}/${idx}`);

// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
async function sbLogin(marketId, password) {
  const email = MARKET_EMAILS[marketId];
  if (!email) return { ok: false };
  try {
    const cred = await _auth.signInWithEmailAndPassword(email, password);
    const user = cred.user;
    // Determine role from marketId
    let role = 'encoder';
    if (marketId === '__admin__')    role = 'admin';
    if (marketId === '__verifier__') role = 'verifier';
    return { ok: true, user: { market_id: marketId, role, uid: user.uid } };
  } catch (err) {
    console.warn('[FB] login failed:', err.code);
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────
// LOAD ENTRIES — reads all saved observations for a market
// ─────────────────────────────────────────────────────────────────
async function sbLoadAllEntries(marketId) {
  const snap = await ref(`entries/${marketId}`).once('value');
  const data  = snap.val() || {};
  if (!db[marketId]) db[marketId] = {};

  // data shape: { weekKey: { cid: { dayIdx: { obsIdx: value } } } }
  Object.entries(data).forEach(([wk, weekData]) => {
    if (!db[marketId][wk]) db[marketId][wk] = {};
    Object.entries(weekData).forEach(([cid, cidData]) => {
      if (!db[marketId][wk][cid]) db[marketId][wk][cid] = {};
      Object.entries(cidData).forEach(([day, dayData]) => {
        const d = parseInt(day);
        if (!db[marketId][wk][cid][d])
          db[marketId][wk][cid][d] = { inputs: ['','','','','',''], notes: '' };
        Object.entries(dayData).forEach(([idx, val]) => {
          db[marketId][wk][cid][d].inputs[parseInt(idx)] =
            val != null ? parseFloat(val) : '';
        });
      });
    });
  });
  console.log('[FB] Loaded entries for', marketId);
}

async function sbLoadEntries(marketId, weekKey) {
  if (!weekKey) return;
  const snap = await ref(`entries/${marketId}/${weekKey}`).once('value');
  const data  = snap.val() || {};
  if (!db[marketId])        db[marketId] = {};
  if (!db[marketId][weekKey]) db[marketId][weekKey] = {};

  Object.entries(data).forEach(([cid, cidData]) => {
    if (!db[marketId][weekKey][cid]) db[marketId][weekKey][cid] = {};
    Object.entries(cidData).forEach(([day, dayData]) => {
      const d = parseInt(day);
      if (!db[marketId][weekKey][cid][d])
        db[marketId][weekKey][cid][d] = { inputs: ['','','','','',''], notes: '' };
      Object.entries(dayData).forEach(([idx, val]) => {
        db[marketId][weekKey][cid][d].inputs[parseInt(idx)] =
          val != null ? parseFloat(val) : '';
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// BATCH SAVE — delete-then-write all observations for a day
// ─────────────────────────────────────────────────────────────────
async function sbSaveDayBatch(marketId, weekKey, dayIndex) {
  const coms = window.dataComs ? dataComs() : [];
  const updates = {};

  // First: null out everything for this day (delete-then-write pattern)
  coms.forEach(com => {
    for (let i = 0; i < 6; i++) {
      updates[`entries/${marketId}/${weekKey}/${com.id}/${dayIndex}/${i}`] = null;
    }
  });

  // Then: write current non-empty values
  let count = 0;
  coms.forEach(com => {
    const inputs = window.getInp ? getInp(marketId, weekKey, com.id, dayIndex) : [];
    inputs.forEach((val, obsIdx) => {
      const v = (val === '' || val == null) ? null : parseFloat(val);
      if (v !== null) {
        updates[`entries/${marketId}/${weekKey}/${com.id}/${dayIndex}/${obsIdx}`] = v;
        count++;
      }
    });
  });

  await _db.ref('/').update(updates);
  console.log('[FB] Batch saved', count, 'values →', marketId, weekKey, 'day', dayIndex);
  return count;
}

// Single-entry save (used by autoFlagCell and inline corrections)
async function sbSaveEntry(marketId, weekKey, dayIndex, commodityId, obsIndex, value) {
  const v = (value === '' || value == null) ? null : parseFloat(value);
  await eRef(marketId, weekKey, commodityId, dayIndex, obsIndex).set(v);
}

// ─────────────────────────────────────────────────────────────────
// SAVED DAYS (locking)
// ─────────────────────────────────────────────────────────────────
async function sbLoadSavedDays() {
  const snap = await ref('saved_days').once('value');
  const data  = snap.val() || {};
  // shape: { marketId: { weekKey: { dayIndex: true } } }
  Object.entries(data).forEach(([mkt, wkMap]) => {
    Object.entries(wkMap).forEach(([wk, dayMap]) => {
      Object.keys(dayMap).forEach(d => {
        if (dayMap[d]) savedDays.add(`${mkt}__${wk}__${d}`);
      });
    });
  });
}

async function sbSaveDay(marketId, weekKey, dayIndex) {
  await ref(`saved_days/${marketId}/${weekKey}/${dayIndex}`).set({
    saved: true,
    saved_by: window.curUserMarket || marketId,
    saved_at: new Date().toISOString(),
  });
}

async function sbUnlockDay(marketId, weekKey, dayIndex) {
  await ref(`saved_days/${marketId}/${weekKey}/${dayIndex}`).remove();
}

// ─────────────────────────────────────────────────────────────────
// FLAGS
// ─────────────────────────────────────────────────────────────────
async function sbLoadFlags(marketId) {
  let q = ref('flags');
  const snap = await q.once('value');
  const data  = snap.val() || {};

  Object.entries(data).forEach(([key, row]) => {
    // For encoders: filter to own market only
    if (marketId && marketId !== '__admin__' && marketId !== '__verifier__') {
      if (row.mkt !== marketId) return;
    }
    if (row.status !== 'open') return;
    flags[key] = {
      key,
      mkt:            row.mkt,
      wk:             row.wk,
      cid:            row.cid,
      day:            row.day,
      idx:            row.idx,
      value:          row.value,
      correctedVal:   row.correctedVal,
      type:           row.type,
      color:          row.color,
      severity:       row.severity,
      msg:            row.msg,
      remarks:        row.remarks,
      status:         row.status,
      raisedBy:       row.raisedBy,
      encoderCorrected: row.encoderCorrected,
      correctedAt:    row.correctedAt,
      rowAvg:         row.rowAvg,
      marketLabel:    row.marketLabel,
      commodity:      row.commodity,
      spec:           row.spec,
      ts:             row.ts,
    };
  });
}

async function sbSaveFlag(f) {
  const key = f.key;
  await ref(`flags/${key}`).set({
    mkt:            f.mkt,
    wk:             f.wk,
    cid:            f.cid,
    day:            f.day,
    idx:            f.idx,
    value:          f.value ?? null,
    correctedVal:   f.correctedVal ?? null,
    type:           f.type,
    color:          f.color,
    severity:       f.severity || 'auto',
    msg:            f.msg || '',
    remarks:        f.remarks || null,
    status:         f.status,
    raisedBy:       f.raisedBy || 'system',
    encoderCorrected: !!f.encoderCorrected,
    correctedAt:    f.correctedAt || null,
    rowAvg:         f.rowAvg ? parseFloat(f.rowAvg) : null,
    marketLabel:    f.marketLabel || '',
    commodity:      f.commodity || '',
    spec:           f.spec || '',
    ts:             f.ts || new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────
// EDIT REQUESTS
// ─────────────────────────────────────────────────────────────────
async function sbLoadEditRequests() {
  const snap = await ref('edit_requests').orderByChild('ts').limitToLast(200).once('value');
  const data  = snap.val() || {};
  editRequests.length = 0;
  Object.entries(data).forEach(([id, row]) => {
    editRequests.unshift({
      id,
      mkt:         row.mkt,
      wk:          row.wk,
      day:         row.day,
      date:        row.date,
      marketLabel: row.marketLabel,
      encoder:     row.encoder,
      status:      row.status,
      reason:      row.reason,
      cid:         row.cid,
      commodity:   row.commodity,
      idx:         row.idx,
      oldVal:      row.oldVal,
      newVal:      row.newVal,
      flagKey:     row.flagKey,
      resolvedAt:  row.resolvedAt,
      resolvedBy:  row.resolvedBy,
      ts:          row.ts,
    });
  });
}

async function sbSaveEditRequest(req) {
  await ref(`edit_requests/${req.id}`).set({
    mkt:         req.mkt,
    wk:          req.wk,
    day:         req.day,
    date:        req.date || null,
    marketLabel: req.marketLabel || '',
    encoder:     req.encoder || req.mkt,
    status:      req.status,
    reason:      req.reason || null,
    cid:         req.cid || null,
    commodity:   req.commodity || null,
    idx:         req.idx != null ? req.idx : null,
    oldVal:      req.oldVal != null ? req.oldVal : null,
    newVal:      req.newVal != null ? req.newVal : null,
    flagKey:     req.flagKey || null,
    resolvedAt:  req.resolvedAt || null,
    resolvedBy:  req.resolvedBy || null,
    ts:          req.ts || new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────
// FUNCTION PATCHES  (applied after boot, same as supabase version)
// ─────────────────────────────────────────────────────────────────
function _patchFunctions() {

  // ── PATCH 1: hInp — admin & verifier bypass cell-lock completely ──
  const _origHInp = window.hInp;
  window.hInp = function(el) {
    if (window.curRole === 'admin' || window.curRole === 'verifier') {
      const { mkt, cid, day, idx } = el.dataset;
      setInp(mkt, curWeek, cid, parseInt(day), parseInt(idx), el.value);
      colorRowCells(mkt, curWeek, cid, parseInt(day));
      autoFlagCell(mkt, curWeek, cid, parseInt(day), parseInt(idx), parseFloat(el.value));
      updateCounters();
      el.style.borderColor = '#2ba899';
      el.title = '✏️ Edited by ' + curRole;
      return;
    }
    _origHInp.call(this, el);
  };

  // ── PATCH 2: requestEditForDate — persist to Firebase ──
  window.requestEditForDate = async function(mktId, wkKey, dayIdx) {
    if (curRole !== 'encoder') { showToast('❌ Only encoders can request edits', 'err'); return; }
    const existing = editRequests.find(r =>
      r.mkt === mktId && r.wk === wkKey && r.day === dayIdx && r.status === 'pending');
    if (existing) { showToast('⏳ A request for this date is already pending', 'info'); return; }

    const mk     = dataMkts().find(m => m.id === mktId);
    const dd     = dayDate(dayIdx);
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
    showToast('📋 Edit request sent for ' + DAYS[dayIdx] + ' (' + dateLbl + ')', 'info');
    updateCounters();
    renderApprovalBody();
  };

  // ── PATCH 3: approveDateRequest — persist + unlock in Firebase ──
  window.approveDateRequest = async function(reqId) {
    const req = editRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    req.status     = 'approved';
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = curRole;

    const dayKey = req.mkt + '__' + req.wk + '__' + req.day;
    savedDays.delete(dayKey);
    localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));

    await sbUnlockDay(req.mkt, req.wk, req.day);
    await sbSaveEditRequest(req);

    showToast('✅ Approved — ' + DAYS[req.day] + ' (' + req.date + ') unlocked for ' + req.marketLabel);
    if (req.mkt === curMkt) rebuildCurrentPane();
    renderApprovalBody();
    updateCounters();
  };

  // ── PATCH 4: rejectDateRequest — persist rejection ──
  window.rejectDateRequest = async function(reqId) {
    const req = editRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    req.status     = 'rejected';
    req.reason     = document.getElementById('reason-' + reqId)?.value || '';
    req.resolvedAt = new Date().toISOString();
    req.resolvedBy = curRole;
    await sbSaveEditRequest(req);
    showToast('🗑 Rejected — ' + req.marketLabel + ' ' + DAYS[req.day]);
    renderApprovalBody();
    updateCounters();
  };

  // ── PATCH 5: autoFlagCell — persist new flags ──
  const _origAutoFlag = window.autoFlagCell;
  window.autoFlagCell = function(mkt, wk, cid, day, idx, value) {
    _origAutoFlag.call(this, mkt, wk, cid, day, idx, value);
    const f = flags[flagKey(mkt, wk, cid, day, idx)];
    if (f && f.status === 'open' && f.raisedBy === 'system') {
      sbSaveFlag(f).catch(e => console.warn('[FB] autoFlag persist:', e.message));
    }
  };

  // ── PATCH 6: resolveFlag — persist status changes ──
  const _origResolve = window.resolveFlag;
  window.resolveFlag = function(key, action) {
    _origResolve.call(this, key, action);
    const f = flags[key];
    if (f) sbSaveFlag(f).catch(e => console.warn('[FB] resolveFlag persist:', e.message));
  };

  console.log('[FB] Patches applied ✅');
}

// ─────────────────────────────────────────────────────────────────
// saveAll — replaces the HTML version, handles admin edits correctly
// ─────────────────────────────────────────────────────────────────
window.saveAll = async function saveAll() {
  const saveBtn = document.querySelector('.btn-gn');
  if (saveBtn) { saveBtn.textContent = '⏳ Saving...'; saveBtn.disabled = true; }

  try {
    const summaryTabs = ['regional', 'provincial', 'analytics', 'manage'];
    const targetMkt   = summaryTabs.includes(curMkt) ? null : curMkt;

    if (!targetMkt) {
      showToast('ℹ️ Switch to a market tab to save data', 'info');
      return;
    }

    const savedCount = await sbSaveDayBatch(targetMkt, curWeek, curDay);

    // Lock day only for encoder saves
    if (curRole === 'encoder') {
      const hasData = db[targetMkt]?.[curWeek] &&
        Object.values(db[targetMkt][curWeek]).some(c =>
          c[curDay]?.inputs?.some(v => v !== '' && v != null)
        );
      if (hasData) {
        const key = targetMkt + '__' + curWeek + '__' + curDay;
        savedDays.add(key);
        await sbSaveDay(targetMkt, curWeek, curDay);
      }
    }

    // Persist UI state locally
    try {
      localStorage.setItem('amad9v5_state', JSON.stringify({
        curMkt, curYear, curWeek, curDay, curPeriod, analyticsScope
      }));
      localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
    } catch(e) {}

    const el = document.getElementById('sbSave');
    if (el) el.textContent = new Date().toLocaleTimeString('en-PH');

    const dd     = dayDate(curDay);
    const dateLbl = dd
      ? dd.toLocaleDateString('en-PH', { day:'2-digit', month:'2-digit', year:'numeric' })
      : 'today';
    const note = (curRole === 'admin' || curRole === 'verifier')
      ? ' · day remains unlocked' : '';

    showToast('✅ ' + DAYS[curDay] + ' (' + dateLbl + ') — ' + savedCount + ' values saved to Firebase' + note);
    rebuildCurrentPane();

  } catch (err) {
    console.error('[FB] saveAll:', err);
    showToast('❌ Save failed: ' + err.message, 'err');
  } finally {
    if (saveBtn) { saveBtn.textContent = '💾 Save'; saveBtn.disabled = false; }
  }
};

// ─────────────────────────────────────────────────────────────────
// REAL-TIME LISTENERS — Firebase onValue() replaces Supabase channels
// ─────────────────────────────────────────────────────────────────
let _realtimeActive = false;

function sbSubscribeRealtime() {
  if (_realtimeActive) return;
  _realtimeActive = true;

  // ── Flags ──
  ref('flags').on('value', snap => {
    const data = snap.val() || {};
    // Clear existing open flags and reload from Firebase
    Object.keys(flags).forEach(k => { if (flags[k].raisedBy === 'system') delete flags[k]; });
    Object.entries(data).forEach(([key, row]) => {
      if (!row || row.status !== 'open') return;
      // For encoders: own market only
      if (curRole === 'encoder' && row.mkt !== curUserMarket) return;
      flags[key] = {
        key, mkt: row.mkt, wk: row.wk, cid: row.cid,
        day: row.day, idx: row.idx, value: row.value,
        correctedVal: row.correctedVal, type: row.type,
        color: row.color, severity: row.severity, msg: row.msg,
        remarks: row.remarks, status: row.status,
        raisedBy: row.raisedBy, encoderCorrected: row.encoderCorrected,
        rowAvg: row.rowAvg, marketLabel: row.marketLabel,
        commodity: row.commodity, spec: row.spec, ts: row.ts,
      };
    });
    if (window.updateCounters) updateCounters();
    if (document.getElementById('flagPanel')?.classList.contains('open')) renderFlagBody();
  });

  // ── Edit requests — new ones ──
  ref('edit_requests').on('child_added', snap => {
    const row = snap.val(); if (!row) return;
    const id  = snap.key;
    if (editRequests.find(r => r.id === id)) return; // already have it
    editRequests.unshift({ id, ...row });
    if (window.updateCounters) updateCounters();
    // Admin: flash notification
    if (window.curRole === 'admin' && row.status === 'pending') {
      const btn = document.getElementById('approvalBtn');
      if (btn) {
        btn.style.display    = 'inline-flex';
        btn.style.boxShadow  = '0 0 0 5px rgba(212,168,67,0.7)';
        setTimeout(() => { btn.style.boxShadow = ''; }, 4000);
      }
      showToast('📋 New edit request from ' + (row.marketLabel || row.mkt), 'info');
    }
    if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
  });

  // ── Edit requests — updates (approvals/rejections) ──
  ref('edit_requests').on('child_changed', snap => {
    const row = snap.val(); if (!row) return;
    const id  = snap.key;
    const idx = editRequests.findIndex(r => r.id === id);
    if (idx >= 0) Object.assign(editRequests[idx], { ...row, id });
    if (window.updateCounters) updateCounters();
    // Encoder: live approval / rejection notification
    if (window.curRole === 'encoder' && row.mkt === window.curUserMarket) {
      if (row.status === 'approved') {
        const key = row.mkt + '__' + row.wk + '__' + row.day;
        savedDays.delete(key);
        localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
        showToast('✅ Edit approved — you can now edit ' + (DAYS[row.day] || 'that day'), 'info');
        if (window.rebuildCurrentPane) rebuildCurrentPane();
      } else if (row.status === 'rejected') {
        showToast('❌ Edit request rejected' + (row.reason ? ': ' + row.reason : ''), 'err');
      }
    }
    if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
  });

  // ── Entries — reload when any market saves new data ──
  // Listen only to the current market's current week for efficiency
  function listenToCurrentWeek() {
    // Attach listener per market for admin; own market for encoder
    const mkts = (curRole === 'admin' || curRole === 'verifier')
      ? dataMkts().map(m => m.id)
      : [curUserMarket];

    mkts.forEach(mktId => {
      ref(`entries/${mktId}/${curWeek}`).on('value', async snap => {
        // Reload into db
        const data = snap.val() || {};
        if (!db[mktId]) db[mktId] = {};
        if (!db[mktId][curWeek]) db[mktId][curWeek] = {};
        Object.entries(data).forEach(([cid, cidData]) => {
          Object.entries(cidData).forEach(([day, dayData]) => {
            const d = parseInt(day);
            if (!db[mktId][curWeek][cid]) db[mktId][curWeek][cid] = {};
            if (!db[mktId][curWeek][cid][d])
              db[mktId][curWeek][cid][d] = { inputs: ['','','','','',''], notes: '' };
            Object.entries(dayData).forEach(([idx, val]) => {
              db[mktId][curWeek][cid][d].inputs[parseInt(idx)] =
                val != null ? parseFloat(val) : '';
            });
          });
        });
        // Rebuild summary/analytics panes automatically
        const summaryTabs = ['regional', 'provincial', 'analytics'];
        if (window.rebuildCurrentPane) {
          if (curMkt === mktId || summaryTabs.includes(curMkt)) {
            rebuildCurrentPane();
          }
        }
      });
    });
  }

  listenToCurrentWeek();
  // Re-attach when week changes (called from onWeekChange)
  window._sbListenToCurrentWeek = listenToCurrentWeek;

  console.log('[FB] Realtime listeners active ✅');
}

// ─────────────────────────────────────────────────────────────────
// BOOT — shows a loading overlay, loads all data, starts realtime
// ─────────────────────────────────────────────────────────────────
async function sbBootApp(user) {
  const marketId   = user.market_id;
  const isAdmin    = marketId === '__admin__';
  const isVerifier = marketId === '__verifier__';

  // Loading overlay (same look as Supabase version)
  const overlay = document.createElement('div');
  overlay.id = '_fbBoot';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;',
    'background:rgba(13,29,44,0.93);',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'color:#fff;font-family:"Barlow Condensed",sans-serif;gap:5px;',
  ].join('');
  overlay.innerHTML = `
    <div style="font-size:32px;font-weight:900;letter-spacing:3px;color:#2ba899;margin-bottom:4px">AMAD IX</div>
    <div style="font-size:11px;color:#88c8c0;letter-spacing:1px;margin-bottom:10px">DA-RFO IX · Firebase Edition</div>
    <div id="_bMsg"  style="font-size:13px;letter-spacing:0.5px">Connecting to Firebase…</div>
    <div id="_bDet"  style="font-size:10px;color:#6ab8b0;min-height:13px"></div>
    <div style="width:260px;height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;margin-top:12px">
      <div id="_bBar" style="width:0%;height:100%;background:linear-gradient(90deg,#1a5c6e,#2ba899);border-radius:3px;transition:width .3s"></div>
    </div>
    <div id="_bPct" style="font-size:10px;color:#5a9898;margin-top:3px">0%</div>`;
  document.body.appendChild(overlay);

  const set = (msg, det, pct) => {
    const bMsg = document.getElementById('_bMsg'); if (bMsg) bMsg.textContent = msg;
    const bDet = document.getElementById('_bDet'); if (bDet) bDet.textContent = det || '';
    const bBar = document.getElementById('_bBar'); if (bBar) bBar.style.width = pct + '%';
    const bPct = document.getElementById('_bPct'); if (bPct) bPct.textContent = pct + '%';
  };

  try {
    set('Loading saved days…', '', 15);
    await sbLoadSavedDays();

    set('Loading flags…', '', 28);
    await sbLoadFlags(isAdmin || isVerifier ? null : marketId);

    set('Loading edit requests…', '', 38);
    await sbLoadEditRequests();

    if (!isAdmin && !isVerifier) {
      set('Loading your market data…', marketId, 55);
      await sbLoadAllEntries(marketId);
      set('Data loaded!', '', 88);
    } else {
      const mkts = window.dataMkts ? dataMkts() : [];
      for (let i = 0; i < mkts.length; i++) {
        set('Loading market data…', mkts[i].label, 38 + Math.round((i / mkts.length) * 50));
        await sbLoadAllEntries(mkts[i].id);
      }
      set('All ' + mkts.length + ' markets loaded!', '', 90);
    }

    set('Starting real-time sync…', '', 97);
    sbSubscribeRealtime();
    _patchFunctions();

    set('Ready!', '', 100);
    setTimeout(() => {
      overlay.remove();
      if (window.rebuildCurrentPane) rebuildCurrentPane();
      if (window.updateCounters)     updateCounters();
      if (window.autoFlagAll)        autoFlagAll();
      if (window.attachSelectionsToCurrentPane) attachSelectionsToCurrentPane();
      console.log('[FB] Boot complete ✅');
    }, 300);

  } catch (err) {
    console.error('[FB] Boot error:', err);
    set('❌ ' + err.message, 'Check Firebase config. Reloading in 8s…', 0);
    setTimeout(() => { overlay.remove(); location.reload(); }, 8000);
  }
}

console.log('[FB] Firebase adapter v1 loaded.');
