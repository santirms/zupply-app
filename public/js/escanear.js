// public/js/escanear.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has('debug');

let html5QrCode, scanning = false;
const seen = new Set();

function dlog(...a){ if (DEBUG) console.log(...a); }

// --- Helpers --------------------------------------------------------------

// Normaliza las claves que pueden venir distintas en QR
function parseQrPayload(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }

  const meli_id   = raw.tracking_id || raw.id || raw.meli_id || null;
  const sender_id = (raw.sender_id ?? raw.senderId ?? '').toString() || null;
  const hash_code = raw.hash_code || raw.hashnumber || raw.hashNumber || raw.hash || null;
  const security_digit = raw.security_digit || raw.sec || null;

  // opcionales por si en algún QR vienen
  const destinatario = raw.destinatario || raw.receiver || raw.receiver_name || null;
  const direccion = raw.direccion
    || [raw.street_name, raw.street_number].filter(Boolean).join(' ')
    || raw.address
    || null;
  const codigo_postal = raw.codigo_postal || raw.zip_code || raw.zip || null;

  return {
    raw,
    meli_id,
    sender_id,
    hash_code,
    security_digit,
    destinatario,
    direccion,
    codigo_postal
  };
}

// Render de una “tarjeta” y botón Guardar
function renderScanCard(payload) {
  const list = qs('#scanList');

  const card = document.createElement('div');
  card.className = 'bg-white p-4 rounded-lg shadow flex flex-col gap-2';
  card.innerHTML = `
    <p><strong>Sender ID:</strong> ${payload.sender_id ?? '(?)'}</p>
    <p><strong>Tracking ID:</strong> ${payload.meli_id ?? '(?)'}</p>
    <p><strong>Hash:</strong> ${payload.hash_code ?? '(?)'}</p>
    <p class="text-xs text-gray-500 break-all">RAW: ${escapeHtml(JSON.stringify(payload.raw))}</p>
    <div class="mt-2 flex gap-2 items-center">
      <button class="btn-save px-3 py-1 bg-blue-600 text-white rounded">Guardar</button>
      <span class="text-sm text-gray-500 save-status"></span>
    </div>
  `;
  list.prepend(card);

  const btnSave = card.querySelector('.btn-save');
  const txt     = card.querySelector('.save-status');

  btnSave.addEventListener('click', async () => {
    btnSave.disabled = true;
    txt.textContent  = 'Guardando…';
    try {
      // si hay meli_id y (opcional) hash_code -> vamos por integración MeLi
      const usarMeli = !!payload.meli_id && !!payload.sender_id;
      const endpoint = usarMeli ? '/escanear/meli' : '/escanear/manual';

      // armamos body mínimo requerido por tus endpoints
      const body = usarMeli
        ? { meli_id: payload.meli_id, sender_id: payload.sender_id }
        : {
            sender_id:     payload.sender_id,
            tracking_id:   payload.meli_id,
            codigo_postal: payload.codigo_postal,
            destinatario:  payload.destinatario,
            direccion:     payload.direccion
          };

      dlog('[guardar] POST', endpoint, body);
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json()).error || ''; } catch {}
        throw new Error(msg || `HTTP ${res.status}`);
      }

      txt.textContent = '✅ Guardado';
    } catch (err) {
      console.error('Error guardando envío:', err);
      txt.textContent = '❌ Error';
      btnSave.disabled = false;
    }
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])
  );
}

// -------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const reader           = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');

  // Carga html5-qrcode si existe el script ya incluido
  if (window.Html5Qrcode) {
    html5QrCode = new Html5Qrcode(reader.id);
    dlog('html5-qrcode OK');
  } else {
    dlog('html5-qrcode no disponible (modo teclado/copia)');
  }

  // Cambio de modo
  modoRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const cam = radio.value === 'camara' && radio.checked;
      camaraContainer.classList.toggle('hidden', !cam);
      tecladoContainer.classList.toggle('hidden', cam);
      if (!cam) inputTeclado.focus();
      if (scanning) stopScanner();
    });
  });

  // Controles cámara
  startBtn?.addEventListener('click', startScanner);
  stopBtn?.addEventListener('click', stopScanner);

  // Lector/pegar texto: Enter dispara parse
  inputTeclado?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = inputTeclado.value.trim();
      inputTeclado.value = '';
      if (code) onScanSuccess(code);
    }
  });

  async function startScanner() {
    if (!html5QrCode) {
      alert('La cámara no está disponible. Usá el modo lector.');
      return;
    }
    statusText.textContent = 'Iniciando cámara…';
    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
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
    if (!scanning || !html5QrCode) return;
    await html5QrCode.stop();
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // Procesamiento central
  function onScanSuccess(decodedText) {
    dlog('QR raw:', decodedText);
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    const payload = parseQrPayload(decodedText);
    if (!payload) {
      console.warn('QR no es JSON válido');
      return;
    }
    renderScanCard(payload);
  }
});
