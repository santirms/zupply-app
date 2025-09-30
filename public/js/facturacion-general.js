// public/js/facturacion-general.js

// ====== Helpers / estado ======
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let envios = [];
let clientes = [];

// ====== Topbar: usuario + tema ======
function initTopbar() {
  // Usuario / menú
  (function userMenu(){
    const btn  = qs('#userBtn');
    const menu = qs('#userMenu');
    const wrap = qs('#userMenuWrap');
    if (btn && menu && wrap) {
      btn.addEventListener('click', ()=> menu.classList.toggle('hidden'));
      document.addEventListener('click', (e)=>{ if (!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async ()=>{
        try { await fetch('/auth/logout', { method:'POST' }); } catch {}
        try { localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); } catch {}
        location.href = '/auth/login';
      });
    }
    fetch('/me', { cache:'no-store' })
      .then(r => { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(me => {
        const name = me.name || me.username || me.email || 'Usuario';
        const u = qs('#username'); if (u) u.textContent = name;
        try { localStorage.setItem('zpl_username', name); } catch {}
      })
      .catch(()=> location.href='/auth/login');
  })();

  // Tema: light/dark/system
  (function themeToggle(){
    const order = ['light','dark','system'];
    const btn = qs('#themeBtn');
    if (!btn) return;
    const apply = (mode) => {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const wantDark = mode === 'dark' || (mode === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', wantDark);
      localStorage.setItem('zpl_theme', mode);
      btn.textContent = 'Tema: ' + (mode === 'system' ? 'auto' : mode);
    };
    apply(localStorage.getItem('zpl_theme') || 'system');
    btn.addEventListener('click', ()=>{
      const current = localStorage.getItem('zpl_theme') || 'system';
      const next = order[(order.indexOf(current)+1)%order.length];
      apply(next);
    });
  })();
}

// ====== Cargar clientes para el filtro ======
async function cargarClientes() {
  try {
    const res = await fetch('/clientes', { cache:'no-store' });
    if (!res.ok) throw new Error('Error cargando clientes');
    clientes = await res.json();
    const sel = qs('#filtroCliente');
    clientes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = c.nombre;
      sel.append(opt);
    });
  } catch (err) {
    console.error(err);
  }
}

// ====== Filtrar (trae envíos por fecha y aplica cliente opcional) ======
async function filtrar() {
  const desde = qs('#desde').value;
  const hasta = qs('#hasta').value;
  const clienteId = qs('#filtroCliente').value;

  if (!clienteId) {
    alert('Seleccioná un cliente para generar el preview.');
    return;
  }

  try {
    const url = `/facturacion/preview?clienteId=${encodeURIComponent(clienteId)}&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Error generando preview');
    const { items, total } = await res.json();

    envios = items; // ahora `envios` ya trae precio calculado, zona y partido
    pintarTabla();
    const info = qs('#total-info');
    const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    info.textContent = `Registros: ${envios.length} · Total facturado: $ ${nf.format(total)}`;
  } catch (err) {
    console.error(err);
    alert('No se pudo generar el preview de facturación.');
  }
}
window.filtrar = filtrar;


// ====== Render tabla + totales ======
function pintarTabla() {
  const tbody = qs('#tabla-body');
  tbody.innerHTML = '';

  let total = 0;
  envios.forEach(e => {
    const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString('es-AR') : '-';
    const cliente = e.cliente_id || {};
    const codigoInt = cliente.codigo_cliente || '';
    const precioNum = typeof e.precio === 'number' ? e.precio : 0;
    total += precioNum;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-white/10';
    tr.innerHTML = `
      <td class="px-4 py-2">${e.id_venta || e.meli_id || ''}</td>
      <td class="px-4 py-2">${cliente.nombre || ''}</td>
      <td class="px-4 py-2">${codigoInt}</td>
      <td class="px-4 py-2">${e.sender_id || ''}</td>
      <td class="px-4 py-2">${e.partido || ''}</td>
      <td class="px-4 py-2 text-right">$${precioNum.toFixed(2)}</td>
      <td class="px-4 py-2">${fecha}</td>
    `;
    tbody.appendChild(tr);
  });

  const info = qs('#total-info');
  const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  info.textContent = `Registros: ${envios.length} · Total facturado: $ ${nf.format(total)}`;
}

// ====== Exportar a Excel (.xlsx) con autofiltros ======
function exportarExcel() {
  if (!envios?.length) {
    return alert('No hay datos para exportar');
  }

  const rows = envios.map(e => ({
    Tracking:       e.id_venta || e.meli_id || '',
    Cliente:        e.cliente_id?.nombre || '',
    CodigoInterno:  e.cliente_id?.codigo_cliente || '',
    SenderID:       e.sender_id || '',
    Partido:        e.partido || '',
    Precio:         (typeof e.precio === 'number' ? e.precio : 0).toFixed(2),
    Fecha:          e.fecha ? new Date(e.fecha).toLocaleDateString('es-AR') : ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: [
    'Tracking','Cliente','CodigoInterno','SenderID','Partido','Precio','Fecha'
  ]});

  const totalRows = rows.length + 1; // encabezado + datos
  ws['!autofilter'] = { ref: `A1:G${totalRows}` };
  ws['!cols'] = [
    { wch: 16 }, // Tracking
    { wch: 24 }, // Cliente
    { wch: 14 }, // CodigoInterno
    { wch: 14 }, // SenderID
    { wch: 18 }, // Partido
    { wch: 12 }, // Precio
    { wch: 14 }  // Fecha
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Facturacion');
  XLSX.writeFile(wb, `facturacion_${Date.now()}.xlsx`);
}
window.exportarExcel = exportarExcel;

// ====== Atajos ======
function initShortcuts(){
  ['desde','hasta'].forEach(id=>{
    const el = qs('#'+id);
    if (!el) return;
    el.addEventListener('keydown', e => { if (e.key === 'Enter') filtrar(); });
  });
  const sel = qs('#filtroCliente');
  if (sel) sel.addEventListener('keydown', e => { if (e.key === 'Enter') filtrar(); });
}

// ====== Init ======
window.addEventListener('DOMContentLoaded', async () => {
  initTopbar();
  document.getElementById('anio').textContent = new Date().getFullYear();
  await cargarClientes();
  initShortcuts();
  // (opcional) podés disparar un filtrado inicial:
  // filtrar();
});
