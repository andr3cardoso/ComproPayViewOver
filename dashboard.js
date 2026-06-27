// ── Supabase ──────────────────────────────────────────────────────────────────
// Inicialização defensiva: se o CDN não carregou, mostra erro claro em vez
// de quebrar o script inteiro (o que deixava a página travada nos skeletons).
let db = null;

function initSupabase() {
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    return false;
  }
  try {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  } catch (err) {
    console.error('[Supabase init]', err);
    return false;
  }
}

// ── Estado global ─────────────────────────────────────────────────────────────
let currentPage = 1;
let totalRows   = 0;
let tableLogs   = [];
let autoRefreshInterval = null;
const charts = {};

// ── Formatadores ──────────────────────────────────────────────────────────────
const fmtDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const fmtNum  = new Intl.NumberFormat('pt-BR');
function fmtMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { error: '⚠', success: '✓', warn: '⚡' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, type === 'error' ? 6000 : 4000);
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
function showTableSkeleton() {
  document.getElementById('logs-tbody').innerHTML = Array.from({ length: 6 }, () =>
    `<tr class="skeleton-row">${Array.from({ length: 10 }, () =>
      '<td><div class="skeleton-cell"></div></td>').join('')}</tr>`
  ).join('');
}

function showKpiSkeleton() {
  ['kpi-total','kpi-suspicious','kpi-threat-avg','kpi-latency','kpi-error-rate','kpi-threat-peak']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="skeleton-value"></div>';
    });
}

// Estado inicial vazio — sem skeletons, sem dados
function clearDashboard() {
  clearKpis();
  destroyAllCharts();
  setChartsEmpty('Configure os filtros e clique em Atualizar');
  totalRows = 0; tableLogs = [];
  document.getElementById('logs-tbody').innerHTML =
    `<tr><td colspan="10" class="empty-state">Configure os filtros acima e clique em <strong>Atualizar</strong></td></tr>`;
  renderPagination();
  setText('result-count', '—');
}

