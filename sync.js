// ══════════════════════════════════════════════════
//  LTS Care — Supabase Sync Layer
//  Shared by all modules. Include before module JS.
// ══════════════════════════════════════════════════

const SUPABASE_URL = 'https://nrurfusjkvuudfzgfsww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iN8epmLwCUeTSpoa3LXAiQ_ArxibPfq'; // must match lts_care.html

// ── Init Supabase client ──
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Get current user ID ──
async function syncGetUserId() {
  const { data: { session } } = await _sb.auth.getSession();
  return session?.user?.id || null;
}

// ══════════════════════════════════════════════════
//  HEALTH RECORDS
//  module: 'vitals' | 'peak_flow' | 'spirometer' | 'symptoms'
//  data: any JSON object
// ══════════════════════════════════════════════════

async function syncSaveHealthRecord(module, recordedAt, data) {
  const userId = await syncGetUserId();
  if (!userId) return;
  try {
    await _sb.from('health_records').upsert({
      user_id:     userId,
      module,
      recorded_at: recordedAt,
      data
    }, { onConflict: 'user_id,module,recorded_at' });
  } catch(e) { console.warn('Sync save failed:', e.message); }
}

async function syncLoadHealthRecords(module) {
  const userId = await syncGetUserId();
  if (!userId) return null;
  try {
    const { data, error } = await _sb
      .from('health_records')
      .select('recorded_at, data')
      .eq('user_id', userId)
      .eq('module', module)
      .order('recorded_at', { ascending: true });
    if (error) throw error;
    return data;
  } catch(e) { console.warn('Sync load failed:', e.message); return null; }
}

async function syncDeleteHealthRecord(module, recordedAt) {
  const userId = await syncGetUserId();
  if (!userId) return;
  try {
    await _sb.from('health_records')
      .delete()
      .eq('user_id', userId)
      .eq('module', module)
      .eq('recorded_at', recordedAt);
  } catch(e) { console.warn('Sync delete failed:', e.message); }
}

// ══════════════════════════════════════════════════
//  CLINICAL DATA
//  data_type: 'medications' | 'conversation' | 'summary' | 'files'
// ══════════════════════════════════════════════════

async function syncSaveClinical(dataType, data) {
  const userId = await syncGetUserId();
  if (!userId) return;
  try {
    await _sb.from('clinical_data').upsert({
      user_id:    userId,
      data_type:  dataType,
      data,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,data_type' });
  } catch(e) { console.warn('Sync save clinical failed:', e.message); }
}

async function syncLoadClinical(dataType) {
  const userId = await syncGetUserId();
  if (!userId) return null;
  try {
    const { data, error } = await _sb
      .from('clinical_data')
      .select('data, updated_at')
      .eq('user_id', userId)
      .eq('data_type', dataType)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found, that's ok
    return data?.data || null;
  } catch(e) { console.warn('Sync load clinical failed:', e.message); return null; }
}

// ══════════════════════════════════════════════════
//  FILE STORAGE (Supabase Storage bucket: lab-files)
// ══════════════════════════════════════════════════

async function syncUploadFile(b64, mimeType, originalName) {
  const userId = await syncGetUserId();
  if (!userId) return null;
  try {
    // Convert base64 to blob
    const byteStr = atob(b64);
    const bytes   = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    // Unique path per user per file
    const ext      = mimeType === 'application/pdf' ? '.pdf' : '.jpg';
    const fileName = `${userId}/${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g,'_')}`;

    const { data, error } = await _sb.storage
      .from('lab-files')
      .upload(fileName, blob, { contentType: mimeType, upsert: false });

    if (error) throw error;
    return data.path; // Return the storage path for reference
  } catch(e) { console.warn('File upload failed:', e.message); return null; }
}

async function syncDownloadFile(storagePath) {
  try {
    const { data, error } = await _sb.storage
      .from('lab-files')
      .download(storagePath);
    if (error) throw error;
    // Convert blob back to base64
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = e => res(e.target.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(data);
    });
  } catch(e) { console.warn('File download failed:', e.message); return null; }
}

// ══════════════════════════════════════════════════
//  SYNC STATUS INDICATOR
//  Call syncShowStatus('syncing'|'synced'|'error')
// ══════════════════════════════════════════════════
function syncShowStatus(state) {
  let el = document.getElementById('sync-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-status';
    el.style.cssText = 'position:fixed;bottom:12px;left:12px;font-size:11px;font-weight:500;padding:4px 10px;border-radius:12px;z-index:500;transition:all .3s;pointer-events:none;font-family:DM Sans,sans-serif;';
    document.body.appendChild(el);
  }
  if (state === 'syncing') {
    el.textContent = '⟳ Syncing…';
    el.style.background = '#E0F2F5';
    el.style.color = '#0E7490';
    el.style.opacity = '1';
  } else if (state === 'synced') {
    el.textContent = '✓ Synced';
    el.style.background = '#E8F7F1';
    el.style.color = '#2D9E6B';
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2000);
  } else if (state === 'error') {
    el.textContent = '⚠ Sync error';
    el.style.background = '#FAEAEA';
    el.style.color = '#C94040';
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 3000);
  } else {
    el.style.opacity = '0';
  }
}

