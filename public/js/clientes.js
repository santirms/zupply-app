// public/js/clientes.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let BASE = ''; // se detecta en init: '' o '/api'
const CANDIDATES = ['', '/api'];

const apiURL  = p => `${BASE}${p}`;
const API_CLIENTES = () => apiURL('/clientes');
const API_LISTAS   = () => apiURL('/listas-de-precios');

// ------------------------ utils ------------------------
async function detectBase() {
  for (const pre of CANDIDATES) {
    try {
      const r = await fetch(`${pre}/clientes`, { method: 'GET' });
      if (r.ok) { BASE = pre; return; }
    } catch (_) {}
  }
  // si nada respondió 200, dejamos BASE = '' para no romper
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
  try {
    await navigator.clipboard.writeText(text);
    alert('Enlace copiado al portapapeles ✅');
  } catch {
    // fallback
    prompt('Copiá el enlace:', text);
  }
}

// ------------------------ arranque ------------------------
window.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await detectBase();
    await cargarListasPrecios();
    await cargarClientes();
    configurarModal();
  } catch (e) {
    console.error('Error en init:', e);
  }
}

// ------------------------ data ------------------------
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
    const tbody = qs('#clientes-body');
    if (!tbody) return;

    if (!clientes.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No hay clientes</td></tr>`;
      return;
    }

    tbody.innerHTML = clientes.map(c => `
      <tr>
        <td class="border px-4 py-2">${c.codigo_cliente||''}</td>
        <td class="border px-4 py-2">${c.nombre||''}</td>
        <td class="border px-4 py-2">${c.cuit||''}</td>
        <td class="border px-4 py-2">${c.razon_social||''}</td>
        <td class="border px-4 py-2">${c.condicion_iva||''}</td>
        <td class="border px-4 py-2">${c.horario_de_corte||''}</td>
        <td class="border px-4 py-2">${c.lista_precios?.nombre||''}</td>
        <td class="border px-4 py-2 space-x-2">
          <button onclick="abrirModal('${c._id}')" class="text-blue-600">✏️</button>
          <button onclick="borrarCliente('${c._id}')" class="text-red-600">🗑️</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error al cargar clientes:', e);
  }
}

// ------------------------ modal ------------------------
function configurarModal() {
  // pestañas
  const tabBtns = qsa('[data-tab]');
  const panes = { general: qs('#tab-general'), cuentas: qs('#tab-cuentas') };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.tab;
      Object.entries(panes).forEach(([k, el]) => el?.classList.toggle('hidden', k !== sel));
      tabBtns.forEach(b => b.classList.remove('border-b-2','border-blue-600'));
      btn.classList.add('border-b-2','border-blue-600');
    });
  });

  // botones modal
  qs('#btnNuevo')?.addEventListener('click', () => abrirModal());
  qs('#btnCerrar')?.addEventListener('click', cerrarModal);
  qs('#btnAgregarCuenta')?.addEventListener('click', () => agregarSenderInput());

  // submit
  qs('#formCliente')?.addEventListener('submit', guardarCliente);

  // toggle auto-ingesta (si existe en el HTML)
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

function cerrarModal() {
  qs('#modalOverlay')?.classList.add('hidden');
}

function agregarSenderInput(value = '') {
  const cont = qs('#cuentasContainer');
  if (!cont) return;

  const div = document.createElement('div');
  div.className = 'sender-group flex items-center gap-2 mb-2';
  div.innerHTML = `
    <input type="text" name="sender_id" value="${value||''}"
           placeholder="Sender ID" class="border p-1 flex-1"/>
    <button type="button" class="btn-vincular px-2 py-1 bg-blue-500 text-white rounded">
      Vincular
    </button>
    <button type="button" class="btn-ping px-2 py-1 bg-indigo-500 text-white rounded">
      Probar
    </button>
    <button type="button" class="btn-remove px-2 py-1 bg-red-500 text-white rounded">
      🗑️
    </button>
  `;

  // Vincular (genera link para copiar)
  div.querySelector('.btn-vincular')?.addEventListener('click', async () => {
    const clientId = qs('input[name="id"]').value;
    const sid      = div.querySelector('input[name="sender_id"]').value.trim();
    if (!clientId || !sid) return;

    try {
      const { url } = await fetchJSON(`${API_CLIENTES()}/${clientId}/meli-link?sender_id=${encodeURIComponent(sid)}`);
      await copy(url);
    } catch (err) {
      console.error('Error al generar link de vinculación:', err);
      alert('No se pudo generar el enlace de vinculación:\n' + err.message);
    }
  });

  // Probar token (opcional; si no hay user_id aún, devolverá error)
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

  // Eliminar input sender
  div.querySelector('.btn-remove')?.addEventListener('click', () => div.remove());

  cont.appendChild(div);
}

async function abrirModal(id = null) {
  const form = qs('#formCliente');
  if (!form) return;

  form.reset();
  form.elements['id'].value = id || '';

  await cargarListasPrecios();

  // volver a "General"
  qsa('[data-tab]').forEach(b => {
    const t = b.dataset.tab;
    qs(`#tab-${t}`)?.classList.toggle('hidden', t !== 'general');
    b.classList.toggle('border-b-2', t === 'general');
  });

  qs('#cuentasContainer').innerHTML = '';
  qs('#modalOverlay')?.classList.remove('hidden');

  if (!id) {
    agregarSenderInput();
    return;
  }

  try {
    const data = await fetchJSON(`${API_CLIENTES()}/${id}`);

    form.elements['codigo_cliente'].value   = data.codigo_cliente || '';
    form.elements['nombre'].value           = data.nombre || '';
    form.elements['cuit'].value             = data.cuit || '';
    form.elements['razon_social'].value     = data.razon_social || '';
    form.elements['condicion_iva'].value    = data.condicion_iva || '';
    form.elements['horario_de_corte'].value = data.horario_de_corte || '';
    form.elements['lista_precios'].value    = data.lista_precios?._id || '';

    // auto-ingesta (si hay checkbox)
    const chkAI = qs('#chkAutoIngesta');
    if (chkAI) chkAI.checked = !!data.auto_ingesta;

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
    return alert('Completa Nombre, IVA, Horario de Corte y Lista de Precios.');
  }

  const cuit         = form.querySelector('input[name="cuit"]').value.trim();
  const razon_social = form.querySelector('input[name="razon_social"]').value.trim();
  const sids = qsa('#cuentasContainer input[name="sender_id"]')
    .map(i => i.value.trim()).filter(Boolean);

  const body = {
    nombre,
    sender_id: sids,
    lista_precios,
    cuit:          cuit || undefined,
    razon_social:  razon_social || undefined,
    condicion_iva,
    horario_de_corte
  };

  // si hay checkbox auto_ingesta, lo enviamos en PUT
  const chkAI = qs('#chkAutoIngesta');
  if (chkAI && id) body.auto_ingesta = chkAI.checked;

  // Si edito y hay código, lo envío (server validará)
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
    cerrarModal();
    cargarClientes();
  } catch (e) {
    console.error('Error al guardar cliente:', e);
    alert('Error al guardar cliente: ' + e.message);
  }
}

async function borrarCliente(id) {
  if (!confirm('¿Eliminar cliente?')) return;
  try {
    await fetchJSON(`${API_CLIENTES()}/${id}`, { method: 'DELETE' });
    cargarClientes();
  } catch (e) {
    console.error('Error borrando cliente:', e);
    alert('No se pudo eliminar el cliente');
  }
}

