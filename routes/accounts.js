const express = require('express');
const router = express.Router();
const Account = require('../models/account');
const SystemSettings = require('../models/systemSettings');
const QRCode = require('qrcode');
const { writeActivityLog } = require('../services/activityLogger');

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '').replace(/^0+/, '');
}

function phoneLookupValues(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return Array.from(new Set([normalized, `0${normalized}`]));
}

async function findAccountByPhone(phone, excludeId = null) {
  const values = phoneLookupValues(phone);
  if (!values.length) return null;

  const query = { phone: { $in: values } };
  if (excludeId) query._id = { $ne: excludeId };

  return Account.findOne(query);
}

async function hasPunongBarangay(excludeId = null) {
  const query = { role: 'Punong Barangay' };
  if (excludeId) query._id = { $ne: excludeId };
  return Account.exists(query);
}


function isValidName(value, required = true) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return !required;
  return text.length >= 2 && text.length <= 60 && /^[A-Za-zÀ-ÖØ-öø-ÿÑñ .'-]+$/.test(text);
}

function isValidMobile(phone) {
  return /^9\d{9}$/.test(normalizePhone(phone));
}

function validateAccountPayload({ lastName, firstName, middleName, phone, role }, requireRole = true) {
  if (!isValidName(lastName, true)) return 'Last name is required and must contain letters only.';
  if (!isValidName(firstName, true)) return 'First name is required and must contain letters only.';
  if (!isValidName(middleName, false)) return 'Middle name must contain letters only.';
  if (requireRole && !role) return 'Role / Position is required.';
  if (!isValidMobile(phone)) return 'Enter a valid 10-digit Philippine mobile number starting with 9.';
  return null;
}

function defaultUserSettings(settings = {}) {
  return {
    theme: ['light', 'dark'].includes(settings.theme) ? settings.theme : 'light',
    compactMode: Boolean(settings.compactMode),
    autoLogoutMinutes: Number(settings.autoLogoutMinutes) || 10
  };
}


// Register new account (Punong Barangay or others)
router.post('/register', async (req, res) => {
  try {
    const { lastName, firstName, middleName, phone, role, googleDriveToken } = req.body;

    // Validation
    const validationError = validateAccountPayload({ lastName, firstName, middleName, phone, role }, true);
    if (validationError) {
      return res.status(400).json({ 
        success: false, 
        message: validationError 
      });
    }

    // Normalize phone number (remove spaces, trim, and remove leading 0)
    const normalizedPhone = normalizePhone(phone);

    // Check duplicate accounts using normalized phone values, including legacy 09... records.
    const existingAccount = await findAccountByPhone(normalizedPhone);
    if (existingAccount) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered. Please log in or use a different number.' 
      });
    }

    // Only one Punong Barangay account is allowed. Do not delete/replace silently.
    if (role === 'Punong Barangay' && await hasPunongBarangay()) {
      return res.status(409).json({
        success: false,
        message: 'A Punong Barangay account already exists. Delete or update the existing account first.'
      });
    }

    // Create new account
    // Auto-approve Punong Barangay, pending for others
    const status = role === 'Punong Barangay' ? 'approved' : 'pending';
    const newAccount = new Account({
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : '',
      phone: normalizedPhone,
      role: role,
      status: status,
      googleDriveToken: googleDriveToken || null,
      googleDriveTokenExpiry: null
    });

    await newAccount.save();

    // If Punong Barangay and has Google Drive token, save to system settings for all users
    if (role === 'Punong Barangay' && googleDriveToken) {
      try {
        await SystemSettings.findOneAndUpdate(
          { key: 'google_drive_token' },
          { 
            key: 'google_drive_token',
            value: googleDriveToken,
            type: 'token',
            description: 'Shared Google Drive token for all users'
          },
          { upsert: true, new: true }
        );
      } catch (settingsError) {
        console.error('Error saving Google Drive token to system settings:', settingsError);
        // Continue even if this fails - the token is still in the account
      }
    }

    await writeActivityLog({
      req,
      user: { firstName: newAccount.firstName, lastName: newAccount.lastName, role: newAccount.role, _id: newAccount._id },
      action: 'Registered Account',
      details: `${newAccount.firstName} ${newAccount.lastName} registered as ${newAccount.role}`,
      module: 'System'
    });

    const message = role === 'Punong Barangay' 
      ? 'Punong Barangay account registered successfully. You can now login.'
      : 'Registration submitted successfully. Awaiting approval.';
    
    res.json({ 
      success: true, 
      message: message,
      accountId: newAccount._id
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle duplicate key error more gracefully
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered. Please use a different number.' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Error during registration. Please try again.' 
    });
  }
});

