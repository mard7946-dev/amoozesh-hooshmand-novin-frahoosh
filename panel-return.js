/* Shared, same-origin return path and classroom-session relay for Frahoosh pages. */
(function () {
  const scriptUrl = document.currentScript && document.currentScript.src;
  const portalBase = scriptUrl ? new URL('.', scriptUrl) : new URL('.', location.href);

  // Keep a session-bearing page available as a relay when the portal itself
  // is no longer the active tab (for example, schedule -> realtime navigation).
  // The access token is sent only in response to an explicit same-origin
  // BroadcastChannel request; it is never put in a URL or localStorage.
  if ('BroadcastChannel' in window) {
    const classroomSessionChannel = new BroadcastChannel('frahoosh-classroom-session-v1');
    classroomSessionChannel.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type !== 'classroom-session-request' || typeof message.requestId !== 'string') return;
      const accessToken = sessionStorage.getItem('frahoosh_novin_access_token') || '';
      if (!accessToken) return;
      const activeRole = sessionStorage.getItem('frahoosh_novin_role') || '';
      classroomSessionChannel.postMessage({
        type: 'classroom-session-response',
        requestId: message.requestId,
        access_token: accessToken,
        active_role: activeRole
      });
    });
    window.addEventListener('pagehide', () => classroomSessionChannel.close(), { once: true });
  }

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