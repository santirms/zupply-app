// Zupply • Escáner (UI y lógica)
// - Overlay con retícula, línea y pulso
// - Beep + vibración
// - Soporta cámara o lector/teclado
// - Envia el QR crudo a /api/scan-meli (igual que antes)

const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));
const DEBUG = new URLSearchParams(location.search).has('debug');

let html5QrCode = null;
let scanning = false;
const seen = new Set();
let failCount = 0;

function dlog(...a){ if (DEBUG) console.log(...a); }

// ---------- Overlay ----------
function ensureOverlay(readerEl){
  if (!readerEl) return;
  if (!readerEl.querySelector('.scan-overlay')) {
    const el = document.createElement('div');
    el.className = 'scan-overlay';
    el.innerHTML = `
      <div class="reticle"><div class="scanline"></div></div>
      <div class="hit-pulse" style="display:none"><div class="ring"></div></div>
    `;
    readerEl.appendChild(el);
  }
  const update = ()=>{
    const max = Math.min(readerEl.clientWidth || 320, 520);
    const size = Math.round(Math.min(Math.max(max * 0.7, 240), 420));
    readerEl.style.setProperty('--qrbox-size', `${size}px`);
  };
  update();
  window.addEventListener('resize', update);
}

function showHitPulse(readerEl){
  const pulse = readerEl.querySelector('.hit-pulse');
  if (!pulse) return;
  pulse.style.display = 'grid';
  const ring = pulse.querySelector('.ring');
  ring.style.animation = 'none'; void ring.offsetWidth; ring.style.animation = '';
  setTimeout(()=> pulse.style.display='none', 600);
}

function beep(freq=920, ms=120){
  try {
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.type='sine'; osc.frequency.value=freq; osc.connect(g); g.connect(ctx.destination);
  osc.start(); g.gain.setValueAtTime(0.001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+ms/1000);
  osc.stop(ctx.currentTime+ms/1000+0.02);
  setTimeout(()=>ctx.close(), ms+120);
  } catch {}
}
function haptic(){ try{ if(navigator.vibrate) navigator.vibrate([60]); }catch{} }

// ---------- Parser ----------
function parseQrPayload(text){
  let raw; try { raw = JSON.parse(text); } catch { return null; }
  const meli_id   = raw.tracking_id || raw.id || raw.meli_id || null;
  const sender_id = (raw.sender_id ?? raw.senderId ?? '').toString() || null;
  const hash_code = raw.hash_code || raw.hashnumber || raw.hashNumber || raw.hash || null;
  const security_digit = raw.security_digit || raw.sec || null;
  const destinatario = raw.destinatario || raw.receiver || raw.receiver_name || null;
  const direccion = raw.direccion || [raw.street_name, raw.street_number].filter(Boolean).join(' ')
                  || raw.address || null;
  const codigo_postal = raw.codigo_postal || raw.zip_code || raw.zip || null;
  return { raw, meli_id, sender_id, hash_code, security_digit, destinatario, direccion, codigo_postal };
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// ---------- Render tarjeta ----------
function renderScanCard(payload, rawStr){
  const list = qs('#scanList');
  const card = document.createElement('div');
  card.className = 'rounded-2xl border border-white/10 bg-white/[0.02] p-4';
  card.dataset.rawText = rawStr || JSON.stringify(payload.raw);

  card.innerHTML = `
    <div class="text-sm grid md:grid-cols-2 gap-1">
      <div><span class="opacity-70">Sender ID:</span> ${payload.sender_id ?? '(?)'}</div>
      <div><span class="opacity-70">Tracking:</span> ${payload.meli_id ?? '(?)'}</div>
      <div><span class="opacity-70">Hash:</span> ${payload.hash_code ?? '(?)'}</div>
      <div class="opacity-60 text-xs md:col-span-2 break-all">RAW: ${escapeHtml(JSON.stringify(payload.raw))}</div>
    </div>
    <div class="mt-3 flex items-center gap-2">
      <button class="btn-save bg-[#FF9800] hover:bg-[#F57C00] text-white px-4 py-2 rounded-2xl">Guardar</button>
      <button class="btn-view-qr px-4 py-2 rounded-2xl border border-white/10 hover:bg-white/[0.06]" disabled>Ver QR</button>
      <span class="save-status text-sm opacity-80"></span>
    </div>
  `;
  list.prepend(card);

  const btnSave = card.querySelector('.btn-save');
  const btnView = card.querySelector('.btn-view-qr');
  const txt     = card.querySelector('.save-status');

  btnSave.addEventListener('click', async ()=>{
    btnSave.disabled = true; txt.textContent = 'Guardando…';
    try {
      const res = await fetch('/api/scan-meli', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ raw_text: card.dataset.rawText })
      });
      const data = await res.json().catch(()=>null);
      if(!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      txt.textContent = data.created ? '✅ Envío creado + QR adjuntado' : '✅ QR adjuntado';
      if (data.qr_url) {
        btnView.disabled = false;
        btnView.onclick = ()=> window.open(data.qr_url, '_blank');
      }
    } catch(e){
      console.error(e); txt.textContent = '❌ Error guardando'; btnSave.disabled = false;
    }
  });
}

