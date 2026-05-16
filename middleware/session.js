const session = require('express-session');
const MongoStore = require('connect-mongo');

const isProduction = process.env.NODE_ENV === 'production';
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Missing MONGODB_URI environment variable');
  process.exit(1);
}

const sessionConfig = {
  name: 'sessionId',
  secret: process.env.SESSION_SECRET || 'barangay-system-session-secret-key',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,

  store: MongoStore.create({
    mongoUrl: mongoURI,
    touchAfter: 0
  }),

  cookie: {
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  }
};

module.exports = session(sessionConfig);
