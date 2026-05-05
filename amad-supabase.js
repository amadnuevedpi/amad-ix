// ══════════════════════════════════════════════════════════════════
// amad-supabase.js  —  AMAD IX · Supabase Data Adapter  v3
// Fixes: loads ALL weeks so analytics, weekly, monthly summaries work
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
  if (error || !data) return { ok: false, error: 'Invalid credentials' };
  return { ok: true, user: data };
}

// ─────────────────────────────────────────────────────────────────
// ENTRIES — load ALL entries for a market (all weeks, all days)
// This is the KEY fix: analytics needs data across all weeks
// ─────────────────────────────────────────────────────────────────
async function sbLoadAllEntries(marketId) {
  console.log('[AMAD IX] Loading ALL entries for', marketId, '...');

  // Load in batches of 1000 (Supabase default limit)
  let allData = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await _sb
      .from('entries')
      .select('*')
      .eq('market_id', marketId)
      .range(from, from + batchSize - 1)
      .order('week_key', { ascending: true });

    if (error) { console.error('sbLoadAllEntries:', error); break; }
    if (!data || data.length === 0) break;

    allData = allData.concat(data);
    if (data.length < batchSize) break; // last batch
    from += batchSize;
  }

  // Merge ALL rows into the local db object
  if (!db[marketId]) db[marketId] = {};

  allData.forEach(row => {
    const { week_key: wk, commodity_id: cid, day_index: d, obs_index: i, value } = row;
    if (!db[marketId][wk]) db[marketId][wk] = {};
    if (!db[marketId][wk][cid]) db[marketId][wk][cid] = {};
    if (!db[marketId][wk][cid][d]) db[marketId][wk][cid][d] = { inputs: ['','','','','',''] };
    db[marketId][wk][cid][d].inputs[i] = value !== null ? String(value) : '';
  });

  console.log('[AMAD IX] Loaded', allData.length, 'total entries for', marketId,
    '| weeks:', [...new Set(allData.map(r => r.week_key))].length);
}

// Load entries for one specific week only (used for real-time refresh)
async function sbLoadEntries(marketId, weekKey) {
  if (!weekKey) return;
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

// ─────────────────────────────────────────────────────────────────
// SAVED DAYS
// ─────────────────────────────────────────────────────────────────
async function sbLoadSavedDays() {
  const { data, error } = await _sb.from('saved_days').select('market_id,week_key,day_index');
  if (error) { console.error('sbLoadSavedDays:', error); return; }
  (data || []).forEach(r => savedDays.add(`${r.market_id}__${r.week_key}__${r.day_index}`));
}

async function sbSaveDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').upsert({
    market_id: marketId, week_key: weekKey, day_index: dayIndex,
    saved_by: window.curUserMarket || marketId,
    saved_at: new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index' });
  if (error) console.error('sbSaveDay:', error);
}

async function sbUnlockDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').delete()
    .eq('market_id', marketId).eq('week_key', weekKey).eq('day_index', dayIndex);
  if (error) console.error('sbUnlockDay:', error);
}

// ─────────────────────────────────────────────────────────────────
// FLAGS
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// EDIT REQUESTS
// ─────────────────────────────────────────────────────────────────
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
    resolved_at: req.resolvedAt || null,
    resolved_by: req.resolvedBy || null,
  }, { onConflict: 'id' });
  if (error) console.error('sbSaveEditRequest:', error);
}

// ─────────────────────────────────────────────────────────────────
// REAL-TIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────
let _realtimeActive = false;
function sbSubscribeRealtime() {
  if (_realtimeActive) return;
  _realtimeActive = true;
  _sb.channel('amad-flags-'+Date.now())
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

  _sb.channel('amad-editreq-'+Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'edit_requests' }, async () => {
      await sbLoadEditRequests();
      if (window.updateCounters) updateCounters();
      if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
    }).subscribe();

  _sb.channel('amad-entries-'+Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async payload => {
      const row = payload.new;
      if (!row) return;
      // Load only the changed week for this market
      await sbLoadEntries(row.market_id, row.week_key);
      // Refresh UI if viewing that market
      if (row.market_id === window.curMkt) {
        if (window.rebuildCurrentPane) rebuildCurrentPane();
      }
    }).subscribe();
}

// ─────────────────────────────────────────────────────────────────
// BOOT — loads everything needed for the full app
// ─────────────────────────────────────────────────────────────────
async function sbBootApp(user) {
  const marketId   = user.market_id;
  const isAdmin    = marketId === '__admin__';
  const isVerifier = marketId === '__verifier__';

  console.log('[AMAD IX] Booting for', marketId);

  // Show loading indicator
  const overlay = document.createElement('div');
  overlay.id = '_sbLoadingOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(15,61,82,0.82);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:99999;color:#fff;font-family:'Barlow Condensed',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-bottom:12px">⏳ AMAD IX</div>
    <div id="_sbLoadMsg" style="font-size:14px;color:#a0ddd8;letter-spacing:1px">Connecting to database...</div>
    <div style="margin-top:18px;width:220px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden">
      <div id="_sbLoadBar" style="width:0%;height:100%;background:#2ba899;border-radius:2px;transition:width 0.4s"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const setMsg = (msg, pct) => {
    const el = document.getElementById('_sbLoadMsg');
    const bar = document.getElementById('_sbLoadBar');
    if (el) el.textContent = msg;
    if (bar) bar.style.width = pct + '%';
  };

  try {
    setMsg('Loading saved days...', 10);
    await sbLoadSavedDays();

    setMsg('Loading flags...', 25);
    await sbLoadFlags(isAdmin || isVerifier ? null : marketId);

    setMsg('Loading edit requests...', 35);
    await sbLoadEditRequests();

    if (!isAdmin && !isVerifier) {
      // ENCODER: load ALL their entries (all weeks) so analytics works
      setMsg('Loading your market data (all weeks)...', 50);
      await sbLoadAllEntries(marketId);
      setMsg('Data loaded!', 90);
    } else {
      // ADMIN / VERIFIER: load all markets, all entries
      const mkts = window.dataMkts ? window.dataMkts() : [];
      let done = 0;
      for (const m of mkts) {
        setMsg(`Loading ${m.label || m.id}...`, 40 + Math.round((done / mkts.length) * 50));
        await sbLoadAllEntries(m.id);
        done++;
      }
      setMsg('All markets loaded!', 92);
    }

    setMsg('Starting real-time sync...', 95);
    sbSubscribeRealtime();

    setMsg('Ready!', 100);

    // Remove loading overlay and rebuild UI
    setTimeout(() => {
      overlay.remove();
      if (window.rebuildCurrentPane) rebuildCurrentPane();
      if (window.updateCounters) updateCounters();
      if (window.autoFlagAll) autoFlagAll();
      console.log('[AMAD IX] Boot complete ✅');
    }, 400);

  } catch (err) {
    console.error('[AMAD IX] Boot error:', err);
    setMsg('Error: ' + err.message, 0);
    setTimeout(() => overlay.remove(), 4000);
  }
}

console.log('[AMAD IX] Supabase adapter v3 loaded. URL:', SUPABASE_URL);
