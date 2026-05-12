// ══════════════════════════════════════════════════════════════════
// amad-supabase.js  —  AMAD IX · Supabase Data Adapter  v4
// FIXES:
//   1. Auto-seeds commodities & markets into Supabase on first boot
//   2. Batch upsert for saves (one call instead of 60+)
//   3. sbSaveEntry throws on error so saveAll() catches failures
//   4. sbBootApp seeds DB tables before loading data
//   5. Real error feedback — toast shows actual error, not false success
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
// SEED — ensure commodities & markets exist in Supabase
// Called once on boot so entries FK never fails
// ─────────────────────────────────────────────────────────────────
async function sbSeedCommodities() {
  // Build commodity rows from JS DEFAULT_COMS
  const rows = [];
  let currentSection = '';
  let order = 0;
  (window.DEFAULT_COMS || []).forEach(row => {
    if (row.sec) { currentSection = row.sec; return; }
    if (!row.id) return;
    rows.push({
      id:         row.id,
      section:    currentSection,
      name:       row.c,
      spec:       row.s || '',
      unit:       row.u || 'kg',
      sort_order: order++,
    });
  });

  if (!rows.length) return;

  // Upsert in one call — ignore conflicts (already seeded)
  const { error } = await _sb
    .from('commodities')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (error) console.warn('[AMAD IX] sbSeedCommodities warning:', error.message);
  else console.log('[AMAD IX] Commodities seeded/verified:', rows.length);
}

async function sbSeedMarkets() {
  const mkts = window.dataMkts ? window.dataMkts() : [];
  if (!mkts.length) return;

  const rows = mkts.map((m, i) => ({
    id:         m.id,
    label:      m.label,
    sheet:      m.sheet || m.label,
    city:       m.city || '',
    province:   m.province || '',
    sort_order: i,
  }));

  const { error } = await _sb
    .from('markets')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (error) console.warn('[AMAD IX] sbSeedMarkets warning:', error.message);
  else console.log('[AMAD IX] Markets seeded/verified:', rows.length);
}

// ─────────────────────────────────────────────────────────────────
// ENTRIES — load ALL entries for a market (all weeks, all days)
// ─────────────────────────────────────────────────────────────────
async function sbLoadAllEntries(marketId) {
  console.log('[AMAD IX] Loading ALL entries for', marketId, '...');

  let allData = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await _sb
      .from('entries')
      .select('week_key,commodity_id,day_index,obs_index,value')
      .eq('market_id', marketId)
      .range(from, from + batchSize - 1)
      .order('week_key', { ascending: true });

    if (error) { console.error('sbLoadAllEntries:', error.message); break; }
    if (!data || data.length === 0) break;

    allData = allData.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  if (!db[marketId]) db[marketId] = {};

  allData.forEach(row => {
    const { week_key: wk, commodity_id: cid, day_index: d, obs_index: i, value } = row;
    if (!db[marketId][wk]) db[marketId][wk] = {};
    if (!db[marketId][wk][cid]) db[marketId][wk][cid] = {};
    if (!db[marketId][wk][cid][d]) db[marketId][wk][cid][d] = { inputs: ['','','','','',''], notes: '' };
    db[marketId][wk][cid][d].inputs[i] = value !== null ? parseFloat(value) : '';
  });

  console.log('[AMAD IX] Loaded', allData.length, 'entries for', marketId,
    '| unique weeks:', [...new Set(allData.map(r => r.week_key))].length);
}

// Load entries for one specific week only (for real-time updates)
async function sbLoadEntries(marketId, weekKey) {
  if (!weekKey) return;
  const { data, error } = await _sb
    .from('entries').select('commodity_id,day_index,obs_index,value')
    .eq('market_id', marketId)
    .eq('week_key', weekKey);
  if (error) { console.error('sbLoadEntries:', error.message); return; }
  if (!db[marketId]) db[marketId] = {};
  if (!db[marketId][weekKey]) db[marketId][weekKey] = {};
  (data || []).forEach(row => {
    const { commodity_id: cid, day_index: d, obs_index: i, value } = row;
    if (!db[marketId][weekKey][cid]) db[marketId][weekKey][cid] = {};
    if (!db[marketId][weekKey][cid][d]) db[marketId][weekKey][cid][d] = { inputs: ['','','','','',''], notes: '' };
    db[marketId][weekKey][cid][d].inputs[i] = value !== null ? parseFloat(value) : '';
  });
}

