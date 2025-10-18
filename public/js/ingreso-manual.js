// public/js/ingreso-manual.js (mismo flujo + estilos dark/topbar)
const qs  = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

const CLIENTES_API     = '/api/clientes';
const PARTIDO_CP_API   = '/api/partidos/cp';
const ENVIO_MANUAL_API = '/api/envios/manual';

let clientes = [];

const TELEFONO_MIN = 12;
const TELEFONO_MAX = 13;

// ===== Topbar (usuario + tema) =====
(function initTopbar(){
  // usuario
  (function(){
    const btn=qs('#userBtn'), menu=qs('#userMenu'), wrap=qs('#userMenuWrap');
    if(btn&&menu&&wrap){
      btn.addEventListener('click', ()=>menu.classList.toggle('hidden'));
      document.addEventListener('click', e=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    qs('#logoutBtn')?.addEventListener('click', async ()=>{
      try{ await fetch('/auth/logout',{method:'POST'}) }catch{}
      try{ localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); }catch{}
      location.href='/auth/login';
    });
    fetch('/me',{cache:'no-store'})
      .then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(me=>{
        const n=me.name||me.username||me.email||'Usuario';
        const u=qs('#username'); if(u) u.textContent=n;
      })
      .catch(()=> location.href='/auth/login');
  })();

  // tema
  (function(){
    const order=['light','dark','system'];
    const btn=qs('#themeBtn');
    if(!btn) return;
    const apply=(mode)=>{
      const prefersDark=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const wantDark=(mode==='dark')||(mode==='system'&&prefersDark);
      document.documentElement.classList.toggle('dark', wantDark);
      localStorage.setItem('zpl_theme', mode);
      btn.textContent='Tema: ' + (mode==='system'?'auto':mode);
    };
    apply(localStorage.getItem('zpl_theme')||'system');
    btn.addEventListener('click', ()=>{
      const cur=localStorage.getItem('zpl_theme')||'system';
      const next=order[(order.indexOf(cur)+1)%order.length];
      apply(next);
    });
  })();
})();

// ===== Página =====
window.addEventListener('DOMContentLoaded', () => {
  cargarClientes();
  agregarPaquete();
});

async function cargarClientes() {
  try{
    const res = await fetch(CLIENTES_API, { cache:'no-store' });
    if (!res.ok) throw res.status;
    clientes = await res.json();
    const sel = qs('#cliente');
    sel.innerHTML = clientes.map(c=>`<option value="${c._id}">${c.nombre}</option>`).join('');
    sel.addEventListener('change', ()=>{
      const cl = clientes.find(x=>x._id===sel.value);
      qs('#codigo_interno').value = cl?.codigo_cliente || '';
    });
    sel.dispatchEvent(new Event('change'));
  }catch(e){
    console.error('Clientes:', e);
    alert('No se pudieron cargar los clientes');
  }
}

function paqueteMarkup(){
  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <label class="block text-sm">Destinatario
        <input name="destinatario" required class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>
      <label class="block text-sm">Teléfono <span class="text-slate-400 text-xs">(opcional)</span>
        <input type="tel" name="telefono" maxlength="13" pattern="[0-9]{12,13}" inputmode="numeric"
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"
               placeholder="5491123456789"
               title="Formato: 549 + código de área + número (ej: 5491123456789)"/>
        <small class="mt-1 block text-xs text-slate-500 dark:text-slate-400">
          Formato: <code class="bg-slate-100 dark:bg-white/5 px-1 rounded">549 + código de área + número</code><br>
          <span class="text-slate-400">Ejemplo AMBA: 5491123456789 | Provincia: 5492214567890</span>
        </small>
      </label>
      <label class="block text-sm">Dirección
        <input name="direccion" required class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>

      <label class="block text-sm">Código Postal
        <input name="codigo_postal" required
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"
               onblur="detectarPartido(this)" oninput="detectarPartido(this)"/>
      </label>
      <label class="block text-sm">Partido (auto)
        <input name="partido" readonly
               class="mt-1 w-full p-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5"/>
      </label>

      <div class="flex items-center gap-2 mt-1">
        <input id="chk" type="checkbox" name="manual_precio" onchange="togglePrecioManual(this)"
               class="w-5 h-5 accent-amber-600">
        <label for="chk" class="text-sm">Precio manual</label>
      </div>

      <label class="block text-sm">Precio a facturar ($)
        <input type="number" step="0.01" name="precio" readonly
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>

      <label class="block text-sm">ID de venta (opcional)
        <input name="id_venta" placeholder="Si se omite, se autogenera"
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </label>
    </div>

    <div class="mt-3 flex justify-between">
      <div class="text-xs opacity-60">Se valida el CP→Partido automáticamente</div>
      <button type="button" onclick="this.closest('.paquete-group').remove()"
        class="px-3 py-1.5 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">
        Eliminar paquete
      </button>
    </div>
  `;
}

function setTelefonoVisualState(input, state) {
  if (!input) return;
  input.classList.remove('border-green-500', 'border-red-500');
  if (state === 'valid') input.classList.add('border-green-500');
  if (state === 'invalid') input.classList.add('border-red-500');
}

function initTelefonoInput(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let value = input.value.replace(/\D/g, '');
    if (value.length > TELEFONO_MAX) value = value.slice(0, TELEFONO_MAX);
    input.value = value;

    if (!value.length) {
      setTelefonoVisualState(input, null);
      return;
    }

    if (value.startsWith('549') && value.length >= TELEFONO_MIN && value.length <= TELEFONO_MAX) {
      setTelefonoVisualState(input, 'valid');
    } else {
      setTelefonoVisualState(input, 'invalid');
    }
  });

  input.addEventListener('blur', () => {
    const value = input.value.trim();
    if (!value) {
      setTelefonoVisualState(input, null);
      return;
    }
    const clean = value.replace(/\D/g, '').slice(0, TELEFONO_MAX);
    input.value = clean;
    if (clean.startsWith('549') && clean.length >= TELEFONO_MIN && clean.length <= TELEFONO_MAX) {
      setTelefonoVisualState(input, 'valid');
    } else {
      setTelefonoVisualState(input, 'invalid');
    }
  });
}

function validarTelefonoInput(input, index) {
  if (!input) return null;
  const raw = input.value.trim();
  if (!raw) {
    setTelefonoVisualState(input, null);
    return null;
  }

  const clean = raw.replace(/\D/g, '');
  if (clean.length < TELEFONO_MIN || clean.length > TELEFONO_MAX) {
    setTelefonoVisualState(input, 'invalid');
    alert(`El teléfono del paquete #${index + 1} debe tener entre 12 y 13 dígitos.\n\nFormato: 549 + código de área + número\nEjemplo: 5491123456789`);
    input.focus();
    return false;
  }

  if (!clean.startsWith('549')) {
    setTelefonoVisualState(input, 'invalid');
    alert(`El teléfono del paquete #${index + 1} debe comenzar con 549 (código Argentina + prefijo celular).\n\nEjemplo: 5491123456789`);
    input.focus();
    return false;
  }

  input.value = clean;
  setTelefonoVisualState(input, 'valid');
  return clean;
}

