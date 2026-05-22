const express = require('express');
const router = express.Router();
const Member = require('../models/member');
const Household = require('../models/household');
const Document = require('../models/document');

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    // Total residents
    const totalResidents = await Member.countDocuments();

    // Total households
    const totalHouseholds = await Household.countDocuments();

    // Senior citizens (age >= 60)
    const seniorCitizens = await Member.countDocuments({ age: { $gte: 60 } });

    // Docs issued today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const docsIssuedToday = await Document.countDocuments({
      issuedAt: { $gte: today, $lt: tomorrow }
    });

    res.json({
      totalResidents,
      totalHouseholds,
      seniorCitizens,
      docsIssuedToday
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get residents by purok
router.get('/purok-breakdown', async (req, res) => {
  try {
    const purokData = await Member.aggregate([
      {
        $group: {
          _id: '$purok',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const response = purokData.map(item => ({
      name: item._id,
      count: item.count
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search residents by name
router.get('/search-residents', async (req, res) => {
  try {
    const query = req.query.q || '';
    
    if (!query || query.length < 1) {
      return res.json([]);
    }

    // Search in firstname, lastname, or middlename
    const residents = await Member.find({
      $or: [
        { firstname: { $regex: query, $options: 'i' } },
        { lastname: { $regex: query, $options: 'i' } },
        { middlename: { $regex: query, $options: 'i' } }
      ]
    }).limit(20);

    const response = residents.map(r => ({
      id: r._id,
      name: `${r.lastname}, ${r.firstname}${r.middlename ? ' ' + r.middlename : ''}`,
      firstname: r.firstname,
      lastname: r.lastname,
      age: r.age || 0,
      purok: r.purok,
      phone: r.phone || ''
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
