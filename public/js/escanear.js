// public/js/escanear.js
// Requiere html5-qrcode ya cargado en la página
// <script src="https://unpkg.com/html5-qrcode"></script>

(() => {
  const byId = (s) => document.getElementById(s);

  const elReader   = byId('reader');
  const elStart    = byId('btnStart');
  const elStop     = byId('btnStop');
  const rbCamara   = byId('radioCamara');
  const rbUsb      = byId('radioUsb');
  const scanList   = byId('scanList');

  let html5QrCode = null;
  let scanning    = false;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function ensureVideoAttributes() {
    // Safari iOS a veces tarda en montar el <video>, reintenta un par de veces
    let tries = 0;
    const tick = () => {
      const v = elReader?.querySelector('video');
      if (v) {
        v.setAttribute('playsinline', 'true'); // imprescindible en iOS
        v.setAttribute('autoplay', 'true');
        v.muted = true;                        // autoplay requiere muted
        v.style.objectFit = 'cover';
        v.style.width = '100%';
        v.style.height = '100%';
        return;
      }
      if (tries++ < 10) setTimeout(tick, 200);
    };
    tick();
  }

  function readerIsVisible() {
    // si estaba oculto (display:none) cuando se inició, iOS no pinta el video
    const style = getComputedStyle(elReader);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  async function startCamera() {
    if (scanning) return;
    if (!readerIsVisible()) {
      // por si el contenedor está en un tab/accordion oculto
      elReader.style.display = 'block';
    }

    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('reader', /* verbose? */ false);
    }

    try {
      // fuerza cámara trasera en iOS
      const cameraConfig = isIOS
        ? { facingMode: { exact: "environment" } }
        : { facingMode: "environment" };

      await html5QrCode.start(
        cameraConfig,
        { fps: 10, qrbox: 240 },
        onScanSuccess,
        onScanError
      );

      scanning = true;

      // iOS: asegurar atributos del <video> una vez montado
      setTimeout(ensureVideoAttributes, 250);

      // ajuste de tamaño del canvas/video al redimensionar
      window.addEventListener('resize', resizeReader, { passive: true });
      resizeReader();
    } catch (err) {
      console.error('No se pudo iniciar la cámara:', err);
      alert('No se pudo iniciar la cámara. Verificá permisos y recargá la página.');
    }
  }

  async function stopCamera() {
    if (!html5QrCode || !scanning) return;
    try {
      await html5QrCode.stop();  // detiene stream y libera cámara
      await html5QrCode.clear(); // limpia el canvas
    } catch (e) {
      console.warn('Error al detener cámara:', e);
    } finally {
      scanning = false;
      window.removeEventListener('resize', resizeReader);
    }
  }

  function resizeReader() {
    // asegura proporciones correctas del cuadro en dispositivos móviles
    const maxW = Math.min(420, window.innerWidth - 32);
    elReader.style.width  = `${maxW}px`;
    elReader.style.height = `${Math.round(maxW * 0.75)}px`; // 4:3
  }

  // === callbacks de lectura ===
  const seen = new Set();

  function onScanSuccess(decodedText /*, decodedResult */) {
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    // Mostramos la lectura
    const li = document.createElement('li');
    li.textContent = decodedText;
    scanList.prepend(li);

    // TODO: si querés, acá parseás el contenido del QR (tracking_id, sender_id, etc.)
    // y disparás tu POST al backend.
  }

  function onScanError(err) {
    // ruidoso en móviles; dejalo en blanco o logueá cada tanto
    // console.debug('scan error', err);
  }

  // === listeners UI ===
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });

  elStart?.addEventListener('click', async () => {
    if (rbUsb?.checked) {
      alert('Modo lector USB/teclado: la cámara no se usa.');
      return;
    }
    await startCamera();
  });

  elStop?.addEventListener('click', stopCamera);

  rbCamara?.addEventListener('change', () => {
    if (rbCamara.checked) startCamera();
  });

  rbUsb?.addEventListener('change', () => {
    if (rbUsb.checked) stopCamera();
  });

  // inicio “suave”: ajusta tamaño y no enciende hasta que el usuario toque
  resizeReader();
})();
