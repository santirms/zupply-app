// public/js/escanear.js  (tu versión + overlay / beep / pulse / tips)
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has('debug');

let html5QrCode, scanning = false;
const seen = new Set();
let failCount = 0;

function dlog(...a){ if (DEBUG) console.log(...a); }

// ---------- Overlay (mira + línea + pulso) ----------
function ensureOverlayStyles() {
  if (document.getElementById('scan-overlay-styles')) return;
  const css = `
  #reader { position: relative; }
  .scan-overlay { --qrbox-size: 320px; position:absolute; inset:0; pointer-events:none; display:grid; place-items:center; }
  .reticle { width:var(--qrbox-size); height:var(--qrbox-size); border:2px solid rgba(255,255,255,.7); border-radius:16px; box-shadow:0 0 0 100vmax rgba(0,0,0,.35); position:relative; overflow:hidden; }
  .reticle:before,.reticle:after{content:"";position:absolute;inset:0;border-radius:16px;border:2px solid rgba(0,255,128,.25);
    clip-path: polygon(0 0, 14% 0, 14% 2px, 2px 2px, 2px 14%, 0 14%, 0 0,
                       86% 0, 100% 0, 100% 14%, 98% 14%, 98% 2px, 86% 2px, 86% 0,
                       100% 86%, 100% 100%, 86% 100%, 86% 98%, 98% 98%, 98% 86%, 100% 86%,
                       0 86%, 0 100%, 14% 100%, 14% 98%, 2px 98%, 2px 86%, 0 86%); }
  .scanline{position:absolute;left:0;right:0;height:2px;top:0;background:linear-gradient(to right,transparent,rgba(0,255,128,.9),transparent);animation:scan 2.4s linear infinite;}
  @keyframes scan{0%{transform:translateY(8px);opacity:.9;}50%{transform:translateY(calc(var(--qrbox-size) - 10px));opacity:.6;}100%{transform:translateY(8px);opacity:.9;}}
  .hit-pulse{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;}
  .hit-pulse .ring{width:32px;height:32px;border:3px solid #22c55e;border-radius:999px;opacity:0;transform:scale(.2);animation:pulse .6s ease-out forwards;box-shadow:0 0 16px rgba(34,197,94,.6);}
  @keyframes pulse{to{opacity:0;transform:scale(8);}}`;
  const style = document.createElement('style');
  style.id = 'scan-overlay-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureOverlay(readerEl) {
  if (!readerEl || readerEl.querySelector('.scan-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="reticle"><div class="scanline"></div></div>
    <div class="hit-pulse" style="display:none"><div class="ring"></div></div>
  `;
  readerEl.appendChild(overlay);
  // Tamaño coherente con qrbox dinámico
  function updateQrboxSize(){
    const max = Math.min(readerEl.clientWidth || 320, 520);
    const size = Math.round(Math.min(Math.max(max * 0.7, 240), 420));
    readerEl.style.setProperty('--qrbox-size', `${size}px`);
  }
  updateQrboxSize();
  window.addEventListener('resize', updateQrboxSize);
}

function showHitPulse(readerEl){
  const pulse = readerEl.querySelector('.hit-pulse');
  if (!pulse) return;
  pulse.style.display = 'grid';
  const ring = pulse.querySelector('.ring');
  ring.style.animation = 'none'; void ring.offsetWidth; ring.style.animation = ''; // restart
  setTimeout(() => (pulse.style.display = 'none'), 600);
}

function beep(freq = 920, ms = 120) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms/1000);
    osc.stop(ctx.currentTime + ms/1000 + 0.02);
    setTimeout(() => ctx.close(), ms + 100);
  } catch {}
}

// ---------- Tu parsing/render original ----------
function parseQrPayload(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }

  const meli_id   = raw.tracking_id || raw.id || raw.meli_id || null;
  const sender_id = (raw.sender_id ?? raw.senderId ?? '').toString() || null;
  const hash_code = raw.hash_code || raw.hashnumber || raw.hashNumber || raw.hash || null;
  const security_digit = raw.security_digit || raw.sec || null;

  const destinatario = raw.destinatario || raw.receiver || raw.receiver_name || null;
  const direccion = raw.direccion
    || [raw.street_name, raw.street_number].filter(Boolean).join(' ')
    || raw.address
    || null;
  const codigo_postal = raw.codigo_postal || raw.zip_code || raw.zip || null;

  return { raw, meli_id, sender_id, hash_code, security_digit, destinatario, direccion, codigo_postal };
}

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
      const usarMeli = !!payload.meli_id && !!payload.sender_id;
      const endpoint = usarMeli ? '/escanear/meli' : '/escanear/manual';
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

// ---------- Arranque ----------
document.addEventListener('DOMContentLoaded', async () => {
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const reader           = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');

  ensureOverlayStyles();
  ensureOverlay(reader);

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
      if (!cam) inputTeclado?.focus();
      if (scanning) stopScanner();
      if (cam) statusText.textContent = 'Listo. Alineá el código en el recuadro y mantené 15–25 cm.';
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
      if (code) onScanSuccess(code, reader, statusText);
    }
  });

  function computeQrbox(viewW, viewH) {
    const max = Math.min(viewW, 520);
    const size = Math.round(Math.min(Math.max(max * 0.7, 240), 420));
    return { width: size, height: size };
  }

  async function startScanner() {
    if (!html5QrCode) {
      alert('La cámara no está disponible. Usá el modo lector.');
      return;
    }
    statusText.textContent = 'Iniciando cámara…';
    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: computeQrbox,     // <- tamaño dinámico coherente con la mira
          aspectRatio: 1.777,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        },
        (decodedText) => onScanSuccess(decodedText, reader, statusText),
        () => onScanFail(statusText)
      );
      scanning = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;
      statusText.textContent = 'Escaneando… Tip: que el QR ocupe ~70% del recuadro.';
    } catch (e) {
      console.error('Error iniciando cámara:', e);
      statusText.textContent = 'No se pudo iniciar cámara.';
    }
  }

  async function stopScanner() {
    if (!scanning || !html5QrCode) return;
    statusText.textContent = 'Deteniendo…';
    try { await html5QrCode.stop(); await html5QrCode.clear(); }
    catch(e){ console.error(e); }
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }
});

// Procesamiento central + feedback visual/sonoro
function onScanSuccess(decodedText, readerEl, statusEl) {
  dlog('QR raw:', decodedText);
  if (seen.has(decodedText)) return;
  seen.add(decodedText);

  // Feedback
  showHitPulse(readerEl);
  beep(940, 120);
  if (navigator.vibrate) navigator.vibrate(80);
  statusEl.textContent = '¡Código leído! Podés seguir escaneando.';

  const payload = parseQrPayload(decodedText);
  if (!payload) {
    console.warn('QR no es JSON válido');
    return;
  }
  renderScanCard(payload);
}

function onScanFail(statusEl) {
  failCount++;
  if (failCount % 60 === 0) {
    const tip = (failCount/60) % 3;
    if (tip === 1) statusEl.textContent = 'Tip: acercá hasta ~70% del recuadro.';
    else if (tip === 2) statusEl.textContent = 'Tip: alejalo 5–10 cm si se ve borroso.';
    else statusEl.textContent = 'Tip: incliná 10–15° para evitar reflejos.';
  }
}
