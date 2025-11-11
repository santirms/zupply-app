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
  const randomId = Math.random().toString(36).substr(2, 9);
  const html = `
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

      <!-- Tipo de envío -->
      <label class="block text-sm">Tipo de envío
        <select name="tipo" class="select-dark mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent">
          <option value="envio">📦 Envío</option>
          <option value="retiro">🔄 Retiro</option>
          <option value="cambio">↔️ Cambio</option>
        </select>
      </label>

      <!-- Contenido (opcional) -->
      <label class="block text-sm">Descripción del contenido <span class="text-slate-400 text-xs">(opcional)</span>
        <input type="text" name="contenido" maxlength="500"
               placeholder="Ej: Notebook HP, 2 cajas"
               class="mt-1 w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
        <small class="mt-1 block text-xs text-slate-500 dark:text-slate-400">Visible en la etiqueta</small>
      </label>

      <!-- Requiere Firma -->
      <div class="block text-sm">
        <label class="flex items-start gap-2 cursor-pointer p-3 rounded-xl border border-slate-300 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
          <input type="checkbox" name="requiere_firma"
                 class="mt-0.5 w-5 h-5 accent-amber-600 flex-shrink-0">
          <div class="flex-1">
            <span class="font-medium">🖊️ Este envío requiere firma del destinatario</span>
            <small class="block text-xs text-slate-500 dark:text-slate-400 mt-1">
              El chofer deberá solicitar firma y DNI al entregar
            </small>
          </div>
        </label>
      </div>

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

    <!-- Monto a cobrar -->
    <div class="mt-4 border rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50">
      <div class="flex items-center mb-2">
 <input type="checkbox" name="cobra_en_destino" id="cobraCheck_${randomId}">
        <label for="cobraCheck_${randomId}" class="text-sm font-medium">
          💰 Cobrar monto en destino
        </label>
      </div>

      <div id="montoContainer_${randomId}" style="display: none;" class="mt-3">
        <label class="block text-sm mb-1">Monto a cobrar ($)</label>
        <input type="number" name="monto_a_cobrar" min="0" step="0.01"
               placeholder="50000.00"
               class="w-full p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"/>
      </div>
    </div>

    <div class="mt-3 flex justify-between">
      <div class="text-xs opacity-60">Se valida el CP→Partido automáticamente</div>
      <button type="button" onclick="this.closest('.paquete-group').remove()"
        class="px-3 py-1.5 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">
        Eliminar paquete
      </button>
    </div>

    <script>
      window.toggleMonto_${randomId} = function(checkbox) {
        const container = document.getElementById('montoContainer_${randomId}');
        container.style.display = checkbox.checked ? 'block' : 'none';
      };
       </script>
       `;

  return {
    html: html,
    randomId: randomId
  };
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

  const markup = paqueteMarkup(); // Ahora devuelve {html, randomId}
  div.innerHTML = markup.html;
  qs('#paquetes').appendChild(div);

  // Usar el randomId que devolvió la función
  const checkbox = div.querySelector(`#cobraCheck_${markup.randomId}`);
  const container = div.querySelector(`#montoContainer_${markup.randomId}`);

  if (checkbox && container) {
    checkbox.addEventListener('change', function() {
      container.style.display = this.checked ? 'block' : 'none';
    });
  }

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

    const tipo = div.querySelector("[name='tipo']")?.value || 'envio';
    const contenido = div.querySelector("[name='contenido']")?.value.trim() || null;
    const cobraEnDestino = div.querySelector("[name='cobra_en_destino']")?.checked || false;
    const montoACobrar = cobraEnDestino ? parseFloat(div.querySelector("[name='monto_a_cobrar']")?.value) || null : null;
    const requiereFirma = div.querySelector("[name='requiere_firma']")?.checked || false;


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
      precio:        manual? precioManual : undefined,
      tipo:          tipo,
      contenido:     contenido,
      cobra_en_destino: cobraEnDestino,
      monto_a_cobrar:   montoACobrar,
      requiereFirma:    requiereFirma
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

    const rawDocs = Array.isArray(data.envios)
      ? data.envios
      : Array.isArray(data.docs)
        ? data.docs
        : [];

    const envios = rawDocs.map((doc, index) => {
      const original = paquetes[index] || {};
      const tracking = doc.tracking || doc.id_venta || original.id_venta;
      const rawTelefono = original.telefono ?? doc.telefono ?? null;
      const telefono = typeof rawTelefono === 'string'
        ? rawTelefono.replace(/\D/g, '') || null
        : null;

      return {
        ...doc,
        tracking,
        id_venta: doc.id_venta || tracking,
        destinatario: doc.destinatario || original.destinatario,
        direccion: doc.direccion || original.direccion,
        telefono,
        label_url: doc.label_url ?? original.label_url ?? null
      };
    });

    const referenciaInput = qs('#referencia');
    if (referenciaInput) referenciaInput.value = '';
    const paquetesContainer = qs('#paquetes');
    if (paquetesContainer) {
      paquetesContainer.innerHTML = '';
      agregarPaquete();
    }

    if (envios.length === 1) {
      abrirModalConfirmacion(envios[0]);
    } else if (envios.length > 1) {
      abrirModalLista(envios);
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

function abrirModalLista(envios) {
  if (!Array.isArray(envios) || !envios.length) return;

  cerrarModalLista();

  const html = envios.map(envio => {
    const tracking = envio.tracking || envio.id_venta || '';
    const destinatario = envio.destinatario || '';
    const direccion = envio.direccion || '';
    const telefono = typeof envio.telefono === 'string' ? envio.telefono.replace(/\D/g, '') : '';
    const linkSeguimiento = tracking ? `https://app.zupply.tech/track/${tracking}` : '';
    const qrData = linkSeguimiento ? encodeURIComponent(linkSeguimiento) : '';

    const acciones = [];
    if (linkSeguimiento) {
      acciones.push(`
        <a href="${linkSeguimiento}" target="_blank"
          class="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400">
          Ver seguimiento
        </a>
      `);
    }
    acciones.push(`
      <button onclick="imprimirEtiquetaIndividual('${envio._id}')"
        class="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white flex items-center gap-1">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
        </svg>
        Imprimir
      </button>
    `);
    if (telefono) {
      acciones.push(`
        <a href="https://wa.me/${telefono}?text=${encodeURIComponent(generarMensajeWhatsApp({ ...envio, tracking }))}"
          target="_blank"
          class="text-xs text-green-600 hover:text-green-700 dark:text-green-400 flex items-center gap-1">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
          </svg>
          WhatsApp
        </a>
      `);
    }

    const accionesHTML = acciones.join(`
      <span class="text-slate-300 dark:text-slate-600">•</span>
    `);

    return `
      <div class="border border-slate-300 dark:border-white/10 rounded-xl p-4 hover:bg-slate-50 dark:hover:bg-white/5">
        <div class="flex items-start gap-4">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${qrData}"
            alt="QR" class="w-20 h-20 flex-shrink-0">
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-600 dark:text-slate-400">Tracking (id_venta)</p>
            <p class="font-mono font-semibold text-slate-900 dark:text-slate-100 mb-2">${tracking}</p>
            <p class="text-sm text-slate-900 dark:text-slate-100 mb-1">${destinatario}</p>
            <p class="text-xs text-slate-600 dark:text-slate-400 truncate">${direccion}</p>
            <div class="flex items-center gap-2 mt-2">
              ${accionesHTML}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const modalHTML = `
    <div id="modalLista" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white dark:bg-[#0B1020] rounded-2xl w-11/12 md:w-2/3 lg:w-1/2 max-h-[90vh] overflow-y-auto p-6 border border-slate-200 dark:border-white/10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-slate-900 dark:text-slate-100">Envíos creados (${envios.length})</h2>
          <button onclick="cerrarModalLista()" class="text-slate-500 hover:text-slate-700 text-2xl">×</button>
        </div>
        <div class="space-y-3 mb-4" id="listaEnvios">
          ${html}
        </div>
        <div class="space-y-2">
          <button onclick="imprimirTodasEtiquetas()"
            class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-slate-800 dark:bg-white/10 hover:bg-slate-900 dark:hover:bg-white/20 text-white font-medium rounded-xl transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
            </svg>
            Imprimir todas las etiquetas
          </button>

          <button onclick="cerrarModalLista()"
            class="w-full px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl transition-colors">
            Listo
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  window.enviosParaImprimir = envios;
}

function cerrarModalLista() {
  const modal = document.getElementById('modalLista');
  if (modal) {
    modal.remove();
  }
}

function imprimirTodasEtiquetas() {
  const envios = Array.isArray(window.enviosParaImprimir) ? window.enviosParaImprimir : [];
  if (!envios.length) {
    alert('No hay envíos para imprimir');
    return;
  }

  const etiquetasHTML = envios.map(envio => {
    const tracking = envio.tracking || envio.id_venta || '';
    const linkSeguimiento = tracking ? `https://app.zupply.tech/track/${tracking}` : '';

    return `
      <div class="etiqueta-page" style="page-break-after: always; width: 10cm; height: 15cm; padding: 1cm; border: 1px solid #ccc; margin-bottom: 1cm;">
        <div style="text-align: center; font-family: Arial, sans-serif;">
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">ZUPPLY</h2>
          <p style="margin: 5px 0; font-size: 12px;">zupply.tech</p>

          <div style="margin: 20px 0;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${linkSeguimiento}"
              alt="QR" style="width: 200px; height: 200px;">
          </div>

          <div style="text-align: left; margin-top: 20px;">
            <p style="margin: 5px 0; font-size: 14px;"><strong>Tracking:</strong> ${tracking}</p>
            <p style="margin: 5px 0; font-size: 14px;"><strong>Destinatario:</strong> ${envio.destinatario || ''}</p>
            <p style="margin: 5px 0; font-size: 14px;"><strong>Dirección:</strong> ${envio.direccion || ''}</p>
            <p style="margin: 5px 0; font-size: 14px;"><strong>CP:</strong> ${envio.codigo_postal || ''} - ${envio.partido || ''}</p>
            ${envio.telefono ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Tel:</strong> ${envio.telefono}</p>` : ''}
            ${envio.referencia ? `<p style="margin: 5px 0; font-size: 12px; color: #666;"><strong>Ref:</strong> ${envio.referencia}</p>` : ''}
          </div>

          <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc;">
            <p style="font-size: 10px; color: #666;">Seguimiento: ${linkSeguimiento}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const ventanaImpresion = window.open('', '_blank');
  if (!ventanaImpresion) {
    alert('No se pudo abrir la ventana de impresión. Revisa el bloqueador de ventanas emergentes.');
    return;
  }

  ventanaImpresion.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Etiquetas - Zupply</title>
      <style>
        @media print {
          body { margin: 0; padding: 0; }
          .etiqueta-page {
            page-break-after: always;
            margin: 0;
          }
        }
        body {
          font-family: Arial, sans-serif;
        }
      </style>
    </head>
    <body>
      ${etiquetasHTML}
      <script>
        window.onload = function() {
          window.print();
        }
      </script>
    </body>
    </html>
  `);
  ventanaImpresion.document.close();
}

function imprimirEtiquetaIndividual(envioId) {
  const lista = Array.isArray(window.enviosParaImprimir) ? window.enviosParaImprimir : [];
  const envio = lista.find(e => e._id === envioId);
  if (!envio) {
    alert('Envío no encontrado');
    return;
  }

  const prevEnvios = window.enviosParaImprimir;
  try {
    window.enviosParaImprimir = [envio];
    imprimirTodasEtiquetas();
  } finally {
    window.enviosParaImprimir = prevEnvios;
  }
}

window.imprimirTodasEtiquetas = imprimirTodasEtiquetas;
window.imprimirEtiquetaIndividual = imprimirEtiquetaIndividual;

function generarMensajeWhatsApp(envio = {}) {
  const destinatario = envio.destinatario || 'Cliente';
  const tracking = envio.tracking || envio.id_venta || '';
  const linkSeguimiento = tracking ? `https://app.zupply.tech/track/${tracking}` : '';

  const lineas = [
    `Hola ${destinatario}!`,
    '',
    'Tu envío está en camino 📦'
  ];

  if (linkSeguimiento) {
    lineas.push('', 'Seguí tu pedido en este link:', linkSeguimiento);
  }

  if (tracking) {
    lineas.push('', `Tracking: ${tracking}`);
  }

  lineas.push('', 'Gracias por tu compra!');

  return lineas.join('\n');
}

// ========== MODAL DE CONFIRMACIÓN ==========

let envioActual = null;

function abrirModalConfirmacion(envio) {
  if (!envio) return;

  envioActual = envio;

  document.getElementById('confTracking').textContent = envio.tracking || '-';
  document.getElementById('confDestinatario').textContent = envio.destinatario || '-';

  const tracking = envio.tracking || '';
  const linkSeguimiento = tracking ? `https://app.zupply.tech/track/${tracking}` : '';
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

  const telefono = typeof envioActual.telefono === 'string'
    ? envioActual.telefono.replace(/\D/g, '')
    : '';

  if (!telefono) {
    alert('El número de teléfono no es válido');
    return;
  }

  const mensaje = generarMensajeWhatsApp(envioActual);

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
window.abrirModalLista = abrirModalLista;
window.cerrarModalLista = cerrarModalLista;
