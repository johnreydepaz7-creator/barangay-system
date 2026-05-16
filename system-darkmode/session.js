/* ============================================================
   SESSION.JS — Current logged-in user
   Link just before </body> on every page, BEFORE logger.js
   and BEFORE the inline <script> block.
   ============================================================ */

// Get user data from sessionStorage (set after login)
function getCurrentUser() {
  const userJSON = sessionStorage.getItem('current_user');
  
  if (!userJSON) {
    // Fallback for development/testing
    return {
      name:     'Unknown User',
      role:     'Staff',
      initials: 'UU',
      profileImage: '',
      phone: sessionStorage.getItem('otp_phone') || ''
    };
  }

  try {
    const user = JSON.parse(userJSON);
    
    // Format full name from firstName and lastName only
    const name = `${user.firstName} ${user.lastName}`;
    
    // Get initials from first letters of first and last name
    const firstInitial = user.firstName?.charAt(0).toUpperCase() || '';
    const lastInitial = user.lastName?.charAt(0).toUpperCase() || '';
    const initials = (firstInitial + lastInitial) || 'UU';
    
    return {
      name:     name.trim(),
      role:     user.role || 'Staff',
      initials: initials,
      profileImage: user.profileImage || '',
      phone: user.phone || sessionStorage.getItem('otp_phone') || ''
    };
  } catch (error) {
    console.error('Error parsing user data:', error);
    return {
      name:     'Unknown User',
      role:     'Staff',
      initials: 'UU',
      profileImage: '',
      phone: sessionStorage.getItem('otp_phone') || ''
    };
  }
}

const CURRENT_USER = getCurrentUser();

// Load user settings from database
async function loadUserSettings() {
  try {
    let phone = sessionStorage.getItem('otp_phone');
    if (!phone) {
      console.warn('[Theme] Phone number not found in session, using default settings');
      // Check if theme was already cached in sessionStorage
      const cachedTheme = sessionStorage.getItem('cached_theme');
      applyTheme(cachedTheme || 'light');
      applyCompactMode(sessionStorage.getItem('cached_compactMode') === 'true' || false);
      return;
    }

    // Normalize phone number the same way the backend does
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');
    
    // Check if theme was already cached in sessionStorage (no API call needed)
    const cachedTheme = sessionStorage.getItem('cached_theme');
    const cachedCompact = sessionStorage.getItem('cached_compactMode');
    
    if (cachedTheme) {
      console.log('[Theme] Applying cached theme:', cachedTheme);
      applyTheme(cachedTheme);
      applyCompactMode(cachedCompact === 'true' || false);
    }
    
    // Sync with database in background (don't wait for it)
    console.log('[Theme] Loading settings for normalized phone:', phone);
    const response = await fetch(`/api/accounts/settings/${phone}`);
    const data = await response.json();

    console.log('[Theme] Settings response:', data);

    if (data.success && data.settings) {
      const settings = data.settings;
      const themeToApply = settings.theme || 'light';
      
      // Update cached values in sessionStorage
      sessionStorage.setItem('cached_theme', themeToApply);
      sessionStorage.setItem('cached_compactMode', settings.compactMode ? 'true' : 'false');
      
      console.log('[Theme] Applying theme from database:', themeToApply);
      applyTheme(themeToApply);
      applyCompactMode(settings.compactMode || false);
    } else {
      // Use defaults if fetch fails
      console.warn('[Theme] Failed to load settings, using defaults');
      sessionStorage.setItem('cached_theme', 'light');
      sessionStorage.setItem('cached_compactMode', 'false');
      applyTheme('light');
      applyCompactMode(false);
    }
  } catch (error) {
    console.error('[Theme] Error loading user settings:', error);
    // Check cache and apply it
    const cachedTheme = sessionStorage.getItem('cached_theme');
    const cachedCompact = sessionStorage.getItem('cached_compactMode');
    applyTheme(cachedTheme || 'light');
    applyCompactMode(cachedCompact === 'true' || false);
  }
}

// Initialize dark mode from database
(function initTheme() {
  loadUserSettings();
})();

// Theme switching functions (global, available on all pages)
function applyTheme(mode) {
  if (mode === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

function setTheme(mode) {
  // Apply immediately to UI
  applyTheme(mode);
  
  // Cache in sessionStorage for instant apply on page navigation (no flash!)
  sessionStorage.setItem('cached_theme', mode);
  console.log('[Theme] Cached theme in session:', mode);
  
  // Save to database (async, don't wait for it)
  let phone = sessionStorage.getItem('otp_phone');
  if (phone) {
    // Normalize phone the same way backend does
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');
    
    console.log('[Theme] Saving theme to database for phone:', phone);
    fetch(`/api/accounts/settings/${phone}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: mode })
    }).then((res) => {
      console.log('[Theme] Save response status:', res.status);
      return res.json();
    }).then((data) => {
      console.log('[Theme] Save result:', data);
      // Show feedback if showToast is available
      if (typeof showToast === 'function') {
        showToast(`Theme changed to ${mode === 'dark' ? 'Dark' : 'Light'} mode.`);
      }
    }).catch(err => console.error('[Theme] Error saving theme:', err));
  }
}

// Compact mode switching functions (global, available on all pages)
function applyCompactMode(enabled) {
  if (enabled) {
    document.body.classList.add('compact');
  } else {
    document.body.classList.remove('compact');
  }
}

function setCompactMode(enabled) {
  // Apply immediately to UI
  applyCompactMode(enabled);
  
  // Cache in sessionStorage for instant apply on page navigation (no flash!)
  sessionStorage.setItem('cached_compactMode', enabled ? 'true' : 'false');
  console.log('[Compact] Cached compact mode in session:', enabled);
  
  // Save to database (async, don't wait for it)
  let phone = sessionStorage.getItem('otp_phone');
  if (phone) {
    // Normalize phone the same way backend does
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');
    
    fetch(`/api/accounts/settings/${phone}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compactMode: enabled })
    }).catch(err => console.error('Error saving compact mode:', err));
  }
}

// Fills topbar name and avatar — runs immediately since
// this script is loaded after the DOM elements exist.
(function fillTopbar() {
  const nameEl   = document.getElementById('topbarUserName');
  const avatarEl = document.getElementById('topbarAvatar');
  if (nameEl)   nameEl.textContent   = CURRENT_USER.name;
  if (avatarEl) {
    if (CURRENT_USER.profileImage) {
      avatarEl.innerHTML = `<img src="${CURRENT_USER.profileImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
    } else {
      avatarEl.textContent = CURRENT_USER.initials;
    }
  }

  if (CURRENT_USER.phone) {
    fetch(`/api/accounts/profile/get?phone=${encodeURIComponent(CURRENT_USER.phone)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.account?.profileImage && avatarEl) {
          avatarEl.innerHTML = `<img src="${data.account.profileImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
          const storedUser = JSON.parse(sessionStorage.getItem('current_user') || '{}');
          storedUser.profileImage = data.account.profileImage;
          sessionStorage.setItem('current_user', JSON.stringify(storedUser));
        }
      })
      .catch(err => console.warn('Unable to load profile photo:', err));
  }
})();

// Logout function
async function logout() {
  const confirmed = !window.BrgyMessageBox || await BrgyMessageBox.confirm('Are you sure you want to logout?');
  if (!confirmed) return;

  try {
    await fetch('/api/session/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (error) {
    console.error('Logout error:', error);
  }

  try {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('logoutReason', 'User logged out');
  } catch (e) {}

  window.location.replace('/');
}