// ---------- Arranque ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  const camaraContainer  = qs('#camaraContainer');
  const tecladoContainer = qs('#tecladoContainer');
  const modoRadios       = qsa('input[name="modoScan"]');
  const startBtn         = qs('#startBtn');
  const stopBtn          = qs('#stopBtn');
  const reader           = qs('#reader');
  const statusText       = qs('#status');
  const inputTeclado     = qs('#scannerInput');

  ensureOverlay(reader);

  if (window.Html5Qrcode) {
    html5QrCode = new Html5Qrcode(reader.id);
    dlog('html5-qrcode listo');
  }

  // Modo
  modoRadios.forEach(r=>{
    r.addEventListener('change', ()=>{
      const cam = r.value==='camara' && r.checked;
      camaraContainer.classList.toggle('hidden', !cam);
      tecladoContainer.classList.toggle('hidden', cam);
      if (!cam) inputTeclado?.focus();
      if (scanning) stopScanner();
      if (cam) statusText.textContent = 'Listo. Alineá el código y mantené 15–25 cm.';
    });
  });

  // Cámara
  startBtn?.addEventListener('click', startScanner);
  stopBtn?.addEventListener('click', stopScanner);

  // Teclado
  inputTeclado?.addEventListener('keydown', e=>{
    if (e.key==='Enter') {
      const code = inputTeclado.value.trim(); inputTeclado.value='';
      if (code) onScanSuccess(code, reader, statusText);
    }
  });

  // Helpers
  async function pickBackCameraId(){
    try{
      const cams = await Html5Qrcode.getCameras();
      const back = cams.find(d=>/back|environment|rear|trasera/i.test(d.label));
      return (back || cams[0])?.id || null;
    }catch{ return null; }
  }
  function computeQrbox(w,h){
    const max = Math.min(w, 520);
    const size = Math.round(Math.min(Math.max(max*0.7, 240), 420));
    return { width:size, height:size };
  }

  async function startScanner(){
    if (!html5QrCode){ alert('La cámara no está disponible. Usá el modo lector.'); return; }
    statusText.textContent = 'Iniciando cámara…';

    let started=false;
    try{
      const backId = await pickBackCameraId();
      if (backId){
        await html5QrCode.start(
          { deviceId:{ exact: backId } },
          { fps:12, qrbox:computeQrbox, aspectRatio:1.777, experimentalFeatures:{ useBarCodeDetectorIfSupported:true } },
          t=>onScanSuccess(t, reader, statusText),
          ()=>onScanFail(statusText)
        );
        started=true;
      }
    }catch(e){ dlog('deviceId start fail', e); }

    if (!started){
      try{
        await html5QrCode.start(
          { facingMode:'environment' },
          { fps:12, qrbox:computeQrbox, aspectRatio:1.777, experimentalFeatures:{ useBarCodeDetectorIfSupported:true } },
          t=>onScanSuccess(t, reader, statusText),
          ()=>onScanFail(statusText)
        );
        started=true;
      }catch(e){
        console.error('No se pudo iniciar la cámara:', e);
        statusText.textContent = 'Revisá permisos del sitio para la cámara.';
        return;
      }
    }

    scanning=true; startBtn.disabled=true; stopBtn.disabled=false;
    statusText.textContent='Escaneando… Tip: que el QR ocupe ~70% del recuadro.';
    // Overlay por encima del video en algunos Android
    ensureOverlay(reader);
  }

  async function stopScanner(){
    if (!scanning || !html5QrCode) return;
    statusText.textContent='Deteniendo…';
    try{ await html5QrCode.stop(); await html5QrCode.clear(); }catch(e){ console.error(e); }
    scanning=false; startBtn.disabled=false; stopBtn.disabled=true;
    statusText.textContent='Escáner detenido.';
  }
});

// Procesamiento central
function onScanSuccess(decodedText, readerEl, statusEl){
  if (seen.has(decodedText)) return;
  seen.add(decodedText);

  showHitPulse(readerEl); beep(940,120); haptic();
  statusEl.textContent='¡Código leído! Podés seguir escaneando.';

  const payload = parseQrPayload(decodedText);
  if (!payload){ console.warn('QR no es JSON válido'); return; }
  renderScanCard(payload, decodedText);
}

const TIPS = [
  'acercá hasta que ocupe ~70% del recuadro',
  'alejalo 5–10 cm si se ve borroso',
  'incliná 10–15° para evitar reflejos',
  'alisá la etiqueta: sin pliegues/arrugas ni cinta brillante',
];
function onScanFail(statusEl){
  failCount++;
  if (failCount % 60 === 0) {
    const tip = TIPS[(failCount/60)%TIPS.length | 0];
    statusEl.textContent = 'Tip: ' + tip + '.';
  }
}
