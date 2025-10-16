// ========== MODAL DE DETALLE ==========

async function abrirModalDetalle(envioId) {
  if (!envioId) {
    alert('No se encontró el envío');
    return;
  }

  try {
    const res = await fetch(`/api/envios/${encodeURIComponent(envioId)}`, { credentials: 'include' });

    if (!res.ok) {
      let message = 'Error al cargar envío';
      try {
        const err = await res.json();
        message = err.error || message;
      } catch (_) {}
      throw new Error(message);
    }

    const envio = await res.json();

    const tracking =
      envio.tracking ||
      envio.tracking_id ||
      envio.trackingId ||
      envio.id_venta ||
      envio.meli_id ||
      envio.shipment_id ||
      '-';

    document.getElementById('modalTracking').textContent = tracking;
    document.getElementById('modalDestinatario').textContent =
      envio.destinatario || envio.nombre_destinatario || envio?.destino?.nombre || '-';

    const direccion =
      envio.direccion ||
      envio.direccion_envio ||
      envio?.destino?.direccion ||
      envio?.destino?.calle ||
      envio?.domicilio ||
      '-';
    document.getElementById('modalDireccion').textContent = direccion;

    const cp =
      envio.codigo_postal ||
      envio.cp ||
      envio?.destino?.codigo_postal ||
      envio?.destino?.cp ||
      '-';
    document.getElementById('modalCP').textContent = cp;

    const partido =
      envio.partido ||
      envio?.destino?.partido ||
      envio?.destino?.localidad ||
      '-';
    document.getElementById('modalPartido').textContent = partido;

    const telefono =
      envio.telefono ||
      envio.telefono_destinatario ||
      envio?.destino?.telefono ||
      envio?.phone ||
      '-';
    document.getElementById('modalTelefono').textContent = telefono;

    const referencia =
      envio.referencia ||
      envio.indicaciones ||
      envio?.destino?.referencia ||
      '-';
    document.getElementById('modalReferencia').textContent = referencia;

    const fecha = envio.fecha || envio.createdAt || envio.created_at || envio.updatedAt || null;
    document.getElementById('modalFecha').textContent =
      fecha ? new Date(fecha).toLocaleString('es-AR') : '-';

    document.getElementById('modalEstado').innerHTML = crearBadgeEstado(envio.estado);

    // Ocultar sección de chofer (el schema no incluye driver_id)
    document.getElementById('modalChoferContainer').classList.add('hidden');

    const historial = Array.isArray(envio.historial) && envio.historial.length
      ? envio.historial
      : Array.isArray(envio.timeline) ? envio.timeline : [];
    renderizarHistorial(historial);

    cambiarTab('detalle');
    const modal = document.getElementById('modalDetalleEnvio');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } catch (err) {
    console.error('Error abriendo modal:', err);
    alert(err.message || 'No se pudo cargar el detalle del envío');
  }
}

function cerrarModalDetalle() {
  const modal = document.getElementById('modalDetalleEnvio');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function cambiarTab(tab) {
  const tabDetalle = document.getElementById('tabDetalle');
  const tabHistorial = document.getElementById('tabHistorial');
  const contenidoDetalle = document.getElementById('contenidoDetalle');
  const contenidoHistorial = document.getElementById('contenidoHistorial');

  const baseClass = 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
  tabDetalle.className = baseClass;
  tabHistorial.className = baseClass;

  if (tab === 'detalle') {
    tabDetalle.className = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400';
    contenidoDetalle.classList.remove('hidden');
    contenidoHistorial.classList.add('hidden');
  } else {
    tabHistorial.className = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400';
    contenidoHistorial.classList.remove('hidden');
    contenidoDetalle.classList.add('hidden');
  }
}

function renderizarHistorial(historial) {
  const tbody = document.getElementById('tablaHistorial');

  if (!Array.isArray(historial) || historial.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-slate-500 dark:text-slate-400">No hay historial disponible</td></tr>';
    return;
  }

  const sorted = historial.slice().sort((a, b) => {
    const fechaA = new Date(a.fecha || a.at || 0);
    const fechaB = new Date(b.fecha || b.at || 0);
    return fechaB - fechaA;
  });

  tbody.innerHTML = sorted.map(item => {
    const fecha = item.fecha || item.at;
    const fechaStr = fecha ? new Date(fecha).toLocaleString('es-AR') : '-';
    const badge = crearBadgeEstado(item.estado);
    const nota = item.nota || item.note || item.observaciones || item.descripcion || '-';

    return `
      <tr class="border-b border-slate-200 dark:border-white/10">
        <td class="px-3 py-2 text-sm text-slate-900 dark:text-slate-100">${fechaStr}</td>
        <td class="px-3 py-2">${badge}</td>
        <td class="px-3 py-2 text-sm text-slate-600 dark:text-slate-400">${nota}</td>
      </tr>
    `;
  }).join('');
}

function crearBadgeEstado(estado) {
  const COLORES = {
    en_preparacion: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
    en_planta: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
    en_camino: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300',
    entregado: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
    comprador_ausente: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
    rechazado: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
    pendiente: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300',
    incidencia: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
    reprogramado: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300',
    demorado: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300',
    cancelado: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300'
  };

  const estadoKey = (estado || 'pendiente').toString().toLowerCase();
  const color = COLORES[estadoKey] || COLORES.pendiente;
  const label = estadoKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letra => letra.toUpperCase());

  return `<span class="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full border ${color}">${label}</span>`;
}

// Cerrar modal con tecla ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalDetalle();
  }
});

// Cerrar modal al hacer click fuera
const modalDetalleEnvioEl = document.getElementById('modalDetalleEnvio');
if (modalDetalleEnvioEl) {
  modalDetalleEnvioEl.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      cerrarModalDetalle();
    }
  });
}

// Exponer funciones globalmente
window.abrirModalDetalle = abrirModalDetalle;
window.cerrarModalDetalle = cerrarModalDetalle;
window.cambiarTab = cambiarTab;
window.crearBadgeEstado = crearBadgeEstado;
