// public/js/escanear.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let html5QrCode, scanning = false;
const seen = new Set();

document.addEventListener('DOMContentLoaded', () => {
  // Contenedores y controles
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const reader           = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');
  const list             = qs('#scanList');

  // Inicializar html5-qrcode (pero no iniciar aún)
  html5QrCode = new Html5Qrcode(reader.id);

  // Cambio de modo
  modoRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'camara' && radio.checked) {
        camaraContainer.classList.remove('hidden');
        tecladoContainer.classList.add('hidden');
      } else if (radio.value === 'teclado' && radio.checked) {
        camaraContainer.classList.add('hidden');
        tecladoContainer.classList.remove('hidden');
        inputTeclado.focus();
      }
      // Siempre detenemos la cámara al cambiar de modo
      if (scanning) stopScanner();
    });
  });

  // Cámara: controles de inicio/parada
  startBtn.addEventListener('click', startScanner);
  stopBtn.addEventListener('click', stopScanner);

  // Lector USB: al presionar Enter en el input
  inputTeclado.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = inputTeclado.value.trim();
      inputTeclado.value = '';
      if (code) onScanSuccess(code);
    }
  });

  // Funciones de cámara
  async function startScanner() {
    statusText.textContent = 'Iniciando cámara…';
    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => onScanSuccess(decodedText)
      );
      scanning = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;
      statusText.textContent = 'Escáner activo. Apunta al código.';
    } catch (e) {
      console.error('Error iniciando cámara:', e);
      statusText.textContent = 'No se pudo iniciar cámara.';
    }
  }

  async function stopScanner() {
    if (!scanning) return;
    await html5QrCode.stop();
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // Mismo workflow tras decodificar
  async function onScanSuccess(decodedText) {
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    let data;
    try {
      data = JSON.parse(decodedText);
    } catch {
      console.warn('QR no es JSON:', decodedText);
      return;
    }

    const {
      sender_id,
      tracking_id: meli_id,
      hashnumber,
      direccion,
      codigo_postal,
      destinatario
    } = data;

    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg shadow flex flex-col gap-2';
    card.innerHTML = `
      <p><strong>Sender ID:</strong> ${sender_id}</p>
      <p><strong>Tracking ID:</strong> ${meli_id}</p>
      <p><strong>Destinatario:</strong> ${destinatario}</p>
      <p><strong>Dirección:</strong> ${direccion} (${codigo_postal})</p>
      <div class="mt-2 flex gap-2">
        <button class="btn-save px-3 py-1 bg-blue-600 text-white rounded">Guardar</button>
        <span class="text-sm text-gray-500 save-status"></span>
      </div>
    `;
    list.appendChild(card);

    const btnSave = card.querySelector('.btn-save');
    const txt     = card.querySelector('.save-status');

    btnSave.addEventListener('click', async () => {
      btnSave.disabled = true;
      txt.textContent  = 'Guardando…';
      try {
        const endpoint = hashnumber ? '/escanear/meli' : '/escanear/manual';
        const payload  = { ...data };
        const res = await fetch(endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        txt.textContent = '✅ Guardado';
      } catch (err) {
        console.error('Error guardando envío:', err);
        txt.textContent = '❌ Error';
        btnSave.disabled = false;
      }
    });
  }
});

