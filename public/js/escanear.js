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

  html5QrCode = new Html5Qrcode(reader.id, { verbose: false });

  // Cambiar modo
  modoRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'camara') {
        camaraContainer.classList.remove('hidden');
        tecladoContainer.classList.add('hidden');
      } else {
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

  function qrBoxFn(w, h) {
    // En móvil vertical: cuadro más alto y casi todo el ancho
    const isPortrait = h > w;
    if (isPortrait) {
      const width  = Math.floor(w * 0.92);
      const height = Math.floor(h * 0.55);
      return { width, height };
    } else {
      const side = Math.floor(Math.min(w, h) * 0.8);
      return { width: side, height: side };
    }
  }

  async function startScanner() {
    statusText.textContent = 'Iniciando cámara…';
    try {
      const constraints = {
        facingMode: { ideal: 'environment' },
        aspectRatio: 4/3,              // iOS se lleva bien con 4:3
        focusMode: 'continuous'        // hint
      };
      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: qrBoxFn,
          videoConstraints: constraints,
          rememberLastUsedCamera: true
        },
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
    try { await html5QrCode.stop(); }
    catch {}
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // ---- Parser robusto del QR ----
  function parseQR(decodedText) {
  // 0) Intento: si parece base64, decodifico y reintento
  const looksB64 = /^[A-Za-z0-9+/=]+$/.test(decodedText) && decodedText.length % 4 === 0;
  if (looksB64) {
    try {
      const dec = atob(decodedText);
      const parsed = parseQR(dec);
      if (parsed && (parsed.sender_id || parsed.meli_id || parsed.hashnumber)) return parsed;
    } catch {}
  }

  // 1) JSON
  try {
    const obj = JSON.parse(decodedText);
    return {
      sender_id:     obj.sender_id || obj.sid || obj.si,
      meli_id:       obj.tracking_id || obj.tid || obj.ti || obj.meli_id,
      hashnumber:    obj.hashnumber || obj.hash || obj.hn,
      destinatario:  obj.destinatario || obj.recipient,
      direccion:     obj.direccion || obj.address,
      codigo_postal: obj.codigo_postal || obj.cp || obj.zip
    };
  } catch {}

  // 2) URL
  try {
    const url = new URL(decodedText);
    const p = url.searchParams;
    return {
      sender_id:     p.get('sender_id') || p.get('sid') || p.get('si'),
      meli_id:       p.get('tracking_id') || p.get('tid') || p.get('ti') || p.get('meli_id'),
      hashnumber:    p.get('hashnumber') || p.get('hash') || p.get('hn'),
      destinatario:  p.get('destinatario') || p.get('recipient'),
      direccion:     p.get('direccion') || p.get('address'),
      codigo_postal: p.get('codigo_postal') || p.get('cp') || p.get('zip')
    };
  } catch {}

  // 3) Pares k=v con separadores
  const dict = {};
  decodedText.split(/[\n\r&;,\s]+/).forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) dict[k.trim().toLowerCase()] = decodeURIComponent(v.trim());
    const [k2, v2] = pair.split(':');
    if (k2 && v2) dict[k2.trim().toLowerCase()] = v2.trim();
  });
  if (Object.keys(dict).length) {
    return {
      sender_id:     dict.sender_id || dict.sid || dict.si,
      meli_id:       dict.tracking_id || dict.tid || dict.ti || dict.meli_id,
      hashnumber:    dict.hashnumber || dict.hash || dict.hn,
      destinatario:  dict.destinatario || dict.recipient,
      direccion:     dict.direccion || dict.address,
      codigo_postal: dict.codigo_postal || dict.cp || dict.zip
    };
  }

  // 4) Regexs de respaldo
  // - sender_id numérico de 6 a 12 dígitos
  const sender = decodedText.match(/\b\d{6,12}\b/);
  // - tracking: TN/TG/ML + guiones/letras/números
  const track  = decodedText.match(/\b(?:TN|TG|ML|T)[-_A-Z0-9]{6,}\b/i);
  // - hash (hex largo)
  const hash   = decodedText.match(/\b[0-9a-f]{16,}\b/i);
  return {
    sender_id: sender?.[0],
    meli_id:   track?.[0],
    hashnumber: hash?.[0]
  };
}

  // ---- Al leer un QR ----
  async function onScanSuccess(decodedText) {
    console.log('QR raw:', decodedText);
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    const parsed = parseQR(decodedText);
    const {
      sender_id='(?)',
      meli_id='(?)',
      hashnumber='',
      destinatario='(?)',
      direccion='(?)',
      codigo_postal='(?)'
    } = parsed;

    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg shadow flex flex-col gap-2';
    card.innerHTML = `
      <p><strong>Sender ID:</strong> ${sender_id}</p>
      <p><strong>Tracking ID:</strong> ${meli_id}</p>
      <p><strong>Destinatario:</strong> ${destinatario}</p>
      <p><strong>Dirección:</strong> ${direccion} (${codigo_postal})</p>
      <div class="mt-2 flex gap-2 items-center">
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

      // armamos payload
      const payload = {
        sender_id,
        tracking_id: meli_id,
        hashnumber,
        destinatario,
        direccion,
        codigo_postal
      };

      const endpoint = (meli_id && meli_id !== '(?)') || hashnumber
        ? '/escanear/meli'
        : '/escanear/manual';

      // fetch con timeout para no quedar colgado
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);

      try {
        const res = await fetch(endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(await res.text());
        txt.textContent = '✅ Guardado';
      } catch (err) {
        clearTimeout(t);
        console.error('Error guardando envío:', err);
        txt.textContent = '❌ Error';
        btnSave.disabled = false;
      }
    });
  }
});
