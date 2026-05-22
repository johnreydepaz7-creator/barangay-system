const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  householdId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Household',
    required: true
  },
  lastname: {
    type: String,
    required: true,
    trim: true
  },
  firstname: {
    type: String,
    required: true,
    trim: true
  },
  middlename: {
    type: String,
    trim: true
  },
  extensionName: {
    type: String,
    trim: true
  },
  positionInFamily: {
    type: String,
    trim: true
  },
  age: {
    type: Number,
    min: 0
  },
  gender: {
    type: String,
    enum: ['Male', 'Female']
  },
  civilStatus: {
    type: String,
    enum: ['Single', 'Married', 'Widowed', 'Divorced']
  },
  purok: {
    type: String,
    required: true,
    trim: true
  },
  occupation: {
    type: String,
    trim: true
  },
  dateOfBirth: {
    type: Date
  },
  placeOfBirth: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  religion: {
    type: String,
    trim: true
  },
  lengthOfStay: {
    type: String,
    trim: true
  },
  educationalAttainment: {
    type: String,
    trim: true
  },
  sourceOfIncome: {
    type: String,
    trim: true
  },
  validIdentification: {
    type: String,
    trim: true
  },
  specialCondition: {
    type: String,
    trim: true
  },
  vehicle: {
    type: String,
    trim: true
  },
  typeOfBusiness: {
    type: String,
    trim: true
  },
  remarks: {
    type: String,
    trim: true
  },
  photo: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Member', memberSchema);