const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/activityLog');
const { writeActivityLog, isAllowedActivityAction } = require('../services/activityLogger');

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  next();
}

function toClientLog(log) {
  const date = log.createdAt ? new Date(log.createdAt) : new Date();
  return {
    id: date.getTime(),
    _id: log._id,
    timestamp: date.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila'
    }),
    createdAt: date.toISOString(),
    user: log.user,
    role: log.role,
    action: log.action,
    details: log.details,
    module: log.module
  };
}

// GET /api/activity-logs - visible to all logged-in users
router.get('/', requireLogin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    const visibleLogs = logs.filter(log => isAllowedActivityAction(log.action));
    res.json({ success: true, logs: visibleLogs.map(toClientLog) });
  } catch (error) {
    console.error('[ActivityLog] Fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activity logs' });
  }
});

// POST /api/activity-logs - save an activity from any dashboard page
router.post('/', requireLogin, async (req, res) => {
  try {
    const { action, details, module, path } = req.body;

    if (!action || !module) {
      return res.status(400).json({ success: false, message: 'Action and module are required' });
    }

    if (!isAllowedActivityAction(action)) {
      return res.status(200).json({ success: true, ignored: true, message: 'Activity not included in CRUD/login/logout logs' });
    }

    const log = await writeActivityLog({
      req,
      action: String(action).slice(0, 120),
      details: String(details || '').slice(0, 500),
      module: String(module || 'System').slice(0, 80),
      path: String(path || '').slice(0, 200)
    });

    if (!log) {
      return res.status(500).json({ success: false, message: 'Failed to save activity log' });
    }

    res.status(201).json({ success: true, log: toClientLog(log) });
  } catch (error) {
    console.error('[ActivityLog] Save error:', error);
    res.status(500).json({ success: false, message: 'Failed to save activity log' });
  }
});

module.exports = router;
