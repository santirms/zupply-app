// public/js/clientes.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

const API             = '/clientes';
const PRICE_LISTS_API = '/listas-de-precios';

window.addEventListener('DOMContentLoaded', init);

async function init() {
  await cargarListasPrecios();
  await cargarClientes();
  configurarModal();
}

async function cargarListasPrecios() {
  try {
    const res = await fetch(PRICE_LISTS_API);
    if (!res.ok) throw new Error(res.statusText);
    const listas = await res.json();
    const sel = qs('#selectListasPrecios');
    sel.innerHTML = ['<option value="">-- Seleccionar --</option>',
      ...listas.map(l => `<option value="${l._id}">${l.nombre}</option>`)]
      .join('');
  } catch (e) {
    console.error('Error al cargar listas de precios:', e);
  }
}

async function cargarClientes() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(res.statusText);
    const clientes = await res.json();
    const tbody = qs('#clientes-body');
    if (!clientes.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No hay clientes</td></tr>`;
      return;
    }
    tbody.innerHTML = clientes.map(c => `
      <tr>
        <td class="border px-4 py-2">${c.codigo_cliente||''}</td>
        <td class="border px-4 py-2">${c.nombre}</td>
        <td class="border px-4 py-2">${c.cuit||''}</td>
        <td class="border px-4 py-2">${c.razon_social||''}</td>
        <td class="border px-4 py-2">${c.condicion_iva}</td>
        <td class="border px-4 py-2">${c.horario_de_corte}</td>
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

function configurarModal() {
  // 1) Pestañas
  const tabBtns = qsa('[data-tab]');
  const panes = {
    general: qs('#tab-general'),
    cuentas: qs('#tab-cuentas')
  };

  // click en cada botón de pestaña
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.tab;
      // mostrar/ocultar panes
      Object.entries(panes).forEach(([key, pane]) => {
        pane.classList.toggle('hidden', key !== sel);
      });
      // estilo activo
      tabBtns.forEach(b => b.classList.remove('border-b-2','border-blue-600'));
      btn.classList.add('border-b-2','border-blue-600');
    });
  });

  // 4) Atacheamos el submit del form al AJAX
  const form = qs('#formCliente');
  if (form) {
    form.addEventListener('submit', guardarCliente);
  }
 
  // 2) Botones del modal
  qs('#btnNuevo')?.addEventListener('click', () => abrirModal());
  qs('#btnCerrar')?.addEventListener('click', cerrarModal);
  qs('#btnAgregarCuenta')?.addEventListener('click', () => agregarSenderInput());
}

function cerrarModal() {
  qs('#modalOverlay').classList.add('hidden');
}

function agregarSenderInput(value = '') {
  const cont = qs('#cuentasContainer');
  if (!cont) return;
  const div = document.createElement('div');
  div.className = 'sender-group flex items-center gap-2 mb-2';
  div.innerHTML = `
    <input type="text" name="sender_id" value="${value}"
           placeholder="Sender ID" class="border p-1 flex-1"/>
    <button type="button" class="btn-vincular px-2 py-1 bg-blue-500 text-white rounded">
      Vincular
    </button>
    <button type="button" class="btn-remove px-2 py-1 bg-red-500 text-white rounded">
      🗑️
    </button>
  `;
  // Vincular
  div.querySelector('.btn-vincular')?.addEventListener('click', () => {
    const clientId = qs('input[name="id"]').value;
    const sid = div.querySelector('input[name="sender_id"]').value;
    if (clientId && sid) {
      window.location = `${API}/${clientId}/meli-oauth?sender_id=${sid}`;
    }
  });
  // Eliminar
  div.querySelector('.btn-remove')?.addEventListener('click', () => div.remove());
  cont.appendChild(div);
}

async function abrirModal(id = null) {
  const form = qs('#formCliente');
  form.reset();
  form.elements['id'].value = id || '';

  await cargarListasPrecios();

  // reiniciar pestañas a General
  qsa('[data-tab]').forEach(b => {
    const t = b.dataset.tab;
    qs(`#tab-${t}`).classList.toggle('hidden', t !== 'general');
    b.classList.toggle('border-b-2', t === 'general');
  });

  qs('#cuentasContainer').innerHTML = '';
  qs('#modalOverlay').classList.remove('hidden');

  if (!id) {
    agregarSenderInput();
    return;
  }

  try {
    const res  = await fetch(`${API}/${id}`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();

    form.elements['codigo_cliente'].value   = data.codigo_cliente || '';
    form.elements['nombre'].value           = data.nombre || '';
    form.elements['cuit'].value             = data.cuit || '';
    form.elements['razon_social'].value     = data.razon_social || '';
    form.elements['condicion_iva'].value    = data.condicion_iva || '';
    form.elements['horario_de_corte'].value = data.horario_de_corte || '';
    form.elements['lista_precios'].value    = data.lista_precios?._id || '';

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
    .map(i => i.value.trim()).filter(v => v);

  const body = {
    nombre,
    sender_id:     sids,
    lista_precios,
    cuit:          cuit || undefined,
    razon_social:  razon_social || undefined,
    condicion_iva,
    horario_de_corte
  };
  if (id) {
    const codigo = form.querySelector('input[name="codigo_cliente"]').value.trim();
    if (codigo) body.codigo_cliente = codigo;
  }

  try {
    const res = await fetch(id ? `${API}/${id}` : API, {
      method:  id ? 'PUT' : 'POST',
      headers: { 'Content-Type':'application/json' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || res.statusText);
    }
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
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
    cargarClientes();
  } catch (e) {
    console.error('Error borrando cliente:', e);
  }
}

