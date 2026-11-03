/* Frahoosh: return to the authenticated user's role menu.
 * This is navigation only; it never clears the authentication session. */
(function () {
  'use strict';
  const TOKEN_KEY = 'frahoosh_novin_access_token';
  const ROLE_KEY = 'frahoosh_novin_role';
  const allowedRoles = new Set(['manager','deputy','teacher','student','parent','counselor']);
  function getRole() {
    const role = String(sessionStorage.getItem(ROLE_KEY) || '').trim().toLowerCase();
    return allowedRoles.has(role) ? role : '';
  }
  function getPortalPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    const depth = Math.max(0, parts.length - 1);
    return '../'.repeat(depth) + 'portal.html?step=panel&role=' + encodeURIComponent(getRole());
  }
  function mount() {
    if (document.getElementById('frahooshBackToPanelMenu')) return;
    const token = sessionStorage.getItem(TOKEN_KEY);
    const role = getRole();
    if (!token || !role) return;
    const button = document.createElement('button');
    button.id = 'frahooshBackToPanelMenu';
    button.type = 'button';
    button.textContent = '↩ بازگشت به پنل اصلی';
    button.setAttribute('aria-label', 'بازگشت به پنل اصلی');
    button.style.cssText = 'position:fixed;top:12px;right:12px;z-index:100000;min-height:42px;padding:9px 14px;border:1px solid #16a34a;border-radius:12px;background:#102a3c;color:#fff;font:600 14px Tahoma,Arial,sans-serif;box-shadow:0 3px 14px #0004;cursor:pointer';
    button.addEventListener('click', function () {
      if (!sessionStorage.getItem(TOKEN_KEY) || !getRole()) {
        alert('نشست معتبر پیدا نشد؛ لطفاً دوباره وارد پنل شوید.');
        return;
      }
      location.href = getPortalPath();
    });
    document.body.appendChild(button);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();