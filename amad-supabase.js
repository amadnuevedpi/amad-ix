// ══════════════════════════════════════════════════════════════════
// amad-supabase.js  —  AMAD IX · Supabase Data Adapter
// Drop this <script> tag BEFORE your main app script in index.html:
//   <script src="amad-supabase.js"></script>
//
// Then replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY below.
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://xmmqcssomlgmrhvolvox.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtbXFjc3NvbWxnbXJodm9sdm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTgxMDcsImV4cCI6MjA5MzQ5NDEwN30.q4Cg7phJdAtchNwum-OMFXXUmabUt5ZwdGHULZr2Mns';

// Initialise client (supabase-js loaded via CDN before this file)
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─────────────────────────────────────────────────────────────────
// AUTH  —  replaces the local password-check login
// ─────────────────────────────────────────────────────────────────

/**
 * Login: look up market_id + password in the users table.
 * Returns { ok, user } or { ok:false, error }
 */
async function sbLogin(marketId, password) {
  const { data, error } = await _sb
    .from('users')
    .select('*')
    .eq('market_id', marketId)
    .eq('password', password)   // swap for bcrypt check in production
    .single();
  if (error || !data) return { ok: false, error: 'Invalid credentials' };
  return { ok: true, user: data };
}

// ─────────────────────────────────────────────────────────────────
// ENTRIES  —  load & save price data
// ─────────────────────────────────────────────────────────────────

/**
 * Load all entries for a market + week into the local `db` object.
 * Call this after login and whenever the week selector changes.
 */
async function sbLoadEntries(marketId, weekKey) {
  const { data, error } = await _sb
    .from('entries')
    .select('*')
    .eq('market_id', marketId)
    .eq('week_key', weekKey);

  if (error) { console.error('sbLoadEntries:', error); return; }

  // Merge into the local db structure the app already uses
  if (!db[marketId]) db[marketId] = {};
  if (!db[marketId][weekKey]) db[marketId][weekKey] = {};

  (data || []).forEach(row => {
    const { commodity_id: cid, day_index: d, obs_index: i, value } = row;
    if (!db[marketId][weekKey][cid]) db[marketId][weekKey][cid] = {};
    if (!db[marketId][weekKey][cid][d]) db[marketId][weekKey][cid][d] = { inputs: ['','','','','',''] };
    db[marketId][weekKey][cid][d].inputs[i] = value !== null ? String(value) : '';
  });
  // Refresh UI if this is the currently viewed market/week
  if(window.curMkt===marketId&&window.curWeek===weekKey){
    if(window.rebuildCurrentPane) window.rebuildCurrentPane();
  }
}

/**
 * Upsert a single cell value to Supabase.
 * Wraps setInp — call this after the local setInp call.
 */
async function sbSaveEntry(marketId, weekKey, dayIndex, commodityId, obsIndex, value) {
  const payload = {
    market_id:    marketId,
    week_key:     weekKey,
    day_index:    dayIndex,
    commodity_id: commodityId,
    obs_index:    obsIndex,
    value:        value === '' || value == null ? null : parseFloat(value),
    encoder_id:   window.curUserMarket || marketId,
    updated_at:   new Date().toISOString(),
  };
  const { error } = await _sb.from('entries').upsert(payload, {
    onConflict: 'market_id,week_key,day_index,commodity_id,obs_index',
  });
  if (error) console.error('sbSaveEntry:', error);
}

// ─────────────────────────────────────────────────────────────────
// SAVED DAYS  —  daily lock system
// ─────────────────────────────────────────────────────────────────

/** Load all saved_days into the local savedDays Set */
async function sbLoadSavedDays() {
  const { data, error } = await _sb.from('saved_days').select('market_id,week_key,day_index');
  if (error) { console.error('sbLoadSavedDays:', error); return; }
  (data || []).forEach(r => {
    savedDays.add(`${r.market_id}__${r.week_key}__${r.day_index}`);
  });
}

/** Mark a day as saved/locked in Supabase */
async function sbSaveDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').upsert({
    market_id: marketId,
    week_key:  weekKey,
    day_index: dayIndex,
    saved_by:  window.curUserMarket || marketId,
    saved_at:  new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index' });
  if (error) console.error('sbSaveDay:', error);
}

