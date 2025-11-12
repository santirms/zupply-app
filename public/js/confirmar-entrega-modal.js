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

    // ✅ DEBUG: Log cuando se abre el modal
    console.log('=== MODAL ABIERTO ===');
    console.log('Envío completo:', envio);
    console.log('¿Tiene cobro en destino?', envio.cobroEnDestino?.habilitado);
    console.log('Monto del cobro:', envio.cobroEnDestino?.monto);
    console.log('¿Ya fue cobrado?', envio.cobroEnDestino?.cobrado);

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

    // ✅ DEBUG: Log al renderizar pantalla
    console.log('=== RENDERIZANDO PANTALLA RECEPTOR ===');
    console.log('cobroEnDestino del envío:', this.envio.cobroEnDestino);
    console.log('¿Debería mostrar cobro en destino?', this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado);

    // Alert de cobro en destino si está habilitado
    const cobroDestinoAlert = this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado
      ? `
        <div style="
          border-left: 6px solid #f59e0b;
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 24px;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
          animation: pulse-border 2s ease-in-out infinite;
        ">
          <style>
            @keyframes pulse-border {
              0%, 100% { box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }
              50% { box-shadow: 0 6px 20px rgba(245, 158, 11, 0.6); }
            }
          </style>
          <div class="flex items-start gap-3">
            <div style="font-size: 3em; animation: bounce 2s ease-in-out infinite;">💵</div>
            <div class="flex-1">
              <h3 style="font-size: 1.5em; font-weight: bold; color: #92400e; margin-bottom: 8px;">
                🚨 ¡IMPORTANTE! COBRO EN DESTINO 🚨
              </h3>
              <p style="color: #92400e; margin-bottom: 12px; font-size: 1.1em;">
                Debes cobrar <strong style="font-size: 1.8em; color: #dc2626; text-decoration: underline;">
                  ${(this.envio.cobroEnDestino.monto || 0).toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    style: 'currency',
                    currency: 'ARS'
                  })}
                </strong> al entregar este paquete
              </p>
              <p style="color: #b45309; font-weight: bold; font-size: 1em;">
                ⚠️ No podrás confirmar la entrega sin registrar el cobro
              </p>
            </div>
          </div>
        </div>
      `
      : '';

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
          <div id="campoCobroDestino" class="mt-6 p-5 rounded-lg" style="
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border: 3px solid #f59e0b;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
          ">
            <h4 class="font-bold mb-4" style="
              color: #92400e;
              font-size: 1.4em;
              text-align: center;
              text-transform: uppercase;
              letter-spacing: 1px;
            ">
              💵 COBRO EN DESTINO - OBLIGATORIO 💵
            </h4>

            <div class="p-4 mb-4 rounded" style="
              background-color: #fff;
              border: 2px solid #dc2626;
              text-align: center;
            ">
              <p style="color: #92400e; margin-bottom: 4px; font-weight: bold;">
                MONTO A COBRAR:
              </p>
              <p style="margin: 0;">
                <strong style="font-size: 2.2em; color: #dc2626; font-weight: bold;">
                  ${(this.envio.cobroEnDestino.monto || 0).toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    style: 'currency',
                    currency: 'ARS'
                  })}
                </strong>
              </p>
            </div>

            <div>
              <label class="block font-bold mb-3" style="
                color: #92400e;
                font-size: 1.2em;
                text-align: center;
              ">
                ¿CÓMO COBRÓ? <span style="color: #dc2626; font-size: 1.2em;">*</span>
              </label>
              <select
                id="selectMetodoPago"
                class="w-full px-4 py-4 border-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                style="
                  font-size: 1.3em;
                  border: 3px solid #f59e0b;
                  font-weight: bold;
                  background-color: #fff;
                  text-align: center;
                "
              >
                <option value="">⚠️ SELECCIONAR MÉTODO ⚠️</option>
                <option value="efectivo">💵 EFECTIVO</option>
                <option value="transferencia">💳 TRANSFERENCIA</option>
              </select>
              <p id="errorMetodoPago" class="text-sm mt-2 hidden" style="
                color: #dc2626;
                font-weight: bold;
                text-align: center;
                font-size: 1em;
              "></p>
            </div>

            <div class="mt-4 p-3 rounded" style="
              background-color: #fef2f2;
              border: 2px solid #dc2626;
            ">
              <p style="
                color: #dc2626;
                font-weight: bold;
                margin: 0;
                text-align: center;
                font-size: 1em;
              ">
                🚨 DEBE SELECCIONAR EL MÉTODO DE PAGO ANTES DE CONTINUAR 🚨
              </p>
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
      selectMetodoPago.addEventListener('change', () => {
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
      const selectMetodoPago = document.getElementById('selectMetodoPago');

      // ✅ DEBUG: Log de validación cobro
      console.log('Validando cobro en destino...');
      console.log('Select de método de pago existe:', !!selectMetodoPago);

      if (selectMetodoPago) {
        const metodoPago = selectMetodoPago.value;
        console.log('Método de pago seleccionado:', metodoPago);
        isValid = isValid && metodoPago && (metodoPago === 'efectivo' || metodoPago === 'transferencia');
        console.log('¿Es válido el método?', metodoPago && (metodoPago === 'efectivo' || metodoPago === 'transferencia'));
      }
    }

    console.log('Botón continuar - isValid:', isValid);
    btn.disabled = !isValid;
  }

  /**
   * Maneja click en continuar
   */
  handleContinuar() {
    if (this.loading) return;

    // ✅ DEBUG: Log cuando se hace click en continuar
    console.log('=== CLICK EN CONTINUAR ===');
    console.log('Tipo receptor:', this.tipoReceptor);
    console.log('Datos receptor:', this.datosReceptor);

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
      const selectMetodoPago = document.getElementById('selectMetodoPago');

      console.log('Envío tiene cobro en destino - validando...');
      console.log('Select método pago existe:', !!selectMetodoPago);

      if (selectMetodoPago) {
        const metodoPago = selectMetodoPago.value;
        console.log('Método de pago seleccionado:', metodoPago);

        if (!metodoPago) {
          const errorMsg = document.getElementById('errorMetodoPago');
          if (errorMsg) {
            errorMsg.textContent = 'Debe seleccionar el método de pago';
            errorMsg.classList.remove('hidden');
          }
          console.log('❌ ERROR: No se seleccionó método de pago');
          alert('⚠️ Debe seleccionar el método de pago para confirmar la entrega');
          return;
        }

        if (metodoPago !== 'efectivo' && metodoPago !== 'transferencia') {
          const errorMsg = document.getElementById('errorMetodoPago');
          if (errorMsg) {
            errorMsg.textContent = 'Método de pago inválido';
            errorMsg.classList.remove('hidden');
          }
          console.log('❌ ERROR: Método de pago inválido:', metodoPago);
          alert('⚠️ Método de pago inválido. Solo se acepta Efectivo o Transferencia');
          return;
        }

        // Guardar método de pago para enviar al backend
        this.metodoPagoCobro = metodoPago;
        console.log('✅ Método de pago guardado:', this.metodoPagoCobro);
      }
    }

    if (!isValid) return;

    // Si requiere firma, ir a pantalla 2
    if (this.envio.requiereFirma) {
      console.log('Pasando a pantalla de firma...');
      this.step = 2;
      this.renderStep();
    } else {
      console.log('Guardando directamente sin firma...');
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

      // Incluir datos de cobro en destino si aplica
      if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado && this.metodoPagoCobro) {
        payload.confirmarCobro = true;
        payload.metodoPago = this.metodoPagoCobro;
      }

      // ✅ DEBUG: Log del payload
      console.log('=== ENVIANDO PAYLOAD CON FIRMA ===');
      console.log('Payload completo:', JSON.stringify(payload, null, 2));
      console.log('¿Tiene cobro en destino?', this.envio.cobroEnDestino?.habilitado);
      console.log('Método de pago incluido:', payload.metodoPago);
      console.log('Confirmar cobro:', payload.confirmarCobro);

      const response = await fetch('/api/envios/confirmar-entrega', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status);

      const resultado = await response.json();
      console.log('Response data:', resultado);

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

      // Incluir datos de cobro en destino si aplica
      if (this.envio.cobroEnDestino?.habilitado && !this.envio.cobroEnDestino?.cobrado && this.metodoPagoCobro) {
        payload.confirmarCobro = true;
        payload.metodoPago = this.metodoPagoCobro;
      }

      // ✅ DEBUG: Log del payload
      console.log('=== ENVIANDO PAYLOAD SIN FIRMA ===');
      console.log('Payload completo:', JSON.stringify(payload, null, 2));
      console.log('¿Tiene cobro en destino?', this.envio.cobroEnDestino?.habilitado);
      console.log('Método de pago incluido:', payload.metodoPago);
      console.log('Confirmar cobro:', payload.confirmarCobro);
      console.log('metodoPagoCobro guardado:', this.metodoPagoCobro);

      const response = await fetch('/api/envios/confirmar-entrega', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status);

      const resultado = await response.json();
      console.log('Response data:', resultado);

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