function clearKpis() {
  const zero = { 'kpi-total':'0', 'kpi-suspicious':'0', 'kpi-threat-avg':'0',
                 'kpi-latency':'0ms', 'kpi-error-rate':'0%', 'kpi-threat-peak':'0' };
  Object.entries(zero).forEach(([id, v]) => setText(id, v));
  setText('kpi-total-24h',      'últimas 24h: 0');
  setText('kpi-suspicious-pct', '0% do total');
  setText('kpi-threat-max',     'pico: 0');
  setText('kpi-latency-p95',    'p95: —');
  setText('kpi-error-count',    '0 erros (4xx + 5xx)');
  setText('kpi-threat-peak-ip', 'IP: —');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function animateCounter(id, target, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 500;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtNum.format(Math.round(target * e)) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Período ───────────────────────────────────────────────────────────────────
// Converte Date → string para input datetime-local (hora local, não UTC)
function toLocalInput(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function getActivePeriod() {
  const from = document.getElementById('filter-date-from').value;
  const to   = document.getElementById('filter-date-to').value;

  // Se os inputs estão preenchidos, usa eles
  if (from && to) {
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }

  // Fallback seguro: última 1 hora em UTC
  const now = new Date();
  return {
    from: new Date(now - 3_600_000).toISOString(),
    to:   now.toISOString(),
  };
}

// Preenche os inputs com o período rápido — NÃO dispara query.
// O usuário clica em "Atualizar" para carregar.
function setQuickPeriod(hours) {
  document.querySelectorAll('.quick-period-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.quick-period-btn[data-hours="${hours}"]`);
  if (btn) btn.classList.add('active');

  const now  = new Date();
  const from = hours === 'today'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now - Number(hours) * 3_600_000);

  document.getElementById('filter-date-from').value = toLocalInput(from);
  document.getElementById('filter-date-to').value   = toLocalInput(now);

  updatePeriodLabel();
  // Não chama loadAll() — usuário decide quando carregar
}

function updatePeriodLabel() {
  const from = document.getElementById('filter-date-from').value;
  const to   = document.getElementById('filter-date-to').value;
  const el   = document.getElementById('period-label');
  if (!el) return;
  if (from && to) {
    const fmt = d => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
    el.textContent = `${fmt(from)} → ${fmt(to)}`;
  } else {
    el.textContent = '—';
  }
}

// ── Filtros → query Supabase ──────────────────────────────────────────────────
function buildQuery(base) {
  const period = getActivePeriod();
  const method     = document.getElementById('filter-method').value;
  const status     = document.getElementById('filter-status').value;
  const authType   = document.getElementById('filter-auth').value;
  const ipClass    = document.getElementById('filter-ipclass').value;
  const suspicious = document.getElementById('filter-suspicious').value;
  const search     = document.getElementById('filter-search').value.trim();

  let q = base;

  // Período sempre aplicado
  q = q.gte('created_at', period.from).lte('created_at', period.to);

  if (method)               q = q.eq('method', method);
  if (authType)             q = q.eq('auth_type', authType);
  if (ipClass)              q = q.ilike('ip_class', ipClass);
  if (suspicious === 'yes') q = q.eq('is_suspicious', true);
  if (suspicious === 'no')  q = q.eq('is_suspicious', false);
  if (status === '2xx')     q = q.gte('status_code', 200).lt('status_code', 300);
  if (status === '3xx')     q = q.gte('status_code', 300).lt('status_code', 400);
  if (status === '4xx')     q = q.gte('status_code', 400).lt('status_code', 500);
  if (status === '5xx')     q = q.gte('status_code', 500);

  // ip_address é tipo inet → NÃO aceita ilike. Busca só em path (texto).
  // Se o termo parece um IP, filtra ip_address por eq.
  if (search) {
    const looksLikeIp = /^[\d.]+$/.test(search) || /^[0-9a-fA-F:]+$/.test(search);
    if (looksLikeIp) {
      q = q.eq('ip_address', search);
    } else {
      q = q.ilike('path', `%${search}%`);
    }
  }

  return q;
}

// ── Carga principal ───────────────────────────────────────────────────────────
async function loadAll() {
  // Sem cliente Supabase não há o que carregar
  if (!db) {
    showToast('Sem conexão com o Supabase. Recarregue a página.', 'error');
    return;
  }

  // Exige um período válido (datas preenchidas)
  const from = document.getElementById('filter-date-from').value;
  const to   = document.getElementById('filter-date-to').value;
  if (!from || !to) {
    showToast('Selecione o período (De / Até) antes de atualizar.', 'warn');
    return;
  }

  currentPage = 1;
  showKpiSkeleton();
  showTableSkeleton();
  destroyAllCharts();
  updatePeriodLabel();

  // Executa as 3 seções em paralelo; uma falha não afeta as outras
  await Promise.allSettled([
    loadKPIs(),
    loadTablePage(),
    loadChartsData(),
  ]);

  updateLastRefresh();
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
async function loadKPIs() {
  try {
    const period = getActivePeriod();

    const [resTotal, resSusp, resErrors, resPeak, resLat] = await Promise.all([
      // Count total
      buildQuery(db.from('api_log').select('*', { count: 'exact', head: true })),

      // Suspeitos com threat_score (máx 500 rows para calcular avg)
      buildQuery(db.from('api_log').select('threat_score', { count: 'exact' }))
        .eq('is_suspicious', true).limit(500),

      // Count erros
      buildQuery(db.from('api_log').select('*', { count: 'exact', head: true }))
        .gte('status_code', 400),

      // IP com maior threat_score
      buildQuery(db.from('api_log').select('threat_score,ip_address'))
        .eq('is_suspicious', true)
        .order('threat_score', { ascending: false })
        .limit(1),

      // Latência (máx 500 rows)
      buildQuery(db.from('api_log').select('response_time_ms'))
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const total     = resTotal.count  ?? 0;
    const errors    = resErrors.count ?? 0;
    const suspCount = resSusp.count   ?? 0;

    const scores    = (resSusp.data || []).map(r => r.threat_score || 0);
    const avgThreat = scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : 0;

    const peakRow   = resPeak.data?.[0];
    const peakScore = peakRow?.threat_score ?? 0;
    const peakIP    = peakRow?.ip_address   ?? '—';

    const lats      = (resLat.data || []).map(r => r.response_time_ms || 0);
    const avgLat    = lats.length ? Math.round(lats.reduce((a,b) => a+b,0) / lats.length) : 0;
    const p95Lat    = lats.length ? [...lats].sort((a,b)=>a-b)[Math.floor(lats.length * 0.95)] : 0;

    const errorRate = total ? ((errors / total) * 100).toFixed(1) : '0.0';

    // Últimas 24h (conta dentro das rows de latência buscadas — aproximação)
    const cutoff24h = Date.now() - 86_400_000;
    const last24h   = (resLat.data || []).filter(r => r.created_at && new Date(r.created_at) > cutoff24h).length;

    animateCounter('kpi-total',        total);
    animateCounter('kpi-suspicious',   suspCount);
    animateCounter('kpi-threat-avg',   avgThreat);
    animateCounter('kpi-latency',      avgLat, 'ms');
    animateCounter('kpi-threat-peak',  peakScore);
    setText('kpi-error-rate',          errorRate + '%');

    setText('kpi-total-24h',      `últimas 24h: ${fmtNum.format(last24h)}+`);
    setText('kpi-suspicious-pct', `${total ? ((suspCount/total)*100).toFixed(1) : '0'}% do total`);
    setText('kpi-threat-max',     `pico: ${peakScore}`);
    setText('kpi-threat-peak-ip', `IP: ${peakIP}`);
    setText('kpi-error-count',    `${fmtNum.format(errors)} erros (4xx + 5xx)`);
    setText('kpi-latency-p95',    `p95: ${fmtMs(p95Lat)}`);

  } catch (err) {
    console.error('[KPI]', err);
    showToast('Erro ao carregar KPIs: ' + err.message);
    clearKpis();
  }
}

// ── Tabela (server-side pagination) ──────────────────────────────────────────
async function loadTablePage() {
  showTableSkeleton();
  const from = (currentPage - 1) * TABLE_PAGE_SIZE;
  const to   = from + TABLE_PAGE_SIZE - 1;

  try {
    const { data, error, count } = await buildQuery(
      db.from('api_log').select('*', { count: 'exact' })
    ).order('created_at', { ascending: false }).range(from, to);

    if (error) throw error;

    totalRows = count ?? 0;
    tableLogs = data  ?? [];
    renderTable();
    renderPagination();
    setText('result-count', `${fmtNum.format(totalRows)} registros no período`);

  } catch (err) {
    console.error('[Tabela]', err);
    showToast('Erro ao carregar tabela: ' + err.message);
    totalRows = 0; tableLogs = [];
    document.getElementById('logs-tbody').innerHTML =
      `<tr><td colspan="10" class="empty-state">Erro: ${err.message}</td></tr>`;
    renderPagination();
    setText('result-count', '0 registros');
  }
}

function renderTable() {
  const tbody = document.getElementById('logs-tbody');
  if (tableLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Nenhum registro no período</td></tr>`;
    return;
  }

  tbody.innerHTML = tableLogs.map((log, idx) => {
    const code        = log.status_code || 0;
    const sCls        = code>=500?'status-5xx':code>=400?'status-4xx':code>=300?'status-3xx':'status-2xx';
    const mCls        = `method-${(log.method||'get').toLowerCase()}`;
    const latCls      = (log.response_time_ms||0)>1000?'latency-slow':(log.response_time_ms||0)>500?'latency-medium':'';
    const ipBadge     = log.ip_class
      ? `<span class="ipclass-badge ipclass-${log.ip_class.toLowerCase()}">${log.ip_class}</span>` : '—';
    const suspBadge   = log.is_suspicious
      ? `<span class="susp-badge">⚠ ${log.threat_score??''}</span>`
      : `<span class="safe-badge">✓</span>`;

    return `<tr class="log-row${log.is_suspicious?' row-suspicious':''}" data-idx="${idx}">
      <td title="${log.created_at||''}">${log.created_at ? fmtDate.format(new Date(log.created_at)) : '—'}</td>
      <td><span class="badge ${mCls}">${log.method||'—'}</span></td>
      <td class="endpoint-cell" title="${log.path||''}">${log.path||'—'}</td>
      <td class="mono">${log.ip_address||'—'}</td>
      <td>${ipBadge}</td>
      <td><span class="auth-badge">${log.auth_type||'—'}</span></td>
      <td><span class="badge ${sCls}">${code||'—'}</span></td>
      <td class="mono ${latCls}">${fmtMs(log.response_time_ms)}</td>
      <td class="mono">${log.threat_score!=null?log.threat_score:'—'}</td>
      <td>${suspBadge}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.log-row').forEach(tr =>
    tr.addEventListener('click', () => openDrawer(tableLogs[+tr.dataset.idx]))
  );
}

function renderPagination() {
  const total = Math.max(1, Math.ceil(totalRows / TABLE_PAGE_SIZE));
  document.getElementById('pagination').innerHTML = `
    <button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹ Anterior</button>
    <span class="page-info">Página ${currentPage} de ${total} (${fmtNum.format(totalRows)})</span>
    <button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===total?'disabled':''}>Próxima ›</button>`;
}

function goPage(page) {
  const total = Math.ceil(totalRows / TABLE_PAGE_SIZE);
  if (page < 1 || page > total) return;
  currentPage = page;
  document.getElementById('logs-table-wrapper').scrollTop = 0;
  loadTablePage();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function openDrawer(log) {
  if (!log) return;
  const fields = [
    ['ID', log.id], ['Data/Hora', log.created_at ? fmtDate.format(new Date(log.created_at)) : '—'],
    ['Método', log.method], ['Path', log.path], ['Auth Type', log.auth_type],
    ['App ID', log.app_id], ['IP Address', log.ip_address], ['IP Class', log.ip_class],
    ['Status Code', log.status_code], ['Tempo Resp.', fmtMs(log.response_time_ms)],
    ['Suspeito', log.is_suspicious ? 'Sim ⚠' : 'Não ✓'], ['Threat Score', log.threat_score ?? '—'],
  ];
  document.getElementById('drawer-body').innerHTML =
    fields.map(([l,v]) => `<div class="drawer-field">
      <div class="drawer-field-label">${l}</div>
      <div class="drawer-field-value">${v ?? '—'}</div>
    </div>`).join('') +
    (log.notes ? `<div class="drawer-field">
      <div class="drawer-field-label">Notas</div>
      <div class="drawer-notes">${log.notes}</div>
    </div>` : '');
  document.getElementById('event-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

function closeDrawer() {
  document.getElementById('event-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ── Gráficos ──────────────────────────────────────────────────────────────────
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
function destroyAllCharts() { Object.keys(charts).forEach(destroyChart); }

const TOOLTIP = { backgroundColor:'#0d1929', borderColor:'#1a2e4a', borderWidth:1 };
const TICK    = { color:'#556677', font:{size:10} };
const GRID    = { color:'rgba(255,255,255,0.04)' };

async function loadChartsData() {
  try {
    const { data, error } = await buildQuery(
      db.from('api_log')
        .select('created_at,is_suspicious,status_code,auth_type,ip_address,threat_score,path')
    ).order('created_at', { ascending: false }).limit(CHARTS_ROW_LIMIT);

    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) {
      setChartsEmpty('Sem dados no período selecionado');
      return;
    }
    if (rows.length === CHARTS_ROW_LIMIT) {
      showToast(`Gráficos: mostrando ${fmtNum.format(CHARTS_ROW_LIMIT)} registros mais recentes`, 'warn');
    }

    renderTimeline(rows);
    renderStatusDonut(rows);
    renderAuthDonut(rows);
    renderTopIPs(rows);
    renderTopPaths(rows);
    renderHeatmap(rows);

  } catch (err) {
    console.error('[Charts]', err);
    setChartsEmpty('Erro ao carregar gráficos: ' + err.message);
  }
}

function setChartsEmpty(msg) {
  ['chart-timeline','chart-status','chart-auth','chart-top-ips','chart-top-paths'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    c.style.visibility = 'hidden';
    const w = c.parentElement;
    if (!w.querySelector('.chart-empty-overlay')) {
      const o = document.createElement('div');
      o.className = 'chart-empty-overlay empty-state';
      o.textContent = msg;
      w.appendChild(o);
    }
  });
  const heat = document.getElementById('heatmap-container');
  if (heat) heat.innerHTML = `<div class="empty-state">${msg}</div>`;
}

function clearChartsEmpty() {
  ['chart-timeline','chart-status','chart-auth','chart-top-ips','chart-top-paths'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    c.style.visibility = 'visible';
    c.parentElement.querySelector('.chart-empty-overlay')?.remove();
  });
}

function renderTimeline(rows) {
  destroyChart('timeline');
  clearChartsEmpty();
  const b = {};
  rows.forEach(l => {
    if (!l.created_at) return;
    const d = new Date(l.created_at);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
    if (!b[k]) b[k] = { total:0, susp:0 };
    b[k].total++;
    if (l.is_suspicious) b[k].susp++;
  });
  const sorted = Object.entries(b).sort(([a],[c]) => a.localeCompare(c));
  const ctx = document.getElementById('chart-timeline')?.getContext('2d');
  if (!ctx) return;
  charts.timeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(([k]) => k.slice(-3)),
      datasets: [
        { label:'Total',     data: sorted.map(([,v])=>v.total), borderColor:'#00b4d8', backgroundColor:'rgba(0,180,216,0.08)', fill:true, tension:0.4, pointRadius:2 },
        { label:'Suspeitas', data: sorted.map(([,v])=>v.susp),  borderColor:'#ff4757', backgroundColor:'rgba(255,71,87,0.08)',  fill:true, tension:0.4, pointRadius:2 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{labels:{color:'#8899aa'}}, tooltip:TOOLTIP },
      scales:{ x:{ticks:{...TICK,maxTicksLimit:12},grid:GRID}, y:{ticks:TICK,grid:GRID,beginAtZero:true} },
    },
  });
}

function renderStatusDonut(rows) {
  destroyChart('status');
  const c = {2:0,3:0,4:0,5:0};
  rows.forEach(l => { const x = Math.floor((l.status_code||0)/100); if (c[x]!==undefined) c[x]++; });
  const ctx = document.getElementById('chart-status')?.getContext('2d');
  if (!ctx) return;
  charts.status = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:['2xx','3xx','4xx','5xx'], datasets:[{ data:Object.values(c), backgroundColor:['#00d9a0','#00b4d8','#f0a500','#ff4757'], borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{position:'right',labels:{color:'#8899aa',font:{size:11},padding:12}}, tooltip:TOOLTIP } },
  });
}

function renderAuthDonut(rows) {
  destroyChart('auth');
  const c = {};
  rows.forEach(l => { const a = l.auth_type||'Unknown'; c[a]=(c[a]||0)+1; });
  const sorted = Object.entries(c).sort(([,a],[,b])=>b-a);
  const ctx = document.getElementById('chart-auth')?.getContext('2d');
  if (!ctx) return;
  charts.auth = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:sorted.map(([k])=>k), datasets:[{ data:sorted.map(([,v])=>v), backgroundColor:['#00d9a0','#00b4d8','#a78bfa','#f0a500'], borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{position:'right',labels:{color:'#8899aa',font:{size:11},padding:10}}, tooltip:TOOLTIP } },
  });
}

function renderTopIPs(rows) {
  destroyChart('top-ips');
  const s = {};
  rows.filter(l=>l.is_suspicious).forEach(l => { const ip=l.ip_address||'?'; s[ip]=(s[ip]||0)+(l.threat_score||0); });
  const sorted = Object.entries(s).sort(([,a],[,b])=>b-a).slice(0,10);
  const canvas = document.getElementById('chart-top-ips');
  if (!canvas) return;

  if (!sorted.length) {
    canvas.style.visibility='hidden';
    if (!canvas.parentElement.querySelector('.chart-empty-overlay')) {
      const o=document.createElement('div'); o.className='chart-empty-overlay empty-state safe-text';
      o.textContent='Nenhuma ameaça no período ✓'; canvas.parentElement.appendChild(o);
    }
    return;
  }
  canvas.style.visibility='visible';
  canvas.parentElement.querySelector('.chart-empty-overlay')?.remove();

  charts['top-ips'] = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{ labels:sorted.map(([ip])=>ip), datasets:[{ label:'Threat Score', data:sorted.map(([,v])=>v), backgroundColor:'rgba(255,71,87,0.55)', borderColor:'#ff4757', borderWidth:1, borderRadius:4 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:TOOLTIP}, scales:{x:{ticks:TICK,grid:GRID,beginAtZero:true},y:{ticks:{color:'#8899aa',font:{size:10,family:'JetBrains Mono'}},grid:{display:false}}} },
  });
}

function renderTopPaths(rows) {
  destroyChart('top-paths');
  const c = {};
  rows.forEach(l => { const p=l.path||'?'; c[p]=(c[p]||0)+1; });
  const sorted = Object.entries(c).sort(([,a],[,b])=>b-a).slice(0,10);
  const ctx = document.getElementById('chart-top-paths')?.getContext('2d');
  if (!ctx) return;
  charts['top-paths'] = new Chart(ctx, {
    type:'bar',
    data:{ labels:sorted.map(([p])=>p), datasets:[{ label:'Requisições', data:sorted.map(([,v])=>v), backgroundColor:'rgba(0,180,216,0.45)', borderColor:'#00b4d8', borderWidth:1, borderRadius:4 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:TOOLTIP}, scales:{x:{ticks:TICK,grid:GRID,beginAtZero:true},y:{ticks:{color:'#8899aa',font:{size:10,family:'JetBrains Mono'}},grid:{display:false}}} },
  });
}

function renderHeatmap(rows) {
  const DAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const grid = Array.from({length:7},()=>new Array(24).fill(0));
  rows.forEach(l => {
    if (!l.created_at) return;
    const d = new Date(l.created_at);
    grid[d.getDay()][d.getHours()]++;
  });
  const max = Math.max(...grid.flat(), 1);
  const hours = '<div></div>' + Array.from({length:24},(_,h)=>
    `<div class="heatmap-col-label">${String(h).padStart(2,'0')}</div>`).join('');
  const rowsHTML = grid.map((row,di)=>
    `<div class="heatmap-row-label">${DAYS[di]}</div>` +
    row.map((v,h)=>{
      const a = v===0 ? 0.03 : 0.08+(v/max)*0.87;
      const color = v===0?'rgba(255,255,255,0.03)':`rgba(0,217,160,${a.toFixed(2)})`;
      return `<div class="heatmap-cell" style="background:${color}" title="${DAYS[di]} ${String(h).padStart(2,'0')}h: ${v}"></div>`;
    }).join('')
  ).join('');
  const heat = document.getElementById('heatmap-container');
  if (heat) heat.innerHTML = `<div class="heatmap">${hours}${rowsHTML}</div>`;
}

// ── Realtime ──────────────────────────────────────────────────────────────────
function initRealtime() {
  const dot = document.getElementById('realtime-dot');
  const lbl = document.getElementById('realtime-status');

  try {
    db.channel('api_log_rt')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'api_log' }, payload => {
        const log = payload.new;
        if (log.is_suspicious) {
          const msg = `⚡ IP: ${log.ip_address||'?'} | Score: ${log.threat_score||0} | ${log.path||'?'}`;
          showToast(msg, (log.threat_score||0) >= THREAT_ALERT_THRESHOLD ? 'warn' : 'error');
        }
        // Só recarrega KPIs e tabela (não gráficos, para não travar)
        loadKPIs();
        if (currentPage === 1) loadTablePage();
      })
      .subscribe(ev => {
        const ok = ev === 'SUBSCRIBED';
        dot?.classList.toggle('live', ok);
        if (lbl) lbl.textContent = ok ? 'Realtime: ON' : 'Realtime: OFF';
      });
  } catch (err) {
    console.warn('[Realtime] não disponível:', err.message);
    if (lbl) lbl.textContent = 'Realtime: OFF';
  }
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
function toggleAutoRefresh() {
  const btn = document.getElementById('auto-refresh-btn');
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    btn.textContent = 'Auto-refresh: OFF';
    btn.classList.remove('active');
  } else {
    autoRefreshInterval = setInterval(loadAll, 60_000);
    btn.textContent = 'Auto-refresh: 60s';
    btn.classList.add('active');
    showToast('Auto-refresh ativado (60s)', 'success');
  }
}

