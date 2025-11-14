// File Manager přes REPL s vlastním RX bufferem (fm_in_buffer) v transportechn.
// Bez RAW REPL. Příkazy běží v klasickém REPL s umlčeným terminálem.
// Funkce: streamovaný listing, multi-upload s dialogem, download přes fm_down,
// průběh a stav paměti, zámky proti souběhu.


// === SweetAlert2 dialog helpers (aligned with index.html) ===
async function dlgConfirm(message){
  const r = await Swal.fire({
    icon: 'question',
    title: message,
    showCancelButton: true,
    confirmButtonText: 'Ano',
    cancelButtonText: 'Ne'
  });
  return r.isConfirmed;
}
function info(message, text=''){
  return Swal.fire({ icon:'info', title: message, text, confirmButtonText: 'OK' });
}
function errorDlg(message, text=''){
  return Swal.fire({ icon:'error', title: message, text, confirmButtonText: 'OK' });
}
// ====== STAV A BOOT ======
let currentPath = '/';
let selectedFiles = [];
let popup_modal = false;
let popupTimer = null;
let __fmAcc = "";                 // akumulátor dat File Manageru
let __fm_inited = false;
let __statusTimer = null;
let statusRunning = false;
let uploadingBatch = false;       // blokuje status dotazy během uploadu/downloadu
let listingActive = false;        // blokuje status během listingu
let __importsReady = false;       // ujson/fm_rpc připraveny
let __lock = Promise.resolve();   // REPL sériový zámek
let replBusyCount = 0;
let dirLoadLock = Promise.resolve();

