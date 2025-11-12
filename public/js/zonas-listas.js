// public/js/zonas-listas.js

// ===== Helpers / Constantes =====
const qs            = s => document.querySelector(s);
const qsa           = s => Array.from(document.querySelectorAll(s));
const ZONA_API      = '/api/zonas';
const LISTA_API     = '/api/listas-de-precios';
const PARTIDOS_API  = '/api/partidos';

const formZona      = () => qs('#formZona');
const formLista     = () => qs('#formLista');
const partidosSelect= () => qs('#partidosSelect');
const zonasLista    = () => qs('#zonasLista');
const zonasPrecios  = () => qs('#zonasPrecios');
const listasPrecios = () => qs('#listasPrecios');

let zonas = [];

// ===== Tabs (estilo ámbar suave) =====
function activarBtnTab(btn, active) {
  const activeCls   = ['border-amber-600','text-amber-700','bg-amber-50','dark:text-amber-300','dark:border-amber-500/50','dark:bg-amber-500/10'];
  const inactiveCls = ['border-slate-300','text-slate-700','bg-white','hover:bg-slate-50','dark:border-white/10','dark:text-slate-100','dark:bg-white/10','dark:hover:bg-white/15'];
  btn.classList.remove(...active ? inactiveCls : activeCls);
  btn.classList.add(...active ? activeCls : inactiveCls);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function mostrarTab(tab, btn) {
  qsa('.tab').forEach(el => el.classList.add('hidden'));
  const panel = qs(`#tab-${tab}`);
  if (panel) panel.classList.remove('hidden');

  const allBtns = qsa('.tab-btn');
  allBtns.forEach(b => activarBtnTab(b, b === btn));
}

// ===== Carga de partidos =====
async function cargarPartidos() {
  try {
    const res = await fetch(PARTIDOS_API, { cache:'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    const sel = partidosSelect();
    sel.innerHTML = '';
    data.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.nombre;
      opt.textContent = item.nombre;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Error cargando partidos:', err);
  }
}

// ===== Carga de zonas + inputs de precios =====
function cargarZonas() {
  fetch(ZONA_API, { cache:'no-store' })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(data => {
      zonas = data || [];
      // Panel de zonas
      const wrapZ = zonasLista();
      wrapZ.innerHTML = '';
      zonas.forEach(z => {
        const div = document.createElement('div');
        div.className = 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 rounded-2xl shadow-sm';
        div.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold">${z.nombre}</div>
              <div class="text-sm opacity-70">Partidos: ${Array.isArray(z.partidos)? z.partidos.join(', ') : '—'}</div>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <button onclick="editarZona('${z._id}')" class="px-3 py-1 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10">Editar</button>
              <button onclick="eliminarZona('${z._id}')" class="px-3 py-1 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">Eliminar</button>
            </div>
          </div>
        `;
        wrapZ.appendChild(div);
      });

      // Inputs para Lista de precios
      const wrapP = zonasPrecios();
      wrapP.innerHTML = '';
      zonas.forEach(z => {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2';
        div.innerHTML = `
          <input type="checkbox" id="check-${z._id}" class="accent-amber-600" />
          <label for="check-${z._id}" class="w-40">${z.nombre}</label>
          <input type="number" name="${z._id}" id="input-${z._id}"
                 class="flex-1 p-2 rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-transparent"
                 placeholder="Precio" disabled />
        `;
        wrapP.appendChild(div);
        const chk = qs(`#check-${z._id}`);
        const inp = qs(`#input-${z._id}`);
        chk.addEventListener('change', () => {
          inp.disabled = !chk.checked;
          if (!chk.checked) inp.value = '';
        });
      });
    })
    .catch(err => console.error('Error al cargar zonas:', err));
}

// ===== Crear zona =====
function bindFormZona() {
  const f = formZona();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const nombre   = f.nombre.value.trim();
    const partidos = Array.from(partidosSelect().selectedOptions).map(o=>o.value);
    fetch(ZONA_API, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ nombre, partidos })
    })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(() => { f.reset(); cargarZonas(); })
    .catch(err => { console.error('Error creando zona:', err); alert('No se pudo guardar la zona.'); });
  });
}

// ===== Eliminar zona =====
function eliminarZona(id) {
  if (!confirm('¿Eliminar esta zona?')) return;
  fetch(`${ZONA_API}/${id}`, { method: 'DELETE' })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.text(); })
    .then(() => cargarZonas())
    .catch(err => console.error('Error eliminando zona:', err));
}
window.eliminarZona = eliminarZona;

