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
window.marcarCambios = marcarCambios;
window.limpiarFormulario = limpiarFormulario;
window.cambiarModo = cambiarModo;
window.formatearTelefono = formatearTelefono;
window.abrirWhatsApp = abrirWhatsApp;
window.guardarEnvioIndividual = guardarEnvioIndividual;
window.procesarArchivoMasivo = procesarArchivoMasivo;
window.confirmarCargaMasiva = confirmarCargaMasiva;
window.imprimirEtiqueta = imprimirEtiqueta;
window.crearOtroEnvio = crearOtroEnvio;
window.verMisEnvios = verMisEnvios;
window.volverATabla = volverATabla;
// Control de creación de envíos
let hayCambiosSinGuardar = false;
let datosEnvioActual = null;
let datosMasivos = [];

function marcarCambios() {
  hayCambiosSinGuardar = true;
}

function normalizarTelefono(valor) {
  if (!valor) return '';
  let telefono = String(valor).replace(/\D/g, '');
  if (telefono.startsWith('0')) telefono = telefono.substring(1);
  if (telefono.startsWith('15')) telefono = telefono.substring(2);
  return telefono;
}

function limpiarFormulario() {
  const form = document.getElementById('form-nuevo-envio');
  form?.reset();

  const individualContent = document.getElementById('modo-individual-content');
  const masivoContent = document.getElementById('modo-masivo-content');
  const radioIndividual = document.getElementById('modo-individual');
  const radioMasivo = document.getElementById('modo-masivo');
  if (individualContent && masivoContent) {
    individualContent.style.display = 'block';
    masivoContent.style.display = 'none';
  }
  if (radioIndividual) radioIndividual.checked = true;
  if (radioMasivo) radioMasivo.checked = false;

  const btnWhatsApp = document.getElementById('btn-whatsapp');
  if (btnWhatsApp) {
    btnWhatsApp.disabled = true;
    btnWhatsApp.removeAttribute('data-phone');
  }

  const archivoMasivo = document.getElementById('archivo-masivo');
  if (archivoMasivo) archivoMasivo.value = '';
  const preview = document.getElementById('preview-masivo');
  if (preview) preview.style.display = 'none';
  const confirmBtn = document.getElementById('btn-confirmar-masivo');
  if (confirmBtn) confirmBtn.disabled = true;
  const erroresMasivo = document.getElementById('masivo-errores');
  if (erroresMasivo) erroresMasivo.style.display = 'none';

  datosMasivos = [];
  datosEnvioActual = null;
  hayCambiosSinGuardar = false;
}

// Confirmar cambio de pestaña cuando hay cambios sin guardar
document.querySelectorAll('#panelTabs button[data-bs-toggle="tab"]').forEach((btn) => {
  btn.addEventListener('show.bs.tab', (event) => {
    const target = event.target?.getAttribute('data-bs-target');
    const active = document.querySelector('#panelTabs button.active');
    const activeTarget = active?.getAttribute('data-bs-target');

    if (activeTarget === '#crear' && target !== '#crear' && hayCambiosSinGuardar) {
      const confirmar = window.confirm('¿Estás seguro de salir?\n\nHay cambios sin guardar que se perderán.');
      if (!confirmar) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        hayCambiosSinGuardar = false;
      }
    }
  });
});

function volverATabla() {
  if (hayCambiosSinGuardar) {
    const confirmar = window.confirm('¿Estás seguro de cancelar?\n\nHay cambios sin guardar que se perderán.');
    if (!confirmar) return;
  }

  hayCambiosSinGuardar = false;
  limpiarFormulario();
  if (window.bootstrap) {
    const tab = new window.bootstrap.Tab(document.getElementById('tabla-tab'));
    tab.show();
  }
}

function cambiarModo(modo) {
  const individualContent = document.getElementById('modo-individual-content');
  const masivoContent = document.getElementById('modo-masivo-content');
  const radioIndividual = document.getElementById('modo-individual');
  const radioMasivo = document.getElementById('modo-masivo');

  if (!individualContent || !masivoContent) return;

  if (modo === 'individual') {
    individualContent.style.display = 'block';
    masivoContent.style.display = 'none';
    if (radioIndividual) radioIndividual.checked = true;
    if (radioMasivo) radioMasivo.checked = false;
  } else {
    individualContent.style.display = 'none';
    masivoContent.style.display = 'block';
    if (radioMasivo) radioMasivo.checked = true;
    if (radioIndividual) radioIndividual.checked = false;
  }
}

