const CLASES_BADGE_ESTADO = {
  secondary: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300',
  info: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
  primary: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300',
  success: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
  dark: 'bg-slate-600 text-white border-slate-700 dark:bg-slate-700 dark:text-slate-200'
};

function obtenerInfoEstado(estado) {
  const estadoKey = (estado ?? '').toString().trim().toLowerCase();

  const estadosZupply = {
    en_preparacion: { nombre: 'En preparación', color: 'info', icono: 'box-seam' },
    en_planta: { nombre: 'En planta', color: 'secondary', icono: 'box-seam' },
    asignado: { nombre: 'Asignado', color: 'info', icono: 'person-check' },
    en_camino: { nombre: 'En camino', color: 'primary', icono: 'truck' },
    entregado: { nombre: 'Entregado', color: 'success', icono: 'check-circle-fill' },
    comprador_ausente: { nombre: 'Comprador ausente', color: 'warning', icono: 'exclamation-triangle' },
    rechazado: { nombre: 'Rechazado', color: 'danger', icono: 'x-circle' },
    inaccesible: { nombre: 'Inaccesible', color: 'secondary', icono: 'slash-circle' },
    cancelado: { nombre: 'Cancelado', color: 'dark', icono: 'x-circle' },
    devolucion: { nombre: 'En devolución', color: 'danger', icono: 'arrow-return-left' },
    incidencia: { nombre: 'Incidencia', color: 'danger', icono: 'exclamation-octagon' },
    reprogramado: { nombre: 'Reprogramado', color: 'info', icono: 'arrow-repeat' },
    demorado: { nombre: 'Demorado', color: 'warning', icono: 'hourglass-split' },
    pendiente: { nombre: 'Pendiente', color: 'secondary', icono: 'clock' }
  };

  const estadosMeli = {
    pending: { nombre: 'Pendiente', color: 'secondary', icono: 'clock' },
    handling: { nombre: 'En preparación', color: 'info', icono: 'box-seam' },
    ready_to_ship: { nombre: 'Listo para enviar', color: 'primary', icono: 'box-arrow-right' },
    shipped: { nombre: 'En camino', color: 'primary', icono: 'truck' },
    delivered: { nombre: 'Entregado', color: 'success', icono: 'check-circle-fill' },
    not_delivered: { nombre: 'No entregado', color: 'warning', icono: 'exclamation-triangle' },
    cancelled: { nombre: 'Cancelado', color: 'dark', icono: 'x-circle' },
    returning: { nombre: 'En devolución', color: 'danger', icono: 'arrow-return-left' },
    returned: { nombre: 'Devuelto', color: 'danger', icono: 'arrow-return-left' }
  };

  const info = estadosZupply[estadoKey] || estadosMeli[estadoKey] || null;
  const color = info?.color || 'secondary';
  const nombre = info?.nombre || (estadoKey ? estadoKey.replace(/_/g, ' ').replace(/\b\w/g, letra => letra.toUpperCase()) : 'Desconocido');
  const icono = info?.icono || 'question-circle';

  return {
    nombre,
    color,
    icono,
    clase: info?.clase || CLASES_BADGE_ESTADO[color] || CLASES_BADGE_ESTADO.secondary
  };
}

function obtenerEstadoDesdeValor(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'object') {
    return (
      (typeof valor.estado === 'string' && valor.estado.trim()) ||
      (typeof valor.status === 'string' && valor.status.trim()) ||
      (typeof valor.state === 'string' && valor.state.trim()) ||
      (typeof valor.nombre === 'string' && valor.nombre.trim()) ||
      ''
    );
  }
  return '';
}

function obtenerEstadoActual(envio) {
  if (!envio || typeof envio !== 'object') {
    return 'pendiente';
  }

  if (envio.meli_id) {
    const estadoMeli = envio.estado_meli;
    if (estadoMeli) {
      const valor = obtenerEstadoDesdeValor(estadoMeli);
      if (valor) {
        return valor;
      }
    }
  }

  const estadoDirecto = obtenerEstadoDesdeValor(envio.estado);
  if (estadoDirecto) {
    return estadoDirecto;
  }

  const estadoAlternativo = obtenerEstadoDesdeValor(envio.estado_meli);
  if (estadoAlternativo) {
    return estadoAlternativo;
  }

  const estadoGenerico = obtenerEstadoDesdeValor(envio.status) || obtenerEstadoDesdeValor(envio.state);
  if (estadoGenerico) {
    return estadoGenerico;
  }

  return 'pendiente';
}

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

    const btnWhatsApp = document.getElementById('btnWhatsAppDetalle');
    if (btnWhatsApp) {
      const numeroWhatsApp = typeof telefono === 'string' ? telefono.replace(/\D/g, '') : '';
      if (numeroWhatsApp) {
        const destinatario =
          envio.destinatario ||
          envio.nombre_destinatario ||
          envio?.destino?.nombre ||
          'Cliente';
        const trackingParaMensaje = tracking !== '-' ? tracking : (envio.id_venta || envio._id || '');
        const linkSeguimiento = trackingParaMensaje
          ? `https://app.zupply.tech/track/${trackingParaMensaje}`
          : '';

        const lineasMensaje = [
          `Hola ${destinatario}!`,
          '',
          'Tu envío está en camino 📦'
        ];

        if (linkSeguimiento) {
          lineasMensaje.push('', 'Seguí tu pedido en este link:', linkSeguimiento);
        }

        if (trackingParaMensaje) {
          lineasMensaje.push('', `Tracking: ${trackingParaMensaje}`);
        }

        lineasMensaje.push('', 'Gracias por tu compra!');

        const mensaje = lineasMensaje.join('\n');

        btnWhatsApp.href = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
        btnWhatsApp.classList.remove('hidden');
      } else {
        btnWhatsApp.classList.add('hidden');
        btnWhatsApp.href = '#';
      }
    }

    const referencia =
      envio.referencia ||
      envio.indicaciones ||
      envio?.destino?.referencia ||
      '-';
    document.getElementById('modalReferencia').textContent = referencia;

    const fecha = envio.fecha || envio.createdAt || envio.created_at || envio.updatedAt || null;
    document.getElementById('modalFecha').textContent =
      fecha ? new Date(fecha).toLocaleString('es-AR') : '-';

    const estadoActual = obtenerEstadoActual(envio);
    document.getElementById('modalEstado').innerHTML = crearBadgeEstado(estadoActual);

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
    const badge = crearBadgeEstado(item.estado || item.status || item.state);
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
  const estadoKey = obtenerEstadoDesdeValor(estado) || 'pendiente';
  const info = obtenerInfoEstado(estadoKey);
  const badgeClass = info.clase || CLASES_BADGE_ESTADO.secondary;
  const icon = info.icono ? `<i class="bi bi-${info.icono} text-sm" aria-hidden="true"></i>` : '';

  const contenido = icon ? `${icon}<span>${info.nombre}</span>` : `<span>${info.nombre}</span>`;

  return `<span class="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border ${badgeClass}">${contenido}</span>`;
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
window.obtenerInfoEstado = obtenerInfoEstado;
window.obtenerEstadoActual = obtenerEstadoActual;