// Admin add account (auto-approved)
router.post('/admin/add', async (req, res) => {
  try {
    const { lastName, firstName, middleName, phone, role } = req.body;

    // Validation
    const validationError = validateAccountPayload({ lastName, firstName, middleName, phone, role }, true);
    if (validationError) {
      return res.status(400).json({ 
        success: false, 
        message: validationError 
      });
    }

    // Normalize phone number (remove spaces, trim, and remove leading 0)
    const normalizedPhone = normalizePhone(phone);

    // Check duplicate accounts using normalized phone values, including legacy 09... records.
    const existingAccount = await findAccountByPhone(normalizedPhone);
    if (existingAccount) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered. Please use a different number.' 
      });
    }

    let replacedOldPunong = false;

    // Only one Punong Barangay account is allowed. Do not delete/replace silently.
    if (role === 'Punong Barangay' && await hasPunongBarangay()) {
      return res.status(409).json({
        success: false,
        message: 'A Punong Barangay account already exists. Delete or update the existing account first.'
      });
    }

    // Create new account - AUTO-APPROVE for admin-added accounts
    const newAccount = new Account({
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : '',
      phone: normalizedPhone,
      role: role,
      status: 'approved', // Admin-added accounts are always approved
      approvedAt: new Date(),
      approvedBy: 'Administrator'
    });

    await newAccount.save();

    res.json({ 
      success: true, 
      message: firstName + ' ' + lastName + ' registered successfully.',
      accountId: newAccount._id,
      replacedOldPunong: replacedOldPunong
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    
    // Handle duplicate key error more gracefully
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered. Please use a different number.' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Error during registration. Please try again.' 
    });
  }
});

