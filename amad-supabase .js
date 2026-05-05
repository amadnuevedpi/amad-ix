// ══════════════════════════════════════════════════════════════════
// amad-supabase.js  —  AMAD IX · Supabase Data Adapter  v2
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://xmmqcssomlgmrhvolvox.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtbXFjc3NvbWxnbXJodm9sdm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTgxMDcsImV4cCI6MjA5MzQ5NDEwN30.q4Cg7phJdAtchNwum-OMFXXUmabUt5ZwdGHULZr2Mns';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Safe helper — get current week key even before app sets it
function _curWk() {
  if (window.curWeek && String(window.curWeek).length >= 8) return window.curWeek;
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().split('T')[0];
}

// ── AUTH ──────────────────────────────────────────────────────────
async function sbLogin(marketId, password) {
  const { data, error } = await _sb
    .from('users').select('*')
    .eq('market_id', marketId)
    .eq('password', password)
    .single();
  if (error || !data) return { ok: false, error: 'Invalid credentials' };
  return { ok: true, user: data };
}

// ── ENTRIES ───────────────────────────────────────────────────────
async function sbLoadEntries(marketId, weekKey) {
  if (!weekKey) weekKey = _curWk();
  const { data, error } = await _sb
    .from('entries').select('*')
    .eq('market_id', marketId)
    .eq('week_key', weekKey);
  if (error) { console.error('sbLoadEntries:', error); return; }
  if (!db[marketId]) db[marketId] = {};
  if (!db[marketId][weekKey]) db[marketId][weekKey] = {};
  (data || []).forEach(row => {
    const { commodity_id: cid, day_index: d, obs_index: i, value } = row;
    if (!db[marketId][weekKey][cid]) db[marketId][weekKey][cid] = {};
    if (!db[marketId][weekKey][cid][d]) db[marketId][weekKey][cid][d] = { inputs: ['','','','','',''] };
    db[marketId][weekKey][cid][d].inputs[i] = value !== null ? String(value) : '';
  });
  console.log('[AMAD IX] Loaded', (data||[]).length, 'entries for', marketId, weekKey);
}

async function sbSaveEntry(marketId, weekKey, dayIndex, commodityId, obsIndex, value) {
  const { error } = await _sb.from('entries').upsert({
    market_id:    marketId,
    week_key:     weekKey,
    day_index:    dayIndex,
    commodity_id: commodityId,
    obs_index:    obsIndex,
    value:        value === '' || value == null ? null : parseFloat(value),
    encoder_id:   window.curUserMarket || marketId,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index,commodity_id,obs_index' });
  if (error) console.error('sbSaveEntry:', error);
}

// ── SAVED DAYS ────────────────────────────────────────────────────
async function sbLoadSavedDays() {
  const { data, error } = await _sb.from('saved_days').select('market_id,week_key,day_index');
  if (error) { console.error('sbLoadSavedDays:', error); return; }
  (data || []).forEach(r => savedDays.add(`${r.market_id}__${r.week_key}__${r.day_index}`));
}

async function sbSaveDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').upsert({
    market_id: marketId, week_key: weekKey, day_index: dayIndex,
    saved_by: window.curUserMarket || marketId, saved_at: new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index' });
  if (error) console.error('sbSaveDay:', error);
}

async function sbUnlockDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').delete()
    .eq('market_id', marketId).eq('week_key', weekKey).eq('day_index', dayIndex);
  if (error) console.error('sbUnlockDay:', error);
}

// ── FLAGS ─────────────────────────────────────────────────────────
async function sbLoadFlags(marketId) {
  let q = _sb.from('flags').select('*').eq('status', 'open');
  if (marketId && marketId !== '__admin__' && marketId !== '__verifier__') {
    q = q.eq('market_id', marketId);
  }
  const { data, error } = await q;
  if (error) { console.error('sbLoadFlags:', error); return; }
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
  if (error) console.error('sbSaveFlag:', error);
}

// ── EDIT REQUESTS ─────────────────────────────────────────────────
async function sbLoadEditRequests() {
  const { data, error } = await _sb.from('edit_requests').select('*')
    .order('created_at', { ascending: false }).limit(100);
  if (error) { console.error('sbLoadEditRequests:', error); return; }
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
    obs_index: req.idx != null ? req.idx : null,
    old_val: req.oldVal != null ? req.oldVal : null,
    new_val: req.newVal != null ? req.newVal : null,
    flag_key: req.flagKey || null,
    resolved_at: req.resolvedAt || null, resolved_by: req.resolvedBy || null,
  }, { onConflict: 'id' });
  if (error) console.error('sbSaveEditRequest:', error);
}

// ── REALTIME ──────────────────────────────────────────────────────
function sbSubscribeRealtime() {
  _sb.channel('flags-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'flags' }, payload => {
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
      if (window.updateCounters) updateCounters();
      if (document.getElementById('flagPanel')?.classList.contains('open')) renderFlagBody();
    }).subscribe();

  _sb.channel('editreq-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'edit_requests' }, async () => {
      await sbLoadEditRequests();
      if (window.updateCounters) updateCounters();
      if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
    }).subscribe();

  _sb.channel('entries-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async payload => {
      const row = payload.new;
      if (!row) return;
      if (row.market_id === window.curMkt && row.week_key === window.curWeek) {
        await sbLoadEntries(row.market_id, row.week_key);
        if (window.rebuildCurrentPane) rebuildCurrentPane();
      }
    }).subscribe();
}

// ── BOOT ──────────────────────────────────────────────────────────
async function sbBootApp(user) {
  const marketId   = user.market_id;
  const isAdmin    = marketId === '__admin__';
  const isVerifier = marketId === '__verifier__';
  const wk         = _curWk();

  console.log('[AMAD IX] Booting for', marketId, '| week:', wk);

  await sbLoadSavedDays();
  await sbLoadFlags(isAdmin || isVerifier ? null : marketId);
  await sbLoadEditRequests();

  if (!isAdmin && !isVerifier) {
    // Load current week entries
    await sbLoadEntries(marketId, wk);
    // Also load previous week in case user is viewing it
    const prev = new Date(wk);
    prev.setDate(prev.getDate() - 7);
    const prevWk = prev.toISOString().split('T')[0];
    await sbLoadEntries(marketId, prevWk);
  } else {
    // Admin/verifier: load all markets for current week
    const mkts = window.dataMkts ? window.dataMkts() : [];
    for (const m of mkts) {
      await sbLoadEntries(m.id, wk);
    }
  }

  sbSubscribeRealtime();

  // Rebuild UI after data is loaded — wait for app to be ready
  setTimeout(() => {
    if (window.rebuildCurrentPane) rebuildCurrentPane();
    if (window.updateCounters) updateCounters();
    console.log('[AMAD IX] Boot complete — UI refreshed');
  }, 300);
}

console.log('[AMAD IX] Supabase adapter v2 loaded. URL:', SUPABASE_URL);
