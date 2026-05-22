const path = require('path');
const multer = require('multer');
const { getResidentUploadDir, ensureUploadDirectories } = require('../utils/storagePaths');

ensureUploadDirectories();

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    ensureUploadDirectories();
    cb(null, getResidentUploadDir());
  },
  filename(req, file, cb) {
    const memberId = String(req.params.id || 'resident').replace(/[^a-zA-Z0-9_-]/g, '');
    const originalExtension = path.extname(file.originalname || '').toLowerCase();
    const mimeExtension = file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
        ? '.webp'
        : '.jpg';
    const extension = allowedExtensions.has(originalExtension) ? originalExtension : mimeExtension;
    cb(null, `${memberId}-${Date.now()}${extension}`);
  }
});

function imageOnlyFilter(req, file, cb) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
    return cb(new Error('Only JPG, PNG, and WEBP photos are allowed.'));
  }
  cb(null, true);
}

const uploadResidentPhoto = multer({
  storage,
  fileFilter: imageOnlyFilter,
  limits: {
    fileSize: 3 * 1024 * 1024
  }
});

module.exports = {
  uploadResidentPhoto
};