// Get all accounts
router.get('/', async (req, res) => {
  try {
    const accounts = await Account.find().sort({ createdAt: -1 });
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get pending accounts
router.get('/pending', async (req, res) => {
  try {
    const accounts = await Account.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check if Punong Barangay is registered
router.get('/check/punong', async (req, res) => {
  try {
    const punongBarangay = await Account.findOne({ 
      role: 'Punong Barangay'
    });
    res.json({ 
      isRegistered: !!punongBarangay,
      punongBarangay: punongBarangay || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ALL SPECIFIC ROUTES MUST COME BEFORE THE GENERIC /:id ROUTE
// OTHERWISE EXPRESS WILL MATCH /:id FIRST AND FAIL
// ═══════════════════════════════════════════════════════════

// Get Google Drive token for logged-in user
router.get('/gdrive/token/:phone', async (req, res) => {
  try {
    let { phone } = req.params;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required.' 
      });
    }

    // Normalize phone number (remove spaces, trim, and leading 0)
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');

    const account = await Account.findOne({ 
      phone: { $regex: `^${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    res.json({ 
      success: true, 
      googleDriveToken: account.googleDriveToken || null,
      hasToken: !!account.googleDriveToken
    });
  } catch (error) {
    console.error('Token retrieval error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving Google Drive token.' 
    });
  }
});

// Update Google Drive token for an account
router.patch('/gdrive/token/:phone', async (req, res) => {
  try {
    let { phone } = req.params;
    const { googleDriveToken } = req.body;

    if (!phone || !googleDriveToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number and token are required.' 
      });
    }

    // Normalize phone number (remove spaces, trim, and leading 0)
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');

    const account = await Account.findOneAndUpdate(
      { phone: { $regex: `^${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { 
        googleDriveToken: googleDriveToken,
        googleDriveTokenExpiry: null
      },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Google Drive token updated.',
      account: {
        _id: account._id,
        firstName: account.firstName,
        lastName: account.lastName,
        phone: account.phone,
        role: account.role,
        hasGoogleDrive: !!account.googleDriveToken
      }
    });
  } catch (error) {
    console.error('Token update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating Google Drive token.' 
    });
  }
});

// Get system Google Drive token (shared for all users)
router.get('/gdrive/system-token', async (req, res) => {
  try {
    const systemToken = await SystemSettings.findOne({ key: 'google_drive_token' });

    if (!systemToken || !systemToken.value) {
      return res.json({ 
        success: false, 
        message: 'No Google Drive token configured for the system.',
        googleDriveToken: null,
        hasToken: false
      });
    }

    res.json({ 
      success: true, 
      googleDriveToken: systemToken.value,
      hasToken: true,
      message: 'System Google Drive token retrieved.'
    });
  } catch (error) {
    console.error('System token retrieval error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving system Google Drive token.',
      hasToken: false
    });
  }
});

// Set/update system Google Drive token (admin only)
router.post('/gdrive/system-token', async (req, res) => {
  try {
    const { googleDriveToken } = req.body;

    if (!googleDriveToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google Drive token is required.' 
      });
    }

    const systemToken = await SystemSettings.findOneAndUpdate(
      { key: 'google_drive_token' },
      { 
        key: 'google_drive_token',
        value: googleDriveToken,
        type: 'token',
        description: 'Shared Google Drive token for all users'
      },
      { upsert: true, new: true }
    );

    res.json({ 
      success: true, 
      message: 'System Google Drive token updated.',
      hasToken: true
    });
  } catch (error) {
    console.error('System token update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating system Google Drive token.' 
    });
  }
});

// Get current user's profile by phone
router.get('/profile/get', async (req, res) => {
  try {
    let { phone } = req.query;

    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required.' 
      });
    }

    // Normalize phone number - remove spaces and leading 0
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');

    // Search for account - try both with and without leading 0 for compatibility
    let account = await Account.findOne({ 
      phone: { $regex: `^${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });

    // If not found, try with leading 0 (for backward compatibility with existing accounts)
    if (!account) {
      account = await Account.findOne({ 
        phone: { $regex: `^0${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
    }

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    res.json({ 
      success: true,
      account: {
        _id: account._id,
        firstName: account.firstName,
        lastName: account.lastName,
        middleName: account.middleName || '',
        phone: account.phone,
        role: account.role,
        status: account.status,
        profileImage: account.profileImage || '',
        createdAt: account.createdAt
      }
    });
  } catch (error) {
    console.error('Profile retrieval error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving profile.' 
    });
  }
});


// Update current user's profile photo
router.put('/profile/photo', async (req, res) => {
  try {
    const { phone, profileImage } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    if (!profileImage || typeof profileImage !== 'string' || !profileImage.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Please upload a valid image file.' });
    }

    // Keep MongoDB documents small enough for profile photos.
    if (profileImage.length > 2.5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image is too large. Please upload a photo below 2 MB.' });
    }

    const account = await findAccountByPhone(phone);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    account.profileImage = profileImage;
    await account.save();

    if (req.session && req.session.user) {
      req.session.user.profileImage = profileImage;
    }

    await writeActivityLog({
      req,
      user: req.session?.user,
      action: 'Updated Profile Photo',
      details: `${account.firstName} ${account.lastName}`,
      module: 'Settings'
    });

    res.json({ success: true, message: 'Profile photo updated.', profileImage });
  } catch (error) {
    console.error('Profile photo update error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile photo.' });
  }
});

// Remove current user's profile photo
router.delete('/profile/photo', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const account = await findAccountByPhone(phone);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    account.profileImage = '';
    await account.save();

    if (req.session && req.session.user) {
      req.session.user.profileImage = '';
    }

    await writeActivityLog({
      req,
      user: req.session?.user,
      action: 'Removed Profile Photo',
      details: `${account.firstName} ${account.lastName}`,
      module: 'Settings'
    });

    res.json({ success: true, message: 'Profile photo removed.' });
  } catch (error) {
    console.error('Profile photo remove error:', error);
    res.status(500).json({ success: false, message: 'Error removing profile photo.' });
  }
});

// Update current user's profile
router.put('/profile/update', async (req, res) => {
  try {
    const { phone, firstName, lastName, middleName } = req.body;

    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required.' 
      });
    }

    // Normalize phone number - remove leading 0 and spaces
    const normalizedPhone = normalizePhone(phone);

    // Check if account exists - try both with and without leading 0
    let account = await Account.findOne({ 
      phone: { $regex: `^${normalizedPhone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });

    // If not found, try with leading 0 (backward compatibility)
    if (!account) {
      account = await Account.findOne({ 
        phone: { $regex: `^0${normalizedPhone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
    }

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    // Update fields that are provided
    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (middleName !== undefined) updateData.middleName = middleName.trim();

    const updatedAccount = await Account.findByIdAndUpdate(
      account._id,
      updateData,
      { new: true }
    );

    await writeActivityLog({
      req,
      action: 'Updated Profile',
      details: `${updatedAccount.firstName} ${updatedAccount.lastName}`,
      module: 'Settings'
    });

    res.json({ 
      success: true,
      message: 'Profile updated successfully.',
      account: {
        _id: updatedAccount._id,
        firstName: updatedAccount.firstName,
        lastName: updatedAccount.lastName,
        middleName: updatedAccount.middleName || '',
        phone: updatedAccount.phone,
        role: updatedAccount.role,
        status: updatedAccount.status
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating profile.' 
    });
  }
});

// Update user's phone number
router.put('/profile/phone', async (req, res) => {
  try {
    const { currentPhone, newPhone } = req.body;

    if (!currentPhone || !newPhone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current and new phone numbers are required.' 
      });
    }

    // Normalize phone numbers - remove leading 0 and spaces
    const normalizedCurrent = normalizePhone(currentPhone);
    const normalizedNew = normalizePhone(newPhone);

    // Validate new phone format
    if (normalizedNew.length !== 10 || !/^\d+$/.test(normalizedNew)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number must be 10 digits.' 
      });
    }

    // Find account by current phone first so changing to the same number is not treated as a duplicate.
    const account = await findAccountByPhone(normalizedCurrent);

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    // Check if new phone already exists on another account, including legacy 09... records.
    const existingAccount = await findAccountByPhone(normalizedNew, account._id);

    if (existingAccount) {
      return res.status(409).json({ 
        success: false, 
        message: 'This phone number is already registered.' 
      });
    }


    const updatedAccount = await Account.findByIdAndUpdate(
      account._id,
      { phone: normalizedNew },
      { new: true }
    );

    await writeActivityLog({
      req,
      action: 'Updated Phone Number',
      details: `${updatedAccount.firstName} ${updatedAccount.lastName}`,
      module: 'Settings'
    });

    res.json({ 
      success: true,
      message: 'Phone number updated successfully.',
      newPhone: updatedAccount.phone
    });
  } catch (error) {
    console.error('Phone update error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered.'
      });
    }
    res.status(500).json({ 
      success: false, 
      message: 'Error updating phone number.' 
    });
  }
});

