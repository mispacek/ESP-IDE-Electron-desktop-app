// File Manager over REPL with a dedicated RX buffer (fm_in_buffer) in transports.
// No RAW REPL. Commands run in standard REPL with the terminal muted.
// Features: streamed listing, multi-upload with dialog, download via fm_down,
// progress + memory status, and locks against concurrent operations.


// === File Manager i18n helpers ===
function fmT(key, vars){
  try {
    if (window.__espideI18n && typeof window.__espideI18n.t === 'function') {
      return window.__espideI18n.t(key, vars);
    }
    if (typeof window.t === 'function') return window.t(key, vars);
  } catch (_) {}
  if (!vars) return key;
  return key.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

function applyFmTranslations(){
  const api = window.__espideI18n;
  if (!api || typeof api.applyTranslations !== 'function') return;
  api.applyTranslations(document);
}

function hookFmLanguageChanges(){
  const api = window.__espideI18n;
  if (!api || typeof api.setLanguage !== 'function' || api.__fmHooked) return;
  const original = api.setLanguage.bind(api);
  api.setLanguage = async (...args) => {
    const res = await original(...args);
    applyFmTranslations();
    return res;
  };
  api.__fmHooked = true;
}

// === SweetAlert2 dialog helpers (aligned with index.html) ===
async function dlgConfirm(message){
  const r = await Swal.fire({
    icon: 'question',
    title: message,
    showCancelButton: true,
    confirmButtonText: fmT('actions.yes'),
    cancelButtonText: fmT('actions.no')
  });
  return r.isConfirmed;
}
function info(message, text=''){
  return Swal.fire({ icon:'info', title: message, text, confirmButtonText: fmT('actions.ok') });
}
function errorDlg(message, text=''){
  return Swal.fire({ icon:'error', title: message, text, confirmButtonText: fmT('actions.ok') });
}
// ====== STATE AND BOOT ======
let currentPath = '/';
let selectedFiles = [];
let popup_modal = false;
let popupTimer = null;
let __fmAcc = "";                 // File Manager data accumulator
let __fm_inited = false;
let __statusTimer = null;
let statusRunning = false;
let uploadingBatch = false;       // blocks status queries during upload/download
let listingActive = false;        // blocks status during listing
let __importsReady = false;       // ujson/fm_rpc ready
let __lock = Promise.resolve();   // REPL serial lock
let replBusyCount = 0;
let dirLoadLock = Promise.resolve();

// Public API: open FM and load a directory (called by index.html)
window.fmOpen = async function(path = '/'){
  if (!__fm_inited) __init();
  // FM active -> disable global DnD from index.html
  try { window.__FM_ACTIVE = true; } catch(_){}
  if (!isConnected()){
    showError(fmT('fileManager.errors.notConnected'));
    return;
  }
  
  await loadDirectoryContents(path).catch(e=>showError(String(e&&e.message||e)));
  updateStatus().catch(()=>{});
  if (!__statusTimer) {
    __statusTimer = setInterval(()=>updateStatus().catch(()=>{}), 3000);
  }
};

function __init(){
  if (__fm_inited) return;
  __fm_inited = true;
  __bindToolbar();
  applyFmTranslations();
  hookFmLanguageChanges();
}

if (!__fm_inited) __init();

// ====== UI HOOKS ======
function __bindToolbar(){
  bindClick(['upload','btn-upload','upload-btn'], ()=> qs('file-upload')?.click());
  bindChange(['file-upload','input-upload'], handleFileInputChange);

  bindClick(['download','btn-download'], downloadFiles);
  bindClick(['move-to','btn-move'], moveTo);
  bindClick(['copy-to','btn-copy'], copyTo);
  bindClick(['rename','btn-rename'], renameFile);
  bindClick(['new-folder','btn-new-folder','create-folder'], new_Folder);
  bindClick(['delete','btn-delete'], deleteFiles);
  bindClick(['clear-selection','btn-clear-selection'], clearSelection);
  bindClick(['close-fm','btn-close-fm'], closeFM);

  const list = qs('file-list') || qs('file-table');
  if (list){
    list.addEventListener('drop', handleDrop);
    list.addEventListener('dragover', e=>{ e.preventDefault(); });
  }

  bindCloseButtons();
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closePopup(); });
}