function agregarPaquete() {
  const div = document.createElement('div');
  div.className = 'paquete-group rounded-2xl border border-slate-200 dark:border-white/10 p-4 bg-slate-50 dark:bg-white/5';
  div.innerHTML = paqueteMarkup();
  qs('#paquetes').appendChild(div);
  initTelefonoInput(div.querySelector("input[name='telefono']"));
}

function togglePrecioManual(cb) {
  const grp = cb.closest('.paquete-group');
  const inp = grp.querySelector("input[name='precio']");
  inp.readOnly = !cb.checked;
  if (!cb.checked) inp.value = '';
}

function detectarPartido(input) {
  const cp = input.value.trim();
  const partidoI = input.closest('.paquete-group').querySelector("input[name='partido']");
  if (!cp) { partidoI.value = ''; return; }
  fetch(`${PARTIDO_CP_API}/${encodeURIComponent(cp)}`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => partidoI.value = d.partido || 'No encontrado')
    .catch(() => partidoI.value = 'Error');
}

async function guardar() {
  const clienteId  = qs('#cliente').value;
  const codigoInt  = qs('#codigo_interno').value;
  const referencia = qs('#referencia').value.trim();

  const grupos = qsa('.paquete-group');
  const paquetes = [];

  for (let i = 0; i < grupos.length; i++) {
    const div = grupos[i];
    let idVenta = div.querySelector("[name='id_venta']").value.trim();
    if (!idVenta) idVenta = Math.random().toString(36).substr(2,8).toUpperCase();
    const manual = div.querySelector("[name='manual_precio']").checked;
    const precioManual = Number(div.querySelector("[name='precio']").value);
    const telefono = validarTelefonoInput(div.querySelector("[name='telefono']"), i);
    if (telefono === false) return;

    paquetes.push({
      cliente_id:    clienteId,
      sender_id:     codigoInt,
      destinatario:  div.querySelector("[name='destinatario']").value.trim(),
      direccion:     div.querySelector("[name='direccion']").value.trim(),
      codigo_postal: div.querySelector("[name='codigo_postal']").value.trim(),
      partido:       div.querySelector("[name='partido']").value.trim(),
      telefono:      telefono ?? null,
      id_venta:      idVenta,
      referencia,
      manual_precio: manual,
      precio:        manual? precioManual : undefined
    });
  }

  try {
    const res = await fetch(ENVIO_MANUAL_API, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ paquetes })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

    const docs = Array.isArray(data.docs) ? data.docs : [];

    const referenciaInput = qs('#referencia');
    if (referenciaInput) referenciaInput.value = '';
    const paquetesContainer = qs('#paquetes');
    if (paquetesContainer) {
      paquetesContainer.innerHTML = '';
      agregarPaquete();
    }

    if (docs.length === 1) {
      const envioDoc = docs[0] || {};
      const paqueteOriginal = paquetes[0] || {};

      abrirModalConfirmacion({
        tracking: envioDoc.tracking || envioDoc.id_venta || paqueteOriginal.id_venta,
        destinatario: envioDoc.destinatario || paqueteOriginal.destinatario,
        telefono: paqueteOriginal.telefono || envioDoc.telefono || null,
        label_url: envioDoc.label_url || null
      });
    } else {
      renderModalResultados(docs);
      openModalResultados();
    }
  } catch (err) {
    console.error('Error saving:', err);
    alert('No se pudo guardar');
  }
}