function formatearTelefono() {
  const input = document.getElementById('envio-telefono');
  if (!input) return;

  const valor = normalizarTelefono(input.value);
  const btnWhatsApp = document.getElementById('btn-whatsapp');

  if (btnWhatsApp) {
    if (valor.length === 10) {
      btnWhatsApp.disabled = false;
      btnWhatsApp.setAttribute('data-phone', `549${valor}`);
    } else {
      btnWhatsApp.disabled = true;
      btnWhatsApp.removeAttribute('data-phone');
    }
  }
}

function abrirWhatsApp() {
  const btn = document.getElementById('btn-whatsapp');
  if (!btn) return;
  const phone = btn.getAttribute('data-phone');
  if (phone) {
    window.open(`https://wa.me/${phone}`, '_blank', 'noopener');
  }
}

async function guardarEnvioIndividual() {
  try {
    const form = document.getElementById('form-nuevo-envio');
    if (!form) return;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const telefonoNormalizado = normalizarTelefono(document.getElementById('envio-telefono')?.value || '');

    const data = {
      destinatario: document.getElementById('envio-destinatario')?.value.trim() || '',
      direccion: document.getElementById('envio-direccion')?.value.trim() || '',
      partido: document.getElementById('envio-partido')?.value.trim() || '',
      codigo_postal: document.getElementById('envio-cp')?.value.trim() || '',
      telefono: telefonoNormalizado || null,
      referencia: document.getElementById('envio-referencia')?.value.trim() || null,
      peso: document.getElementById('envio-peso')?.value ? Number(document.getElementById('envio-peso').value) : null
    };

    if (data.destinatario.length < 3) {
      alert('El nombre del destinatario debe tener al menos 3 caracteres');
      return;
    }

    if (data.direccion.length < 5) {
      alert('La dirección debe tener al menos 5 caracteres');
      return;
    }

    if (!/^\d{4}$/.test(data.codigo_postal)) {
      alert('El código postal debe tener 4 dígitos');
      return;
    }

    const response = await fetch('/api/envios/cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      let message = 'Error creando envío';
      try {
        const error = await response.json();
        message = error?.error || message;
      } catch (_) {}
      throw new Error(message);
    }

    const result = await response.json();
    datosEnvioActual = result?.envio || null;
    hayCambiosSinGuardar = false;

    if (datosEnvioActual?.id_venta) {
      const idVentaEl = document.getElementById('exito-id-venta');
      if (idVentaEl) idVentaEl.textContent = datosEnvioActual.id_venta;
    }

    if (window.bootstrap) {
      const modal = new window.bootstrap.Modal(document.getElementById('modalExito'));
      modal.show();
    }
  } catch (err) {
    console.error('Error:', err);
    alert(`❌ Error: ${err.message}`);
  }
}

async function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'binary' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Error leyendo archivo'));
    reader.readAsBinaryString(file);
  });
}

function validarDatosMasivos(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => row.destinatario && row.direccion && row.partido && row.codigo_postal)
    .map((row) => {
      const telefono = normalizarTelefono(row.telefono || row.telefono_destinatario || '');
      return {
        destinatario: String(row.destinatario || '').trim(),
        direccion: String(row.direccion || '').trim(),
        partido: String(row.partido || '').trim(),
        codigo_postal: String(row.codigo_postal || '').trim(),
        telefono: telefono || null,
        referencia: row.referencia ? String(row.referencia).trim() : null,
        peso: row.peso ? Number(row.peso) : null
      };
    });
}

