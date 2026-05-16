/* ============================================================
   LOGGER.JS — Shared activity logger
   Load this AFTER session.js, just before </body>.
   Saves logs to MongoDB through /api/activity-logs so logs are
   visible to every logged-in user. Uses localStorage as fallback.
   ============================================================ */

const Logger = {

  allowedKeywords: [
    'added', 'created', 'registered', 'generated', 'viewed', 'read',
    'updated', 'edited', 'approved', 'deleted', 'rejected',
    'logged in', 'logged out', 'uploaded', 'downloaded', 'moved', 'renamed', 'pinned', 'unpinned'
  ],

  isAllowed(action = '') {
    const value = String(action).toLowerCase().trim();
    if (value === 'viewed page' || value.includes('page view')) return false;
    return Logger.allowedKeywords.some(keyword => value.includes(keyword));
  },

  /* ── WRITE A LOG ENTRY ──────────────────────────────────── */
  async log(action, details = '', module = 'System') {
    try {
      if (!Logger.isAllowed(action)) return;
      const user = (typeof CURRENT_USER !== 'undefined')
        ? CURRENT_USER
        : { name: 'Unknown User', role: 'Staff' };

      const entry = {
        id: Date.now(),
        timestamp: new Date().toLocaleString('en-PH', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true,
        }),
        createdAt: new Date().toISOString(),
        user: user.name || 'Unknown User',
        role: user.role || 'Staff',
        action,
        details,
        module,
      };

      // Save locally first so the page still works even if offline/server is unavailable.
      Logger.saveLocal(entry);

      // Save to MongoDB so all users can see the same activity logs.
      const response = await fetch('/api/activity-logs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          details,
          module,
          path: window.location.pathname
        })
      });

      if (!response.ok) {
        console.warn('[Logger] Server log failed, local fallback kept.');
      }
    } catch (e) {
      console.warn('Logger.log failed:', e);
    }
  },

  saveLocal(entry) {
    try {
      const logs = Logger.getAll();
      logs.unshift(entry);
      if (logs.length > 500) logs.splice(500);
      localStorage.setItem('activityLogs', JSON.stringify(logs));
    } catch (e) {
      console.warn('Logger.saveLocal failed:', e);
    }
  },

  /* ── READ LOCAL FALLBACK LOGS ───────────────────────────── */
  getAll() {
    try {
      return JSON.parse(localStorage.getItem('activityLogs')) || [];
    } catch {
      return [];
    }
  },

  /* ── READ SHARED SERVER LOGS ────────────────────────────── */
  async getAllAsync() {
    try {
      const response = await fetch('/api/activity-logs?limit=500', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await response.json();

      if (response.ok && data.success && Array.isArray(data.logs)) {
        localStorage.setItem('activityLogs', JSON.stringify(data.logs));
        return data.logs;
      }
    } catch (e) {
      console.warn('[Logger] Could not load server logs, using local fallback:', e);
    }

    return Logger.getAll();
  },

  /* ── CLEAR LOCAL FALLBACK LOGS ONLY ─────────────────────── */
  clear() {
    try {
      localStorage.removeItem('activityLogs');
    } catch (e) {
      console.warn('Logger.clear failed:', e);
    }
  },

  /* ── PAGE VIEW TRACKING ─────────────────────────────────── */
  logPageView() {
    try {
      const path = window.location.pathname;
      const key = `lastPageLog:${path}`;
      const last = Number(sessionStorage.getItem(key) || 0);

      // Avoid duplicate page-view logs during reload/auto-refresh.
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem(key, Date.now().toString());

      const file = path.split('/').pop() || 'overview.html';
      const moduleMap = {
        'overview.html': 'Overview',
        'residents.html': 'Residents',
        'documents.html': 'Documents',
        'doc-form.html': 'Documents',
        'certification.html': 'Documents',
        'clearance.html': 'Documents',
        'indigency.html': 'Documents',
        'summons.html': 'Documents',
        'complaint.html': 'Documents',
        'file-manager.html': 'FileManager',
        'activity-logs.html': 'System',
        'backup.html': 'Backup',
        'settings.html': 'Settings'
      };

      const module = moduleMap[file] || 'System';
      const pageName = document.title ? document.title.replace('— Barangay 59-A', '').trim() : file;
      Logger.log('Viewed Page', pageName, module);
    } catch (e) {
      console.warn('Logger.logPageView failed:', e);
    }
  }
};

// Page visits are intentionally not auto-logged.
// Activity Logs should show only CRUD actions plus user login/logout.
