// public/js/escanear.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let html5QrCode = null;
let scanning    = false;
const seen      = new Set();

document.addEventListener('DOMContentLoaded', () => {
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const readerEl         = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');
  const list             = qs('#scanList');

  // html5-qrcode instance
  html5QrCode = new Html5Qrcode(readerEl.id);

  // Cambiar de modo
  modoRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked && r.value === 'camara') {
        camaraContainer.classList.remove('hidden');
        tecladoContainer.classList.add('hidden');
        if (scanning) stopScanner(); // para reiniciar si cambias
      }
      if (r.checked && r.value === 'teclado') {
        tecladoContainer.classList.remove('hidden');
        camaraContainer.classList.add('hidden');
        if (scanning) stopScanner();
        setTimeout(() => inputTeclado.focus(), 0);
      }
    });
  });

  // Controles cámara
  startBtn.addEventListener('click', startScanner);
  stopBtn .addEventListener('click', stopScanner);

  // Lector USB/teclado
  inputTeclado.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = inputTeclado.value.trim();
      inputTeclado.value = '';
      if (code) onScanSuccess(code);
    }
  });

  async function startScanner() {
    statusText.textContent = 'Iniciando cámara…';
    try {
      await html5QrCode.start(
        // iOS a veces necesita esto para usar la trasera
        { facingMode: { exact: "environment" } },
        {
          fps: 10,
          qrbox: (vw, vh) => {
            // caja proporcional centrada
            const size = Math.min( Math.floor(vw * 0.8), 320 );
            return { width: size, height: size };
          },
          aspectRatio: 1.777 // ayuda a centrar en móvil
        },
        (decodedText) => onScanSuccess(decodedText),
        (errMsg) => { /* onScanFailure opcional */ }
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
    try {
      await html5QrCode.stop();
    } catch (_) {}
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // --- PARSER + UI + GUARDADO ---
  async function onScanSuccess(decodedText) {
    // Evitar duplicados exactos
    if (seen.has(decodedText)) return;
    seen.add(decodedText);

    // 1) Parsear JSON (tu QR real viene así)
    let qr;
    try {
      qr = JSON.parse(decodedText);
    } catch {
      console.warn('QR no es JSON:', decodedText);
      return;
    }

    // 2) Mapeo tolerante → payload para backend
    const payload = {
      sender_id:      String(qr.sender_id ?? ''),
      meli_id:        String(qr.id ?? qr.tracking_id ?? ''),
      hashnumber:     String(qr.hash_code ?? qr.hashnumber ?? qr.hash ?? ''),
      security_digit: String(qr.security_digit ?? '')
    };

    if (!payload.sender_id || !payload.meli_id) {
      console.warn('Faltan sender_id o meli_id en QR:', qr);
      return;
    }

    // 3) Tarjeta visual
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg shadow flex flex-col gap-2';
    card.innerHTML = `
      <p><strong>Sender ID:</strong> ${payload.sender_id}</p>
      <p><strong>Tracking ID:</strong> ${payload.meli_id}</p>
      <p><strong>Hash:</strong> ${payload.hashnumber || '(sin hash)'}</p>
      <p class="text-xs text-gray-500 break-all"><strong>RAW:</strong> ${decodedText}</p>
      <div class="mt-2 flex gap-2 items-center">
        <button class="btn-save px-3 py-1 bg-blue-600 text-white rounded">Guardar</button>
        <span class="text-sm text-gray-500 save-status"></span>
      </div>
    `;
    list.prepend(card);

    // 4) Guardar → /escanear/meli
    const btnSave = card.querySelector('.btn-save');
    const txt     = card.querySelector('.save-status');

    btnSave.addEventListener('click', async () => {
      btnSave.disabled = true;
      txt.textContent  = 'Guardando…';
      try {
        const res = await fetch('/escanear/meli', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json().catch(() => ({}));
        txt.textContent = '✅ Guardado';
        // si querés, mostrar partido/zona de la respuesta
        if (j?.zona || j?.partido) {
          txt.textContent += ` (${j.partido||''} ${j.zona?'- '+j.zona:''})`;
        }
      } catch (err) {
        console.error('Error guardando envío:', err);
        txt.textContent = '❌ Error';
        btnSave.disabled = false;
      }
    });
  }

  // --- Panel de debug opcional (?debug=1) ---
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('debug') === '1') {
      const dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;max-height:40vh;overflow:auto;background:#111;color:#0f0;font:12px monospace;padding:8px;border-radius:8px;z-index:99999';
      dbg.innerHTML = '<div style="color:#fff;margin-bottom:6px">DEBUG</div><div id="dbgLog"></div>';
      document.body.appendChild(dbg);
      const logEl = dbg.querySelector('#dbgLog');
      const _log = console.log;
      console.log = (...a) => { _log(...a); logEl.innerText += a.map(x => typeof x==='string'?x:JSON.stringify(x)).join(' ') + '\n'; };
      const _err = console.error;
      console.error = (...a) => { _err(...a); logEl.innerText += '[ERR] ' + a.map(x => typeof x==='string'?x:JSON.stringify(x)).join(' ') + '\n'; };
      console.log('debug panel listo');
    }
  } catch {}
});