function updateLastRefresh() {
  setText('last-refresh', `Atualizado: ${new Intl.DateTimeFormat('pt-BR',{timeStyle:'medium'}).format(new Date())}`);
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!tableLogs.length) { showToast('Nenhum dado na página para exportar'); return; }
  const cols = ['id','created_at','method','path','auth_type','app_id','ip_address','ip_class','status_code','response_time_ms','is_suspicious','threat_score','notes'];
  const esc  = v => { const s=String(v??''); return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:s; };
  const csv  = [cols.join(','), ...tableLogs.map(l=>cols.map(c=>esc(l[c])).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})),
    download: `api_log_p${currentPage}_${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast(`${tableLogs.length} registros exportados`, 'success');
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initDashboard() {
  requireAuth();

  // Inicializa o cliente Supabase. Se o CDN não carregou, avisa e segue
  // (a página abre vazia, sem travar).
  const supaOk = initSupabase();
  if (!supaOk) {
    showToast('Biblioteca Supabase não carregou (verifique a conexão/CDN). A página abriu, mas não consultará dados.', 'error');
    const lbl = document.getElementById('realtime-status');
    if (lbl) lbl.textContent = 'Offline';
  }

  // Listeners — cada um protegido (se um elemento faltar, não derruba o resto)
  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

  on('logout-btn',       'click', logout);
  on('export-btn',       'click', exportCSV);
  on('drawer-close',     'click', closeDrawer);
  on('drawer-overlay',   'click', closeDrawer);
  on('auto-refresh-btn', 'click', toggleAutoRefresh);
  on('refresh-btn',      'click', loadAll);   // único gatilho de query

  on('clear-filters-btn', 'click', () => {
    document.querySelectorAll('#filter-bar input, #filter-bar select').forEach(el => el.value = '');
    document.querySelectorAll('.quick-period-btn').forEach(b => b.classList.remove('active'));
    updatePeriodLabel();
    clearDashboard();
  });

  // Datas só atualizam o label do período — não disparam query
  ['filter-date-from','filter-date-to'].forEach(id =>
    on(id, 'change', () => {
      document.querySelectorAll('.quick-period-btn').forEach(b => b.classList.remove('active'));
      updatePeriodLabel();
    })
  );

  // Pré-seleciona "1h" visualmente, sem carregar dados
  document.querySelector('.quick-period-btn[data-hours="1"]')?.classList.add('active');
  const now = new Date();
  const fromEl = document.getElementById('filter-date-from');
  const toEl   = document.getElementById('filter-date-to');
  if (fromEl) fromEl.value = toLocalInput(new Date(now - 3_600_000));
  if (toEl)   toEl.value   = toLocalInput(now);
  updatePeriodLabel();

  // Realtime em background, só se o client existir
  if (supaOk) initRealtime();
  else {
    const dot = document.getElementById('realtime-dot');
    if (dot) dot.classList.remove('live');
  }

  // Estado inicial vazio (sem skeletons girando)
  clearDashboard();
}

// Usa DOMContentLoaded (mais cedo que 'load') e captura qualquer erro
document.addEventListener('DOMContentLoaded', () => {
  try {
    initDashboard();
  } catch (err) {
    console.error('[Init]', err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff4757;color:#fff;padding:12px 16px;font-family:monospace;font-size:13px">
        Erro ao iniciar: ${err.message}
      </div>`);
  }
});
