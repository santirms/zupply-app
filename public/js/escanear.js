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
    // 1) JSON puro
    try {
      const obj = JSON.parse(decodedText);
      return {
        sender_id:     obj.sender_id || obj.sid || obj.si,
        meli_id:       obj.tracking_id || obj.tid || obj.ti,
        hashnumber:    obj.hashnumber || obj.hash || obj.hn,
        destinatario:  obj.destinatario || obj.recipient,
        direccion:     obj.direccion || obj.address,
        codigo_postal: obj.codigo_postal || obj.cp || obj.zip
      };
    } catch {}

    // 2) URL con querystring
    try {
      const url = new URL(decodedText);
      const p = url.searchParams;
      return {
        sender_id:     p.get('sender_id') || p.get('sid') || p.get('si'),
        meli_id:       p.get('tracking_id') || p.get('tid') || p.get('ti'),
        hashnumber:    p.get('hashnumber') || p.get('hash') || p.get('hn'),
        destinatario:  p.get('destinatario') || p.get('recipient'),
        direccion:     p.get('direccion') || p.get('address'),
        codigo_postal: p.get('codigo_postal') || p.get('cp') || p.get('zip')
      };
    } catch {}

    // 3) Pares k=v separados (& o ;)
    if (decodedText.includes('=')) {
      const params = {};
      decodedText.split(/[&;,\s]+/).forEach(part => {
        const [k, v] = part.split('=');
        if (k && v) params[k.trim()] = decodeURIComponent(v.trim());
      });
      return {
        sender_id:     params.sender_id || params.sid || params.si,
        meli_id:       params.tracking_id || params.tid || params.ti,
        hashnumber:    params.hashnumber || params.hash || params.hn,
        destinatario:  params.destinatario || params.recipient,
        direccion:     params.direccion || params.address,
        codigo_postal: params.codigo_postal || params.cp || params.zip
      };
    }

    // 4) Respaldo por regex (último recurso)
    const senderMatch = decodedText.match(/\b\d{6,12}\b/);     // ID numérico
    const trackMatch  = decodedText.match(/\b(TN|TG|T|ML)\S{6,}\b/i);
    return {
      sender_id: senderMatch?.[0],
      meli_id:   trackMatch?.[0]
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