// Get user settings
router.get('/settings/:phone', async (req, res) => {
  try {
    let { phone } = req.params;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required.' 
      });
    }

    // Normalize phone number
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');
    
    console.log('[Settings GET] Looking up phone:', phone);

    // Try to find account without leading 0 first
    let account = await Account.findOne({ 
      phone: { $regex: `^${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });

    // If not found, try with leading 0 (for backward compatibility with existing accounts)
    if (!account) {
      console.log('[Settings GET] Not found, trying with leading 0: 0' + phone);
      account = await Account.findOne({ 
        phone: { $regex: `^0${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
    }

    if (!account) {
      console.log('[Settings GET] Account not found for phone:', phone);
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    // Ensure userSettings exists with defaults
    if (!account.userSettings) {
      account.userSettings = {
        theme: 'light',
        compactMode: false,
        autoLogoutMinutes: 10
      };
      await account.save();
    } else if (!account.userSettings.autoLogoutMinutes) {
      account.userSettings.autoLogoutMinutes = 10;
      await account.save();
    }

    console.log('[Settings GET] Found account, returning settings:', account.userSettings);
    
    res.json({ 
      success: true,
      settings: account.userSettings
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching user settings.' 
    });
  }
});

// Save user settings
router.put('/settings/:phone', async (req, res) => {
  try {
    let { phone } = req.params;
    const { theme, compactMode, autoLogoutMinutes } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required.' 
      });
    }

    // Normalize phone number
    phone = phone.trim().replace(/\s+/g, '').replace(/^0/, '');
    
    console.log('[Settings PUT] Saving settings for phone:', phone, { theme, compactMode, autoLogoutMinutes });

    // Try to find account without leading 0 first
    let account = await Account.findOne({ 
      phone: { $regex: `^${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });

    // If not found, try with leading 0 (for backward compatibility with existing accounts)
    if (!account) {
      console.log('[Settings PUT] Not found, trying with leading 0: 0' + phone);
      account = await Account.findOne({ 
        phone: { $regex: `^0${phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
    }

    if (!account) {
      console.log('[Settings PUT] Account not found for phone:', phone);
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found.' 
      });
    }

    // Ensure userSettings object exists
    if (!account.userSettings) {
      account.userSettings = {
        theme: 'light',
        compactMode: false,
        autoLogoutMinutes: 10
      };
    }

    // Update settings
    if (theme !== undefined) {
      account.userSettings.theme = ['light', 'dark'].includes(theme) ? theme : 'light';
    }
    if (compactMode !== undefined) {
      account.userSettings.compactMode = Boolean(compactMode);
    }
    if (autoLogoutMinutes !== undefined) {
      const minutes = Number(autoLogoutMinutes);
      account.userSettings.autoLogoutMinutes = [1, 5, 10, 15, 30, 60, 120].includes(minutes) ? minutes : 10;
      if (req.session && req.session.user && String(req.session.user.phone || '').replace(/^0/, '') === phone) {
        req.session.cookie.maxAge = account.userSettings.autoLogoutMinutes * 60 * 1000;
      }
    }

    await account.save();

    await writeActivityLog({
      req,
      action: 'Updated Settings',
      details: `Theme: ${account.userSettings.theme}, Compact Mode: ${account.userSettings.compactMode ? 'On' : 'Off'}, Auto Logout: ${account.userSettings.autoLogoutMinutes || 10} minutes`,
      module: 'Settings'
    });

    console.log('[Settings PUT] Saved successfully:', account.userSettings);
    
    res.json({ 
      success: true,
      settings: account.userSettings
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error saving user settings.' 
    });
  }
});

