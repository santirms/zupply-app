/**
 * Escapa caracteres HTML para prevenir XSS
 */
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Obtener tracking de la URL
const urlParams = new URLSearchParams(window.location.search);
const tracking = urlParams.get('t') || window.location.pathname.split('/').pop();
const trackingParam = tracking ? encodeURIComponent(tracking) : '';

console.log('Tracking:', tracking);

// Estados de la UI
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const successState = document.getElementById('successState');

// Cargar datos del envío
async function cargarEnvio() {
  try {
    if (!trackingParam || tracking === 'track' || tracking === 'track.html') {
      mostrarError('No se especificó un número de tracking válido');
      return;
    }

    const res = await fetch(`/api/tracking/${trackingParam}`);
    
    if (!res.ok) {
      const err = await res.json();
      mostrarError(err.error || 'Envío no encontrado');
      return;
    }

    const envio = await res.json();
    mostrarEnvio(envio);

  } catch (err) {
    console.error('Error cargando envío:', err);
    mostrarError('Error al cargar la información del envío');
  }
}

function mostrarError(mensaje) {
  loadingState.classList.add('hidden');
  errorState.classList.remove('hidden');
  document.getElementById('errorMessage').textContent = mensaje;
}

function mostrarEnvio(envio) {
  loadingState.classList.add('hidden');
  successState.classList.remove('hidden');

  // Tracking
  document.getElementById('trackingNumber').textContent = envio.tracking || envio.id_venta || '-';

  // Estado actual
  const estadoInfo = obtenerInfoEstado(envio.estado);
  
  const statusIcon = document.getElementById('statusIcon');
  statusIcon.className = `inline-flex items-center justify-center w-20 h-20 rounded-full ${estadoInfo.bgColor}`;
  statusIcon.innerHTML = estadoInfo.icon;
  
  document.getElementById('statusTitle').textContent = estadoInfo.titulo;
  document.getElementById('statusDescription').textContent = estadoInfo.descripcion;

  // Última actualización
  const ultimaActualizacion = envio.historial && envio.historial.length > 0
    ? envio.historial[envio.historial.length - 1].fecha || envio.historial[envio.historial.length - 1].at
    : envio.fecha;
  
  document.getElementById('lastUpdate').textContent = ultimaActualizacion
    ? new Date(ultimaActualizacion).toLocaleString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '-';

  // Detalles
  document.getElementById('destinatario').textContent = envio.destinatario || '-';
  document.getElementById('direccion').textContent = envio.direccion || '-';
  
  const cpPartido = [envio.codigo_postal, envio.partido].filter(Boolean).join(' - ');
  document.getElementById('codigoPostal').textContent = cpPartido || '-';

  // Historial
  renderizarHistorial(envio.historial || []);
}

function obtenerInfoEstado(estado) {
  const estados = {
    'en_planta': {
      titulo: 'En planta',
      descripcion: 'Tu envío está en nuestra planta de distribución',
      bgColor: 'bg-blue-100',
      icon: '<svg class="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>'
    },
    'en_camino': {
      titulo: 'En camino',
      descripcion: 'Tu envío está en camino a destino',
      bgColor: 'bg-cyan-100',
      icon: '<svg class="w-10 h-10 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>'
    },
    'entregado': {
      titulo: '¡Entregado!',
      descripcion: 'Tu envío fue entregado exitosamente',
      bgColor: 'bg-green-100',
      icon: '<svg class="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    },
    'comprador_ausente': {
      titulo: 'Comprador ausente',
      descripcion: 'No encontramos a nadie en el domicilio. Nos contactaremos contigo',
      bgColor: 'bg-orange-100',
      icon: '<svg class="w-10 h-10 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    },
    'rechazado': {
      titulo: 'Rechazado',
      descripcion: 'El envío fue rechazado',
      bgColor: 'bg-red-100',
      icon: '<svg class="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    },
    'pendiente': {
      titulo: 'Pendiente',
      descripcion: 'Tu envío está pendiente de procesamiento',
      bgColor: 'bg-gray-100',
      icon: '<svg class="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    }
  };

  return estados[estado] || estados.pendiente;
}

function renderizarHistorial(historial) {
  const timeline = document.getElementById('timeline');

  if (!historial || historial.length === 0) {
    timeline.innerHTML = '<p class="text-gray-500">No hay historial disponible</p>';
    return;
  }

  // Ordenar por fecha ascendente (más antiguo primero)
  const sorted = historial.slice().sort((a, b) =>
    new Date(a.fecha || a.at || 0) - new Date(b.fecha || b.at || 0)
  );

  timeline.innerHTML = sorted.map((item, index) => {
    const fecha = item.fecha || item.at;
    const fechaStr = fecha
      ? new Date(fecha).toLocaleString('es-AR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    const esUltimo = index === sorted.length - 1;
    const estadoInfo = obtenerInfoEstado(item.estado);
    const notaSegura = escapeHtml(item.nota || item.observaciones);

    return `
      <div class="relative pb-8 ${esUltimo ? '' : 'border-l-2 border-gray-200'} pl-8 ml-2">
        <div class="absolute left-0 top-0 -ml-2 w-4 h-4 rounded-full ${esUltimo ? 'bg-orange-500 pulse-dot' : 'bg-gray-300'}"></div>
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-sm text-gray-500 mb-1">${fechaStr}</p>
          <p class="font-semibold text-gray-900 mb-1">${estadoInfo.titulo}</p>
          ${notaSegura ? `<p class="text-sm text-gray-600">${notaSegura}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Cargar al iniciar
cargarEnvio();

// Actualizar cada 30 segundos
setInterval(cargarEnvio, 30000);
