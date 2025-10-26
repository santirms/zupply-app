// Array de paquetes temporales
let paquetesTemp = [];
let ultimoEnvioCreado = null;

// Validación CP → Partido (simplificado)
const partidosPorCP = {
  '1832': 'Lomas de Zamora',
  '1414': 'CABA',
  '1828': 'Banfield',
  // ... agregar más según necesites
};

document.getElementById('paq-cp')?.addEventListener('input', (e) => {
  const cp = e.target.value;
  const partido = document.getElementById('paq-partido');

  if (partidosPorCP[cp]) {
    partido.value = partidosPorCP[cp];
  } else if (cp.length === 4) {
    partido.value = 'Verificar manualmente';
  } else {
    partido.value = '';
  }
});

const CLASES_BADGE_ESTADO = {
  secondary: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300',
  info: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
  primary: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300',
  success: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300',
  dark: 'bg-slate-600 text-white border-slate-700 dark:bg-slate-700 dark:text-slate-200'
};

function agregarPaquete() {
  const form = document.getElementById('form-paquete');

  if (!form) return;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  let telefono = document.getElementById('paq-telefono')?.value.trim() || '';
  if (telefono) {
    telefono = telefono.replace(/\s+/g, '');
  }

  const paquete = {
    id: Date.now(),
    referencia: document.getElementById('paq-referencia')?.value.trim() || '',
    destinatario: document.getElementById('paq-destinatario')?.value.trim() || '',
    telefono: telefono || null,
    direccion: document.getElementById('paq-direccion')?.value.trim() || '',
    codigo_postal: document.getElementById('paq-cp')?.value.trim() || '',
    partido: document.getElementById('paq-partido')?.value.trim() || '',
    id_venta: document.getElementById('paq-id-venta')?.value.trim() || null
  };

  if (paquete.destinatario.length < 3) {
    alert('El destinatario debe tener al menos 3 caracteres');
    return;
  }

  if (paquete.direccion.length < 5) {
    alert('La dirección debe tener al menos 5 caracteres');
    return;
  }

  if (!/^\d{4}$/.test(paquete.codigo_postal)) {
    alert('El código postal debe tener 4 dígitos');
    return;
  }

  if (!paquete.partido || paquete.partido === 'Verificar manualmente') {
    const confirmar = confirm(
      'El partido no se validó automáticamente.\n\n¿Confirmar que el código postal es correcto?'
    );
    if (!confirmar) return;
  }

  paquetesTemp.push(paquete);

  form.reset();
  const partidoInput = document.getElementById('paq-partido');
  if (partidoInput) partidoInput.value = '';

  renderizarPaquetes();

  const toast = document.createElement('div');
  toast.className = 'alert alert-success alert-dismissible fade show position-fixed top-0 end-0 m-3';
  toast.style.zIndex = '9999';
  toast.innerHTML = `
    <i class="bi bi-check-circle me-2"></i>
    Paquete agregado
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function renderizarPaquetes() {
  const container = document.getElementById('paquetes-container');
  const lista = document.getElementById('lista-paquetes');
  const count = document.getElementById('count-paquetes');

  if (!container || !lista || !count) return;

  if (paquetesTemp.length === 0) {
    lista.style.display = 'none';
    container.innerHTML = '';
    count.textContent = '0';
    return;
  }

  lista.style.display = 'block';
  count.textContent = paquetesTemp.length;

  container.innerHTML = paquetesTemp.map((paq) => `
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
            <h6 class="mb-2">
              <i class="bi bi-box me-2"></i>
              ${paq.destinatario}
            </h6>
            <div class="row small text-muted">
              <div class="col-md-6">
                <strong>Dirección:</strong> ${paq.direccion}
              </div>
              <div class="col-md-3">
                <strong>Partido:</strong> ${paq.partido}
              </div>
              <div class="col-md-3">
                <strong>CP:</strong> ${paq.codigo_postal}
              </div>
            </div>
            ${paq.referencia ? `
              <div class="small text-muted mt-1">
                <strong>Ref:</strong> ${paq.referencia}
              </div>
            ` : ''}
            ${paq.telefono ? `
              <div class="small text-muted mt-1">
                <strong>Tel:</strong> ${paq.telefono}
                <a href="https://wa.me/${paq.telefono}" target="_blank" class="ms-2 text-success">
                  <i class="bi bi-whatsapp"></i>
                </a>
              </div>
            ` : ''}
          </div>
          <button type="button" class="btn btn-sm btn-danger" onclick="eliminarPaquete(${paq.id})">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function eliminarPaquete(id) {
  paquetesTemp = paquetesTemp.filter((p) => p.id !== id);
  renderizarPaquetes();
}

async function guardarTodos(event) {
  if (paquetesTemp.length === 0) {
    alert('No hay paquetes para guardar');
    return;
  }

  const confirmar = confirm(`¿Confirmar la creación de ${paquetesTemp.length} envío(s)?`);
  if (!confirmar) return;

  const btn = event?.target || document.querySelector('#lista-paquetes button.btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';
  }

  try {
    const response = await fetch('/api/envios/cliente/lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envios: paquetesTemp })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Error guardando envíos');
    }

    const result = await response.json();

    ultimoEnvioCreado = null;

    const primerPaquete = paquetesTemp.length === 1 ? { ...paquetesTemp[0] } : null;

    if (result.exitosos === 1 && Array.isArray(result.ids) && result.ids.length === 1) {
      const idVenta = result.ids[0];
      const tracking = Array.isArray(result.trackings) && result.trackings[0]
        ? result.trackings[0]
        : idVenta;

      ultimoEnvioCreado = {
        idVenta,
        tracking,
        telefono: primerPaquete?.telefono || null
      };

      mostrarModalExito(idVenta, tracking);
    } else {
      alert(`✅ ${result.exitosos} envío(s) creado(s) correctamente`);

      volverATabla();
    }

    paquetesTemp = [];
    renderizarPaquetes();
  } catch (err) {
    console.error('Error:', err);
    alert('❌ Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-save me-1"></i>Guardar todos';
    }
  }
}

