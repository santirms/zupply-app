const qs = (selector) => document.querySelector(selector);

const CLIENTES_API = '/api/clientes';
const PARTIDO_CP_API = '/api/partidos/cp';
const CREAR_ENVIO_API = '/api/ingreso-manual/crear';

let userRole = null;
let clienteIdActual = null;

(function initTopbar(){
  const btn = qs('#userBtn');
  const menu = qs('#userMenu');
  const wrap = qs('#userMenuWrap');
  if (btn && menu && wrap) {
    btn.addEventListener('click', () => menu.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) menu.classList.add('hidden');
    });
  }

  qs('#logoutBtn')?.addEventListener('click', async () => {
    try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
    try {
      localStorage.removeItem('zpl_auth');
      localStorage.removeItem('zpl_username');
    } catch {}
    location.href = '/auth/login';
  });

  const themeBtn = qs('#themeBtn');
  if (themeBtn) {
    const order = ['light','dark','system'];
    const apply = (mode) => {
      const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      const wantDark = mode === 'dark' || (mode === 'system' && media?.matches);
      document.documentElement.classList.toggle('dark', !!wantDark);
      localStorage.setItem('zpl_theme', mode);
      themeBtn.textContent = 'Tema: ' + (mode === 'system' ? 'auto' : mode);
    };
    const saved = localStorage.getItem('zpl_theme') || 'system';
    apply(saved);
    themeBtn.addEventListener('click', () => {
      const current = localStorage.getItem('zpl_theme') || 'system';
      const next = order[(order.indexOf(current) + 1) % order.length];
      apply(next);
    });
  }
})();

async function inicializar() {
  try {
    const res = await fetch('/api/users/me', { credentials: 'include' });
    if (!res.ok) throw new Error('No autenticado');

    const user = await res.json();
    userRole = user.role;
    clienteIdActual = user.cliente_id || null;

    const username = user.username || user.email || 'Usuario';
    const usernameEl = qs('#username');
    if (usernameEl) usernameEl.textContent = username;

    if (userRole === 'cliente') {
      qs('#selectClienteContainer')?.classList.add('hidden');
      qs('#clienteInfoContainer')?.classList.remove('hidden');
      const select = qs('#cliente_id');
      if (select) select.required = false;
    } else {
      await cargarClientes();
    }
  } catch (err) {
    console.error('Error inicializando:', err);
    alert('Error al cargar datos del usuario');
    location.href = '/auth/login';
  }
}

async function cargarClientes() {
  try {
    const res = await fetch(CLIENTES_API, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudieron cargar los clientes');
    const clientes = await res.json();

    const select = qs('#cliente_id');
    if (!select) return;

    const options = ['<option value="">Seleccionar cliente...</option>'];
    clientes.forEach((cliente) => {
      const nombre = cliente?.nombre || 'Sin nombre';
      options.push(`<option value="${cliente._id}">${nombre}</option>`);
    });
    select.innerHTML = options.join('');

    if (clienteIdActual) {
      select.value = clienteIdActual;
    }
  } catch (err) {
    console.error(err);
    alert('No se pudieron cargar los clientes');
  }
}

async function detectarPartido(cp) {
  if (!cp) return;
  try {
    const res = await fetch(`${PARTIDO_CP_API}/${encodeURIComponent(cp)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('CP no encontrado');
    const data = await res.json();
    if (data?.partido) {
      qs('#partido').value = data.partido;
    }
  } catch (err) {
    console.warn('No se pudo detectar partido:', err);
  }
}

async function manejarSubmit(e) {
  e.preventDefault();

  const data = {
    direccion: qs('#direccion')?.value?.trim() || '',
    codigo_postal: qs('#codigo_postal')?.value?.trim() || '',
    partido: qs('#partido')?.value?.trim() || '',
    destinatario: qs('#destinatario')?.value?.trim() || '',
    telefono: qs('#telefono')?.value?.trim() || '',
    referencia: qs('#referencia')?.value?.trim() || ''
  };

  if (userRole !== 'cliente') {
    const select = qs('#cliente_id');
    data.cliente_id = select?.value || '';
    if (!data.cliente_id) {
      alert('Debe seleccionar un cliente');
      return;
    }
  }

  try {
    const res = await fetch(CREAR_ENVIO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error(result.error || 'Error al crear envío');
    }

    alert('✅ Envío creado correctamente');
    abrirModalEtiqueta(result.envio);
    qs('#formIngresoManual').reset();

    if (userRole === 'cliente') {
      qs('#partido').value = '';
    }
  } catch (err) {
    console.error('Error creando envío:', err);
    alert(`Error: ${err.message}`);
  }
}

function abrirModalEtiqueta(envio) {
  if (!envio) return;
  const contenido = qs('#contenidoEtiqueta');
  if (!contenido) return;

  const tracking = envio.tracking || envio.id_venta || '-';
  const partido = envio.partido ? ` - ${envio.partido}` : '';

  contenido.innerHTML = `
    <div class="text-center space-y-2">
      <h3 class="font-bold text-lg">Envío: ${tracking}</h3>
      <p><strong>Destinatario:</strong> ${envio.destinatario || '-'}</p>
      <p><strong>Dirección:</strong> ${envio.direccion || '-'}</p>
      <p><strong>CP:</strong> ${envio.codigo_postal || ''}${partido}</p>
      <p><strong>Tel:</strong> ${envio.telefono || '-'}</p>
      <div class="mt-4">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(tracking)}" alt="QR" class="mx-auto">
      </div>
    </div>
  `;

  const modal = qs('#modalEtiqueta');
  modal?.classList.remove('hidden');
  modal?.classList.add('flex');
}

function cerrarModalEtiqueta() {
  const modal = qs('#modalEtiqueta');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
}

function imprimirEtiqueta() {
  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  inicializar();

  const cpInput = qs('#codigo_postal');
  cpInput?.addEventListener('blur', (e) => detectarPartido(e.target.value.trim()));
  cpInput?.addEventListener('change', (e) => detectarPartido(e.target.value.trim()));

  qs('#formIngresoManual')?.addEventListener('submit', manejarSubmit);
});

window.abrirModalEtiqueta = abrirModalEtiqueta;
window.cerrarModalEtiqueta = cerrarModalEtiqueta;
window.imprimirEtiqueta = imprimirEtiqueta;
