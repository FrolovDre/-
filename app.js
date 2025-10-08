/* Feature Matrix · MVP-F — Vanilla JS
   — Статический UI с LocalStorage
   — Матрица фич × конкуренты, evidence drawer, экспорт CSV/MD
   — Шорткаты: Cmd/Ctrl+K, H, E, X
*/

// ---------- Storage & State ----------
const LS_KEY = "fmvpf_data_v1";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

/** @typedef {{ id:string, name:string, category:string, definition?:string, tags?:string[] }} Feature */
/** @typedef {{ id:string, name:string, logo?:string, geo?:string[], note?:string }} Competitor */
/** @typedef {{ type:'url'|'quote'|'screenshot', title:string, ref:string, addedAt:number }} Evidence */
/** @typedef {{ status:'present'|'partial'|'absent'|'unknown', evidence:Evidence[], confidence:number, lastSeenAt?:number }} Cell */
/** @typedef {{ id:string, name:string, competitors:string[], features:string[], cells:Record<string, Cell> }} Segment */

const DB = {
  segments: /** @type {Segment[]} */([]),
  features: /** @type {Feature[]} */([]),
  competitors: /** @type {Competitor[]} */([]),
  settings: { theme: 'dark', accent: '#5b8cfe', complianceOnly: false }
};

let current = {
  segmentId: '',
  view: 'matrix',
  heatmap: true,
  filterEvidenceOnly: false,
  activeCellKey: '' // ${segmentId}|${featureId}|${competitorId}
};

// ---------- Bootstrap ----------
init();

function init() {
  load();
  seedIfEmpty();
  applyTheme();
  initNav();
  initMatrixControls();
  initTaxonomy();
  initCompetitors();
  initSources();
  initExports();
  initShortcuts();
  renderAll();
}

// ---------- Persistence ----------
function save() { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(DB, JSON.parse(raw));
  } catch { /* noop */ }
}
function seedIfEmpty() {
  if (DB.features.length) return;

  // Seed features (финтех пресет)
  DB.features.push(
    { id:'f_onb_kyc', name:'Onboarding · KYC', category:'Onboarding', tags:['KYC','SCA'] },
    { id:'f_pay_paywall', name:'Paywall / Pricing', category:'Monetization', tags:['pricing'] },
    { id:'f_gw_ref', name:'Referral Program', category:'Growth', tags:['referral'] },
    { id:'f_crm_loyal', name:'Loyalty / Cashback', category:'CRM', tags:['loyalty','caps'] },
    { id:'f_p2p', name:'P2P Transfers', category:'Payments', tags:['p2p'] }
  );

  // Seed competitors
  DB.competitors.push(
    { id:'c_n26', name:'N26', geo:['EU'] },
    { id:'c_revolut', name:'Revolut', geo:['EU','US'] },
    { id:'c_monzo', name:'Monzo', geo:['UK'] },
    { id:'c_tinkoff', name:'Tinkoff', geo:['RU'] }
  );

  // Segment
  const seg = /** @type {Segment} */({
    id: 's_neobank_smb_emea',
    name: 'Необанки · SMB · EMEA',
    competitors: DB.competitors.map(c => c.id),
    features: DB.features.map(f => f.id),
    cells: {}
  });

  // Seed cells with sample evidence
  setCell(seg, 'f_onb_kyc', 'c_n26', { status:'present', confidence:.8, evidence:[
    { type:'screenshot', title:'KYC stepper', ref:'https://example.com/n26-kyc.png', addedAt:Date.now()-86400000 },
    { type:'url', title:'Help: KYC', ref:'https://n26.com/help/kyc', addedAt:Date.now()-800000 }
  ]});
  setCell(seg, 'f_pay_paywall', 'c_revolut', { status:'partial', confidence:.6, evidence:[
    { type:'url', title:'Pricing', ref:'https://www.revolut.com/pricing/', addedAt:Date.now()-7200000 }
  ]});
  setCell(seg, 'f_gw_ref', 'c_monzo', { status:'absent', confidence:.4, evidence:[] });
  setCell(seg, 'f_crm_loyal', 'c_tinkoff', { status:'present', confidence:.9, evidence:[
    { type:'url', title:'Tinkoff Pro', ref:'https://www.tinkoff.ru/cards/pro/', addedAt:Date.now()-3600000 },
    { type:'quote', title:'Cashback tiers', ref:'Кэшбэк до 15% у партнёров', addedAt:Date.now()-3600000 }
  ]});
  setCell(seg, 'f_p2p', 'c_revolut', { status:'present', confidence:.85, evidence:[
    { type:'url', title:'P2P help', ref:'https://www.revolut.com/help/p2p', addedAt:Date.now()-560000 }
  ]});

  DB.segments.push(seg);
  current.segmentId = seg.id;
  save();
}
function setCell(seg, featureId, competitorId, cellPartial) {
  const key = cellKey(seg.id, featureId, competitorId);
  seg.cells[key] = Object.assign({ status:'unknown', evidence:[], confidence:.5, lastSeenAt: Date.now() }, cellPartial);
}

