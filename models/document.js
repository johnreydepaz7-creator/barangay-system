const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true
  },
  documentType: {
    type: String,
    enum: ['Barangay Clearance', 'Certificate of Indigency', 'Barangay Certification'],
    required: true
  },
  purpose: {
    type: String,
    trim: true
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Document', documentSchema);
