const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null
  },
  user: {
    type: String,
    required: true,
    trim: true,
    default: 'Unknown User'
  },
  role: {
    type: String,
    trim: true,
    default: 'Staff'
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  details: {
    type: String,
    trim: true,
    default: ''
  },
  module: {
    type: String,
    required: true,
    trim: true,
    default: 'System'
  },
  path: {
    type: String,
    trim: true,
    default: ''
  },
  ipAddress: {
    type: String,
    trim: true,
    default: ''
  },
  userAgent: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
