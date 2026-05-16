/* ============================================================
   SESSION-MANAGER.JS — Client-side session management
   - Checks for active sessions
   - Tracks user activity
   - Resets idle timeout on activity
   - Warns before logout
   - Handles server disconnect
   Include this BEFORE logger.js on all dashboard pages
   ============================================================ */

const SESSION_CONFIG = {
  CHECK_INTERVAL: 60000, // Check session every 60 seconds
  ACTIVITY_TIMEOUT: 10 * 60 * 1000, // Force logout after 10 minutes of inactivity
  WARNING_BEFORE_LOGOUT: 1 * 60 * 1000, // Show warning 1 minute before logout
  BUMP_INTERVAL: 60 * 1000, // Send activity bump at most once per minute during active use
  INACTIVITY_EVENTS: ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click', 'wheel'],
  MAX_CONSECUTIVE_FAILURES: 3 // Allow 3 consecutive check failures before logout
};
window.SESSION_CONFIG = SESSION_CONFIG;

class SessionManager {
  constructor() {
    this.lastActivityTime = Date.now();
    this.warningShown = false;
    this.isLoggedIn = false;
    this.sessionCheckInterval = null;
    this.activityTimeout = null;
    this.logoutTimeout = null;
    this.warningCountdownInterval = null;
    this.lastBumpTime = 0;
    this.consecutiveCheckFailures = 0; // Track failed session checks
    this.initialized = false;
  }

  // Initialize session manager
  async init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    console.log('[SessionManager] Initializing...');
    
    // Set cache-busting headers to prevent back-button access
    const meta1 = document.createElement('meta');
    meta1.httpEquiv = 'Cache-Control';
    meta1.content = 'no-store, no-cache, must-revalidate, max-age=0';
    document.head.appendChild(meta1);
    
    const meta2 = document.createElement('meta');
    meta2.httpEquiv = 'Pragma';
    meta2.content = 'no-cache';
    document.head.appendChild(meta2);
    
    const meta3 = document.createElement('meta');
    meta3.httpEquiv = 'Expires';
    meta3.content = '0';
    document.head.appendChild(meta3);
    
    // Prevent back-button from accessing this page after logout
    this.setupHistoryBlocker();
    
    // Re-validate session when page is shown (back button, tab switch, etc.)
    window.addEventListener('pageshow', () => {
      console.log('[SessionManager] Page shown/focused - validating session');
      this.validateAndRedirectIfLoggedOut();
    });
    
    // Also validate on focus (in case user was logged out in another tab)
    window.addEventListener('focus', () => {
      if (this.isLoggedIn) {
        this.validateAndRedirectIfLoggedOut();
      }
    });
    
    // Check if we have an active session
    const hasSession = await this.checkSession();
    