function cellKey(segId, fId, cId){ return ${segId}|${fId}|${cId}; }

// ---------- Rendering ----------
function renderAll() {
  renderSegmentSelect();
  highlightNav();
  renderView(current.view);
  updateKPIs();
}

function renderSegmentSelect() {
  const sel = $('#segmentSelect');
  sel.innerHTML = DB.segments.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (!current.segmentId) current.segmentId = DB.segments[0]?.id || '';
  sel.value = current.segmentId;
  sel.onchange = () => { current.segmentId = sel.value; renderAll(); toast('Сегмент переключен'); };
}

function renderView(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  switch (view) {
    case 'matrix': renderMatrix(); break;
    case 'taxonomy': renderTaxonomy(); break;
    case 'competitors': renderCompetitors(); break;
    case 'sources': renderSources(); break;
  }
}

function renderMatrix() {
  const seg = getSeg(); if (!seg) return;
  const feats = seg.features.map(id => DB.features.find(f=>f.id===id)).filter(Boolean);
  const comps = seg.competitors.map(id => DB.competitors.find(c=>c.id===id)).filter(Boolean);

  // Thead
  const thead = $('#matrix-thead');
  thead.innerHTML = `
    <tr>
      <th class="feat">Фича</th>
      ${comps.map(c => `<th title="${escapeHtml(c.note||'')}">${escapeHtml(c.name)}</th>`).join('')}
    </tr>`;

  // Tbody
  const tbody = $('#matrix-tbody');
  tbody.innerHTML = '';
  for (const f of feats) {
    const tr = document.createElement('tr');
    tr.innerHTML = <th class="feat"><div><strong>${escapeHtml(f.name)}</strong><div class="muted">${escapeHtml(f.category)}</div></div></th>;
    for (const c of comps) {
      const key = cellKey(seg.id, f.id, c.id);
      const cell = seg.cells[key] || { status:'unknown', evidence:[], confidence:.5 };
      const evCount = cell.evidence?.length || 0;
      const evMeta = evCount ?  · ${evCount} pr. : '';
      const statusClass = s-${cell.status};
      const heatClass = current.heatmap ?  heat-${cell.status} : '';
      const hasEvidence = evCount>0;

      if (current.filterEvidenceOnly && !hasEvidence) {
        tr.insertAdjacentHTML('beforeend', `<td class="${heatClass}"></td>`);
        continue;
      }

      tr.insertAdjacentHTML('beforeend', `
        <td class="${heatClass}">
          <button class="status ${statusClass}" data-key="${key}" aria-haspopup="dialog" title="Открыть доказательства (E)">
            <span class="dot"></span>
            <span class="label">${labelForStatus(cell.status)}</span>
            <span class="meta">${hasEvidence? evMeta : ''}</span>
          </button>
        </td>
      `);
    }
    tbody.appendChild(tr);
  }

  // Cell click → drawer
  $$('#matrix .status').forEach(btn => {
    btn.onclick = () => { current.activeCellKey = btn.dataset.key; openDrawer(); };
  });
}

function labelForStatus(s) {
  return s==='present' ? 'Present'
    : s==='partial' ? 'Partial'
    : s==='absent' ? 'Absent'
    : 'Unknown';
}

