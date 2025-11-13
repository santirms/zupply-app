/**
 * RegistrarIntentoFallidoModal
 * Modal para registrar intentos fallidos de entrega con evidencia fotográfica
 */

class RegistrarIntentoFallidoModal {
  constructor() {
    this.envio = null;
    this.onConfirm = null;
    this.onClose = null;
    this.motivo = null;
    this.descripcion = '';
    this.fotoBase64 = null;
    this.fotoPreview = null;
    this.loading = false;
    this.geolocalizacion = null;

    this.motivos = [
      {
        value: 'ausente',
        label: '🚫 Comprador Ausente',
        placeholder: 'Ej: Nadie atendió después de tocar timbre varias veces',
        emoji: '🚫'
      },
      {
        value: 'inaccesible',
        label: '🚧 Dirección Inaccesible',
        placeholder: 'Ej: Calle inundada, cortada por obras, zona peligrosa',
        emoji: '🚧'
      },
      {
        value: 'direccion_incorrecta',
        label: '📍 Dirección Incorrecta',
        placeholder: 'Ej: No existe la numeración, domicilio no encontrado',
        emoji: '📍'
      },
      {
        value: 'negativa_recibir',
        label: '❌ Negativa a Recibir',
        placeholder: 'Ej: Destinatario rechazó el paquete',
        emoji: '❌'
      },
      {
        value: 'otro',
        label: '❓ Otro Motivo',
        placeholder: 'Describa detalladamente el motivo',
        emoji: '❓'
      }
    ];

    this.createModalElement();
    this.captureGeolocation();
  }

