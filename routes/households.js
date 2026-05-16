const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const Household = require('../models/household');
const Member = require('../models/member');
const { writeActivityLog } = require('../services/activityLogger');

const mongoUri = process.env.MONGODB_URI || 'mongodb://test123:test123@ac-5r7ji0j-shard-00-00.pynxl6o.mongodb.net:27017,ac-5r7ji0j-shard-00-01.pynxl6o.mongodb.net:27017,ac-5r7ji0j-shard-00-02.pynxl6o.mongodb.net:27017/barangay-management-system?ssl=true&replicaSet=atlas-140ctr-shard-0&authSource=admin&appName=barangaysystem';
const dbName = 'barangay-management-system';

// POST /api/households - Create a new household with members
router.post('/', async (req, res) => {
  try {
    const { householdnumber, name, purok, typeOfDwelling, typeOfToilet, indigentFamily, sourceOfWater, powerSupply, pets, members } = req.body;

    console.log('POST /api/households received:', {
      householdnumber,
      name,
      purok,
      typeOfDwelling,
      typeOfToilet,
      indigentFamily,
      sourceOfWater,
      powerSupply,
      pets,
      membersCount: members?.length
    });

    console.log('Full request body:', JSON.stringify(req.body, null, 2));

    // Validate required fields - use householdnumber if provided, otherwise fall back to name
    const houseNum = householdnumber || name;
    if (!houseNum || !purok) {
      return res.status(400).json({ error: 'Household number and purok are required' });
    }

    // Create household
    const household = new Household({ 
      householdnumber: houseNum,
      name: name || houseNum,
      purok,
      typeOfDwelling,
      typeOfToilet,
      indigentFamily,
      sourceOfWater,
      powerSupply,
      pets
    });
    const savedHousehold = await household.save();

    console.log('Saved household object:', JSON.stringify(savedHousehold, null, 2));
    console.log('Saved household pets field:', savedHousehold.pets);

    // Create members
    const memberPromises = members.map(memberData => {
      const member = new Member({
        ...memberData,
        householdId: savedHousehold._id
      });
      return member.save();
    });

    const savedMembers = await Promise.all(memberPromises);

    await writeActivityLog({
      req,
      action: 'Added Household',
      details: `Household ${houseNum} with ${savedMembers.length} member(s)`,
      module: 'Residents'
    });

    res.status(201).json({
      household: savedHousehold,
      members: savedMembers,
      message: 'Household and members saved successfully'
    });
  } catch (error) {
    console.error('Error saving household:', error);
    res.status(500).json({ error: error.message || 'Failed to save household' });
  }
});

// GET /api/households - Get all households
router.get('/', async (req, res) => {
  try {
    const households = await Household.find().sort({ createdAt: -1 });
    res.json(households);
  } catch (error) {
    console.error('Error fetching households:', error);
    res.status(500).json({ error: 'Failed to fetch households' });
  }
});

// GET /api/households/:id - Get household with members
router.get('/:id', async (req, res) => {
  try {
    const householdId = req.params.id;

    // Validate ObjectId format
    if (!householdId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid household ID format' });
    }

    // Use Mongoose to find household
    const household = await Household.findById(householdId);
    
    if (!household) {
      return res.status(404).json({ error: 'Household not found' });
    }

    // Find members - try with string first (Mongoose will handle conversion), then with $or for backward compatibility
    const members = await Member.find({ 
      $or: [
        { householdId: householdId },
        { householdId: householdId.toString() }
      ]
    }).lean();

    console.log(`Found ${members.length} members for household ${householdId}`);

    res.json({ household, members });
  } catch (error) {
    console.error('Error fetching household:', error);
    res.status(500).json({ error: 'Failed to fetch household: ' + error.message });
  }
});

// DELETE /api/households/:id - Delete household and all its members
router.delete('/:id', async (req, res) => {
  let client = null;
  try {
    const householdId = req.params.id;

    // Validate the household ID format
    if (!householdId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid household ID format' });
    }

    // Connect using MongoDB driver for direct deletion
    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(dbName);
    const objectId = new ObjectId(householdId);

    console.log(`Attempting to delete household with ID: ${householdId}`);

    // First, get the household to return it in response
    const household = await db.collection('households').findOne({ _id: objectId });
    
    if (!household) {
      console.log(`Household not found with _id: ${householdId}`);
      return res.status(404).json({ error: 'Household not found' });
    }

    // Delete all members associated with this household - handle both ObjectId and string
    const membersResult = await db.collection('members').deleteMany({ 
      $or: [
        { householdId: objectId },
        { householdId: householdId }
      ]
    });
    console.log(`Deleted ${membersResult.deletedCount} members`);

    // Delete the household itself
    const householdsResult = await db.collection('households').deleteOne({ _id: objectId });
    console.log(`Deleted household, deletedCount: ${householdsResult.deletedCount}`);

    await writeActivityLog({
      req,
      action: 'Deleted Household',
      details: `Household ${household.householdnumber || household.name || householdId}`,
      module: 'Residents'
    });

    res.json({ 
      message: 'Household and all associated members deleted successfully',
      deletedHousehold: household
    });
  } catch (error) {
    console.error('Error deleting household:', error);
    res.status(500).json({ error: error.message || 'Failed to delete household' });
  } finally {
    if (client) {
      await client.close();
    }
  }
});

// PUT /api/households/:id - Update household and members
router.put('/:id', async (req, res) => {
  try {
    const householdId = req.params.id;
    const { householdnumber, name, purok, typeOfDwelling, typeOfToilet, indigentFamily, sourceOfWater, powerSupply, pets, members } = req.body;

    console.log(`PUT request for household ID: ${householdId}`);
    
    // Use householdnumber if provided, otherwise fall back to name
    const houseNum = householdnumber || name;
    console.log(`Household Number: ${houseNum}, Purok: ${purok}, Members: ${members.length}`);

    // Validate required fields
    if (!houseNum || !purok) {
      return res.status(400).json({ error: 'Household number and purok are required' });
    }

    // Validate the household ID format
    if (!householdId.match(/^[0-9a-fA-F]{24}$/)) {
      console.log(`Invalid household ID format: ${householdId}`);
      return res.status(400).json({ error: 'Invalid household ID format' });
    }

    // Update the household
    const household = await Household.findByIdAndUpdate(
      householdId,
      { 
        householdnumber: houseNum,
        name: name || houseNum,
        purok,
        typeOfDwelling,
        typeOfToilet,
        indigentFamily,
        sourceOfWater,
        powerSupply,
        pets
      },
      { new: true }
    );

    console.log(`Household update result:`, household);

    if (!household) {
      console.log(`Household not found for ID: ${householdId}`);
      return res.status(404).json({ error: 'Household not found' });
    }

    // Delete all old members - use string format (Mongoose handles conversion)
    await Member.deleteMany({ 
      $or: [
        { householdId: householdId },
        { householdId: householdId.toString() }
      ]
    });

    // Create new members - use string format (Mongoose handles conversion)
    const memberPromises = members.map(memberData => {
      const member = new Member({
        ...memberData,
        householdId: householdId
      });
      return member.save();
    });

    const updatedMembers = await Promise.all(memberPromises);

    await writeActivityLog({
      req,
      action: 'Updated Household',
      details: `Household ${houseNum} with ${updatedMembers.length} member(s)`,
      module: 'Residents'
    });

    res.json({
      household,
      members: updatedMembers,
      message: 'Household and members updated successfully'
    });
  } catch (error) {
    console.error('Error updating household:', error);
    res.status(500).json({ error: error.message || 'Failed to update household' });
  }
});

module.exports = router;