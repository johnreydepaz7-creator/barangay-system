const ActivityLog = require('../models/activityLog');

// Only these user activities are saved/displayed in Activity Logs:
// CRUD actions plus Login and Logout.
const ALLOWED_ACTION_KEYWORDS = [
  'added',
  'created',
  'registered',
  'generated',
  'viewed',
  'read',
  'updated',
  'edited',
  'approved',
  'deleted',
  'rejected',
  'logged in',
  'logged out',
  'uploaded',
  'downloaded',
  'moved',
  'renamed',
  'pinned',
  'unpinned',
  'opened'
];

function isAllowedActivityAction(action = '') {
  const value = String(action).toLowerCase().trim();

  // Do not treat page navigation as CRUD read activity.
  if (value === 'viewed page' || value.includes('page view')) return false;

  return ALLOWED_ACTION_KEYWORDS.some(keyword => value.includes(keyword));
}

function formatUser(user = {}) {
  const firstName = user.firstName || '';
  const lastName = user.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();

  return {
    userId: user._id || null,
    user: fullName || user.name || 'Unknown User',
    role: user.role || 'Staff'
  };
}

async function writeActivityLog({ req = null, user = null, action, details = '', module = 'System', path = '' }) {
  try {
    const sessionUser = user || (req && req.session && req.session.user) || {};
    const formattedUser = formatUser(sessionUser);

    if (!action || !isAllowedActivityAction(action)) return null;

    return await ActivityLog.create({
      ...formattedUser,
      action,
      details,
      module,
      path: path || (req ? req.originalUrl : ''),
      ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '') : '',
      userAgent: req ? (req.headers['user-agent'] || '') : ''
    });
  } catch (error) {
    console.error('[ActivityLog] Failed to save log:', error.message);
    return null;
  }
}

module.exports = { writeActivityLog, isAllowedActivityAction };
