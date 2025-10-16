// public/js/panel-clientes.js
(function(){
  const MODAL_ID = 'modalDetalleEnvioCliente';

  function generarBadgeEstado(estado, labelOverride) {
    const COLORES = {
      'en_preparacion': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
      'en_planta': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
      'en_camino': 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300',
      'entregado': 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
      'comprador_ausente': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
      'rechazado': 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
      'pendiente': 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300',
      'asignado': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300',
      'demorado': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
      'reprogramado': 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300',
      'cancelado': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300'
    };

    const key = typeof estado === 'string' && estado.trim() ? estado.trim().toLowerCase() : 'pendiente';
    const color = COLORES[key] || COLORES.pendiente;
    const labelBase = labelOverride && String(labelOverride).trim()
      ? labelOverride
      : (key ? key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Pendiente');

    return `<span class="inline-flex items-center text-xs px-2.5 py-0.5 rounded-full border ${color}">${labelBase}</span>`;
  }

  async function abrirModalEnvioCliente(envioId) {
    try {
      if (!envioId) throw new Error('Envío inválido');

      const res = await fetch(`/api/envios/${encodeURIComponent(envioId)}`, {
        credentials: 'include'
      });

      if (!res.ok) {
        let message = 'Error al cargar envío';
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch (_) {}
        throw new Error(message);
      }

      const envio = await res.json();

      setText('detTrackingEnvioCliente', envio.tracking || envio.id_venta || '-');
      setText('detDestinatarioEnvioCliente', envio.destinatario || '-');
      setText('detDireccionEnvioCliente', envio.direccion || '-');
      setText('detCPEnvioCliente', envio.codigo_postal || '-');
      setText('detPartidoEnvioCliente', envio.partido || envio?.destino?.partido || '-');
      setText('detTelefonoEnvioCliente', envio.telefono || envio.phone || '-');
      setText('detReferenciaEnvioCliente', envio.referencia || '-');
      setText('detFechaEnvioCliente', envio.fecha ? new Date(envio.fecha).toLocaleString('es-AR') : '-');

      const estadoBadge = generarBadgeEstado(envio.estado, envio?.estado_label || envio?.estado);
      const estadoEl = document.getElementById('detEstadoEnvioCliente');
      if (estadoEl) estadoEl.innerHTML = estadoBadge;

      const driverContainer = document.getElementById('detDriverContainerEnvioCliente');
      const driverText = document.getElementById('detDriverEnvioCliente');
      const driverData = envio.driver_id || envio.chofer || envio?.chofer_id;
      const driverName = typeof driverData === 'object' && driverData
        ? (driverData.nombre || driverData.fullname || driverData.display_name || driverData)
        : driverData;

      if (driverContainer && driverText) {
        if (driverData) {
          driverContainer.classList.remove('hidden');
          driverText.textContent = driverName || '-';
        } else {
          driverContainer.classList.add('hidden');
          driverText.textContent = '-';
        }
      }

      renderHistorialEnvioCliente(Array.isArray(envio.historial) ? envio.historial : []);

      cambiarTabEnvioCliente('detalle');
      const modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    } catch (err) {
      console.error('Error abriendo modal de envío:', err);
      alert(err.message || 'No se pudo cargar el detalle del envío');
    }
  }

  function cerrarModalEnvioCliente() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function cambiarTabEnvioCliente(tab) {
    const tabDetalle = document.getElementById('tabDetalleEnvioCliente');
    const tabHistorial = document.getElementById('tabHistorialEnvioCliente');
    const contenidoDetalle = document.getElementById('contenidoDetalleEnvioCliente');
    const contenidoHistorial = document.getElementById('contenidoHistorialEnvioCliente');

    if (!tabDetalle || !tabHistorial || !contenidoDetalle || !contenidoHistorial) return;

    if (tab === 'detalle') {
      tabDetalle.className = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400';
      tabHistorial.className = 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
      contenidoDetalle.classList.remove('hidden');
      contenidoHistorial.classList.add('hidden');
    } else {
      tabHistorial.className = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400';
      tabDetalle.className = 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
      contenidoHistorial.classList.remove('hidden');
      contenidoDetalle.classList.add('hidden');
    }
  }

  function renderHistorialEnvioCliente(historial) {
    const tbody = document.getElementById('tablaHistorialEnvioCliente');
    if (!tbody) return;

    if (!historial || historial.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-slate-500 dark:text-slate-400">No hay historial</td></tr>';
      return;
    }

    const sorted = historial
      .slice()
      .sort((a, b) => new Date(b.fecha || b.at || 0) - new Date(a.fecha || a.at || 0));

    tbody.innerHTML = sorted.map(item => {
      const fecha = item.fecha || item.at;
      const fechaStr = fecha ? new Date(fecha).toLocaleString('es-AR') : '-';
      const estadoBadge = generarBadgeEstado(item.estado, item?.estado_label || item?.estado);
      const nota = item.nota || item.observaciones || item?.note || '-';

      return `
        <tr class="border-b border-slate-200 dark:border-white/10">
          <td class="px-3 py-2 text-sm text-slate-900 dark:text-slate-100">${fechaStr}</td>
          <td class="px-3 py-2">${estadoBadge}</td>
          <td class="px-3 py-2 text-sm text-slate-600 dark:text-slate-400">${nota}</td>
        </tr>
      `;
    }).join('');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '-';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModalEnvioCliente();
  });

  const modal = document.getElementById(MODAL_ID);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalEnvioCliente();
  });

  window.abrirModalEnvioCliente = abrirModalEnvioCliente;
  window.cerrarModalEnvioCliente = cerrarModalEnvioCliente;
  window.cambiarTabEnvioCliente = cambiarTabEnvioCliente;
  window.renderHistorialEnvioCliente = renderHistorialEnvioCliente;
  window.generarBadgeEstado = generarBadgeEstado;
})();
