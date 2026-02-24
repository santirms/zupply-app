// public/js/configuracion.js

const qs = s => document.querySelector(s);

// ====== Topbar: usuario + tema ======
function initTopbar() {
  // Usuario / menú
  (function userMenu(){
    const btn  = qs('#userBtn');
    const menu = qs('#userMenu');
    const wrap = qs('#userMenuWrap');
    if (btn && menu && wrap) {
      btn.addEventListener('click', () => menu.classList.toggle('hidden'));
      document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await fetch('/auth/logout', { method:'POST' }); } catch {}
        try { localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); } catch {}
        location.href = '/auth/login';
      });
    }

    function getHomeRoute(role) {
      switch(role) {
        case 'cliente':     return '/client-panel.html';
        case 'admin':
        case 'coordinador': return '/index.html';
        case 'chofer':      return '/mis-envios.html';
        default:            return '/';
      }
    }

    fetch('/me', { cache:'no-store' })
      .then(r => { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(me => {
        const name = me.name || me.username || me.email || 'Usuario';
        const u = qs('#username'); if (u) u.textContent = name;
        try { localStorage.setItem('zpl_username', name); } catch {}

        const userRole = me.role || 'admin';
        const homeRoute = getHomeRoute(userRole);

        const logoLink = document.getElementById('logoLink');
        const homeLink = document.getElementById('homeLink');
        if (logoLink) logoLink.href = homeRoute;
        if (homeLink) homeLink.href = homeRoute;
      })
      .catch(() => location.href = '/auth/login');
  })();

  // Tema: light/dark/system
  (function themeToggle(){
    const order = ['light','dark','system'];
    const btn = qs('#themeBtn');
    if (!btn) return;
    const apply = (mode) => {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const wantDark = mode === 'dark' || (mode === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', wantDark);
      localStorage.setItem('zpl_theme', mode);
      btn.textContent = 'Tema: ' + (mode === 'system' ? 'auto' : mode);
    };
    apply(localStorage.getItem('zpl_theme') || 'system');
    btn.addEventListener('click', () => {
      const current = localStorage.getItem('zpl_theme') || 'system';
      const next = order[(order.indexOf(current)+1) % order.length];
      apply(next);
    });
  })();
}

// ====== Toast ======
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const content = document.getElementById('toastContent');
  if (!toast || !content) return;

  const isError = type === 'error';
  content.className = `px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 ${
    isError
      ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300'
      : 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
  }`;
  content.textContent = (isError ? '❌ ' : '✅ ') + message;

  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ====== Cargar configuración actual ======
async function cargarConfiguracion() {
  try {
    const res = await fetch('/api/tenant/settings', { cache: 'no-store' });
    if (!res.ok) throw new Error('Error cargando configuración');
    const data = await res.json();

    // Información de la empresa
    document.getElementById('companyName').value = data.companyName || '';
    document.getElementById('email').value = data.settings?.companyInfo?.email || '';
    document.getElementById('phone').value = data.settings?.companyInfo?.phone || '';
    document.getElementById('address').value = data.settings?.companyInfo?.address || '';

    // Datos fiscales
    document.getElementById('cuit').value = data.fiscal?.cuit || '';
    document.getElementById('razonSocial').value = data.fiscal?.razon_social || '';
    document.getElementById('domicilioFiscal').value = data.fiscal?.domicilio_fiscal || '';
    document.getElementById('condicionIva').value = data.fiscal?.condicion_iva || 'responsable_inscripto';
    document.getElementById('ingresosBrutos').value = data.fiscal?.ingresos_brutos || '';
    document.getElementById('inicioActividades').value = data.fiscal?.inicio_actividades
      ? new Date(data.fiscal.inicio_actividades).toISOString().split('T')[0]
      : '';

    // Logo preview
    const logoPreview = document.getElementById('logoPreview');
    const logoPlaceholder = document.getElementById('logoPlaceholder');
    const btnEliminarLogo = document.getElementById('btnEliminarLogo');
    if (data.settings?.logoUrl) {
      logoPreview.src = data.settings.logoUrl;  // URL presignada
      logoPreview.classList.remove('hidden');
      logoPlaceholder.classList.add('hidden');
      btnEliminarLogo.classList.remove('hidden');
    }
  } catch (err) {
    console.error('[configuracion] Error cargando:', err);
    showToast('Error cargando configuración', 'error');
  }
}

// ====== Guardar cambios ======
async function guardarConfiguracion() {
  const btn = document.getElementById('btnGuardar');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const payload = {
      companyName: document.getElementById('companyName').value.trim(),
      settings: {
        companyInfo: {
          email: document.getElementById('email').value.trim(),
          phone: document.getElementById('phone').value.trim(),
          address: document.getElementById('address').value.trim()
        }
      },
      fiscal: {
        cuit: document.getElementById('cuit').value.trim(),
        razon_social: document.getElementById('razonSocial').value.trim(),
        domicilio_fiscal: document.getElementById('domicilioFiscal').value.trim(),
        condicion_iva: document.getElementById('condicionIva').value,
        ingresos_brutos: document.getElementById('ingresosBrutos').value.trim(),
        inicio_actividades: document.getElementById('inicioActividades').value || null
      }
    };

    const res = await fetch('/api/tenant/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Error guardando');
    showToast('Configuración guardada correctamente');
  } catch (err) {
    console.error('[configuracion] Error guardando:', err);
    showToast('Error guardando configuración', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar cambios';
  }
}

// ====== Subir logo ======
async function subirLogo(file) {
  if (file.size > 2 * 1024 * 1024) {
    showToast('El archivo supera los 2MB permitidos', 'error');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('logo', file);

    const res = await fetch('/api/tenant/settings/logo', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error('Error subiendo logo');
    const data = await res.json();

    // Actualizar preview con URL presignada
    const logoPreview = document.getElementById('logoPreview');
    const logoPlaceholder = document.getElementById('logoPlaceholder');
    logoPreview.src = data.logoUrl;  // URL presignada de S3
    logoPreview.classList.remove('hidden');
    logoPlaceholder.classList.add('hidden');
    document.getElementById('btnEliminarLogo').classList.remove('hidden');

    showToast('Logo actualizado correctamente');
  } catch (err) {
    console.error('[configuracion] Error subiendo logo:', err);
    showToast('Error subiendo logo', 'error');
  }
}

// ====== Eliminar logo ======
async function eliminarLogo() {
  if (!confirm('¿Eliminar el logo?')) return;

  try {
    const res = await fetch('/api/tenant/settings/logo', { method: 'DELETE' });
    if (!res.ok) throw new Error('Error eliminando logo');

    document.getElementById('logoPreview').classList.add('hidden');
    document.getElementById('logoPlaceholder').classList.remove('hidden');
    document.getElementById('btnEliminarLogo').classList.add('hidden');

    showToast('Logo eliminado');
  } catch (err) {
    console.error('[configuracion] Error eliminando logo:', err);
    showToast('Error eliminando logo', 'error');
  }
}

// ====== Init ======
window.addEventListener('DOMContentLoaded', async () => {
  initTopbar();
  document.getElementById('anio').textContent = new Date().getFullYear();

  await cargarConfiguracion();

  // Eventos
  document.getElementById('btnGuardar').addEventListener('click', guardarConfiguracion);

  document.getElementById('logoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) subirLogo(file);
    e.target.value = ''; // reset para permitir re-selección
  });

  document.getElementById('btnEliminarLogo').addEventListener('click', eliminarLogo);
});
