const session = require('express-session');
const connectMongo = require('connect-mongo');

const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;

const isProduction = process.env.NODE_ENV === 'production';

const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Missing MONGODB_URI environment variable');
  process.exit(1);
}

const sessionStore = MongoStore.create
  ? MongoStore.create({
      mongoUrl: mongoURI,
      touchAfter: 0
    })
  : new MongoStore({
      mongoUrl: mongoURI,
      touchAfter: 0
    });

const sessionConfig = {
  name: 'sessionId',
  secret: process.env.SESSION_SECRET || 'barangay-system-session-secret-key',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: sessionStore,
  proxy: true,
  cookie: {
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  }
};

module.exports = session(sessionConfig);