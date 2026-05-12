// ══════════════════════════════════════════════════════════════════
// amad-supabase.js  —  AMAD IX · Supabase Data Adapter  v5
// FIXES:
//   1. Admin/verifier bypass cell-lock entirely (hInp patch)
//   2. requestEditForDate persists to Supabase immediately
//   3. approveDateRequest / rejectDateRequest persist status to Supabase
//   4. Realtime: admin gets live toast + button flash on new edit request
//   5. Realtime: encoder gets live toast when request approved/rejected
//   6. Realtime entries: rebuilds correct pane even when admin is on
//      regional/analytics/provincial tab
//   7. sbSaveDayBatch uses delete+insert fallback to guarantee updates
//   8. saveAll() does NOT lock day when admin/verifier saves
//   9. autoFlagCell / resolveFlag persist flags to Supabase
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://xmmqcssomlgmrhvolvox.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtbXFjc3NvbWxnbXJodm9sdm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTgxMDcsImV4cCI6MjA5MzQ5NDEwN30.q4Cg7phJdAtchNwum-OMFXXUmabUt5ZwdGHULZr2Mns';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
async function sbLogin(marketId, password) {
  const { data, error } = await _sb
    .from('users').select('*')
    .eq('market_id', marketId)
    .eq('password', password)
    .single();
  if (error || !data) return { ok: false };
  return { ok: true, user: data };
}

// ─────────────────────────────────────────────────────────────────
// SEED reference tables (idempotent — safe to run every boot)
// ─────────────────────────────────────────────────────────────────
async function sbSeedCommodities() {
  const rows = [];
  let section = '', order = 0;
  (window.DEFAULT_COMS || []).forEach(row => {
    if (row.sec) { section = row.sec; return; }
    if (!row.id) return;
    rows.push({ id: row.id, section, name: row.c, spec: row.s || '', unit: row.u || 'kg', sort_order: order++ });
  });
  if (!rows.length) return;
  const { error } = await _sb.from('commodities').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
  if (error) console.warn('[SB] sbSeedCommodities:', error.message);
  else console.log('[SB] Commodities synced:', rows.length);
}

async function sbSeedMarkets() {
  const mkts = window.dataMkts ? window.dataMkts() : [];
  if (!mkts.length) return;
  const rows = mkts.map((m, i) => ({
    id: m.id, label: m.label, sheet: m.sheet || m.label,
    city: m.city || '', province: m.province || '', sort_order: i,
  }));
  const { error } = await _sb.from('markets').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
  if (error) console.warn('[SB] sbSeedMarkets:', error.message);
  else console.log('[SB] Markets synced:', rows.length);
}