// Public API: otevři FM a načti adresář (volá index.html)
window.fmOpen = async function(path = '/'){
  if (!__fm_inited) __init();
  // FM aktivní → vypni globální DnD z index.html
  try { window.__FM_ACTIVE = true; } catch(_){}
  if (!isConnected()){
    showError('Zařízení není připojeno.');
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
}

if (!__fm_inited) __init();

// ====== UI VAZBY ======
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

// ====== POMOCNÉ ======
function qs(id){ return document.getElementById(id); }
function bindClick(ids, fn){ ids.forEach(id=>{ const el=qs(id); if (el) el.addEventListener('click', fn); }); }
function bindChange(ids, fn){ ids.forEach(id=>{ const el=qs(id); if (el) el.addEventListener('change', fn); }); }
function joinPath(a,b){ return (a.endsWith('/')?a:a+'/') + b; }
function endsWithAny(str, arr){ return arr.some(s=>str && str.endsWith(s)); }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
function pyStr(s){ return '"' + String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'; }
function active(){ return (typeof mp === 'function') ? mp() : null; }
function isConnected(){
  if (typeof isEditorConnected === 'function') return !!isEditorConnected();
  const d = active(); return !!(d && (d.connected || d.isOpen || d.port || d.device));
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// kvůli ondragover="allowDrop(event)" ve filemanager.html
function allowDrop(e){ e.preventDefault(); }

// zámek proti paralelním načítáním adresáře
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

// ====== LINK PROFIL BLE/USB (ponecháno pro kompatibilitu jiných částí UI) ======
function linkProfile(){
  if (getActiveLink() == 'ble') return { items:10, bytes:512, pauseMs:200};
  return { items:25, bytes:1024, pauseMs:5};
}


let ICON_UP = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAENklEQVR42p2WTWxUVRTH//fNR9vhTttpSwkfEogulI0L485oEBNTQxNXLmrUkLBS4mfjZ0JABGpAExokJSYS17oBwWAUhbgxGuPGFijETChlOm1npjN905n37nvv+L8zVRfaMOMkkztv3n3nd87/f86dUWjjpceXBSHgvpZWrT7T8kb98Yrs2GqwfUscF65EcN9qDdLSJn3UlcyAwaWRXiQEeP5yBb/9zEre77nr83fdoA+5kkx78s2ejLrHUVgyEeZDhZe/K+PmFCGHMup/A/SBZVHar53f09u1o8vBVDnElCvQCcCJKRy9VEH2moI7tjZkzRt6f1mky8fZvX14SDuYrIT4qUiPlSAIBN1JB/GY4NjFCuazhBzrVy0D9NtlqSc8fLkvg8e647jK4D8WI96hAVx8vmu+oKvDgRBy+mwJ5Vwc7okBdVeAfndJauLhzIsZDK9P4DpluVyIEIg04ptI4IXNdcUHutc5qAYhvriwhOpigpD1ak2AfqcsrqlhYl8fntmQwDQz/34xgm8E4gAhIYbB6wzuB7y2EK69nTGU+cX5r8owtRjc8Q3qXwD9RkmqXh2nXu/Ds5uSyC6HODsfYsUAHdS9vpq1BfirAFqBgJ1VZyW6S6FQDXDlXIkbKNfERvU3QB8uS9L3sP+FHoxsTqJKfacqEX5YCBAyUJzZe6zCBjZWJhvcfubqMoMYDQdBujuBIkv65RwrMZTrk0Gl9AdLIjGDoYeTGHpgHW7OGxQ8QQfbMMXIK+x7L5RGttFqFRbUuOa+/M07rMBBgFQjk9TGJFxKO32pjM5+DaUPlyQW+thEzYvM2mP2QSnCwH0JjO7S2NYJfH0rQMn6YD1gB5nQSsWgJFZuzCE77UXVZAdHIw6nnkCyLw7PDRCY2NpzkDlYkCPP6UabnrzhYYbwuGoaXWf6oePA0Jjq7TkUFjWyBze3Pgf2NfBRUUafSuGRPgenr3uYrQAxZQeN+pumwX6dLbtwC8uzA8iObWwP0D9WkJd2r8NOngKnrhssLFMb26qm2UmBKAR+iFohj5U/Upg5sbU9QO+RRdk7lMLj/TGcvOqhYCvAPx74HIyQAHOnCI+dOXv83vYAmQMLMmIr6HcwMUlAuSnRX7MQRgqGAP92nqtG/sM2K+h5b16eHk5hFyv4dNJHgRIp25p2DihTGNFknhn12TxUoLFwvF3AaF6eZAWPbojhs9/rKC9xszWZ7gZ2HuiBEGBycxBWUBrf3h4g/WpOntjNNt3i4MyvPkpLUfMwtcdDGEFYgW8lyuWRNGmUTm1rD6BfycnO4TQGU4JvJw0CTq1we2Sn2rap4lFtTZ7J0fw03HYBg2/mpP/BFGps/Br1dzi1hlMeBZz2aoiIwUOeXz4d1xxC9/P726xgJCu1QpGyqEb/C7Nm40NFQeNXjYcP7F8YewTpjgG4F/8b8CftPHDwwRULGgAAAABJRU5ErkJggg==";
let ICON_FOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAADtElEQVR42r1V3WtcRRT/nbvZjd0k/UgqNqIPimiRqrVQQitIkRIp6IOiYBGf/B/6YouKVCzSJimxKSLWmFQJptJigvhJ6YOiD1raICmtSW2bdDfZbJrdfJo7c3rm4969KVZrig53mHvnzpzfOb/fmTOE/7jR/wJwbiexDhngpbBBmvDQJ3xbTtDAi8T1Tz2P+uad4MUFB6IZVFWF4rc9KJ48jg2fLR+EfnkWvL6lFyvubQTm8tY4WIv7hNnhIZx7cxc2nVg+lfTTDvCGd7uRvWcFeK5k3AdCDUqlMD38O357ey+a+m8D4Idm8KMHulHTWA1emLL2oRUoCFA6P4jTe/ajqubvFPzraaoCtvSB6Pvt4M0HulDbmJEIBMCIoA2KgFSvwXwxjXB2CmRkIHYOmJGlK23pZGPSfBvLZhTnpgZP40Lv+6BvtoGb2j5G3bq0AFxzANFmeag6Gxuy8wnD8ZxxiJVQ6/UTesuXLuLntvdAXz4J3traiZWNBmDSR8CWJrvYbFbRN1cMRyDaA+jEdwCURkbx4+Eu0PEt4G3tH2HVupRocM1vhDckMStV8dxSJ2Oo3Ki8Eyq0DrBfE0gGTl4examObtCxJvD29g+x0gBYDQyfsmF+QgCnAQuq3JylTblu5tL1QoeoGUgWZOpkXtaEi5LhhOKVEZzs+BTUsxncfOgIVq/V0JNnxKCALJQTOnh65J0tFRGQ6Yvyy0SwKH6lEWRWg2ruFrw7MXHpMr7rOAo6ugm8o20f1mQvQs8WHd/+LDheQ3kig95zG4V2xg2g+WdoE0BDVxBkMDm3Cl93nQJ1bgQ/0/IW6uuuQk8X4s2x15FBjkBdBFon6EqsN53EqYmxGXzVPwr64BHwc60CUDsCXR7zmXAzSpQ8CYM6Etj9Zx9RIAkwkZ9Df99V0OGHwS+0vYGGmisCkLPscJR2OinsDZQsEdw449aQ6XImCmPzONGXA7WvB7/U+joaav+ALuVtAHG4CQNLKFHJCFTFuAcyERTGF/B5Xx7U8iD4ldY9aMgOQ5XHK4fIR6BjsZXTgBOUJL9j6rRN03EB6PlCAPbfD3754G7clR2CKuXiYucoSYh4U0qUTwSf0tJSctDyBQE4JgDv3Ad+9dBurM0MyfkejfNf61vgOzTvob9DOK6uUoqQy/2Jzl7RYN8D4MeefgKPb7wDaqYgGyjOf1c2uFKTTOUMXemwnrOvUze0VIrw68AMzg6WHeZeiSIM/6HO/5srR9bKjYvXLsh9sNyb6lbbdQUO3sO94PfiAAAAAElFTkSuQmCC";
let ICON_FILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAEQElEQVR42q2Wa2gcVRTH/3dmNpFo1LW1tQpVsPpBRYKCH3xBNVpFCD4o2BYrPip+KFWUSmuzSKXGVrRYFBGUNLVG66NBQY2SUgVtIKlpikhe3W7DZjfNJrvJZmdn532v585uYrYbog29szNzH7Pzu+f8zz13GOaUd9t+E4IzeD6HEAJgDArkje4MyJocKnVM2yYy2RxiSR2de19gWKCwcwFr77o1qIdCKgqGi5xVQN7yYNguJg0DU7oP03IQHTuLobMZ2CZbEFI2sOebo+LJe+uwclk4aAs6CgUHuuUjZ5rI6XmkDAcutftTaXSc6MOdN16PzqE4fn3rWXZeAN91YcIjgEozdmE5eVhkRYascjlHf2ISA/E41t99C9q6TuOveGpeSFlH06GjYsPqEsD3yQQOByosy4JpFKCbPrlLwPFdDCTS6IrGEFn/IHzHw57vOtE/Ml4BKWvsaj0inqq/rQRwIAVnigLLJ0tMFwXbg+OIwHm9sQR6h9N4e+N9SE7pGBweR3tvFD2x0TJIGeDNL46Ip++fAVjgXJWBBEGnSZFlkNie40MRPs6M5/Bjz+kAMJ3LI+8LxJNjaOuO4afjA+j7+GVWAYh83iGef+D2WQs4Lw7LEPVLECmwdJFBWnScHArGdV0gL5yg/uepUZxJjmPwk1cqAVubfxabH7ljVgNOYs48xEoQuUZytoDnOsVAsDhp5GIsa6CmRsOJ6Aj2/dCN4eatlYAtH34vXl17TwDwCOAQoKo0JkoPC9JkmqLJcVxwl7SREUagdNbCZZdWo+tUArsP/Y6Rz16rBGza2yoaNzxctADSFRzShhBdtDnPeb4Cm9swPBt2nsEVFgFMrLgijGODcfJEO0YPbqsErGtqEbufawgABs1OkAV0RTUljBD5yKc6p1RRJeseie6RBTb1ei4mcgWsWnEl/uiL45l9h5Fq3V4JaIh8Kj7Y/HgAyBgWVC6Cl2rkFpUpxXAinykqWUSC+HSa3IVHwk/oBm6+dhmO/T2Cx5oOYuLLHZWA1TuaRcuWRwPAZL4QOD6I+kBshhA5qppgjhQmBFwkgR4ja0mDnIkbrg7jZHQU9Y37kfmq8f8B5hbZVCmdqlIRjRXB9AsRdIIsXrnkYgrTBNY0HsDk14sBULuqSoNLM1YVjVyngVM6UVgxnSwJ16B7KIGHIgcwtRgAAgtUiiIC0BEiMaSXpAMdSidLay8A4N8cw0orEMGmZHIfV9VeguMEWHMhAHLWMoRZIL5MIz6uubx2YcBNL74v2ndunAWweQDyD5xE9SWCQlSlhaFpGkxKgsvDZEFJ5P8EpKZ1WqHFfuUciGlTIqTcxlSaP0WVRgtvqmCh7rrl6IkmUb99P7LfRioBS594Q/R89NLslrmYIveGuk3vIX14ZyWgtuF10d+ybdEvnymr1u2C9cs78wPk3RXSKeK8Xio/cxjlr5kyA/gHM7+cN0oReEMAAAAASUVORK5CYII=";


// Pomocná prodleva
function fm_delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ====== POPUP / DIALOGY ======
function bindCloseButtons(){
  const btn = qs('popup-close'); if (btn) btn.onclick = closePopup;
  const btns = qs('popup-buttons');
  if (btns && !btns.querySelector('#popup-close')){
    btns.innerHTML = '<button id="popup-close" type="button">Zavřít</button>';
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
  showPopup('<p>'+(msg||'Pracuji...')+'</p>');
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

// ====== PROGRESS BAR #myProgress NAD OVERLAY + PROCENTA ======
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
    const head = (total>1) ? `Soubor ${idx}/${total}: ` : '';
    cont.innerHTML = `<p>Nahrávám: ${head}<b>${escapeHtml(name||'soubor')}</b> — <span id="upload-pct">0%</span></p>`;
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
    showError(`Nahráno: ${okList.length} úspěšně, ${failList.length} chyb.<br><small>OK: ${escapeHtml(okNames.join(', '))}<br>Chyby: ${escapeHtml(failNames.join(', '))}</small>`);
  } else {
    showNotification(`Nahráno: ${okList.length} souborů.<br><small>${escapeHtml(okNames.join(', '))}</small>`);
  }
}
function showDownloadDialog(name){
  clearTimeout(popupTimer);
  const cont = qs('popup-content'), ov = qs('popup-overlay'),
        btn = qs('popup-close'), btns = qs('popup-buttons');
  if (btn)  btn.style.display='none';
  if (btns) btns.style.display='none';
  if (cont && ov){
    cont.innerHTML = `<p>Stahuji: <b>${escapeHtml(name||'soubor')}</b> — <span id="upload-pct">0%</span></p>`;
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

// ====== STATUS PAMĚTI ======
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
  const hue = 120 - p * 1.2; // 120..0 zelená→červená
  el.style.backgroundColor = `hsl(${hue}, 75%, 62%)`;
  el.title = `Využito: ${p.toFixed(1)}%`;
}
function updateMemoryStatus(usedMB, totalMB, pctUsed){
  const el = qs('memory-status'); if (!el) return;
  el.textContent = `${usedMB.toFixed(3)}MB / ${totalMB.toFixed(3)}MB využito (${pctUsed.toFixed(1)}%)`;
}

// ====== DND / INPUT ======
async function handleDrop(e){
  e.preventDefault();
  // tvrdý zámek statusu stejně jako při uploadu tlačítkem
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
    await uploadBatch(flat);              // stejná cesta jako u tlačítka
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
                   .catch(err=> showError('Chyba uploadu: '+err));
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

// ====== FS OPERACE (REPL) ======

// DÁVKOVÝ UPLOAD
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

// Pošli soubor přes dev.sendFile
async function sendOneFile(file, dst){
  const dev = active(); 
  if (!dev) return showError('Zařízení není připojeno.');

  const prevMute = !!dev.mute_terminal;
  try {
    dev.mute_terminal = true;
    awaitfm_delay(25);

    const buf = await file.arrayBuffer();
    await dev.sendFile(dst, new Uint8Array(buf), false);

    await fm_delay(150);
  } finally {
    dev.mute_terminal = prevMute;
  }
}

// ====== DOWNLOAD přes fm_down (Base64 řádky) ======
async function doDownload(path){
  const dev = active(); if (!dev) return showError('Zařízení není připojeno.');
  uploadingBatch = true; statusRunning = true;

  // dialog s průběhem
  const nameGuess = (path.split('/').pop() || 'download.bin');
  showDownloadDialog(nameGuess);

  // progress helper
  const bar = qs('myProgress');
  const setProg = (pct)=>{ if (bar) bar.style.width = Math.max(0, Math.min(100, pct|0)) + '%'; };

  // profil dle linku
  let chunk, pause;
  if (getActiveLink() === 'ble') { chunk = 120;  pause = 60; }
  else                           { chunk = 384; pause = 1;  }

  const parts = [];
  let gotLen = 0;

  function flushRx(){ try{ fmPull(dev); }catch{} }
  function acc(){ fmAccumulate(dev); }
  function b64toU8(s){ const bin=atob(s); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }

  // hlavička: <<FM_DOWN>>name;size
  function tryConsumeHeader(){
    const tag='<<FM_DOWN>>';
    const i=__fmAcc.indexOf(tag); if (i<0) return null;
    let j=__fmAcc.indexOf('\n',i); if (j<0) j=__fmAcc.indexOf('\r',i); if (j<0) return null;
    const line=__fmAcc.slice(i+tag.length,j).trim();
    __fmAcc=__fmAcc.slice(j+1);
    const semi=line.indexOf(';'); if (semi<0) return {error:'Neplatná hlavička'};
    const namePart=line.slice(0,semi); const sizeStr=line.slice(semi+1);
    const size=parseInt(sizeStr,10)||0; if (!size && sizeStr!=='0') return {error:'Neplatná velikost'};
    if (namePart.toUpperCase().includes('ERROR')) return {error:'Chyba na ESP: '+namePart};
    return {name:namePart, size};
  }

  await withReplLock(async ()=>{
    beginCapture(dev);
    try{
      // reset a start
      flushRx();
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);

      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_down(${pyStr(path)}, ${chunk}, ${pause})`);

      // HLAVIČKA
      const t0=Date.now(), T_HDR=15000; let header=null;
      while ((Date.now()-t0)<T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback')>=0 || __fmAcc.indexOf('NameError')>=0) throw new Error('Chyba v REPL: '+__fmAcc.slice(0,200));
        header = tryConsumeHeader();
        if (header){ if (header.error) throw new Error(header.error); break; }
        await delay(30);
      }
      if (!header) throw new Error('Timeout hlavičky');

      const expectSize = header.size;
      const baseName = (header.name || path).split('/').pop() || 'download.bin';
      setProg(0);

      // DATA: řádky Base64 až do <<FM_D_COMPL>>
      const END='<<FM_D_COMPL>>';
      let carry=''; const linesEst=Math.max(1, Math.ceil(expectSize/Math.max(1,chunk)));
      const T_DATA=20000 + linesEst*(pause+80); const t1=Date.now();
      let lastTick=0, lastPct=-1;

      while (true){
        acc();
        let endIdx = __fmAcc.indexOf(END);
        const takeUpto = (endIdx>=0) ? endIdx : __fmAcc.length;

        if (takeUpto>0){
          const segment = carry + __fmAcc.slice(0, takeUpto);
          __fmAcc = __fmAcc.slice(takeUpto);
          const rows = segment.split(/\r?\n/); carry = rows.pop() || '';
          for (const r of rows){
            const s=r.trim(); if (!s) continue;
            const u8=b64toU8(s); parts.push(u8); gotLen += u8.length;
          }
          if (expectSize>0){
            const now=Date.now(); const pct=(gotLen*100)/expectSize;
            if ((now-lastTick)>80 && ((pct|0)!==lastPct)){ setProg(pct); lastTick=now; lastPct=pct|0; }
          }
        }
        if (endIdx>=0){ __fmAcc = __fmAcc.slice(END.length); break; }
        if ((Date.now()-t1)>T_DATA) throw new Error('Timeout přenosu dat');
        await delay(Math.max(10, Math.min(60, pause||10)));
      }

      if (gotLen !== expectSize) throw new Error(`Velikost nesouhlasí: očekáváno ${expectSize} B, dorazilo ${gotLen} B`);

      const blob = new Blob(parts, {type:'application/octet-stream'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = baseName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 10000);

      setProg(100);
      finishDownloadDialog();
      showNotification(`Staženo: ${baseName} (${gotLen} B)`);
    } finally {
      endCapture(dev);
    }
  }).catch(e=>{ finishDownloadDialog(); showError(String(e)); })
    .finally(()=>{ statusRunning = false; uploadingBatch = false; });
}


// GZIP dekomprese v prohlížeči
async function gunzipBytes(u8){
  if (!('DecompressionStream' in window)) throw new Error('GZIP není podporován tímto prohlížečem.');
  const ds = new DecompressionStream('gzip');
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const resp = new Response(new Blob([ab]).stream().pipeThrough(ds));
  return new Uint8Array(await resp.arrayBuffer());
}


// ====== DOWNLOAD do paměti přes fm_down (Base64 řádky) ======
// Shodná logika s doDownload(), ale MÍSTO stažení do PC vrací bajty a metadata.
// Vrací: { name, size, bytes: Uint8Array }
async function doDownloadToMemory(path){
  const dev = active(); if (!dev) throw new Error('Zařízení není připojeno.');
  uploadingBatch = true; statusRunning = true;

  // Progress bar znovupoužijeme jen vizuálně
  const nameGuess = (path.split('/').pop() || 'download.bin');
  showDownloadDialog(nameGuess);                 // stejné UI jako doDownload()
  const bar = qs('myProgress');
  const setProg = (pct)=>{ if (bar) bar.style.width = Math.max(0, Math.min(100, pct|0)) + '%'; };

  // Profil dle linku — identicky jako v doDownload()
  let chunk, pause;
  if (getActiveLink() === 'ble') { chunk = 120;  pause = 60; }
  else                           { chunk = 384;  pause = 1;   }

  const parts = [];
  let gotLen = 0;

  function flushRx(){ try{ fmPull(dev); }catch{} }
  function acc(){ fmAccumulate(dev); }
  function b64toU8(s){ const bin=atob(s); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }

  // hlavička: <<FM_DOWN>>name;size  — stejný parser jako v doDownload()
  function tryConsumeHeader(){
    const tag='<<FM_DOWN>>';
    const i=__fmAcc.indexOf(tag); if (i<0) return null;
    let j=__fmAcc.indexOf('\n',i); if (j<0) j=__fmAcc.indexOf('\r',i); if (j<0) return null;
    const line=__fmAcc.slice(i+tag.length,j).trim();
    __fmAcc=__fmAcc.slice(j+1);
    const semi=line.indexOf(';'); if (semi<0) return {error:'Neplatná hlavička'};
    const namePart=line.slice(0,semi); const sizeStr=line.slice(semi+1);
    const size=parseInt(sizeStr,10)||0; if (!size && sizeStr!=='0') return {error:'Neplatná velikost'};
    if (namePart.toUpperCase().includes('ERROR')) return {error:'Chyba na ESP: '+namePart};
    return {name:namePart, size};
  }

  return await withReplLock(async ()=>{
    beginCapture(dev);
    try{
      // Reset a start — identicky jako v doDownload()
      flushRx();
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);

      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_down(${pyStr(path)}, ${chunk}, ${pause})`);

      // HLAVIČKA
      const t0=Date.now(), T_HDR=15000; let header=null;
      while ((Date.now()-t0)<T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback')>=0 || __fmAcc.indexOf('NameError')>=0) throw new Error('Chyba v REPL: '+__fmAcc.slice(0,200));
        header = tryConsumeHeader();
        if (header){ if (header.error) throw new Error(header.error); break; }
        await delay(30);
      }
      if (!header) throw new Error('Timeout hlavičky');

      const expectSize = header.size;
      const baseName = (header.name || path).split('/').pop() || 'download.bin';
      setProg(0);

      // DATA: řádky Base64 až do <<FM_D_COMPL>> — kopie z doDownload()
      const END='<<FM_D_COMPL>>';
      let carry=''; const linesEst=Math.max(1, Math.ceil(expectSize/Math.max(1,chunk)));
      const T_DATA=20000 + linesEst*(pause+80); const t1=Date.now();
      let lastTick=0, lastPct=-1;

      while (true){
        acc();
        let endIdx = __fmAcc.indexOf(END);
        const takeUpto = (endIdx>=0) ? endIdx : __fmAcc.length;

        if (takeUpto>0){
          const segment = carry + __fmAcc.slice(0, takeUpto);
          __fmAcc = __fmAcc.slice(takeUpto);
          const rows = segment.split(/\r?\n/); carry = rows.pop() || '';
          for (const r of rows){
            const s=r.trim(); if (!s) continue;
            const u8=b64toU8(s); parts.push(u8); gotLen += u8.length;
          }
          if (expectSize>0){
            const now=Date.now(); const pct=(gotLen*100)/expectSize;
            if ((now-lastTick)>80 && ((pct|0)!==lastPct)){ setProg(pct); lastTick=now; lastPct=pct|0; }
          }
        }
        if (endIdx>=0){ __fmAcc = __fmAcc.slice(END.length); break; }
        if ((Date.now()-t1)>T_DATA) throw new Error('Timeout přenosu dat');
        await delay(Math.max(10, Math.min(60, pause||10)));
      }

      if (gotLen !== expectSize) throw new Error(`Velikost nesouhlasí: očekáváno ${expectSize} B, dorazilo ${gotLen} B`);

      // Sloučení do výstupního Uint8Array
      const out = new Uint8Array(expectSize);
      let off = 0;
      for (const p of parts){ out.set(p, off); off += p.length; }

      // Ukliď progress overlay (ponechávám stejné chování jako při dokončení downloadu)
      try { closeDownloadDialog && closeDownloadDialog(); } catch(_){}
      finishDownloadDialog()
      return { name: baseName, size: expectSize, bytes: out };
    } finally {
      endCapture(dev);            // obnov terminál
      uploadingBatch = false;     // povol status dotazy
      statusRunning = false;
      finishDownloadDialog()
    }
  });
}










// ====== LISTING (stream přes <<FM_LIST>> ... <<FM_L_COMPL>>) ======
async function fetchDirPaged(path){
  const dev = active(); if (!dev) throw new Error('Zařízení není připojeno.');

  // kratší pauza pro USB, delší pro BLE
  let pause;
  if (getActiveLink() === 'ble') { pause = 35; }
  else                           { pause = 1;  }

  function acc(){ fmAccumulate(dev); } // přilep do __fmAcc

  // hlavička: <<FM_LIST>><path>\r?\n
  function tryConsumeHeader(){
    //console.log(__fmAcc);
    const TAG = '<<FM_LIST>>';
    const i = __fmAcc.indexOf(TAG);
    if (i < 0) return null;
    let j = __fmAcc.indexOf('\n', i);
    if (j < 0) j = __fmAcc.indexOf('\r', i);
    if (j < 0) return null;
    const line = __fmAcc.slice(i + TAG.length, j).trim();
    __fmAcc = __fmAcc.slice(j + 1);
    if (!line || line.toUpperCase().includes('ERROR')) return { error: 'Chyba listingu' };
    return { path: line };
  }

  // parsování položek (bez ukončovacího tagu)
  function parseRows(segment, basePath, out){
    const rows = segment.split(/\r?\n/);
    const carry = rows.pop() || ''; // poslední může být nedokončený
    for (const r of rows){
      const s = r.trim();
      if (!s) continue;
      const k = s.split(';');                 // jméno;velikost;F|D
      if (k.length < 3) continue;
      const name = k[0];
      const sz   = parseInt(k[1], 10) || 0;
      const isD  = (k[2] === 'D');
      const full = (basePath.endsWith('/') ? basePath : basePath + '/') + name;
      out.push({
        name,
        path: full,
        size: isD ? 0 : sz,
        isDirectory: isD,
        extension: isD ? "" : (name.includes('.') ? name.split('.').pop() : ""),
        icon: isD ? "dir" : "file"
      });
    }
    return carry;
  }

  return withReplLock(async ()=>{
    beginCapture(dev); // umlč terminál + vynuluj __fmAcc
    try{
      // soft-reset příjmu
      fmPull(dev);
      await dev.sendData("\x03"); await delay(120);
      await dev.sendData("\r\n"); await delay(40);
      acc();
      __fmAcc = "";
      // spusť listing na ESP
      await dev.sendCommand(`import fm_rpc as F`);
      await dev.sendCommand(`F.fm_list(${pyStr(path)}, ${pause})`);

      // 1) hlavička
      const T_HDR = 15000;
      const t0 = Date.now();
      let header = null;
      while ((Date.now() - t0) < T_HDR){
        acc();
        if (__fmAcc.indexOf('Traceback') >= 0) throw new Error('Chyba v REPL');
        header = tryConsumeHeader();
        if (header){
          if (header.error) throw new Error(header.error);
          break;
        }
        await delay(25);
      }
      if (!header) throw new Error('Timeout hlavičky');

      const basePath = header.path || path || '/';
      const END = '<<FM_L_COMPL>>';
      const out = [];
      let carry = '';
      let lastDataTs = Date.now();
      const HARD = 60000;  // tvrdý limit
      const IDLE = 4000;   // nic nové >4s → timeout
      const t1 = Date.now();

      // 2) stream řádků až do ukončení
      while (true){
        acc();
        let endIdx = __fmAcc.indexOf(END);
        const takeUpto = (endIdx >= 0) ? endIdx : __fmAcc.length;

        if (takeUpto > 0){
          const segment = carry + __fmAcc.slice(0, takeUpto);
          __fmAcc = __fmAcc.slice(takeUpto);
          carry = parseRows(segment, basePath, out);
          lastDataTs = Date.now();
        }

        if (endIdx >= 0){
          __fmAcc = __fmAcc.slice(END.length); // spolkni ukončovací tag
          break;
        }

        const now = Date.now();
        if ((now - lastDataTs) > IDLE) throw new Error('Timeout listingu');
        if ((now - t1) > HARD) throw new Error('Příliš dlouhý listing');
        await delay(30);
      }

      // 3) hotovo
      return { path: basePath, contents: out };
    } finally {
      endCapture(dev); // obnov terminál
    }
  });
}

// ====== RENDER TABULKY ======
async function loadDirectoryContents(path){
  return withDirLoadLock(async ()=>{
    // vždy zruš výběr, ať se nepřenáší položky z jiné cesty
    clearSelection();

    // helper pro správu výběru bez duplikátů
    function setSelected(path, on){
      if (!Array.isArray(selectedFiles)) selectedFiles = [];
      const i = selectedFiles.indexOf(path);
      if (on && i === -1) selectedFiles.push(path);
      if (!on && i !== -1) selectedFiles.splice(i, 1);
    }

    currentPath = path || '/';
    updateBreadcrumb();

    const ov = qs('popup-overlay');
    if (ov && ov.style.display === 'none') showLoading('Načítám...');

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

        // --- výběr s větším hitboxem ---
        const tdSel=document.createElement('td');
        tdSel.className = 'fm-col-sel';

        const lbl=document.createElement('label');
        lbl.className = 'fm-chk-wrap';
        lbl.title = 'Vybrat položku';

        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.className='fm-chk';
        cb.checked = selectedFiles.includes(file.path);

        // zvětšený klikací prostor; vystyluj si .fm-chk-hit v CSS
        const hit=document.createElement('span');
        hit.className='fm-chk-hit';

        // nepropagovat na klikatelné buňky řádku
        cb.addEventListener('click', (e)=> e.stopPropagation());
        lbl.addEventListener('click', (e)=> e.stopPropagation());

        cb.addEventListener('change', ()=>{
          setSelected(file.path, cb.checked);
        });

        lbl.append(cb, hit);
        tdSel.appendChild(lbl);

        // --- název a ikona ---
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

        // --- velikost ---
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

// ====== HROMADNÉ OPERACE ======
function downloadFiles(){
  if (!selectedFiles.length){ showError('Nebyl vybrán žádný soubor.'); return; }
  (async ()=>{ for (const p of selectedFiles) await doDownload(p); })()
    .then(()=> clearSelection())
    .catch(e=> showError(String(e)));
}
async function moveTo(){
  if (!selectedFiles.length){ showError('Nic nevybráno'); return; }
  const dest = await askText('Cílová složka:'); if (!dest) return;
  showLoading('Přesouvám...');
  (async ()=>{
    await ensureImports();
    const arr = '[' + selectedFiles.map(p=>pyStr(p)).join(',') + ']';
    return mpEvalJson('F.move(' + arr + ',' + pyStr(dest) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'move'); loadDirectoryContents(currentPath); clearSelection(); showNotification('Přesunuto'); })
    .catch(e=> showError('Chyba: '+e));
}
async function new_Folder(){
  const name = await askText('Název složky:'); if (!name) return;
  const p = joinPath(currentPath, name).replace(/\/\//g,'/');
  (async ()=>{
    await ensureImports();
    return mpEvalJson('F.mkdir(' + pyStr(p) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'mkdir'); loadDirectoryContents(currentPath); clearSelection(); showNotification('Vytvořeno'); })
    .catch(e=> showError('Chyba: '+e));
}
async function copyTo(){
  if (!selectedFiles.length){ showError('Nic nevybráno'); return; }
  const dest = await askText('Cílová složka:'); if (!dest) return;
  showLoading('Kopíruji...');
  (async ()=>{
    await ensureImports();
    const arr = '[' + selectedFiles.map(p=>pyStr(p)).join(',') + ']';
    return mpEvalJson('F.copy(' + arr + ',' + pyStr(dest) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'copy'); loadDirectoryContents(currentPath); clearSelection(); showNotification('Zkopírováno'); })
    .catch(e=> showError('Chyba: '+e));
}
async function renameFile(){
  if (selectedFiles.length !== 1){ await info('Vyberte jeden soubor.'); return; }
  const base = selectedFiles[0].split('/').pop();
  const newName = await askText('Nový název:', base);
  if (!newName) return;
  const newPath = joinPath(currentPath, newName).replace(/\/\//g,'/');
  showLoading('Přejmenovávám...');
  (async ()=>{
    await ensureImports();
    return mpEvalJson('F.rename(' + pyStr(selectedFiles[0]) + ',' + pyStr(newPath) + ')');
  })()
    .then(r=>{ if(!r.ok) throw new Error(r.error||'rename'); loadDirectoryContents(currentPath); clearSelection(); showNotification('Přejmenováno'); })
    .catch(e=> showError('Chyba: '+e));
}

// Smazání vybraných položek bez JSON. Jedna cesta = jeden REPL běh.
// Použije fm_rpc.delete_path() (viz patch níže). Fallback na F._rmtree().
async function deleteFiles(){
  if (!selectedFiles.length){ showError('Nic nevybráno'); return; }
  showLoading('Mažu...');
  uploadingBatch = true;            // vypne status dotazy, žádné Ctrl+C
  try{
    await ensureImports();          // import fm_rpc as F
    const targets = [...selectedFiles];
    for (const p of targets){
      await deleteOnePath(p);
    }
    await loadDirectoryContents(currentPath);
    clearSelection();
    showNotification('Smazáno');
  }catch(e){
    showError('Chyba: ' + (e && e.message || e));
  }finally{
    uploadingBatch = false;
  }
}

// Jedna cesta = jeden REPL běh; čeká na <<FM>>OK<<END>>
async function deleteOnePath(path){
  if (!path || path === '/') throw new Error('Mazání "/" je zakázáno');

  const lines = [
    'import fm_rpc as F',
    `F.delete_all(${pyStr(path)})`
  ];
  // mpExecOk: pošle ^C, umlčí terminál, provede 'lines' a přidá print('<<FM>>OK<<END>>')
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

// Čtení z transportního FM bufferu
function fmPull(dev){
  if (dev && typeof dev.fmTakeAll === 'function') return dev.fmTakeAll();
  const s = (dev && dev.rawResponseBuffer) || "";
  if (dev) dev.rawResponseBuffer = "";
  return s;
}
function fmAccumulate(dev){ const s = fmPull(dev); if (s) __fmAcc += s; }

function beginCapture(dev){
  dev.__fm_save = { mute: !!dev.mute_terminal };
  dev.mute_terminal = true;
  __fmAcc = ""; // čistý akumulátor pro nový příkaz
}
function endCapture(dev){
  const s = dev.__fm_save || {};
  dev.mute_terminal = !!s.mute;
  dev.__fm_save = null;
}

// Konzumeři tagovaných výstupů pro JSON/OK
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

// Jednorázové importy ujson/fm_rpc
async function ensureImports(){
  if (__importsReady) return;
  await mpExecOk(['import ujson as json', 'import fm_rpc as F']);
  __importsReady = true;
}

// Eval JSON výrazu s tagem
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

// Obecná exekuce řádků s potvrzením OK
async function mpExecOk(lines){
  return withReplLock(async ()=>{
    const dev = active(); if (!dev) throw new Error('no transport');
    const code = Array.isArray(lines) ? lines.join('\n') : String(lines||'');
    beginCapture(dev);
    try{
      await dev.sendData("\x03"); await delay(120);
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


// ====== EDITOR HOOKY ======
async function open_block_editor(filename){
  if (!(await dlgConfirm(String('Otevřít '+filename+' v blokovém editoru?')))) return;
  try{
    showLoading('Načítám '+filename);
    const { bytes } = await doDownloadToMemory(filename);   // respektuje REPL lock i chunking
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
      alert('Loader pro Blockly v této stránce není dostupný.');
    }
  } catch(e){
    showError(String(e && e.message || e));
  } finally {
    closePopup();
  }
  switchUITo("blocks")
}

async function open_text_editor(filename){
  if (!(await dlgConfirm(String('Otevřít '+filename+' v textovém editoru?')))) return;
  try{
    showLoading('Načítám '+filename);
    const { bytes } = await doDownloadToMemory(filename);   // respektuje REPL lock i chunking
    const text = new TextDecoder('utf-8').decode(bytes);

    if (typeof window.__espideFM_openTextTab === 'function'){
      window.__espideFM_openTextTab(filename, text);
      if (typeof closeFM === 'function') closeFM();
    } else {
      await info('Loader pro textový editor v této stránce není dostupný.');
    }
  } catch(e){
    showError(String(e && e.message || e));
  } finally {
    closePopup();
  }
  switchUITo("text")
}

// Tvrdý cleanup REPL stavu při zavření Filemanageru
function fmForceCleanup(){
  try {
    const dev = active();
    if (dev) {
      // vždy odmutuj terminál a zruš případný uložený stav capture
      endCapture(dev);
      dev.mute_terminal = false;
      if (dev.__fm_save) dev.__fm_save = null;
      
    }
  } catch(e) {
    console.warn('fmForceCleanup mute reset failed', e);
  }
}

// zpřístupni z index.html
window.fmForceCleanup = fmForceCleanup;