// public/js/facturacion.js
const qs   = s => document.querySelector(s);
const qsa  = s => Array.from(document.querySelectorAll(s));

let envios = [];
let clientes = [];

// Al iniciar, cargo clientes para el filtro
window.addEventListener('DOMContentLoaded', async () => {
  await cargarClientes();
});

async function cargarClientes() {
  const res = await fetch('/clientes');
  if (!res.ok) return console.error('Error cargando clientes');
  clientes = await res.json();
  const sel = qs('#filtroCliente');
  clientes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c._id;
    opt.textContent = c.nombre;
    sel.append(opt);
  });
}

async function filtrar() {
  const desde = qs('#desde').value;
  const hasta = qs('#hasta').value;
  const clienteId = qs('#filtroCliente').value;

  // Traer envíos filtrados por fechas
  const res = await fetch(`/envios?desde=${desde}&hasta=${hasta}`);
  if (!res.ok) return console.error('Error cargando envíos');
  const data = await res.json();
  console.log(data[0]);
  // Aplicar filtro por cliente si se seleccionó
  envios = clienteId
    ? data.filter(e => e.cliente_id?._id === clienteId)
    : data;

  pintarTabla();
}

function pintarTabla() {
  const tbody = qs('#tabla-body');
  tbody.innerHTML = '';

  envios.forEach(e => {
    const fecha = new Date(e.fecha).toLocaleDateString('es-AR');
    const cliente = e.cliente_id || {};
    const codigoInt = cliente.codigo_cliente || '';
    const precio = typeof e.precio === 'number' ? e.precio : 0;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50';
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-700">${e.id_venta || e.meli_id || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${cliente.nombre || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${codigoInt}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${e.sender_id || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${e.partido || ''}</td>
      <td class="px-4 py-2 text-sm text-gray-700 text-right">$${precio.toFixed(2)}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${fecha}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Exporta la tabla a un .xlsx con filtros de Excel
 */
function exportarExcel() {
  if (!envios?.length) {
    return alert('No hay datos para exportar');
  }

  // 1) Convertimos tu array de envíos a un array de objetos planos
  const rows = envios.map(e => ({
    Tracking:       e.id_venta || e.meli_id || '',
    Cliente:        e.cliente_id?.nombre || '',
    CodigoInterno:  e.cliente_id?.codigo_cliente || '',
    SenderID:       e.sender_id || '',
    Partido:        e.partido || '',
    Precio:         e.precio?.toFixed(2) || '0.00',
    Fecha:          new Date(e.fecha).toLocaleDateString('es-AR')
  }));

  // 2) Creamos un libro y una hoja
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: [
    'Tracking','Cliente','CodigoInterno','SenderID','Partido','Precio','Fecha'
  ]});

  // 3) Habilitamos autofiltro en la tabla (desde A1 hasta G{n})
  const totalRows = rows.length + 1; // +1 por el encabezado
  ws['!autofilter'] = { ref: `A1:G${totalRows}` };

  // 4) Ajustamos un ancho razonable de columnas (opcional)
  ws['!cols'] = [
    { wch: 12 }, // Tracking
    { wch: 20 }, // Cliente
    { wch: 12 }, // CodigoInterno
    { wch: 12 }, // SenderID
    { wch: 16 }, // Partido
    { wch: 10 }, // Precio
    { wch: 12 }  // Fecha
  ];

  // 5) Añadimos la hoja al libro y forzamos descarga
  XLSX.utils.book_append_sheet(wb, ws, 'Facturacion');
  XLSX.writeFile(wb, `facturacion_${Date.now()}.xlsx`);
}
