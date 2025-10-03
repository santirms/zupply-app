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

let BUSY = false;
let currentAbort = null;

function setBusy(on, msg = 'Generando reporte…') {
  BUSY = !!on;
  const ov  = qs('#loading-overlay');
  const txt = qs('#loading-text');
  if (txt) txt.textContent = msg;
  if (ov) ov.classList.toggle('hidden', !on);

  // deshabilitar controles
  const btns = [
    ...qsa('button'),
    qs('#filtroCliente'),
    qs('#desde'),
    qs('#hasta')
  ].filter(Boolean);

  btns.forEach(b => b.disabled = on);
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

function getSelectedClientes() {
  const sel = qs('#filtroCliente');
  const values = Array.from(sel.selectedOptions).map(o => o.value).filter(v => v !== '');
  if (values.length === 0) return 'all'; // “Todos”
  return values.join(',');
}

// ====== Filtrar (trae envíos por fecha y aplica cliente opcional) ======
async function filtrar() {
  if (BUSY) return;
  const desde = qs('#desde').value;
  const hasta = qs('#hasta').value;
  const clientesParam = getSelectedClientes(); // 'all' o 'id1,id2'

  if (!desde || !hasta) {
    alert('Seleccioná rango de fechas.');
    return;
  }

  try {
    setBusy(true, 'Generando reporte de facturación…');

    // 1) Detalle para la tabla (preview envío x envío)
    const urlDetalle = `/facturacion/detalle?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&clientes=${encodeURIComponent(clientesParam)}`;
    const resDet = await fetch(urlDetalle, { cache:'no-store' });
    if (!resDet.ok) throw new Error('Error generando detalle');
    const det = await resDet.json();
    envios = det.items || [];
    pintarTabla();

    // 2) Resumen para el modal “Facturación”
    const urlResumen = `/facturacion/resumen?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}&clientes=${encodeURIComponent(clientesParam)}`;
    const resRes = await fetch(urlResumen, { cache:'no-store' });
    if (!resRes.ok) throw new Error('Error generando resumen');
    window.__FACT_RESUMEN__ = await resRes.json();

    // Total al pie: total GENERAL del resumen
    const info = qs('#total-info');
    const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    info.textContent = `Total general: $ ${nf.format(window.__FACT_RESUMEN__.totalGeneral || 0)} — Líneas: ${window.__FACT_RESUMEN__.lines?.length || 0}`;
  } catch (err) {
    console.error(err);
    alert('No se pudo generar el reporte.');
  } finally {
    setBusy(false);
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
    const precioNum = typeof e.precio === 'number' ? e.precio : 0;
    total += precioNum;
    const isZero = !precioNum || Number(precioNum) === 0;
    tr.className = 'hover:bg-slate-50 dark:hover:bg-white/10 ' + (isZero ? 'bg-red-50/60 dark:bg-red-900/20' : '');

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-white/10';
    tr.innerHTML = `
      <td class="px-4 py-2">${e.tracking || ''}</td>
      <td class="px-4 py-2">${e.cliente || ''}</td>
      <td class="px-4 py-2">${e.codigo_interno || ''}</td>
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
  const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (envios?.length) {
    // Exportar DETALLE
    const rows = envios.map(e => ({
      Tracking:      e.tracking || '',
      Cliente:       e.cliente || '',
      CodigoInterno: e.codigo_interno || '',
      SenderID:      e.sender_id || '',
      Partido:       e.partido || '',
      Zona:          e.zona || '',
      Precio:        typeof e.precio === 'number' ? e.precio : 0,
      Fecha:         e.fecha ? new Date(e.fecha).toLocaleDateString('es-AR') : ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['Tracking','Cliente','CodigoInterno','SenderID','Partido','Zona','Precio','Fecha'] });
    ws['!autofilter'] = { ref: `A1:H${rows.length + 1}` };
    ws['!cols'] = [{wch:16},{wch:24},{wch:14},{wch:14},{wch:18},{wch:14},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'Detalle');
    XLSX.writeFile(wb, `facturacion_detalle_${Date.now()}.xlsx`);
    return;
  }

  // Si no hay detalle, exporto RESUMEN
  const resumen = window.__FACT_RESUMEN__;
  if (resumen?.lines?.length) {
    const rows = resumen.lines.map(l => ({
      Cliente: l.cliente_nombre,
      Zona: l.zona_nombre,
      Cantidad: l.cantidad,
      PrecioUnit: l.precio_unit,
      Subtotal: l.subtotal
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['Cliente','Zona','Cantidad','PrecioUnit','Subtotal'] });
    ws['!autofilter'] = { ref: `A1:E${rows.length + 1}` };
    ws['!cols'] = [{wch:24},{wch:18},{wch:10},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'Resumen');
    XLSX.writeFile(wb, `facturacion_resumen_${Date.now()}.xlsx`);
    return;
  }

  alert('No hay datos para exportar.');
}
window.exportarExcel = exportarExcel;

// ====== Init ======
// ——— Atajos: Enter en filtros ———
function initShortcuts() {
  ['desde','hasta'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') filtrar();
    });
  });
  const sel = document.getElementById('filtroCliente');
  if (sel) {
    sel.addEventListener('keydown', e => {
      if (e.key === 'Enter') filtrar();
    });
  }
}
window.addEventListener('DOMContentLoaded', async () => {
  initTopbar();
  document.getElementById('anio').textContent = new Date().getFullYear();
  await cargarClientes();
  initShortcuts();
  // (opcional) podés disparar un filtrado inicial:
  // filtrar();
});

function openFactModal() {
  const modal = qs('#modal-facturacion');
  const body  = qs('#mf-body');
  const tot   = qs('#mf-total');
  const per   = qs('#mf-periodo');
  if (!window.__FACT_RESUMEN__) {
    alert('Primero generá el reporte con "Filtrar".');
    return;
  }
  const { period, lines = [], totalGeneral = 0 } = window.__FACT_RESUMEN__;

  per.textContent = `Período: ${period.desde} a ${period.hasta}`;
  body.innerHTML = '';
  const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  lines.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2">${l.cliente_nombre || ''}</td>
      <td class="px-3 py-2">${l.zona_nombre || ''}</td>
      <td class="px-3 py-2 text-right">${l.cantidad || 0}</td>
      <td class="px-3 py-2 text-right">$${nf.format(l.precio_unit || 0)}</td>
      <td class="px-3 py-2 text-right">$${nf.format(l.subtotal || 0)}</td>
    `;
    body.appendChild(tr);
  });
  tot.textContent = `TOTAL: $ ${nf.format(totalGeneral || 0)}`;

  modal.classList.remove('hidden');
}
function closeFactModal(){ qs('#modal-facturacion')?.classList.add('hidden'); }

