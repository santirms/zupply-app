let usuarios = [];
let usuarioAEliminar = null;

// Normalizar teléfono antes de enviar
function normalizarTelefono(telefono) {
  if (!telefono) return '';

  const limpioBase = telefono.replace(/\D/g, '');
  if (!limpioBase) return '';

  if (limpioBase.startsWith('549')) {
    return limpioBase;
  }

  if (limpioBase.startsWith('54') && !limpioBase.startsWith('549')) {
    return '549' + limpioBase.slice(2);
  }

  if (limpioBase.startsWith('15')) {
    return '549' + limpioBase.slice(2);
  }

  if (limpioBase.length === 10 && limpioBase.startsWith('11')) {
    return '549' + limpioBase;
  }

  if (limpioBase.length === 10) {
    return '549' + limpioBase;
  }

  console.warn(`Formato de teléfono desconocido: ${telefono}, agregando 549`);
  return '549' + limpioBase;
}

// Validar formato argentino
function validarTelefonoArgentino(telefono) {
  const limpio = normalizarTelefono(telefono);

  // Debe tener entre 12-14 dígitos y empezar con 549
  if (!limpio.startsWith('549') || limpio.length < 12 || limpio.length > 14) {
    return false;
  }

  return true;
}

function formatearTelefonoDisplay(telefono) {
  const limpio = normalizarTelefono(telefono);
  if (!limpio) return '';

  if (limpio.startsWith('549') && limpio.length >= 12) {
    const pais = limpio.slice(0, 2);
    const nueve = limpio.slice(2, 3);
    const area = limpio.slice(3, 5);
    const primero = limpio.slice(5, 9);
    const segundo = limpio.slice(9);
    return `+${pais} ${nueve} ${area} ${primero}-${segundo}`;
  }

  return limpio;
}

// Mostrar/ocultar campos de chofer según el rol seleccionado
function toggleChoferFields() {
  const role = document.getElementById('inputRole').value;
  const choferFields = document.getElementById('choferFields');
  const choferNombre = document.getElementById('inputChoferNombre');
  const choferTelefono = document.getElementById('inputChoferTelefono');

  if (role === 'chofer') {
    choferFields.classList.remove('hidden');
    choferNombre.required = true;
    choferTelefono.required = true;
  } else {
    choferFields.classList.add('hidden');
    choferNombre.required = false;
    choferTelefono.required = false;
    choferNombre.value = '';
    choferTelefono.value = '';
  }
}

// Exponer globalmente
window.toggleChoferFields = toggleChoferFields;

