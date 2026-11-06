/* Shared, same-origin return path for every Frahoosh panel page. */
(function () {
  const scriptUrl = document.currentScript && document.currentScript.src;
  const portalBase = scriptUrl ? new URL('.', scriptUrl) : new URL('.', location.href);
  window.frahooshReturnToPanel = function (fallbackRole) {
    const storedRole = sessionStorage.getItem('frahoosh_novin_role') || '';
    const queryRole = new URLSearchParams(location.search).get('role') || '';
    const role = storedRole || fallbackRole || queryRole || 'teacher';
    const target = new URL('portal.html', portalBase);
    target.searchParams.set('step', 'panel');
    target.searchParams.set('role', role);
    location.assign(target.href);
  };
})();