// ─────────────────────────────────────────────────────────────────
// BATCH SAVE — upsert all non-empty entries for a market+week+day
// Much faster than 60+ individual calls; throws on error
// ─────────────────────────────────────────────────────────────────
async function sbSaveDayBatch(marketId, weekKey, dayIndex) {
  const rows = [];
  const coms = window.dataComs ? window.dataComs() : [];

  coms.forEach(com => {
    const inputs = window.getInp ? getInp(marketId, weekKey, com.id, dayIndex) : [];
    inputs.forEach((val, obsIdx) => {
      // Save all 6 slots — null clears a previously saved value
      rows.push({
        market_id:    marketId,
        week_key:     weekKey,
        day_index:    dayIndex,
        commodity_id: com.id,
        obs_index:    obsIdx,
        value:        (val === '' || val == null) ? null : parseFloat(val),
        encoder_id:   window.curUserMarket || marketId,
        updated_at:   new Date().toISOString(),
      });
    });
  });

  if (!rows.length) return 0;

  // Split into chunks of 500 to stay within Supabase limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await _sb.from('entries').upsert(chunk, {
      onConflict: 'market_id,week_key,day_index,commodity_id,obs_index',
    });
    if (error) {
      console.error('[AMAD IX] sbSaveDayBatch error:', error.message, error.details);
      throw new Error('Save failed: ' + error.message);
    }
  }

  console.log('[AMAD IX] Batch saved', rows.length, 'rows for',
    marketId, weekKey, 'day', dayIndex);
  return rows.length;
}

