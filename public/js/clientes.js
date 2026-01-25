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

    // Función para obtener la ruta de inicio según el rol
    function getHomeRoute(role) {
      switch(role) {
        case 'cliente':
          return '/client-panel.html';
        case 'admin':
        case 'coordinador':
          return '/index.html';
        case 'chofer':
          return '/mis-envios.html';
        default:
          return '/';
      }
    }

    fetch('/me',{cache:'no-store'})
      .then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(me=>{
        const n=me.name||me.username||me.email||'Usuario';
        const u=qs('#username'); if(u) u.textContent=n;

        // Configurar redirección del logo según rol
        const userRole = me.role || 'admin';
        const homeRoute = getHomeRoute(userRole);

        const logoLink = document.getElementById('logoLink');
        const homeLink = document.getElementById('homeLink');

        // Actualizar href del logo y link de inicio
        if (logoLink) {
          logoLink.href = homeRoute;
        }
        if (homeLink) {
          homeLink.href = homeRoute;
        }
      })
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
  qs('#btnProbarToken')?.addEventListener('click', async () => {
    const clientId = qs('input[name="id"]').value;
    if (!clientId) {
      alert('⚠️ Guardá el cliente primero para poder probar el token');
      return;
    }

    const statusSpan = qs('#pingStatus');
    if (statusSpan) statusSpan.textContent = '⏳ Probando...';

    try {
      const res = await fetchJSON(`${apiURL('/auth/meli')}/ping/${clientId}`);
      const msg = `✅ Token válido: ${res.nickname || res.user_id || 'OK'}`;
      if (statusSpan) statusSpan.textContent = msg;
      setTimeout(() => { if (statusSpan) statusSpan.textContent = ''; }, 5000);
    } catch (e) {
      const msg = `❌ Token inválido: ${e.message}`;
      if (statusSpan) statusSpan.textContent = msg;
      alert('No se pudo verificar el token:\n' + e.message);
    }
  });

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
    form.elements['lista_precios'].value    = data.lista_precios?._id || '';
    const chkAI = qs('#chkAutoIngesta'); if (chkAI) chkAI.checked = !!data.auto_ingesta;
    const chkFirma = qs('#chkPuedeRequerirFirma'); if (chkFirma) chkFirma.checked = !!(data.permisos?.puedeRequerirFirma);
    const senderIds = data.sender_id || [];
    if (senderIds.length > 0) {
      senderIds.forEach(sid => agregarSenderInput(sid));
    } else {
      // Si no tiene cuentas, mostrar un campo vacío para que pueda agregar
      agregarSenderInput();
    }

    // Cargar configuración de facturación
    if (data.facturacion) {
      const f = data.facturacion;
      const inp_lv = form.querySelector('[name="horario_corte_lunes_viernes"]');
      const inp_s  = form.querySelector('[name="horario_corte_sabado"]');
      const inp_d  = form.querySelector('[name="horario_corte_domingo"]');
      const sel_tp = form.querySelector('[name="tipo_periodo"]');
      const txt_nf = form.querySelector('[name="notas_facturacion"]');

      if (inp_lv) inp_lv.value = f.horario_corte_lunes_viernes || '13:00';
      if (inp_s)  inp_s.value  = f.horario_corte_sabado || '12:00';
      if (inp_d && f.horario_corte_domingo) inp_d.value = f.horario_corte_domingo;
      if (sel_tp) sel_tp.value = f.tipo_periodo || 'semanal';
      if (txt_nf && f.notas_facturacion) txt_nf.value = f.notas_facturacion;
    }
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
  const lista_precios    = form.querySelector('select[name="lista_precios"]').value;

  if (!nombre || !condicion_iva || !lista_precios) {
    return alert('Completá Nombre, IVA y Lista de Precios.');
  }

  const cuit         = form.querySelector('input[name="cuit"]').value.trim();
  const razon_social = form.querySelector('input[name="razon_social"]').value.trim();
  const sids = qsa('#cuentasContainer input[name="sender_id"]').map(i => i.value.trim()).filter(Boolean);
  const chkFirma = qs('#chkPuedeRequerirFirma');

  const body = {
    nombre, sender_id: sids, lista_precios,
    cuit: cuit || undefined, razon_social: razon_social || undefined,
    condicion_iva,
    permisos: {
      puedeRequerirFirma: chkFirma ? chkFirma.checked : false
    },
    // Configuración de facturación
    facturacion: {
      horario_corte_lunes_viernes: form.querySelector('[name="horario_corte_lunes_viernes"]').value || '13:00',
      horario_corte_sabado: form.querySelector('[name="horario_corte_sabado"]').value || '12:00',
      horario_corte_domingo: form.querySelector('[name="horario_corte_domingo"]').value || null,
      tipo_periodo: form.querySelector('[name="tipo_periodo"]').value || 'semanal',
      notas_facturacion: form.querySelector('[name="notas_facturacion"]').value || ''
    }
  };
  const chkAI = qs('#chkAutoIngesta');
  if (chkAI) body.auto_ingesta = chkAI.checked;
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
  try {
    // 1. Obtener info del cliente para mostrar cuántos envíos se eliminarán
    const cliente = await fetchJSON(`${API_CLIENTES()}/${id}`);
    
    // 2. Calcular cuántos envíos se eliminarán (aproximado - el backend hará el cálculo exacto)
    const hace10Dias = new Date();
    hace10Dias.setDate(hace10Dias.getDate() - 10);
    
    // Mostrar modal de confirmación
    const mensaje = `⚠️ ATENCIÓN: Esto eliminará el cliente "${cliente.nombre}" y todos sus envíos finalizados hace más de 10 días.

${cliente.enviosHistoricos ? `Se eliminarán aproximadamente ${cliente.enviosHistoricos} envíos históricos.` : 'No se eliminarán envíos recientes.'}

Esta acción NO se puede deshacer.

¿Estás seguro de continuar?`;

    if (!confirm(mensaje)) return;
    
    // Confirmar por segunda vez
    if (!confirm('⚠️ CONFIRMACIÓN FINAL: ¿Eliminar cliente y envíos históricos?')) return;

    // 3. Mostrar modal de loading
    mostrarModalLoading('Eliminando cliente y envíos históricos...');

    // 4. Eliminar
    const resultado = await fetchJSON(`${API_CLIENTES()}/${id}`, { method: 'DELETE' });

    // 5. Ocultar loading
    ocultarModalLoading();

    // 6. Mostrar resultado
    const mensajeExito = `✅ Cliente eliminado exitosamente${resultado.enviosEliminados > 0 ? `\n\n🗑️ Se eliminaron ${resultado.enviosEliminados} envíos históricos` : ''}`;
    alert(mensajeExito);

    // 7. Recargar lista
    cargarClientes();

  } catch (e) {
    ocultarModalLoading();
    console.error('Error borrando cliente:', e);
    alert('❌ Error: ' + e.message);
  }
}

// Modal de loading simple
function mostrarModalLoading(mensaje) {
  let modal = document.getElementById('modalLoadingEliminar');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalLoadingEliminar';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-md text-center">
        <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
        <p id="mensajeLoading" class="text-lg font-medium text-gray-900 dark:text-white"></p>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">Por favor, no cierres esta ventana</p>
      </div>
    `;
    document.body.appendChild(modal);
  }
  document.getElementById('mensajeLoading').textContent = mensaje;
  modal.classList.remove('hidden');
}

function ocultarModalLoading() {
  const modal = document.getElementById('modalLoadingEliminar');
  if (modal) {
    modal.classList.add('hidden');
  }
}
