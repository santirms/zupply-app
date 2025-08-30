// public/js/role-gate.js
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const r = await fetch('/auth/me', { credentials: 'same-origin' });
    const s = await r.json();
    const role = s.authenticated ? (s.user?.role || 'guest') : 'guest';

    document.querySelectorAll('a[data-roles],button[data-roles]').forEach(el => {
      const roles = (el.getAttribute('data-roles') || '').split(',').map(x => x.trim());
      if (!roles.includes(role)) el.remove();
    });
  } catch {
    document.querySelectorAll('a[data-roles],button[data-roles]').forEach(el => el.remove());
  }
});
