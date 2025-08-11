// public/js/escanear.js
// Requiere html5-qrcode ya cargado en el HTML

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

let BASE = ''; // '' local, '/api' en Render

async function detectBase() {
  const tries = ['', '/api'];
  for (const pre of tries) {
    try {
      const r = await fetch(`${pre}/clientes`, { method: 'GET' });
      if (r.ok) { BASE = pre; return; }
    } catch {}
  }
}

const api = p => `${BASE}${p}`;

// ---------------- parseo tolerante de QR ----------------
function parseQR(raw) {
  if (!raw) return {};
  let txt = String(raw).trim();

  // 1) ¿JSON?
  try {
    const j = JSON.parse(txt);
    return normalizeKeys(j);
  } catch {}

  // 2) ¿URL con query?
  try {
    const u = new URL(txt);
    const params = Object.fromEntries(u.searchParams.entries());
    return normalizeKeys(params);
  } catch {}

  // 3) ¿query plano "a=1&b=2"?
  if (txt.includes('=') && txt.includes('&')) {
    const params = {};
    txt.split('&').forEach(p => {
      const [k,v] = p.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v||'');
    });
    return normalizeKeys(params);
  }

  // 4) heurística: números “grandes” en el texto
  const nums = (txt.match(/\d{6,}/g) || []);
  const guess = {};
  if (nums.length) {
    // primer número grande: probable tracking
    guess.tracking_id = nums[0];
    // segundo: probable sender
    if (nums[1]) guess.sender_id = nums[1];
  }
  return guess;
}

// mapea alias comunes a las claves estándar
function normalizeKeys(obj) {
  if (!obj) return {};
  const o = {};
  const get = (...keys) => {
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== '') return String(obj[k]);
      // prueba case-insensitive
      const hit = Object.keys(obj).find(x => x.toLowerCase() === k.toLowerCase());
      if (hit && obj[hit] != null && obj[hit] !== '') return String(obj[hit]);
    }
    return undefined;
  };

  o.sender_id   = get('sender_id','seller_id','user_id','si','sid');
  o.tracking_id = get('tracking_id','tid','ti','shipment_id','id','trackingId');

  // a veces vienen útiles para mostrar
  o.hash        = get('h','hash','token');

  return o;
}

// ---------------- cámara / lector ----------------
let html5QrCode = null;
let cameraRunning = false;

const debug = msg => {
  const d = document.getElementById('debug');
  if (d) d.textContent = msg;
  console.log('[DEBUG]', msg);
};

async function startCamera() {
  try {
    if (!window.Html5Qrcode) {
      debug('html5-qrcode no cargó');
      return;
    }
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('reader', { verbose: false });
    } else {
      try { await html5QrCode.stop(); } catch {}
      try { await html5QrCode.clear(); } catch {}
    }

    // Lista de cámaras y elegimos la trasera si existe
    const devices = await Html5Qrcode.getCameras();
    if (!devices.length) {
      debug('No hay cámaras disponibles');
      return;
    }
    const back = devices.find(d => /back|rear|trasera/i.test(d.label)) || devices[0];
    debug('Usando cámara: ' + (back.label || back.id));

    const config = {
      fps: 10,
      qrbox: 240,
      // Estas 2 ayudan mucho en iPhone:
      rememberLastUsedCamera: true,
      videoConstraints: {
        deviceId: { exact: back.id },
        // Safari ignora varias cosas, pero no molesta:
        focusMode: 'continuous',
        aspectRatio: 1.777
      }
    };

    await html5QrCode.start(
      { deviceId: { exact: back.id } },
      config,
      onScanSuccess,
      // podemos ignorar onScanFailure para no spamear logs
    );

    // iOS: asegurar propiedades del <video> interno
    setTimeout(() => {
      const video = document.querySelector('#reader video');
      if (video) {
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.muted = true;
        video.style.objectFit = 'cover';
      }
    }, 200);

    cameraRunning = true;
    debug('Cámara iniciada');
  } catch (err) {
    debug(`Error al iniciar cámara: ${err.name} — ${err.message}`);
  }
}

async function stopCamera() {
  if (!html5QrCode || !cameraRunning) return;
  try { await html5QrCode.stop(); } catch {}
  try { await html5QrCode.clear(); } catch {}
  cameraRunning = false;
  debug('Cámara detenida');
}

function onScanSuccess(decodedText) {
  debug('QR leído');
  // TODO: tu lógica para parsear el QR y guardar
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
}

// Preflight para que iOS pida permiso ANTES del start
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
    debug('Permiso de cámara OK');
  } catch (e) {
    debug(`getUserMedia: ${e.name} — ${e.message}`);
  }
  // engancha botones
  document.getElementById('btnStart').onclick  = startCamera;
  document.getElementById('btnStop').onclick   = stopCamera;
});


