// public/js/panel-clientes.js
(function(){
  const modalId = 'modalDetalleCliente';

  const escapeHtml = (value) => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  async function abrirModalDetalleCliente(envioId) {
    if (!envioId) return;
    try {
      const res = await fetch(`/api/envios/${encodeURIComponent(envioId)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Error al cargar envío (${res.status})`);

      const envio = await res.json();
      const tracking = envio.tracking || envio.id_venta || envio.meli_id || envio.numero_seguimiento || envio.tracking_id || '-';
      const destinatario = envio.destinatario || envio?.destino?.nombre || envio?.destino?.destinatario || '-';
      const direccion = envio.direccion || envio?.destino?.direccion || '-';
      const cp = envio.codigo_postal || envio?.destino?.cp || envio?.destino?.codigo_postal || '-';
      const partido = envio.partido || envio?.destino?.partido || envio?.zona?.partido || '-';
      const telefono = envio.telefono || envio?.destino?.telefono || '-';
      const referencia = envio.referencia || envio?.destino?.referencia || envio?.observaciones || '-';
      const fecha = envio.fecha || envio.createdAt || envio.created_at || envio.updatedAt;
      const estado = envio.estado || envio?.estado_ui?.text || envio?.status;

      const trackingEl = document.getElementById('detTrackingCliente');
      if (trackingEl) trackingEl.textContent = tracking || '-';

      const destinatarioEl = document.getElementById('detDestinatarioCliente');
      if (destinatarioEl) destinatarioEl.textContent = destinatario || '-';

      const direccionEl = document.getElementById('detDireccionCliente');
      if (direccionEl) direccionEl.textContent = direccion || '-';

      const cpEl = document.getElementById('detCPCliente');
      if (cpEl) cpEl.textContent = cp || '-';

      const partidoEl = document.getElementById('detPartidoCliente');
      if (partidoEl) partidoEl.textContent = partido || '-';

      const telefonoEl = document.getElementById('detTelefonoCliente');
      if (telefonoEl) telefonoEl.textContent = telefono || '-';

      const referenciaEl = document.getElementById('detReferenciaCliente');
      if (referenciaEl) referenciaEl.textContent = referencia || '-';

      const fechaEl = document.getElementById('detFechaCliente');
      const fechaDate = fecha ? new Date(fecha) : null;
      const fechaTexto = fechaDate && !Number.isNaN(fechaDate.getTime())
        ? fechaDate.toLocaleString('es-AR')
        : '-';
      if (fechaEl) fechaEl.textContent = fechaTexto;

      const estadoEl = document.getElementById('detEstadoCliente');
      if (estadoEl) estadoEl.innerHTML = obtenerBadgeEstado(estado);

      const choferContainer = document.getElementById('detChoferContainerCliente');
      const choferEl = document.getElementById('detChoferCliente');
      const choferRaw = envio.chofer_id || envio.chofer;
      const choferNombre = typeof choferRaw === 'object' && choferRaw
        ? (choferRaw.nombre || choferRaw.razon_social || choferRaw.username || choferRaw)
        : choferRaw;
      if (choferRaw && choferContainer && choferEl) {
        choferContainer.classList.remove('hidden');
        choferEl.textContent = choferNombre || '-';
      } else if (choferContainer && choferEl) {
        choferContainer.classList.add('hidden');
        choferEl.textContent = '-';
      }

      renderHistorialCliente(envio.historial || envio.timeline || []);

      cambiarTabCliente('detalle');
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    } catch (err) {
      console.error('Error abriendo modal:', err);
      alert('No se pudo cargar el detalle del envío');
    }
  }

  function cerrarModalDetalleCliente() {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  function cambiarTabCliente(tab) {
    const detalleBtn = document.getElementById('tabDetalleCliente');
    const historialBtn = document.getElementById('tabHistorialCliente');
    const detalleContenido = document.getElementById('contenidoDetalleCliente');
    const historialContenido = document.getElementById('contenidoHistorialCliente');

    if (detalleBtn) {
      detalleBtn.className = tab === 'detalle'
        ? 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400'
        : 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
    }
    if (historialBtn) {
      historialBtn.className = tab === 'historial'
        ? 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400'
        : 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
    }
    if (detalleContenido) detalleContenido.classList.toggle('hidden', tab !== 'detalle');
    if (historialContenido) historialContenido.classList.toggle('hidden', tab !== 'historial');
  }

  function renderHistorialCliente(historial) {
    const tbody = document.getElementById('tablaHistorialCliente');
    if (!tbody) return;

    if (!Array.isArray(historial) || historial.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-slate-500 dark:text-slate-400">No hay historial</td></tr>';
      return;
    }

    const sorted = historial.slice().sort((a, b) => {
      const fechaA = new Date(a.fecha || a.at || a.createdAt || a.updatedAt || 0).getTime();
      const fechaB = new Date(b.fecha || b.at || b.createdAt || b.updatedAt || 0).getTime();
      return fechaB - fechaA;
    });

    tbody.innerHTML = sorted.map(h => {
      const fecha = h.fecha || h.at || h.createdAt || h.updatedAt;
      const fechaStr = fecha ? new Date(fecha).toLocaleString('es-AR') : '-';
      const estado = h.estado || h.status || h.tipo || '-';
      const nota = h.nota || h.observaciones || h.descripcion || h.message || '-';
      return `
        <tr class="border-b border-slate-200 dark:border-white/10">
          <td class="px-3 py-2 text-sm text-slate-900 dark:text-slate-100">${escapeHtml(fechaStr)}</td>
          <td class="px-3 py-2">${obtenerBadgeEstado(estado)}</td>
          <td class="px-3 py-2 text-sm text-slate-600 dark:text-slate-400">${escapeHtml(nota)}</td>
        </tr>
      `;
    }).join('');
  }

  function obtenerBadgeEstado(estado) {
    const normalized = (estado || '').toString().trim().toLowerCase();
    const map = {
      en_preparacion: {
        classes: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
        label: 'En Preparación'
      },
      pendiente: {
        classes: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
        label: 'Pendiente'
      },
      en_planta: {
        classes: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
        label: 'En Planta'
      },
      en_camino: {
        classes: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300',
        label: 'En Camino'
      },
      entregado: {
        classes: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
        label: 'Entregado'
      },
      comprador_ausente: {
        classes: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
        label: 'Comprador Ausente'
      },
      rechazado: {
        classes: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
        label: 'Rechazado'
      },
      incidencia: {
        classes: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
        label: 'Incidencia'
      },
      reprogramado: {
        classes: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300',
        label: 'Reprogramado'
      },
      demorado: {
        classes: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300',
        label: 'Demorado'
      }
    };

    const key = map[normalized] ? normalized : normalized.replace(/\s+/g, '_');
    const config = map[key] || map[normalized] || {
      classes: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300',
      label: normalized ? normalized.replace(/_/g, ' ') : 'Pendiente'
    };

    const label = (config.label || 'Pendiente').replace(/_/g, ' ');
    const pretty = label.replace(/\b\w/g, (l) => l.toUpperCase());
    return `<span class="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full border ${config.classes}">${escapeHtml(pretty)}</span>`;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModalDetalleCliente();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) cerrarModalDetalleCliente();
      });
    }
  });

  window.abrirModalDetalleCliente = abrirModalDetalleCliente;
  window.cerrarModalDetalleCliente = cerrarModalDetalleCliente;
  window.cambiarTabCliente = cambiarTabCliente;
  window.renderHistorialCliente = renderHistorialCliente;
  window.obtenerBadgeEstado = obtenerBadgeEstado;
})();