// Keep old single-entry save for compatibility (used by old hInp if called directly)
async function sbSaveEntry(marketId, weekKey, dayIndex, commodityId, obsIndex, value) {
  const { error } = await _sb.from('entries').upsert({
    market_id:    marketId,
    week_key:     weekKey,
    day_index:    dayIndex,
    commodity_id: commodityId,
    obs_index:    obsIndex,
    value:        (value === '' || value == null) ? null : parseFloat(value),
    encoder_id:   window.curUserMarket || marketId,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index,commodity_id,obs_index' });

  if (error) {
    console.error('sbSaveEntry error:', error.message);
    throw new Error(error.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// SAVED DAYS
// ─────────────────────────────────────────────────────────────────
async function sbLoadSavedDays() {
  const { data, error } = await _sb.from('saved_days').select('market_id,week_key,day_index');
  if (error) { console.error('sbLoadSavedDays:', error.message); return; }
  (data || []).forEach(r => savedDays.add(`${r.market_id}__${r.week_key}__${r.day_index}`));
  console.log('[AMAD IX] Loaded saved days:', data?.length || 0);
}

async function sbSaveDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').upsert({
    market_id: marketId,
    week_key:  weekKey,
    day_index: dayIndex,
    saved_by:  window.curUserMarket || marketId,
    saved_at:  new Date().toISOString(),
  }, { onConflict: 'market_id,week_key,day_index' });
  if (error) {
    console.error('sbSaveDay error:', error.message);
    throw new Error('Could not lock day: ' + error.message);
  }
}

async function sbUnlockDay(marketId, weekKey, dayIndex) {
  const { error } = await _sb.from('saved_days').delete()
    .eq('market_id', marketId).eq('week_key', weekKey).eq('day_index', dayIndex);
  if (error) console.error('sbUnlockDay:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// FLAGS
// ─────────────────────────────────────────────────────────────────
async function sbLoadFlags(marketId) {
  let q = _sb.from('flags').select('*').in('status', ['open']);
  if (marketId && marketId !== '__admin__' && marketId !== '__verifier__') {
    q = q.eq('market_id', marketId);
  }
  const { data, error } = await q;
  if (error) { console.error('sbLoadFlags:', error.message); return; }
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
  console.log('[AMAD IX] Loaded flags:', data?.length || 0);
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
  if (error) console.error('sbSaveFlag:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// EDIT REQUESTS
// ─────────────────────────────────────────────────────────────────
async function sbLoadEditRequests() {
  const { data, error } = await _sb.from('edit_requests').select('*')
    .order('created_at', { ascending: false }).limit(100);
  if (error) { console.error('sbLoadEditRequests:', error.message); return; }
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
  if (error) console.error('sbSaveEditRequest:', error.message);
}

// ─────────────────────────────────────────────────────────────────
// REAL-TIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────
let _realtimeActive = false;
function sbSubscribeRealtime() {
  if (_realtimeActive) return;
  _realtimeActive = true;

  _sb.channel('amad-flags-' + Date.now())
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

  _sb.channel('amad-editreq-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'edit_requests' }, async () => {
      await sbLoadEditRequests();
      if (window.updateCounters) updateCounters();
      if (document.getElementById('approvalPanel')?.classList.contains('open')) renderApprovalBody();
    }).subscribe();

  _sb.channel('amad-entries-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async payload => {
      const row = payload.new;
      if (!row) return;
      await sbLoadEntries(row.market_id, row.week_key);
      if (row.market_id === window.curMkt && row.week_key === window.curWeek) {
        if (window.rebuildCurrentPane) rebuildCurrentPane();
      }
    }).subscribe();
}

// ─────────────────────────────────────────────────────────────────
// BOOT — seeds tables, loads all data, starts realtime
// ─────────────────────────────────────────────────────────────────
async function sbBootApp(user) {
  const marketId   = user.market_id;
  const isAdmin    = marketId === '__admin__';
  const isVerifier = marketId === '__verifier__';

  console.log('[AMAD IX] Boot start for', marketId);

  // Loading overlay
  const overlay = document.createElement('div');
  overlay.id = '_sbLoadingOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(15,61,82,0.88);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    z-index:99999;color:#fff;font-family:'Barlow Condensed',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="font-size:28px;font-weight:800;letter-spacing:2px;margin-bottom:12px">AMAD IX</div>
    <div id="_sbLoadMsg" style="font-size:14px;color:#a0ddd8;letter-spacing:1px;margin-bottom:4px">Connecting...</div>
    <div id="_sbLoadDetail" style="font-size:10px;color:#6ab8b0;letter-spacing:0.5px;min-height:14px"></div>
    <div style="margin-top:18px;width:260px;height:5px;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden">
      <div id="_sbLoadBar" style="width:0%;height:100%;background:#2ba899;border-radius:3px;transition:width 0.3s"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const setMsg = (msg, detail, pct) => {
    const el  = document.getElementById('_sbLoadMsg');
    const el2 = document.getElementById('_sbLoadDetail');
    const bar = document.getElementById('_sbLoadBar');
    if (el)  el.textContent  = msg;
    if (el2) el2.textContent = detail || '';
    if (bar) bar.style.width = pct + '%';
  };

  try {
    // ── Step 1: Seed reference tables (idempotent) ──
    setMsg('Syncing markets & commodities...', 'First-time setup may take a moment', 10);
    await sbSeedMarkets();
    await sbSeedCommodities();

    // ── Step 2: Load saved days ──
    setMsg('Loading saved days...', '', 20);
    await sbLoadSavedDays();

    // ── Step 3: Load flags ──
    setMsg('Loading verification flags...', '', 30);
    await sbLoadFlags(isAdmin || isVerifier ? null : marketId);

    // ── Step 4: Load edit requests ──
    setMsg('Loading edit requests...', '', 38);
    await sbLoadEditRequests();

    // ── Step 5: Load price entries ──
    if (!isAdmin && !isVerifier) {
      setMsg('Loading your market data...', marketId, 50);
      await sbLoadAllEntries(marketId);
      setMsg('Data loaded!', '', 90);
    } else {
      const mkts = window.dataMkts ? window.dataMkts() : [];
      let done = 0;
      for (const m of mkts) {
        const pct = 40 + Math.round((done / mkts.length) * 52);
        setMsg('Loading market data...', m.label || m.id, pct);
        await sbLoadAllEntries(m.id);
        done++;
      }
      setMsg('All markets loaded!', '', 93);
    }

    // ── Step 6: Start realtime ──
    setMsg('Starting real-time sync...', '', 97);
    sbSubscribeRealtime();

    setMsg('Ready!', '', 100);

    setTimeout(() => {
      overlay.remove();
      if (window.rebuildCurrentPane) rebuildCurrentPane();
      if (window.updateCounters) updateCounters();
      if (window.autoFlagAll) autoFlagAll();
      if (window.attachSelectionsToCurrentPane) attachSelectionsToCurrentPane();
      console.log('[AMAD IX] Boot complete ✅ db keys:', Object.keys(db).length);
    }, 350);

  } catch (err) {
    console.error('[AMAD IX] Boot error:', err);
    setMsg('❌ ' + err.message, 'Check console for details. Refreshing in 5s…', 0);
    setTimeout(() => { overlay.remove(); location.reload(); }, 5000);
  }
}

console.log('[AMAD IX] Supabase adapter v4 loaded. URL:', SUPABASE_URL);
