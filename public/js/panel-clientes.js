// Array de paquetes temporales
let paquetesTemp = [];
let puedeRequerirFirma = false; // Variable global para permisos de firma

// Cargar permisos del usuario para firma digital
(async function cargarPermisosUsuario() {
  try {
    const token = localStorage.getItem('token'); // ✅ Obtener token
    
    const response = await fetch('/api/auth/me', { 
      headers: {
        'Authorization': `Bearer ${token}` // ✅ Enviar token
      },
      cache: 'no-store' 
    });
    
    if (!response.ok) {
      console.error('Error status:', response.status);
      return;
    }

    const usuario = await response.json();
    console.log('Usuario cargado:', usuario);
    console.log('Permisos:', usuario.permisos);

    // Actualizar variable global
    puedeRequerirFirma = usuario.permisos?.puedeRequerirFirma || false;

    console.log('Puede requerir firma:', puedeRequerirFirma);

    // Mostrar u ocultar sección de firma digital
    const seccionFirma = document.getElementById('seccionFirmaDigital');
    if (seccionFirma) {
      seccionFirma.style.display = puedeRequerirFirma ? 'block' : 'none';
    }
  } catch (error) {
    console.error('Error al cargar permisos de usuario:', error);
  }
})();

// Función para generar mensaje de WhatsApp para la tabla
function generarMensajeWhatsAppTabla(envio) {
  const nombreCliente = envio.cliente_id?.nombre ||
                        envio.cliente_id?.razon_social ||
                        '';
  const destinatario = envio.destinatario || 'Cliente';
  const tracking = envio.tracking || envio.id_venta || '';
  const linkSeguimiento = `https://app.zupply.tech/track/${tracking}`;

  let mensaje = `Hola ${destinatario}!\n\n`;

  if (nombreCliente) {
    mensaje += `Tu envío de ${nombreCliente} está en camino 📦\n\n`;
  } else {
    mensaje += `Tu envío está en camino 📦\n\n`;
  }

  mensaje += `Seguí tu pedido en este link:\n${linkSeguimiento}\n\n`;
  mensaje += `Tracking: ${tracking}\n\n`;
  mensaje += `Gracias por tu compra!`;

  return mensaje;
}

// Toggle campo de monto de cobro en destino
function toggleCampoMontoCobro() {
  const checkbox = document.getElementById('paq-cobro-destino');
  const campoMonto = document.getElementById('campo-monto-cobro');
  const inputMonto = document.getElementById('paq-monto-cobro');

  if (checkbox && campoMonto && inputMonto) {
    if (checkbox.checked) {
      campoMonto.style.display = 'block';
      inputMonto.required = true;
    } else {
      campoMonto.style.display = 'none';
      inputMonto.required = false;
      inputMonto.value = '';
    }
  }
}

// ========== VALIDACIÓN CP → Partido (usando API) ==========

let timeoutValidacionCP = null;
let lastValidacionCP = null;

