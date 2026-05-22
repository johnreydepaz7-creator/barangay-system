const express = require('express');
const router = express.Router();
const backupService = require('../services/backupService');
const path = require('path');
const fs = require('fs');
const os = require('os');

function normalizeUserPath(inputPath) {
  const fallback = backupService.getDefaultBackupPath();
  const rawPath = inputPath && String(inputPath).trim() ? String(inputPath).trim() : fallback;
  return backupService.resolvePath(rawPath);
}

function isPathAllowed(targetPath) {
  const normalized = path.resolve(targetPath);

  if (process.platform === 'win32') {
    const parsed = path.parse(normalized);
    return /^[a-zA-Z]:\\?$/.test(parsed.root);
  }

  const allowedRoots = ['/', '/home', '/var', '/opt', '/srv', '/mnt', '/media', '/tmp'];
  return allowedRoots.some(root => normalized === root || normalized.startsWith(root + path.sep));
}

function getWindowsDriveFolders() {
  const folders = [];
  for (let code = 67; code <= 90; code++) {
    const drive = String.fromCharCode(code) + ':\\';
    try {
      if (fs.existsSync(drive)) {
        folders.push({ name: drive, path: drive });
      }
    } catch (_) {}
  }
  return folders;
}

// Create a manual backup
router.post('/create', async (req, res) => {
  try {
    const result = await backupService.createBackup();
    res.json({
      success: true,
      message: 'Backup created successfully',
      backup: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List all backups
router.get('/list', async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    const formattedBackups = backups.map(backup => ({
      ...backup,
      sizeFormatted: backupService.formatFileSize(backup.size),
      createdDate: new Date(backup.created).toLocaleString('en-PH')
    }));
    
    res.json({
      success: true,
      backups: formattedBackups,
      count: formattedBackups.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Download a backup file from the PC/server folder, or from MongoDB when the local file is missing
router.get('/download/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;
    await backupService.downloadBackup(fileName, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
});

// Restore from backup
router.post('/restore', async (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        error: 'Backup fileName is required'
      });
    }

    const result = await backupService.restoreBackup(fileName);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Import a backup file from the user's PC and restore it.
// This is used when both the PC/server backup copy and MongoDB copy are missing,
// but the user still has a separate .tar.gz backup file.
router.post('/import-restore', async (req, res) => {
  const originalFileName = decodeURIComponent(req.headers['x-backup-filename'] || '');
  const safeHeaderName = path.basename(originalFileName);

  if (!safeHeaderName || !safeHeaderName.toLowerCase().endsWith('.tar.gz')) {
    return res.status(400).json({
      success: false,
      error: 'Please select a valid .tar.gz backup file'
    });
  }

  const maxBytes = 500 * 1024 * 1024; // 500 MB safety limit
  const uploadDir = path.join(os.tmpdir(), 'barangay-backup-imports');
  fs.mkdirSync(uploadDir, { recursive: true });

  const tempFilePath = path.join(uploadDir, `import-${Date.now()}-${safeHeaderName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  const writeStream = fs.createWriteStream(tempFilePath);
  let receivedBytes = 0;
  let finished = false;

  req.on('data', chunk => {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes && !finished) {
      finished = true;
      writeStream.destroy();
      req.destroy(new Error('Backup file is too large. Maximum allowed size is 500 MB.'));
    }
  });

  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    if (finished) return;
    finished = true;

    try {
      if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
        throw new Error('Uploaded backup file is empty');
      }

      const result = await backupService.restoreUploadedBackup(tempFilePath, safeHeaderName);

      try { fs.unlinkSync(tempFilePath); } catch (_) {}

      res.json({
        success: true,
        message: 'Imported backup restored successfully',
        backup: result
      });
    } catch (error) {
      try { fs.unlinkSync(tempFilePath); } catch (_) {}
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  writeStream.on('error', error => {
    if (finished) return;
    finished = true;
    try { fs.unlinkSync(tempFilePath); } catch (_) {}
    res.status(500).json({
      success: false,
      error: `Upload failed: ${error.message}`
    });
  });

  req.on('error', error => {
    if (finished) return;
    finished = true;
    try { writeStream.destroy(); } catch (_) {}
    try { fs.unlinkSync(tempFilePath); } catch (_) {}
    res.status(400).json({
      success: false,
      error: error.message
    });
  });
});

// Delete a backup
router.delete('/delete/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        error: 'Backup fileName is required'
      });
    }

    const result = await backupService.deleteBackup(fileName);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get backup status
router.get('/status', async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    const lastBackup = backups[0];

    res.json({
      success: true,
      configured: true,
      totalBackups: backups.length,
      lastBackup: lastBackup ? {
        fileName: lastBackup.fileName,
        created: lastBackup.created,
        size: backupService.formatFileSize(lastBackup.size),
        createdDate: new Date(lastBackup.created).toLocaleString('en-PH')
      } : null,
      scheduledPath: '0 2 * * * (Daily at 2 AM)',
      storagePath: 'PC/server backup folder + MongoDB GridFS copy'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get backup settings
router.get('/settings', async (req, res) => {
  try {
    const config = backupService.loadSettings();
    const defaultBackupPath = backupService.getDefaultBackupPath();
    const backupPath = backupService.resolvePath(config.backupPath || defaultBackupPath);

    res.json({
      success: true,
      schedule: config.schedule || { frequency: 'daily', time: '02:00' },
      backupPath,
      defaultBackupPath,
      maxBackups: 10
    });
  } catch (error) {
    console.error('Failed to read settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read settings'
    });
  }
});

// Save backup settings
router.post('/settings', async (req, res) => {
  try {
    const { schedule, maxBackups, backupPath } = req.body;

    if (!schedule || !schedule.frequency || !schedule.time) {
      return res.status(400).json({
        success: false,
        error: 'Invalid schedule parameters'
      });
    }

    const resolvedBackupPath = normalizeUserPath(backupPath);

    if (!isPathAllowed(resolvedBackupPath)) {
      return res.status(403).json({
        success: false,
        error: 'This backup path is not allowed'
      });
    }

    try {
      fs.mkdirSync(resolvedBackupPath, { recursive: true });
      fs.accessSync(resolvedBackupPath, fs.constants.W_OK);
    } catch (pathError) {
      return res.status(400).json({
        success: false,
        error: `Backup location is not writable: ${pathError.message}`
      });
    }

    const configPath = path.join(__dirname, '../config/backupConfig.json');
    const existingConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const config = {
      ...existingConfig,
      schedule: {
        frequency: schedule.frequency,
        time: schedule.time
      },
      backupPath: resolvedBackupPath,
      maxBackups: 10,
      lastUpdated: new Date().toISOString()
    };

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    backupService.backupsDir = resolvedBackupPath;

    res.json({
      success: true,
      message: 'Settings saved successfully',
      settings: config
    });
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save settings'
    });
  }
});

// Browse folders for folder picker
router.get('/folders', async (req, res) => {
  try {
    const requestedPath = req.query.path || backupService.getDefaultBackupPath();

    if (process.platform === 'win32' && (requestedPath === '/' || requestedPath === 'root' || requestedPath === '')) {
      return res.json({
        success: true,
        currentPath: 'This PC',
        parentPath: null,
        folders: getWindowsDriveFolders(),
        canGoUp: false
      });
    }

    const normalizedPath = normalizeUserPath(requestedPath);

    if (!isPathAllowed(normalizedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this path'
      });
    }

    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({
        success: false,
        error: 'Path does not exist'
      });
    }

    const stats = fs.statSync(normalizedPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Path is not a directory'
      });
    }

    const entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
    const folders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(normalizedPath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parsed = path.parse(normalizedPath);
    let parentPath = null;
    if (process.platform === 'win32') {
      parentPath = normalizedPath === parsed.root ? 'root' : path.dirname(normalizedPath);
    } else if (normalizedPath !== '/') {
      parentPath = path.dirname(normalizedPath);
    }

    res.json({
      success: true,
      currentPath: normalizedPath,
      parentPath,
      folders,
      canGoUp: parentPath !== null
    });
  } catch (error) {
    console.error('Failed to browse folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get default home path
router.get('/default-path', async (req, res) => {
  try {
    const defaultBackupPath = backupService.getDefaultBackupPath();
    fs.mkdirSync(defaultBackupPath, { recursive: true });

    res.json({
      success: true,
      path: defaultBackupPath,
      homePath: os.homedir(),
      hostname: os.hostname(),
      platform: process.platform
    });
  } catch (error) {
    console.error('Failed to get default path:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search folders recursively
router.get('/search-folders', async (req, res) => {
  try {
    const searchTerm = req.query.term || '';
    const startPath = req.query.path || backupService.getDefaultBackupPath();
    const maxDepth = parseInt(req.query.maxDepth) || 5;
    
    if (!searchTerm) {
      return res.json({
        success: true,
        results: []
      });
    }

    const results = [];
    const searchLower = searchTerm.toLowerCase();
    let folderCount = 0;
    const maxResults = 50; // Limit results to prevent overwhelming the UI

    const normalizedStart = normalizeUserPath(startPath);

    if (!isPathAllowed(normalizedStart)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this path'
      });
    }

    // Recursive function to search folders
    function searchRecursive(dir, depth = 0) {
      if (folderCount >= maxResults || depth > maxDepth) {
        return;
      }

      try {
        if (!fs.existsSync(dir)) return;
        
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (folderCount >= maxResults) break;

          try {
            if (entry.isDirectory()) {
              const fullPath = path.join(dir, entry.name);
              
              // Check if folder name matches search term
              if (entry.name.toLowerCase().includes(searchLower)) {
                results.push({
                  name: entry.name,
                  path: fullPath,
                  depth: depth
                });
                folderCount++;
              }

              // Recursively search subdirectories
              if (depth < maxDepth) {
                searchRecursive(fullPath, depth + 1);
              }
            }
          } catch (err) {
            // Skip folders we can't access
            continue;
          }
        }
      } catch (err) {
        // Skip directories we can't read
        return;
      }
    }

    // Start the search
    searchRecursive(normalizedStart);

    res.json({
      success: true,
      results: results,
      count: results.length
    });
  } catch (error) {
    console.error('Failed to search folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create a new folder
router.post('/create-folder', async (req, res) => {
  try {
    const { path: parentPath, folderName } = req.body;

    if (!parentPath || !folderName) {
      return res.status(400).json({
        success: false,
        error: 'Path and folder name are required'
      });
    }

    // Validate folder name
    if (folderName.includes('/') || folderName.includes('\\') || folderName.includes('\0')) {
      return res.status(400).json({
        success: false,
        error: 'Folder name contains invalid characters'
      });
    }

    const normalizedParentPath = normalizeUserPath(parentPath);

    if (!isPathAllowed(normalizedParentPath)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this path'
      });
    }

    // Check if parent path exists
    if (!fs.existsSync(normalizedParentPath)) {
      return res.status(404).json({
        success: false,
        error: 'Parent path does not exist'
      });
    }

    // Check if parent is a directory
    const stats = fs.statSync(normalizedParentPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Parent path is not a directory'
      });
    }

    // Create the new folder
    const newFolderPath = path.join(normalizedParentPath, folderName);

    // Check if folder already exists
    if (fs.existsSync(newFolderPath)) {
      return res.status(409).json({
        success: false,
        error: 'Folder already exists'
      });
    }

    // Create the folder
    fs.mkdirSync(newFolderPath, { recursive: false });

    res.json({
      success: true,
      message: `Folder "${folderName}" created successfully`,
      folderPath: newFolderPath
    });
  } catch (error) {
    console.error('Failed to create folder:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get backup location info
router.get('/location/info', async (req, res) => {
  try {
    const locationInfo = backupService.getBackupLocationInfo();
    res.json({
      success: true,
      ...locationInfo
    });
  } catch (error) {
    console.error('Failed to get backup location info:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Change backup location and migrate backups
router.post('/location/change', async (req, res) => {
  try {
    const { newPath } = req.body;

    if (!newPath || typeof newPath !== 'string' || newPath.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Valid newPath is required'
      });
    }

    const result = await backupService.changeBackupLocation(newPath.trim());
    
    res.json({
      success: true,
      message: 'Backup location changed and backups migrated successfully',
      result
    });
  } catch (error) {
    console.error('Failed to change backup location:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
