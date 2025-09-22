// MotoRefurb PWA – IndexedDB storage
let db;
const DB_NAME = 'motoRefurbDB';
const DB_VERSION = 1;
const stores = ['projects','parts','tasks','settings','photos'];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      stores.forEach(s => {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'photos') os.createIndex('byPart','partId',{unique:false});
          if (s === 'parts') os.createIndex('byProject','projectId',{unique:false});
          if (s === 'tasks') os.createIndex('byProject','projectId',{unique:false});
          if (s === 'tasks') os.createIndex('byDue','due',{unique:false});
        }
      });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode='readonly') { return db.transaction(store, mode).objectStore(store); }

async function add(store, obj) { return new Promise((res, rej)=>{ tx(store,'readwrite').add(obj).onsuccess=()=>res(); }).then(refreshAll); }
async function put(store, obj) { return new Promise((res, rej)=>{ tx(store,'readwrite').put(obj).onsuccess=()=>res(); }).then(refreshAll); }
async function del(store, id) { return new Promise((res, rej)=>{ tx(store,'readwrite').delete(id).onsuccess=()=>res(); }).then(refreshAll); }
async function getAll(store) { return new Promise((res, rej)=>{ const r = tx(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(16).slice(2); }

// UI helpers
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function switchTab(tab) {
  $$('.tab').forEach(el=>el.classList.toggle('active', el.dataset.tab===tab));
  ['projects','parts','tasks','calendar','settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id!==tab);
  });
}

function formatMoney(x, cur='£'){ if(x===undefined||x===null||x==='') return ''; return `${cur}${Number(x).toFixed(2)}`; }
function todayStr(){ const d=new Date(); return d.toISOString().slice(0,10); }

async function refreshProjectOptions() {
  const projs = await getAll('projects');
  const opts = ['<option value="">No project</option>'].concat(projs.map(p=>`<option value="${p.id}">${p.title}</option>`)).join('');
  ['partProject','taskProject','filterByProj','filterTaskProj'].forEach(id=>{
    const el = $('#'+id); if (!el) return;
    if (id==='filterByProj' || id==='filterTaskProj') {
      el.innerHTML = `<option value="">All projects</option>` + projs.map(p=>`<option value="${p.id}">${p.title}</option>`).join('');
    } else {
      el.innerHTML = opts;
    }
  });
}

function chip(txt){ return `<span class="tag">${txt}</span>`; }

async function renderProjects() {
  const list = $('#projectList');
  const projs = await getAll('projects');
  list.innerHTML = projs.map(p=>{
    return `<div class="item">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <strong>${p.title}</strong><br>
          <span class="muted">${p.reg||''}</span>
        </div>
        <div>${chip(p.status)}</div>
      </div>
      ${p.notes ? `<div class="muted" style="margin-top:6px;">${p.notes}</div>` : ''}
      <div class="row" style="gap:8px; margin-top:8px;">
        <button data-act="editProj" data-id="${p.id}">Edit</button>
        <button data-act="delProj" data-id="${p.id}" class="danger">Delete</button>
      </div>
    </div>`;
  }).join('') || `<div class="muted">No projects yet.</div>`;
  list.querySelectorAll('button').forEach(b=>{
    b.onclick = async () => {
      const id = b.dataset.id;
      if (b.dataset.act==='delProj') {
        if (confirm('Delete this project?')) await del('projects', id);
      } else if (b.dataset.act==='editProj') {
        const projs = await getAll('projects');
        const p = projs.find(x=>x.id===id);
        if (!p) return;
        // quick inline edit via prompts (simple MVP)
        const title = prompt('Title', p.title) ?? p.title;
        const reg = prompt('Reg/VIN', p.reg||'') ?? p.reg;
        const status = prompt('Status (planning/stripping/paint/powder/engine/reassembly/testing/complete)', p.status) ?? p.status;
        const notes = prompt('Notes', p.notes||'') ?? p.notes;
        await put('projects',{...p, title, reg, status, notes});
      }
    };
  });
}

async function renderParts() {
  const q = $('#searchParts').value.toLowerCase();
  const pid = $('#filterByProj').value;
  const st = $('#filterByStatus').value;
  const parts = await getAll('parts');
  const projs = await getAll('projects');
  const projName = id => (projs.find(p=>p.id===id)||{}).title || '—';
  const list = $('#partList');
  const filtered = parts.filter(p=>{
    if (pid && p.projectId!==pid) return false;
    if (st && p.status!==st) return false;
    const hay = (p.name+' '+(p.notes||'')+' '+(p.supplier||'')).toLowerCase();
    return hay.includes(q);
  });
  const photos = await getAll('photos');
  const imgsByPart = photos.reduce((acc,ph)=>{ (acc[ph.partId]=acc[ph.partId]||[]).push(ph); return acc; },{});
  list.innerHTML = filtered.map(p=>{
    const imgs = (imgsByPart[p.id]||[]).slice(0,6).map(ph=>`<img src="${ph.data}" alt="photo">`).join('');
    return `<div class="item">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div style="flex:1;">
          <strong>${p.name}</strong><br>
          <span class="muted">${projName(p.projectId)}</span>
        </div>
        <div>${chip(p.status)}</div>
      </div>
      <div class="row" style="gap:8px; margin-top:6px; flex-wrap:wrap;">
        ${p.supplier? chip(p.supplier):''}
        ${p.price? chip(formatMoney(p.price, (await getSetting('currency'))||'£')):''}
        ${p.qty? chip(`x${p.qty}`):''}
        ${p.due? chip(`Due ${p.due}`):''}
      </div>
      ${p.notes ? `<div class="muted" style="margin-top:6px;">${p.notes}</div>` : ''}
      ${imgs? `<div class="thumbs">${imgs}</div>`:''}
      <div class="row" style="gap:8px; margin-top:8px; flex-wrap:wrap;">
        <button data-act="editPart" data-id="${p.id}">Edit</button>
        <button data-act="markPart" data-id="${p.id}">Next Status</button>
        <button data-act="delPart" data-id="${p.id}" class="danger">Delete</button>
      </div>
    </div>`;
  }).join('') || `<div class="muted">No parts yet.</div>`;
  list.querySelectorAll('button').forEach(b=>{
    b.onclick = async () => {
      const id = b.dataset.id;
      const all = await getAll('parts');
      const p = all.find(x=>x.id===id);
      if (!p) return;
      if (b.dataset.act==='delPart') {
        if (confirm('Delete this part?')) await del('parts', id);
      } else if (b.dataset.act==='editPart') {
        const name = prompt('Name', p.name) ?? p.name;
        const supplier = prompt('Supplier', p.supplier||'') ?? p.supplier;
        const price = prompt('Price', p.price||'') ?? p.price;
        const qty = prompt('Qty', p.qty||'') ?? p.qty;
        const due = prompt('Due (YYYY-MM-DD)', p.due||'') ?? p.due;
        const notes = prompt('Notes', p.notes||'') ?? p.notes;
        await put('parts',{...p, name, supplier, price, qty, due, notes});
      } else if (b.dataset.act==='markPart') {
        const order = ['needed','ordered','received','installed'];
        const next = order[(order.indexOf(p.status)+1) % order.length];
        await put('parts',{...p, status: next});
      }
    };
  });
}

async function renderTasks() {
  const q = $('#searchTasks').value.toLowerCase();
  const pid = $('#filterTaskProj').value;
  const st = $('#filterTaskStatus').value;
  const tasks = await getAll('tasks');
  const projs = await getAll('projects');
  const projName = id => (projs.find(p=>p.id===id)||{}).title || '—';
  const list = $('#taskList');
  const filt = tasks.filter(t=>{
    if (pid && t.projectId!==pid) return false;
    if (st && t.status!==st) return false;
    const hay = (t.title+' '+(t.notes||'')).toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=> (a.due||'').localeCompare(b.due||''));
  list.innerHTML = filt.map(t=>{
    const pri = t.priority==='high' ? 'danger' : (t.priority==='low'?'muted':'accent');
    return `<div class="item">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div style="flex:1;">
          <strong>${t.title}</strong><br>
          <span class="muted">${projName(t.projectId)}</span>
        </div>
        <div>${chip(t.status)} ${t.due? chip(t.due):''} <span class="${pri}">●</span></div>
      </div>
      ${t.notes ? `<div class="muted" style="margin-top:6px;">${t.notes}</div>` : ''}
      <div class="row" style="gap:8px; margin-top:8px;">
        <button data-act="toggleTask" data-id="${t.id}">Advance</button>
        <button data-act="delTask" data-id="${t.id}" class="danger">Delete</button>
      </div>
    </div>`;
  }).join('') || `<div class="muted">No tasks yet.</div>`;
  list.querySelectorAll('button').forEach(b=>{
    b.onclick = async () => {
      const id = b.dataset.id;
      const all = await getAll('tasks');
      const t = all.find(x=>x.id===id);
      if (!t) return;
      if (b.dataset.act==='delTask') {
        if (confirm('Delete this task?')) await del('tasks', id);
      } else if (b.dataset.act==='toggleTask') {
        const order = ['todo','doing','done'];
        const next = order[(order.indexOf(t.status)+1) % order.length];
        await put('tasks',{...t, status: next});
      }
    };
  });
}

async function renderCalendar() {
  const monthInput = $('#calMonth');
  const tasks = await getAll('tasks');
  const projs = await getAll('projects');
  const projName = id => (projs.find(p=>p.id===id)||{}).title || '—';
  const val = monthInput.value || (new Date().toISOString().slice(0,7));
  const list = $('#calendarList');
  const [y,m] = val.split('-').map(Number);
  const start = new Date(y, m-1, 1);
  const end = new Date(y, m, 1);
  const filt = tasks.filter(t=> t.due && new Date(t.due) >= start && new Date(t.due) < end)
                    .sort((a,b)=> (a.due||'').localeCompare(b.due||''));
  let html = '';
  let currentDay = '';
  for (const t of filt) {
    if (t.due !== currentDay) {
      if (currentDay) html += '</div>';
      currentDay = t.due;
      html += `<div class="item"><strong>${currentDay}</strong><div class="list" style="margin-top:6px;">`;
    }
    html += `<div class="item" style="padding:8px;">
      <div class="row" style="justify-content:space-between;">
        <div>${t.title} <span class="muted">(${projName(t.projectId)})</span></div>
        <div class="muted">${t.status}</div>
      </div>
    </div>`;
  }
  if (currentDay) html += '</div>';
  list.innerHTML = html || `<div class="muted">No tasks due in this month.</div>`;
}

// Settings
async function getSetting(key){
  const s = await getAll('settings');
  const obj = s.find(x=>x.id===key);
  return obj ? obj.value : null;
}
async function setSetting(key,value){
  await put('settings',{id:key, value});
}

// Export/Import
async function exportData(){
  const dump = {};
  for (const s of stores){
    dump[s] = await getAll(s);
  }
  const blob = new Blob([JSON.stringify(dump,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'moto-refurb-export.json';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
async function importData(file){
  const text = await file.text();
  const data = JSON.parse(text);
  for (const s of Object.keys(data)){
    const arr = data[s];
    for (const obj of arr){
      await put(s, obj);
    }
  }
  await refreshAll();
}

// Install prompt (PWA)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  $('#installPrompt').classList.remove('hidden');
});
$('#installPromptBtn').onclick = async ()=>{
  if (!deferredPrompt) return;
  $('#installPrompt').classList.add('hidden');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
};
$('#installBtn').onclick = ()=> $('#installPromptBtn').click();

// File readers
function filesToDataURLs(files){
  return Promise.all(Array.from(files).map(file => new Promise(res=>{
    const fr = new FileReader();
    fr.onload = ()=> res({ name:file.name, type:file.type, data: fr.result });
    fr.readAsDataURL(file);
  })));
}

// Event listeners
document.addEventListener('DOMContentLoaded', async ()=>{
  await openDB();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('service-worker.js'); } catch {}
  }

  // Default settings
  if (!await getSetting('currency')) await setSetting('currency','£');

  // Tabs
  $$('.tab').forEach(t=> t.onclick = ()=> switchTab(t.dataset.tab));

  // Projects add
  $('#addProject').onclick = async ()=>{
    const proj = {
      id: uid(),
      title: $('#projTitle').value.trim(),
      reg: $('#projReg').value.trim(),
      status: $('#projStatus').value,
      notes: $('#projNotes').value.trim(),
      created: new Date().toISOString()
    };
    if (!proj.title) { alert('Project title required'); return; }
    await add('projects', proj);
    ['projTitle','projReg','projNotes'].forEach(id=> $('#'+id).value='');
    $('#projStatus').value='planning';
  };

  // Parts add
  $('#addPart').onclick = async ()=>{
    const part = {
      id: uid(),
      name: $('#partName').value.trim(),
      projectId: $('#partProject').value || '',
      status: $('#partStatus').value,
      supplier: $('#partSupplier').value.trim(),
      price: $('#partPrice').value,
      qty: $('#partQty').value || 1,
      due: $('#partDue').value,
      notes: $('#partNotes').value.trim(),
      created: new Date().toISOString()
    };
    if (!part.name) { alert('Part name required'); return; }
    await add('parts', part);
    const files = $('#partPhotos').files;
    if (files && files.length){
      const datas = await filesToDataURLs(files);
      for (const d of datas){
        await add('photos', { id: uid(), partId: part.id, data: d.data, name: d.name, type: d.type, created: new Date().toISOString() });
      }
      $('#partPhotos').value = '';
    }
    ['partName','partSupplier','partPrice','partQty','partDue','partNotes'].forEach(id=> $('#'+id).value='');
    $('#partStatus').value='needed';
    $('#partProject').value='';
  };

  // Tasks add
  $('#addTask').onclick = async ()=>{
    const task = {
      id: uid(),
      title: $('#taskTitle').value.trim(),
      projectId: $('#taskProject').value || '',
      due: $('#taskDue').value,
      priority: $('#taskPriority').value,
      status: $('#taskStatus').value,
      notes: $('#taskNotes').value.trim(),
      created: new Date().toISOString()
    };
    if (!task.title) { alert('Task title required'); return; }
    await add('tasks', task);
    ['taskTitle','taskDue','taskNotes'].forEach(id=> $('#'+id).value='');
    $('#taskPriority').value='med'; $('#taskStatus').value='todo'; $('#taskProject').value='';
  };

  // Filters and searches
  ['searchParts','filterByProj','filterByStatus'].forEach(id=> $('#'+id).addEventListener('input', renderParts));
  ['searchTasks','filterTaskProj','filterTaskStatus'].forEach(id=> $('#'+id).addEventListener('input', renderTasks));

  // Calendar
  $('#todayBtn').onclick = ()=> { $('#calMonth').value = new Date().toISOString().slice(0,7); renderCalendar(); };
  $('#calMonth').value = new Date().toISOString().slice(0,7);
  $('#calMonth').addEventListener('input', renderCalendar);

  // Settings
  $('#bizName').value = (await getSetting('bizName')) || '';
  $('#currency').value = (await getSetting('currency')) || '£';
  $('#bizName').addEventListener('change', ()=> setSetting('bizName', $('#bizName').value));
  $('#currency').addEventListener('change', ()=> setSetting('currency', $('#currency').value));
  $('#clearAll').onclick = async ()=> {
    if (!confirm('This will delete ALL data. Proceed?')) return;
    for (const s of stores) {
      const store = tx(s,'readwrite');
      store.clear();
    }
    setTimeout(refreshAll, 150);
  };

  // Export/Import
  $('#exportBtn').onclick = exportData;
  $('#importInput').addEventListener('change', async (e)=>{
    const f = e.target.files[0];
    if (f) await importData(f);
  });

  await refreshAll();
});

async function refreshAll(){
  await refreshProjectOptions();
  await renderProjects();
  await renderParts();
  await renderTasks();
  await renderCalendar();
}
