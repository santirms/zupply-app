// public/js/ingreso-manual.js (mismo flujo + estilos dark/topbar)
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

const CLIENTES_API     = '/api/clientes';
const PARTIDO_CP_API   = '/api/partidos/cp';
const ENVIO_MANUAL_API = '/api/envios/manual';

let clientes = [];
let userRole = null;
let currentClientId = null;

// ===== Topbar (usuario + tema) =====
(function initTopbar(){
  // usuario
  (function(){
    const btn=qs('#userBtn'), menu=qs('#userMenu'), wrap=qs('#userMenuWrap');
    if(btn&&menu&&wrap){
      btn.addEventListener('click', ()=>menu.classList.toggle('hidden'));
      document.addEventListener('click', e=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    qs('#logoutBtn')?.addEventListener('click', async ()=>{
      try{ await fetch('/auth/logout',{method:'POST'}) }catch{}
      try{ localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); }catch{}
      location.href='/auth/login';
    });
    fetch('/me',{cache:'no-store'})
      .then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(me=>{
        const n=me.name||me.username||me.email||'Usuario';
        const u=qs('#username'); if(u) u.textContent=n;
      })
      .catch(()=> location.href='/auth/login');
  })();

  // tema
  (function(){
    const order=['light','dark','system'];
    const btn=qs('#themeBtn');
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
})();

// ===== Página =====
window.addEventListener('DOMContentLoaded', () => {
  detectarRol();
  cargarClientes();
  agregarPaquete();
});

async function detectarRol() {
  try {
    const res = await fetch('/api/users/me', { credentials: 'include' });
    if (!res.ok) throw new Error('No autenticado');

    const user = await res.json();
    userRole = user.role || null;
    currentClientId = user.client_id || user.cliente_id || null;

    console.log(`Usuario: ${user.username || user.email || 'desconocido'} (${userRole || 'sin rol'})`);

    if (userRole === 'cliente') {
      const selectContainer = document.getElementById('selectClienteContainer');
      const select = document.getElementById('cliente_id');
      if (selectContainer) selectContainer.style.display = 'none';
      if (select) {
        select.required = false;
        if (currentClientId) select.value = currentClientId;
      }
    }

    aplicarClienteSeleccionado();
  } catch (err) {
    console.error('Error detectando rol:', err);
  }
}

function aplicarClienteSeleccionado() {
  const select = document.getElementById('cliente_id');
  const codigoInterno = document.getElementById('codigo_interno');
  if (!select || !codigoInterno) return;

  if (userRole === 'cliente' && currentClientId) {
    select.value = currentClientId;
  } else if (!select.value && clientes.length === 1) {
    select.value = clientes[0]._id;
  }

  const seleccionado = clientes.find(c => c._id === select.value);
  codigoInterno.value = seleccionado?.codigo_cliente || '';
}

async function cargarClientes() {
  try{
    const res = await fetch(CLIENTES_API, { cache:'no-store' });
    if (!res.ok) throw res.status;
    clientes = await res.json();
    const sel = document.getElementById('cliente_id');
    if (sel) {
      sel.innerHTML = `<option value="">Seleccionar cliente...</option>` +
        clientes.map(c => `<option value="${c._id}">${c.nombre || 'Sin nombre'}</option>`).join('');
      sel.addEventListener('change', aplicarClienteSeleccionado);
    }
    aplicarClienteSeleccionado();
  }catch(e){
    console.error('Clientes:', e);
    alert('No se pudieron cargar los clientes');
  }
}

function paqueteMarkup(){
  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <label class="block text-sm">Destinatario
        <input name="destinatario" required class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>
      <label class="block text-sm">Dirección
        <input name="direccion" required class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>

      <label class="block text-sm">Código Postal
        <input name="codigo_postal" required
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"
               onblur="detectarPartido(this)" oninput="detectarPartido(this)"/>
      </label>
      <label class="block text-sm">Partido (auto)
        <input name="partido" readonly
               class="mt-1 w-full p-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5"/>
      </label>

      <div class="flex items-center gap-2 mt-1">
        <input id="chk" type="checkbox" name="manual_precio" onchange="togglePrecioManual(this)"
               class="w-5 h-5 accent-amber-600">
        <label for="chk" class="text-sm">Precio manual</label>
      </div>

      <label class="block text-sm">Precio a facturar ($)
        <input type="number" step="0.01" name="precio" readonly
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>

      <label class="block text-sm">ID de venta (opcional)
        <input name="id_venta" placeholder="Si se omite, se autogenera"
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>
    </div>

    <div class="mt-3 flex justify-between">
      <div class="text-xs opacity-60">Se valida el CP→Partido automáticamente</div>
      <button type="button" onclick="this.closest('.paquete-group').remove()"
        class="px-3 py-1.5 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">
        Eliminar paquete
      </button>
    </div>
  `;
}

function agregarPaquete() {
  const div = document.createElement('div');
  div.className = 'paquete-group rounded-2xl border border-slate-200 dark:border-white/10 p-4 bg-slate-50 dark:bg-white/5';
  div.innerHTML = paqueteMarkup();
  qs('#paquetes').appendChild(div);
}

function togglePrecioManual(cb) {
  const grp = cb.closest('.paquete-group');
  const inp = grp.querySelector("input[name='precio']");
  inp.readOnly = !cb.checked;
  if (!cb.checked) inp.value = '';
}

function detectarPartido(input) {
  const cp = input.value.trim();
  const partidoI = input.closest('.paquete-group').querySelector("input[name='partido']");
  if (!cp) { partidoI.value = ''; return; }
  fetch(`${PARTIDO_CP_API}/${encodeURIComponent(cp)}`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => partidoI.value = d.partido || 'No encontrado')
    .catch(() => partidoI.value = 'Error');
}

async function guardar() {
  const select = document.getElementById('cliente_id');
  const codigoInt  = qs('#codigo_interno').value;
  const clienteId = userRole === 'cliente'
    ? currentClientId
    : (select ? select.value : '');
  const referencia = qs('#referencia').value.trim();

  if (userRole !== 'cliente' && !clienteId) {
    alert('Debe seleccionar un cliente');
    return;
  }

  const paquetes = qsa('.paquete-group').map(div => {
    let idVenta = div.querySelector("[name='id_venta']").value.trim();
    if (!idVenta) idVenta = Math.random().toString(36).substr(2,8).toUpperCase();
    const manual = div.querySelector("[name='manual_precio']").checked;
    const precioManual = Number(div.querySelector("[name='precio']").value);

    const payload = {
      sender_id:     codigoInt,
      destinatario:  div.querySelector("[name='destinatario']").value.trim(),
      direccion:     div.querySelector("[name='direccion']").value.trim(),
      codigo_postal: div.querySelector("[name='codigo_postal']").value.trim(),
      partido:       div.querySelector("[name='partido']").value.trim(),
      id_venta:      idVenta,
      referencia,
      manual_precio: manual
    };

    if (manual) {
      payload.precio = precioManual;
    }

    if (userRole !== 'cliente') {
      payload.cliente_id = clienteId;
    }

    return payload;
  });

  try {
    const res = await fetch(ENVIO_MANUAL_API, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ paquetes })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

    renderModalResultados(data.docs || []);
    openModalResultados();
  } catch (err) {
    console.error('Error saving:', err);
    alert('No se pudo guardar');
  }
}

// ===== Modal resultados =====
function renderModalResultados(items) {
  const list = qs('#res-list');
  list.innerHTML = '';
  items.forEach(x => {
    const li = document.createElement('li');
    li.className = 'border border-slate-200 dark:border-white/10 rounded-xl p-3';
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <img alt="QR" class="w-20 h-20 object-contain rounded bg-white dark:bg-white/10"/>
        <div class="flex-1">
          <div class="font-semibold">Tracking (id_venta): ${x.id_venta}</div>
          <div class="text-sm opacity-80">${x.destinatario||''} — ${x.direccion||''} (${x.codigo_postal||''}) ${x.partido||''}</div>
          ${x.label_url ? `<a class="text-amber-600 hover:underline" href="${x.label_url}" target="_blank" rel="noopener">Descargar etiqueta 10×15</a>` : '<span class="text-xs opacity-60">sin etiqueta</span>'}
        </div>
      </div>
    `;
    li.querySelector('img').src = x.qr_png || '';
    list.appendChild(li);
  });
}
function openModalResultados(){ const m=qs('#modal-resultados'); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModalResultados(){ const m=qs('#modal-resultados'); m.classList.add('hidden'); m.classList.remove('flex'); }
