const fs = require('fs');
const path = require('path');

function resolveUploadsRootDir() {
  const configured = process.env.UPLOADS_ROOT_DIR;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }

  const renderDiskMount = process.env.RENDER_DISK_MOUNT_PATH;
  if (renderDiskMount && renderDiskMount.trim()) {
    return path.join(path.resolve(renderDiskMount.trim()), 'uploads');
  }

  return path.join(__dirname, '..', 'uploads');
}

function getUploadsRootDir() {
  return resolveUploadsRootDir();
}

function getResidentUploadDir() {
  const configured = process.env.RESIDENT_UPLOAD_DIR;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }
  return path.join(getUploadsRootDir(), 'residents');
}

function ensureUploadDirectories() {
  fs.mkdirSync(getResidentUploadDir(), { recursive: true });
}

function resolveResidentPhotoFilePath(photoPath) {
  if (!photoPath || !String(photoPath).startsWith('/uploads/residents/')) return null;
  const fileName = path.basename(String(photoPath).replace(/\\/g, '/'));
  if (!fileName || fileName === '.' || fileName === '..') return null;
  return path.join(getResidentUploadDir(), fileName);
}

module.exports = {
  getUploadsRootDir,
  getResidentUploadDir,
  ensureUploadDirectories,
  resolveResidentPhotoFilePath
};
