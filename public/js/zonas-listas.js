// public/js/zonas-listas.js
const qs            = s => document.querySelector(s);
const qsa           = s => Array.from(document.querySelectorAll(s));
const ZONA_API      = '/api/zonas';
const LISTA_API     = '/api/listas-de-precios';
const PARTIDOS_API  = '/api/partidos';

const formZona      = qs('#formZona');
const formLista     = qs('#formLista');
const partidosSelect= qs('#partidosSelect');
const zonasLista    = qs('#zonasLista');
const zonasPrecios  = qs('#zonasPrecios');
const listasPrecios = qs('#listasPrecios');

let zonas = [];

// Tab switching
function mostrarTab(tab, btn) {
  qsa('.tab').forEach(el => el.classList.add('hidden'));
  qs(`#tab-${tab}`).classList.remove('hidden');

  qsa('.tab-btn').forEach(b => b.classList.remove('bg-blue-600','text-white'));
  btn.classList.add('bg-blue-600','text-white');
}

// Carga de partidos
async function cargarPartidos() {
  try {
    const res = await fetch('/api/partidos');      // o '/partidos' según montes tu ruta
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    console.log('Partidos recibidos:', data);

    // Limpio el select
    partidosSelect.innerHTML = '';

    // Cada item tiene .nombre
    data.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.nombre;
      opt.textContent = item.nombre;
      partidosSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error cargando partidos:', err);
  }
}

// Carga de zonas (y dibuja inputs para listas)
function cargarZonas() {
  fetch(ZONA_API)
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(data => {
      zonas = data;
      zonasLista.innerHTML = '';
      zonasPrecios.innerHTML = '';

      // Panel de Zonas
      zonas.forEach(z => {
        const div = document.createElement('div');
        div.className = 'bg-white p-3 rounded shadow';
        div.innerHTML = `
          <strong>${z.nombre}</strong><br>
          Partidos: ${z.partidos.join(', ')}<br>
          <button onclick="editarZona('${z._id}')" class="text-blue-600">Editar</button>
          <button onclick="eliminarZona('${z._id}')" class="text-red-600 ml-4">Eliminar</button>
        `;
        zonasLista.appendChild(div);
      });

      // Inputs para Lista de Precios
      zonas.forEach(z => {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2';
        div.innerHTML = `
          <input type="checkbox" id="check-${z._id}" />
          <label for="check-${z._id}" class="w-40">${z.nombre}</label>
          <input type="number" name="${z._id}" id="input-${z._id}"
                 class="flex-1 p-1 border rounded" placeholder="Precio" disabled />
        `;
        zonasPrecios.appendChild(div);
        const chk = qs(`#check-${z._id}`);
        const inp = qs(`#input-${z._id}`);
        chk.addEventListener('change', () => {
          inp.disabled = !chk.checked;
          if (!chk.checked) inp.value = '';
        });
      });
    })
    .catch(err => console.error('Error al cargar zonas:', err));
}

// Crear Zona
formZona.addEventListener('submit', e => {
  e.preventDefault();
  const nombre  = formZona.nombre.value;
  const partidos= Array.from(partidosSelect.selectedOptions).map(o=>o.value);

  fetch(ZONA_API, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre, partidos })
  })
  .then(res => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then(() => {
    formZona.reset();
    cargarZonas();
  })
  .catch(err => {
    console.error('Error creando zona:', err);
    alert('No se pudo guardar la zona.');
  });
});

// Eliminar Zona
function eliminarZona(id) {
  if (!confirm('¿Eliminar esta zona?')) return;
  fetch(`${ZONA_API}/${id}`, { method: 'DELETE' })
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.text();
    })
    .then(() => cargarZonas())
    .catch(err => console.error('Error eliminando zona:', err));
}

// Editar Zona
function editarZona(id) {
  const nuevo = prompt('Nuevo nombre de zona:');
  if (!nuevo) return;
  fetch(`${ZONA_API}/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre: nuevo })
  })
  .then(res => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then(() => cargarZonas())
  .catch(err => console.error('Error editando zona:', err));
}

// Crear Lista de Precios
formLista.addEventListener('submit', e => {
  e.preventDefault();
  const nombre = formLista.nombre.value;
  const zonasSel = zonas
    .map(z => {
      const v = qs(`input[name="${z._id}"]`).value;
      return v ? { zona: z._id, precio: parseFloat(v) } : null;
    })
    .filter(x=>x);

  fetch(LISTA_API, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre, zonas: zonasSel })
  })
  .then(res => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then(() => {
    formLista.reset();
    cargarZonas();
    cargarListas();
  })
  .catch(err => {
    console.error('Error creando lista:', err);
    alert('No se pudo guardar la lista.');
  });
});

// Cargar Listas
function cargarListas() {
  fetch(LISTA_API)
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(data => {
      listasPrecios.innerHTML = '';
      data.forEach(lista => {
        const div = document.createElement('div');
        div.className = 'bg-white p-3 rounded shadow';
        const precios = (lista.zonas||[])
          .map(zp => {
            const nom = typeof zp.zona==='object' ? zp.zona.nombre : '—';
            return `${nom}: $${zp.precio}`;
          })
          .join('<br>');
        div.innerHTML = `
          <strong>${lista.nombre}</strong><br>
          ${precios}<br>
          <button onclick="editarLista('${lista._id}', '${lista.nombre}')"
                  class="text-blue-600 mt-2">Editar</button>
          <button onclick="eliminarLista('${lista._id}')"
                  class="text-red-600 mt-2 ml-4">Eliminar</button>
        `;
        listasPrecios.appendChild(div);
      });
    })
    .catch(err => console.error('Error al cargar listas:', err));
}

// Editar Lista
function editarLista(id, actual) {
  const nuevo = prompt('Nuevo nombre de la lista:', actual);
  if (!nuevo) return;
  // Esto es sólo un ejemplo: podrías hacer un modal más completo
  fetch(`${LISTA_API}/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre: nuevo })
  })
  .then(res => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then(() => cargarListas())
  .catch(err => console.error('Error editando lista:', err));
}

// Eliminar Lista
function eliminarLista(id) {
  if (!confirm('¿Eliminar esta lista?')) return;
  fetch(`${LISTA_API}/${id}`, { method: 'DELETE' })
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.text();
    })
    .then(() => cargarListas())
    .catch(err => console.error('Error eliminando lista:', err));
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  cargarPartidos();
  cargarZonas();
  cargarListas();
});
