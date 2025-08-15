// public/js/ingreso-manual.js
const qs   = s => document.querySelector(s);
const qsa  = s => Array.from(document.querySelectorAll(s));

const CLIENTES_API     = '/api/clientes';
const PARTIDO_CP_API   = '/api/partidos/cp';
const ENVIO_MANUAL_API = '/api/envios/manual';

let clientes = [];

window.addEventListener('DOMContentLoaded', () => {
  cargarClientes();
  agregarPaquete();
});

async function cargarClientes() {
  const res = await fetch(CLIENTES_API);
  if (!res.ok) return console.error('Clientes:',res.status);
  clientes = await res.json();
  const sel = qs('#cliente');
  sel.innerHTML = clientes.map(c=>`<option value="${c._id}">${c.nombre}</option>`).join('');
  sel.addEventListener('change', ()=>{
    const cl = clientes.find(x=>x._id===sel.value);
    qs('#codigo_interno').value = cl?.codigo_cliente||'';
  });
  sel.dispatchEvent(new Event('change'));
}

function agregarPaquete() {
  const div = document.createElement('div');
  div.className = 'paquete-group border p-4 rounded shadow-sm bg-gray-50';
  div.innerHTML = `
    <div class="grid grid-cols-2 gap-4">
      <label class="block">Destinatario:
        <input name="destinatario" required class="mt-1 w-full border rounded"/>
      </label>
      <label class="block">Dirección:
        <input name="direccion" required class="mt-1 w-full border rounded"/>
      </label>
      <label class="block">Código Postal:
        <input name="codigo_postal" required class="mt-1 w-full border rounded"
               onblur="detectarPartido(this)" oninput="detectarPartido(this)"/>
      </label>
      <label class="block">Partido (auto):
        <input name="partido" readonly class="mt-1 w-full bg-gray-100 border rounded"/>
      </label>
      <label class="block mt-4">
        <input type="checkbox" name="manual_precio" onchange="togglePrecioManual(this)"/>
        <span class="ml-2">Precio manual</span>
      </label>
      <label class="block mt-2">Precio a facturar ($):
        <input type="number" step="0.01" name="precio" readonly
               class="mt-1 w-full border rounded"/>
      </label>
      <label class="block">ID Venta:
        <input name="id_venta" placeholder="Opcional, se autogenera" 
               class="mt-1 w-full border rounded"/>
      </label>
    </div>
    <button type="button" onclick="this.parentElement.remove()"
      class="mt-2 text-red-600 hover:underline">Eliminar paquete</button>
  `;
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
    .then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(d => partidoI.value = d.partido || 'No encontrado')
    .catch(() => partidoI.value = 'Error');
}

async function guardar() {
  const clienteId  = qs('#cliente').value;
  const codigoInt  = qs('#codigo_interno').value;
  const referencia = qs('#referencia').value.trim();

  const paquetes = qsa('.paquete-group').map(div => {
    let idVenta = div.querySelector("[name='id_venta']").value.trim();
    if (!idVenta) idVenta = Math.random().toString(36).substr(2,8).toUpperCase();
    const manual = div.querySelector("[name='manual_precio']").checked;
    const precioManual = Number(div.querySelector("[name='precio']").value);

    return {
      cliente_id:    clienteId,
      sender_id:     codigoInt,
      destinatario:  div.querySelector("[name='destinatario']").value.trim(),
      direccion:     div.querySelector("[name='direccion']").value.trim(),
      codigo_postal: div.querySelector("[name='codigo_postal']").value.trim(),
      partido:       div.querySelector("[name='partido']").value.trim(),
      id_venta:      idVenta,
      referencia,
      manual_precio: manual,
      precio:        manual? precioManual : undefined
    };
  });

  try {
    const res = await fetch(ENVIO_MANUAL_API, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ paquetes })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

    // Mostrar modal con resultados (QR + link a PDF)
    renderModalResultados(data.docs);
    openModalResultados();
  } catch (err) {
    console.error('Error saving:', err);
    alert('No se pudo guardar');
  }
}

function renderModalResultados(items) {
  const list = qs('#res-list');
  list.innerHTML = '';
  items.forEach(x => {
    const li = document.createElement('li');
    li.className = 'border rounded p-3 mb-2';
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <img alt="QR" class="w-20 h-20 object-contain"/>
        <div class="flex-1">
          <div class="font-bold">Tracking (id_venta): ${x.id_venta}</div>
          <div class="text-sm">${x.destinatario} — ${x.direccion} (${x.codigo_postal}) ${x.partido||''}</div>
          <a class="text-blue-600 hover:underline" href="${x.label_url}" target="_blank" rel="noopener">
            Descargar etiqueta 10×15
          </a>
        </div>
      </div>
    `;
    // Seteamos el src por DOM para evitar que el template quede “literal”
    const img = li.querySelector('img');
    img.src = x.qr_png || '';
    list.appendChild(li);
  });
}

function openModalResultados() {
  qs('#modal-resultados').classList.remove('hidden');
}

function closeModalResultados() {
  qs('#modal-resultados').classList.add('hidden');
}
