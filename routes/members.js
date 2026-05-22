const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const Member = require('../models/member');
const { uploadResidentPhoto } = require('../middleware/upload');
const { resolveResidentPhotoFilePath } = require('../utils/storagePaths');

function removeUploadedFileIfPresent(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/residents/')) return;

  const fullPath = resolveResidentPhotoFilePath(filePath);
  if (!fullPath) return;
  fs.unlink(fullPath, (error) => {
    if (error && error.code !== 'ENOENT') {
      console.error('Error deleting resident photo:', error);
    }
  });
}

// GET /api/members - Get all members
router.get('/', async (req, res) => {
  try {
    const members = await Member.find().sort({ createdAt: -1 });
    res.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// GET /api/members/:id - Get a single member
router.get('/:id', async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(member);
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
});

// POST /api/members/:id/photo - Upload or replace a resident profile photo
router.post('/:id/photo', (req, res) => {
  uploadResidentPhoto.single('photo')(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({ success: false, error: uploadError.message || 'Invalid photo upload' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please choose a photo to upload.' });
    }

    try {
      const member = await Member.findById(req.params.id);
      if (!member) {
        removeUploadedFileIfPresent(`/uploads/residents/${req.file.filename}`);
        return res.status(404).json({ success: false, error: 'Member not found' });
      }

      const oldPhoto = member.photo;
      const photoPath = `/uploads/residents/${req.file.filename}`;
      member.photo = photoPath;
      await member.save();

      if (oldPhoto && oldPhoto !== photoPath) {
        removeUploadedFileIfPresent(oldPhoto);
      }

      res.json({ success: true, photo: photoPath });
    } catch (error) {
      removeUploadedFileIfPresent(`/uploads/residents/${req.file.filename}`);
      console.error('Error saving resident photo:', error);
      res.status(500).json({ success: false, error: 'Failed to save resident photo' });
    }
  });
});

// DELETE /api/members/:id/photo - Remove a resident profile photo
router.delete('/:id/photo', async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    const oldPhoto = member.photo;
    member.photo = '';
    await member.save();

    removeUploadedFileIfPresent(oldPhoto);
    res.json({ success: true, photo: '' });
  } catch (error) {
    console.error('Error deleting resident photo:', error);
    res.status(500).json({ success: false, error: 'Failed to delete resident photo' });
  }
});

module.exports = router;