// ===== Modal resultados =====
function renderModalResultados(items) {
  const list = qs('#res-list');
  list.innerHTML = '';
  items.forEach(x => {
    const li = document.createElement('li');
    li.className = 'border border-slate-200 dark:border-white/10 rounded-xl p-3';
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <img alt="QR" class="w-20 h-20 object-contain rounded bg-white dark:bg-white/10"/>
        <div class="flex-1">
          <div class="font-semibold">Tracking (id_venta): ${x.id_venta}</div>
          <div class="text-sm opacity-80">${x.destinatario||''} — ${x.direccion||''} (${x.codigo_postal||''}) ${x.partido||''}</div>
          ${x.label_url ? `<a class="text-amber-600 hover:underline" href="${x.label_url}" target="_blank" rel="noopener">Descargar etiqueta 10×15</a>` : '<span class="text-xs opacity-60">sin etiqueta</span>'}
        </div>
      </div>
    `;
    li.querySelector('img').src = x.qr_png || '';
    list.appendChild(li);
  });
}
function openModalResultados(){ const m=qs('#modal-resultados'); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModalResultados(){ const m=qs('#modal-resultados'); m.classList.add('hidden'); m.classList.remove('flex'); }

// ========== MODAL DE CONFIRMACIÓN ==========

let envioActual = null;

function abrirModalConfirmacion(envio) {
  if (!envio) return;

  envioActual = envio;

  document.getElementById('confTracking').textContent = envio.tracking || '-';
  document.getElementById('confDestinatario').textContent = envio.destinatario || '-';

  const tracking = envio.tracking || '';
  const linkSeguimiento = tracking ? `https://zupply.tech/track/${tracking}` : '';
  document.getElementById('confLink').value = linkSeguimiento;

  const btnWhatsApp = document.getElementById('btnWhatsAppModal');
  if (envio.telefono) {
    btnWhatsApp.classList.remove('hidden');
  } else {
    btnWhatsApp.classList.add('hidden');
  }

  const modal = document.getElementById('modalConfirmacion');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function cerrarModalConfirmacion() {
  const modal = document.getElementById('modalConfirmacion');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  envioActual = null;
}

function copiarLink() {
  const input = document.getElementById('confLink');
  const texto = input.value;

  if (!texto) return;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).catch(() => {
      input.select();
      document.execCommand('copy');
    });
  } else {
    input.select();
    document.execCommand('copy');
  }

  const winEvent = typeof window !== 'undefined' ? window.event : undefined;
  const btn = winEvent?.target instanceof HTMLElement ? winEvent.target : null;
  if (btn) {
    const textoOriginal = btn.textContent;
    btn.textContent = '✓ Copiado';
    setTimeout(() => {
      btn.textContent = textoOriginal;
    }, 2000);
  }
}

function enviarWhatsApp() {
  if (!envioActual || !envioActual.telefono) {
    alert('No hay número de teléfono para este envío');
    return;
  }

  const destinatario = envioActual.destinatario || 'Cliente';
  const tracking = envioActual.tracking || '';
  const linkSeguimiento = tracking ? `https://zupply.tech/track/${tracking}` : '';
  const telefono = typeof envioActual.telefono === 'string'
    ? envioActual.telefono.replace(/\D/g, '')
    : '';

  if (!telefono) {
    alert('El número de teléfono no es válido');
    return;
  }

  const mensaje = `Hola ${destinatario}! 👋
Tu envío está en camino 📦
Seguí tu pedido en tiempo real: ${linkSeguimiento}
Tracking: ${tracking}`;

  const linkWhatsApp = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
  window.open(linkWhatsApp, '_blank');
}

function imprimirEtiqueta() {
  if (!envioActual || !envioActual.label_url) {
    alert('La etiqueta no está disponible por el momento');
    return;
  }

  window.open(envioActual.label_url, '_blank');
}

window.abrirModalConfirmacion = abrirModalConfirmacion;
window.cerrarModalConfirmacion = cerrarModalConfirmacion;
window.copiarLink = copiarLink;
window.enviarWhatsApp = enviarWhatsApp;
window.imprimirEtiqueta = imprimirEtiqueta;