// ═══════════════════════════════════════════════════════════
// GENERIC ROUTES (MUST COME AFTER SPECIFIC ROUTES)
// ═══════════════════════════════════════════════════════════

// Verify Punong Barangay login by phone
router.post('/verify/punong', async (req, res) => {
  try {
    let { phone } = req.body;

    if (!isValidMobile(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Enter a valid 10-digit Philippine mobile number starting with 9.' 
      });
    }

    // Normalize phone number - remove leading 0 and spaces
    phone = normalizePhone(phone);

    // Search for Punong Barangay - try both with and without leading 0
    let punongBarangay = await Account.findOne({ 
      phone: phone,
      role: 'Punong Barangay'
    });

    // If not found, try with leading 0 (backward compatibility)
    if (!punongBarangay) {
      punongBarangay = await Account.findOne({ 
        phone: '0' + phone,
        role: 'Punong Barangay'
      });
    }

    if (!punongBarangay) {
      return res.status(404).json({ 
        success: false, 
        message: 'No Punong Barangay account found for this number.' 
      });
    }

    // Punong Barangay accounts are always approved
    if (punongBarangay.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is not active. Please contact support.' 
      });
    }

    // Create session for persistent login
    req.session.user = {
      _id: punongBarangay._id,
      firstName: punongBarangay.firstName,
      lastName: punongBarangay.lastName,
      phone: punongBarangay.phone,
      role: punongBarangay.role,
      status: punongBarangay.status,
      profileImage: punongBarangay.profileImage || ''
    };
    req.session.cookie.maxAge = ((punongBarangay.userSettings && punongBarangay.userSettings.autoLogoutMinutes) || 10) * 60 * 1000;

    await writeActivityLog({
      req,
      user: req.session.user,
      action: 'Logged in',
      details: 'Punong Barangay login verified',
      module: 'System'
    });

    res.json({ 
      success: true, 
      message: 'Punong Barangay found.',
      account: punongBarangay
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error during verification. Please try again.' 
    });
  }
});