// ─────────────────────────────────────────────────────────────────
// LOAD ENTRIES
// ─────────────────────────────────────────────────────────────────
async function sbLoadAllEntries(marketId) {
  let allData = [], from = 0;
  while (true) {
    const { data, error } = await _sb
      .from('entries')
      .select('week_key,commodity_id,day_index,obs_index,value')
      .eq('market_id', marketId)
      .range(from, from + 999)
      .order('week_key', { ascending: true });
    if (error) { console.error('[SB] loadAll:', error.message); break; }
    if (!data?.length) break;
    allData = allData.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  if (!db[marketId]) db[marketId] = {};
  allData.forEach(({ week_key: wk, commodity_id: cid, day_index: d, obs_index: i, value }) => {
    if (!db[marketId][wk]) db[marketId][wk] = {};
    if (!db[marketId][wk][cid]) db[marketId][wk][cid] = {};
    if (!db[marketId][wk][cid][d]) db[marketId][wk][cid][d] = { inputs: ['','','','','',''], notes: '' };
    db[marketId][wk][cid][d].inputs[i] = (value != null) ? parseFloat(value) : '';
  });
  console.log('[SB]', allData.length, 'entries for', marketId);
}

async function sbLoadEntries(marketId, weekKey) {
  if (!weekKey) return;
  const { data, error } = await _sb
    .from('entries').select('commodity_id,day_index,obs_index,value')
    .eq('market_id', marketId).eq('week_key', weekKey);
  if (error) { console.error('[SB] loadEntries:', error.message); return; }
  if (!db[marketId]) db[marketId] = {};
  if (!db[marketId][weekKey]) db[marketId][weekKey] = {};
  (data || []).forEach(({ commodity_id: cid, day_index: d, obs_index: i, value }) => {
    if (!db[marketId][weekKey][cid]) db[marketId][weekKey][cid] = {};
    if (!db[marketId][weekKey][cid][d]) db[marketId][weekKey][cid][d] = { inputs: ['','','','','',''], notes: '' };
    db[marketId][weekKey][cid][d].inputs[i] = (value != null) ? parseFloat(value) : '';
  });
}

// ─────────────────────────────────────────────────────────────────
// BATCH SAVE  —  delete-then-insert guarantees stale rows are gone
// ─────────────────────────────────────────────────────────────────
async function sbSaveDayBatch(marketId, weekKey, dayIndex) {
  const coms = window.dataComs ? window.dataComs() : [];
  const rows = [];
  coms.forEach(com => {
    const inputs = window.getInp ? getInp(marketId, weekKey, com.id, dayIndex) : [];
    inputs.forEach((val, obsIdx) => {
      const v = (val === '' || val == null) ? null : parseFloat(val);
      if (v !== null) { // only save non-null; nulls are handled by delete below
        rows.push({
          market_id: marketId, week_key: weekKey, day_index: dayIndex,
          commodity_id: com.id, obs_index: obsIdx, value: v,
          encoder_id: window.curUserMarket || marketId,
          updated_at: new Date().toISOString(),
        });
      }
    });
  });

  // Step 1: delete all existing rows for this day
  const { error: delErr } = await _sb
    .from('entries').delete()
    .eq('market_id', marketId)
    .eq('week_key', weekKey)
    .eq('day_index', dayIndex);
  if (delErr) {
    console.error('[SB] delete before save:', delErr.message);
    throw new Error('Save failed (clear step): ' + delErr.message);
  }

  // Step 2: insert fresh rows (only non-null values)
  if (rows.length) {
    const chunkSize = 400;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error: insErr } = await _sb.from('entries').insert(rows.slice(i, i + chunkSize));
      if (insErr) {
        console.error('[SB] insert:', insErr.message, insErr.details);
        throw new Error('Save failed (insert step): ' + insErr.message);
      }
    }
  }

  console.log('[SB] Saved', rows.length, 'rows →', marketId, weekKey, 'day', dayIndex);
  return rows.length;
}

