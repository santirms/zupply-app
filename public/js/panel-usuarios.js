// /public/js/panel-usuarios.js

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const API_BASE = '/api/users'; // <- ahora la API está namespaced

const ui = {
  role: $('#role'),
  // admin/coordinador
  email: $('#email'), password: $('#password'),
  // coordinador (si usás campos separados; si no, podés ignorarlos)
  emailC: $('#emailC'), passwordC: $('#passwordC'),
  // chofer
  choferNombre: $('#chofer_nombre'),
  choferTelefono: $('#chofer_telefono'),
  choferFields: $('#choferFields'),
  // cliente
  clienteFields: $('#clienteFields'),
  emailCli: $('#emailCli'),
  passwordCli: $('#passwordCli'),
  senderIds: $('#senderIds'),
  clienteId: $('#clienteId'),
  // otros
  adminFields: $('#adminFields'),
  coorFields: $('#coorFields'),
  crearBtn: $('#crear'),
  msg: $('#msg'),
  tblBody: document.querySelector('#tbl tbody')
};

function show(section, on) {
  if (!section) return;
  section.classList.toggle('hidden', !on);
}

function onRoleChange() {
  const r = ui.role.value;
  // Mostrar/ocultar secciones según rol
  show(ui.adminFields, r === 'admin');        // si usás los campos admin
  show(ui.coorFields, r === 'coordinador');   // si usás los campos coordinador
  show(ui.choferFields, r === 'chofer');
  show(ui.clienteFields, r === 'cliente');
}
ui.role.addEventListener('change', onRoleChange);
onRoleChange();

// Helpers
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  // Si no es JSON, evitamos el crash en parseo (404/HTML login, etc.)
  if (!ct.includes('application/json')) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status} – respuesta no JSON: ${text.slice(0, 120)}...`);
  }
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function loadUsers() {
  try {
    const data = await fetchJSON(`${API_BASE}`);
    const { users = [] } = data;
    ui.tblBody.innerHTML = users.map(u => `
      <tr>
        <td class="px-3 py-2">${u.email || '-'}</td>
        <td class="px-3 py-2">${u.username || '-'}</td>
        <td class="px-3 py-2">${u.role}</td>
        <td class="px-3 py-2">${u.is_active ? 'sí' : 'no'}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error cargando usuarios:', e);
    ui.tblBody.innerHTML = `<tr><td class="px-3 py-2 text-red-600" colspan="4">No se pudo cargar la lista (${e.message}).</td></tr>`;
  }
}

function parseSenderIds(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function crearUsuario() {
  ui.msg.textContent = 'Creando...';
  ui.msg.classList.remove('text-red-600');
  try {
    const role = ui.role.value;

    // payloads por rol
    if (role === 'cliente') {
      const body = {
        email: ui.emailCli.value || undefined,
        password: ui.passwordCli.value || undefined,
        sender_ids: parseSenderIds(ui.senderIds.value),
        cliente_id: ui.clienteId.value || undefined
      };
      await fetchJSON(`${API_BASE}/create-client`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
    } else if (role === 'chofer') {
      const body = {
        role,
        chofer_nombre: ui.choferNombre.value,
        chofer_telefono: ui.choferTelefono.value
        // password: si querés, podrías pasarlo, pero en tu controller
        // ya usa tel o random como fallback
      };
      await fetchJSON(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
    } else if (role === 'admin' || role === 'coordinador') {
      // Si realmente usás campos separados por rol, tomalos del bloque correcto
      const email = (role === 'admin') ? ui.email.value : ui.emailC.value;
      const password = (role === 'admin') ? ui.password.value : ui.passwordC.value;
      const body = { role, email, password };
      await fetchJSON(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      throw new Error('Rol no soportado');
    }

    ui.msg.textContent = '✅ Usuario creado';
    await loadUsers();
  } catch (e) {
    console.error('Error creando usuario:', e);
    ui.msg.textContent = `❌ ${e.message}`;
    ui.msg.classList.add('text-red-600');
  }
}

ui.crearBtn.addEventListener('click', (e) => {
  e.preventDefault();
  crearUsuario();
});

// utilidad UI ya usada en otras páginas
(function userMenuAndTheme(){
  try {
    const btn=document.getElementById('userBtn'),menu=document.getElementById('userMenu'),wrap=document.getElementById('userMenuWrap');
    btn?.addEventListener('click',()=>menu.classList.toggle('hidden'));
    document.addEventListener('click',(e)=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
    document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{
      try{ await fetch('/auth/logout',{method:'POST'}) }catch{}
      localStorage.removeItem('zpl_auth'); location.href='/auth/login';
    });

    fetch('/me',{cache:'no-store'}).then(r=>r.json()).then(me=>{
      document.getElementById('username').textContent=(me.name||me.username||me.email||'Usuario');
    }).catch(()=>location.href='/auth/login');

    const order=['light','dark','system']; const btnTheme=document.getElementById('themeBtn');
    const apply=m=>{const prefers=matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',m==='dark'||(m==='system'&&prefers));localStorage.setItem('zpl_theme',m);btnTheme.textContent='Tema: '+(m==='system'?'auto':m);};
    apply(localStorage.getItem('zpl_theme')||'system');
    btnTheme?.addEventListener('click',()=>{const c=localStorage.getItem('zpl_theme')||'system';apply(order[(order.indexOf(c)+1)%order.length]);});
  } catch {}
})();

// carga inicial de la lista
loadUsers();