// ====== HELPERS ======
function qs(id){ return document.getElementById(id); }
function bindClick(ids, fn){ ids.forEach(id=>{ const el=qs(id); if (el) el.addEventListener('click', fn); }); }
function bindChange(ids, fn){ ids.forEach(id=>{ const el=qs(id); if (el) el.addEventListener('change', fn); }); }
function joinPath(a,b){ return (a.endsWith('/') ? a : a + '/') + b; }
function endsWithAny(str, arr){ return arr.some(s=>str && str.endsWith(s)); }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
function pyStr(s){ return '"' + String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'; }
function active(){ return (typeof mp === 'function') ? mp() : null; }
function isConnected(){
  if (typeof isEditorConnected === 'function') return !!isEditorConnected();
  const d = active(); return !!(d && (d.connected || d.isOpen || d.port || d.device));
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// for ondragover="allowDrop(event)" in filemanager.html
function allowDrop(e){ e.preventDefault(); }

// lock against parallel directory loads
function withDirLoadLock(fn){
  const prev = dirLoadLock; let release;
  dirLoadLock = new Promise(r=>release=r);
  return (async()=>{
    try{
      await prev;
      listingActive = true;
      return await fn();
    } finally {
      listingActive = false;
      release();
    }
  })();
}

// ====== LINK PROFILE BLE/USB (kept for compatibility with other UI parts) ======
function linkProfile(){
  if (getActiveLink() == 'ble') return { items:10, bytes:512, pauseMs:200};
  return { items:25, bytes:1024, pauseMs:5};
}


let ICON_UP = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAENklEQVR42p2WTWxUVRTH//fNR9vhTttpSwkfEogulI0L485oEBNTQxNXLmrUkLBS4mfjZ0JABGpAExokJSYS17oBwWAUhbgxGuPGFijETChlOm1npjN905n37nvv+L8zVRfaMOMkkztv3n3nd87/f86dUWjjpceXBSHgvpZWrT7T8kb98Yrs2GqwfUscF65EcN9qDdLSJn3UlcyAwaWRXiQEeP5yBb/9zEre77nr83fdoA+5kkx78s2ejLrHUVgyEeZDhZe/K+PmFCGHMup/A/SBZVHar53f09u1o8vBVDnElCvQCcCJKRy9VEH2moI7tjZkzRt6f1mky8fZvX14SDuYrIT4qUiPlSAIBN1JB/GY4NjFCuazhBzrVy0D9NtlqSc8fLkvg8e647jK4D8WI96hAVx8vmu+oKvDgRBy+mwJ5Vwc7okBdVeAfndJauLhzIsZDK9P4DpluVyIEIg04ptI4IXNdcUHutc5qAYhvriwhOpigpD1ak2AfqcsrqlhYl8fntmQwDQz/34xgm8E4gAhIYbB6wzuB7y2EK69nTGU+cX5r8owtRjc8Q3qXwD9RkmqXh2nXu/Ds5uSyC6HODsfYsUAHdS9vpq1BfirAFqBgJ1VZyW6S6FQDXDlXIkbKNfERvU3QB8uS9L3sP+FHoxsTqJKfacqEX5YCBAyUJzZe6zCBjZWJhvcfubqMoMYDQdBujuBIkv65RwrMZTrk0Gl9AdLIjGDoYeTGHpgHW7OGxQ8QQfbMMXIK+x7L5RGttFqFRbUuOa+/M07rMBBgFQjk9TGJFxKO32pjM5+DaUPlyQW+thEzYvM2mP2QSnCwH0JjO7S2NYJfH0rQMn6YD1gB5nQSsWgJFZuzCE77UXVZAdHIw6nnkCyLw7PDRCY2NpzkDlYkCPP6UabnrzhYYbwuGoaXWf6oePA0Jjq7TkUFjWyBze3Pgf2NfBRUUafSuGRPgenr3uYrQAxZQeN+pumwX6dLbtwC8uzA8iObWwP0D9WkJd2r8NOngKnrhssLFMb26qm2UmBKAR+iFohj5U/Upg5sbU9QO+RRdk7lMLj/TGcvOqhYCvAPx74HIyQAHOnCI+dOXv83vYAmQMLMmIr6HcwMUlAuSnRX7MQRgqGAP92nqtG/sM2K+h5b16eHk5hFyv4dNJHgRIp25p2DihTGNFknhn12TxUoLFwvF3AaF6eZAWPbojhs9/rKC9xszWZ7gZ2HuiBEGBycxBWUBrf3h4g/WpOntjNNt3i4MyvPkpLUfMwtcdDGEFYgW8lyuWRNGmUTm1rD6BfycnO4TQGU4JvJw0CTq1we2Sn2rap4lFtTZ7J0fw03HYBg2/mpP/BFGps/Br1dzi1hlMeBZz2aoiIwUOeXz4d1xxC9/P726xgJCu1QpGyqEb/C7Nm40NFQeNXjYcP7F8YewTpjgG4F/8b8CftPHDwwRULGgAAAABJRU5ErkJggg==";
let ICON_FOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAADtElEQVR42r1V3WtcRRT/nbvZjd0k/UgqNqIPimiRqrVQQitIkRIp6IOiYBGf/B/6YouKVCzSJimxKSLWmFQJptJigvhJ6YOiD1raICmtSW2bdDfZbJrdfJo7c3rm4969KVZrig53mHvnzpzfOb/fmTOE/7jR/wJwbiexDhngpbBBmvDQJ3xbTtDAi8T1Tz2P+uad4MUFB6IZVFWF4rc9KJ48jg2fLR+EfnkWvL6lFyvubQTm8tY4WIv7hNnhIZx7cxc2nVg+lfTTDvCGd7uRvWcFeK5k3AdCDUqlMD38O357ey+a+m8D4Idm8KMHulHTWA1emLL2oRUoCFA6P4jTe/ajqubvFPzraaoCtvSB6Pvt4M0HulDbmJEIBMCIoA2KgFSvwXwxjXB2CmRkIHYOmJGlK23pZGPSfBvLZhTnpgZP40Lv+6BvtoGb2j5G3bq0AFxzANFmeag6Gxuy8wnD8ZxxiJVQ6/UTesuXLuLntvdAXz4J3traiZWNBmDSR8CWJrvYbFbRN1cMRyDaA+jEdwCURkbx4+Eu0PEt4G3tH2HVupRocM1vhDckMStV8dxSJ2Oo3Ki8Eyq0DrBfE0gGTl4examObtCxJvD29g+x0gBYDQyfsmF+QgCnAQuq3JylTblu5tL1QoeoGUgWZOpkXtaEi5LhhOKVEZzs+BTUsxncfOgIVq/V0JNnxKCALJQTOnh65J0tFRGQ6Yvyy0SwKH6lEWRWg2ruFrw7MXHpMr7rOAo6ugm8o20f1mQvQs8WHd/+LDheQ3kig95zG4V2xg2g+WdoE0BDVxBkMDm3Cl93nQJ1bgQ/0/IW6uuuQk8X4s2x15FBjkBdBFon6EqsN53EqYmxGXzVPwr64BHwc60CUDsCXR7zmXAzSpQ8CYM6Etj9Zx9RIAkwkZ9Df99V0OGHwS+0vYGGmisCkLPscJR2OinsDZQsEdw449aQ6XImCmPzONGXA7WvB7/U+joaav+ALuVtAHG4CQNLKFHJCFTFuAcyERTGF/B5Xx7U8iD4ldY9aMgOQ5XHK4fIR6BjsZXTgBOUJL9j6rRN03EB6PlCAPbfD3754G7clR2CKuXiYucoSYh4U0qUTwSf0tJSctDyBQE4JgDv3Ad+9dBurM0MyfkejfNf61vgOzTvob9DOK6uUoqQy/2Jzl7RYN8D4MeefgKPb7wDaqYgGyjOf1c2uFKTTOUMXemwnrOvUze0VIrw68AMzg6WHeZeiSIM/6HO/5srR9bKjYvXLsh9sNyb6lbbdQUO3sO94PfiAAAAAElFTkSuQmCC";
let ICON_FILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAEQElEQVR42q2Wa2gcVRTH/3dmNpFo1LW1tQpVsPpBRYKCH3xBNVpFCD4o2BYrPip+KFWUSmuzSKXGVrRYFBGUNLVG66NBQY2SUgVtIKlpikhe3W7DZjfNJrvJZmdn532v585uYrYbog29szNzH7Pzu+f8zz13GOaUd9t+E4IzeD6HEAJgDArkje4MyJocKnVM2yYy2RxiSR2de19gWKCwcwFr77o1qIdCKgqGi5xVQN7yYNguJg0DU7oP03IQHTuLobMZ2CZbEFI2sOebo+LJe+uwclk4aAs6CgUHuuUjZ5rI6XmkDAcutftTaXSc6MOdN16PzqE4fn3rWXZeAN91YcIjgEozdmE5eVhkRYascjlHf2ISA/E41t99C9q6TuOveGpeSFlH06GjYsPqEsD3yQQOByosy4JpFKCbPrlLwPFdDCTS6IrGEFn/IHzHw57vOtE/Ml4BKWvsaj0inqq/rQRwIAVnigLLJ0tMFwXbg+OIwHm9sQR6h9N4e+N9SE7pGBweR3tvFD2x0TJIGeDNL46Ip++fAVjgXJWBBEGnSZFlkNie40MRPs6M5/Bjz+kAMJ3LI+8LxJNjaOuO4afjA+j7+GVWAYh83iGef+D2WQs4Lw7LEPVLECmwdJFBWnScHArGdV0gL5yg/uepUZxJjmPwk1cqAVubfxabH7ljVgNOYs48xEoQuUZytoDnOsVAsDhp5GIsa6CmRsOJ6Aj2/dCN4eatlYAtH34vXl17TwDwCOAQoKo0JkoPC9JkmqLJcVxwl7SREUagdNbCZZdWo+tUArsP/Y6Rz16rBGza2yoaNzxctADSFRzShhBdtDnPeb4Cm9swPBt2nsEVFgFMrLgijGODcfJEO0YPbqsErGtqEbufawgABs1OkAV0RTUljBD5yKc6p1RRJeseie6RBTb1ei4mcgWsWnEl/uiL45l9h5Fq3V4JaIh8Kj7Y/HgAyBgWVC6Cl2rkFpUpxXAinykqWUSC+HSa3IVHwk/oBm6+dhmO/T2Cx5oOYuLLHZWA1TuaRcuWRwPAZL4QOD6I+kBshhA5qppgjhQmBFwkgR4ja0mDnIkbrg7jZHQU9Y37kfmq8f8B5hbZVCmdqlIRjRXB9AsRdIIsXrnkYgrTBNY0HsDk14sBULuqSoNLM1YVjVyngVM6UVgxnSwJ16B7KIGHIgcwtRgAAgtUiiIC0BEiMaSXpAMdSidLay8A4N8cw0orEMGmZHIfV9VeguMEWHMhAHLWMoRZIL5MIz6uubx2YcBNL74v2ndunAWweQDyD5xE9SWCQlSlhaFpGkxKgsvDZEFJ5P8EpKZ1WqHFfuUciGlTIqTcxlSaP0WVRgtvqmCh7rrl6IkmUb99P7LfRioBS594Q/R89NLslrmYIveGuk3vIX14ZyWgtuF10d+ybdEvnymr1u2C9cs78wPk3RXSKeK8Xio/cxjlr5kyA/gHM7+cN0oReEMAAAAASUVORK5CYII=";


// Helper delay
function fm_delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ====== POPUP / DIALOGS ======
function bindCloseButtons(){
  const btn = qs('popup-close'); if (btn) btn.onclick = closePopup;
  const btns = qs('popup-buttons');
  if (btns && !btns.querySelector('#popup-close')){
    const label = fmT('fileManager.popup.close');
    btns.innerHTML = '<button id="popup-close" type="button" data-i18n="fileManager.popup.close">'+label+'</button>';
    btns.querySelector('#popup-close').onclick = closePopup;
  }
}
function showPopup(html){
  const cont = qs('popup-content'), ov = qs('popup-overlay');
  if (!cont || !ov) return;
  cont.innerHTML = html;
  ov.style.display='flex';
  bindCloseButtons();
  resetPopupTimer();
}
function showLoading(msg){
  popup_modal = false;
  const b = qs('popup-close'); if (b) b.style.display='none';
  const btns = qs('popup-buttons'); if (btns) btns.style.display='none';
  showPopup('<p>'+(msg||fmT('fileManager.popup.working'))+'</p>');
}
function showNotification(msg){
  popup_modal = true;
  const b = qs('popup-close'); if (b) b.style.display='block';
  const btns = qs('popup-buttons'); if (btns) btns.style.display='block';
  showPopup('<p style="color:green">'+msg+'</p>');
}
function showError(msg){
  popup_modal = true;
  const b = qs('popup-close'); if (b) b.style.display='block';
  const btns = qs('popup-buttons'); if (btns) btns.style.display='block';
  showPopup('<p style="color:red">'+msg+'</p>');
}
function closePopup(){
  const ov=qs('popup-overlay'); if (ov) ov.style.display='none';
  popup_modal=false;
  clearTimeout(popupTimer);
}
function resetPopupTimer(){ clearTimeout(popupTimer); popupTimer = setTimeout(closePopup, 8000); }

// ====== PROGRESS BAR #myProgress OVERLAY + PERCENT ======
let progressWatcher = null;
let myProgressSaved = null;

function setMyProgressVisible(on){
  const bar = qs('myProgress'); if (!bar) return;
  if (on){
    if (!myProgressSaved){
      myProgressSaved = {
        position: bar.style.position, zIndex: bar.style.zIndex,
        top: bar.style.top, left: bar.style.left, right: bar.style.right,
        filter: bar.style.filter, backdropFilter: bar.style.backdropFilter,
        pointerEvents: bar.style.pointerEvents, width: bar.style.width,
        opacity: bar.style.opacity, transform: bar.style.transform,
      };
    }
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '2147483647';
    bar.style.pointerEvents = 'none';
    bar.style.filter = 'none';
    bar.style.backdropFilter = 'none';
    bar.style.opacity = '1';
    bar.style.transform = 'none';
    if (!bar.style.width) bar.style.width = '0%';
  } else if (myProgressSaved){
    Object.assign(bar.style, myProgressSaved);
    myProgressSaved = null;
  }
}
function startProgressWatcher(){
  stopProgressWatcher();
  progressWatcher = setInterval(()=>{
    const bar = qs('myProgress');
    const sp  = document.getElementById('upload-pct');
    if (!bar || !sp) return;
    let pct = 0;
    const w = (bar.style && bar.style.width) ? bar.style.width.trim() : '';
    if (w.endsWith('%')) pct = Math.max(0, Math.min(100, parseFloat(w)));
    else {
      const parent = bar.parentElement;
      if (parent && parent.clientWidth > 0) pct = Math.round((bar.offsetWidth / parent.clientWidth) * 100);
    }
    sp.textContent = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
  }, 120);
}
function stopProgressWatcher(){ if (progressWatcher){ clearInterval(progressWatcher); progressWatcher=null; } }

function showUploadDialog(name, idx, total){
  clearTimeout(popupTimer);
  const cont = qs('popup-content'), ov = qs('popup-overlay'), btn = qs('popup-close'), btns = qs('popup-buttons');
  if (btn)  btn.style.display='none';
  if (btns) btns.style.display='none';
  if (cont && ov){
    const prefix = (total > 1) ? fmT('fileManager.upload.batchPrefix', { index: idx, total }) : '';
    const label = fmT('fileManager.upload.inProgress');
    const fileLabel = escapeHtml(name || fmT('fileManager.common.file'));
    cont.innerHTML = `<p>${label} ${prefix}<b>${fileLabel}</b> - <span id="upload-pct">0%</span></p>`;
    ov.style.display='flex';
  }
  setMyProgressVisible(true);
  const bar = qs('myProgress'); if (bar) bar.style.width = '0%';
  startProgressWatcher();
}
function finishBatchDialog(okList, failList){
  stopProgressWatcher();
  setMyProgressVisible(false);
  const okNames   = okList.map(x=>x.name);
  const failNames = failList.map(x=>`${x.name} (${x.err})`);
  if (failList.length){
    const summary = fmT('fileManager.upload.summaryError', { ok: okList.length, fail: failList.length });
    const okLabel = fmT('fileManager.upload.summaryOkLabel');
    const errLabel = fmT('fileManager.upload.summaryErrorLabel');
    showError(`${summary}<br><small>${okLabel}: ${escapeHtml(okNames.join(', '))}<br>${errLabel}: ${escapeHtml(failNames.join(', '))}</small>`);
  } else {
    const summary = fmT('fileManager.upload.summarySuccess', { ok: okList.length });
    showNotification(`${summary}<br><small>${escapeHtml(okNames.join(', '))}</small>`);
  }
}
function showDownloadDialog(name){
  clearTimeout(popupTimer);
  const cont = qs('popup-content'), ov = qs('popup-overlay'),
        btn = qs('popup-close'), btns = qs('popup-buttons');
  if (btn)  btn.style.display='none';
  if (btns) btns.style.display='none';
  if (cont && ov){
    const label = fmT('fileManager.download.inProgress');
    const fileLabel = escapeHtml(name || fmT('fileManager.common.file'));
    cont.innerHTML = `<p>${label} <b>${fileLabel}</b> - <span id="upload-pct">0%</span></p>`;
    ov.style.display='flex';
  }
  setMyProgressVisible(true);
  const bar = qs('myProgress'); if (bar) bar.style.width = '0%';
  startProgressWatcher();
}
function finishDownloadDialog(){
  stopProgressWatcher();
  setMyProgressVisible(false);
}

// ====== MEMORY STATUS ======
async function updateStatus(){
  if (replBusyCount > 0 || statusRunning || uploadingBatch || listingActive) return;
  statusRunning = true;
  try{
    await ensureImports();
    const st = await mpEvalJson('F.status()'); // {memoryFree, memoryTotal}
    const total = st.memoryTotal || 0;
    const free  = st.memoryFree  || 0;
    const used  = Math.max(0, total - free);
    const usedMB  = used  / (1024*1024);
    const totalMB = total / (1024*1024);
    const pctUsed = total ? (used / total * 100) : 0;
    updateMemoryBar(pctUsed);
    updateMemoryStatus(usedMB, totalMB, pctUsed);
    }catch(e){
      showError(String(e && e.message || e));
  } finally { statusRunning = false; }
}
function updateMemoryBar(pctUsed){
  const el = qs('progressbar'); if (!el) return;
  const p = Math.max(0, Math.min(100, pctUsed));
  el.style.width = p.toFixed(1) + '%';
  const hue = 120 - p * 1.2; // 120..0 green->red
  el.style.backgroundColor = `hsl(${hue}, 75%, 62%)`;
  el.title = fmT('fileManager.status.usedTitle', { pct: p.toFixed(1) });
}
function updateMemoryStatus(usedMB, totalMB, pctUsed){
  const el = qs('memory-status'); if (!el) return;
  el.textContent = fmT('fileManager.status.usedSummary', {
    used: usedMB.toFixed(3),
    total: totalMB.toFixed(3),
    pct: pctUsed.toFixed(1)
  });
}

// ====== DND / INPUT ======
async function handleDrop(e){
  e.preventDefault();
  // hard status lock, same as upload via button
  if (uploadingBatch || statusRunning) return;
  uploadingBatch = true;
  statusRunning  = true;
  try{
    const items = e.dataTransfer.items;
    if (!items || !items.length) return;
    const lists = [];
    for (let i=0;i<items.length;i++){
      const it = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (it) lists.push(listAllEntries(it, currentPath));
    }
    const nested = await Promise.all(lists);
    const flat = nested.flat();
    if (!flat.length) return;
    await uploadBatch(flat);              // same path as the button
    await loadDirectoryContents(currentPath);
  } finally {
    uploadingBatch = false;
    statusRunning  = false;
  }
}


function handleFileInputChange(e){
  const files = Array.from(e.target.files||[]);
  if (!files.length) return;
  processFilesAndDirs(files, currentPath);
}
function processFilesAndDirs(files, base){
  const tree = {};
  for (const f of files){
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    let lvl = tree;
    for (let i=0;i<parts.length;i++){
      if (i===parts.length-1){ (lvl._files||(lvl._files=[])).push(f); }
      else { lvl = (lvl[parts[i]]||(lvl[parts[i]]={})); }
    }
  }
  const list = buildUploadList(tree, base);
  if (!list.length) return;
  uploadBatch(list).then(()=> loadDirectoryContents(currentPath))
                   .catch(err=> showError(fmT('fileManager.errors.uploadFailed', { error: String(err) })));
}
function buildUploadList(struct, base, out=[]){
  for (const k in struct){
    if (k==='_files'){ for (const f of struct._files) out.push({file:f, path: joinPath(base, f.name)}); }
    else buildUploadList(struct[k], joinPath(base, k), out);
  }
  return out;
}
function readAllDirectoryEntries(r){
  const out = [];
  return new Promise((resolve,reject)=>{
    function next(){
      r.readEntries(res=>{
        if (res.length){ out.push(...res); next(); }
        else resolve(out);
      }, reject);
    }
    next();
  });
}
async function listAllEntries(entry, base){
  if (entry.isFile){
    const file = await new Promise((res,rej)=> entry.file(res, rej));
    return [{file, path: joinPath(base, file.name)}];
  }
  if (entry.isDirectory){
    const path = joinPath(base, entry.name);
    const r = entry.createReader();
    const children = await readAllDirectoryEntries(r);
    const lists = await Promise.all(children.map(ch=> listAllEntries(ch, path)));
    return lists.flat();
  }
  return [];
}

// ====== FS OPERATIONS (REPL) ======

// BATCH UPLOAD
async function uploadBatch(list){
  uploadingBatch = true;
  const ok=[], fail=[];
  for (let i=0;i<list.length;i++){
    const {file, path} = list[i];
    showUploadDialog(file.name, i+1, list.length);
    try{
      await sendOneFile(file, path);
      ok.push({name:file.name});
    }catch(e){
      fail.push({name:file.name, err: String(e&&e.message||e)});
    }
  }
  uploadingBatch = false;
  finishBatchDialog(ok, fail);
}

// Send file via dev.sendFile
async function sendOneFile(file, dst){
  const dev = active(); 
  if (!dev) return showError(fmT('fileManager.errors.notConnected'));

  const prevMute = !!dev.mute_terminal;
  try {
    dev.mute_terminal = true;
    await fm_delay(25);

    const buf = await file.arrayBuffer();
    await dev.sendFile(dst, new Uint8Array(buf), false);

    await fm_delay(150);
  } finally {
    dev.mute_terminal = prevMute;
  }
}

// ====== DOWNLOAD via fm_down (Base64 rows) ======
async function doDownload(path){
  const dev = active(); if (!dev) return showError(fmT('fileManager.errors.notConnected'));
  uploadingBatch = true; statusRunning = true;

  // dialog with progress
  const nameGuess = (path.split('/').pop() || 'download.bin');
  showDownloadDialog(nameGuess);

  // progress helper
  const bar = qs('myProgress');
  const setProg = (pct)=>{ if (bar) bar.style.width = Math.max(0, Math.min(100, pct|0)) + '%'; };

  // profile by link
  let chunk, pause;
  if (getActiveLink() === 'ble') { chunk = 120;  pause = 60; }
  else                           { chunk = 384; pause = 1;  }

  const parts = [];
  let gotLen = 0;

  function flushRx(){ try{ fmPull(dev); }catch{} }
  function acc(){ fmAccumulate(dev); }
  function b64toU8(s){ const bin=atob(s); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }

  function parseHeader(payload){
    const semi = payload.indexOf(';');
    if (semi < 0) throw new Error(fmT('fileManager.errors.invalidHeader'));
    const namePart = payload.slice(0, semi);
    const sizeStr = payload.slice(semi + 1);
    const size = parseInt(sizeStr, 10);
    if (!Number.isFinite(size)) throw new Error(fmT('fileManager.errors.invalidSize'));
    return { name: fmDecodePct(namePart), size };
  }

  function failFrame(frame){
    if (frame.error === 'crc') throw new Error(fmT('fileManager.errors.frameCrc'));
    throw new Error(fmT('fileManager.errors.frameLength'));
  }

  await withReplLock(async ()=>{
    beginCapture(dev);
    try{
      // reset and start
      flushRx();
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);

      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_down(${pyStr(path)}, ${chunk}, ${pause})`);

      // HEADER
      const t0=Date.now(), T_HDR=15000; let header=null;
      while ((Date.now()-t0)<T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback')>=0 || __fmAcc.indexOf('NameError')>=0) throw new Error(fmT('fileManager.errors.replError', { error: __fmAcc.slice(0,200) }));
        const frame = fmConsumeFrame();
        if (frame){
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'DLR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'DLH'){ header = parseHeader(frame.payload); break; }
        }
        await delay(30);
      }
      if (!header) throw new Error(fmT('fileManager.errors.headerTimeout'));

      const expectSize = header.size;
      const baseName = (header.name || path).split('/').pop() || 'download.bin';
      setProg(0);

      const linesEst=Math.max(1, Math.ceil(expectSize/Math.max(1,chunk)));
      const T_DATA=20000 + linesEst*(pause+80); const t1=Date.now();
      let lastTick=0, lastPct=-1;

      while (true){
        acc();
        const frame = fmConsumeFrame();
        if (frame){
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'DLR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'DLC'){
            const u8 = b64toU8(frame.payload);
            parts.push(u8); gotLen += u8.length;
            if (expectSize>0){
              const now=Date.now(); const pct=(gotLen*100)/expectSize;
              if ((now-lastTick)>80 && ((pct|0)!==lastPct)){ setProg(pct); lastTick=now; lastPct=pct|0; }
            }
          } else if (frame.type === 'DLD') {
            break;
          }
        }
        if ((Date.now()-t1)>T_DATA) throw new Error(fmT('fileManager.errors.dataTimeout'));
        await delay(Math.max(10, Math.min(60, pause||10)));
      }

      if (gotLen !== expectSize) throw new Error(fmT('fileManager.errors.sizeMismatch', { expected: expectSize, got: gotLen }));

      const blob = new Blob(parts, {type:'application/octet-stream'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = baseName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 10000);

      setProg(100);
      finishDownloadDialog();
      showNotification(fmT('fileManager.download.completed', { name: baseName, size: gotLen }));
    } finally {
      endCapture(dev);
    }
  }).catch(e=>{ finishDownloadDialog(); showError(String(e)); })
    .finally(()=>{ statusRunning = false; uploadingBatch = false; });
}


// GZIP decompression in the browser
async function gunzipBytes(u8){
  if (!('DecompressionStream' in window)) throw new Error(fmT('fileManager.errors.gzipUnsupported'));
  const ds = new DecompressionStream('gzip');
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const resp = new Response(new Blob([ab]).stream().pipeThrough(ds));
  return new Uint8Array(await resp.arrayBuffer());
}


// ====== DOWNLOAD to memory via fm_down (Base64 rows) ======
// Same logic as doDownload(), but returns bytes + metadata instead of saving to PC.
// Returns: { name, size, bytes: Uint8Array }
async function doDownloadToMemory(path){
  const dev = active(); if (!dev) throw new Error(fmT('fileManager.errors.notConnected'));
  uploadingBatch = true; statusRunning = true;

  // Progress bar reused for visuals only
  const nameGuess = (path.split('/').pop() || 'download.bin');
  showDownloadDialog(nameGuess);                 // same UI as doDownload()
  const bar = qs('myProgress');
  const setProg = (pct)=>{ if (bar) bar.style.width = Math.max(0, Math.min(100, pct|0)) + '%'; };

  // Profile by link - identical to doDownload()
  let chunk, pause;
  if (getActiveLink() === 'ble') { chunk = 120;  pause = 60; }
  else                           { chunk = 384;  pause = 1;   }

  const parts = [];
  let gotLen = 0;

  function flushRx(){ try{ fmPull(dev); }catch{} }
  function acc(){ fmAccumulate(dev); }
  function b64toU8(s){ const bin=atob(s); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }

  function parseHeader(payload){
    const semi = payload.indexOf(';');
    if (semi < 0) throw new Error(fmT('fileManager.errors.invalidHeader'));
    const namePart = payload.slice(0, semi);
    const sizeStr = payload.slice(semi + 1);
    const size = parseInt(sizeStr, 10);
    if (!Number.isFinite(size)) throw new Error(fmT('fileManager.errors.invalidSize'));
    return { name: fmDecodePct(namePart), size };
  }

  function failFrame(frame){
    if (frame.error === 'crc') throw new Error(fmT('fileManager.errors.frameCrc'));
    throw new Error(fmT('fileManager.errors.frameLength'));
  }

  return await withReplLock(async ()=>{
    beginCapture(dev);
    try{
      // Reset and start - identical to doDownload()
      flushRx();
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);

      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_down(${pyStr(path)}, ${chunk}, ${pause})`);

      // HEADER
      const t0=Date.now(), T_HDR=15000; let header=null;
      while ((Date.now()-t0)<T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback')>=0 || __fmAcc.indexOf('NameError')>=0) throw new Error(fmT('fileManager.errors.replError', { error: __fmAcc.slice(0,200) }));
        const frame = fmConsumeFrame();
        if (frame){
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'DLR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'DLH'){ header = parseHeader(frame.payload); break; }
        }
        await delay(30);
      }
      if (!header) throw new Error(fmT('fileManager.errors.headerTimeout'));

      const expectSize = header.size;
      const baseName = (header.name || path).split('/').pop() || 'download.bin';
      setProg(0);

      // DATA frames (Base64)
      const linesEst=Math.max(1, Math.ceil(expectSize/Math.max(1,chunk)));
      const T_DATA=20000 + linesEst*(pause+80); const t1=Date.now();
      let lastTick=0, lastPct=-1;

      while (true){
        acc();
        const frame = fmConsumeFrame();
        if (frame){
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'DLR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'DLC'){
            const u8 = b64toU8(frame.payload);
            parts.push(u8); gotLen += u8.length;
            if (expectSize>0){
              const now=Date.now(); const pct=(gotLen*100)/expectSize;
              if ((now-lastTick)>80 && ((pct|0)!==lastPct)){ setProg(pct); lastTick=now; lastPct=pct|0; }
            }
          } else if (frame.type === 'DLD') {
            break;
          }
        }
        if ((Date.now()-t1)>T_DATA) throw new Error(fmT('fileManager.errors.dataTimeout'));
        await delay(Math.max(10, Math.min(60, pause||10)));
      }

      if (gotLen !== expectSize) throw new Error(fmT('fileManager.errors.sizeMismatch', { expected: expectSize, got: gotLen }));

      // Merge into output Uint8Array
      const out = new Uint8Array(expectSize);
      let off = 0;
      for (const p of parts){ out.set(p, off); off += p.length; }

      // Hide progress overlay (same behavior as after download completes)
      try { closeDownloadDialog && closeDownloadDialog(); } catch(_){}
      finishDownloadDialog()
      return { name: baseName, size: expectSize, bytes: out };
    } finally {
      endCapture(dev);            // restore terminal
      uploadingBatch = false;     // allow status polling
      statusRunning = false;
      finishDownloadDialog()
    }
  });
}










