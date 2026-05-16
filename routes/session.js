const express = require('express');
const router = express.Router();
const { writeActivityLog } = require('../services/activityLogger');
const mongoose = require('mongoose');
const Account = require('../models/account');

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '').replace(/^0/, '');
}

async function getCurrentAutoLogoutMinutes(req) {
  const phone = normalizePhone(req.session?.user?.phone);
  if (!phone) return 10;
  const escaped = phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const account = await Account.findOne({
    phone: { $regex: `^(0)?${escaped}$`, $options: 'i' }
  }).lean();
  return Number(account?.userSettings?.autoLogoutMinutes) || 10;
}

async function applySessionTimeout(req) {
  const minutes = await getCurrentAutoLogoutMinutes(req);
  req.session.cookie.maxAge = minutes * 60 * 1000;
  return minutes;
}

function parseSessionDoc(doc) {
  try {
    const session = typeof doc.session === 'string' ? JSON.parse(doc.session) : doc.session;
    return session || null;
  } catch {
    return null;
  }
}

async function findUserSessions(req) {
  const phone = normalizePhone(req.session?.user?.phone);
  if (!phone) return [];
  const docs = await mongoose.connection.collection('sessions').find({}).toArray();
  return docs.map(doc => ({ doc, session: parseSessionDoc(doc) }))
    .filter(item => normalizePhone(item.session?.user?.phone) === phone);
}


// Check if user has active session
router.get('/check', async (req, res) => {
  if (req.session && req.session.user) {
    const autoLogoutMinutes = await applySessionTimeout(req);
    req.session.userAgent = req.get('user-agent') || '';
    req.session.deviceLabel = req.get('sec-ch-ua-platform') || req.get('user-agent') || 'Signed-in device';
    req.session.lastActive = new Date();
    req.session.touch();
    return res.json({
      success: true,
      user: req.session.user,
      autoLogoutMinutes,
      sessionExpiry: req.session.cookie.maxAge / 1000 // in seconds
    });
  }
  res.json({ success: false, message: 'No active session' });
});

// Logout user - destroy session and clear all cookies
router.post('/logout', async (req, res) => {
  if (req.session) {
    const logoutUser = req.session.user;

    if (logoutUser) {
      await writeActivityLog({
        req,
        user: logoutUser,
        action: 'Logged out',
        details: 'User logged out of the system',
        module: 'System'
      });
    }

    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Error logging out'
        });
      }
      // Clear all session-related cookies
      res.clearCookie('sessionId', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.clearCookie('connect.sid', { path: '/' });
      
      // Set cache-control headers to prevent back-button access
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } else {
    // Even if no session, still clear cookies
    res.clearCookie('sessionId', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: false, message: 'No session to destroy' });
  }
});

// Bump session activity (resets idle timeout)
router.post('/activity', async (req, res) => {
  if (req.session && req.session.user) {
    const autoLogoutMinutes = await applySessionTimeout(req);
    req.session.userAgent = req.get('user-agent') || '';
    req.session.deviceLabel = req.get('sec-ch-ua-platform') || req.get('user-agent') || 'Signed-in device';
    req.session.lastActive = new Date();
    req.session.touch();
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Unable to refresh session' });
      }
      return res.json({
        success: true,
        message: 'Activity recorded',
        autoLogoutMinutes,
        sessionExpiry: req.session.cookie.maxAge / 1000
      });
    });
    return;
  }
  res.status(401).json({ success: false, message: 'Not authenticated' });
});

// List sessions for the current logged-in user
router.get('/active', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const sessions = await findUserSessions(req);
    const activeSessions = sessions.map(({ doc, session }) => ({
      id: doc._id,
      current: doc._id === req.sessionID,
      label: session.deviceLabel || 'Signed-in device',
      userAgent: session.userAgent || '',
      lastActive: session.lastActive || doc.expires,
      expires: doc.expires
    })).sort((a, b) => Number(b.current) - Number(a.current) || new Date(b.lastActive) - new Date(a.lastActive));

    res.json({ success: true, sessions: activeSessions });
  } catch (error) {
    console.error('Active sessions error:', error);
    res.status(500).json({ success: false, message: 'Error loading active sessions.' });
  }
});

// Sign out every other server-side session for this account
router.post('/signout-others', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const sessions = await findUserSessions(req);
    const otherIds = sessions.map(({ doc }) => doc._id).filter(id => id !== req.sessionID);

    if (otherIds.length) {
      await mongoose.connection.collection('sessions').deleteMany({ _id: { $in: otherIds } });
    }

    await writeActivityLog({
      req,
      user: req.session.user,
      action: 'Signed Out Other Sessions',
      details: `${otherIds.length} other session(s) signed out`,
      module: 'Settings'
    });

    res.json({ success: true, removed: otherIds.length, message: 'All other sessions signed out.' });
  } catch (error) {
    console.error('Sign out other sessions error:', error);
    res.status(500).json({ success: false, message: 'Error signing out other sessions.' });
  }
});

// Get session info (for debugging)
router.get('/info', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({
      success: true,
      user: req.session.user,
      expiresIn: req.session.cookie.maxAge / 1000, // seconds
      expiresAt: new Date(Date.now() + req.session.cookie.maxAge)
    });
  }
  res.status(401).json({ success: false, message: 'Not authenticated' });
});

module.exports = router;