// Single-entry save (kept for compatibility)
async function sbSaveEntry(marketId, weekKey, dayIndex, commodityId, obsIndex, value) {
  const { error } = await _sb.from('entries').upsert({
    market_id: marketId, week_key: weekKey, day_index: dayIndex,
    commodity_id: commodityId, obs_index: obsIndex,
    value: (value === '' || value == null) ? null : parseFloat(value),
    encoder_id: window.curUserMarket || marketId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index,commodity_id,obs_index' });
  if (error) { console.error('[SB] saveEntry:', error.message); throw new Error(error.message); }
}

// ─────────────────────────────────────────────────────────────────
// SAVED DAYS
// ─────────────────────────────────────────────────────────────────
async function sbLoadSavedDays() {
  const { data, error } = await _sb.from('saved_days').select('market_id,week_key,day_index');
  if (error) { console.error('[SB] loadSavedDays:', error.message); return; }
  (data || []).forEach(r => savedDays.add(`${r.market_id}__${r.week_key}__${r.day_index}`));
}

async function sbSaveDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').upsert({
    market_id: marketId, week_key: weekKey, day_index: dayIndex,
    saved_by: window.curUserMarket || marketId,
    saved_at: new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index' });
  if (error) throw new Error('Lock day failed: ' + error.message);
}

async function sbUnlockDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').delete()
    .eq('market_id', marketId).eq('week_key', weekKey).eq('day_index', dayIndex);
  if (error) console.error('[SB] unlockDay:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// FLAGS
// ─────────────────────────────────────────────────────────────────
async function sbLoadFlags(marketId) {
  let q = _sb.from('flags').select('*').eq('status', 'open');
  if (marketId && marketId !== '__admin__' && marketId !== '__verifier__') q = q.eq('market_id', marketId);
  const { data, error } = await q;
  if (error) { console.error('[SB] loadFlags:', error.message); return; }
  (data || []).forEach(row => {
    flags[row.flag_key] = {
      key: row.flag_key, mkt: row.market_id, wk: row.week_key,
      cid: row.commodity_id, day: row.day_index, idx: row.obs_index,
      value: row.value, correctedVal: row.corrected_val,
      type: row.flag_type, color: row.color, severity: row.severity,
      msg: row.message, remarks: row.remarks, status: row.status,
      raisedBy: row.raised_by, encoderCorrected: row.encoder_corrected,
      correctedAt: row.corrected_at, rowAvg: row.row_avg,
      marketLabel: row.market_label, commodity: row.commodity_name,
      spec: row.commodity_spec, ts: row.created_at,
    };
  });
}

async function sbSaveFlag(f) {
  const { error } = await _sb.from('flags').upsert({
    flag_key: f.key, market_id: f.mkt, week_key: f.wk,
    day_index: f.day, commodity_id: f.cid, obs_index: f.idx,
    value: f.value, corrected_val: f.correctedVal || null,
    flag_type: f.type, color: f.color, severity: f.severity,
    message: f.msg, remarks: f.remarks || null, status: f.status,
    raised_by: f.raisedBy, encoder_corrected: !!f.encoderCorrected,
    corrected_at: f.correctedAt || null,
    row_avg: f.rowAvg ? parseFloat(f.rowAvg) : null,
    market_label: f.marketLabel, commodity_name: f.commodity,
    commodity_spec: f.spec, updated_at: new Date().toISOString(),
  }, { onConflict: 'flag_key' });
  if (error) console.error('[SB] saveFlag:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// EDIT REQUESTS
// ─────────────────────────────────────────────────────────────────
async function sbLoadEditRequests() {
  const { data, error } = await _sb.from('edit_requests').select('*')
    .order('created_at', { ascending: false }).limit(200);
  if (error) { console.error('[SB] loadEditRequests:', error.message); return; }
  editRequests.length = 0;
  (data || []).forEach(row => {
    editRequests.push({
      id: row.id, mkt: row.market_id, wk: row.week_key,
      day: row.day_index, date: row.date_label,
      marketLabel: row.market_label, encoder: row.encoder_id,
      status: row.status, reason: row.reason,
      cid: row.commodity_id, commodity: row.commodity_name,
      idx: row.obs_index, oldVal: row.old_val, newVal: row.new_val,
      flagKey: row.flag_key, resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by, ts: row.created_at,
    });
  });
}

async function sbSaveEditRequest(req) {
  const { error } = await _sb.from('edit_requests').upsert({
    id: req.id, market_id: req.mkt, week_key: req.wk,
    day_index: req.day, date_label: req.date,
    market_label: req.marketLabel, encoder_id: req.encoder,
    status: req.status, reason: req.reason || null,
    commodity_id: req.cid || null, commodity_name: req.commodity || null,
    obs_index: (req.idx != null) ? req.idx : null,
    old_val: (req.oldVal != null) ? req.oldVal : null,
    new_val: (req.newVal != null) ? req.newVal : null,
    flag_key: req.flagKey || null,
    resolved_at: req.resolvedAt || null,
    resolved_by: req.resolvedBy || null,
  }, { onConflict: 'id' });
  if (error) console.error('[SB] saveEditRequest:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// FUNCTION PATCHES  (applied after boot, override HTML versions)
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

  // ── PATCH 2: requestEditForDate — persist to Supabase ──
  window.requestEditForDate = async function(mktId, wkKey, dayIdx) {
    if (curRole !== 'encoder') { showToast('❌ Only encoders can request edits', 'err'); return; }
    const existing = editRequests.find(r =>
      r.mkt === mktId && r.wk === wkKey && r.day === dayIdx && r.status === 'pending');
    if (existing) { showToast('⏳ A request for this date is already pending', 'info'); return; }

    const mk = dataMkts().find(m => m.id === mktId);
    const dd = dayDate(dayIdx);
    const dateLbl = dd
      ? dd.toLocaleDateString('en-PH', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';
    const req = {
      id: 'req_' + genId(), mkt: mktId, wk: wkKey, day: dayIdx,
      date: dateLbl, encoder: mktId, marketLabel: mk?.label || mktId,
      status: 'pending', reason: '', ts: new Date().toLocaleString('en-PH'),
    };
    editRequests.push(req);

    // ★ Persist immediately — admin will see it in real-time
    await sbSaveEditRequest(req);

    showToast('📋 Edit request sent for ' + DAYS[dayIdx] + ' (' + dateLbl + ')', 'info');
    updateCounters();
    renderApprovalBody();
  };

  // ── PATCH 3: approveDateRequest — persist + unlock in Supabase ──
  window.approveDateRequest = async function(reqId) {
    const req = editRequests.find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return;
    req.status = 'approved';
    req.resolvedAt = new Date().toLocaleString('en-PH');
    req.resolvedBy = curRole;

    const dayKey = req.mkt + '__' + req.wk + '__' + req.day;
    savedDays.delete(dayKey);
    localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));

    // Unlock in Supabase so encoder can edit without a saved_days record blocking
    await sbUnlockDay(req.mkt, req.wk, req.day);
    // Persist approval
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
    req.status = 'rejected';
    req.reason = document.getElementById('reason-' + reqId)?.value || '';
    req.resolvedAt = new Date().toLocaleString('en-PH');
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
      sbSaveFlag(f).catch(e => console.warn('[SB] autoFlag persist:', e.message));
    }
  };

  // ── PATCH 6: resolveFlag — persist status changes ──
  const _origResolve = window.resolveFlag;
  window.resolveFlag = function(key, action) {
    _origResolve.call(this, key, action);
    const f = flags[key];
    if (f) sbSaveFlag(f).catch(e => console.warn('[SB] resolveFlag persist:', e.message));
  };

  console.log('[SB] Patches applied ✅');
}

// ─────────────────────────────────────────────────────────────────
// saveAll — complete replacement, handles admin edits correctly
// ─────────────────────────────────────────────────────────────────
window.saveAll = async function saveAll() {
  const saveBtn = document.querySelector('.btn-gn');
  if (saveBtn) { saveBtn.textContent = '⏳ Saving...'; saveBtn.disabled = true; }

  try {
    // Determine which market to save
    const summaryTabs = ['regional', 'provincial', 'analytics', 'manage'];
    const targetMkt = summaryTabs.includes(curMkt) ? null : curMkt;

    if (!targetMkt) {
      showToast('ℹ️ Switch to a market tab to save data', 'info');
      return;
    }

    // Batch save (delete+insert — guaranteed to reflect current in-memory state)
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
    // Admin/verifier: data saved but day stays unlocked

    // Persist UI state
    try {
      localStorage.setItem('amad9v5_state', JSON.stringify({
        curMkt, curYear, curWeek, curDay, curPeriod, analyticsScope
      }));
      localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
    } catch(e) {}

    // Update timestamp
    const el = document.getElementById('sbSave');
    if (el) el.textContent = new Date().toLocaleTimeString('en-PH');

    const dd = dayDate(curDay);
    const dateLbl = dd
      ? dd.toLocaleDateString('en-PH', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'today';
    const note = (curRole === 'admin' || curRole === 'verifier')
      ? ' · day remains unlocked for encoders' : '';

    showToast('✅ ' + DAYS[curDay] + ' (' + dateLbl + ') — ' + savedCount + ' observations saved' + note);
    rebuildCurrentPane();

  } catch (err) {
    console.error('[SB] saveAll:', err);
    showToast('❌ Save failed: ' + err.message, 'err');
  } finally {
    if (saveBtn) { saveBtn.textContent = '💾 Save'; saveBtn.disabled = false; }
  }
};

// ─────────────────────────────────────────────────────────────────
// REAL-TIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────
let _realtimeActive = false;
function sbSubscribeRealtime() {
  if (_realtimeActive) return;
  _realtimeActive = true;

  // ── Flags ──
  _sb.channel('amad-flags-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flags' }, payload => {
      const row = payload.new || payload.old; if (!row) return;
      if (payload.eventType === 'DELETE') { delete flags[row.flag_key]; }
      else {
        flags[row.flag_key] = {
          key: row.flag_key, mkt: row.market_id, wk: row.week_key,
          cid: row.commodity_id, day: row.day_index, idx: row.obs_index,
          value: row.value, correctedVal: row.corrected_val,
          type: row.flag_type, color: row.color, severity: row.severity,
          msg: row.message, remarks: row.remarks, status: row.status,
          raisedBy: row.raised_by, encoderCorrected: row.encoder_corrected,
          rowAvg: row.row_avg, marketLabel: row.market_label,
          commodity: row.commodity_name, spec: row.commodity_spec, ts: row.created_at,
        };
      }
      if (window.updateCounters) updateCounters();
      if (document.getElementById('flagPanel')?.classList.contains('open')) renderFlagBody();
    }).subscribe();

  // ── Edit requests ──
  _sb.channel('amad-editreq-' + Date.now())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'edit_requests' }, payload => {
      const row = payload.new; if (!row) return;
      if (!editRequests.find(r => r.id === row.id)) {
        editRequests.unshift({
          id: row.id, mkt: row.market_id, wk: row.week_key,
          day: row.day_index, date: row.date_label,
          marketLabel: row.market_label, encoder: row.encoder_id,
          status: row.status, ts: row.created_at,
        });
      }
      if (window.updateCounters) updateCounters();
      // Admin: show flash notification
      if (window.curRole === 'admin') {
        const btn = document.getElementById('approvalBtn');
        if (btn) {
          btn.style.display = 'inline-flex';
          btn.style.boxShadow = '0 0 0 5px rgba(212,168,67,0.7)';
          setTimeout(() => { btn.style.boxShadow = ''; }, 4000);
        }
        showToast('📋 New edit request from ' + (row.market_label || row.market_id), 'info');
      }
      if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'edit_requests' }, payload => {
      const row = payload.new; if (!row) return;
      const idx = editRequests.findIndex(r => r.id === row.id);
      if (idx >= 0) Object.assign(editRequests[idx], {
        status: row.status, reason: row.reason,
        resolvedAt: row.resolved_at, resolvedBy: row.resolved_by,
      });
      if (window.updateCounters) updateCounters();
      // Encoder: live notification when their request is resolved
      if (window.curRole === 'encoder' && row.market_id === window.curUserMarket) {
        if (row.status === 'approved') {
          const key = row.market_id + '__' + row.week_key + '__' + row.day_index;
          savedDays.delete(key);
          localStorage.setItem('amad9v5_savedDays', JSON.stringify([...savedDays]));
          showToast('✅ Edit approved — you can now edit ' + (DAYS[row.day_index] || 'that day'), 'info');
          if (window.rebuildCurrentPane) rebuildCurrentPane();
        } else if (row.status === 'rejected') {
          showToast('❌ Edit request rejected' + (row.reason ? ': ' + row.reason : ''), 'err');
        }
      }
      if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
    })
    .subscribe();

  // ── Entries — reload data when any client saves ──
  _sb.channel('amad-entries-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async payload => {
      const row = payload.new || payload.old; if (!row) return;
      const changedMkt  = row.market_id;
      const changedWeek = row.week_key;
      await sbLoadEntries(changedMkt, changedWeek);
      // Rebuild pane if it displays this market's data
      if (window.rebuildCurrentPane) {
        const summaryTabs = ['regional', 'provincial', 'analytics'];
        if (curMkt === changedMkt || summaryTabs.includes(curMkt)) {
          rebuildCurrentPane();
        }
      }
    }).subscribe();

  console.log('[SB] Realtime active ✅');
}