function updateKPIs() {
  const seg = getSeg(); if (!seg) return;
  const comps = seg.competitors.length, feats = seg.features.length;
  let filled = 0, evidenceCells = 0, total = comps * feats;
  for (const fId of seg.features) for (const cId of seg.competitors) {
    const cell = seg.cells[cellKey(seg.id, fId, cId)];
    if (cell && cell.status !== 'unknown') filled++;
    if (cell && cell.evidence?.length) evidenceCells++;
  }
  const completeness = total ? Math.round((filled/total)*100) : 0;
  const evidence = total ? Math.round((evidenceCells/total)*100) : 0;

  $('#kpi-completeness').textContent = completeness + '%';
  $('#kpi-evidence').textContent = evidence + '%';
  $('#kpi-refresh').textContent = new Date().toLocaleString();
}

// ---------- Evidence Drawer ----------
function openDrawer() {
  const seg = getSeg();
  const key = current.activeCellKey;
  if (!seg || !key) return;

  const [, fId, cId] = key.split('|');
  const f = DB.features.find(x=>x.id===fId);
  const c = DB.competitors.find(x=>x.id===cId);
  const cell = seg.cells[key] || (seg.cells[key] = { status:'unknown', evidence:[], confidence:.5 });

  $('#drawer-meta').innerHTML =
    `<div><strong>${escapeHtml(f?.name||'')}</strong> × <strong>${escapeHtml(c?.name||'')}</strong></div>
     <div class="muted">Статус: ${labelForStatus(cell.status)} · Evidence: ${cell.evidence.length}</div>`;

  renderEvidenceList(cell);

  $('#evidence-form').onsubmit = (e) => {
    e.preventDefault();
    const type = $('#ev-type').value;
    const title = $('#ev-title').value.trim();
    const ref = $('#ev-ref').value.trim();
    if (!title || !ref) { toast('Заполните заголовок и ссылку/текст'); return; }
    cell.evidence.push({ type, title, ref, addedAt: Date.now() });
    cell.lastSeenAt = Date.now();
    save(); renderEvidenceList(cell); renderMatrix(); updateKPIs();
    $('#ev-title').value=''; $('#ev-ref').value='';
  };

  $('#btn-to-jira').onclick = () => {
    const md = jiraSnippet(seg, f, c, cell);
    navigator.clipboard.writeText(md).then(()=>toast('Скопировано для Jira'));
  };

  const drawer = $('#evidence-drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  $('#btn-close-drawer').onclick = closeDrawer;
}
function closeDrawer(){
  const drawer = $('#evidence-drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden','true');
}
function renderEvidenceList(cell){
  const ul = $('#evidence-list');
  ul.innerHTML = cell.evidence.map((ev,i)=>`
    <li class="evidence-item">
      <div class="badge">${ev.type.toUpperCase()} · ${new Date(ev.addedAt).toLocaleString()}</div>
      <div><strong>${escapeHtml(ev.title)}</strong></div>
      <div class="muted">${ev.type==='quote' ? escapeHtml(ev.ref) : `<a href="${escapeAttr(ev.ref)}" target="_blank" rel="noopener">${escapeHtml(ev.ref)}</a>`}</div>
      <div><button class="ghost" data-idx="${i}">Удалить</button></div>
    </li>
  `).join('');
  $$('button[data-idx]', ul).forEach(btn=>{
    btn.onclick = () => {
      const idx = +btn.dataset.idx;
      cell.evidence.splice(idx,1);
      save(); renderEvidenceList(cell); renderMatrix(); updateKPIs();
    };
  });
}
function jiraSnippet(seg, f, c, cell){
  const lines = [];
  lines.push(`EPIC: Benchmark — ${f?.name} @ ${c?.name}`);
  lines.push(`Acceptance:`);
  lines.push(`- Evidence coverage ≥ 1 source`);
  for (const ev of cell.evidence) {
    lines.push(`- [${ev.type.toUpperCase()}] ${ev.title}: ${ev.ref}`);
  }
  lines.push(`Segment: ${seg.name}`);
  return lines.join('\n');
}

// ---------- Controls / Views ----------
function initNav(){
  $$('.nav-btn').forEach(btn=>{
    btn.onclick = () => {
      current.view = btn.dataset.view;
      highlightNav(); renderView(current.view);
    };
  });
}
function highlightNav(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===current.view));
}
function initMatrixControls(){
  $('#btn-heat-toggle').onclick = () => { current.heatmap = !current.heatmap; renderMatrix(); };
  $('#filter-evidence').onchange = (e) => { current.filterEvidenceOnly = e.target.checked; renderMatrix(); };
  $('#btn-add-feature').onclick = () => quickAddFeature();
  $('#btn-add-competitor').onclick = () => quickAddCompetitor();
}
function quickAddFeature(){
  const name = prompt('Название фичи'); if (!name) return;
  const category = prompt('Категория (напр., Onboarding/Payments)') || 'General';
  const id = 'f_' + slug(name);
  DB.features.push({ id, name, category });
  const seg = getSeg(); seg.features.push(id);
  save(); renderView('taxonomy'); toast('Фича добавлена');
}
function quickAddCompetitor(){
  const name = prompt('Название конкурента'); if (!name) return;
  const id = 'c_' + slug(name);
  DB.competitors.push({ id, name });
  const seg = getSeg(); seg.competitors.push(id);
  save(); renderView('competitors'); toast('Конкурент добавлен');
}

