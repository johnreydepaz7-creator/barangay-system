const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());

// Temporarily disable strict CSP for QR code functionality
app.use((req, res, next) => {
  // Remove any CSP restrictions for development
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  next();
});

// Public login pages/assets. Dashboard files are served only after a valid session check below.
app.use(express.static('Login'));

// MongoDB connection
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Missing MONGODB_URI environment variable');
  process.exit(1);
}

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Session middleware (MUST come after MongoDB connection declaration)
const sessionMiddleware = require('./middleware/session');
app.use(sessionMiddleware);

// Prevent browser cache/back-button access to protected pages after logout.
function sendNoStoreHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

app.use((req, res, next) => {
  if (req.method === 'GET') {
    sendNoStoreHeaders(res);
  }
  next();
});

function requireDashboardSession(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  sendNoStoreHeaders(res);

  // Browser requests for dashboard pages are redirected to login.
  if (req.accepts('html')) {
    return res.redirect('/');
  }

  return res.status(401).json({ success: false, message: 'Not authenticated' });
}

// Routes
const householdRoutes = require('./routes/households');
const memberRoutes = require('./routes/members');
const dashboardRoutes = require('./routes/dashboard');
const backupRoutes = require('./routes/backup');
const accountRoutes = require('./routes/accounts');
const sessionRoutes = require('./routes/session');
const activityLogRoutes = require('./routes/activityLogs');
const fileManagerRoutes = require('./routes/fileManager');
app.use('/api/households', householdRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/file-manager', fileManagerRoutes);

// Initialize backup scheduler (runs daily at 2 AM)
const backupService = require('./services/backupService');
backupService.scheduleAutomaticBackups('0 2 * * *');

// Handle favicon request (prevent 404 errors in console)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Serve the login page as the main entry point
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/Login/login.html');
});


// Protected dashboard files. Without a valid server session, direct URL/back-button access goes to login.
app.use('/', requireDashboardSession, express.static('Dashboard'));
app.use('/system-darkmode', requireDashboardSession, express.static('system-darkmode'));

// Start server with port fallback logic
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`\n⚠️  Port ${port} is in use, trying port ${nextPort}...\n`);
      startServer(nextPort);
    } else {
      console.error(`\n❌ ERROR: ${error.message}\n`);
      console.error('Solutions:');
      console.error(`• Run: npm run fix-port         (clears port 3000 automatically)`);
      console.error(`• Or manually: npx node fix-port.js --start\n`);
      process.exit(1);
    }
  });

  return server;
}

const server = startServer(PORT);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});