// ─────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────
async function sbBootApp(user) {
  const marketId   = user.market_id;
  const isAdmin    = marketId === '__admin__';
  const isVerifier = marketId === '__verifier__';

  // Loading overlay
  const overlay = document.createElement('div');
  overlay.id = '_sbBoot';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;',
    'background:rgba(13,29,44,0.93);',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'color:#fff;font-family:"Barlow Condensed",sans-serif;gap:5px;',
  ].join('');
  overlay.innerHTML = `
    <div style="font-size:32px;font-weight:900;letter-spacing:3px;color:#2ba899;margin-bottom:4px">AMAD IX</div>
    <div style="font-size:11px;color:#88c8c0;letter-spacing:1px;margin-bottom:10px">DA-RFO IX · Market Price Monitoring System</div>
    <div id="_bMsg"  style="font-size:13px;letter-spacing:0.5px">Connecting…</div>
    <div id="_bDet"  style="font-size:10px;color:#6ab8b0;min-height:13px"></div>
    <div style="width:260px;height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;margin-top:12px">
      <div id="_bBar" style="width:0%;height:100%;background:linear-gradient(90deg,#1a5c6e,#2ba899);border-radius:3px;transition:width .3s"></div>
    </div>
    <div id="_bPct" style="font-size:10px;color:#5a9898;margin-top:3px">0%</div>`;
  document.body.appendChild(overlay);

  const set = (msg, det, pct) => {
    ['_bMsg','_bDet','_bBar','_bPct'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      if (id === '_bMsg') el.textContent = msg;
      if (id === '_bDet') el.textContent = det || '';
      if (id === '_bBar') el.style.width  = pct + '%';
      if (id === '_bPct') el.textContent  = pct + '%';
    });
  };

  try {
    set('Syncing markets & commodities…', 'First-time setup', 8);
    await sbSeedMarkets();
    await sbSeedCommodities();

    set('Loading saved days…', '', 18);
    await sbLoadSavedDays();

    set('Loading flags…', '', 28);
    await sbLoadFlags(isAdmin || isVerifier ? null : marketId);

    set('Loading edit requests…', '', 36);
    await sbLoadEditRequests();

    if (!isAdmin && !isVerifier) {
      set('Loading your market data…', marketId, 50);
      await sbLoadAllEntries(marketId);
      set('Data loaded!', '', 90);
    } else {
      const mkts = window.dataMkts ? window.dataMkts() : [];
      for (let i = 0; i < mkts.length; i++) {
        set('Loading market data…', mkts[i].label, 40 + Math.round((i / mkts.length) * 52));
        await sbLoadAllEntries(mkts[i].id);
      }
      set('All ' + mkts.length + ' markets loaded!', '', 93);
    }

    set('Starting real-time sync…', '', 97);
    sbSubscribeRealtime();
    _patchFunctions();

    set('Ready!', '', 100);
    setTimeout(() => {
      overlay.remove();
      if (window.rebuildCurrentPane) rebuildCurrentPane();
      if (window.updateCounters) updateCounters();
      if (window.autoFlagAll) autoFlagAll();
      if (window.attachSelectionsToCurrentPane) attachSelectionsToCurrentPane();
      console.log('[SB] Boot complete ✅');
    }, 300);

  } catch (err) {
    console.error('[SB] Boot error:', err);
    set('❌ ' + err.message, 'Reloading in 6s…', 0);
    setTimeout(() => { overlay.remove(); location.reload(); }, 6000);
  }
}

console.log('[SB] Supabase adapter v5 loaded.');