function mostrarModalExito(idVenta, tracking) {
  const trackingValue = tracking || idVenta;
  const modalHTML = `
    <div class="modal fade" id="modalEnvioCreado" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-success text-white">
            <h5 class="modal-title">
              <i class="bi bi-check-circle me-2"></i>
              Envío Creado
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center">
            <div class="mb-3">
              <i class="bi bi-box-seam text-success" style="font-size: 3rem;"></i>
            </div>
            <h5>¡Envío creado correctamente!</h5>
            <p class="mb-1"><strong>ID:</strong> <span data-role="envio-id">${idVenta}</span></p>
            <p class="mb-0"><strong>Tracking:</strong> <span data-role="envio-tracking">${trackingValue}</span></p>
          </div>
          <div class="modal-footer justify-content-center">
            <button type="button" class="btn btn-primary" data-action="imprimir">
              <i class="bi bi-printer me-1"></i>
              Imprimir Etiqueta
            </button>
            <button type="button" class="btn btn-success" data-action="whatsapp">
              <i class="bi bi-whatsapp me-1"></i>
              Enviar WhatsApp
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" data-action="ver-envios">
              Ver Mis Envíos
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!document.getElementById('modalEnvioCreado')) {
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  const modalEl = document.getElementById('modalEnvioCreado');
  if (!modalEl) return;

  const idEl = modalEl.querySelector('[data-role="envio-id"]');
  if (idEl) idEl.textContent = idVenta;

  const trackingEl = modalEl.querySelector('[data-role="envio-tracking"]');
  if (trackingEl) trackingEl.textContent = trackingValue;

  const printBtn = modalEl.querySelector('[data-action="imprimir"]');
  if (printBtn) {
    printBtn.onclick = () => imprimirEtiqueta(trackingValue);
  }

  const whatsappBtn = modalEl.querySelector('[data-action="whatsapp"]');
  if (whatsappBtn) {
    whatsappBtn.onclick = () => enviarWhatsApp(trackingValue);
  }

  const verEnviosBtn = modalEl.querySelector('[data-action="ver-envios"]');
  if (verEnviosBtn) {
    verEnviosBtn.onclick = () => {
      const modalInstance = window.bootstrap?.Modal?.getInstance
        ? window.bootstrap.Modal.getInstance(modalEl)
        : null;
      modalInstance?.hide();
    };
  }

  const modalInstance = window.bootstrap?.Modal
    ? new window.bootstrap.Modal(modalEl)
    : null;

  if (modalInstance) {
    modalEl.addEventListener('hidden.bs.modal', volverATabla, { once: true });
    modalInstance.show();
  }
}

function imprimirEtiqueta(tracking) {
  if (!tracking) return;
  window.open(`/labels/${encodeURIComponent(tracking)}.pdf`, '_blank');
}

function enviarWhatsApp(tracking) {
  const telefono = ultimoEnvioCreado?.telefono;
  if (!telefono) {
    alert('No hay teléfono asociado al envío');
    return;
  }

  const mensaje = `Hola! Tu envío ${tracking} está en proceso. Podés seguirlo acá: https://app.zupply.tech/track/${encodeURIComponent(tracking)}`;
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');
}

