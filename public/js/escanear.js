// Zupply – Escanear (simple): back camera por defecto, overlay fijo, sin selector/linterna

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let html5QrCode = null;
let scanning = false;
const seen = new Set();
let failCount = 0;

// ------- Overlay -------
function ensureOverlay(readerEl, forceTop=false){
  if(!readerEl) return;
  let ov = readerEl.querySelector('.scan-overlay');
  if(!ov){
    ov = document.createElement('div');
    ov.className = 'scan-overlay';
    ov.innerHTML = `<div class="reticle"><div class="scanline"></div></div>
                    <div class="hit-pulse" style="display:none"><div class="ring"></div></div>`;
    readerEl.appendChild(ov);
  }
  const resize=()=>{
    const max = Math.min(readerEl.clientWidth||320, 520);
    const sz  = Math.round(Math.min(Math.max(max*0.7,240),420));
    readerEl.style.setProperty('--qrbox-size', `${sz}px`);
  };
  resize(); addEventListener('resize', resize);
  if(forceTop) readerEl.appendChild(ov);
}
function hit(readerEl){
  const p = readerEl.querySelector('.hit-pulse'); if(!p) return;
  p.style.display='grid'; const r=p.querySelector('.ring'); r.style.animation='none'; void r.offsetWidth; r.style.animation=''; setTimeout(()=>p.style.display='none', 600);
}
function beep(freq=940, ms=120){
  try{const ctx=new (AudioContext||webkitAudioContext)(),o=ctx.createOscillator(),g=ctx.createGain();
    o.type='sine'; o.frequency.value=freq; o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.setValueAtTime(0.001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+ms/1000); o.stop(ctx.currentTime+ms/1000+0.02);
    setTimeout(()=>ctx.close(),ms+120);}catch{}
}
function haptic(){ try{ if(navigator.vibrate) navigator.vibrate(50); }catch{} }

// ------- Parse + UI -------
function parseQrPayload(text){
  let raw; try{ raw=JSON.parse(text); }catch{ return null; }
  const meli_id   = raw.tracking_id || raw.id || raw.meli_id || null;
  const sender_id = (raw.sender_id ?? raw.senderId ?? '').toString() || null;
  const hash_code = raw.hash_code || raw.hashnumber || raw.hashNumber || raw.hash || null;
  const security_digit = raw.security_digit || raw.sec || null;
  const destinatario = raw.destinatario || raw.receiver || raw.receiver_name || null;
  const direccion = raw.direccion || [raw.street_name, raw.street_number].filter(Boolean).join(' ') || raw.address || null;
  const codigo_postal = raw.codigo_postal || raw.zip_code || raw.zip || null;
  return { raw, meli_id, sender_id, hash_code, security_digit, destinatario, direccion, codigo_postal };
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function renderScanCard(payload, rawStr){
  const list = qs('#scanList');
  const card = document.createElement('div');
  card.className='rounded-2xl p-4 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5';
  card.dataset.rawText = rawStr || JSON.stringify(payload.raw);
  card.innerHTML = `
    <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
      <p><span class="opacity-60">Sender ID:</span> ${payload.sender_id ?? '(?)'}</p>
      <p><span class="opacity-60">Tracking ID:</span> <span class="font-medium">${payload.meli_id ?? '(?)'}</span></p>
      <p><span class="opacity-60">Hash:</span> ${payload.hash_code ?? '(?)'}</p>
      <p><span class="opacity-60">Seguridad:</span> ${payload.security_digit ?? '—'}</p>
      <p class="sm:col-span-2"><span class="opacity-60">Dirección:</span> ${[payload.destinatario,payload.direccion].filter(Boolean).join(' · ')||'—'}</p>
      <p class="sm:col-span-2 text-xs opacity-70 break-all">RAW: ${escapeHtml(JSON.stringify(payload.raw))}</p>
    </div>
    <div class="mt-3 flex items-center gap-2">
      <button class="btn-save px-3 py-2 rounded-xl font-medium shadow-sm bg-[var(--z-primary)] hover:bg-[var(--z-primary-dark)] text-[var(--z-primary-fg)]">Guardar</button>
      <button class="btn-view-qr px-3 py-2 rounded-xl border border-slate-300 dark:border-white/10" disabled>Ver QR</button>
      <span class="text-sm opacity-80 save-status"></span>
    </div>`;
  list.prepend(card);

  const btnSave=card.querySelector('.btn-save'); const btnView=card.querySelector('.btn-view-qr'); const txt=card.querySelector('.save-status');
  btnSave.addEventListener('click', async ()=>{
    btnSave.disabled=true; txt.textContent='Guardando…';
    try{
      const res=await fetch('/api/scan-meli',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw_text:card.dataset.rawText})});
      const data=await res.json(); if(!res.ok||!data.ok) throw new Error(data?.error||`HTTP ${res.status}`);
      txt.textContent=data.created?'✅ Envío creado + QR adjuntado':'✅ QR adjuntado';
      if(data.qr_url){ btnView.disabled=false; btnView.onclick=()=>window.open(data.qr_url,'_blank'); }
    }catch(e){ console.error(e); txt.textContent='❌ Error guardando'; btnSave.disabled=false; }
  });
}