    if (hasSession) {
      console.log('[SessionManager] Active session found');
      this.isLoggedIn = true;
      this.consecutiveCheckFailures = 0; // Reset failures on successful check
      this.setupActivityTracking();
      // Refresh the server-side session immediately whenever a module/page is opened.
      // This prevents active users from being logged out 10 minutes after login while moving between modules.
      await this.bumpSession();
      this.startSessionCheck();
      this.startIdleTimeout();
    } else {
      console.log('[SessionManager] No active session, redirecting to login');
      this.redirectToLogin('Session expired');
    }
  }

  updateTimeoutFromServer(data) {
    const minutes = Number(data?.autoLogoutMinutes);
    if (minutes && minutes > 0) {
      SESSION_CONFIG.ACTIVITY_TIMEOUT = minutes * 60 * 1000;
      SESSION_CONFIG.WARNING_BEFORE_LOGOUT = Math.min(60 * 1000, Math.max(15 * 1000, Math.floor(SESSION_CONFIG.ACTIVITY_TIMEOUT * 0.2)));
      try {
        sessionStorage.setItem('autoLogoutMinutes', String(minutes));
      } catch (e) {
        console.warn('Could not store auto-logout timeout:', e);
      }
    } else if (data?.sessionExpiry) {
      SESSION_CONFIG.ACTIVITY_TIMEOUT = Number(data.sessionExpiry) * 1000;
      SESSION_CONFIG.WARNING_BEFORE_LOGOUT = Math.min(60 * 1000, Math.max(15 * 1000, Math.floor(SESSION_CONFIG.ACTIVITY_TIMEOUT * 0.2)));
      try {
        const fallbackMinutes = Math.max(1, Math.round(SESSION_CONFIG.ACTIVITY_TIMEOUT / 60000));
        sessionStorage.setItem('autoLogoutMinutes', String(fallbackMinutes));
      } catch (e) {
        console.warn('Could not store auto-logout timeout:', e);
      }
    }
  }

  // Validate session and redirect if logged out (for back-button prevention)
  async validateAndRedirectIfLoggedOut() {
    try {
      const response = await fetch('/api/session/check', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });

      const data = await response.json();
      
      this.updateTimeoutFromServer(data);
      if (!data.success || !data.user) {
        console.log('[SessionManager] Session invalid - user was logged out, redirecting');
        this.isLoggedIn = false;
        this.redirectToLogin('Session expired');
      }
    } catch (error) {
      console.error('[SessionManager] Error validating session:', error);
      this.isLoggedIn = false;
      this.redirectToLogin('Session expired');
    }
  }

  // Setup history manipulation to prevent back-button access
  setupHistoryBlocker() {
    // Push a new history state so back button goes to previous page instead of staying here after logout
    window.history.pushState(null, null, window.location.href);
    
    // Intercept back button
    window.addEventListener('popstate', (e) => {
      console.log('[SessionManager] Back button pressed - checking session validity');
      window.history.pushState(null, null, window.location.href);
      
      // Validate session when user tries to go back
      this.validateAndRedirectIfLoggedOut();
    });
  }

  // Check if user has an active session
  async checkSession() {
    try {
      const response = await fetch('/api/session/check', {
        method: 'GET',
        credentials: 'include'
      });

      const data = await response.json();
      
      if (data.success && data.user) {
        this.updateTimeoutFromServer(data);
        console.log('[SessionManager] Session active for:', data.user.firstName, data.user.lastName);
        this.currentUser = data.user;
        this.consecutiveCheckFailures = 0; // Reset on success
        return true;
      } else {
        console.log('[SessionManager] Session check failed:', data.message);
        this.consecutiveCheckFailures++;
        return false;
      }
    } catch (error) {
      console.error('[SessionManager] Error checking session:', error);
      this.consecutiveCheckFailures++;
      return false;
    }
  }

  // Setup activity tracking
  setupActivityTracking() {
    console.log('[SessionManager] Setting up activity tracking');
    
    SESSION_CONFIG.INACTIVITY_EVENTS.forEach(event => {
      document.addEventListener(event, () => this.recordActivity(), true);
    });

    // Treat module/page changes as activity too.
    // sendBeacon/keepalive lets the activity reach the server even while the browser is leaving the page.
    const bumpBeforeLeaving = () => this.bumpSession(true);
    window.addEventListener('beforeunload', bumpBeforeLeaving);
    window.addEventListener('pagehide', bumpBeforeLeaving);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.bumpSession(true);
      }
    });
  }

  // Record user activity
  recordActivity() {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTime;
    
    // Only reset idle timer if enough time has passed
    if (timeSinceLastActivity > 5000) {
      console.log('[SessionManager] Activity detected, resetting idle timer');
      this.lastActivityTime = now;
      this.warningShown = false; // Reset warning
      
      // Clear existing warning/logout timers
      if (this.activityTimeout) {
        clearTimeout(this.activityTimeout);
      }
      if (this.logoutTimeout) {
        clearTimeout(this.logoutTimeout);
      }
      if (this.warningCountdownInterval) {
        clearInterval(this.warningCountdownInterval);
        this.warningCountdownInterval = null;
      }

      // Remove idle warning if it is currently displayed
      const warningModal = document.getElementById('idleWarningModal');
      if (warningModal) {
        warningModal.remove();
      }
      
      // Restart the configured idle timeout
      this.startIdleTimeout();
      
      // Bump server session, but only once per configured interval
      if (now - this.lastBumpTime >= SESSION_CONFIG.BUMP_INTERVAL) {
        this.bumpSession();
      }
    }
  }

  // Bump session to reset server-side idle timeout
  async bumpSession(useBeacon = false) {
    try {
      this.lastBumpTime = Date.now();

      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/session/activity', new Blob(['{}'], { type: 'application/json' }));
        return;
      }

      const response = await fetch('/api/session/activity', {
        method: 'POST',
        credentials: 'include',
        keepalive: useBeacon,
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{}'
      });

      const data = await response.json();
      if (data.success) {
        this.updateTimeoutFromServer(data);
        console.log('[SessionManager] Session bumped successfully');
      }
    } catch (error) {
      console.error('[SessionManager] Error bumping session:', error);
    }
  }

  // Start session validity check
  startSessionCheck() {
    this.sessionCheckInterval = setInterval(async () => {
      const hasSession = await this.checkSession();
      
      // Only logout if we have multiple consecutive failures (implies real problem)
      if (!hasSession && this.consecutiveCheckFailures >= SESSION_CONFIG.MAX_CONSECUTIVE_FAILURES && this.isLoggedIn) {
        console.log('[SessionManager] Session lost after', this.consecutiveCheckFailures, 'failures!');
        this.isLoggedIn = false;
        this.logout('Your session has expired');
      }
    }, SESSION_CONFIG.CHECK_INTERVAL);
  }

  // Start idle timeout warning and logout
  startIdleTimeout() {
    const warningDelay = SESSION_CONFIG.ACTIVITY_TIMEOUT - SESSION_CONFIG.WARNING_BEFORE_LOGOUT;

    // Clear existing timers first to prevent old timers from forcing logout early
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }
    if (this.logoutTimeout) {
      clearTimeout(this.logoutTimeout);
    }
    if (this.warningCountdownInterval) {
      clearInterval(this.warningCountdownInterval);
      this.warningCountdownInterval = null;
    }

    // Show warning before the configured timeout
    this.activityTimeout = setTimeout(() => {
      if (!this.warningShown) {
        this.showIdleWarning();
        this.warningShown = true;
      }
    }, Math.max(0, warningDelay));

    // Force logout after configured inactivity timeout
    this.logoutTimeout = setTimeout(() => {
      if (this.isLoggedIn) {
        console.log('[SessionManager] Idle timeout reached');
        this.logout('Logged out due to inactivity');
      }
    }, SESSION_CONFIG.ACTIVITY_TIMEOUT);
  }

  // Show idle warning to user
  showIdleWarning() {
    console.log('[SessionManager] Showing idle warning');

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => this.showIdleWarning(), { once: true });
      return;
    }

    // Check if warning already exists
    if (document.getElementById('idleWarningModal')) {
      return;
    }

    const remainingSeconds = Math.max(1, Math.ceil((this.lastActivityTime + SESSION_CONFIG.ACTIVITY_TIMEOUT - Date.now()) / 1000));

    const warningHTML = `
      <div id="idleWarningModal" role="dialog" aria-modal="true" aria-labelledby="idleWarningTitle" style="
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: rgba(0, 0, 0, 0.72) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      ">
        <div style="
          background: #ffffff !important;
          border-radius: 14px !important;
          padding: 32px !important;
          width: min(420px, calc(100vw - 32px)) !important;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35) !important;
          text-align: center !important;
        ">
          <div style="font-size: 30px; margin-bottom: 14px;">⏰</div>
          <h2 id="idleWarningTitle" style="margin: 0 0 12px 0; font-size: 21px; color: #1a1a1a;">Session Expiring Soon</h2>
          <p style="margin: 0 0 8px 0; color: #555; font-size: 14px; line-height: 1.5;">
            You have been inactive. Please continue or you will be signed out.
          </p>
          <p style="margin: 0 0 24px 0; color: #b42318; font-size: 15px; font-weight: 700;">
            Logout in <span id="idleCountdownSeconds">${remainingSeconds}</span> seconds
          </p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="keepSessionActiveBtn" type="button" style="
              flex: 1;
              padding: 11px 18px;
              background: #007AFF;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
            ">
              Keep Session Active
            </button>
            <button id="logoutNowBtn" type="button" style="
              flex: 1;
              padding: 11px 18px;
              background: #f2f4f7;
              color: #1a1a1a;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
            ">
              Logout Now
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', warningHTML);

    const keepBtn = document.getElementById('keepSessionActiveBtn');
    const logoutBtn = document.getElementById('logoutNowBtn');

    if (keepBtn) {
      keepBtn.focus();
      keepBtn.addEventListener('click', () => this.recordActivity());
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout('User logged out'));
    }

    if (this.warningCountdownInterval) {
      clearInterval(this.warningCountdownInterval);
    }

    this.warningCountdownInterval = setInterval(() => {
      const countdownEl = document.getElementById('idleCountdownSeconds');
      const secondsLeft = Math.max(0, Math.ceil((this.lastActivityTime + SESSION_CONFIG.ACTIVITY_TIMEOUT - Date.now()) / 1000));

      if (countdownEl) {
        countdownEl.textContent = String(secondsLeft);
      }

      if (secondsLeft <= 0 && this.warningCountdownInterval) {
        clearInterval(this.warningCountdownInterval);
        this.warningCountdownInterval = null;
      }
    }, 1000);
  }

  // Logout user
  async logout(reason = 'Logout requested') {
    console.log('[SessionManager] Logging out:', reason);
    
    // Store logout reason for display on login page (IMPORTANT: store BEFORE clearing storage)
    try {
      sessionStorage.setItem('logoutReason', reason);
    } catch (e) {
      console.warn('Could not store logout reason:', e);
    }
    
    // Clear all intervals to stop any background tasks
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }
    if (this.logoutTimeout) {
      clearTimeout(this.logoutTimeout);
    }
    if (this.warningCountdownInterval) {
      clearInterval(this.warningCountdownInterval);
      this.warningCountdownInterval = null;
    }

    this.isLoggedIn = false;

    try {
      // Call logout endpoint to destroy server-side session
      await fetch('/api/session/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('[SessionManager] Error during logout:', error);
    }

    // Clear local/session storage so protected pages cannot reuse old user data after logout.
    try {
      const savedReason = sessionStorage.getItem('logoutReason') || reason;
      const savedAutoLogoutMinutes = sessionStorage.getItem('autoLogoutMinutes') || String(Math.max(1, Math.round(SESSION_CONFIG.ACTIVITY_TIMEOUT / 60000)));
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('logoutReason', savedReason);
      sessionStorage.setItem('autoLogoutMinutes', savedAutoLogoutMinutes);
    } catch (e) {
      console.warn('Could not clear browser storage after logout:', e);
    }
    
    // Add cache busting headers
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Cache-Control';
    meta.content = 'no-store, no-cache, must-revalidate, max-age=0';
    document.head.appendChild(meta);
    
    // Redirect to login
    this.redirectToLogin();
  }

  // Redirect to login page
  redirectToLogin() {
    // Redirect to login - server-side cache headers prevent back-button access
    // sessionStorage is preserved during navigation (per-tab storage)
    window.location.replace('/');
  }

  // Manual logout trigger
  manualLogout() {
    this.logout('User logged out');
  }
}

// Global instance
const sessionManager = new SessionManager();
window.sessionManager = sessionManager;

// Initialize once.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => sessionManager.init(), { once: true });
} else {
  sessionManager.init();
}
