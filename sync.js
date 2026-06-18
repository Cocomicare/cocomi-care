// ══════════════════════════════════════════════════
//  Cocomi Care — Supabase Sync Layer v3
//  Single source of truth: Supabase clinical_data table
//  Pattern: syncSaveClinical / syncLoadClinical everywhere
//  One data_type per module, array of records per row
// ══════════════════════════════════════════════════

const SUPABASE_URL = 'https://nrurfusjkvuudfzgfsww.supabase.co';

// Use the publishable key — matches lts_care.html login so session is shared
const SUPABASE_KEY = 'sb_publishable_iN8epmLwCUeTSpoa3LXAiQ_ArxibPfq';

// Single Supabase client instance shared by all modules
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth ──────────────────────────────────────────
async function syncGetUserId() {
  try {
    const { data: { session } } = await _sb.auth.getSession();
    return session?.user?.id || null;
  } catch(e) { return null; }
}

// ── Status indicator ──────────────────────────────
function syncShowStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = { syncing: '⟳', synced: '✓', error: '!' };
  el.textContent = map[state] || '';
  el.className = 'sync-status ' + state;
}

// ══════════════════════════════════════════════════
//  SAVE — write array of records to clinical_data
//  dataType: 'vitals_spo2' | 'vitals_hr' | 'vitals_bp' |
//            'vitals_temp' | 'vitals_wt' | 'peak_flow' |
//            'spirometer' | 'symptoms' | etc.
//  data: array of record objects
// ══════════════════════════════════════════════════
async function syncSaveClinical(dataType, data) {
  const userId = await syncGetUserId();
  if (!userId) {
    console.warn('[sync] syncSaveClinical: no user session for', dataType);
    return;
  }
  try {
    const { error } = await _sb
      .from('clinical_data')
      .upsert({
        user_id:    userId,
        data_type:  dataType,
        data:       data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,data_type' });
    if (error) throw error;
  } catch(e) {
    console.warn('[sync] syncSaveClinical failed:', dataType, e.message);
    throw e; // re-throw so callers can show error state
  }
}

// ══════════════════════════════════════════════════
//  LOAD — read array of records from clinical_data
//  Returns: array of records, or null if not found / error
// ══════════════════════════════════════════════════
async function syncLoadClinical(dataType) {
  const userId = await syncGetUserId();
  if (!userId) {
    console.warn('[sync] syncLoadClinical: no user session for', dataType);
    return null;
  }
  try {
    const { data, error } = await _sb
      .from('clinical_data')
      .select('data, updated_at')
      .eq('user_id', userId)
      .eq('data_type', dataType)
      .limit(1);
    if (error) throw error;
    return data?.[0]?.data || null;
  } catch(e) {
    console.warn('[sync] syncLoadClinical failed:', dataType, e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════
//  DELETE — remove one record by id from a data type
//  Loads array, removes matching id, saves back
// ══════════════════════════════════════════════════
async function syncDeleteClinicalRecord(dataType, id) {
  const userId = await syncGetUserId();
  if (!userId) return;
  try {
    const current = await syncLoadClinical(dataType);
    if (!current || !Array.isArray(current)) return;
    const updated = current.filter(r => r.id !== id);
    await syncSaveClinical(dataType, updated);
  } catch(e) {
    console.warn('[sync] syncDeleteClinicalRecord failed:', dataType, e.message);
  }
}

// ══════════════════════════════════════════════════
//  LEGACY STUBS — kept for backward compatibility
//  with older module code that calls these functions
// ══════════════════════════════════════════════════
async function syncSaveHealthRecord(module, recordedAt, data) {
  // Redirect to clinical_data pattern
  console.warn('[sync] syncSaveHealthRecord is deprecated, use syncSaveClinical');
}
async function syncLoadHealthRecords(module) {
  console.warn('[sync] syncLoadHealthRecords is deprecated, use syncLoadClinical');
  return null;
}
async function syncDeleteHealthRecord(module, recordedAt) {
  console.warn('[sync] syncDeleteHealthRecord is deprecated, use syncDeleteClinicalRecord');
}
async function syncPullAll() {
  console.warn('[sync] syncPullAll is deprecated — each module manages its own sync');
}
async function syncPushAll() {
  console.warn('[sync] syncPushAll is deprecated — each module manages its own sync');
}