// ====== LISTING (framed stream) ======
async function fetchDirPaged(path){
  const dev = active(); if (!dev) throw new Error(fmT('fileManager.errors.notConnected'));

  // shorter pause for USB, longer for BLE
  let pause;
  if (getActiveLink() === 'ble') { pause = 35; }
  else                           { pause = 1;  }

  function acc(){ fmAccumulate(dev); } // append into __fmAcc

  function parseEntry(payload, basePath, out){
    const k = payload.split(';');
    if (k.length < 3) return;
    const name = fmDecodePct(k[0]);
    const sz = parseInt(k[1], 10);
    const isD = (k[2] === 'D');
    const size = Number.isFinite(sz) ? sz : 0;
    const full = (basePath.endsWith('/') ? basePath : basePath + '/') + name;
    out.push({
      name,
      path: full,
      size: isD ? 0 : size,
      isDirectory: isD,
      extension: isD ? "" : (name.includes('.') ? name.split('.').pop() : ""),
      icon: isD ? "dir" : "file"
    });
  }

  function failFrame(frame){
    if (frame.error === 'crc') throw new Error(fmT('fileManager.errors.frameCrc'));
    throw new Error(fmT('fileManager.errors.frameLength'));
  }

  return withReplLock(async ()=>{
    beginCapture(dev); // mute terminal + clear __fmAcc
    try{
      // soft reset input
      fmPull(dev);
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);

      acc();
      __fmAcc = "";
      // start listing on the ESP
      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_list(${pyStr(path)}, ${pause})`);

      // 1) header
      const T_HDR = 15000;
      const t0 = Date.now();
      let header = null;
      while ((Date.now() - t0) < T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback') >= 0) throw new Error(fmT('fileManager.errors.replTraceback'));
        const frame = fmConsumeFrame();
        if (frame){
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'LSR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'LSTH'){ header = { path: fmDecodePct(frame.payload) }; break; }
        }
        await delay(25);
      }
      if (!header) throw new Error(fmT('fileManager.errors.headerTimeout'));

      const basePath = header.path || path || '/';
      const out = [];
      let lastDataTs = Date.now();
      const HARD = 60000;  // hard limit
      const IDLE = 4000;   // no new data >4s -> timeout
      const t1 = Date.now();

      // 2) stream rows until end
      while (true){
        acc();
        const frame = fmConsumeFrame();
        if (frame){
          lastDataTs = Date.now();
          if (frame.type === 'ERR') failFrame(frame);
          if (frame.type === 'LSR') throw new Error(fmDecodePct(frame.payload));
          if (frame.type === 'LSTE') parseEntry(frame.payload, basePath, out);
          if (frame.type === 'LSTD') break;
        }

        const now = Date.now();
        if ((now - lastDataTs) > IDLE) throw new Error(fmT('fileManager.errors.listingTimeout'));
        if ((now - t1) > HARD) throw new Error(fmT('fileManager.errors.listingTooLong'));
        await delay(30);
      }

      // 3) done
      return { path: basePath, contents: out };
    } finally {
      endCapture(dev); // restore terminal
    }
  });
}

// ====== TABLE RENDER ======
async function loadDirectoryContents(path){
  return withDirLoadLock(async ()=>{
    // always clear selection so items don't carry across paths
    clearSelection();

    // helper to manage selection without duplicates
    function setSelected(path, on){
      if (!Array.isArray(selectedFiles)) selectedFiles = [];
      const i = selectedFiles.indexOf(path);
      if (on && i === -1) selectedFiles.push(path);
      if (!on && i !== -1) selectedFiles.splice(i, 1);
    }

    currentPath = path || '/';
    updateBreadcrumb();

    const ov = qs('popup-overlay');
    if (ov && ov.style.display === 'none') showLoading(fmT('fileManager.popup.loading'));

    try{
      const data = await fetchDirPaged(currentPath);

      const clean = (data.contents || []).filter(f =>
        f && f.name !== '..' && !/\/\.\.$/.test(f.path || '') && (f.icon !== 'up')
      );

      const tbl = (qs('file-table')||document).querySelector('tbody');
      if (!tbl) return;
      tbl.innerHTML='';

      if (currentPath !== '/'){
        const tr=document.createElement('tr');
        const td1=document.createElement('td');
        const td2=document.createElement('td'); td2.style.cursor='pointer';
        const img=document.createElement('img'); img.className='file-icon'; img.src=ICON_UP;
        td2.appendChild(img); td2.appendChild(document.createTextNode(' ..'));
        td2.onclick = ()=> loadDirectoryContents(currentPath.substring(0, currentPath.lastIndexOf('/')) || '/');
        const td3=document.createElement('td');
        tr.append(td1,td2,td3); tbl.appendChild(tr);
      }

      const dirs  = clean.filter(f=>f.isDirectory).sort((a,b)=>a.name.localeCompare(b.name));
      const files = clean.filter(f=>!f.isDirectory).sort((a,b)=>a.name.localeCompare(b.name));
      const list  = dirs.concat(files);

      list.forEach(file=>{
        const tr=document.createElement('tr');

        // --- selection with a larger hitbox ---
        const tdSel=document.createElement('td');
        tdSel.className = 'fm-col-sel';

        const lbl=document.createElement('label');
        lbl.className = 'fm-chk-wrap';
        lbl.dataset.i18nTitle = 'fileManager.popup.selectItem';
        lbl.title = fmT('fileManager.popup.selectItem');

        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.className='fm-chk';
        cb.checked = selectedFiles.includes(file.path);

        // larger click area; style .fm-chk-hit in CSS
        const hit=document.createElement('span');
        hit.className='fm-chk-hit';

        // don't propagate to clickable row cells
        cb.addEventListener('click', (e)=> e.stopPropagation());
        lbl.addEventListener('click', (e)=> e.stopPropagation());

        cb.addEventListener('change', ()=>{
          setSelected(file.path, cb.checked);
        });

        lbl.append(cb, hit);
        tdSel.appendChild(lbl);

        // --- name and icon ---
        const tdName=document.createElement('td');
        const icon=document.createElement('img'); icon.className='file-icon';
        icon.src = file.isDirectory ? ICON_FOLDER : ICON_FILE;
        tdName.appendChild(icon);
        tdName.appendChild(document.createTextNode(' '+file.name));

        if (file.isDirectory){
          tdName.style.cursor='pointer';
          tdName.onclick = ()=> loadDirectoryContents(file.path);
        } else {
          const blk=[".xml.gz",".xml",".blk.gz",".blk"], txt=[".cfg",".py",".txt",".csv",".html",".htm",".js",".css"];
          if (endsWithAny(file.path, blk)) tdName.onclick=()=> open_block_editor(file.path);
          else if (endsWithAny(file.path, txt)) tdName.onclick=()=> open_text_editor(file.path);
          tdName.style.cursor='pointer';
        }

        // --- size ---
        const tdSize=document.createElement('td');
        tdSize.textContent = file.isDirectory ? '-' : (file.size + ' B');

        tr.append(tdSel,tdName,tdSize);
        tbl.appendChild(tr);
      });

      if (!popup_modal) closePopup();
    }catch(e){
      showError(String(e && e.message || e));
    }
  });
}


function updateBreadcrumb(){
  const el = qs('breadcrumb'); if (!el) return;
  el.innerHTML='';
  const parts = currentPath.split('/').filter(Boolean);
  const root=document.createElement('a'); root.href='javascript:loadDirectoryContents("/")'; root.textContent=' / ';
  el.appendChild(root);
  let acc='';
  parts.forEach((p,i)=>{
    acc += '/'+p;
    const a=document.createElement('a'); a.href='javascript:loadDirectoryContents("'+acc+'")'; a.textContent=p;
    el.appendChild(a);
    if (i<parts.length-1) el.appendChild(document.createTextNode(' / '));
  });
}

// ====== BULK OPERATIONS ======
function downloadFiles(){
  if (!selectedFiles.length){ showError(fmT('fileManager.errors.noSelection')); return; }
  (async ()=>{ for (const p of selectedFiles) await doDownload(p); })()
    .then(()=> clearSelection())
    .catch(e=> showError(String(e)));
}
async function moveTo(){
  if (!selectedFiles.length){ showError(fmT('fileManager.errors.nothingSelected')); return; }
  const dest = await askText(fmT('fileManager.prompts.destinationFolder')); if (!dest) return;
  showLoading(fmT('fileManager.dialogs.moving'));
  (async ()=>{
    await ensureImports();
    const arr = '[' + selectedFiles.map(p=>pyStr(p)).join(',') + ']';
    return mpEvalJson('F.move(' + arr + ',' + pyStr(dest) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'move'); loadDirectoryContents(currentPath); clearSelection(); showNotification(fmT('fileManager.dialogs.moved')); })
    .catch(e=> showError(fmT('fileManager.errors.errorPrefix', { error: String(e) })));
}
async function new_Folder(){
  const name = await askText(fmT('fileManager.prompts.folderName')); if (!name) return;
  const p = joinPath(currentPath, name).replace(/\/\//g,'/');
  (async ()=>{
    await ensureImports();
    return mpEvalJson('F.mkdir(' + pyStr(p) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'mkdir'); loadDirectoryContents(currentPath); clearSelection(); showNotification(fmT('fileManager.dialogs.created')); })
    .catch(e=> showError(fmT('fileManager.errors.errorPrefix', { error: String(e) })));
}
async function copyTo(){
  if (!selectedFiles.length){ showError(fmT('fileManager.errors.nothingSelected')); return; }
  const dest = await askText(fmT('fileManager.prompts.destinationFolder')); if (!dest) return;
  showLoading(fmT('fileManager.dialogs.copying'));
  (async ()=>{
    await ensureImports();
    const arr = '[' + selectedFiles.map(p=>pyStr(p)).join(',') + ']';
    return mpEvalJson('F.copy(' + arr + ',' + pyStr(dest) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'copy'); loadDirectoryContents(currentPath); clearSelection(); showNotification(fmT('fileManager.dialogs.copied')); })
    .catch(e=> showError(fmT('fileManager.errors.errorPrefix', { error: String(e) })));
}
async function renameFile(){
  if (selectedFiles.length !== 1){ await info(fmT('fileManager.errors.selectOne')); return; }
  const base = selectedFiles[0].split('/').pop();
  const newName = await askText(fmT('fileManager.prompts.newName'), base);
  if (!newName) return;
  const newPath = joinPath(currentPath, newName).replace(/\/\//g,'/');
  showLoading(fmT('fileManager.dialogs.renaming'));
  (async ()=>{
    await ensureImports();
    return mpEvalJson('F.rename(' + pyStr(selectedFiles[0]) + ',' + pyStr(newPath) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'rename'); loadDirectoryContents(currentPath); clearSelection(); showNotification(fmT('fileManager.dialogs.renamed')); })
    .catch(e=> showError(fmT('fileManager.errors.errorPrefix', { error: String(e) })));
}

// Delete selected items without JSON. One path = one REPL run.
// Uses fm_rpc.delete_path() (see patch below). Fallback to F._rmtree().
async function deleteFiles(){
  if (!selectedFiles.length){ showError(fmT('fileManager.errors.nothingSelected')); return; }
  showLoading(fmT('fileManager.dialogs.deleting'));
  uploadingBatch = true;            // disables status polling, no Ctrl+C
  try{
    await ensureImports();          // import fm_rpc as F
    const targets = [...selectedFiles];
    for (const p of targets){
      await deleteOnePath(p);
    }
    await loadDirectoryContents(currentPath);
    clearSelection();
    showNotification(fmT('fileManager.dialogs.deleted'));
  }catch(e){
    showError(fmT('fileManager.errors.errorPrefix', { error: String(e && e.message || e) }));
  }finally{
    uploadingBatch = false;
  }
}

// One path = one REPL run; waits for <<FM>>OK<<END>>
async function deleteOnePath(path){
  if (!path || path === '/') throw new Error(fmT('fileManager.errors.deleteRoot'));

  const lines = [
    'import fm_rpc as F',
    `F.delete_all(${pyStr(path)})`
  ];
  // mpExecOk: sends ^C, mutes terminal, runs 'lines', and adds print('<<FM>>OK<<END>>')
  await mpExecOk(lines);
}

















function clearSelection(){
  selectedFiles = [];
  const root = qs('file-table')||document;
  root.querySelectorAll('input[type="checkbox"]').forEach(cb=> cb.checked=false);
}

// ====== REPL CORE + FM BUFFER ======
function withReplLock(fn){
  const prev = __lock; let release;
  __lock = new Promise(r=>release=r);
  return (async()=>{
    try{
      await prev;
      replBusyCount++;
      return await fn();
    } finally {
      replBusyCount = Math.max(0, replBusyCount-1);
      release();
    }
  })();
}

// Read from transport FM buffer
function fmPull(dev){
  if (dev && typeof dev.fmTakeAll === 'function') return dev.fmTakeAll();
  const s = (dev && dev.rawResponseBuffer) || "";
  if (dev) dev.rawResponseBuffer = "";
  return s;
}
function fmAccumulate(dev){ const s = fmPull(dev); if (s) __fmAcc += s; }

const FM_FRAME_START = "<<FMF>>";
const FM_FRAME_END = "<<FMF_END>>";

function fmParseHex(value){
  if (!value) return null;
  const n = parseInt(value, 16);
  return Number.isFinite(n) ? (n >>> 0) : null;
}

function fmCrc32Ascii(str){
  let crc = 0xFFFFFFFF;
  for (let i=0;i<str.length;i++){
    let c = str.charCodeAt(i) & 0xFF;
    crc ^= c;
    for (let j=0;j<8;j++){
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc = crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function fmReadLine(buf, start){
  const idx = buf.indexOf('\n', start);
  if (idx < 0) return null;
  let line = buf.slice(start, idx);
  if (line.endsWith('\r')) line = line.slice(0, -1);
  return { line, next: idx + 1 };
}

function fmConsumeFrame(){
  const start = __fmAcc.indexOf(FM_FRAME_START);
  if (start < 0) {
    if (__fmAcc.length > 200000) __fmAcc = __fmAcc.slice(-200000);
    return null;
  }
  if (start > 0) __fmAcc = __fmAcc.slice(start);
  const header = fmReadLine(__fmAcc, 0);
  if (!header) return null;
  const line = header.line.trim();
  if (!line.startsWith(FM_FRAME_START)) {
    __fmAcc = __fmAcc.slice(header.next);
    return null;
  }
  const parts = line.slice(FM_FRAME_START.length).split('|');
  if (parts.length < 3) {
    __fmAcc = __fmAcc.slice(header.next);
    return null;
  }
  const type = parts[0];
  const len = fmParseHex(parts[1]);
  const crc = fmParseHex(parts[2]);
  if (len === null || crc === null) {
    __fmAcc = __fmAcc.slice(header.next);
    return null;
  }
  const payload = fmReadLine(__fmAcc, header.next);
  if (!payload) return null;
  const endLine = fmReadLine(__fmAcc, payload.next);
  if (!endLine) return null;
  if (endLine.line.trim() !== FM_FRAME_END) {
    __fmAcc = __fmAcc.slice(payload.next);
    return null;
  }
  __fmAcc = __fmAcc.slice(endLine.next);
  if (payload.line.length !== len) {
    return { type: "ERR", error: "len", want: len, got: payload.line.length };
  }
  const crcNow = fmCrc32Ascii(payload.line);
  if ((crcNow >>> 0) !== (crc >>> 0)) {
    return { type: "ERR", error: "crc" };
  }
  return { type, payload: payload.line };
}

function fmDecodePct(value){
  try { return decodeURIComponent(value); } catch { return value; }
}

function beginCapture(dev){
  dev.__fm_save = { mute: !!dev.mute_terminal };
  dev.mute_terminal = true;
  __fmAcc = ""; // clean accumulator for new command
}
function endCapture(dev){
  const s = dev.__fm_save || {};
  dev.mute_terminal = !!s.mute;
  dev.__fm_save = null;
}

// Consume tagged outputs for JSON/OK
function consumeJson(dev){
  fmAccumulate(dev);
  const a = __fmAcc.indexOf("<<FM>>{"); if (a < 0) return null;
  const b = __fmAcc.indexOf("}<<END>>", a); if (b < 0) return null;
  const js = __fmAcc.slice(a+6, b+1);
  try { const o = JSON.parse(js); __fmAcc = __fmAcc.slice(b+8); return o; }
  catch { return null; }
}
function consumeOk(dev){
  fmAccumulate(dev);
  const tag="<<FM>>OK<<END>>"; const i = __fmAcc.indexOf(tag);
  if (i>=0){ __fmAcc = __fmAcc.slice(i+tag.length); return true; }
  return false;
}

// One-time imports for ujson/fm_rpc
async function ensureImports(){
  if (__importsReady) return;
  await mpExecOk(['import ujson as json', 'import fm_rpc as F']);
  __importsReady = true;
}

// Eval JSON expression with tag
async function mpEvalJson(expr){
  return withReplLock(async ()=>{
    const dev = active(); if (!dev) throw new Error('no transport');
    beginCapture(dev);
    try{
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);
      await dev.sendCommand("import ujson as json");
      await dev.sendCommand("print('<<FM>>'+json.dumps(" + expr + ")+'<<END>>')");
      const t0 = Date.now(), limit = 25000; let pinged = false;
      while (Date.now() - t0 < limit){
        const o = consumeJson(dev); if (o) return o;
        if (!pinged && Date.now() - t0 > 10000){ pinged = true; await dev.sendData('\r'); }
        await delay(50);
      }
      throw new Error('timeout');
    } finally { endCapture(dev); }
  });
}

// Generic line execution with OK confirmation
async function mpExecOk(lines){
  return withReplLock(async ()=>{
    const dev = active(); if (!dev) throw new Error('no transport');
    const code = Array.isArray(lines) ? lines.join('\n') : String(lines||'');
    beginCapture(dev);
    try{
      await dev.sendData("\x03"); await delay(150);
      await dev.sendData("\r\n"); await delay(30);
      
      if (getActiveLink && getActiveLink() === 'ble') {
        await delay(60);
        await dev.sendCommand("clear_stop()");
        await delay(60);
      }
      
      for (const ln of code.split(/\n/)){ if (ln.trim()) await dev.sendCommand(ln); }
      await dev.sendCommand("print('<<FM>>OK<<END>>')");
      const t0 = Date.now();
      while (Date.now() - t0 < 10000){ if (consumeOk(dev)) return true; await delay(50); }
      throw new Error('timeout');
    } finally { endCapture(dev); }
  });
}


// ====== EDITOR HOOKS ======
async function open_block_editor(filename){
  if (!(await dlgConfirm(fmT('fileManager.confirm.openBlocks', { file: filename })))) return;
  try{
    showLoading(fmT('fileManager.popup.loadingFile', { file: filename }));
    const { bytes } = await doDownloadToMemory(filename);   // respects the REPL lock and chunking
    let xmlText;

    if (/\.xml\.gz$/i.test(filename)){
      const gunz = await gunzipBytes(bytes);
      xmlText = new TextDecoder('utf-8').decode(gunz);
    } else {
      xmlText = new TextDecoder('utf-8').decode(bytes);
    }

    if (typeof window.__espideFM_openBlocksFromString === 'function'){
      await window.__espideFM_openBlocksFromString(xmlText, filename);
      if (typeof closeFM === 'function') closeFM();
    } else {
      alert(fmT('fileManager.errors.loaderBlocksMissing'));
    }
  } catch(e){
    showError(String(e && e.message || e));
  } finally {
    closePopup();
  }
  switchUITo("blocks")
}

async function open_text_editor(filename){
  if (!(await dlgConfirm(fmT('fileManager.confirm.openText', { file: filename })))) return;
  try{
    showLoading(fmT('fileManager.popup.loadingFile', { file: filename }));
    const { bytes } = await doDownloadToMemory(filename);   // respects the REPL lock and chunking
    const text = new TextDecoder('utf-8').decode(bytes);

    if (typeof window.__espideFM_openTextTab === 'function'){
      window.__espideFM_openTextTab(filename, text);
      if (typeof closeFM === 'function') closeFM();
    } else {
      await info(fmT('fileManager.errors.loaderTextMissing'));
    }
  } catch(e){
    showError(String(e && e.message || e));
  } finally {
    closePopup();
  }
  switchUITo("text")
}

// Hard cleanup of REPL state when closing File Manager
function fmForceCleanup(){
  try {
    const dev = active();
    if (dev) {
      // always unmute terminal and clear any saved capture state
      endCapture(dev);
      dev.mute_terminal = false;
      if (dev.__fm_save) dev.__fm_save = null;
      
    }
  } catch(e) {
    console.warn('fmForceCleanup mute reset failed', e);
  }
}

// expose from index.html
window.fmForceCleanup = fmForceCleanup;