// ------- Cámara / teclado -------
document.addEventListener('DOMContentLoaded', ()=>{
  const modoRadios=qsa('input[name="modoScan"]');
  const startBtn=qs('#startBtn'); const stopBtn=qs('#stopBtn');
  const reader=qs('#reader'); const statusEl=qs('#status'); const input=qs('#scannerInput');

  ensureOverlay(reader);

  // Modo
  modoRadios.forEach(r=>r.addEventListener('change',()=>{
    const cam = r.value==='camara' && r.checked;
    reader.closest('section').classList.toggle('hidden',!cam);
    qs('#tecladoContainer').classList.toggle('hidden',cam);
    if(!cam) input.focus();
    if(scanning) stop();
    if(cam) statusEl.textContent='Listo. Alineá el código y mantené 15–25 cm.';
  }));

  // Teclado
  input.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const code=input.value.trim(); input.value='';
    if(code) onScanSuccess(code, reader, statusEl);
  });

  startBtn.addEventListener('click', start);
  stopBtn .addEventListener('click', stop);

  async function pickBackId(){
    try{
      const list=await Html5Qrcode.getCameras();
      const back=list.find(d=>/back|environment|rear|trasera/i.test(d.label));
      return (back||list[0])?.id || null;
    }catch{ return null; }
  }

  function computeQrbox(w,h){
    const max=Math.min(w,520); const sz=Math.round(Math.min(Math.max(max*0.7,240),420));
    return {width:sz,height:sz};
  }

  async function start(){
    if(!window.Html5Qrcode){ alert('La cámara no está disponible. Usá el modo lector.'); return; }
    statusEl.textContent='Iniciando cámara…';
    html5QrCode = new Html5Qrcode(reader.id);
    let ok=false, err1=null;

    // 1) intento por deviceId trasero
    try{
      const backId = await pickBackId();
      if(backId){
        await html5QrCode.start(
          { deviceId:{ exact: backId } },
          { fps:12, qrbox:computeQrbox, aspectRatio:1.777, experimentalFeatures:{ useBarCodeDetectorIfSupported:true } },
          t=>onScanSuccess(t, reader, statusEl),
          ()=>onScanFail(statusEl)
        );
        ok=true;
      }
    }catch(e){ err1=e; }

    // 2) fallback facingMode
    if(!ok){
      try{
        await html5QrCode.start(
          { facingMode:'environment' },
          { fps:12, qrbox:computeQrbox, aspectRatio:1.777, experimentalFeatures:{ useBarCodeDetectorIfSupported:true } },
          t=>onScanSuccess(t, reader, statusEl),
          ()=>onScanFail(statusEl)
        );
        ok=true;
      }catch(e2){
        console.error('No se pudo iniciar cámara:', err1 || e2);
        statusEl.textContent='No se pudo iniciar la cámara. Revisá permisos del sitio.';
        return;
      }
    }

    scanning=true;
    startBtn.disabled=true; stopBtn.disabled=false;
    statusEl.textContent='Escaneando… Tip: que el QR ocupe ~70% del recuadro.';
    ensureOverlay(reader,true); // forzar overlay arriba del <video>
  }

  async function stop(){
    statusEl.textContent='Deteniendo…';
    try{ if(html5QrCode){ await html5QrCode.stop(); await html5QrCode.clear(); } }catch(e){ console.error(e); }
    scanning=false; startBtn.disabled=false; stopBtn.disabled=true; statusEl.textContent='Escáner detenido.';
  }
});

// ------- callbacks -------
function onScanSuccess(decodedText, readerEl, statusEl){
  if(seen.has(decodedText)) return; seen.add(decodedText);
  hit(readerEl); beep(); haptic();
  statusEl.textContent='¡Código leído! Podés seguir escaneando.';
  const payload=parseQrPayload(decodedText); if(!payload) return;
  renderScanCard(payload, decodedText);
}
const TIPS=['acercá hasta ~70%','alejalo 5–10 cm si borroso','incliná 10–15° para evitar reflejos','alisá la etiqueta (sin pliegues)'];
function onScanFail(statusEl){ if(++failCount%60===0){ statusEl.textContent='Tip: '+TIPS[(failCount/60)%TIPS.length|0]+'.'; } }