// Taxonomy
function initTaxonomy(){ /* no-op */ }
function renderTaxonomy(){
  const seg = getSeg(); if (!seg) return;
  const wrap = $('#taxonomy-cards'); wrap.innerHTML = '';
  for (const fId of seg.features){
    const f = DB.features.find(x=>x.id===fId); if (!f) continue;
    const el = document.createElement('div'); el.className='card';
    el.innerHTML = `
      <h3>${escapeHtml(f.name)}</h3>
      <div class="muted">${escapeHtml(f.category)}</div>
      <label>Описание <textarea data-id="${f.id}" rows="3" placeholder="Короткое определение">${escapeHtml(f.definition||'')}</textarea></label>
      <div class="row">
        <button class="ghost" data-del="${f.id}">Удалить</button>
      </div>`;
    wrap.appendChild(el);
  }
  $$('textarea[data-id]', wrap).forEach(t=>{
    t.onchange = () => {
      const f = DB.features.find(x=>x.id===t.dataset.id);
      if (f) { f.definition = t.value; save(); toast('Сохранено'); }
    };
  });
  $$('button[data-del]', wrap).forEach(btn=>{
    btn.onclick = () => {
      const id = btn.dataset.del;
      const seg = getSeg();
      seg.features = seg.features.filter(x=>x!==id);
      save(); renderTaxonomy(); renderMatrix(); updateKPIs();
    };
  });
}

// Competitors
function initCompetitors(){ /* no-op */ }
function renderCompetitors(){
  const seg = getSeg(); if (!seg) return;
  const wrap = $('#competitor-cards'); wrap.innerHTML = '';
  for (const cId of seg.competitors) {
    const c = DB.competitors.find(x=>x.id===cId); if (!c) continue;
    const el = document.createElement('div'); el.className='card';
    el.innerHTML = `
      <h3>${escapeHtml(c.name)}</h3>
      <div class="muted">${(c.geo||[]).join(', ')||'—'}</div>
      <label>Заметка <input data-id="${c.id}" type="text" value="${escapeAttr(c.note||'')}" placeholder="ICP/гео/прочее"></label>
      <div class="row">
        <button class="ghost" data-del="${c.id}">Удалить</button>
      </div>`;
    wrap.appendChild(el);
  }
  $$('input[data-id]', wrap).forEach(inp=>{
    inp.onchange = () => {
      const c = DB.competitors.find(x=>x.id===inp.dataset.id);
      if (c) { c.note = inp.value; save(); toast('Сохранено'); }
    };
  });
  $$('button[data-del]', wrap).forEach(btn=>{
    btn.onclick = () => {
      const id = btn.dataset.del;
      const seg = getSeg();
      seg.competitors = seg.competitors.filter(x=>x!==id);
      save(); renderCompetitors(); renderMatrix(); updateKPIs();
    };
  });
}

// Sources (simple: показываем все URL evidence как источники)
function initSources(){ /* no-op */ }
function gatherSources(){
  const seg = getSeg(); if (!seg) return [];
  const out = [];
  for (const key of Object.keys(seg.cells)) {
    const cell = seg.cells[key];
    for (const ev of cell.evidence||[]) {
      out.push({ type: ev.type, title: ev.title, ref: ev.ref, fresh: daysAgo(ev.addedAt) + 'd', allow: true });
    }
  }
  return out;
}
function renderSources(){
  const rows = gatherSources().map((s,i)=>`
    <tr>
      <td>${s.type}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${s.type==='quote' ? escapeHtml(s.ref) : `<a href="${escapeAttr(s.ref)}" target="_blank">${escapeHtml(s.ref)}</a>`}</td>
      <td>${s.fresh}</td>
      <td><input type="checkbox" checked /></td>
      <td><button class="ghost" data-i="${i}">Удалить</button></td>
    </tr>`).join('');
  $('#sources-table tbody').innerHTML = rows || <tr><td colspan="6" class="muted">Пока нет источников</td></tr>;
}