/** Unlock a day (delete row) */
async function sbUnlockDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days')
    .delete()
    .eq('market_id', marketId)
    .eq('week_key', weekKey)
    .eq('day_index', dayIndex);
  if (error) console.error('sbUnlockDay:', error);
}

// ─────────────────────────────────────────────────────────────────
// FLAGS
// ─────────────────────────────────────────────────────────────────

/** Load all flags (optionally scoped to one market) into local `flags` */
async function sbLoadFlags(marketId) {
  let q = _sb.from('flags').select('*').eq('status', 'open');
  if (marketId && marketId !== '__admin__' && marketId !== '__verifier__') {
    q = q.eq('market_id', marketId);
  }
  const { data, error } = await q;
  if (error) { console.error('sbLoadFlags:', error); return; }
  (data || []).forEach(row => {
    flags[row.flag_key] = {
      key:              row.flag_key,
      mkt:              row.market_id,
      wk:               row.week_key,
      cid:              row.commodity_id,
      day:              row.day_index,
      idx:              row.obs_index,
      value:            row.value,
      correctedVal:     row.corrected_val,
      type:             row.flag_type,
      color:            row.color,
      severity:         row.severity,
      msg:              row.message,
      remarks:          row.remarks,
      status:           row.status,
      raisedBy:         row.raised_by,
      encoderCorrected: row.encoder_corrected,
      correctedAt:      row.corrected_at,
      rowAvg:           row.row_avg,
      marketLabel:      row.market_label,
      commodity:        row.commodity_name,
      spec:             row.commodity_spec,
      ts:               row.created_at,
    };
  });
}

/** Upsert a flag to Supabase */
async function sbSaveFlag(f) {
  const { error } = await _sb.from('flags').upsert({
    flag_key:          f.key,
    market_id:         f.mkt,
    week_key:          f.wk,
    day_index:         f.day,
    commodity_id:      f.cid,
    obs_index:         f.idx,
    value:             f.value,
    corrected_val:     f.correctedVal || null,
    flag_type:         f.type,
    color:             f.color,
    severity:          f.severity,
    message:           f.msg,
    remarks:           f.remarks || null,
    status:            f.status,
    raised_by:         f.raisedBy,
    encoder_corrected: !!f.encoderCorrected,
    corrected_at:      f.correctedAt || null,
    row_avg:           f.rowAvg ? parseFloat(f.rowAvg) : null,
    market_label:      f.marketLabel,
    commodity_name:    f.commodity,
    commodity_spec:    f.spec,
    updated_at:        new Date().toISOString(),
  }, { onConflict: 'flag_key' });
  if (error) console.error('sbSaveFlag:', error);
}

// ─────────────────────────────────────────────────────────────────
// EDIT REQUESTS
// ─────────────────────────────────────────────────────────────────

