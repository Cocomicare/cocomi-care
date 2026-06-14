// ══════════════════════════════════════════════════
//  LTS Care — Supabase Sync Layer
// ══════════════════════════════════════════════════

const SUPABASE_URL = 'https://nrurfusjkvuudfzgfsww.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ydXJmdXNqa3Z1dWRmemdmc3d3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3NjMyNzMsImV4cCI6MjA2NTMzOTI3M30.auXmdHDVGaQYeHUpjrPMBDMdMthLeSQk9J81f5JDzYw';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncGetUserId() {
  const { data: { session } } = await _sb.auth.getSession();
  return session?.user?.id || null;
}

async function syncSaveHealthRecord(module, recordedAt, data) {
  syncShowStatus('syncing');
  const userId = await syncGetUserId();
  if (userId) {
    try {
      const { error } = await _sb.from('health_records').upsert({
        user_id: userId, module, recorded_at: recordedAt, data
      }, { onConflict: 'user_id,module,recorded_at' });
      if (error) throw error;
      syncShowStatus('synced');
      return;
    } catch(e) {
      console.warn('Direct save failed:', e.message, '— trying postMessage');
    }
  }
  // Fallback to parent
  window.parent.postMessage({ type: 'SYNC_SAVE_HEALTH_RECORD', module, recordedAt, data }, '*');
  syncShowStatus('synced');
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
    await _sb.from('health_records').delete()
      .eq('user_id', userId).eq('module', module).eq('recorded_at', recordedAt);
  } catch(e) { console.warn('Sync delete failed:', e.message); }
}

async function syncSaveClinical(dataType, data) {
  syncShowStatus('syncing');
  const userId = await syncGetUserId();
  if (userId) {
    try {
      const { error } = await _sb.from('clinical_data').upsert({
        user_id: userId, data_type: dataType, data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,data_type' });
      if (error) throw error;
      syncShowStatus('synced');
      return;
    } catch(e) {
      console.warn('Direct clinical save failed:', e.message, '— trying postMessage');
    }
  }
  window.parent.postMessage({ type: 'SYNC_SAVE_CLINICAL', dataType, data }, '*');
  syncShowStatus('synced');
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
    if (error && error.code !== 'PGRST116') throw error;
    return data?.data || null;
  } catch(e) { console.warn('Sync load clinical failed:', e.message); return null; }
}

async function syncPullAll() {
  const userId = await syncGetUserId();
  if (!userId) return false;
  try {
    const types = [
      { type:'medications', key:'clinical_meds_v1' },
      { type:'conversation', key:'clinical_conversation_v1' },
      { type:'files', key:'clinical_files_v1' },
    ];
    for (const { type, key } of types) {
      const { data } = await _sb.from('clinical_data').select('data')
        .eq('user_id', userId).eq('data_type', type).single();
      if (data?.data) localStorage.setItem(key, JSON.stringify(data.data));
    }
    return true;
  } catch(e) { return false; }
}

async function syncUploadFile(base64Data, mimeType, fileName) {
  const userId = await syncGetUserId();
  if (!userId) return null;
  try {
    const byteString = atob(base64Data);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });
    const path = `${userId}/${Date.now()}_${fileName}`;
    const { error } = await _sb.storage.from('lab-files').upload(path, blob);
    if (error) throw error;
    return path;
  } catch(e) { console.warn('File upload failed:', e.message); return null; }
}

function syncShowStatus(status) {
  let el = document.getElementById('sync-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-status';
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);font-size:12px;font-weight:600;padding:7px 18px;border-radius:20px;font-family:DM Sans,sans-serif;z-index:9999;transition:opacity .4s;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.15)';
    document.body.appendChild(el);
  }
  clearTimeout(el._timeout);
  el.style.opacity = '1';
  if (status === 'syncing') {
    el.style.background = '#E8F1FA'; el.style.color = '#3B82C4';
    el.textContent = '⟳ Saving to cloud…';
  } else if (status === 'synced') {
    el.style.background = '#E8F7F1'; el.style.color = '#2D9E6B';
    el.textContent = '✓ Saved & synced';
    el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 3000);
  } else if (status === 'error') {
    el.style.background = '#FAEAEA'; el.style.color = '#C94040';
    el.textContent = '⚠ Sync error — check connection';
    el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 5000);
  }
}