// Función para validar CP contra la API
async function validarCodigoPostal(cp) {
  // Validar formato primero (4 dígitos)
  if (!/^\d{4}$/.test(cp)) {
    return { valido: false, mensaje: 'Ingrese 4 dígitos numéricos' };
  }

  try {
    const response = await fetch(`/api/partidos/cp/${cp}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        valido: false,
        mensaje: error.error || error.mensaje || 'Error al validar código postal'
      };
    }

    const data = await response.json();

    if (data.valido) {
      return {
        valido: true,
        partido: data.partido,
        localidad: data.localidad,
        zona: data.zona
      };
    } else {
      return {
        valido: false,
        mensaje: data.mensaje || 'CP no está en zona de cobertura'
      };
    }
  } catch (error) {
    console.error('Error validando CP:', error);
    return {
      valido: false,
      mensaje: 'Error al verificar. Intente nuevamente.'
    };
  }
}

// Función para actualizar el feedback visual del CP
function actualizarFeedbackCP(estado, mensaje = '') {
  const inputCP = document.getElementById('paq-cp');
  const partidoInput = document.getElementById('paq-partido');

  if (!inputCP || !partidoInput) return;

  // Remover clases anteriores
  inputCP.classList.remove('border-green-500', 'border-red-500', 'border-blue-500');

  // Buscar o crear elemento de feedback
  let feedbackEl = inputCP.parentElement.querySelector('.cp-feedback');
  if (!feedbackEl) {
    feedbackEl = document.createElement('small');
    feedbackEl.className = 'cp-feedback text-xs mt-1 block';
    inputCP.parentElement.appendChild(feedbackEl);
  }

  switch (estado) {
    case 'validando':
      inputCP.classList.add('border-blue-500');
      feedbackEl.className = 'cp-feedback text-xs mt-1 block text-blue-600 dark:text-blue-400';
      feedbackEl.textContent = '🔍 Verificando...';
      partidoInput.value = '';
      break;

    case 'valido':
      inputCP.classList.add('border-green-500');
      feedbackEl.className = 'cp-feedback text-xs mt-1 block text-green-600 dark:text-green-400';
      feedbackEl.textContent = mensaje || '✓ Código postal válido';
      break;

    case 'invalido':
      inputCP.classList.add('border-red-500');
      feedbackEl.className = 'cp-feedback text-xs mt-1 block text-red-600 dark:text-red-400';
      feedbackEl.textContent = mensaje || '⚠️ Código postal no válido';
      partidoInput.value = 'Verificar manualmente';
      break;

    case 'error':
      inputCP.classList.add('border-red-500');
      feedbackEl.className = 'cp-feedback text-xs mt-1 block text-red-600 dark:text-red-400';
      feedbackEl.textContent = mensaje || '❌ Error al verificar';
      partidoInput.value = 'Verificar manualmente';
      break;

    default:
      feedbackEl.textContent = '';
      partidoInput.value = '';
      break;
  }
}

// Event listener para el input de código postal con debounce
const inputCP = document.getElementById('paq-cp');
if (inputCP) {
  inputCP.addEventListener('input', async (e) => {
    const cp = e.target.value.trim();
    const partidoInput = document.getElementById('paq-partido');

    // Limpiar timeout anterior
    if (timeoutValidacionCP) {
      clearTimeout(timeoutValidacionCP);
    }

    // Si está vacío o tiene menos de 4 dígitos, limpiar estado
    if (cp.length < 4) {
      lastValidacionCP = ''; // ✅ FIX: Limpiar lastValidacionCP para permitir re-validación
      actualizarFeedbackCP('limpiar');
      return;
    }

    // Si tiene 4 dígitos, validar con debounce
    if (cp.length === 4) {
      // Solo validar si es diferente al último validado
      if (lastValidacionCP === cp) {
        return;
      }

      actualizarFeedbackCP('validando');

      // Esperar 300ms después de que el usuario deje de escribir
      timeoutValidacionCP = setTimeout(async () => {
        lastValidacionCP = cp;

        const resultado = await validarCodigoPostal(cp);

        if (resultado.valido) {
          // Auto-completar campos
          partidoInput.value = resultado.partido;

          const mensajeFeedback = `✓ ${resultado.localidad || resultado.partido}${resultado.zona ? ` - Zona ${resultado.zona}` : ''}`;
          actualizarFeedbackCP('valido', mensajeFeedback);
        } else {
          actualizarFeedbackCP('invalido', resultado.mensaje);
        }
      }, 300);
    }

    // Si tiene más de 4 dígitos, mostrar error
    if (cp.length > 4) {
      actualizarFeedbackCP('error', 'El código postal debe tener 4 dígitos');
      partidoInput.value = '';
    }
  });
}

// Listener para cambiar ayuda contextual del tipo de envío
document.getElementById('paq-tipo-envio')?.addEventListener('change', (e) => {
  const helpText = document.getElementById('paq-tipo-help');
  if (!helpText) return;

  const textos = {
    'envio': 'Entrega estándar en domicilio',
    'retiro': 'Cliente retira en sucursal',
    'cambio': 'Retiro de producto a cambiar + entrega de nuevo'
  };

  helpText.textContent = textos[e.target.value] || '';
});

const CLASES_BADGE_ESTADO = {
  secondary: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300',
  info: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
  primary: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
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

  // Validar cobro en destino
  const cobroEnDestino = document.getElementById('paq-cobro-destino')?.checked || false;
  const montoCobro = document.getElementById('paq-monto-cobro')?.value || '';

  if (cobroEnDestino && (!montoCobro || parseFloat(montoCobro) <= 0)) {
    alert('Debe ingresar un monto válido mayor a 0 para cobro en destino');
    return;
  }

  // NUEVO: Capturar firma digital si el cliente tiene permiso
  const requiereFirma = puedeRequerirFirma
    ? (document.getElementById('requiereFirma')?.checked || false)
    : false;

  console.log('Creando paquete - Requiere firma:', requiereFirma);

  const paquete = {
    id: Date.now(),
    referencia: document.getElementById('paq-referencia')?.value.trim() || '',
    destinatario: document.getElementById('paq-destinatario')?.value.trim() || '',
    telefono: telefono || null,
    direccion: document.getElementById('paq-direccion')?.value.trim() || '',
    piso_dpto: document.getElementById('paq-piso-dpto')?.value.trim() || null,
    codigo_postal: document.getElementById('paq-cp')?.value.trim() || '',
    partido: document.getElementById('paq-partido')?.value.trim() || '',
    id_venta: null, // El backend lo autogenera - campo readonly en el formulario
    tipo: document.getElementById('paq-tipo-envio')?.value || 'envio',
    cobroEnDestino: {
      habilitado: cobroEnDestino,
      monto: cobroEnDestino ? parseFloat(montoCobro) : 0,
      cobrado: false
    },
    requiereFirma: requiereFirma
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

  // Reset cobro en destino
  const campoMontoCobro = document.getElementById('campo-monto-cobro');
  if (campoMontoCobro) campoMontoCobro.style.display = 'none';

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

  const tipoIcons = {
    'envio': '📦',
    'retiro': '🏪',
    'cambio': '🔄'
  };

  const tipoLabels = {
    'envio': 'Envío',
    'retiro': 'Retiro',
    'cambio': 'Cambio'
  };

  container.innerHTML = paquetesTemp.map((paq) => `
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
            <h6 class="mb-2">
              <i class="bi bi-box me-2"></i>
              ${paq.destinatario}
              <span class="badge ${paq.tipo === 'envio' ? 'bg-primary' : paq.tipo === 'retiro' ? 'bg-info' : 'bg-warning'} ms-2">
                ${tipoIcons[paq.tipo] || '📦'} ${tipoLabels[paq.tipo] || 'Envío'}
              </span>
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
            ${paq.cobroEnDestino?.habilitado ? `
              <div class="mt-2">
                <span class="badge bg-success">
                  💵 Cobro en Destino: $${paq.cobroEnDestino.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ` : ''}
            ${paq.requiereFirma ? `
              <div class="mt-2">
                <span class="badge bg-warning">
                  🖊️ Requiere Firma
                </span>
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

    // ==================== MOSTRAR MODAL ====================

    mostrarModalExito(result);

    // Limpiar paquetes
    paquetesTemp = [];
    renderizarPaquetes();

    // ==================== FIN ====================
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

function obtenerInfoEstado(estado) {
  const estadoKey = (estado ?? '').toString().trim().toLowerCase();

  const estadosZupply = {
    // Azul - En camino
    'en_planta': {
      nombre: 'En planta',
      color: 'info',
      icono: 'box-seam',
      clase: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300'
    },
    'asignado': {
      nombre: 'Asignado',
      color: 'info',
      icono: 'person-check',
      clase: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
    },
    'en_camino': {
      nombre: 'En camino',
      color: 'primary',
      icono: 'truck',
      clase: 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:text-white'
    },
    'en camino': {
      nombre: 'En camino',
      color: 'primary',
      icono: 'truck',
      clase: 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:text-white'
    },

    // Verde - Entregado
    'entregado': {
      nombre: 'Entregado',
      color: 'success',
      icono: 'check-circle-fill',
      clase: 'bg-green-500 text-white border-green-600 dark:bg-green-600 dark:text-white'
    },

    // Naranja - Comprador Ausente
    'ausente': {
      nombre: 'Comprador Ausente',
      color: 'warning',
      icono: 'exclamation-triangle',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'comprador_ausente': {
      nombre: 'Comprador Ausente',
      color: 'warning',
      icono: 'exclamation-triangle',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'comprador ausente': {
      nombre: 'Comprador Ausente',
      color: 'warning',
      icono: 'exclamation-triangle',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },

    // Naranja - Otras incidencias
    'inaccesible': {
      nombre: 'Inaccesible',
      color: 'warning',
      icono: 'slash-circle',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'direccion_erronea': {
      nombre: 'Dirección Errónea',
      color: 'warning',
      icono: 'geo-alt-fill',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'direccion erronea': {
      nombre: 'Dirección Errónea',
      color: 'warning',
      icono: 'geo-alt-fill',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'rechazado': {
      nombre: 'Rechazado',
      color: 'warning',
      icono: 'x-octagon',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },

    // Rojo - Cancelado, Devolución
    'cancelado': {
      nombre: 'Cancelado',
      color: 'danger',
      icono: 'x-circle',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    },
    'devolucion': {
      nombre: 'En devolución',
      color: 'danger',
      icono: 'arrow-return-left',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    },
    'incidencia': {
      nombre: 'Incidencia',
      color: 'danger',
      icono: 'exclamation-octagon',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    },

    // Gris - Pendiente
    'pendiente': {
      nombre: 'Pendiente',
      color: 'secondary',
      icono: 'clock',
      clase: 'bg-slate-400 text-white border-slate-500 dark:bg-slate-600 dark:text-white'
    },

    // Violeta - Reprogramado
    'reprogramado': {
      nombre: 'Reprogramado',
      color: 'info',
      icono: 'arrow-repeat',
      clase: 'bg-purple-500 text-white border-purple-600 dark:bg-purple-600 dark:text-white'
    },

    // Otros
    'inaccesible': {
      nombre: 'Inaccesible',
      color: 'secondary',
      icono: 'slash-circle',
      clase: 'bg-slate-500 text-white border-slate-600 dark:bg-slate-600 dark:text-white'
    },
    'demorado': {
      nombre: 'Demorado',
      color: 'warning',
      icono: 'hourglass-split',
      clase: 'bg-amber-500 text-white border-amber-600 dark:bg-amber-600 dark:text-white'
    }
  };

  const estadosMeli = {
    'pending': {
      nombre: 'Pendiente',
      color: 'secondary',
      icono: 'clock',
      clase: 'bg-slate-400 text-white border-slate-500 dark:bg-slate-600 dark:text-white'
    },
    'handling': {
      nombre: 'En preparación',
      color: 'info',
      icono: 'box-seam',
      clase: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300'
    },
    'ready_to_ship': {
      nombre: 'Listo para enviar',
      color: 'primary',
      icono: 'box-arrow-right',
      clase: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
    },
    'shipped': {
      nombre: 'En camino',
      color: 'primary',
      icono: 'truck',
      clase: 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:text-white'
    },
    'delivered': {
      nombre: 'Entregado',
      color: 'success',
      icono: 'check-circle-fill',
      clase: 'bg-green-500 text-white border-green-600 dark:bg-green-600 dark:text-white'
    },
    'not_delivered': {
      nombre: 'No entregado',
      color: 'warning',
      icono: 'exclamation-triangle',
      clase: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:text-white'
    },
    'cancelled': {
      nombre: 'Cancelado',
      color: 'danger',
      icono: 'x-circle',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    },
    'returning': {
      nombre: 'En devolución',
      color: 'danger',
      icono: 'arrow-return-left',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    },
    'returned': {
      nombre: 'Devuelto',
      color: 'danger',
      icono: 'arrow-return-left',
      clase: 'bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white'
    }
  };

  const info = estadosZupply[estadoKey] || estadosMeli[estadoKey] || null;
  const color = info?.color || 'secondary';
  const nombre = info?.nombre || (estadoKey ? estadoKey.replace(/_/g, ' ').replace(/\b\w/g, letra => letra.toUpperCase()) : 'Desconocido');
  const icono = info?.icono || 'question-circle';
  const clase = info?.clase || 'bg-slate-400 text-white border-slate-500 dark:bg-slate-600 dark:text-white';

  return {
    nombre,
    color,
    icono,
    clase
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

  // SIEMPRE usar el estado de Zupply (ya está bien mapeado)
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
        // Obtener nombre del cliente (vendedor)
        const nombreCliente = envio.cliente_id?.nombre ||
                              envio.cliente_id?.razon_social ||
                              '';

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
          ''
        ];

        // Si hay cliente, incluirlo
        if (nombreCliente) {
          lineasMensaje.push(`Tu envío de ${nombreCliente} está en camino 📦`);
        } else {
          lineasMensaje.push('Tu envío está en camino 📦');
        }

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

    // Badge del tipo de envío
    const tipo = envio.tipo || 'envio';
    const tipoConfig = {
      'envio': { icon: '📦', label: 'Envío', class: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' },
      'retiro': { icon: '🏪', label: 'Retiro', class: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300' },
      'cambio': { icon: '🔄', label: 'Cambio', class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300' }
    };
    const tipoInfo = tipoConfig[tipo] || tipoConfig['envio'];
    const tipoBadge = `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${tipoInfo.class}">${tipoInfo.icon} ${tipoInfo.label}</span>`;
    document.getElementById('modalTipo').innerHTML = tipoBadge;

    // Ocultar sección de chofer (el schema no incluye driver_id)
    document.getElementById('modalChoferContainer').classList.add('hidden');

    // Mostrar cobro en destino si está habilitado
    const cobroDestinoContainer = document.getElementById('modalCobroDestinoContainer');
    if (envio.cobroEnDestino?.habilitado) {
      const monto = (envio.cobroEnDestino.monto || 0).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      document.getElementById('modalCobroMonto').textContent = `$${monto}`;

      const cobrado = envio.cobroEnDestino.cobrado;
      const estadoBadge = cobrado
        ? '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">✓ Cobrado</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">⏳ Pendiente</span>';
      document.getElementById('modalCobroEstado').innerHTML = estadoBadge;

      // Mostrar detalles si ya fue cobrado
      const detallesDiv = document.getElementById('modalCobroDetalles');
      if (cobrado) {
        const fechaCobro = envio.cobroEnDestino.fechaCobro
          ? new Date(envio.cobroEnDestino.fechaCobro).toLocaleString('es-AR')
          : '-';
        document.getElementById('modalCobroFecha').textContent = fechaCobro;

        const metodoPago = envio.cobroEnDestino.metodoPago || 'No especificado';
        const metodosLabels = {
          'efectivo': '💵 Efectivo',
          'transferencia': '💳 Transferencia',
          'mercadopago': '🟦 Mercado Pago',
          'otro': 'Otro'
        };
        document.getElementById('modalCobroMetodo').textContent = metodosLabels[metodoPago] || metodoPago;
        detallesDiv.classList.remove('hidden');
      } else {
        detallesDiv.classList.add('hidden');
      }

      cobroDestinoContainer.classList.remove('hidden');
    } else {
      cobroDestinoContainer.classList.add('hidden');
    }

    const historial = Array.isArray(envio.historial) && envio.historial.length
      ? envio.historial
      : Array.isArray(envio.timeline) ? envio.timeline : [];
    renderizarHistorial(historial);

    // Renderizar evidencias
    renderizarEvidencias(envio);

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
  const tabEvidencias = document.getElementById('tabEvidencias');
  const contenidoDetalle = document.getElementById('contenidoDetalle');
  const contenidoHistorial = document.getElementById('contenidoHistorial');
  const contenidoEvidencias = document.getElementById('contenidoEvidencias');

  const baseClass = 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100';
  const baseClassWithFlex = 'px-4 py-2 font-medium border-b-2 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-2';
  const activeClass = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400';
  const activeClassWithFlex = 'px-4 py-2 font-medium border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 flex items-center gap-2';

  tabDetalle.className = baseClass;
  tabHistorial.className = baseClass;
  tabEvidencias.className = baseClassWithFlex;

  contenidoDetalle.classList.add('hidden');
  contenidoHistorial.classList.add('hidden');
  contenidoEvidencias.classList.add('hidden');

  if (tab === 'detalle') {
    tabDetalle.className = activeClass;
    contenidoDetalle.classList.remove('hidden');
  } else if (tab === 'historial') {
    tabHistorial.className = activeClass;
    contenidoHistorial.classList.remove('hidden');
  } else if (tab === 'evidencias') {
    tabEvidencias.className = activeClassWithFlex;
    contenidoEvidencias.classList.remove('hidden');
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

// ========== FUNCIONES PARA EVIDENCIAS ==========

function renderizarEvidencias(envio) {
  const container = document.getElementById('evidenciasContainer');
  const badgeEvidencias = document.getElementById('badgeEvidencias');

  if (!container) return;

  const tieneIntentos = envio.intentosFallidos && envio.intentosFallidos.length > 0;
  const tieneFirma = envio.confirmacionEntrega && envio.confirmacionEntrega.firmaS3Key;
  const totalEvidencias = (envio.intentosFallidos?.length || 0) + (tieneFirma ? 1 : 0);

  // Actualizar badge
  if (badgeEvidencias) {
    if (totalEvidencias > 0) {
      badgeEvidencias.textContent = totalEvidencias;
      badgeEvidencias.classList.remove('hidden');
    } else {
      badgeEvidencias.classList.add('hidden');
    }
  }

  // Si no hay evidencias
  if (!tieneIntentos && !tieneFirma) {
    container.innerHTML = `
      <div class="text-center py-16 text-slate-500 dark:text-slate-400">
        <div class="text-6xl mb-5">📋</div>
        <h4 class="text-lg font-semibold mb-2">No hay evidencias disponibles</h4>
        <p class="text-sm">Este envío no tiene intentos fallidos ni firma digital registrados.</p>
      </div>
    `;
    return;
  }

  let html = '';

  // SECCIÓN: INTENTOS FALLIDOS
  if (tieneIntentos) {
    html += `
      <div class="mb-8">
        <div class="flex items-center gap-3 mb-5 pb-4 border-b-4 border-amber-400 dark:border-amber-500">
          <span class="text-4xl">⚠️</span>
          <div>
            <h4 class="text-lg font-semibold text-amber-700 dark:text-amber-400 mb-1">
              Intentos de Entrega Fallidos
            </h4>
            <small class="text-sm text-slate-600 dark:text-slate-400">
              ${envio.intentosFallidos.length} intento${envio.intentosFallidos.length > 1 ? 's' : ''} registrado${envio.intentosFallidos.length > 1 ? 's' : ''}
            </small>
          </div>
        </div>

        ${envio.intentosFallidos.map((intento, index) => `
          <div class="bg-amber-50 dark:bg-amber-900/20 p-5 rounded-xl mb-4 border-2 border-amber-300 dark:border-amber-700">
            <div class="inline-block bg-amber-700 text-white px-3 py-1 rounded-full text-sm font-bold mb-4">
              Intento #${index + 1}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
                  📅 Fecha y hora
                </div>
                <div class="font-medium">
                  ${new Date(intento.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <div class="text-sm text-slate-600 dark:text-slate-400">
                  ${new Date(intento.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              <div>
                <div class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
                  📦 Motivo
                </div>
                <div class="font-medium">
                  ${intento.motivo === 'ausente' ? '📦 Comprador Ausente' :
                    intento.motivo === 'inaccesible' ? '🚧 Inaccesible' :
                    intento.motivo === 'rechazado' ? '❌ Rechazado' :
                    intento.motivo}
                </div>
              </div>

              ${intento.chofer ? `
                <div>
                  <div class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">
                    🚚 Chofer
                  </div>
                  <div class="font-medium">
                    ${intento.chofer.nombre || 'N/A'}
                  </div>
                </div>
              ` : ''}
            </div>

            ${intento.descripcion ? `
              <div class="mb-4 p-3 bg-white/80 dark:bg-white/5 rounded-lg border border-amber-200 dark:border-amber-700">
                <div class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2">
                  💬 Descripción
                </div>
                <div class="text-sm">${intento.descripcion}</div>
              </div>
            ` : ''}

            <div class="flex gap-2 flex-wrap">
              ${intento.geolocalizacion ? `
                <a href="https://www.google.com/maps?q=${intento.geolocalizacion.lat},${intento.geolocalizacion.lng}"
                   target="_blank"
                   class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 border-2 border-amber-700 dark:border-amber-600 text-amber-700 dark:text-amber-400 rounded-lg font-semibold text-sm hover:bg-amber-700 hover:text-white transition-all">
                  🗺️ Ver Ubicación
                </a>
              ` : ''}

              ${intento.fotoS3Key ? `
                <button onclick="handleVerFotoEvidencia('${envio._id}', '${intento.fotoS3Key}', 'intento')"
                        class="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm transition-all">
                  📷 Ver Foto de Evidencia
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // SECCIÓN: FIRMA DIGITAL
  if (tieneFirma) {
    const confirmacion = envio.confirmacionEntrega;

    html += `
      <div>
        <div class="flex items-center gap-3 mb-5 pb-4 border-b-4 border-green-500">
          <span class="text-4xl">✅</span>
          <div>
            <h4 class="text-lg font-semibold text-green-600 dark:text-green-400 mb-1">
              Comprobante de Entrega
            </h4>
            <small class="text-sm text-slate-600 dark:text-slate-400">
              Firmado digitalmente por el receptor
            </small>
          </div>
        </div>

        <div class="bg-green-50 dark:bg-green-900/20 p-5 rounded-xl border-2 border-green-300 dark:border-green-700">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <div class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                👤 Receptor
              </div>
              <div class="font-medium">${confirmacion.nombreReceptor || 'N/A'}</div>
            </div>

            <div>
              <div class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                🆔 DNI
              </div>
              <div class="font-medium">${confirmacion.dniReceptor || 'N/A'}</div>
            </div>

            <div>
              <div class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                📋 Tipo de receptor
              </div>
              <div class="font-medium">
                ${confirmacion.tipoReceptor === 'destinatario' ? '👤 Destinatario' :
                  confirmacion.tipoReceptor === 'porteria' ? '🏢 Portería' :
                  confirmacion.tipoReceptor === 'familiar' ? '👥 Familiar' :
                  confirmacion.tipoReceptor === 'otro' ? '📝 Otro' : confirmacion.tipoReceptor}
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                📅 Fecha y hora
              </div>
              <div class="font-medium">
                ${new Date(confirmacion.fechaEntrega).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <div class="text-sm text-green-700 dark:text-green-400">
                ${new Date(confirmacion.fechaEntrega).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          ${confirmacion.aclaracionReceptor ? `
            <div class="mb-4 p-3 bg-white/80 dark:bg-white/5 rounded-lg border border-green-200 dark:border-green-700">
              <div class="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-2">
                💬 Aclaración
              </div>
              <div class="text-sm">${confirmacion.aclaracionReceptor}</div>
            </div>
          ` : ''}

          <!-- Botones para ver evidencias -->
          <div class="space-y-2">
            ${confirmacion.firmaS3Key ? `
              <button onclick="handleVerFirmaDigital('${envio._id}', '${confirmacion.firmaS3Key}')"
                      class="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all">
                🖊️ Ver Firma Digital
              </button>
            ` : ''}

            ${confirmacion.fotoDNIS3Key ? `
              <button onclick="handleVerFotoDNI('${envio._id}', '${confirmacion.fotoDNIS3Key}')"
                      class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all">
                📄 Ver Foto del DNI
              </button>
            ` : ''}
          </div>

          <div class="mt-4 p-3 bg-white/60 dark:bg-white/5 rounded-lg text-center text-sm text-green-700 dark:text-green-400 italic">
            ✓ Comprobante válido de entrega
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Función para ver foto de evidencia
async function handleVerFotoEvidencia(envioId, fotoS3Key, tipo) {
  const modal = document.getElementById('modalFotoEvidencia');
  const loader = document.getElementById('modalFotoLoader');
  const imagen = document.getElementById('modalFotoImagen');
  const icono = document.getElementById('modalFotoIcono');
  const texto = document.getElementById('modalFotoTexto');
  const footer = document.getElementById('modalFotoFooter');

  // Mostrar modal
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Configurar título
  icono.textContent = '📷';
  texto.textContent = 'Foto de Evidencia';

  // Mostrar loader
  loader.classList.remove('hidden');
  imagen.classList.add('hidden');

  // Footer
  footer.innerHTML = `
    <div class="inline-block px-5 py-3 bg-amber-500/30 border border-amber-500 rounded-lg text-white">
      📷 Evidencia fotográfica del intento de entrega
    </div>
  `;

  try {
    const response = await fetch(
      `/api/envios/${envioId}/foto-evidencia?key=${encodeURIComponent(fotoS3Key)}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      imagen.src = data.url;
      imagen.onload = () => {
        loader.classList.add('hidden');
        imagen.classList.remove('hidden');
      };
    } else {
      alert('No se pudo cargar la foto');
      cerrarModalFoto();
    }
  } catch (error) {
    console.error('Error al cargar foto:', error);
    alert('Error al cargar la foto de evidencia');
    cerrarModalFoto();
  }
}

// Función para ver firma digital
async function handleVerFirmaDigital(envioId, firmaS3Key) {
  const modal = document.getElementById('modalFotoEvidencia');
  const loader = document.getElementById('modalFotoLoader');
  const imagen = document.getElementById('modalFotoImagen');
  const icono = document.getElementById('modalFotoIcono');
  const texto = document.getElementById('modalFotoTexto');
  const footer = document.getElementById('modalFotoFooter');

  // Mostrar modal
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Configurar título
  icono.textContent = '🖊️';
  texto.textContent = 'Firma Digital del Receptor';

  // Mostrar loader
  loader.classList.remove('hidden');
  imagen.classList.add('hidden');

  // Footer
  footer.innerHTML = `
    <div class="inline-block px-5 py-3 bg-green-600/30 border border-green-500 rounded-lg text-white">
      ✓ Esta firma digital tiene validez como comprobante de entrega
    </div>
  `;

  try {
    const response = await fetch(
      `/api/envios/${envioId}/firma?key=${encodeURIComponent(firmaS3Key)}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      imagen.src = data.url;
      imagen.onload = () => {
        loader.classList.add('hidden');
        imagen.classList.remove('hidden');
      };
    } else {
      alert('No se pudo cargar la firma');
      cerrarModalFoto();
    }
  } catch (error) {
    console.error('Error al cargar firma:', error);
    alert('Error al cargar la firma digital');
    cerrarModalFoto();
  }
}

// Función para cerrar modal de foto
function cerrarModalFoto() {
  const modal = document.getElementById('modalFotoEvidencia');
  const imagen = document.getElementById('modalFotoImagen');

  modal.classList.add('hidden');
  modal.classList.remove('flex');
  imagen.src = '';
}

// Función para ver foto DNI
async function handleVerFotoDNI(envioId, fotoDNIS3Key) {
  const modal = document.getElementById('modalFotoEvidencia');
  const loader = document.getElementById('modalFotoLoader');
  const imagen = document.getElementById('modalFotoImagen');
  const icono = document.getElementById('modalFotoIcono');
  const texto = document.getElementById('modalFotoTexto');
  const footer = document.getElementById('modalFotoFooter');

  // Mostrar modal
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Configurar título
  icono.textContent = '📄';
  texto.textContent = 'Foto del DNI del Receptor';

  // Mostrar loader
  loader.classList.remove('hidden');
  imagen.classList.add('hidden');

  // Footer
  footer.innerHTML = `
    <div class="inline-block px-5 py-3 bg-blue-600/30 border border-blue-500 rounded-lg text-white">
      📄 Foto del DNI capturada al momento de la entrega
    </div>
  `;

  try {
    const response = await fetch(
      `/api/envios/${envioId}/foto-dni?key=${encodeURIComponent(fotoDNIS3Key)}`,
      {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      imagen.src = data.url;
      imagen.onload = () => {
        loader.classList.add('hidden');
        imagen.classList.remove('hidden');
      };
    } else {
      alert('No se pudo cargar la foto del DNI');
      cerrarModalFoto();
    }
  } catch (error) {
    console.error('Error al cargar foto DNI:', error);
    alert('Error al cargar la foto del DNI');
    cerrarModalFoto();
  }
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

// Variable global para guardar IDs creados
let enviosCreados = [];

// Helper para escapar HTML (prevenir XSS)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function mostrarModalExito(result) {
  const { exitosos, ids, errores } = result;

  if (exitosos === 0) {
    alert('No se pudo crear ningún envío');
    return;
  }

  enviosCreados = ids || [];

  // Renderizar lista de envíos creados (con escape HTML)
  const listaHTML = enviosCreados.map((id, index) => {
    const idEscaped = escapeHtml(id);
    return `
      <div class="mb-2">
        <span class="badge bg-success me-2">${index + 1}</span>
        <strong>ID:</strong> <code class="text-primary">${idEscaped}</code>
      </div>
    `;
  }).join('');

  const listaEl = document.getElementById('envios-creados-lista');
  if (!listaEl) return;

  listaEl.innerHTML = `
    <h5 class="mb-3">
      ${exitosos === 1 ? 'Envío creado' : `${exitosos} envíos creados`}
    </h5>
    ${listaHTML}
  `;

  // Si hubo errores, mostrarlos (con escape HTML)
  if (errores && errores.length > 0) {
    const erroresHTML = errores.map(e => {
      const destinatarioEscaped = escapeHtml(e.destinatario || 'N/A');
      const errorEscaped = escapeHtml(e.error || 'Error desconocido');
      return `<li><strong>${destinatarioEscaped}:</strong> ${errorEscaped}</li>`;
    }).join('');

    listaEl.innerHTML += `
      <div class="alert alert-warning mt-3 text-start">
        <strong>${errores.length} error(es):</strong>
        <ul class="mb-0">${erroresHTML}</ul>
      </div>
    `;
  }

  // Configurar botón de imprimir para abrir modal de opciones
  const btnImprimir = document.getElementById('btn-imprimir-etiquetas');

  if (enviosCreados.length === 1) {
    btnImprimir.textContent = 'Imprimir Etiqueta';
  } else {
    btnImprimir.textContent = `Imprimir ${enviosCreados.length} Etiquetas`;
  }

  // Siempre abrir el modal de opciones
  btnImprimir.onclick = abrirModalOpcionesImpresion;

  const modal = new bootstrap.Modal(document.getElementById('modalEnvioCreado'));
  modal.show();
}

function imprimirEtiqueta(idVenta) {
  // Ruta correcta: /api/envios/tracking/:id_venta/label
  window.open(`/api/envios/tracking/${idVenta}/label`, '_blank');
}

// Abrir modal de opciones de impresión
function abrirModalOpcionesImpresion() {
  const modal = document.getElementById('modalOpcionesImpresion');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

// Cerrar modal de opciones de impresión
function cerrarModalOpciones() {
  const modal = document.getElementById('modalOpcionesImpresion');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Confirmar impresión con formato seleccionado
function confirmarImpresion() {
  const formato = document.getElementById('formatoEtiquetas')?.value || 'termica';

  if (!enviosCreados || enviosCreados.length === 0) {
    alert('No hay etiquetas para imprimir');
    cerrarModalOpciones();
    return;
  }

  if (formato === 'zpl') {
    // Descargar archivo ZPL
    const ids = enviosCreados.join(',');
    window.location.href = `/api/envios/etiquetas-zpl?ids=${ids}`;
  } else {
    // Generar PDF (térmica o A4)
    imprimirTodasLasEtiquetas(formato);
  }

  cerrarModalOpciones();
}

async function imprimirTodasLasEtiquetas(formato = 'termica') {
  if (!enviosCreados || enviosCreados.length === 0) {
    alert('No hay etiquetas para imprimir');
    return;
  }

  try {
    // Mostrar indicador de carga
    const loadingMsg = document.createElement('div');
    loadingMsg.id = 'loading-etiquetas-panel';
    loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 10px; z-index: 9999;';
    loadingMsg.textContent = `Generando ${enviosCreados.length} etiquetas...`;
    document.body.appendChild(loadingMsg);

    // Llamar al endpoint de etiquetas en lote con formato
    const response = await fetch('/api/envios/etiquetas-lote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        envioIds: enviosCreados,
        formato: formato
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al generar etiquetas');
    }

    // Obtener el PDF como blob
    const blob = await response.blob();

    // Crear URL del blob y abrirlo en nueva pestaña
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');

    // Limpiar la URL después de un tiempo
    setTimeout(() => URL.revokeObjectURL(url), 10000);

  } catch (error) {
    console.error('Error imprimiendo etiquetas:', error);
    alert(`Error al generar etiquetas: ${error.message}`);
  } finally {
    // Quitar indicador de carga
    const loadingMsg = document.getElementById('loading-etiquetas-panel');
    if (loadingMsg) {
      loadingMsg.remove();
    }
  }
}

function crearOtroEnvio() {
  const modal = bootstrap.Modal.getInstance(document.getElementById('modalEnvioCreado'));
  modal?.hide();

  document.getElementById('form-paquete')?.reset();
  const partidoInput = document.getElementById('paq-partido');
  if (partidoInput) partidoInput.value = '';

  enviosCreados = [];
}

function verMisEnvios() {
  const modal = bootstrap.Modal.getInstance(document.getElementById('modalEnvioCreado'));
  modal?.hide();

  const tablaTab = new bootstrap.Tab(document.getElementById('tabla-tab'));
  tablaTab.show();

  if (typeof window.cargarEnvios === 'function') {
    window.cargarEnvios();
  }

  enviosCreados = [];
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
window.crearOtroEnvio = crearOtroEnvio;
window.verMisEnvios = verMisEnvios;
window.renderizarEvidencias = renderizarEvidencias;
window.handleVerFotoEvidencia = handleVerFotoEvidencia;
window.handleVerFirmaDigital = handleVerFirmaDigital;
window.handleVerFotoDNI = handleVerFotoDNI;
window.cerrarModalFoto = cerrarModalFoto;
