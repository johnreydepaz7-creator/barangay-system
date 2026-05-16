const mongoose = require('mongoose');

const householdSchema = new mongoose.Schema({
  householdnumber: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  purok: {
    type: String,
    required: true,
    trim: true
  },
  typeOfDwelling: {
    type: String,
    trim: true
  },
  typeOfToilet: {
    type: String,
    trim: true
  },
  indigentFamily: {
    type: String,
    trim: true
  },
  sourceOfWater: {
    type: String,
    trim: true
  },
  powerSupply: {
    type: String,
    trim: true
  },
  pets: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Household', householdSchema);