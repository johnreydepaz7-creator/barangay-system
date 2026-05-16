const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  middleName: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  role: {
    type: String,
    required: true,
    enum: ['Punong Barangay', 'Barangay Secretary', 'Barangay Treasurer', 'Kagawad', 'SK Chairman', 'Tanod', 'Staff'],
    default: 'Staff'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  approvedAt: {
    type: Date,
    default: null
  },
  approvedBy: {
    type: String,
    default: null
  },
  googleDriveToken: {
    type: String,
    default: null
  },
  googleDriveTokenExpiry: {
    type: Date,
    default: null
  },
  profileImage: {
    type: String,
    default: ''
  },
  userSettings: {
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light'
    },
    compactMode: {
      type: Boolean,
      default: false
    },
    autoLogoutMinutes: {
      type: Number,
      default: 10,
      min: 1,
      max: 120
    }
  }
});

module.exports = mongoose.model('Account', accountSchema);
