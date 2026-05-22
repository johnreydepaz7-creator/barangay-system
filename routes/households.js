const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const Household = require('../models/household');
const Member = require('../models/member');
const { writeActivityLog } = require('../services/activityLogger');
const { resolveResidentPhotoFilePath } = require('../utils/storagePaths');

const mongoUri = process.env.MONGODB_URI;
const dbName = 'barangay-management-system';


function removeResidentPhotoFile(filePath) {
  if (!filePath || !String(filePath).startsWith('/uploads/residents/')) return;
  const fileName = path.basename(String(filePath).replace(/\\/g, '/'));
  if (!fileName || fileName === '.' || fileName === '..') return;

  const fullPath = resolveResidentPhotoFilePath(filePath);
  if (!fullPath) return;
  fs.unlink(fullPath, (error) => {
    if (error && error.code !== 'ENOENT') {
      console.error('Error deleting resident photo:', error);
    }
  });
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function hasGeneralText(value) {
  return /^[A-Za-z0-9Ññ .,'#()\-/&]+$/.test(value);
}

function hasNameText(value) {
  return /^[A-Za-zÑñ .'-]+$/.test(value);
}

function validateResidentPayload(payload) {
  const errors = [];
  const requireText = (value, label, options = {}) => {
    const text = normalizeText(value);
    if (!text) {
      errors.push(`${label} is required`);
      return text;
    }
    if (options.name && !hasNameText(text)) errors.push(`${label} must contain letters only`);
    if (!options.name && !hasGeneralText(text)) errors.push(`${label} has invalid characters`);
    if (options.maxLength && text.length > options.maxLength) errors.push(`${label} is too long`);
    return text;
  };
  const optionalText = (value, label, options = {}) => {
    const text = normalizeText(value);
    if (!text) return text;
    if (options.name && !hasNameText(text)) errors.push(`${label} must contain letters only`);
    if (!options.name && !hasGeneralText(text)) errors.push(`${label} has invalid characters`);
    if (options.maxLength && text.length > options.maxLength) errors.push(`${label} is too long`);
    return text;
  };

  const houseNum = requireText(payload.householdnumber || payload.name, 'Household number', { maxLength: 30 });
  const purok = requireText(payload.purok, 'Purok', { maxLength: 30 });
  ['typeOfDwelling', 'typeOfToilet', 'indigentFamily', 'sourceOfWater', 'powerSupply', 'pets'].forEach(field => {
    requireText(payload[field], field, { maxLength: 80 });
  });

  if (!Array.isArray(payload.members) || payload.members.length === 0) {
    errors.push('Please add at least one member');
    return errors;
  }

  payload.members.forEach((member, index) => {
    const label = `Member ${index + 1}`;
    requireText(member.lastname, `${label} Last Name`, { name: true, maxLength: 60 });
    requireText(member.firstname, `${label} First Name`, { name: true, maxLength: 60 });
    optionalText(member.middlename, `${label} Middle Name`, { name: true, maxLength: 60 });
    optionalText(member.extensionName, `${label} Extension Name`, { name: true, maxLength: 20 });
    requireText(member.positionInFamily, `${label} Position in Family`, { maxLength: 50 });

    if (!['Male', 'Female'].includes(member.gender)) errors.push(`${label} Sex is required`);
    if (!['Single', 'Married', 'Widowed', 'Divorced'].includes(member.civilStatus)) errors.push(`${label} Civil Status is required`);

    if (!member.dateOfBirth) {
      errors.push(`${label} Date of Birth is required`);
    } else {
      const selectedDate = new Date(member.dateOfBirth);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      selectedDate.setHours(0, 0, 0, 0);
      if (Number.isNaN(selectedDate.getTime())) errors.push(`${label} Date of Birth is invalid`);
      else if (selectedDate > today) errors.push(`${label} Date of Birth cannot be later than today`);
    }

    requireText(member.placeOfBirth, `${label} Place of Birth`, { maxLength: 80 });
    const phone = String(member.phone || '').replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) errors.push(`${label} Contact# must be 11 digits and start with 09`);
    requireText(member.religion, `${label} Religion`, { maxLength: 60 });
    if (member.lengthOfStay === undefined || member.lengthOfStay === null || String(member.lengthOfStay).trim() === '') {
      errors.push(`${label} Length of Stay is required`);
    } else if (!/^\d+$/.test(String(member.lengthOfStay)) || Number(member.lengthOfStay) < 0 || Number(member.lengthOfStay) > 150) {
      errors.push(`${label} Length of Stay must be 0 to 150`);
    }
    requireText(member.educationalAttainment, `${label} Educational Attainment`, { maxLength: 80 });

    // Employment/Income (occupation/sourceOfIncome) and Valid ID & Number are intentionally excluded from validation.
    optionalText(member.specialCondition, `${label} Special Condition`, { maxLength: 80 });
    optionalText(member.vehicle, `${label} Vehicle`, { maxLength: 80 });
    optionalText(member.typeOfBusiness, `${label} Type of Business`, { maxLength: 80 });
    optionalText(member.remarks, `${label} Remarks`, { maxLength: 120 });
  });

  return errors;
}


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

    // Validate residents fields. Employment/Income and Valid ID & Number are excluded.
    const validationErrors = validateResidentPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0], errors: validationErrors });
    }

    // Use householdnumber if provided, otherwise fall back to name
    const houseNum = normalizeText(householdnumber || name);

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

    const memberFilter = { 
      $or: [
        { householdId: objectId },
        { householdId: householdId }
      ]
    };
    const membersToDelete = await db.collection('members').find(memberFilter).project({ photo: 1 }).toArray();

    // Delete all members associated with this household - handle both ObjectId and string
    const membersResult = await db.collection('members').deleteMany(memberFilter);
    console.log(`Deleted ${membersResult.deletedCount} members`);
    membersToDelete.forEach(member => removeResidentPhotoFile(member.photo));

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

    // Validate residents fields. Employment/Income and Valid ID & Number are excluded.
    const validationErrors = validateResidentPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0], errors: validationErrors });
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

    const existingMembers = await Member.find({ 
      $or: [
        { householdId: householdId },
        { householdId: householdId.toString() }
      ]
    }).lean();
    const existingById = new Map(existingMembers.map(member => [String(member._id), member]));
    const submittedIds = new Set(
      members
        .map(member => member._id || member.id)
        .filter(Boolean)
        .map(String)
    );

    // Delete old members, then recreate using the same _id when supplied by the
    // edit form. This preserves the resident photo database path during edits.
    await Member.deleteMany({ 
      $or: [
        { householdId: householdId },
        { householdId: householdId.toString() }
      ]
    });

    const memberPromises = members.map(memberData => {
      const existingId = memberData._id || memberData.id;
      const existing = existingId ? existingById.get(String(existingId)) : null;
      const cleanMemberData = { ...memberData };
      delete cleanMemberData.id;

      const member = new Member({
        ...cleanMemberData,
        _id: existing && existing._id ? existing._id : cleanMemberData._id,
        householdId: householdId,
        photo: cleanMemberData.photo || (existing ? existing.photo : '') || ''
      });
      return member.save();
    });

    const updatedMembers = await Promise.all(memberPromises);

    // If a member was removed from the household edit form, remove that member's photo file too.
    existingMembers
      .filter(member => !submittedIds.has(String(member._id)))
      .forEach(member => removeResidentPhotoFile(member.photo));

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