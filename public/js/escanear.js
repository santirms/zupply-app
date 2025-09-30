// Zupply – Escanear (estilo Opción C)
// Cámara + modo teclado, overlay, beep/haptic, guardado en /api/scan-meli

const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has('debug');

let html5QrCode = null;
let scanning    = false;
let torchOn     = false;
let currentStream = null;
const seen = new Set();
let failCount = 0;

function dlog(...a){ if (DEBUG) console.log(...a); }

// ------- Overlay helpers -------
function ensureOverlay(readerEl){
  if (!readerEl) return;
  let overlay = readerEl.querySelector('.scan-overlay');
  if (!overlay){
    overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = `
      <div class="reticle"><div class="scanline"></div></div>
      <div class="hit-pulse" style="display:none"><div class="ring"></div></div>`;
    readerEl.appendChild(overlay);
  }
  function size(){
    const max = Math.min(readerEl.clientWidth||320, 520);
    const sz  = Math.round(Math.min(Math.max(max*0.7,240),420));
    readerEl.style.setProperty('--qrbox-size', `${sz}px`);
  }
  size(); window.addEventListener('resize', size);
}
function showHitPulse(readerEl){
  const p = readerEl.querySelector('.hit-pulse'); if(!p) return;
  p.style.display='grid';
  const r = p.querySelector('.ring');
  r.style.animation='none'; void r.offsetWidth; r.style.animation='';
  setTimeout(()=> p.style.display='none', 600);
}
function beep(freq=920, ms=120){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value=freq; osc.type='sine'; osc.connect(g); g.connect(ctx.destination);
    osc.start(); g.gain.setValueAtTime(0.001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+ms/1000);
    osc.stop(ctx.currentTime+ms/1000+0.02); setTimeout(()=>ctx.close(), ms+120);
  }catch{}
}
function haptic(){ try{ if(navigator.vibrate) navigator.vibrate([60]); }catch{} }

// ------- Payload & UI -------
function parseQrPayload(text){
  let raw; try{ raw=JSON.parse(text); }catch{ return null; }
  const meli_id   = raw.tracking_id || raw.id || raw.meli_id || null;
  const sender_id = (raw.sender_id ?? raw.senderId ?? '').toString() || null;
  const hash_code = raw.hash_code || raw.hashnumber || raw.hashNumber || raw.hash || null;
  const security_digit = raw.security_digit || raw.sec || null;
  const destinatario = raw.destinatario || raw.receiver || raw.receiver_name || null;
  const direccion = raw.direccion || [raw.street_name,raw.street_number].filter(Boolean).join(' ') || raw.address || null;
  const codigo_postal = raw.codigo_postal || raw.zip_code || raw.zip || null;
  return { raw, meli_id, sender_id, hash_code, security_digit, destinatario, direccion, codigo_postal };
}

function escapeHtml(s){ return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

function renderScanCard(payload, rawStr){
  const list = qs('#scanList');
  const card = document.createElement('div');
  card.className = 'rounded-2xl p-4 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5';
  card.dataset.rawText = rawStr || JSON.stringify(payload.raw);
  card.innerHTML = `
    <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
      <p><span class="opacity-60">Sender ID:</span> ${payload.sender_id ?? '(?)'}</p>
      <p><span class="opacity-60">Tracking ID:</span> <span class="font-medium">${payload.meli_id ?? '(?)'}</span></p>
      <p><span class="opacity-60">Hash:</span> ${payload.hash_code ?? '(?)'}</p>
      <p><span class="opacity-60">Seguridad:</span> ${payload.security_digit ?? '—'}</p>
      <p class="sm:col-span-2"><span class="opacity-60">Dirección:</span> ${[payload.destinatario, payload.direccion].filter(Boolean).join(' · ') || '—'}</p>
      <p class="sm:col-span-2 text-xs opacity-70 break-all">RAW: ${escapeHtml(JSON.stringify(payload.raw))}</p>
    </div>
    <div class="mt-3 flex items-center gap-2">
      <button class="btn-save px-3 py-2 rounded-xl font-medium shadow-sm bg-[var(--z-primary)] hover:bg-[var(--z-primary-dark)] text-[var(--z-primary-fg)]">Guardar</button>
      <button class="btn-view-qr px-3 py-2 rounded-xl border border-slate-300 dark:border-white/10" disabled>Ver QR</button>
      <span class="text-sm opacity-80 save-status"></span>
    </div>`;
  list.prepend(card);

  const btnSave = card.querySelector('.btn-save');
  const btnView = card.querySelector('.btn-view-qr');
  const txt     = card.querySelector('.save-status');

  btnSave.addEventListener('click', async ()=>{
    btnSave.disabled = true; txt.textContent = 'Guardando…';
    try{
      const res = await fetch('/api/scan-meli', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ raw_text: card.dataset.rawText })
      });
      const data = await res.json();
      if(!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      txt.textContent = data.created ? '✅ Envío creado + QR adjuntado' : '✅ QR adjuntado';
      if(data.qr_url){
        btnView.disabled = false;
        btnView.onclick = ()=> window.open(data.qr_url,'_blank');
      }
    }catch(e){
      console.error(e);
      txt.textContent = '❌ Error guardando';
      btnSave.disabled = false;
    }
  });
}