// Exports
function initExports(){
  $('#btn-export-csv').onclick = () => exportCSV();
  $('#btn-export-md').onclick = () => exportMarkdown();
  $('#btn-export').onclick = () => exportMarkdown();
}

function exportCSV(){
  const seg = getSeg(); if (!seg) return;
  const feats = seg.features.map(id => DB.features.find(f=>f.id===id)).filter(Boolean);
  const comps = seg.competitors.map(id => DB.competitors.find(c=>c.id===id)).filter(Boolean);

  // Matrix CSV
  const header = ['Feature / Competitor', ...comps.map(c=>c.name)];
  const lines = [csvRow(header)];
  for (const f of feats) {
    const row = [f.name];
    for (const c of comps) {
      const cell = seg.cells[cellKey(seg.id, f.id, c.id)];
      row.push(cell? cell.status : 'unknown');
    }
    lines.push(csvRow(row));
  }
  downloadBlob(lines.join('\n'), feature-matrix_${slug(seg.name)}.csv, 'text/csv;charset=utf-8');

  // Evidence CSV
  const evRows = [['Feature','Competitor','Type','Title','Ref','AddedAt']];
  for (const f of feats) for (const c of comps) {
    const cell = seg.cells[cellKey(seg.id, f.id, c.id)];
    if (!cell) continue;
    for (const ev of (cell.evidence||[])) {
      evRows.push([f.name, c.name, ev.type, ev.title, ev.ref, new Date(ev.addedAt).toISOString()]);
    }
  }
  downloadBlob(evRows.map(csvRow).join('\n'), evidence_${slug(seg.name)}.csv, 'text/csv;charset=utf-8');
  toast('CSV выгружены');
}

function exportMarkdown(){
  const seg = getSeg(); if (!seg) return;
  const { md } = buildGammaMarkdown(seg);
  downloadBlob(md, deck_${slug(seg.name)}.md, 'text/markdown;charset=utf-8');
  toast('Gamma Markdown выгружен');
}

function buildGammaMarkdown(seg){
  const feats = seg.features.map(id => DB.features.find(f=>f.id===id)).filter(Boolean);
  const comps = seg.competitors.map(id => DB.competitors.find(c=>c.id===id)).filter(Boolean);

  const completeness = $('#kpi-completeness').textContent;
  const evidence = $('#kpi-evidence').textContent;

  const lines = [];
  // Executive
  lines.push(`# Executive Summary`);
  lines.push(`- Матрица по сегменту: **${seg.name}**`);
  lines.push(`- Completeness: ${completeness}, Evidence coverage: **${evidence}**`);
  lines.push(`- Топ-пробелы и возможности выделены на слайдах ниже`);
  lines.push(`Источник(и): product sites/FAQ/store, см. приложение`);

  // Heatmap summary (текст)
  lines.push(`\n# Heatmap Summary`);
  for (const f of feats) {
    const presentCount = comps.reduce((n,c)=>{
      const cell = seg.cells[cellKey(seg.id, f.id, c.id)];
      return n + ((cell && cell.status==='present')?1:0);
    },0);
    lines.push(`- ${f.name}: у ${presentCount}/${comps.length} конкурентов`);
  }
  lines.push(`Источник(и): сводная матрица MVP-F`);

  // Evidence appendix
  lines.push(`\n# Evidence Appendix`);
  for (const f of feats) for (const c of comps) {
    const cell = seg.cells[cellKey(seg.id, f.id, c.id)];
    if (!cell || !(cell.evidence||[]).length) continue;
    lines.push(`\n## ${f.name} × ${c.name}`);
    for (const ev of cell.evidence) {
      const ref = ev.type==='quote' ? ev.ref : <${ev.ref}>;
      lines.push(`- ${ev.type.toUpperCase()} — ${ev.title}: ${ref}`);
    }
    lines.push(`Источник(и): см. ссылки выше`);
  }

  return { md: lines.join('\n') };
}