// ===== Editar zona (solo nombre) =====
function editarZona(id) {
  const nuevo = prompt('Nuevo nombre de zona:');
  if (!nuevo) return;
  fetch(`${ZONA_API}/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre: nuevo })
  })
  .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
  .then(() => cargarZonas())
  .catch(err => console.error('Error editando zona:', err));
}
window.editarZona = editarZona;

// ===== Crear lista =====
function bindFormLista() {
  const f = formLista();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const nombre = f.nombre.value.trim();
    const zonasSel = zonas
      .map(z => {
        const el = qs(`input[name="${z._id}"]`);
        const v = el && el.value ? parseFloat(el.value) : null;
        return v ? { zona: z._id, precio: v } : null;
      })
      .filter(Boolean);

    fetch(LISTA_API, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ nombre, zonas: zonasSel })
    })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(() => { f.reset(); cargarZonas(); cargarListas(); })
    .catch(err => { console.error('Error creando lista:', err); alert('No se pudo guardar la lista.'); });
  });
}

// ===== Cargar listas =====
function cargarListas() {
  fetch(LISTA_API, { cache:'no-store' })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(data => {
      const wrap = listasPrecios();
      wrap.innerHTML = '';
      (data || []).forEach(lista => {
        const precios = (lista.zonas||[])
          .map(zp => {
            const nom = typeof zp.zona === 'object' ? (zp.zona.nombre || '—') : '—';
            return `<div class="flex items-center justify-between gap-2"><span>${nom}</span><span class="font-medium">$ ${zp.precio}</span></div>`;
          })
          .join('');
        const div = document.createElement('div');
        div.className = 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 rounded-2xl shadow-sm';
        div.innerHTML = `
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold">${lista.nombre}</div>
              <div class="mt-2 grid gap-1 text-sm">${precios || '<span class="opacity-70">— sin precios —</span>'}</div>
            </div>
            <div class="flex items-center gap-3 text-sm">
              <button onclick="editarLista('${lista._id}', '${lista.nombre.replace(/'/g, "\\'")}')" class="px-3 py-1 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10">Editar</button>
              <button onclick="eliminarLista('${lista._id}')" class="px-3 py-1 rounded-lg border border-rose-400/30 text-rose-600 dark:text-rose-300 hover:bg-rose-400/10">Eliminar</button>
            </div>
          </div>
        `;
        wrap.appendChild(div);
      });
    })
    .catch(err => console.error('Error al cargar listas:', err));
}

// ===== Editar lista (solo nombre) =====
function editarLista(id, actual) {
  const nuevo = prompt('Nuevo nombre de la lista:', actual || '');
  if (!nuevo) return;
  fetch(`${LISTA_API}/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ nombre: nuevo })
  })
  .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
  .then(() => cargarListas())
  .catch(err => console.error('Error editando lista:', err));
}
window.editarLista = editarLista;

// ===== Eliminar lista =====
function eliminarLista(id) {
  if (!confirm('¿Eliminar esta lista?')) return;
  fetch(`${LISTA_API}/${id}`, { method: 'DELETE' })
    .then(res => { if (!res.ok) throw new Error(res.status); return res.text(); })
    .then(() => cargarListas())
    .catch(err => console.error('Error eliminando lista:', err));
}
window.eliminarLista = eliminarLista;

// ===== Topbar: user + tema =====
function initTopbar(){
  // Usuario / auth
  (function userMenu(){
    const btn  = qs('#userBtn');
    const menu = qs('#userMenu');
    const wrap = qs('#userMenuWrap');
    if (btn && menu && wrap) {
      btn.addEventListener('click', ()=> menu.classList.toggle('hidden'));
      document.addEventListener('click', (e)=>{ if (!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    const logoutBtn = qs('#logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async ()=>{
        try { await fetch('/auth/logout', { method:'POST' }); } catch {}
        try { localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); } catch {}
        location.href = '/auth/login';
      });
    }

    // Función para obtener la ruta de inicio según el rol
    function getHomeRoute(role) {
      switch(role) {
        case 'cliente':
          return '/client-panel.html';
        case 'admin':
        case 'coordinador':
          return '/index.html';
        case 'chofer':
          return '/mis-envios.html';
        default:
          return '/';
      }
    }

    fetch('/me', { cache:'no-store' })
      .then(r => { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(me => {
        const name = me.name || me.username || me.email || 'Usuario';
        const u = qs('#username'); if (u) u.textContent = name;
        try { localStorage.setItem('zpl_username', name); } catch {}

        // Configurar redirección del logo según rol
        const userRole = me.role || 'admin';
        const homeRoute = getHomeRoute(userRole);

        const logoLink = document.getElementById('logoLink');
        const homeLink = document.getElementById('homeLink');

        // Actualizar href del logo y link de inicio
        if (logoLink) {
          logoLink.href = homeRoute;
        }
        if (homeLink) {
          homeLink.href = homeRoute;
        }
      })
      .catch(()=> location.href='/auth/login');
  })();

  // Tema
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
    btn.addEventListener('click', ()=>{
      const current = localStorage.getItem('zpl_theme') || 'system';
      const next = order[(order.indexOf(current)+1)%order.length];
      apply(next);
    });
  })();
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', () => {
  initTopbar();
  const fz = formZona();  if (fz) bindFormZona();
  const fl = formLista(); if (fl) bindFormLista();
  cargarPartidos();
  cargarZonas();
  cargarListas();
});
