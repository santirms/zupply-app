// public/js/escanear.js
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let html5QrCode = null;
let scanning    = false;
const seen      = new Set();

document.addEventListener('DOMContentLoaded', () => {
  console.log('escanear.js cargado');

  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const readerEl         = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');
  const list             = qs('#scanList');

  const hasHtml5 = typeof window.Html5Qrcode !== 'undefined';
  console.log('Html5Qrcode disponible:', hasHtml5);

  // SI hay lib, instancio; si no, dejo deshabilitada la cámara
  if (hasHtml5) {
    html5QrCode = new Html5Qrcode(readerEl.id);
  } else {
    camaraContainer.classList.add('hidden');
    tecladoContainer.classList.remove('hidden');
    startBtn?.setAttribute('disabled', 'true');
    stopBtn?.setAttribute('disabled', 'true');
    statusText.textContent = 'Modo cámara no disponible (lib no cargada). Usá lector USB.';
  }

  // Cambiar de modo siempre funciona (aunque no haya lib)
  modoRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked && r.value === 'camara') {
        if (!hasHtml5) {
          alert('La cámara no está disponible. Usá el modo lector.');
          // volvemos a teclado
          qsa('input[name="modoScan"]').find(x=>x.value==='teclado').checked = true;
          tecladoContainer.classList.remove('hidden');
          camaraContainer.classList.add('hidden');
          return;
        }
        camaraContainer.classList.remove('hidden');
        tecladoContainer.classList.add('hidden');
        if (scanning) stopScanner();
      }
      if (r.checked && r.value === 'teclado') {
        tecladoContainer.classList.remove('hidden');
        camaraContainer.classList.add('hidden');
        if (scanning) stopScanner();
        setTimeout(()=>inputTeclado.focus(), 0);
      }
    });
  });

  // Controles cámara (solo si hay lib)
  startBtn?.addEventListener('click', () => hasHtml5 ? startScanner() : alert('Cámara no disponible.'));
  stopBtn ?.addEventListener('click', () => hasHtml5 ? stopScanner()  : null);

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
        { facingMode: { exact: "environment" } },
        {
          fps: 10,
          qrbox: (vw, vh) => {
            const size = Math.min(Math.floor(vw * 0.8), 320);
            return { width: size, height: size };
          },
          aspectRatio: 1.777
        },
        (decodedText) => onScanSuccess(decodedText),
        () => {} // onFailure opcional
      );
      scanning = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;
      statusText.textContent = 'Escáner activo. Apuntá al código.';
    } catch (e) {
      console.error('Error iniciando cámara:', e);
      statusText.textContent = 'No se pudo iniciar cámara.';
    }
  }

  async function stopScanner() {
    if (!scanning) return;
    try { await html5QrCode.stop(); } catch {}
    scanning = false;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    statusText.textContent = 'Escáner detenido.';
  }

  // ---- PARSER + UI + GUARDADO ----
  async function onScanSuccess(decodedText) {
    if (seen.has(decodedText)) return;
    seen.add(decodedText);
    console.log('QR raw:', decodedText);

    // 1) Parsear JSON (tu QR viene así)
    let qr;
    try { qr = JSON.parse(decodedText); }
    catch { console.warn('QR no es JSON'); return; }

    // 2) Map a payload interno
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

    // 3) Tarjeta
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

    const btnSave = card.querySelector('.btn-save');
    const txt     = card.querySelector('.save-status');

btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  txt.textContent  = 'Guardando…';
  try {
    const endpoint = hashnumber ? '/escanear/meli' : '/escanear/manual';
    const payload  = { ...data };

    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || JSON.stringify(json) || res.statusText);

    txt.textContent = '✅ Guardado';
  } catch (err) {
    console.error('Error guardando envío:', err);
    txt.textContent = '❌ Error';
    // si estás en debug, lo ves clarito
  } finally {
    btnSave.disabled = false;
  }
});
  }
});