// Cargar usuarios
async function cargarUsuarios() {
  try {
    const res = await fetch('/api/users', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const lista = Array.isArray(data) ? data : data.users || [];
    usuarios = lista.map((u) => ({
      ...u,
      activo: typeof u.activo === 'boolean' ? u.activo : u.is_active !== false
    }));
    renderTabla();
  } catch (err) {
    console.error('Error cargando usuarios:', err);
    alert('No se pudieron cargar los usuarios');
  }
}

// Renderizar tabla
function renderTabla() {
  const tbody = document.getElementById('tablaUsuarios');
  if (!tbody) return;

  if (!usuarios.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 opacity-70">No hay usuarios</td></tr>';
    return;
  }

  tbody.innerHTML = usuarios.map((u) => {
    const roleBadge = {
      admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      coordinador: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      chofer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      cliente: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300'
    }[u.role] || 'bg-gray-100 text-gray-700';

    const activoIcon = u.activo
      ? '<span class="text-green-600" title="Activo">✓</span>'
      : '<span class="text-rose-600" title="Inactivo">✗</span>';

    const created = u.createdAt ? new Date(u.createdAt) : null;
    const createdLabel = created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString()
      : '-';

    let telefonoDisplay = '-';
    if (u.role === 'chofer' && u.driver_id?.telefono) {
      const tel = formatearTelefonoDisplay(u.driver_id.telefono);
      telefonoDisplay = tel || '-';
    }

    return `
      <tr class="border-b border-slate-200 dark:border-white/10">
        <td class="px-4 py-3">${u.username || '-'}</td>
        <td class="px-4 py-3">${u.email || '-'}</td>
        <td class="px-4 py-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleBadge}">
            ${u.role}
          </span>
        </td>
        <td class="px-4 py-3 text-sm font-mono">${telefonoDisplay}</td>
        <td class="px-4 py-3 text-center">${activoIcon}</td>
        <td class="px-4 py-3 text-sm opacity-70">${createdLabel}</td>
        <td class="px-4 py-3">
          <div class="flex gap-2">
            <button onclick="abrirModalEditar('${u._id}')"
              class="text-blue-600 hover:text-blue-700 dark:text-blue-400" title="Editar">
              ✏️
            </button>
            <button onclick="toggleActivo('${u._id}')"
              class="text-amber-600 hover:text-amber-700 dark:text-amber-400" title="${u.activo ? 'Desactivar' : 'Activar'}">
              ${u.activo ? '🔓' : '🔒'}
            </button>
            <button onclick="abrirModalEliminar('${u._id}')"
              class="text-rose-600 hover:text-rose-700 dark:text-rose-400" title="Eliminar">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Abrir modal para crear
function abrirModalCrear() {
  document.getElementById('modalUsuarioTitulo').textContent = 'Nuevo Usuario';
  document.getElementById('usuarioId').value = '';
  document.getElementById('inputUsername').value = '';
  document.getElementById('inputEmail').value = '';
  document.getElementById('inputPassword').value = '';
  document.getElementById('inputPassword').required = true;
  document.getElementById('passwordHint').classList.add('hidden');
  document.getElementById('inputRole').value = 'cliente';
  document.getElementById('inputActivo').checked = true;

  // Limpiar campos de chofer
  document.getElementById('inputChoferNombre').value = '';
  document.getElementById('inputChoferTelefono').value = '';
  toggleChoferFields(); // Ocultar campos de chofer inicialmente

  document.getElementById('modalUsuario').classList.remove('hidden');
  document.getElementById('modalUsuario').classList.add('flex');
}

// Abrir modal para editar
function abrirModalEditar(id) {
  const usuario = usuarios.find((u) => u._id === id);
  if (!usuario) return;

  document.getElementById('modalUsuarioTitulo').textContent = 'Editar Usuario';
  document.getElementById('usuarioId').value = usuario._id;
  document.getElementById('inputUsername').value = usuario.username || '';
  document.getElementById('inputEmail').value = usuario.email || '';
  document.getElementById('inputPassword').value = '';
  document.getElementById('inputPassword').required = false;
  document.getElementById('passwordHint').classList.remove('hidden');
  document.getElementById('inputRole').value = usuario.role;
  document.getElementById('inputActivo').checked = usuario.activo !== false;

  // Cargar datos de chofer si aplica
  if (usuario.role === 'chofer' && usuario.driver_id) {
    document.getElementById('inputChoferNombre').value = usuario.driver_id.nombre || '';
    document.getElementById('inputChoferTelefono').value = formatearTelefonoDisplay(usuario.driver_id.telefono) || '';
  } else {
    document.getElementById('inputChoferNombre').value = '';
    document.getElementById('inputChoferTelefono').value = '';
  }

  toggleChoferFields(); // Mostrar/ocultar según rol

  document.getElementById('modalUsuario').classList.remove('hidden');
  document.getElementById('modalUsuario').classList.add('flex');
}

// Cerrar modal
function cerrarModalUsuario() {
  document.getElementById('modalUsuario').classList.add('hidden');
  document.getElementById('modalUsuario').classList.remove('flex');
}

// Guardar usuario (crear o editar)
document.getElementById('formUsuario').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('usuarioId').value;
  const role = document.getElementById('inputRole').value;

  const data = {
    username: document.getElementById('inputUsername').value.trim(),
    email: document.getElementById('inputEmail').value.trim() || undefined, // Opcional
    role,
    activo: document.getElementById('inputActivo').checked
  };

  const password = document.getElementById('inputPassword').value.trim();
  if (password) {
    data.password = password;
  }

  if (role === 'chofer') {
    const choferNombre = document.getElementById('inputChoferNombre').value.trim();
    let choferTelefono = document.getElementById('inputChoferTelefono').value.trim();

    if (!choferNombre || !choferTelefono) {
      alert('Para crear un chofer, debes ingresar nombre y teléfono');
      return;
    }

    // Normalizar teléfono (quitar espacios, guiones, +)
    choferTelefono = normalizarTelefono(choferTelefono);

    // Validar formato
    if (!validarTelefonoArgentino(choferTelefono)) {
      alert('Formato de teléfono inválido.\n\nFormatos aceptados:\n• +54 9 11 1234-5678\n• 549 11 1234 5678\n• 11 1234-5678 (se agregará 549)');
      return;
    }

    data.chofer_nombre = choferNombre;
    data.chofer_telefono = choferTelefono; // Guardamos limpio: "5491112345678"

    console.log('✓ Teléfono normalizado:', choferTelefono);
  }

  try {
    const url = id ? `/api/users/${id}` : '/api/users';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al guardar');
    }

    alert(id ? 'Usuario actualizado' : 'Usuario creado');
    cerrarModalUsuario();
    await cargarUsuarios();
  } catch (err) {
    console.error('Error guardando usuario:', err);
    alert(err.message);
  }
});

// Toggle activo/inactivo
async function toggleActivo(id) {
  try {
    const res = await fetch(`/api/users/${id}/toggle-activo`, {
      method: 'PATCH',
      credentials: 'include'
    });

    if (!res.ok) throw new Error('Error al cambiar estado');

    const data = await res.json();
    const usuario = usuarios.find((u) => u._id === id);
    if (usuario) {
      usuario.activo = typeof data.activo === 'boolean' ? data.activo : !usuario.activo;
      renderTabla();
    }
  } catch (err) {
    console.error('Error toggle activo:', err);
    alert('No se pudo cambiar el estado del usuario');
  }
}

// Abrir modal eliminar
function abrirModalEliminar(id) {
  usuarioAEliminar = id;
  document.getElementById('modalEliminar').classList.remove('hidden');
  document.getElementById('modalEliminar').classList.add('flex');
}

// Cerrar modal eliminar
function cerrarModalEliminar() {
  usuarioAEliminar = null;
  document.getElementById('modalEliminar').classList.add('hidden');
  document.getElementById('modalEliminar').classList.remove('flex');
}

// Confirmar eliminación
document.getElementById('btnConfirmarEliminar').addEventListener('click', async () => {
  if (!usuarioAEliminar) return;

  try {
    const res = await fetch(`/api/users/${usuarioAEliminar}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al eliminar');
    }

    alert('Usuario eliminado');
    cerrarModalEliminar();
    await cargarUsuarios();
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    alert(err.message);
  }
});