function mostrarPreview(datos) {
  const preview = document.getElementById('preview-masivo');
  const thead = document.getElementById('preview-thead');
  const tbody = document.getElementById('preview-tbody');
  const count = document.getElementById('preview-count');

  if (!preview || !thead || !tbody || !count) return;

  if (!Array.isArray(datos) || datos.length === 0) {
    preview.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  thead.innerHTML = `
    <tr>
      <th>#</th>
      <th>Destinatario</th>
      <th>Dirección</th>
      <th>Partido</th>
      <th>CP</th>
    </tr>
  `;

  const filas = datos.slice(0, 10).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${d.destinatario}</td>
      <td>${d.direccion}</td>
      <td>${d.partido}</td>
      <td>${d.codigo_postal}</td>
    </tr>
  `);

  if (datos.length > 10) {
    filas.push(`
      <tr>
        <td colspan="5" class="text-center text-muted">... y ${datos.length - 10} más</td>
      </tr>
    `);
  }

  tbody.innerHTML = filas.join('');
  count.textContent = datos.length;
  preview.style.display = 'block';
}

async function procesarArchivoMasivo() {
  const input = document.getElementById('archivo-masivo');
  if (!input || !input.files || !input.files[0]) return;

  try {
    const data = await leerArchivo(input.files[0]);
    datosMasivos = validarDatosMasivos(data);
    mostrarPreview(datosMasivos);

    const btn = document.getElementById('btn-confirmar-masivo');
    if (btn) btn.disabled = datosMasivos.length === 0;
    hayCambiosSinGuardar = datosMasivos.length > 0;
  } catch (err) {
    console.error('Error:', err);
    alert(`Error procesando archivo: ${err.message}`);
  }
}

async function confirmarCargaMasiva() {
  if (!Array.isArray(datosMasivos) || datosMasivos.length === 0) return;

  const confirmar = window.confirm(`¿Confirmar la carga de ${datosMasivos.length} envíos?\n\nEsta acción no se puede deshacer.`);
  if (!confirmar) return;

  const btn = document.getElementById('btn-confirmar-masivo');
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Cargando...';

  try {
    const response = await fetch('/api/envios/cliente/masivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ envios: datosMasivos })
    });

    if (!response.ok) {
      let message = 'Error en carga masiva';
      try {
        const error = await response.json();
        message = error?.error || message;
      } catch (_) {}
      throw new Error(message);
    }

    const result = await response.json();
    const exitososEl = document.getElementById('masivo-exitosos');
    if (exitososEl) exitososEl.textContent = result?.exitosos ?? 0;

    const erroresWrapper = document.getElementById('masivo-errores');
    const erroresLista = document.getElementById('masivo-errores-lista');
    const erroresCount = document.getElementById('masivo-errores-count');

    if (erroresWrapper && erroresLista && erroresCount) {
      if (Array.isArray(result?.errores) && result.errores.length) {
        erroresWrapper.style.display = 'block';
        erroresCount.textContent = result.errores.length;
        erroresLista.innerHTML = result.errores
          .map((error) => `<li>Fila ${error.fila}: ${error.error}</li>`)
          .join('');
      } else {
        erroresWrapper.style.display = 'none';
        erroresLista.innerHTML = '';
      }
    }

    datosMasivos = [];
    hayCambiosSinGuardar = false;
    document.getElementById('archivo-masivo')?.value = '';
    const preview = document.getElementById('preview-masivo');
    if (preview) preview.style.display = 'none';
    if (btn) btn.disabled = true;

    if (window.bootstrap) {
      const modal = new window.bootstrap.Modal(document.getElementById('modalExitoMasivo'));
      modal.show();
    }
  } catch (err) {
    console.error('Error:', err);
    alert(`❌ Error: ${err.message}`);
  } finally {
    btn.disabled = datosMasivos.length === 0;
    btn.innerHTML = '<i class="bi bi-upload me-1"></i> Confirmar Carga';
  }
}

function imprimirEtiqueta() {
  if (!datosEnvioActual?.id_venta) return;
  window.open(`/labels/${datosEnvioActual.id_venta}.pdf`, '_blank', 'noopener');
}

function crearOtroEnvio() {
  if (window.bootstrap) {
    const modal = window.bootstrap.Modal.getInstance(document.getElementById('modalExito'));
    modal?.hide();
  }

  if (window.bootstrap) {
    const tab = new window.bootstrap.Tab(document.getElementById('crear-tab'));
    tab.show();
  }

  limpiarFormulario();
}

function verMisEnvios() {
  if (window.bootstrap) {
    const modalExito = window.bootstrap.Modal.getInstance(document.getElementById('modalExito'));
    const modalMasivo = window.bootstrap.Modal.getInstance(document.getElementById('modalExitoMasivo'));
    modalExito?.hide();
    modalMasivo?.hide();

    const tab = new window.bootstrap.Tab(document.getElementById('tabla-tab'));
    tab.show();
  }

  hayCambiosSinGuardar = false;
  limpiarFormulario();
  if (typeof window.loadTabla === 'function') window.loadTabla();
  if (typeof window.loadMapData === 'function') window.loadMapData();
}