// Verify Staff account login by phone
router.post('/verify/staff', async (req, res) => {
  try {
    let { phone } = req.body;

    if (!isValidMobile(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Enter a valid 10-digit Philippine mobile number starting with 9.' 
      });
    }

    // Normalize phone number - remove leading 0 and spaces
    phone = normalizePhone(phone);

    // Search for account - try both with and without leading 0
    let account = await Account.findOne({ 
      phone: phone
    });

    // If not found, try with leading 0 (backward compatibility)
    if (!account) {
      account = await Account.findOne({ 
        phone: '0' + phone
      });
    }

    if (account && account.role === 'Punong Barangay') {
      return res.status(403).json({ 
        success: false, 
        message: 'Please use the Punong Barangay login.' 
      });
    }

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Phone number not found. Please register first.' 
      });
    }

    if (account.status === 'pending') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is awaiting approval by the Punong Barangay.' 
      });
    }

    if (account.status === 'rejected') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account registration was rejected.' 
      });
    }

    if (account.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is not active. Please contact the Punong Barangay.' 
      });
    }

    // Create session for persistent login
    req.session.user = {
      _id: account._id,
      firstName: account.firstName,
      lastName: account.lastName,
      phone: account.phone,
      role: account.role,
      status: account.status,
      profileImage: account.profileImage || ''
    };
    req.session.cookie.maxAge = ((account.userSettings && account.userSettings.autoLogoutMinutes) || 10) * 60 * 1000;

    await writeActivityLog({
      req,
      user: req.session.user,
      action: 'Logged in',
      details: 'Staff login verified',
      module: 'System'
    });

    res.json({ 
      success: true, 
      message: 'Account verified. Proceed to OTP.',
      account: account
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error during verification. Please try again.' 
    });
  }
});

// Get account by ID
router.get('/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json(account);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Approve account
router.patch('/:id/approve', async (req, res) => {
  try {
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: req.body.approvedBy || 'Admin'
      },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    await writeActivityLog({
      req,
      action: 'Approved Account',
      details: `${account.firstName} ${account.lastName} (${account.role})`,
      module: 'System'
    });
    res.json({ success: true, account });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reject account (Delete immediately)
router.patch('/:id/reject', async (req, res) => {
  try {
    const account = await Account.findByIdAndDelete(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    await writeActivityLog({
      req,
      action: 'Rejected Account',
      details: `${account.firstName} ${account.lastName} (${account.role})`,
      module: 'System'
    });
    res.json({ success: true, message: 'Account rejected and deleted', account });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete account
router.delete('/:id', async (req, res) => {
  try {
    const account = await Account.findByIdAndDelete(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    await writeActivityLog({
      req,
      action: 'Deleted Account',
      details: `${account.firstName} ${account.lastName} (${account.role})`,
      module: 'System'
    });
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate QR code as image (server-side to bypass CSP)
router.post('/generate-qrcode', async (req, res) => {
  try {
    const { encoded } = req.body;

    if (!encoded) {
      return res.status(400).json({ 
        success: false, 
        message: 'Encoded string is required.' 
      });
    }

    // Use qrcode library to generate QR code as data URL
    const qrCodeImage = await QRCode.toDataURL(encoded, {
      width: 180,
      margin: 1,
      color: {
        dark: '#1f6f43',
        light: '#ffffff'
      }
    });

    res.json({ 
      success: true,
      qrCodeImage: qrCodeImage
    });
  } catch (error) {
    console.error('QR code generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error generating QR code.' 
    });
  }
});

module.exports = router;
