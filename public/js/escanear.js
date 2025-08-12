// public/js/escanear.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let html5QrCode, scanning = false;
const seen = new Set();

document.addEventListener('DOMContentLoaded', () => {
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const reader           = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');
  const list             = qs('#scanList');

  html5QrCode = new Html5Qrcode(reader.id);

  // --- helpers de parseo ---
  function parseQR(text) {
    // 1) JSON puro
    try {
      const o = JSON.parse(text);
      if (o && (o.sender_id || o.tracking_id || o.hashnumber)) return o;
    } catch {}

    // 2) URL con querystring
    try {
      if (/^https?:\/\//i.test(text)) {
        const u = new URL(text);
        const p = u.searchParams;
        return {
          sender_id:   p.get('sender_id')   || p.get('user_id') || p.get('sid') || undefined,
          tracking_id: p.get('tracking_id') || p.get('tid')     || p.get('shipment_id') || undefined,
          hashnumber:  p.get('hashnumber')  || p.get('hash')    || undefined
        };
      }
    } catch {}

    // 3) querystring plano: a=1&b=2
    if (text.includes('=') && text.includes('&')) {
      const params = {};
      text.split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        if (k) params[k.trim()] = decodeURIComponent((v||'').trim());
      });
      if (params.sender_id || params.tracking_id || params.hashnumber) {
        return {
          sender_id:   params.sender_id || params.user_id || params.sid,
          tracking_id: params.tracking_id || params.tid || params.shipment_id,
          hashnumber:  params.hashnumber || params.hash
        };
      }
    }

    // 4) texto con "sender_id: 123 ..." etc.
    const grab = (lbls) => {
      const r = new RegExp(`(?:${lbls.join('|')})\\s*[:=]\\s*([A-Za-z0-9_\\-]+)`, 'i');
      const m = text.match(r);
      return m ? m[1] : undefined;
    };
    const maybe = {
      sender_id:   grab(['sender_id','user_id','sid']),
      tracking_id: grab(['tracking_id','tid','shipment_id']),
      hashnumber:  grab(['hashnumber','hash'])
    };
    if (maybe.sender_id || maybe.tracking_id || maybe.hashnumber) return maybe;

    // 5) base64 → JSON
    try {
      const decoded = atob(text);
      const o = JSON.parse(decoded);
      if (o && (o.sender_id || o.tracking_id || o.hashnumber)) return o;
    } catch {}

    return {}; // no se pudo
  }

  function qrBoxFn(w, h) {
    const side = Math.floor(Math.min(w, h) * 0.80);
    return { width: side, height: side };
  }

  // --- modos ---
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
      if (scanning) stopScanner();
    });
  });

  startBtn.addEventListener('click', startScanner);
  stopBtn.addEventListener('click', stopScanner);

  inputTeclado.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = inputTeclado.value.trim();
      inputTeclado.value = '';
      if (code) onScanSuccess(code);
    }
  });

  // --- cámara ---
  async function startScanner() {
    statusText.textContent = 'Iniciando cámara…';
    try {
      await html5QrCode.start(
        { facingMode: { exact: 'environment' } },
        { fps: 10, qrbox: qrBoxFn, aspectRatio: 1.333 },
        (decodedText) => onScanSuccess(decodedText)
      );
      // iOS: asegurar playsinline/autoplay/muted
      setTimeout(() => {
        const v = reader.querySelector('video');
        if (v) {
          v.setAttribute('playsinline', 'true');
          v.setAttribute('autoplay', 'true');
          v.muted = true;
          v.style.objectFit = 'cover';
        }
      }, 250);

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
    try { await html5QrCode.stop(); await html5QrCode.clear(); } catch {}
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // --- post-scan ---
  async function onScanSuccess(decodedText) {
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    const data = parseQR(decodedText);
    const sender_id   = data.sender_id   || '';
    const tracking_id = data.tracking_id || '';
    const hashnumber  = data.hashnumber  || '';

    // Tarjeta en UI
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg shadow flex flex-col gap-2';
    card.innerHTML = `
      <p><strong>Sender ID:</strong> ${sender_id || '(?)'}</p>
      <p><strong>Tracking ID:</strong> ${tracking_id || '(?)'}</p>
      <p><strong>Hash:</strong> ${hashnumber || '(?)'}</p>
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
        // si hay tracking_id, pedimos al back que complete con MeLi
        const endpoint = tracking_id ? '/escanear/meli' : '/escanear/manual';
        const payload  = tracking_id
          ? { meli_id: tracking_id, sender_id, hashnumber }
          : { sender_id, tracking_id, hashnumber };

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
