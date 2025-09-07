// public/js/panel-usuarios.js
const $ = (s) => document.querySelector(s);

// ========== Topbar (usuario + tema) ==========
(function initTopbar(){
  // Usuario
  (function(){
    const btn=$('#userBtn'), menu=$('#userMenu'), wrap=$('#userMenuWrap');
    if(btn&&menu&&wrap){
      btn.addEventListener('click', ()=>menu.classList.toggle('hidden'));
      document.addEventListener('click', e=>{ if(!wrap.contains(e.target)) menu.classList.add('hidden'); });
    }
    $('#logoutBtn')?.addEventListener('click', async ()=>{
      try{ await fetch('/auth/logout',{method:'POST'}) }catch{}
      try{ localStorage.removeItem('zpl_auth'); localStorage.removeItem('zpl_username'); }catch{}
      location.href='/auth/login';
    });

    fetch('/me',{cache:'no-store'})
      .then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(me=>{ const n=me.name||me.username||me.email||'Usuario'; const u=$('#username'); if(u) u.textContent=n; })
      .catch(()=> location.href='/auth/login');
  })();

  // Tema
  (function(){
    const order=['light','dark','system'];
    const btn=$('#themeBtn');
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

  const y=document.getElementById('anio'); if(y) y.textContent=new Date().getFullYear();
})();

// ========== UI lógica del formulario ==========
const roleSel = document.getElementById('role');
const adminFields  = document.getElementById('adminFields');
const coorFields   = document.getElementById('coorFields');
const choferFields = document.getElementById('choferFields');

const showByRole = (role)=>{
  adminFields.classList.toggle('hidden', role!=='admin');
  coorFields.classList.toggle('hidden', role!=='coordinador');
  choferFields.classList.toggle('hidden', role!=='chofer');
};

roleSel.addEventListener('change', ()=> showByRole(roleSel.value));
showByRole(roleSel.value);

// ========== Carga de usuarios ==========
async function load() {
  const r = await fetch('/users', { cache:'no-store' });
  const { users=[] } = await r.json();
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = users.map(u => `
    <tr class="hover:bg-slate-50 dark:hover:bg-white/10">
      <td class="px-3 py-2">${u._id}</td>
      <td class="px-3 py-2">${u.email || ''}</td>
      <td class="px-3 py-2">${u.username || ''}</td>
      <td class="px-3 py-2">${u.role}</td>
      <td class="px-3 py-2">${u.is_active ? '✔' : '✖'}</td>
    </tr>
  `).join('');
}
load();

// ========== Crear ==========
document.getElementById('crear').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  msg.textContent = '';
  try {
    const role = roleSel.value;
    let body = { role };

    if (role === 'admin') {
      body.email = document.getElementById('email').value.trim();
      body.password = document.getElementById('password').value;
    } else if (role === 'coordinador') {
      body.email = document.getElementById('emailC').value.trim();
      body.password = document.getElementById('passwordC').value;
    } else {
      body.chofer_nombre   = document.getElementById('chofer_nombre').value.trim();
      body.chofer_telefono = document.getElementById('chofer_telefono').value.trim();
    }

    const r = await fetch('/users', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error al crear');

    msg.textContent = role==='chofer'
      ? `Chofer creado. Usuario: ${data.username || '(ver en listado)'}`
      : 'Usuario creado.';
    load();
  } catch(e) {
    msg.textContent = e.message;
  }
});
