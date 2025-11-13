/**
 * RegistrarIntentoFallidoModal
 * Modal simplificado para registrar intentos fallidos de entrega
 * Estilo Mercado Envíos Flex
 */

class RegistrarIntentoFallidoModal {
  constructor() {
    this.envio = null;
    this.onConfirm = null;
    this.onClose = null;
    this.motivoSeleccionado = null;
    this.descripcion = '';
    this.foto = null;
    this.previewFoto = null;
    this.loading = false;
    this.geolocalizacion = null;

    this.motivos = [
      {
        id: 'ausente',
        label: 'Comprador Ausente',
        icon: '📦',
        color: '#ffc107',
        placeholder: 'Ej: Nadie atendió, timbre no funciona (opcional)'
      },
      {
        id: 'inaccesible',
        label: 'Inaccesible',
        icon: '🚧',
        color: '#ff9800',
        placeholder: 'Ej: Calle inundada, cortada (opcional)'
      },
      {
        id: 'rechazado',
        label: 'Rechazado',
        icon: '❌',
        color: '#f44336',
        placeholder: 'Ej: Cliente rechazó el paquete (opcional)'
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
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <!-- Header -->
          <div class="sticky top-0 bg-orange-500 px-6 py-4 flex items-center justify-between rounded-t-xl">
            <h2 class="text-xl font-bold text-white">📋 No Pude Entregar</h2>
            <button id="btnCerrarModalIntento" type="button" class="text-white hover:text-orange-100 text-2xl font-bold">
              ✕
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
    this.motivoSeleccionado = null;
    this.descripcion = '';
    this.foto = null;
    this.previewFoto = null;
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
    this.motivoSeleccionado = null;
    this.descripcion = '';
    this.foto = null;
    this.previewFoto = null;
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

    if (!this.motivoSeleccionado) {
      // PANTALLA 1: Selección de motivo con 3 botones grandes
      content.innerHTML = `
        <div class="space-y-4">
          <!-- Info del envío -->
          <div class="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
            <div class="flex gap-2">
              <span class="font-semibold text-slate-600">ID:</span>
              <span class="text-slate-900">${this.envio.id_venta}</span>
            </div>
            <div class="flex gap-2">
              <span class="font-semibold text-slate-600">Destinatario:</span>
              <span class="text-slate-900">${this.envio.destinatario}</span>
            </div>
            <div class="flex gap-2">
              <span class="font-semibold text-slate-600">Dirección:</span>
              <span class="text-slate-900">${this.envio.direccion}</span>
            </div>
          </div>

          <!-- Título -->
          <h3 class="text-lg font-semibold text-slate-800 text-center">
            ¿Qué sucedió?
          </h3>

          <!-- 3 Botones grandes -->
          <div class="space-y-3">
            ${this.motivos.map(motivo => `
              <button
                type="button"
                class="btn-motivo w-full p-5 border-2 rounded-lg text-left flex items-center gap-4 transition-all hover:shadow-lg"
                style="border-color: ${motivo.color};"
                data-motivo="${motivo.id}"
              >
                <span class="text-4xl">${motivo.icon}</span>
                <span class="text-lg font-bold text-slate-800">${motivo.label}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;

      // Eventos de los botones de motivo
      document.querySelectorAll('.btn-motivo').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const motivo = e.currentTarget.getAttribute('data-motivo');
          this.motivoSeleccionado = motivo;
          this.render();
        });

        // Efecto hover
        btn.addEventListener('mouseenter', (e) => {
          const motivo = this.motivos.find(m => m.id === e.currentTarget.getAttribute('data-motivo'));
          e.currentTarget.style.backgroundColor = motivo.color;
          e.currentTarget.querySelector('span:last-child').style.color = 'white';
        });

        btn.addEventListener('mouseleave', (e) => {
          e.currentTarget.style.backgroundColor = 'white';
          e.currentTarget.querySelector('span:last-child').style.color = '#1e293b';
        });
      });

    } else {
      // PANTALLA 2: Detalles y foto
      const motivoObj = this.motivos.find(m => m.id === this.motivoSeleccionado);

      content.innerHTML = `
        <div class="space-y-4">
          <!-- Motivo seleccionado -->
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div class="font-semibold text-slate-700 mb-2">Motivo seleccionado:</div>
            <div class="flex items-center gap-3">
              <span class="text-3xl">${motivoObj.icon}</span>
              <span class="text-lg font-bold text-slate-800">${motivoObj.label}</span>
            </div>
          </div>

          <!-- Descripción OPCIONAL -->
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-2">
              Descripción <span class="text-slate-500 font-normal">(opcional)</span>
            </label>
            <textarea
              id="textareaDescripcion"
              rows="3"
              class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
              placeholder="${motivoObj.placeholder}"
            >${this.descripcion}</textarea>
          </div>

          <!-- Foto OPCIONAL -->
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-2">
              Foto de evidencia <span class="text-slate-500 font-normal">(opcional)</span>
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
              class="w-full px-4 py-4 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-orange-500 hover:bg-orange-50 transition-colors flex items-center justify-center gap-2 text-base"
            >
              <span class="text-2xl">📷</span>
              <span id="btnFotoText">${this.foto ? 'Cambiar Foto' : 'Tomar Foto'}</span>
            </button>

            ${this.previewFoto ? `
              <div class="mt-3 text-center">
                <img
                  src="${this.previewFoto}"
                  alt="Preview"
                  class="max-w-full max-h-48 rounded-lg border-2 border-slate-200 mx-auto"
                />
              </div>
            ` : ''}
          </div>

          <!-- Botones -->
          <div class="flex gap-3 pt-4">
            <button
              id="btnVolver"
              type="button"
              class="flex-1 px-4 py-3 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors font-medium"
              ${this.loading ? 'disabled' : ''}
            >
              ← Volver
            </button>

            <button
              id="btnRegistrar"
              type="button"
              class="flex-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed"
              ${this.loading ? 'disabled' : ''}
            >
              <span id="btnRegistrarText">${this.loading ? 'Registrando...' : '✓ Registrar'}</span>
            </button>
          </div>
        </div>
      `;

      // Eventos
      this.attachEventListenersPantalla2();
    }
  }

  /**
   * Adjunta event listeners para la pantalla 2
   */
  attachEventListenersPantalla2() {
    // Descripción
    const textarea = document.getElementById('textareaDescripcion');
    if (textarea) {
      textarea.addEventListener('input', (e) => {
        this.descripcion = e.target.value;
      });
    }

    // Botón tomar foto
    const btnTomarFoto = document.getElementById('btnTomarFoto');
    if (btnTomarFoto) {
      btnTomarFoto.addEventListener('click', () => {
        document.getElementById('inputFoto').click();
      });
    }

    // Input de foto
    const inputFoto = document.getElementById('inputFoto');
    if (inputFoto) {
      inputFoto.addEventListener('change', (e) => {
        this.handleFotoChange(e);
      });
    }

    // Botón volver
    const btnVolver = document.getElementById('btnVolver');
    if (btnVolver) {
      btnVolver.addEventListener('click', () => {
        this.motivoSeleccionado = null;
        this.descripcion = '';
        this.foto = null;
        this.previewFoto = null;
        this.render();
      });
    }

    // Botón registrar
    const btnRegistrar = document.getElementById('btnRegistrar');
    if (btnRegistrar) {
      btnRegistrar.addEventListener('click', () => {
        this.handleRegistrar();
      });
    }
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

    this.foto = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewFoto = e.target.result;
      this.render();
    };
    reader.onerror = () => {
      alert('Error al leer la imagen');
    };
    reader.readAsDataURL(file);
  }

  /**
   * Maneja el registro del intento fallido
   */
  async handleRegistrar() {
    if (!this.motivoSeleccionado) {
      alert('⚠️ Debe seleccionar un motivo');
      return;
    }

    if (this.loading) return;

    this.loading = true;
    this.setLoadingState(true);

    try {
      // Usar FormData para enviar la foto como archivo
      const formData = new FormData();
      formData.append('envioId', this.envio._id);
      formData.append('motivo', this.motivoSeleccionado);
      formData.append('descripcion', this.descripcion || ''); // Opcional

      if (this.foto) {
        formData.append('fotoEvidencia', this.foto);
      }

      if (this.geolocalizacion) {
        formData.append('lat', this.geolocalizacion.lat);
        formData.append('lng', this.geolocalizacion.lng);
      }

      console.log('Enviando intento fallido:', {
        envioId: this.envio._id,
        motivo: this.motivoSeleccionado,
        tieneFoto: !!this.foto
      });

      const response = await fetch('/api/envios/registrar-intento-fallido', {
        method: 'POST',
        body: formData
        // NO incluir Content-Type header, el browser lo setea automáticamente con boundary
      });

      if (response.ok) {
        this.mostrarExito();
        setTimeout(() => {
          this.close();
          if (this.onConfirm) this.onConfirm();
        }, 2000);
      } else {
        const error = await response.json();
        console.error('Error del backend:', error);
        alert('❌ Error: ' + (error.error || 'Error al registrar intento'));
        this.setLoadingState(false);
        this.loading = false;
      }
    } catch (error) {
      console.error('Error:', error);
      alert('❌ Error al registrar el intento fallido');
      this.setLoadingState(false);
      this.loading = false;
    }
  }

  /**
   * Establece el estado de carga
   */
  setLoadingState(loading) {
    const btnRegistrarText = document.getElementById('btnRegistrarText');
    const btnVolver = document.getElementById('btnVolver');
    const btnRegistrar = document.getElementById('btnRegistrar');

    if (loading) {
      if (btnRegistrar) btnRegistrar.disabled = true;
      if (btnVolver) btnVolver.disabled = true;
      if (btnRegistrarText) {
        btnRegistrarText.innerHTML = `
          <svg class="animate-spin inline-block w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Registrando...
        `;
      }
    } else {
      if (btnRegistrar) btnRegistrar.disabled = false;
      if (btnVolver) btnVolver.disabled = false;
      if (btnRegistrarText) btnRegistrarText.textContent = '✓ Registrar';
    }
  }

  /**
   * Muestra mensaje de éxito
   */
  mostrarExito() {
    const content = document.getElementById('modalContentIntento');
    const motivoObj = this.motivos.find(m => m.id === this.motivoSeleccionado);

    content.innerHTML = `
      <div class="text-center py-8">
        <div class="mb-4">
          <svg class="w-20 h-20 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h3 class="text-2xl font-bold text-slate-800 mb-2">✅ Registrado correctamente</h3>
        <p class="text-slate-600 mb-4">El intento fallido ha sido registrado</p>
        <div class="bg-slate-50 rounded-lg p-4 text-left space-y-2">
          <div class="flex items-center gap-3">
            <span class="text-3xl">${motivoObj?.icon}</span>
            <span class="font-bold text-slate-700">${motivoObj?.label}</span>
          </div>
          ${this.descripcion ? `<p class="text-sm text-slate-600 ml-12">${this.descripcion}</p>` : ''}
          ${this.foto ? '<p class="text-sm text-green-600 ml-12 font-medium">📷 Con foto de evidencia</p>' : ''}
        </div>
      </div>
    `;
  }
}