function volverATabla() {
  const tablaTabEl = document.getElementById('tabla-tab');
  if (tablaTabEl && window.bootstrap?.Tab) {
    const tablaTab = new window.bootstrap.Tab(tablaTabEl);
    tablaTab.show();
  }

  if (typeof window.cargarEnvios === 'function') {
    window.cargarEnvios();
  }
}

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

const enviosCache = new Map();

function normalizarIdEnvio(envio) {
  if (!envio) return null;
  const posibles = [
    envio._id,
    envio.id,
    envio.envio_id,
    envio.tracking,
    envio.tracking_id,
    envio.trackingId,
    envio.numero_seguimiento,
    envio.tracking_code,
    envio.tracking_meli,
    envio.shipment_id,
    envio.id_venta,
    envio.order_id,
    envio.venta_id,
    envio.meli_id
  ];

  const valor = posibles.find((val) => typeof val === 'string' && val.trim()) || posibles.find(Boolean);
  return valor ? String(valor) : null;
}

function guardarEnvioEnCache(envio, { completo = false } = {}) {
  const id = normalizarIdEnvio(envio);
  if (!id) return null;

  const previo = enviosCache.get(id) || {};
  const combinado = { ...previo, ...envio };

  if (completo || previo.__full) {
    combinado.__full = true;
  }

  enviosCache.set(id, combinado);
  return combinado;
}

function registrarEnviosParciales(envios) {
  if (!Array.isArray(envios)) return;
  for (const envio of envios) {
    guardarEnvioEnCache(envio, { completo: false });
  }
}

function registrarEnvioCompleto(envio) {
  if (!envio) return null;
  return guardarEnvioEnCache(envio, { completo: true });
}

function obtenerEnvioDeCache(envioId) {
  if (!envioId) return null;
  const clave = String(envioId);
  return enviosCache.get(clave) || null;
}

function obtenerEstadoActual(envio) {
  if (!envio || typeof envio !== 'object') {
    return '';
  }

  if (envio.meli_id && envio.estado_meli?.status) {
    return envio.estado_meli.status;
  }

  return obtenerEstadoDesdeValor(envio.estado);
}

// ========== MODAL DE DETALLE ==========

async function abrirModalDetalle(envioId) {
  const idNormalizado = typeof envioId === 'string' ? envioId.trim() : String(envioId || '').trim();
  if (!idNormalizado) {
    alert('No se encontró el envío');
    return;
  }

  try {
    let envio = obtenerEnvioDeCache(idNormalizado);

    if (!envio || !envio.__full) {
      const res = await fetch(`/api/envios/${encodeURIComponent(idNormalizado)}`, { credentials: 'include' });

      if (!res.ok) {
        let message = 'Error al cargar envío';
        try {
          const err = await res.json();
          message = err.error || message;
        } catch (_) {}
        throw new Error(message);
      }

      const data = await res.json();
      envio = registrarEnvioCompleto(data) || data;
    }

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

function obtenerEnviosDesdeRespuesta(data) {
  if (!data) return [];
  if (Array.isArray(data.envios)) return data.envios;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

function normalizarNumero(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function obtenerPaginacionDesdeRespuesta(data) {
  if (!data || typeof data !== 'object') {
    return {
      page: 1,
      limit: 50,
      total: 0,
      pages: 0
    };
  }

  const envios = obtenerEnviosDesdeRespuesta(data);
  const baseLimit = normalizarNumero(data.limit, 50);
  const total = normalizarNumero(data.total, envios.length);
  const limit = normalizarNumero(data?.pagination?.limit, baseLimit);
  const page = normalizarNumero(data?.pagination?.page, normalizarNumero(data.page, 1));
  const pages = normalizarNumero(data?.pagination?.pages, normalizarNumero(data.pages, limit > 0 ? Math.ceil(total / limit) : 0));

  return {
    page: page || 1,
    limit: limit || 50,
    total: total || envios.length,
    pages: pages || (limit > 0 ? Math.ceil((total || envios.length) / limit) : 0)
  };
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
window.registrarEnviosParciales = registrarEnviosParciales;
window.registrarEnvioCompleto = registrarEnvioCompleto;
window.obtenerEnvioDeCache = obtenerEnvioDeCache;
window.obtenerEnviosDesdeRespuesta = obtenerEnviosDesdeRespuesta;
window.obtenerPaginacionDesdeRespuesta = obtenerPaginacionDesdeRespuesta;
window.agregarPaquete = agregarPaquete;
window.eliminarPaquete = eliminarPaquete;
window.renderizarPaquetes = renderizarPaquetes;
window.guardarTodos = guardarTodos;