// ---------- Command Palette ----------
const COMMANDS = [
  { id:'add-competitor', label:'Добавить конкурента', run: ()=>quickAddCompetitor() },
  { id:'add-feature', label:'Добавить фичу', run: ()=>quickAddFeature() },
  { id:'toggle-heat', label:'Переключить Heatmap', run: ()=>{ current.heatmap=!current.heatmap; renderMatrix(); } },
  { id:'export-md', label:'Экспорт Gamma Markdown', run: ()=>exportMarkdown() },
  { id:'export-csv', label:'Экспорт CSV', run: ()=>exportCSV() },
  { id:'open-matrix', label:'Открыть Matrix', run: ()=>{ current.view='matrix'; renderAll(); } },
  { id:'open-taxonomy', label:'Открыть Taxonomy', run: ()=>{ current.view='taxonomy'; renderAll(); } },
  { id:'open-competitors', label:'Открыть Competitors', run: ()=>{ current.view='competitors'; renderAll(); } },
];

function initShortcuts(){
  // Theme
  $('#btn-theme').onclick = toggleTheme;
  $('#brand-accent').onchange = (e)=> {
    DB.settings.accent = e.target.value;
    document.documentElement.style.setProperty('--accent', DB.settings.accent);
    save();
  };
  $('#compliance-mode').onchange = (e)=> { DB.settings.complianceOnly = e.target.checked; save(); toast('Compliance mode: '+(e.target.checked?'ON':'OFF')); };

  // Command palette
  $('#btn-cmd').onclick = openCmd;
  document.addEventListener('keydown', (e)=>{
    const k = e.key.toLowerCase();
    const meta = e.ctrlKey || e.metaKey;
    if (meta && k==='k') { e.preventDefault(); openCmd(); }
    if (k==='h' && !isModalOpen()) { e.preventDefault(); current.heatmap=!current.heatmap; renderMatrix(); }
    if (k==='x' && !isModalOpen()) { e.preventDefault(); exportMarkdown(); }
    if (k==='e' && !isModalOpen() && current.view==='matrix') {
      e.preventDefault();
      const first = $('#matrix .status');
      if (first){ first.click(); }
    }
    if (k==='escape'){
      closeDrawer(); closeCmd();
    }
  });
}

function openCmd(){
  const modal = $('#cmd-palette'); modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  const input = $('#cmd-input'); const list = $('#cmd-list');
  input.value = ''; input.focus();
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const items = COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));
    list.innerHTML = items.map(c=>`<li tabindex="0" data-id="${c.id}">${c.label}</li>`).join('') || <li class="muted">Нет команд</li>;
    $$('li[data-id]', list).forEach(li=>{
      li.onclick = ()=> { const cmd = COMMANDS.find(x=>x.id===li.dataset.id); if (cmd){ cmd.run(); closeCmd(); } };
      li.onkeydown = (e)=> { if (e.key==='Enter'){ li.click(); } };
    });
  };
  input.oninput = render;
  render();
}
function closeCmd(){ const modal = $('#cmd-palette'); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
function isModalOpen(){ return $('#cmd-palette').classList.contains('open'); }

// ---------- Helpers ----------
function getSeg(){ return DB.segments.find(s=>s.id===current.segmentId); }
function toast(msg){
  const box = $('#toasts'); const el = document.createElement('div');
  el.className='toast'; el.textContent = msg;
  box.appendChild(el); setTimeout(()=>el.remove(), 3000);
}
function csvRow(arr){ return arr.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(','); }
function downloadBlob(content, name, type){
  const blob = new Blob([content], {type});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function slug(s){ return s.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu,'-').replace(/^-+|-+$/g,''); }
function daysAgo(ts){ return Math.max(0, Math.floor((Date.now()-ts)/86400000)); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }

function applyTheme(){
  const root = document.documentElement;
  if (DB.settings.theme==='light') root.classList.add('light'); else root.classList.remove('light');
  root.style.setProperty('--accent', DB.settings.accent || '#5b8cfe');
}
function toggleTheme(){
  DB.settings.theme = (DB.settings.theme==='dark' ? 'light' : 'dark');
  applyTheme(); save();
}