// ------- Cámara / Teclado -------
document.addEventListener('DOMContentLoaded', async ()=>{
  const camaraContainer  = qs('section:nth-of-type(2)'); // bloque con reader
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const selectCam        = qs('#selectCam');
  const torchBtn         = qs('#torchBtn');
  const reader           = qs('#reader');
  const statusEl         = qs('#status');
  const inputTeclado     = qs('#scannerInput');

  ensureOverlay(reader);

  // Modo
  modoRadios.forEach(r=>{
    r.addEventListener('change',()=>{
      const cam = r.value==='camara' && r.checked;
      camaraContainer.classList.toggle('hidden',!cam);
      tecladoContainer.classList.toggle('hidden',cam);
      if(!cam) inputTeclado?.focus();
      if(scanning) awaitStop();
      if(cam) statusEl.textContent='Listo. Alineá el código y mantené 15–25 cm.';
    });
  });

  // Input teclado
  inputTeclado?.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const code = inputTeclado.value.trim(); inputTeclado.value='';
    if(code) onScanSuccess(code, reader, statusEl);
  });

  // Popular cámaras
  await populateCameras();

  // Botones
  startBtn?.addEventListener('click', start);
  stopBtn ?.addEventListener('click', awaitStop);
  torchBtn?.addEventListener('click', toggleTorch);

  async function populateCameras(){
    selectCam.innerHTML = '';
    try{
      if(!window.Html5Qrcode) return;
      const cams = await Html5Qrcode.getCameras();
      cams.forEach(d=>{
        const opt = document.createElement('option');
        opt.value = d.id; opt.textContent = d.label || d.id;
        selectCam.appendChild(opt);
      });
      // Elegir trasera si existe
      const back = cams.find(d=>/back|environment|rear|trasera/i.test(d.label));
      if(back) selectCam.value = back.id;
    }catch(err){ console.warn('No se pudieron listar cámaras', err); }
  }

  function computeQrbox(viewW, viewH){
    const max = Math.min(viewW, 520);
    const sz  = Math.round(Math.min(Math.max(max*0.7,240),420));
    return { width: sz, height: sz };
  }

  async function start(){
    if(!window.Html5Qrcode){ alert('La cámara no está disponible. Usá el modo lector.'); return; }
    statusEl.textContent = 'Iniciando cámara…';
    try{
      html5QrCode = new Html5Qrcode(reader.id);
      const constraints = selectCam.value
        ? { deviceId:{ exact: selectCam.value } }
        : { facingMode: 'environment' };

      await html5QrCode.start(
        constraints,
        { fps: 12, qrbox: computeQrbox, aspectRatio: 1.777, experimentalFeatures:{ useBarCodeDetectorIfSupported: true } },
        t => onScanSuccess(t, reader, statusEl),
        () => onScanFail(statusEl)
      );

      // stream para torch
      currentStream = html5QrCode.getState() ? html5QrCode._qrRegion?.videoElement?.srcObject || null : null;

      scanning = true;
      startBtn.disabled = true; stopBtn.disabled = false;
      statusEl.textContent = 'Escaneando… Tip: que el QR ocupe ~70% del recuadro.';
      ensureOverlay(reader); // por si el <video> pisa el overlay en Android
    }catch(e){
      console.error('Error iniciando cámara:', e);
      statusEl.textContent = 'No se pudo iniciar la cámara. Revisá permisos del sitio.';
    }
  }

  async function awaitStop(){
    statusEl.textContent = 'Deteniendo…';
    try{ if(html5QrCode){ await html5QrCode.stop(); await html5QrCode.clear(); } }catch(e){ console.error(e); }
    scanning=false; startBtn.disabled=false; stopBtn.disabled=true;
    torchOn=false; currentStream=null; statusEl.textContent='Escáner detenido.';
  }

  async function toggleTorch(){
    if(!currentStream) return;
    // Intentar vía track constraints
    try{
      const track = currentStream.getVideoTracks()[0];
      const caps  = track.getCapabilities && track.getCapabilities();
      if(caps && caps.torch){
        torchOn = !torchOn;
        await track.applyConstraints({ advanced:[{ torch: torchOn }] });
        torchBtn.classList.toggle('bg-amber-500/20', torchOn);
        return;
      }
    }catch(e){ /* fallback abajo */ }

    alert('La linterna no es compatible en este dispositivo/navegador.');
  }
});

// ------- Callbacks de escaneo -------
function onScanSuccess(decodedText, readerEl, statusEl){
  if(seen.has(decodedText)) return;
  seen.add(decodedText);
  showHitPulse(readerEl); beep(940,120); haptic();
  statusEl.textContent='¡Código leído! Podés seguir escaneando.';

  const payload = parseQrPayload(decodedText);
  if(!payload){ console.warn('QR no es JSON válido'); return; }
  renderScanCard(payload, decodedText);
}

const TIPS = [
  'acercá hasta que ocupe ~70% del recuadro',
  'alejalo 5–10 cm si se ve borroso',
  'incliná 10–15° para evitar reflejos',
  'alisá la etiqueta: sin pliegues ni cinta brillante'
];
function onScanFail(statusEl){
  failCount++;
  if(failCount % 60 === 0){
    const tip = TIPS[(failCount/60) % TIPS.length | 0];
    statusEl.textContent = 'Tip: ' + tip + '.';
  }
}