/** Load all pending edit requests into local editRequests array */
async function sbLoadEditRequests() {
  const { data, error } = await _sb
    .from('edit_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) { console.error('sbLoadEditRequests:', error); return; }
  editRequests.length = 0;
  (data || []).forEach(row => {
    editRequests.push({
      id:           row.id,
      mkt:          row.market_id,
      wk:           row.week_key,
      day:          row.day_index,
      date:         row.date_label,
      marketLabel:  row.market_label,
      encoder:      row.encoder_id,
      status:       row.status,
      reason:       row.reason,
      cid:          row.commodity_id,
      commodity:    row.commodity_name,
      idx:          row.obs_index,
      oldVal:       row.old_val,
      newVal:       row.new_val,
      flagKey:      row.flag_key,
      resolvedAt:   row.resolved_at,
      resolvedBy:   row.resolved_by,
      ts:           row.created_at,
    });
  });
}

/** Save a new edit request to Supabase */
async function sbSaveEditRequest(req) {
  const { error } = await _sb.from('edit_requests').upsert({
    id:            req.id,
    market_id:     req.mkt,
    week_key:      req.wk,
    day_index:     req.day,
    date_label:    req.date,
    market_label:  req.marketLabel,
    encoder_id:    req.encoder,
    status:        req.status,
    reason:        req.reason || null,
    commodity_id:  req.cid || null,
    commodity_name:req.commodity || null,
    obs_index:     req.idx != null ? req.idx : null,
    old_val:       req.oldVal != null ? req.oldVal : null,
    new_val:       req.newVal != null ? req.newVal : null,
    flag_key:      req.flagKey || null,
    resolved_at:   req.resolvedAt || null,
    resolved_by:   req.resolvedBy || null,
  }, { onConflict: 'id' });
  if (error) console.error('sbSaveEditRequest:', error);
}

// ─────────────────────────────────────────────────────────────────
// REAL-TIME SUBSCRIPTIONS  (live updates between users)
// ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time changes for flags and edit_requests.
 * Call once after login. Other users' changes appear instantly.
 */
function sbSubscribeRealtime() {
  // Flags channel
  _sb.channel('flags-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flags' },
      payload => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          delete flags[row.flag_key];
        } else {
          flags[row.flag_key] = {
            key: row.flag_key, mkt: row.market_id, wk: row.week_key,
            cid: row.commodity_id, day: row.day_index, idx: row.obs_index,
            value: row.value, correctedVal: row.corrected_val,
            type: row.flag_type, color: row.color, severity: row.severity,
            msg: row.message, remarks: row.remarks, status: row.status,
            raisedBy: row.raised_by, encoderCorrected: row.encoder_corrected,
            rowAvg: row.row_avg, marketLabel: row.market_label,
            commodity: row.commodity_name, spec: row.commodity_spec,
            ts: row.created_at,
          };
        }
        updateCounters();
        if (document.getElementById('flagPanel')?.classList.contains('open')) renderFlagBody();
      })
    .subscribe();

  // Edit requests channel
  _sb.channel('editreq-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'edit_requests' },
      async () => {
        await sbLoadEditRequests();
        updateCounters();
        if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
      })
    .subscribe();

  // Entries channel — refresh table when another encoder saves
  _sb.channel('entries-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' },
      async payload => {
        const row = payload.new;
        if (!row) return;
        // Only refresh if it affects the current view
        if (row.market_id === window.curMkt && row.week_key === window.curWeek) {
          await sbLoadEntries(row.market_id, row.week_key);
          rebuildCurrentPane();
        }
      })
    .subscribe();
}

// ─────────────────────────────────────────────────────────────────
// BOOT INTEGRATION HELPER
// ─────────────────────────────────────────────────────────────────

/**
 * Call this right after a successful login to hydrate the app from Supabase.
 * Usage (replace the localStorage block in your doLogin function):
 *
 *   const { ok, user } = await sbLogin(marketId, password);
 *   if (!ok) { showError(); return; }
 *   await sbBootApp(user);
 */
async function sbBootApp(user){
  const marketId=user.market_id;
  const isAdmin=marketId==='__admin__';
  const isVerifier=marketId==='__verifier__';

  // Load saved days
  await sbLoadSavedDays();

  // Load flags
  await sbLoadFlags(isAdmin||isVerifier?null:marketId);

  // Load edit requests
  await sbLoadEditRequests();

  // Load entries for ALL weeks visible to this user
  if(!isAdmin&&!isVerifier){
    // Load current week AND previous week so data appears on reload
    await sbLoadEntries(marketId,window.curWeek);
    // Also load a few surrounding weeks
    const allWeeks=[...new Set(
      Object.keys((window.db&&window.db[marketId])||{}).concat([window.curWeek])
    )];
    for(const wk of allWeeks){
      if(wk!==window.curWeek) await sbLoadEntries(marketId,wk);
    }
  } else {
    // Admin/verifier — load all markets for current week
    const mkts=window.dataMkts?window.dataMkts():[];
    for(const m of mkts){
      await sbLoadEntries(m.id,window.curWeek);
    }
  }

  // Subscribe to real-time updates
  sbSubscribeRealtime();

  // Rebuild UI with loaded data
  if(window.rebuildCurrentPane) window.rebuildCurrentPane();
  if(window.updateCounters) window.updateCounters();
}

console.log('[AMAD IX] Supabase adapter loaded. URL:', SUPABASE_URL);
