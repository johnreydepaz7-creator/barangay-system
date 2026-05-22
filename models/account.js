const mongoose = require('mongoose');

function normalizePhoneValue(phone) {
  return String(phone || '').trim().replace(/\s+/g, '').replace(/^0+/, '');
}

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
    trim: true,
    set: normalizePhoneValue,
    validate: {
      validator: function(value) {
        return /^9\d{9}$/.test(normalizePhoneValue(value));
      },
      message: 'Enter a valid 10-digit Philippine mobile number starting with 9.'
    }
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

// Keep the database itself protected from duplicate accounts.
accountSchema.index({ phone: 1 }, { unique: true });

accountSchema.pre('validate', function(next) {
  if (this.phone) {
    this.phone = normalizePhoneValue(this.phone);
  }
  next();
});

module.exports = mongoose.model('Account', accountSchema);