// Cerrar modales con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalUsuario();
    cerrarModalEliminar();
  }
});

// Cerrar modales clickeando fuera
document.getElementById('modalUsuario').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) cerrarModalUsuario();
});

document.getElementById('modalEliminar').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) cerrarModalEliminar();
});

function initTopbar() {
  try {
    const wrap = document.getElementById('userMenuWrap');
    const btn = document.getElementById('userBtn');
    const menu = document.getElementById('userMenu');
    btn?.addEventListener('click', () => menu?.classList.toggle('hidden'));
    document.addEventListener('click', (ev) => {
      if (menu && wrap && !wrap.contains(ev.target)) {
        menu.classList.add('hidden');
      }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      try { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
      localStorage.removeItem('zpl_auth');
      location.href = '/auth/login';
    });

    fetch('/me', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((me) => {
        const usernameEl = document.getElementById('username');
        if (usernameEl) {
          usernameEl.textContent = me?.name || me?.username || me?.email || 'Usuario';
        }
      })
      .catch(() => {
        location.href = '/auth/login';
      });

    const order = ['light', 'dark', 'system'];
    const btnTheme = document.getElementById('themeBtn');
    const apply = (mode) => {
      const prefers = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const wantDark = mode === 'dark' || (mode === 'system' && prefers);
      document.documentElement.classList.toggle('dark', wantDark);
      localStorage.setItem('zpl_theme', mode);
      if (btnTheme) btnTheme.textContent = `Tema: ${mode === 'system' ? 'auto' : mode}`;
    };
    apply(localStorage.getItem('zpl_theme') || 'system');
    btnTheme?.addEventListener('click', () => {
      const current = localStorage.getItem('zpl_theme') || 'system';
      const next = order[(order.indexOf(current) + 1) % order.length];
      apply(next);
    });
  } catch (err) {
    console.error('Error inicializando topbar:', err);
  }
}

function actualizarAnio() {
  const anio = document.getElementById('anio');
  if (anio) {
    anio.textContent = new Date().getFullYear();
  }
}

// Cargar al inicio
document.addEventListener('DOMContentLoaded', () => {
  cargarUsuarios();
  initTopbar();
  actualizarAnio();
});

// Exponer funciones globales
window.abrirModalCrear = abrirModalCrear;
window.abrirModalEditar = abrirModalEditar;
window.cerrarModalUsuario = cerrarModalUsuario;
window.toggleActivo = toggleActivo;
window.abrirModalEliminar = abrirModalEliminar;
window.cerrarModalEliminar = cerrarModalEliminar;
