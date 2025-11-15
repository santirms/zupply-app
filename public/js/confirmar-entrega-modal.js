/**
 * ConfirmarEntregaModal
 * Modal para confirmar entrega tipo Mercado Envíos Flex
 * Soporta 3 pantallas: 1) Selección de receptor, 2) Firma (opcional), 3) Confirmación
 */

class ConfirmarEntregaModal {
  constructor() {
    this.envio = null;
    this.onConfirm = null;
    this.onClose = null;
    this.step = 1; // 1: receptor, 2: firma, 3: éxito
    this.tipoReceptor = null;
    this.datosReceptor = {
      nombre: '',
      dni: '',
      aclaracion: ''
    };
    this.metodoPagoCobro = ''; // Estado del método de pago para cobro en destino
    this.loading = false;
    this.signaturePad = null;
    this.geolocalizacion = null;

    this.createModalElement();
    this.captureGeolocation();
  }

  /**
   * Captura la geolocalización del dispositivo (silenciosamente)
   */
  captureGeolocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.geolocalizacion = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
        },
        (error) => {
          console.log('No se pudo obtener geolocalización:', error.message);
        },
        { timeout: 5000, enableHighAccuracy: false }
      );
    }
  }

  /**
   * Crea el elemento del modal en el DOM
   */
  createModalElement() {
    const modalHtml = `
      <div id="confirmarEntregaModal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center p-4" style="display: none;">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <!-- Header -->
          <div class="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 id="modalTitle" class="text-xl font-semibold text-slate-800"></h2>
            <button id="btnCerrarModal" type="button" class="text-slate-400 hover:text-slate-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Contenido dinámico -->
          <div id="modalContent" class="p-6"></div>
        </div>
      </div>
    `;

    // Insertar al final del body
    const temp = document.createElement('div');
    temp.innerHTML = modalHtml;
    document.body.appendChild(temp.firstElementChild);

    // Eventos
    document.getElementById('btnCerrarModal').addEventListener('click', () => {
      this.handleClose();
    });

    // Cerrar con ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.handleClose();
      }
    });

    // Cerrar al hacer click fuera
    document.getElementById('confirmarEntregaModal').addEventListener('click', (e) => {
      if (e.target.id === 'confirmarEntregaModal') {
        this.handleClose();
      }
    });
  }

  /**
   * Abre el modal
   */
  open(envio, onConfirm, onClose) {
    this.envio = envio;
    this.onConfirm = onConfirm;
    this.onClose = onClose;
    this.step = 1;
    this.tipoReceptor = null;
    this.datosReceptor = { nombre: '', dni: '', aclaracion: '' };
    this.metodoPagoCobro = ''; // Resetear método de pago

    // ===== DEBUG: Información del envío =====
    console.log('═══════════════════════════════════════════');
    console.log('🔍 MODAL CONFIRMAR ENTREGA ABIERTO');
    console.log('═══════════════════════════════════════════');
    console.log('Envío completo:', JSON.stringify(envio, null, 2));
    console.log('-------------------------------------------');
    console.log('🔹 ID del envío:', envio._id);
    console.log('🔹 ID de venta:', envio.id_venta);
    console.log('🔹 Requiere firma:', envio.requiereFirma);
    console.log('-------------------------------------------');
    console.log('💰 COBRO EN DESTINO:');
    console.log('🔹 cobroEnDestino (objeto completo):', envio.cobroEnDestino);
    console.log('🔹 ¿Tiene cobro habilitado?:', envio?.cobroEnDestino?.habilitado);
    console.log('🔹 Monto:', envio?.cobroEnDestino?.monto);
    console.log('🔹 ¿Ya cobrado?:', envio?.cobroEnDestino?.cobrado);
    console.log('🔹 Método de pago existente:', envio?.cobroEnDestino?.metodoPago);
    console.log('-------------------------------------------');
    console.log('✅ Condición para mostrar sección:');
    console.log('   habilitado && !cobrado =',
      envio?.cobroEnDestino?.habilitado, '&&',
      !envio?.cobroEnDestino?.cobrado, '=',
      (envio?.cobroEnDestino?.habilitado && !envio?.cobroEnDestino?.cobrado));
    console.log('═══════════════════════════════════════════');

    const modal = document.getElementById('confirmarEntregaModal');
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    this.renderStep();
  }

  /**
   * Cierra el modal
   */
  close() {
    const modal = document.getElementById('confirmarEntregaModal');
    modal.style.display = 'none';
    modal.classList.add('hidden');
    document.body.style.overflow = '';

    if (this.signaturePad) {
      this.signaturePad.off();
      this.signaturePad = null;
    }
  }

  /**
   * Verifica si el modal está abierto
   */
  isOpen() {
    const modal = document.getElementById('confirmarEntregaModal');
    return modal && modal.style.display === 'flex';
  }

  /**
   * Maneja el cierre del modal
   */
  handleClose() {
    // Confirmar si hay datos sin guardar
    if (this.step === 1 && this.tipoReceptor) {
      if (!confirm('¿Estás seguro? Se perderán los datos ingresados.')) {
        return;
      }
    }

    if (this.step === 2) {
      if (!confirm('¿Estás seguro? Se perderá la firma capturada.')) {
        return;
      }
    }

    this.close();
    if (this.onClose) this.onClose();
  }

  /**
   * Renderiza la pantalla según el step actual
   */
  renderStep() {
    switch (this.step) {
      case 1:
        this.renderPantallaReceptor();
        break;
      case 2:
        this.renderPantallaFirma();
        break;
      case 3:
        this.renderPantallaExito();
        break;
    }
  }

  /**
   * PANTALLA 1: Selección de Receptor
   */
  renderPantallaReceptor() {
    document.getElementById('modalTitle').textContent = '¿Quién recibe el paquete?';

    // ===== DEBUG: Renderizado de pantalla receptor =====
    console.log('🖼️  RENDERIZANDO PANTALLA RECEPTOR');
    console.log('🔹 Tiene cobro en destino?:', this.envio.cobroEnDestino?.habilitado);
    console.log('🔹 Ya cobrado?:', this.envio.cobroEnDestino?.cobrado);
    console.log('🔹 Condición alert header (habilitado && !cobrado):',
      this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado);

    // Alert de cobro en destino si está habilitado
    const cobroDestinoAlert = this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado
      ? `
        <div class="border-l-4 border-amber-500 bg-amber-50 p-4 rounded-lg mb-6">
          <div class="flex items-start gap-3">
            <div class="text-3xl">💵</div>
            <div class="flex-1">
              <h3 class="text-lg font-bold text-amber-900 mb-1">¡IMPORTANTE! Cobro en Destino</h3>
              <p class="text-amber-800 mb-2">
                Debes cobrar <strong class="text-2xl">${(this.envio.cobroEnDestino.monto || 0).toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                  style: 'currency',
                  currency: 'ARS'
                })}</strong> al entregar este paquete
              </p>
              <p class="text-sm text-amber-700">
                ⚠️ No podrás confirmar la entrega sin registrar el cobro
              </p>
            </div>
          </div>
        </div>
      `
      : '';

    console.log('🔹 Alert de cobro en header (top):', cobroDestinoAlert ? 'SÍ SE MOSTRARÁ' : 'NO se mostrará');

    // DEBUG: Verificar condición para sección de cobro en formulario
    const mostrarSeccionCobro = this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado;
    console.log('🔹 Condición para SECCIÓN DE COBRO EN FORMULARIO (habilitado && !cobrado):',
      mostrarSeccionCobro);
    if (mostrarSeccionCobro) {
      console.log('✅ ✅ ✅ LA SECCIÓN DE COBRO EN FORMULARIO SE DEBE MOSTRAR ✅ ✅ ✅');
      console.log('   Monto a mostrar:', this.envio.cobroEnDestino.monto);
    } else {
      console.log('❌ ❌ ❌ LA SECCIÓN DE COBRO EN FORMULARIO NO SE MOSTRARÁ ❌ ❌ ❌');
      console.log('   Razones posibles:');
      console.log('   - habilitado es false/undefined:', !this.envio.cobroEnDestino?.habilitado);
      console.log('   - cobrado es true:', this.envio.cobroEnDestino?.cobrado);
    }

    const content = `
      <div class="space-y-4">
        ${cobroDestinoAlert}

        <!-- Opciones de receptor -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${this.renderOpcionReceptor('destinatario', '👤', 'Destinatario', 'El destinatario original')}
          ${this.renderOpcionReceptor('porteria', '🏢', 'Portería', 'Personal de portería o encargado')}
          ${this.renderOpcionReceptor('familiar', '👥', 'Familiar', 'Familiar del destinatario')}
          ${this.renderOpcionReceptor('otro', '📝', 'Otro', 'Otra persona autorizada')}
        </div>

        <!-- Formulario dinámico -->
        <div id="formReceptor" class="mt-6 space-y-4 hidden">
          <!-- DNI (siempre visible) -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">
              DNI del receptor <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="inputDni"
              placeholder="Ej: 12345678"
              maxlength="8"
              class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id="errorDni" class="text-sm text-red-600 mt-1 hidden"></p>
          </div>

          <!-- Nombre (visible para porteria, familiar, otro) -->
          <div id="campoNombre" class="hidden">
            <label class="block text-sm font-medium text-slate-700 mb-1">
              Nombre completo <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="inputNombre"
              placeholder=""
              class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id="errorNombre" class="text-sm text-red-600 mt-1 hidden"></p>
          </div>

          <!-- Aclaración (solo para "otro") -->
          <div id="campoAclaracion" class="hidden">
            <label class="block text-sm font-medium text-slate-700 mb-1">
              Aclaración <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="inputAclaracion"
              placeholder="Ej: Vecino, Encargado del edificio"
              class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id="errorAclaracion" class="text-sm text-red-600 mt-1 hidden"></p>
          </div>

          <!-- Cobro en Destino (si está habilitado) -->
          ${this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado ? `
          <div id="campoCobroDestino" class="mt-6 rounded-lg" style="margin-top: 25px; padding: 20px; background-color: #fff3cd; border: 3px solid #ffc107; border-radius: 10px;">
            <h4 class="mb-3" style="color: #856404; margin-bottom: 15px; font-size: 1.3em; font-weight: bold;">
              💵 COBRO EN DESTINO
            </h4>

            <div class="mb-4 rounded text-center" style="background-color: #ffc107; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
              <div style="font-size: 0.9em; color: #856404;">
                Monto a cobrar:
              </div>
              <div style="font-size: 2em; font-weight: bold; color: #000;">
                ${(this.envio.cobroEnDestino.monto || 0).toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                  style: 'currency',
                  currency: 'ARS'
                })}
              </div>
            </div>

            <div>
              <label for="selectMetodoPago" class="block mb-2" style="font-weight: bold; font-size: 1.1em; display: block; margin-bottom: 10px;">
                ¿Cómo cobró el monto? <span style="color: #dc3545;">*</span>
              </label>
              <select
                id="selectMetodoPago"
                class="w-full px-3 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                style="font-size: 1.1em; padding: 12px; border: 2px solid #ffc107;"
              >
                <option value="">-- Seleccionar método de pago --</option>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">💳 Transferencia</option>
              </select>
              <p id="errorMetodoPago" class="text-sm mt-2 hidden" style="display: none; margin-top: 8px; color: #dc3545; font-weight: bold;"></p>
              <div id="feedbackMetodoPago" style="margin-top: 8px; font-weight: bold; display: none;"></div>
            </div>

            <div class="mt-3" style="margin-top: 10px;">
              <small style="display: block; color: #dc3545; font-weight: bold;">
                ⚠️ Debe seleccionar cómo cobró antes de continuar
              </small>
            </div>
          </div>
          ` : ''}
        </div>

        <!-- Botón continuar -->
        <div class="flex justify-end pt-4 border-t border-slate-200">
          <button
            id="btnContinuar"
            type="button"
            disabled
            class="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            Continuar
          </button>
        </div>
      </div>
    `;

    document.getElementById('modalContent').innerHTML = content;

    // DEBUG: Verificar si el elemento de cobro se creó en el DOM
    setTimeout(() => {
      const campoCobroDestino = document.getElementById('campoCobroDestino');
      const selectMetodoPago = document.getElementById('selectMetodoPago');
      console.log('-------------------------------------------');
      console.log('🔍 VERIFICACIÓN DOM DESPUÉS DE RENDERIZAR:');
      console.log('🔹 Elemento #campoCobroDestino existe?:', !!campoCobroDestino);
      console.log('🔹 Elemento #selectMetodoPago existe?:', !!selectMetodoPago);
      if (campoCobroDestino) {
        console.log('✅ El elemento de cobro SÍ se creó en el DOM');
        console.log('   Display:', window.getComputedStyle(campoCobroDestino).display);
        console.log('   Visibility:', window.getComputedStyle(campoCobroDestino).visibility);
      } else {
        console.log('❌ El elemento de cobro NO se creó en el DOM');
        console.log('   Esto significa que la condición de renderizado NO se cumplió');
      }
      console.log('═══════════════════════════════════════════');
    }, 100);

    // Eventos
    this.setupReceptorEvents();
  }

  /**
   * Renderiza una opción de receptor
   */
  renderOpcionReceptor(tipo, icono, titulo, descripcion) {
    const isSelected = this.tipoReceptor === tipo;
    return `
      <button
        type="button"
        class="opcion-receptor flex items-start gap-3 p-4 border-2 rounded-lg text-left transition-all ${
          isSelected
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
        }"
        data-tipo="${tipo}"
      >
        <span class="text-3xl">${icono}</span>
        <div class="flex-1">
          <div class="font-medium text-slate-800">${titulo}</div>
          <div class="text-sm text-slate-600">${descripcion}</div>
        </div>
        ${isSelected ? '<svg class="w-6 h-6 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>' : ''}
      </button>
    `;
  }

  /**
   * Configura eventos de la pantalla de receptor
   */
  setupReceptorEvents() {
    // Selección de tipo
    document.querySelectorAll('.opcion-receptor').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tipo = e.currentTarget.getAttribute('data-tipo');
        this.handleSelectTipo(tipo);
      });
    });

    // Validación en tiempo real
    const inputDni = document.getElementById('inputDni');
    const inputNombre = document.getElementById('inputNombre');
    const inputAclaracion = document.getElementById('inputAclaracion');

    if (inputDni) {
      inputDni.addEventListener('input', () => {
        this.validateDni();
        this.updateContinuarButton();
      });
    }

    if (inputNombre) {
      inputNombre.addEventListener('input', () => {
        this.validateNombre();
        this.updateContinuarButton();
      });
    }

    if (inputAclaracion) {
      inputAclaracion.addEventListener('input', () => {
        this.validateAclaracion();
        this.updateContinuarButton();
      });
    }

    // Eventos para cobro en destino (si aplica)
    const selectMetodoPago = document.getElementById('selectMetodoPago');

    if (selectMetodoPago) {
      selectMetodoPago.addEventListener('change', (e) => {
        const valor = e.target.value;
        this.metodoPagoCobro = valor;

        // Actualizar feedback visual
        const feedbackDiv = document.getElementById('feedbackMetodoPago');
        const errorDiv = document.getElementById('errorMetodoPago');

        if (errorDiv) {
          errorDiv.style.display = 'none';
          errorDiv.classList.add('hidden');
        }

        if (feedbackDiv) {
          if (valor) {
            const metodoTexto = valor === 'efectivo' ? 'Efectivo' : 'Transferencia';
            feedbackDiv.innerHTML = `✓ Método de pago seleccionado: ${metodoTexto}`;
            feedbackDiv.style.color = '#28a745';
            feedbackDiv.style.display = 'block';
          } else {
            feedbackDiv.innerHTML = '⚠️ Debe seleccionar cómo cobró antes de continuar';
            feedbackDiv.style.color = '#dc3545';
            feedbackDiv.style.display = 'block';
          }
        }

        this.updateContinuarButton();
      });
    }

    // Botón continuar
    document.getElementById('btnContinuar').addEventListener('click', () => {
      this.handleContinuar();
    });
  }

  /**
   * Maneja la selección de tipo de receptor
   */
  handleSelectTipo(tipo) {
    this.tipoReceptor = tipo;
    this.renderPantallaReceptor();

    // Mostrar formulario
    const formReceptor = document.getElementById('formReceptor');
    formReceptor.classList.remove('hidden');

    // Configurar campos según tipo
    const campoNombre = document.getElementById('campoNombre');
    const campoAclaracion = document.getElementById('campoAclaracion');
    const inputNombre = document.getElementById('inputNombre');

    if (tipo === 'destinatario') {
      campoNombre.classList.add('hidden');
      campoAclaracion.classList.add('hidden');
      this.datosReceptor.nombre = this.envio.destinatario || '';
    } else {
      campoNombre.classList.remove('hidden');

      if (tipo === 'porteria') {
        inputNombre.placeholder = 'Ej: Juan Pérez - Portero';
      } else if (tipo === 'familiar') {
        inputNombre.placeholder = 'Ej: María González - Hermana';
      } else if (tipo === 'otro') {
        inputNombre.placeholder = 'Ej: Pedro López';
        campoAclaracion.classList.remove('hidden');
      } else {
        campoAclaracion.classList.add('hidden');
      }
    }

    // Auto-focus en primer campo
    setTimeout(() => {
      document.getElementById('inputDni').focus();
    }, 100);

    this.updateContinuarButton();
  }

  /**
   * Valida DNI
   */
  validateDni() {
    const input = document.getElementById('inputDni');
    const error = document.getElementById('errorDni');
    const value = input.value.trim();

    if (!value) {
      error.textContent = 'El DNI es requerido';
      error.classList.remove('hidden');
      input.classList.add('border-red-500');
      return false;
    }

    if (!/^\d{7,8}$/.test(value)) {
      error.textContent = 'Ingrese un DNI válido (7-8 dígitos)';
      error.classList.remove('hidden');
      input.classList.add('border-red-500');
      return false;
    }

    error.classList.add('hidden');
    input.classList.remove('border-red-500');
    this.datosReceptor.dni = value;
    return true;
  }

  /**
   * Valida nombre
   */
  validateNombre() {
    const input = document.getElementById('inputNombre');
    if (!input || input.closest('#campoNombre').classList.contains('hidden')) {
      return true; // No es requerido si está oculto
    }

    const error = document.getElementById('errorNombre');
    const value = input.value.trim();

    if (value.length < 3) {
      error.textContent = 'Ingrese un nombre válido (mínimo 3 caracteres)';
      error.classList.remove('hidden');
      input.classList.add('border-red-500');
      return false;
    }

    error.classList.add('hidden');
    input.classList.remove('border-red-500');
    this.datosReceptor.nombre = value;
    return true;
  }

  /**
   * Valida aclaración
   */
  validateAclaracion() {
    const input = document.getElementById('inputAclaracion');
    if (!input || input.closest('#campoAclaracion').classList.contains('hidden')) {
      return true; // No es requerido si está oculto
    }

    const error = document.getElementById('errorAclaracion');
    const value = input.value.trim();

    if (value.length < 3) {
      error.textContent = 'Por favor aclare la relación con el destinatario';
      error.classList.remove('hidden');
      input.classList.add('border-red-500');
      return false;
    }

    error.classList.add('hidden');
    input.classList.remove('border-red-500');
    this.datosReceptor.aclaracion = value;
    return true;
  }

  /**
   * Actualiza estado del botón continuar
   */
  updateContinuarButton() {
    const btn = document.getElementById('btnContinuar');
    if (!btn || !this.tipoReceptor) return;

    let isValid = this.validateDni();

    if (this.tipoReceptor !== 'destinatario') {
      isValid = isValid && this.validateNombre();
    }

    if (this.tipoReceptor === 'otro') {
      isValid = isValid && this.validateAclaracion();
    }

    // Validar cobro en destino si está habilitado
    if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado) {
      isValid = isValid && this.metodoPagoCobro && (this.metodoPagoCobro === 'efectivo' || this.metodoPagoCobro === 'transferencia');
    }

    btn.disabled = !isValid;
  }

  /**
   * Maneja click en continuar
   */
  handleContinuar() {
    if (this.loading) return;

    // Validar todos los campos
    let isValid = this.validateDni();

    if (this.tipoReceptor !== 'destinatario') {
      isValid = isValid && this.validateNombre();
    }

    if (this.tipoReceptor === 'otro') {
      isValid = isValid && this.validateAclaracion();
    }

    // Validar cobro en destino si está habilitado
    if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado) {
      if (!this.metodoPagoCobro) {
        const errorMsg = document.getElementById('errorMetodoPago');
        if (errorMsg) {
          errorMsg.textContent = 'Debe seleccionar el método de pago';
          errorMsg.style.display = 'block';
          errorMsg.classList.remove('hidden');
        }
        alert('⚠️ Debe seleccionar el método de pago para confirmar la entrega');
        return;
      }

      if (this.metodoPagoCobro !== 'efectivo' && this.metodoPagoCobro !== 'transferencia') {
        const errorMsg = document.getElementById('errorMetodoPago');
        if (errorMsg) {
          errorMsg.textContent = 'Método de pago inválido';
          errorMsg.style.display = 'block';
          errorMsg.classList.remove('hidden');
        }
        alert('⚠️ Método de pago inválido. Solo se acepta Efectivo o Transferencia');
        return;
      }
    }

    if (!isValid) return;

    // Si requiere firma, ir a pantalla 2
    if (this.envio.requiereFirma) {
      this.step = 2;
      this.renderStep();
    } else {
      // Guardar directamente sin firma
      this.handleGuardarSinFirma();
    }
  }

  /**
   * PANTALLA 2: Captura de Firma
   */
  renderPantallaFirma() {
    document.getElementById('modalTitle').textContent = 'Firma del receptor';

    const nombreReceptor = this.tipoReceptor === 'destinatario'
      ? this.envio.destinatario
      : this.datosReceptor.nombre;

    const content = `
      <div class="space-y-4">
        <!-- Info del receptor -->
        <div class="bg-slate-50 rounded-lg p-4 text-sm">
          <p class="text-slate-700"><span class="font-medium">Receptor:</span> ${this.escapeHtml(nombreReceptor)}</p>
          <p class="text-slate-700"><span class="font-medium">DNI:</span> ${this.escapeHtml(this.datosReceptor.dni)}</p>
        </div>

        <!-- Canvas de firma -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-slate-700">
            Por favor, firme en el recuadro
          </label>
          <div class="relative border-2 border-slate-300 rounded-lg overflow-hidden bg-slate-50">
            <canvas
              id="signatureCanvas"
              class="w-full touch-none"
              style="height: 250px;"
            ></canvas>
            <div id="signaturePlaceholder" class="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-sm">
              Firme aquí con su dedo o mouse
            </div>
          </div>
          <p id="errorFirma" class="text-sm text-red-600 hidden">Por favor, capture la firma antes de continuar</p>
        </div>

        <!-- Botones -->
        <div class="flex items-center justify-between pt-4 border-t border-slate-200">
          <button
            id="btnAtras"
            type="button"
            class="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
          >
            ← Atrás
          </button>
          <div class="flex gap-2">
            <button
              id="btnLimpiarFirma"
              type="button"
              class="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50"
            >
              Limpiar
            </button>
            <button
              id="btnGuardar"
              type="button"
              disabled
              class="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <span id="btnGuardarText">Guardar Entrega</span>
              <svg id="btnGuardarSpinner" class="hidden animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modalContent').innerHTML = content;

    // Inicializar SignaturePad
    this.initSignaturePad();

    // Eventos
    document.getElementById('btnAtras').addEventListener('click', () => {
      this.step = 1;
      this.renderStep();
    });

    document.getElementById('btnLimpiarFirma').addEventListener('click', () => {
      this.signaturePad.clear();
      this.updateGuardarButton();
    });

    document.getElementById('btnGuardar').addEventListener('click', () => {
      this.handleGuardarConFirma();
    });
  }

  /**
   * Inicializa SignaturePad
   */
  initSignaturePad() {
    const canvas = document.getElementById('signatureCanvas');
    const placeholder = document.getElementById('signaturePlaceholder');

    // Ajustar tamaño del canvas
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    // Inicializar SignaturePad (usando librería desde CDN)
    if (typeof SignaturePad === 'undefined') {
      alert('Error: La librería SignaturePad no está cargada');
      return;
    }

    this.signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(249, 249, 249)',
      penColor: 'rgb(0, 0, 0)',
      minWidth: 1,
      maxWidth: 3
    });

    // Ocultar placeholder cuando empiece a firmar
    this.signaturePad.addEventListener('beginStroke', () => {
      placeholder.style.display = 'none';
      this.updateGuardarButton();
    });

    this.signaturePad.addEventListener('endStroke', () => {
      this.updateGuardarButton();
    });
  }

  /**
   * Actualiza estado del botón guardar
   */
  updateGuardarButton() {
    const btn = document.getElementById('btnGuardar');
    if (!btn || !this.signaturePad) return;

    btn.disabled = this.signaturePad.isEmpty();
  }

  /**
   * Guarda entrega CON firma
   */
  async handleGuardarConFirma() {
    if (this.loading) return;

    if (this.signaturePad.isEmpty()) {
      const error = document.getElementById('errorFirma');
      error.classList.remove('hidden');
      return;
    }

    this.setLoading(true);

    try {
      // ===== DEBUG: Construcción del payload =====
      console.log('═══════════════════════════════════════════');
      console.log('💾 GUARDANDO ENTREGA CON FIRMA');
      console.log('═══════════════════════════════════════════');

      const firmaDataURL = this.signaturePad.toDataURL('image/png');

      const payload = {
        envioId: this.envio._id,
        tipoReceptor: this.tipoReceptor,
        nombreReceptor: this.tipoReceptor === 'destinatario'
          ? this.envio.destinatario
          : this.datosReceptor.nombre,
        dniReceptor: this.datosReceptor.dni,
        aclaracionReceptor: this.tipoReceptor === 'otro' ? this.datosReceptor.aclaracion : undefined,
        firmaDigital: firmaDataURL,
        geolocalizacion: this.geolocalizacion
      };

      console.log('📦 Payload base (con firma):', {
        ...payload,
        firmaDigital: '[IMAGE DATA]' // No mostrar la imagen completa
      });

      // Incluir datos de cobro en destino si aplica
      console.log('-------------------------------------------');
      console.log('💰 VERIFICANDO COBRO EN DESTINO:');
      console.log('🔹 ¿Cobro habilitado?:', this.envio.cobroEnDestino?.habilitado);
      console.log('🔹 ¿Ya cobrado?:', this.envio.cobroEnDestino?.cobrado);
      console.log('🔹 Método de pago seleccionado:', this.metodoPagoCobro);

      if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado && this.metodoPagoCobro) {
        payload.confirmarCobro = true;
        payload.metodoPago = this.metodoPagoCobro;
        console.log('✅ SE AGREGÓ INFO DE COBRO AL PAYLOAD');
        console.log('   - confirmarCobro: true');
        console.log('   - metodoPago:', this.metodoPagoCobro);
      } else {
        console.log('❌ NO SE AGREGÓ INFO DE COBRO AL PAYLOAD');
      }

      console.log('-------------------------------------------');
      console.log('📤 PAYLOAD FINAL A ENVIAR (con firma):');
      console.log(JSON.stringify({
        ...payload,
        firmaDigital: '[IMAGE DATA]'
      }, null, 2));
      console.log('═══════════════════════════════════════════');

      const response = await fetch('/api/envios/confirmar-entrega', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resultado = await response.json();

      if (!response.ok) {
        throw new Error(resultado.error || 'Error al confirmar entrega');
      }

      // Éxito - ir a pantalla 3
      this.step = 3;
      this.renderStep();

      if (this.onConfirm) {
        this.onConfirm(resultado.envio);
      }
    } catch (error) {
      console.error('Error guardando entrega:', error);
      alert('❌ Error: ' + error.message);
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Guarda entrega SIN firma
   */
  async handleGuardarSinFirma() {
    if (this.loading) return;

    this.setLoading(true);

    try {
      // ===== DEBUG: Construcción del payload =====
      console.log('═══════════════════════════════════════════');
      console.log('💾 GUARDANDO ENTREGA SIN FIRMA');
      console.log('═══════════════════════════════════════════');

      const payload = {
        envioId: this.envio._id,
        tipoReceptor: this.tipoReceptor,
        nombreReceptor: this.tipoReceptor === 'destinatario'
          ? this.envio.destinatario
          : this.datosReceptor.nombre,
        dniReceptor: this.datosReceptor.dni,
        aclaracionReceptor: this.tipoReceptor === 'otro' ? this.datosReceptor.aclaracion : undefined,
        geolocalizacion: this.geolocalizacion
      };

      console.log('📦 Payload base:', JSON.stringify(payload, null, 2));

      // Incluir datos de cobro en destino si aplica
      console.log('-------------------------------------------');
      console.log('💰 VERIFICANDO COBRO EN DESTINO:');
      console.log('🔹 ¿Cobro habilitado?:', this.envio.cobroEnDestino?.habilitado);
      console.log('🔹 ¿Ya cobrado?:', this.envio.cobroEnDestino?.cobrado);
      console.log('🔹 Método de pago seleccionado:', this.metodoPagoCobro);
      console.log('🔹 Condición completa (habilitado && !cobrado && metodoPago):',
        this.envio.cobroEnDestino?.habilitado,
        '&&',
        !this.envio.cobroEnDestino?.cobrado,
        '&&',
        !!this.metodoPagoCobro,
        '=',
        (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado && this.metodoPagoCobro));

      if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado && this.metodoPagoCobro) {
        payload.confirmarCobro = true;
        payload.metodoPago = this.metodoPagoCobro;
        console.log('✅ SE AGREGÓ INFO DE COBRO AL PAYLOAD');
        console.log('   - confirmarCobro: true');
        console.log('   - metodoPago:', this.metodoPagoCobro);
      } else {
        console.log('❌ NO SE AGREGÓ INFO DE COBRO AL PAYLOAD');
        if (!this.envio.cobroEnDestino?.habilitado) {
          console.log('   Razón: Cobro no habilitado');
        }
        if (this.envio.cobroEnDestino?.cobrado) {
          console.log('   Razón: Ya está cobrado');
        }
        if (!this.metodoPagoCobro) {
          console.log('   Razón: No hay método de pago seleccionado');
        }
      }

      console.log('-------------------------------------------');
      console.log('📤 PAYLOAD FINAL A ENVIAR:');
      console.log(JSON.stringify(payload, null, 2));
      console.log('═══════════════════════════════════════════');

      const response = await fetch('/api/envios/confirmar-entrega', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resultado = await response.json();

      if (!response.ok) {
        throw new Error(resultado.error || 'Error al confirmar entrega');
      }

      // Éxito - ir a pantalla 3
      this.step = 3;
      this.renderStep();

      if (this.onConfirm) {
        this.onConfirm(resultado.envio);
      }
    } catch (error) {
      console.error('Error guardando entrega:', error);
      alert('❌ Error: ' + error.message);
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * PANTALLA 3: Confirmación Exitosa
   */
  renderPantallaExito() {
    document.getElementById('modalTitle').textContent = '¡Entrega confirmada!';

    const nombreReceptor = this.tipoReceptor === 'destinatario'
      ? this.envio.destinatario
      : this.datosReceptor.nombre;

    const now = new Date();
    const fechaHora = now.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const content = `
      <div class="text-center space-y-6 py-4">
        <!-- Icono de éxito -->
        <div class="inline-flex items-center justify-center w-20 h-20 bg-emerald-100 rounded-full">
          <svg class="w-12 h-12 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>

        <!-- Mensaje -->
        <div>
          <h3 class="text-2xl font-semibold text-slate-800 mb-2">¡Entrega confirmada!</h3>
          <p class="text-slate-600">Paquete entregado exitosamente</p>
        </div>

        <!-- Detalles -->
        <div class="bg-slate-50 rounded-lg p-6 text-left space-y-2">
          <p class="text-sm text-slate-700">
            <span class="font-medium">ID de venta:</span> ${this.escapeHtml(this.envio.id_venta || 'N/A')}
          </p>
          <p class="text-sm text-slate-700">
            <span class="font-medium">Receptor:</span> ${this.escapeHtml(nombreReceptor)}
          </p>
          <p class="text-sm text-slate-700">
            <span class="font-medium">DNI:</span> ${this.escapeHtml(this.datosReceptor.dni)}
          </p>
          <p class="text-sm text-slate-700">
            <span class="font-medium">Tipo:</span> ${this.getTipoReceptorLabel(this.tipoReceptor)}
          </p>
          <p class="text-sm text-slate-700">
            <span class="font-medium">Fecha y hora:</span> ${fechaHora}
          </p>
        </div>

        <!-- Botón cerrar -->
        <button
          id="btnCerrarExito"
          type="button"
          class="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          Cerrar
        </button>
      </div>
    `;

    document.getElementById('modalContent').innerHTML = content;

    // Evento
    document.getElementById('btnCerrarExito').addEventListener('click', () => {
      this.close();
      if (this.onClose) this.onClose();
    });
  }

  /**
   * Obtiene label del tipo de receptor
   */
  getTipoReceptorLabel(tipo) {
    const labels = {
      destinatario: 'Destinatario',
      porteria: 'Portería',
      familiar: 'Familiar',
      otro: 'Otro'
    };
    return labels[tipo] || tipo;
  }

  /**
   * Activa/desactiva estado de loading
   */
  setLoading(loading) {
    this.loading = loading;

    const btnGuardar = document.getElementById('btnGuardar');
    const btnGuardarText = document.getElementById('btnGuardarText');
    const btnGuardarSpinner = document.getElementById('btnGuardarSpinner');
    const btnLimpiar = document.getElementById('btnLimpiarFirma');
    const btnAtras = document.getElementById('btnAtras');

    if (btnGuardar) {
      btnGuardar.disabled = loading;
      if (loading) {
        btnGuardarText.textContent = 'Guardando...';
        btnGuardarSpinner.classList.remove('hidden');
      } else {
        btnGuardarText.textContent = 'Guardar Entrega';
        btnGuardarSpinner.classList.add('hidden');
      }
    }

    if (btnLimpiar) btnLimpiar.disabled = loading;
    if (btnAtras) btnAtras.disabled = loading;
  }

  /**
   * Escapa HTML para prevenir XSS
   */
  escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Exportar para uso global
window.ConfirmarEntregaModal = ConfirmarEntregaModal;