window.addEventListener('DOMContentLoaded', () => {
  qs('#btnFacturacion')?.addEventListener('click', openFactModal);
  qs('#mf-close')?.addEventListener('click', closeFactModal);
});

// presupuesto (PDF)
qs('#btnPresupuesto')?.addEventListener('click', async () => {
  if (!window.__FACT_RESUMEN__) return;
  try {
    setBusy(true, 'Generando PDF de presupuesto…');
    const res = await fetch('/facturacion/presupuesto', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        periodo: window.__FACT_RESUMEN__.period,
        lines: window.__FACT_RESUMEN__.lines,
        totalGeneral: window.__FACT_RESUMEN__.totalGeneral
      })
    });
    if (!res.ok) throw new Error('Error generando PDF');
    // Abrimos el PDF en una pestaña
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    alert('No se pudo generar el PDF.');
  } finally {
    setBusy(false);
  }
});

// emitir (hook AFIP/ARCA)
qs('#btnEmitir')?.addEventListener('click', async () => {
  if (!window.__FACT_RESUMEN__) return;
  if (!confirm('¿Confirmás generar comprobantes electrónicos?')) return;
  try {
    setBusy(true, 'Preparando emisión…');
    const res = await fetch('/facturacion/emitir', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(window.__FACT_RESUMEN__) // mismo payload
    });
    const data = await res.json();
    alert(data?.message || 'Listo para emitir (hook ok).');
  } catch (e) {
    console.error(e);
    alert('No se pudo iniciar la emisión.');
  } finally {
    setBusy(false);
  }
});