// ---------------- UI ----------------
function addCard(info) {
  const wrap = $('#scanList');
  const li = document.createElement('div');
  li.className = 'tarjeta-etiqueta';
  li.innerHTML = `
    <p><strong>Sender ID:</strong> ${info.sender_id || '-'}</p>
    <p><strong>Tracking ID:</strong> ${info.tracking_id || '-'}</p>
    <p><strong>Destinatario:</strong> <span class="dest">-</span></p>
    <p><strong>Dirección:</strong> <span class="addr">-</span></p>
    <p><strong>Partido:</strong> <span class="partido">-</span></p>
    <button class="btn-guardar">Guardar</button>
    <span class="hint" style="margin-left:8px;color:#666"></span>
    <hr/>
  `;
  wrap.appendChild(li);
  return li;
}

// ---------------- integración backend ----------------
async function guardarDesdeMeli(info, card) {
  const btn  = card.querySelector('.btn-guardar');
  const hint = card.querySelector('.hint');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  hint.textContent = '';

  try {
    const res = await fetch(api('/escanear/meli'), {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        meli_id:   info.tracking_id,
        sender_id: info.sender_id
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // backend debería devolver datos del envío o mensaje
    // si tu /escanear/meli ya responde con { zona, datos_envio }, usamos eso
    const dest = data?.datos_envio?.receiver_address?.receiver_name || data?.destinatario || '-';
    const dir  = (() => {
      const ra = data?.datos_envio?.receiver_address;
      if (ra?.address_line) return ra.address_line;
      const a = [ra?.street_name, ra?.street_number].filter(Boolean).join(' ');
      return a || data?.direccion || '-';
    })();
    const partido = data?.zona || data?.partido || '-';

    card.querySelector('.dest').textContent = dest;
    card.querySelector('.addr').textContent = dir;
    card.querySelector('.partido').textContent = partido;

    btn.textContent = 'Guardado';
    hint.textContent = '✓';
    setStatus('Envío guardado desde MeLi.', true);
  } catch (e) {
    console.error('Error guardando envío:', e);
    btn.textContent = 'Guardar';
    btn.disabled = false;
    hint.textContent = 'Error';
    setStatus('Error: ' + e.message, false);
  }
}

// ---------------- handler de lectura ----------------
async function onScanSuccess(decodedText) {
  const info = parseQR(decodedText);

  // si no tenemos tracking_id o sender_id, probamos heurística extra:
  if (!info.tracking_id || !info.sender_id) {
    console.warn('QR parcial:', decodedText, info);
  }

  // Evita duplicados por (sender_id + tracking_id) o por texto crudo
  const key = `${info.sender_id || ''}|${info.tracking_id || decodedText}`;
  if (scanned.has(key)) return;
  scanned.add(key);

  const card = addCard(info);

  // botón "Guardar"
  card.querySelector('.btn-guardar').addEventListener('click', () => {
    if (!info.tracking_id || !info.sender_id) {
      setStatus('QR sin tracking_id o sender_id reconocibles.', false);
      return;
    }
    guardarDesdeMeli(info, card);
  });

  // opcional: auto-guardar apenas escanea si ves que parseó bien
  if (info.tracking_id && info.sender_id) {
    guardarDesdeMeli(info, card);
  }
}

// ---------------- init ----------------
document.addEventListener('DOMContentLoaded', async () => {
  await detectBase();

  // radio: cámara vs lector USB
  const rCam = $('#mCam');
  const rUsb = $('#mUsb');
  rCam?.addEventListener('change', () => {
    $('#cameraControls').classList.toggle('hidden', !rCam.checked);
    if (rCam.checked) setStatus('Modo cámara'); else setStatus('');
  });
  rUsb?.addEventListener('change', () => {
    $('#cameraControls').classList.toggle('hidden', rUsb.checked);
    setStatus(rUsb.checked ? 'Modo lector USB/teclado' : '');
  });

  $('#btnStart')?.addEventListener('click', startCamera);
  $('#btnStop')?.addEventListener('click', stopCamera);
});

function showDebug(msg) {
  const d = document.getElementById('debug');
  if (d) d.textContent = msg;
  console.log('[DEBUG]', msg);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Html5Qrcode === 'undefined') {
    showDebug('html5-qrcode no se cargó');
    return;
  }
  // Test permisos de cámara
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
    showDebug('Permiso de cámara OK');
  } catch (err) {
    showDebug(`getUserMedia error: ${err.name} — ${err.message}`);
    // opcional: alert para verlo en iPhone rápido
    // alert(`getUserMedia error: ${err.name}\n${err.message}`);
  }
});