// ══════════════════════════════════════════════════
//  FULL SYNC HELPERS
//  syncPush: localStorage → Supabase
//  syncPull: Supabase → localStorage (newer wins)
// ══════════════════════════════════════════════════

async function syncPushAll() {
  syncShowStatus('syncing');
  try {
    const userId = await syncGetUserId();
    if (!userId) { syncShowStatus('error'); return; }

    // Push health records (vitals/spiro/symptoms — individual rows)
    const modules = [
      { key:'vss_spo2_v1',          module:'vitals_spo2' },
      { key:'vss_hr_v1',            module:'vitals_hr' },
      { key:'vss_bp_v1',            module:'vitals_bp' },
      { key:'vss_wt_v1',            module:'vitals_wt' },
      { key:'vss_temp_v1',          module:'vitals_temp' },
      { key:'spiro_records_v1',     module:'spirometer' },
      { key:'symptom_checkins_v1',  module:'symptoms' },
    ];

    for (const { key, module } of modules) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const records = JSON.parse(raw);
      if (!Array.isArray(records) || !records.length) continue;
      for (const record of records) {
        const ts = record.date ? record.date + 'T00:00:00Z' : new Date().toISOString();
        await syncSaveHealthRecord(module, ts, record);
      }
    }

    // Push clinical data (peak_flow goes here — whole array as single document)
    const clinicalKeys = [
      { key:'clinical_meds_v1',         type:'medications' },
      { key:'clinical_conversation_v1', type:'conversation' },
      { key:'clinical_summary_v1',      type:'summary', isString:true },
      { key:'clinical_files_v1',        type:'files' },
      { key:'lab_conversation_v1',      type:'lab_conversation' },
      { key:'lab_summary_v1',           type:'lab_summary', isString:true },
    ];

    for (const { key, type, isString } of clinicalKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = isString ? { text: raw } : JSON.parse(raw);
      await syncSaveClinical(type, data);
    }

    syncShowStatus('synced');
  } catch(e) {
    console.error('syncPushAll failed:', e);
    syncShowStatus('error');
  }
}

async function syncPullAll() {
  syncShowStatus('syncing');
  try {
    const userId = await syncGetUserId();
    if (!userId) { syncShowStatus('error'); return; }

    // Pull health records (vitals only — peak_flow now syncs via clinical_data)
    const modules = [
      { key:'vss_spo2_v1',          module:'vitals_spo2' },
      { key:'vss_hr_v1',            module:'vitals_hr' },
      { key:'vss_bp_v1',            module:'vitals_bp' },
      { key:'vss_wt_v1',            module:'vitals_wt' },
      { key:'vss_temp_v1',          module:'vitals_temp' },
      { key:'spiro_records_v1',     module:'spirometer' },
      { key:'symptom_checkins_v1',  module:'symptoms' },
    ];

    for (const { key, module } of modules) {
      const records = await syncLoadHealthRecords(module);
      if (!records?.length) continue;
      const data = records.map(r => r.data);
      localStorage.setItem(key, JSON.stringify(data));
    }

    // Pull clinical data (includes peak_flow which saves here via saveSessions)
    const clinicalKeys = [
      { key:'clinical_meds_v1',         type:'medications' },
      { key:'clinical_conversation_v1', type:'conversation' },
      { key:'clinical_summary_v1',      type:'summary', isString:true },
      { key:'clinical_files_v1',        type:'files' },
      { key:'lab_conversation_v1',      type:'lab_conversation' },
      { key:'lab_summary_v1',           type:'lab_summary', isString:true },
    ];

    for (const { key, type, isString } of clinicalKeys) {
      const remote = await syncLoadClinical(type);
      if (!remote) continue;
      const data = isString ? remote.text : remote;
      // Only write to localStorage if it is completely empty — never overwrite local edits
      const existing = localStorage.getItem(key);
      const isEmpty = !existing || existing === '[]' || existing === '""' || existing === 'null';
      if (isEmpty) {
        localStorage.setItem(key, isString ? data : JSON.stringify(data));
      }
    }

    syncShowStatus('synced');
    return true;
  } catch(e) {
    console.error('syncPullAll failed:', e);
    syncShowStatus('error');
    return false;
  }
}
