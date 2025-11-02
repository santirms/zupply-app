// public/js/clientes.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let BASE = ''; const CANDIDATES = ['', '/api'];
const apiURL  = p => `${BASE}${p}`;
const API_CLIENTES = () => apiURL('/clientes');
const API_LISTAS   = () => apiURL('/listas-de-precios');

// --------- helpers ---------
async function detectBase() {
  for (const pre of CANDIDATES) {
    try { const r = await fetch(`${pre}/clientes`, { method:'GET' }); if (r.ok) { BASE = pre; return; } } catch {}
  }
}
async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); alert('Enlace copiado ✅'); }
  catch { prompt('Copiá el enlace:', text); }
}

// --------- topbar (usuario + tema) ---------
function initTopbar(){
  // usuario
  (function(){
    const btn=qs('#userBtn'), menu=qs('#userMenu'), wrap=qs('#userMenuWrap');
    if(btn&&menu&&wrap){
      btn.addEventListener('click', ()=>menu.classList.toggle('hidden'));
      document.addEventListener('click', e=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    qs('#logoutBtn')?.addEventListener('click', async ()=>{
      try { await fetch('/auth/logout', { method:'POST' }); } catch {}
      try { localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); } catch {}
      location.href='/auth/login';
    });
    fetch('/me',{cache:'no-store'})
      .then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(me=>{ const n=me.name||me.username||me.email||'Usuario'; const u=qs('#username'); if(u) u.textContent=n; })
      .catch(()=> location.href='/auth/login');
  })();

  // tema
  (function(){
    const order=['light','dark','system']; const btn=qs('#themeBtn');
    if(!btn) return;
    const apply=(mode)=>{
      const prefersDark=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const wantDark=(mode==='dark')||(mode==='system'&&prefersDark);
      document.documentElement.classList.toggle('dark', wantDark);
      localStorage.setItem('zpl_theme', mode);
      btn.textContent='Tema: ' + (mode==='system'?'auto':mode);
    };
    apply(localStorage.getItem('zpl_theme')||'system');
    btn.addEventListener('click', ()=>{
      const cur=localStorage.getItem('zpl_theme')||'system';
      const next=order[(order.indexOf(cur)+1)%order.length];
      apply(next);
    });
  })();

  // footer año
  const y=qs('#anio'); if(y) y.textContent = new Date().getFullYear();
}

// --------- init ---------
window.addEventListener('DOMContentLoaded', init);
async function init() {
  try {
    initTopbar();
    await detectBase();
    await cargarListasPrecios();
    await cargarClientes();
    configurarModal();
  } catch (e) {
    console.error('Error en init:', e);
  }
}

// --------- data ---------
async function cargarListasPrecios() {
  try {
    const listas = await fetchJSON(API_LISTAS());
    const sel = qs('#selectListasPrecios');
    if (!sel) return;
    sel.innerHTML = [
      '<option value="">-- Seleccionar --</option>',
      ...listas.map(l => `<option value="${l._id}">${l.nombre}</option>`)
    ].join('');
  } catch (e) {
    console.error('Error al cargar listas de precios:', e);
  }
}

async function cargarClientes() {
  try {
    const clientes = await fetchJSON(API_CLIENTES());
    const tbody = qs('#clientes-body'); if (!tbody) return;

    if (!clientes.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 opacity-70">No hay clientes</td></tr>`;
      return;
    }

    tbody.innerHTML = clientes.map(c => `
      <tr class="hover:bg-slate-50 dark:hover:bg-white/10">
        <td class="px-4 py-2">${c.codigo_cliente||''}</td>
        <td class="px-4 py-2">${c.nombre||''}</td>
        <td class="px-4 py-2">${c.cuit||''}</td>
        <td class="px-4 py-2">${c.razon_social||''}</td>
        <td class="px-4 py-2">${c.condicion_iva||''}</td>
        <td class="px-4 py-2">${c.horario_de_corte||''}</td>
        <td class="px-4 py-2">${c.lista_precios?.nombre||''}</td>
        <td class="px-4 py-2 space-x-2">
          <button onclick="abrirModal('${c._id}')" class="px-2 py-1 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10">✏️</button>
          <button onclick="borrarCliente('${c._id}')" class="px-2 py-1 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">🗑️</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error al cargar clientes:', e);
  }
}

// --------- modal ---------
function configurarModal() {
  const tabBtns = qsa('[data-tab]');
  const panes = { general: qs('#tab-general'), cuentas: qs('#tab-cuentas') };

  const activate = (btn) => {
    tabBtns.forEach(b => {
      b.classList.remove('border-b-2','border-amber-600','text-amber-700','dark:text-amber-300');
      b.classList.add('text-slate-600','dark:text-slate-300');
    });
    btn.classList.remove('text-slate-600','dark:text-slate-300');
    btn.classList.add('border-b-2','border-amber-600','text-amber-700','dark:text-amber-300');
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.tab;
      Object.entries(panes).forEach(([k, el]) => el?.classList.toggle('hidden', k !== sel));
      activate(btn);
    });
  });

  qs('#btnNuevo')?.addEventListener('click', () => abrirModal());
  qs('#btnCerrar')?.addEventListener('click', cerrarModal);
  qs('#btnAgregarCuenta')?.addEventListener('click', () => agregarSenderInput());

  qs('#formCliente')?.addEventListener('submit', guardarCliente);

  const chkAI = qs('#chkAutoIngesta');
  if (chkAI) {
    chkAI.addEventListener('change', async () => {
      const id = qs('input[name="id"]').value;
      try {
        await fetchJSON(`${API_CLIENTES()}/${id}/auto-ingesta`, {
          method: 'PATCH',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ enabled: chkAI.checked })
        });
      } catch (e) {
        console.error('No se pudo actualizar auto_ingesta:', e);
        alert('No se pudo actualizar auto-ingesta');
        chkAI.checked = !chkAI.checked;
      }
    });
  }
}

function cerrarModal() { qs('#modalOverlay')?.classList.add('hidden'); }

function agregarSenderInput(value='') {
  const cont = qs('#cuentasContainer'); if (!cont) return;
  const div = document.createElement('div');
  div.className = 'sender-group flex items-center gap-2 mb-2';
  div.innerHTML = `
    <input type="text" name="sender_id" value="${value||''}" placeholder="Sender ID"
           class="border border-slate-300 dark:border-white/10 rounded-xl p-2 flex-1 bg-white dark:bg-transparent"/>
    <button type="button" class="btn-vincular px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white">Vincular</button>
    <button type="button" class="btn-ping px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">Probar</button>
    <button type="button" class="btn-remove px-3 py-1 rounded-xl border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">🗑️</button>
  `;

  div.querySelector('.btn-vincular')?.addEventListener('click', async () => {
    const clientId = qs('input[name="id"]').value;
    const sid      = div.querySelector('input[name="sender_id"]').value.trim();
    if (!clientId || !sid) return;
    try {
      const { url } = await fetchJSON(`${API_CLIENTES()}/${clientId}/meli-link?sender_id=${encodeURIComponent(sid)}`);
      await copy(url);
    } catch (err) {
      console.error('Error generando link:', err);
      alert('No se pudo generar el enlace:\n' + err.message);
    }
  });

  div.querySelector('.btn-ping')?.addEventListener('click', async () => {
    const clientId = qs('input[name="id"]').value;
    if (!clientId) return;
    try {
      const res = await fetchJSON(`${apiURL('/auth/meli')}/ping/${clientId}`);
      alert(`OK: ${res.nickname || res.user_id}`);
    } catch (e) {
      alert('Ping falló: ' + e.message);
    }
  });

  div.querySelector('.btn-remove')?.addEventListener('click', () => div.remove());
  cont.appendChild(div);
}

async function abrirModal(id=null) {
  const form = qs('#formCliente'); if (!form) return;
  form.reset(); form.elements['id'].value = id || '';
  await cargarListasPrecios();

  // volver a GENERAL
  qsa('[data-tab]').forEach(b => {
    const t=b.dataset.tab;
    qs(`#tab-${t}`)?.classList.toggle('hidden', t!=='general');
    b.classList.toggle('border-b-2', t==='general');
    b.classList.toggle('border-amber-600', t==='general');
  });

  qs('#cuentasContainer').innerHTML = '';
  qs('#modalOverlay')?.classList.remove('hidden');

  if (!id) { agregarSenderInput(); return; }

  try {
    const data = await fetchJSON(`${API_CLIENTES()}/${id}`);
    form.elements['codigo_cliente'].value   = data.codigo_cliente || '';
    form.elements['nombre'].value           = data.nombre || '';
    form.elements['cuit'].value             = data.cuit || '';
    form.elements['razon_social'].value     = data.razon_social || '';
    form.elements['condicion_iva'].value    = data.condicion_iva || '';
    form.elements['horario_de_corte'].value = data.horario_de_corte || '';
    form.elements['lista_precios'].value    = data.lista_precios?._id || '';
    const chkAI = qs('#chkAutoIngesta'); if (chkAI) chkAI.checked = !!data.auto_ingesta;
    (data.sender_id || []).forEach(sid => agregarSenderInput(sid));
  } catch (e) {
    console.error('Error al obtener cliente:', e);
  }
}

async function guardarCliente(ev) {
  ev.preventDefault();
  const form = qs('#formCliente');
  const id   = form.elements['id'].value.trim();

  const nombre           = form.querySelector('input[name="nombre"]').value.trim();
  const condicion_iva    = form.querySelector('select[name="condicion_iva"]').value;
  const horario_de_corte = form.querySelector('input[name="horario_de_corte"]').value;
  const lista_precios    = form.querySelector('select[name="lista_precios"]').value;

  if (!nombre || !condicion_iva || !horario_de_corte || !lista_precios) {
    return alert('Completá Nombre, IVA, Horario de Corte y Lista de Precios.');
  }

  const cuit         = form.querySelector('input[name="cuit"]').value.trim();
  const razon_social = form.querySelector('input[name="razon_social"]').value.trim();
  const sids = qsa('#cuentasContainer input[name="sender_id"]').map(i => i.value.trim()).filter(Boolean);

  const body = {
    nombre, sender_id: sids, lista_precios,
    cuit: cuit || undefined, razon_social: razon_social || undefined,
    condicion_iva, horario_de_corte
  };
  const chkAI = qs('#chkAutoIngesta'); if (chkAI && id) body.auto_ingesta = chkAI.checked;
  if (id) {
    const codigo = form.querySelector('input[name="codigo_cliente"]').value.trim();
    if (codigo) body.codigo_cliente = codigo;
  }

  try {
    await fetchJSON(id ? `${API_CLIENTES()}/${id}` : API_CLIENTES(), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    cerrarModal(); cargarClientes();
  } catch (e) {
    console.error('Error al guardar cliente:', e);
    alert('Error al guardar cliente: ' + e.message);
  }
}

async function borrarCliente(id) {
  if (!confirm('¿Eliminar cliente?')) return;
  try { await fetchJSON(`${API_CLIENTES()}/${id}`, { method:'DELETE' }); cargarClientes(); }
  catch (e) { console.error('Error borrando cliente:', e); alert('No se pudo eliminar'); }
}