  /**
   * Captura la geolocalización del dispositivo
   */
  captureGeolocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.geolocalizacion = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          console.log('Geolocalización capturada:', this.geolocalizacion);
        },
        (error) => {
          console.log('No se pudo obtener geolocalización:', error.message);
        },
        { timeout: 5000, enableHighAccuracy: true }
      );
    }
  }

  /**
   * Crea el elemento del modal en el DOM
   */
  createModalElement() {
    const modalHtml = `
      <div id="registrarIntentoFallidoModal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center p-4" style="display: none;">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <!-- Header -->
          <div class="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h2 class="text-xl font-semibold text-slate-800">📋 Registrar Intento Fallido</h2>
            <button id="btnCerrarModalIntento" type="button" class="text-slate-400 hover:text-slate-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Contenido -->
          <div id="modalContentIntento" class="p-6"></div>
        </div>
      </div>
    `;

    const temp = document.createElement('div');
    temp.innerHTML = modalHtml;
    document.body.appendChild(temp.firstElementChild);

    // Eventos
    document.getElementById('btnCerrarModalIntento').addEventListener('click', () => {
      this.handleClose();
    });

    // Cerrar con ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.handleClose();
      }
    });

    // Cerrar al hacer click fuera
    document.getElementById('registrarIntentoFallidoModal').addEventListener('click', (e) => {
      if (e.target.id === 'registrarIntentoFallidoModal') {
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
    this.motivo = null;
    this.descripcion = '';
    this.fotoBase64 = null;
    this.fotoPreview = null;
    this.loading = false;

    this.render();
    document.getElementById('registrarIntentoFallidoModal').style.display = 'flex';
  }

  /**
   * Cierra el modal
   */
  close() {
    document.getElementById('registrarIntentoFallidoModal').style.display = 'none';
    this.envio = null;
    this.motivo = null;
    this.descripcion = '';
    this.fotoBase64 = null;
    this.fotoPreview = null;
  }

  /**
   * Verifica si el modal está abierto
   */
  isOpen() {
    const modal = document.getElementById('registrarIntentoFallidoModal');
    return modal && modal.style.display !== 'none';
  }

  /**
   * Maneja el cierre del modal
   */
  handleClose() {
    if (this.loading) return;
    this.close();
    if (this.onClose) this.onClose();
  }

  /**
   * Renderiza el contenido del modal
   */
  render() {
    const content = document.getElementById('modalContentIntento');

    content.innerHTML = `
      <div class="space-y-6">
        <!-- Info del envío -->
        <div class="bg-slate-50 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-slate-700">ID:</span>
            <span class="text-slate-900">${this.envio.id_venta}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-slate-700">Destinatario:</span>
            <span class="text-slate-900">${this.envio.destinatario}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-slate-700">Dirección:</span>
            <span class="text-slate-900">${this.envio.direccion}</span>
          </div>
        </div>

        <!-- Selección de motivo -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-slate-700">
            Motivo del intento fallido <span class="text-red-500">*</span>
          </label>
          <select id="selectMotivo" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="">-- Seleccionar motivo --</option>
            ${this.motivos.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
          </select>
        </div>

        <!-- Descripción -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-slate-700">
            Descripción detallada <span class="text-red-500">*</span>
          </label>
          <textarea
            id="textareaDescripcion"
            rows="3"
            class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Describa lo sucedido..."
          ></textarea>
          <p id="helperDescripcion" class="text-sm text-slate-500"></p>
        </div>

        <!-- Foto de evidencia -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-slate-700">
            Foto de evidencia <span class="text-slate-500">(opcional pero recomendada)</span>
          </label>
          <input
            type="file"
            id="inputFoto"
            accept="image/*"
            capture="environment"
            class="hidden"
          />
          <button
            id="btnTomarFoto"
            type="button"
            class="w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span id="btnFotoText">📷 Tomar Foto</span>
          </button>
          <div id="fotoPreviewContainer" class="hidden mt-3">
            <img id="fotoPreview" src="" alt="Preview" class="w-full rounded-lg border-2 border-slate-200" />
          </div>
        </div>

        <!-- Botones -->
        <div class="flex gap-3 pt-4">
          <button
            id="btnCancelarIntento"
            type="button"
            class="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            id="btnRegistrarIntento"
            type="button"
            class="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span id="btnRegistrarText">✓ Registrar Intento Fallido</span>
          </button>
        </div>
      </div>
    `;

    // Eventos
    this.attachEventListeners();
  }

  /**
   * Adjunta event listeners a los elementos
   */
  attachEventListeners() {
    // Cambio de motivo
    document.getElementById('selectMotivo').addEventListener('change', (e) => {
      this.motivo = e.target.value;
      const motivoObj = this.motivos.find(m => m.value === this.motivo);
      const helper = document.getElementById('helperDescripcion');
      const textarea = document.getElementById('textareaDescripcion');

      if (motivoObj) {
        helper.textContent = motivoObj.placeholder;
        textarea.placeholder = motivoObj.placeholder;
      } else {
        helper.textContent = '';
        textarea.placeholder = 'Describa lo sucedido...';
      }
    });

    // Cambio de descripción
    document.getElementById('textareaDescripcion').addEventListener('input', (e) => {
      this.descripcion = e.target.value;
    });

    // Botón tomar foto
    document.getElementById('btnTomarFoto').addEventListener('click', () => {
      document.getElementById('inputFoto').click();
    });

    // Cambio de archivo de foto
    document.getElementById('inputFoto').addEventListener('change', (e) => {
      this.handleFotoChange(e);
    });

    // Botón cancelar
    document.getElementById('btnCancelarIntento').addEventListener('click', () => {
      this.handleClose();
    });

    // Botón registrar
    document.getElementById('btnRegistrarIntento').addEventListener('click', () => {
      this.handleRegistrar();
    });
  }

  /**
   * Maneja el cambio de archivo de foto
   */
  handleFotoChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
      alert('Por favor seleccione una imagen válida');
      return;
    }

    // Validar tamaño (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen es muy grande. El tamaño máximo es 5MB');
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      this.fotoBase64 = e.target.result;
      this.mostrarPreview(this.fotoBase64);
    };

    reader.onerror = () => {
      alert('Error al leer la imagen');
    };

    reader.readAsDataURL(file);
  }

  /**
   * Muestra el preview de la foto
   */
  mostrarPreview(dataUrl) {
    const preview = document.getElementById('fotoPreview');
    const container = document.getElementById('fotoPreviewContainer');
    const btnText = document.getElementById('btnFotoText');

    preview.src = dataUrl;
    container.classList.remove('hidden');
    btnText.textContent = '🔄 Cambiar Foto';
  }

  /**
   * Valida el formulario
   */
  validar() {
    if (!this.motivo) {
      alert('⚠️ Debe seleccionar un motivo');
      return false;
    }

    if (!this.descripcion || this.descripcion.trim().length < 5) {
      alert('⚠️ La descripción debe tener al menos 5 caracteres');
      return false;
    }

    return true;
  }

  /**
   * Maneja el registro del intento fallido
   */
  async handleRegistrar() {
    if (!this.validar()) return;
    if (this.loading) return;

    this.loading = true;
    this.setLoadingState(true);

    try {
      const payload = {
        envioId: this.envio._id,
        motivo: this.motivo,
        descripcion: this.descripcion.trim(),
        geolocalizacion: this.geolocalizacion
      };

      // Agregar foto si existe
      if (this.fotoBase64) {
        payload.fotoEvidencia = this.fotoBase64;
      }

      const response = await fetch('/api/envios/registrar-intento-fallido', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.ok) {
        this.mostrarExito();
        setTimeout(() => {
          this.close();
          if (this.onConfirm) this.onConfirm();
        }, 2000);
      } else {
        alert('❌ Error: ' + (data.error || 'Error al registrar el intento fallido'));
        this.setLoadingState(false);
        this.loading = false;
      }
    } catch (error) {
      console.error('Error:', error);
      alert('❌ Error de conexión al registrar el intento fallido');
      this.setLoadingState(false);
      this.loading = false;
    }
  }

  /**
   * Establece el estado de carga
   */
  setLoadingState(loading) {
    const btnRegistrar = document.getElementById('btnRegistrarIntento');
    const btnCancelar = document.getElementById('btnCancelarIntento');
    const btnRegistrarText = document.getElementById('btnRegistrarText');

    if (loading) {
      btnRegistrar.disabled = true;
      btnCancelar.disabled = true;
      btnRegistrarText.innerHTML = `
        <svg class="animate-spin inline-block w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Registrando...
      `;
    } else {
      btnRegistrar.disabled = false;
      btnCancelar.disabled = false;
      btnRegistrarText.textContent = '✓ Registrar Intento Fallido';
    }
  }

  /**
   * Muestra mensaje de éxito
   */
  mostrarExito() {
    const content = document.getElementById('modalContentIntento');
    const motivoObj = this.motivos.find(m => m.value === this.motivo);

    content.innerHTML = `
      <div class="text-center py-8">
        <div class="mb-4">
          <svg class="w-20 h-20 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h3 class="text-2xl font-semibold text-slate-800 mb-2">✅ Registrado correctamente</h3>
        <p class="text-slate-600 mb-4">El intento fallido ha sido registrado</p>
        <div class="bg-slate-50 rounded-lg p-4 text-left space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-2xl">${motivoObj?.emoji}</span>
            <span class="font-medium text-slate-700">${motivoObj?.label}</span>
          </div>
          <p class="text-sm text-slate-600 ml-8">${this.descripcion}</p>
          ${this.fotoBase64 ? '<p class="text-sm text-green-600 ml-8">📷 Con foto de evidencia</p>' : ''}
        </div>
      </div>
    `;
  }
}
