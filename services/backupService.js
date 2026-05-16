const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const cron = require('node-cron');
const util = require('util');

const execPromise = util.promisify(exec);

class BackupService {
  constructor() {
    this.mongoUri = process.env.MONGODB_URI || 'mongodb://test123:test123@ac-5r7ji0j-shard-00-00.pynxl6o.mongodb.net:27017,ac-5r7ji0j-shard-00-01.pynxl6o.mongodb.net:27017,ac-5r7ji0j-shard-00-02.pynxl6o.mongodb.net:27017/barangay-management-system?ssl=true&replicaSet=atlas-140ctr-shard-0&authSource=admin&appName=barangaysystem';
    this.dbName = 'barangay-management-system';
    this.tempDir = path.join(__dirname, '../temp');
    this.configPath = path.join(__dirname, '../config/backupConfig.json');
    
    // Load backup path from config file, or use cross-platform default
    let backupPathFromConfig = null;
    let previousBackupPath = null;
    let config = {};
    
    try {
      if (fs.existsSync(this.configPath)) {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        backupPathFromConfig = config.backupPath;
        previousBackupPath = config.previousBackupPath; // Track previous location
      }
    } catch (error) {
      console.warn('Could not read backup config:', error.message);
    }
    
    // Use a Windows-friendly default location under the user's Documents folder when available.
    const defaultBackupPath = this.getDefaultBackupPath();
    this.backupsDir = this.resolvePath(backupPathFromConfig || defaultBackupPath);
    this.collectionsToBackup = ['households', 'members', 'accounts', 'activitylogs']; // Backup residents, members, user accounts, and activity logs

    // Create temp and backups directories if they don't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }

    // Check if backup path has changed and migrate backups
    if (previousBackupPath && previousBackupPath !== this.backupsDir) {
      this.migrateBackupsSync(previousBackupPath, this.backupsDir);
    } else if (!previousBackupPath && backupPathFromConfig) {
      // Handle case where user manually changed backupPath without previousBackupPath
      // Try to find backups in common locations
      const potentialOldLocations = [
        defaultBackupPath, // Default location
        path.join(os.homedir(), 'BarangayBackups'),
        path.join(os.homedir(), 'BarangayBackups', 'backups'),
        path.join(__dirname, '../backups'), // Old relative path
      ];

      for (const oldPath of potentialOldLocations) {
        if (oldPath !== this.backupsDir && fs.existsSync(oldPath)) {
          const files = fs.readdirSync(oldPath).filter(f => 
            f.startsWith('barangay-backup-') && f.endsWith('.tar.gz')
          );
          
          if (files.length > 0) {
            console.log(`\n🔍 Found ${files.length} backup(s) in previous location: ${oldPath}`);
            this.migrateBackupsSync(oldPath, this.backupsDir);
            previousBackupPath = oldPath;
            break;
          }
        }
      }
    }

    // Update the config with current backup path and previousBackupPath
    this.updateConfigPath(this.backupsDir, previousBackupPath);

    console.log('Backup Service initialized. Storage location: ' + this.backupsDir);
  }

  /**
   * Best default backup path.
   * On Windows this becomes: C:\Users\<user>\Documents\Barangay Management System\Backups.
   * On other systems this becomes: ~/Documents/Barangay Management System/Backups.
   */
  getDefaultBackupPath() {
    const homeDir = os.homedir();
    const documentsDir = path.join(homeDir, 'Documents');
    const baseDir = fs.existsSync(documentsDir) ? documentsDir : homeDir;
    return path.join(baseDir, 'Barangay Management System', 'Backups');
  }

  /**
   * Resolve path with dynamic home/Documents directory support.
   */
  resolvePath(backupPath) {
    if (!backupPath || backupPath === 'DYNAMIC_DOCUMENTS_BACKUP_DIR' || backupPath === 'DYNAMIC_HOME_DIR') {
      return this.getDefaultBackupPath();
    }

    const expandedPath = String(backupPath)
      .replace(/^~(?=$|[\/])/, os.homedir())
      .replace(/%USERPROFILE%/gi, os.homedir())
      .replace(/%HOMEPATH%/gi, process.env.HOMEPATH || os.homedir())
      .replace(/%DOCUMENTS%/gi, path.join(os.homedir(), 'Documents'));

    return path.resolve(expandedPath);
  }

  /**
   * Update config file with current backup path
   */
  updateConfigPath(currentPath, previousPath = null) {
    try {
      let config = {};
      if (fs.existsSync(this.configPath)) {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
      
      // Only update previousBackupPath if it's different from current
      if (previousPath !== null) {
        config.previousBackupPath = previousPath;
      } else if (config.backupPath && config.backupPath !== currentPath) {
        // Store current as previous if it's changing
        config.previousBackupPath = config.backupPath;
      }
      
      config.backupPath = currentPath;
      config.lastPathUpdate = new Date().toISOString();
      
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.warn('Could not update backup config path:', error.message);
    }
  }

  /**
   * Synchronously migrate backups from old location to new location
   */
  migrateBackupsSync(oldPath, newPath) {
    try {
      // Check if old path exists
      if (!fs.existsSync(oldPath)) {
        console.log('Previous backup location does not exist, skipping migration.');
        return;
      }

      // Get all backup files from old location
      let backupFiles = [];
      try {
        backupFiles = fs.readdirSync(oldPath)
          .filter(file => file.startsWith('barangay-backup-') && file.endsWith('.tar.gz'));
      } catch (error) {
        console.log('Could not read previous backup location:', error.message);
        return;
      }

      if (backupFiles.length === 0) {
        console.log('No backups found in previous location.');
        return;
      }

      console.log(`\n📦 Backup Location Changed - Migrating ${backupFiles.length} backup(s)...`);
      console.log(`From: ${oldPath}`);
      console.log(`To: ${newPath}\n`);

      // Ensure new directory exists
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }

      // Copy each backup file
      let successCount = 0;
      for (const file of backupFiles) {
        try {
          const oldFilePath = path.join(oldPath, file);
          const newFilePath = path.join(newPath, file);
          
          // Skip if file already exists in new location
          if (fs.existsSync(newFilePath)) {
            console.log(`⏭️  Skipping (already exists): ${file}`);
            continue;
          }

          // Copy the file
          fs.copyFileSync(oldFilePath, newFilePath);
          const fileSize = fs.statSync(newFilePath).size;
          const fileSizeMS = (fileSize / (1024 * 1024)).toFixed(2);
          console.log(`✅ Migrated: ${file} (${fileSizeMS} MB)`);
          successCount++;
        } catch (error) {
          console.error(`❌ Failed to migrate ${file}:`, error.message);
        }
      }

      console.log(`\n✨ Migration complete! ${successCount}/${backupFiles.length} backups copied successfully.\n`);
    } catch (error) {
      console.error('Migration process failed:', error.message);
    }
  }

  /**
   * Get the current backup path from config, or use the stored default
   */
  getBackupPath() {
    const configPath = path.join(__dirname, '../config/backupConfig.json');
    
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.backupPath) {
          return this.resolvePath(config.backupPath);
        }
      }
    } catch (error) {
      console.warn('Could not read backup config:', error.message);
    }
    
    return this.backupsDir;
  }


  /**
   * File Manager files can be large, so they are included only in the local PC/server
   * backup archive. They are not copied into the MongoDB backup archive copy.
   */
  getFileManagerCollections() {
    return {
      itemsCollection: 'file_manager_items',
      bucketName: 'fileManagerFiles'
    };
  }

  /**
   * Safely convert a File Manager path into a relative path inside the backup archive.
   */
  getSafeFileManagerRelativePath(filePath, fallbackName = 'file') {
    const raw = String(filePath || fallbackName || 'file')
      .replace(/^[a-zA-Z]:/, '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');

    const parts = raw
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => part.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'))
      .filter(part => part !== '.' && part !== '..');

    return parts.length ? parts.join('/') : String(fallbackName || 'file').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  }

  async streamGridFileToLocal(bucket, gridFsId, outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const fileId = typeof gridFsId === 'string' ? new ObjectId(gridFsId) : gridFsId;

    await new Promise((resolve, reject) => {
      bucket.openDownloadStream(fileId)
        .on('error', reject)
        .pipe(fs.createWriteStream(outputPath))
        .on('error', reject)
        .on('finish', resolve);
    });
  }

  async uploadLocalFileToGridFS(bucket, filePath, item, now) {
    const fileName = item.name || path.basename(filePath);
    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: item.mimeType || 'application/octet-stream',
      metadata: {
        path: item.path || fileName,
        parentPath: item.parentPath || '',
        originalName: fileName,
        mimeType: item.mimeType || 'application/octet-stream',
        restoredAt: now
      }
    });

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .on('error', reject)
        .pipe(uploadStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    return uploadStream.id;
  }

  /**
   * Export the File Manager folder tree and actual uploaded files into the local backup folder.
   * Nothing from this method is uploaded to MongoDB backupArchives.
   */
  async exportFileManagerToLocalBackup(db, backupDir) {
    const { itemsCollection, bucketName } = this.getFileManagerCollections();
    const items = await db.collection(itemsCollection)
      .find({})
      .sort({ path: 1, type: 1, name: 1 })
      .toArray();

    const fileManagerDir = path.join(backupDir, 'file-manager');
    const filesDir = path.join(fileManagerDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });

    const bucket = new GridFSBucket(db, { bucketName });
    const exportedItems = [];
    const errors = [];
    let exportedFiles = 0;
    let exportedFolders = 0;
    let exportedBytes = 0;

    for (const item of items) {
      const exportedItem = { ...item };
      if (exportedItem._id) exportedItem._id = exportedItem._id.toString();
      if (exportedItem.gridFsId) exportedItem.originalGridFsId = exportedItem.gridFsId.toString();

      if (item.type === 'folder') {
        exportedFolders += 1;
        const relFolder = this.getSafeFileManagerRelativePath(item.path || item.name, item.name || 'folder');
        fs.mkdirSync(path.join(filesDir, relFolder), { recursive: true });
        exportedItems.push(exportedItem);
        continue;
      }

      if (item.type === 'file' && item.gridFsId) {
        const relFile = this.getSafeFileManagerRelativePath(item.path || item.name, item.name || 'file');
        const outputPath = path.join(filesDir, relFile);
        try {
          await this.streamGridFileToLocal(bucket, item.gridFsId, outputPath);
          const stat = fs.statSync(outputPath);
          exportedItem.localFilePath = path.posix.join('file-manager', 'files', ...relFile.split('/'));
          exportedItem.size = stat.size;
          exportedFiles += 1;
          exportedBytes += stat.size;
        } catch (error) {
          errors.push({ path: item.path || item.name, error: error.message });
          exportedItem.localBackupError = error.message;
        }
      }

      exportedItems.push(exportedItem);
    }

    const manifest = {
      storage: 'local-backup-only',
      source: 'File Manager',
      itemsCollection,
      bucketName,
      createdAt: new Date().toISOString(),
      totalItems: items.length,
      exportedFiles,
      exportedFolders,
      exportedBytes,
      errors,
      items: exportedItems
    };

    fs.writeFileSync(path.join(fileManagerDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return {
      included: true,
      localOnly: true,
      items: exportedItems,
      stats: {
        totalItems: items.length,
        files: exportedFiles,
        folders: exportedFolders,
        bytes: exportedBytes,
        errors: errors.length
      },
      errors
    };
  }

  async createDatabaseOnlyBackupArchive(timestamp, backupData, metadata) {
    const dbOnlyDir = path.join(this.tempDir, `backup-${timestamp}-database-copy`);
    const dbOnlyArchive = path.join(this.tempDir, `barangay-backup-${timestamp}-database-copy.tar.gz`);

    fs.mkdirSync(dbOnlyDir, { recursive: true });
    fs.writeFileSync(path.join(dbOnlyDir, 'data.json'), JSON.stringify(backupData, null, 2));
    fs.writeFileSync(path.join(dbOnlyDir, 'metadata.json'), JSON.stringify({
      ...metadata,
      fileManager: {
        included: false,
        reason: 'File Manager files are local-backup-only to avoid saving them in MongoDB.'
      }
    }, null, 2));

    await execPromise(`tar -czf "${dbOnlyArchive}" -C "${this.tempDir}" "backup-${timestamp}-database-copy"`);
    this.cleanupTempFiles(dbOnlyDir);
    return dbOnlyArchive;
  }

  async restoreFileManagerFromLocalBackup(db, backupContentDir, backupData) {
    const { itemsCollection, bucketName } = this.getFileManagerCollections();
    const fileManagerDir = path.join(backupContentDir, 'file-manager');
    const manifestPath = path.join(fileManagerDir, 'manifest.json');

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    const items = Array.isArray(backupData.file_manager_items)
      ? backupData.file_manager_items
      : (manifest && Array.isArray(manifest.items) ? manifest.items : []);

    if (!items.length) {
      return { restored: false, files: 0, folders: 0, reason: 'No File Manager data found in this backup.' };
    }

    const bucket = new GridFSBucket(db, { bucketName });

    // Clear current File Manager files from GridFS and item records before restoring.
    const existingGridFiles = await db.collection(`${bucketName}.files`).find({}).project({ _id: 1 }).toArray();
    for (const file of existingGridFiles) {
      try {
        await bucket.delete(file._id);
      } catch (error) {
        console.warn('Could not delete existing File Manager GridFS file during restore:', error.message);
      }
    }
    await db.collection(itemsCollection).deleteMany({});

    const sortedItems = [...items].sort((a, b) => {
      const depthA = String(a.path || '').split('/').filter(Boolean).length;
      const depthB = String(b.path || '').split('/').filter(Boolean).length;
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return depthA - depthB;
    });

    let restoredFiles = 0;
    let restoredFolders = 0;
    const now = new Date();

    for (const item of sortedItems) {
      const restored = { ...item };
      delete restored.localFilePath;
      delete restored.originalGridFsId;
      delete restored.localBackupError;

      if (restored._id && typeof restored._id === 'string') {
        try {
          restored._id = new ObjectId(restored._id);
        } catch (error) {
          delete restored._id;
        }
      }

      restored.createdAt = restored.createdAt ? new Date(restored.createdAt) : now;
      restored.updatedAt = restored.updatedAt ? new Date(restored.updatedAt) : now;

      if (item.type === 'file') {
        const localRel = item.localFilePath || path.posix.join('file-manager', 'files', this.getSafeFileManagerRelativePath(item.path || item.name, item.name || 'file'));
        const localFilePath = path.join(backupContentDir, ...String(localRel).split('/'));
        if (!fs.existsSync(localFilePath)) {
          console.warn(`Skipping File Manager file during restore because content is missing: ${item.path || item.name}`);
          continue;
        }

        const newGridFsId = await this.uploadLocalFileToGridFS(bucket, localFilePath, item, now);
        restored.gridFsId = newGridFsId;
        restored.size = fs.statSync(localFilePath).size;
        restoredFiles += 1;
      } else if (item.type === 'folder') {
        restored.gridFsId = undefined;
        restored.size = 0;
        restoredFolders += 1;
      }

      await db.collection(itemsCollection).insertOne(restored);
    }

    await db.collection(itemsCollection).createIndex({ parentPath: 1, name: 1 }, { unique: true });
    await db.collection(itemsCollection).createIndex({ path: 1 }, { unique: true });
    await db.collection(itemsCollection).createIndex({ type: 1, updatedAt: -1 });

    return {
      restored: true,
      files: restoredFiles,
      folders: restoredFolders,
      totalItems: restoredFiles + restoredFolders
    };
  }

  /**
   * Create a backup - exports database data and includes File Manager data in the local archive only.
   */
  async createBackup() {
    let client = null;
    let dbOnlyArchive = null;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.tempDir, `backup-${timestamp}`);
      const backupPathToUse = this.getBackupPath();
      const backupFile = path.join(backupPathToUse, `barangay-backup-${timestamp}.tar.gz`);

      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      if (!fs.existsSync(backupPathToUse)) {
        fs.mkdirSync(backupPathToUse, { recursive: true });
      }

      console.log('Connecting to MongoDB...');
      client = new MongoClient(this.mongoUri);
      await client.connect();
      
      const db = client.db(this.dbName);

      console.log('Exporting data from MongoDB...');
      const databaseOnlyData = {};
      const localBackupData = {};

      for (const collectionName of this.collectionsToBackup) {
        console.log(`  - Exporting ${collectionName}...`);
        const data = await db.collection(collectionName).find({}).toArray();
        databaseOnlyData[collectionName] = data;
        localBackupData[collectionName] = data;
        console.log(`    Exported ${data.length} documents`);
      }

      console.log('Exporting File Manager data to local backup only...');
      const fileManagerExport = await this.exportFileManagerToLocalBackup(db, backupDir);
      localBackupData.file_manager_items = fileManagerExport.items;

      const backupJson = path.join(backupDir, 'data.json');
      fs.writeFileSync(backupJson, JSON.stringify(localBackupData, null, 2));

      const metadata = {
        timestamp: new Date().toISOString(),
        database: this.dbName,
        version: '1.1.0',
        collections: [...this.collectionsToBackup, 'file_manager_items'],
        docCounts: Object.keys(localBackupData).reduce((acc, col) => {
          acc[col] = localBackupData[col].length;
          return acc;
        }, {}),
        fileManager: {
          included: true,
          localOnly: true,
          folder: 'file-manager/files',
          note: 'File Manager files/folders are included only in the local PC/server backup archive and are not uploaded to MongoDB backupArchives.',
          stats: fileManagerExport.stats,
          errors: fileManagerExport.errors
        }
      };

      fs.writeFileSync(
        path.join(backupDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      console.log('Compressing local backup with File Manager data...');
      await execPromise(`tar -czf "${backupFile}" -C "${this.tempDir}" "backup-${timestamp}"`);

      const fileSize = fs.statSync(backupFile).size;
      const fileName = `barangay-backup-${timestamp}.tar.gz`;

      console.log(`Backup created successfully: ${fileName}`);

      // Save only the database collections copy to MongoDB. File Manager files remain local-only.
      let databaseBackup = { saved: false, fileId: null, recordId: null, error: null, fileManagerIncluded: false };
      try {
        dbOnlyArchive = await this.createDatabaseOnlyBackupArchive(timestamp, databaseOnlyData, metadata);
        const dbOnlySize = fs.statSync(dbOnlyArchive).size;
        databaseBackup = await this.saveBackupArchiveToDatabase(db, dbOnlyArchive, fileName, {
          ...metadata,
          collections: this.collectionsToBackup,
          docCounts: Object.keys(databaseOnlyData).reduce((acc, col) => {
            acc[col] = databaseOnlyData[col].length;
            return acc;
          }, {}),
          fileManager: {
            included: false,
            localOnly: true,
            note: 'Excluded from MongoDB backup copy. File Manager data is stored only in the local PC/server backup archive.'
          }
        }, dbOnlySize);
        databaseBackup.fileManagerIncluded = false;
        console.log(`Database-only backup also saved in MongoDB: ${databaseBackup.saved ? 'yes' : 'no'}`);
      } catch (dbBackupError) {
        databaseBackup.error = dbBackupError.message;
        console.warn('Local backup was created, but MongoDB backup copy failed:', dbBackupError.message);
      }

      const retention = await this.enforceBackupLimit(db);

      this.cleanupTempFiles(backupDir);
      if (dbOnlyArchive && fs.existsSync(dbOnlyArchive)) {
        fs.unlinkSync(dbOnlyArchive);
      }

      return {
        success: true,
        fileName: fileName,
        timestamp: metadata.timestamp,
        size: fileSize,
        localPath: backupFile,
        downloadUrl: `/api/backup/download/${encodeURIComponent(fileName)}`,
        fileManager: metadata.fileManager,
        databaseBackup,
        retention
      };
    } catch (error) {
      console.error('Backup failed:', error.message);
      throw new Error(`Backup failed: ${error.message}`);
    } finally {
      if (client) {
        await client.close();
      }
      if (dbOnlyArchive && fs.existsSync(dbOnlyArchive)) {
        try { fs.unlinkSync(dbOnlyArchive); } catch (error) { /* ignore cleanup errors */ }
      }
    }
  }

  /**
   * Save the compressed backup archive in MongoDB using GridFS.
   * This keeps a database copy of the same file that was saved locally on the PC/server.
   */
  async saveBackupArchiveToDatabase(db, backupFilePath, fileName, metadata, fileSize) {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error('Backup file does not exist, cannot save to MongoDB');
    }

    const bucket = new GridFSBucket(db, { bucketName: 'backupArchives' });
    const sourceStream = fs.createReadStream(backupFilePath);
    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: 'application/gzip',
      metadata: {
        ...metadata,
        fileName,
        size: fileSize,
        createdAt: new Date(),
        source: 'manual-or-automatic-backup'
      }
    });

    await new Promise((resolve, reject) => {
      sourceStream
        .pipe(uploadStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    const record = {
      fileName,
      gridFsFileId: uploadStream.id,
      size: fileSize,
      createdAt: new Date(),
      metadata,
      localPath: backupFilePath,
      storage: {
        pc: true,
        mongodb: true,
        bucketName: 'backupArchives'
      }
    };

    const insertResult = await db.collection('backupRecords').insertOne(record);

    return {
      saved: true,
      fileId: uploadStream.id.toString(),
      recordId: insertResult.insertedId.toString()
    };
  }

  /**
   * Maximum backup retention.
   * The system must keep only the latest 10 backups in both PC/server storage and MongoDB.
   */
  getMaxBackupRetention() {
    return 10;
  }

  /**
   * Delete one MongoDB backup record and its GridFS archive copy.
   */
  async deleteDatabaseBackupCopy(db, record) {
    if (!record) {
      return false;
    }

    try {
      if (record.gridFsFileId) {
        const bucket = new GridFSBucket(db, { bucketName: 'backupArchives' });
        const fileId = typeof record.gridFsFileId === 'string'
          ? new ObjectId(record.gridFsFileId)
          : record.gridFsFileId;
        await bucket.delete(fileId);
      }
    } catch (gridError) {
      // Continue removing the record even if the GridFS file was already missing.
      console.warn(`MongoDB backup archive file could not be deleted for ${record.fileName}:`, gridError.message);
    }

    await db.collection('backupRecords').deleteOne({ _id: record._id });
    return true;
  }

  /**
   * Keep only the newest 10 local backup files in the PC/server folder.
   */
  pruneLocalBackups(maxBackups = this.getMaxBackupRetention()) {
    const backupPathToUse = this.getBackupPath();
    if (!fs.existsSync(backupPathToUse)) {
      fs.mkdirSync(backupPathToUse, { recursive: true });
      return [];
    }

    const backups = fs.readdirSync(backupPathToUse)
      .filter(file => file.startsWith('barangay-backup-') && file.endsWith('.tar.gz'))
      .map(file => {
        const filePath = path.join(backupPathToUse, file);
        const stat = fs.statSync(filePath);
        return { fileName: file, filePath, createdMs: stat.mtimeMs };
      })
      .sort((a, b) => b.createdMs - a.createdMs);

    const backupsToRemove = backups.slice(maxBackups);
    const removed = [];

    for (const backup of backupsToRemove) {
      try {
        fs.unlinkSync(backup.filePath);
        removed.push(backup.fileName);
        console.log(`Old local backup removed by retention limit: ${backup.fileName}`);
      } catch (error) {
        console.warn(`Could not remove old local backup ${backup.fileName}:`, error.message);
      }
    }

    return removed;
  }

  /**
   * Keep only the newest 10 MongoDB backup copies.
   */
  async pruneDatabaseBackups(db, maxBackups = this.getMaxBackupRetention()) {
    const records = await db.collection('backupRecords')
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    const recordsToRemove = records.slice(maxBackups);
    const removed = [];

    for (const record of recordsToRemove) {
      try {
        await this.deleteDatabaseBackupCopy(db, record);
        removed.push(record.fileName);
        console.log(`Old MongoDB backup removed by retention limit: ${record.fileName}`);
      } catch (error) {
        console.warn(`Could not remove old MongoDB backup ${record.fileName}:`, error.message);
      }
    }

    return removed;
  }

  /**
   * Apply the 10-backup limit to both the PC/server backup folder and MongoDB.
   */
  async enforceBackupLimit(existingDb = null) {
    const maxBackups = this.getMaxBackupRetention();
    const removedLocal = this.pruneLocalBackups(maxBackups);

    let removedDatabase = [];
    let client = null;

    try {
      let db = existingDb;
      if (!db) {
        client = new MongoClient(this.mongoUri);
        await client.connect();
        db = client.db(this.dbName);
      }

      removedDatabase = await this.pruneDatabaseBackups(db, maxBackups);
    } catch (error) {
      console.warn('Backup retention applied locally, but MongoDB retention failed:', error.message);
    } finally {
      if (client) {
        await client.close();
      }
    }

    return {
      maxBackups,
      removedLocal,
      removedDatabase
    };
  }

  /**
   * Build and validate the full local backup file path for download/restore/delete actions.
   */
  getBackupFilePath(fileName) {
    return path.join(this.getBackupPath(), this.getSafeBackupFileName(fileName));
  }

  /**
   * Validate a backup file name and return the safe base name.
   */
  getSafeBackupFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('Backup file name is required');
    }

    const safeFileName = path.basename(fileName);
    if (safeFileName !== fileName || !safeFileName.startsWith('barangay-backup-') || !safeFileName.endsWith('.tar.gz')) {
      throw new Error('Invalid backup file name');
    }

    return safeFileName;
  }

  /**
   * List local backup files from the PC/server folder.
   */
  listLocalBackups() {
    const backupPathToUse = this.getBackupPath();

    if (!fs.existsSync(backupPathToUse)) {
      fs.mkdirSync(backupPathToUse, { recursive: true });
      return [];
    }

    return fs.readdirSync(backupPathToUse)
      .filter(file => file.startsWith('barangay-backup-') && file.endsWith('.tar.gz'))
      .map(file => {
        const filePath = path.join(backupPathToUse, file);
        const stat = fs.statSync(filePath);

        return {
          fileName: file,
          created: stat.mtime.toISOString(),
          size: stat.size,
          localPath: filePath,
          availableLocal: true,
          availableDatabase: false,
          source: 'pc',
          sources: ['PC/server']
        };
      });
  }

  /**
   * List backup archive records saved in MongoDB GridFS.
   */
  async listDatabaseBackups(existingDb = null) {
    let client = null;

    try {
      let db = existingDb;
      if (!db) {
        client = new MongoClient(this.mongoUri);
        await client.connect();
        db = client.db(this.dbName);
      }

      const records = await db.collection('backupRecords')
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .toArray();

      return records.map(record => ({
        fileName: record.fileName,
        created: (record.createdAt || record.metadata?.timestamp || new Date()).toISOString
          ? (record.createdAt || record.metadata?.timestamp || new Date()).toISOString()
          : new Date(record.createdAt || record.metadata?.timestamp || Date.now()).toISOString(),
        size: record.size || record.metadata?.size || 0,
        gridFsFileId: record.gridFsFileId,
        recordId: record._id,
        availableLocal: false,
        availableDatabase: true,
        source: 'database',
        sources: ['Database']
      })).filter(backup => backup.fileName);
    } catch (error) {
      console.warn('Could not list MongoDB backup copies:', error.message);
      return [];
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * List all backups by merging the PC/server folder and MongoDB GridFS records.
   * If either copy exists, the backup still appears in Recent Backups.
   */
  async listBackups() {
    try {
      const merged = new Map();

      for (const localBackup of this.listLocalBackups()) {
        merged.set(localBackup.fileName, localBackup);
      }

      for (const databaseBackup of await this.listDatabaseBackups()) {
        const existing = merged.get(databaseBackup.fileName);

        if (existing) {
          existing.availableDatabase = true;
          existing.gridFsFileId = databaseBackup.gridFsFileId;
          existing.recordId = databaseBackup.recordId;
          existing.source = 'both';
          existing.sources = ['PC/server', 'Database'];
          existing.size = existing.size || databaseBackup.size || 0;

          const existingCreated = new Date(existing.created).getTime();
          const dbCreated = new Date(databaseBackup.created).getTime();
          if (!existingCreated || dbCreated > existingCreated) {
            existing.created = databaseBackup.created;
          }
        } else {
          databaseBackup.sources = ['Database'];
          merged.set(databaseBackup.fileName, databaseBackup);
        }
      }

      return Array.from(merged.values())
        .map(backup => ({
          ...backup,
          availabilityLabel: backup.availableLocal && backup.availableDatabase
            ? 'PC/server + Database'
            : backup.availableLocal
              ? 'PC/server only'
              : 'Database only'
        }))
        .sort((a, b) => new Date(b.created) - new Date(a.created));
    } catch (error) {
      console.error('Failed to list backups:', error.message);
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  /**
   * Download a backup from the local PC/server folder when available, otherwise from MongoDB GridFS.
   */
  async downloadBackup(fileName, res) {
    const safeFileName = this.getSafeBackupFileName(fileName);
    const localFilePath = this.getBackupFilePath(safeFileName);

    if (fs.existsSync(localFilePath)) {
      return res.download(localFilePath, safeFileName);
    }

    let client = null;
    try {
      client = new MongoClient(this.mongoUri);
      await client.connect();
      const db = client.db(this.dbName);
      const record = await db.collection('backupRecords').findOne({ fileName: safeFileName });

      if (!record || !record.gridFsFileId) {
        return res.status(404).json({
          success: false,
          error: 'Backup file not found in PC/server folder or MongoDB'
        });
      }

      const bucket = new GridFSBucket(db, { bucketName: 'backupArchives' });
      const fileId = typeof record.gridFsFileId === 'string'
        ? new ObjectId(record.gridFsFileId)
        : record.gridFsFileId;

      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
      res.setHeader('Content-Type', 'application/gzip');

      bucket.openDownloadStream(fileId)
        .on('error', error => {
          if (!res.headersSent) {
            res.status(404).json({ success: false, error: error.message });
          } else {
            res.destroy(error);
          }
        })
        .on('end', async () => {
          if (client) {
            await client.close();
            client = null;
          }
        })
        .pipe(res);
    } catch (error) {
      if (client) {
        await client.close();
      }
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Ensure a backup archive exists as a local file before restore.
   * If the PC/server copy is missing, temporarily downloads the MongoDB GridFS copy.
   */
  async getRestorableBackupFile(fileName, restoreDir) {
    const safeFileName = this.getSafeBackupFileName(fileName);
    const localFilePath = this.getBackupFilePath(safeFileName);

    if (fs.existsSync(localFilePath)) {
      return localFilePath;
    }

    let client = null;
    try {
      client = new MongoClient(this.mongoUri);
      await client.connect();
      const db = client.db(this.dbName);
      const record = await db.collection('backupRecords').findOne({ fileName: safeFileName });

      if (!record || !record.gridFsFileId) {
        throw new Error(`Backup file not found in PC/server folder or MongoDB: ${safeFileName}`);
      }

      fs.mkdirSync(restoreDir, { recursive: true });
      const tempBackupFile = path.join(restoreDir, safeFileName);
      const bucket = new GridFSBucket(db, { bucketName: 'backupArchives' });
      const fileId = typeof record.gridFsFileId === 'string'
        ? new ObjectId(record.gridFsFileId)
        : record.gridFsFileId;

      await new Promise((resolve, reject) => {
        bucket.openDownloadStream(fileId)
          .pipe(fs.createWriteStream(tempBackupFile))
          .on('error', reject)
          .on('finish', resolve);
      });

      return tempBackupFile;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Restore data from a specific archive path.
   * This is used both by stored backups and by user-imported backup files.
   */
  async restoreBackupFromArchive(backupFilePath, displayName) {
    let client = null;
    const timestamp = Date.now();
    const restoreDir = path.join(this.tempDir, `restore-${timestamp}`);

    try {
      if (!backupFilePath || !fs.existsSync(backupFilePath)) {
        throw new Error('Backup archive file was not found');
      }

      console.log(`Extracting backup: ${displayName}`);
      const extractedDir = path.join(restoreDir, 'extracted');
      fs.mkdirSync(extractedDir, { recursive: true });

      // Extract the tar.gz file. The project backup format contains a backup-* folder.
      await execPromise(`tar -xzf "${backupFilePath}" -C "${extractedDir}"`);

      let backupContentDir = null;
      const files = fs.readdirSync(extractedDir);
      for (const file of files) {
        const fullPath = path.join(extractedDir, file);
        if (file.startsWith('backup-') && fs.statSync(fullPath).isDirectory()) {
          backupContentDir = fullPath;
          break;
        }
      }

      if (!backupContentDir) {
        throw new Error('Invalid backup file: backup directory not found');
      }

      const dataJsonPath = path.join(backupContentDir, 'data.json');
      if (!fs.existsSync(dataJsonPath)) {
        throw new Error('Invalid backup file: data.json not found');
      }

      const backupDataJson = fs.readFileSync(dataJsonPath, 'utf8');
      const backupData = JSON.parse(backupDataJson);

      console.log('Connecting to MongoDB...');
      client = new MongoClient(this.mongoUri);
      await client.connect();

      const db = client.db(this.dbName);
      const restoredCounts = {};

      console.log('Restoring data to MongoDB...');
      for (const collectionName of this.collectionsToBackup) {
        console.log(`  - Restoring ${collectionName}...`);

        let documents = backupData[collectionName] || [];

        try {
          const deleteResult = await db.collection(collectionName).deleteMany({});
          console.log(`    Cleared ${deleteResult.deletedCount} documents`);
        } catch (err) {
          console.log(`    Collection is new`);
        }

        documents = documents.map(doc => {
          const converted = { ...doc };

          if (converted._id && typeof converted._id === 'string') {
            try {
              converted._id = new ObjectId(converted._id);
            } catch (e) {
              console.log(`  Warning: Could not convert _id: ${converted._id}`);
            }
          }

          for (const key in converted) {
            if (key.endsWith('Id') && converted[key] && typeof converted[key] === 'string') {
              try {
                if (converted[key].match(/^[0-9a-fA-F]{24}$/)) {
                  converted[key] = new ObjectId(converted[key]);
                }
              } catch (e) {
                // Keep as string if conversion fails.
              }
            }
          }

          converted.__v = converted.__v !== undefined ? converted.__v : 0;
          return converted;
        });

        if (documents.length > 0) {
          try {
            const result = await db.collection(collectionName).insertMany(documents, { ordered: false });
            restoredCounts[collectionName] = result.insertedCount;
            console.log(`    Inserted ${result.insertedCount} documents`);
          } catch (insertErr) {
            restoredCounts[collectionName] = documents.length;
            console.log(`    Warning: Some inserts failed, continuing...`);
            console.log(`    Error: ${insertErr.message}`);
          }
        } else {
          restoredCounts[collectionName] = 0;
          console.log(`    No documents to restore`);
        }
      }

      const fileManagerRestore = await this.restoreFileManagerFromLocalBackup(db, backupContentDir, backupData);
      if (fileManagerRestore.restored) {
        restoredCounts.file_manager_items = fileManagerRestore.totalItems;
      }

      console.log('Restore completed successfully');

      return {
        success: true,
        message: `Backup ${displayName} restored successfully`,
        timestamp: new Date().toISOString(),
        restoredCounts,
        fileManagerRestore
      };
    } catch (error) {
      console.error('Restore failed:', error.message);
      throw new Error(`Restore failed: ${error.message}`);
    } finally {
      if (client) {
        await client.close();
      }
      this.cleanupTempFiles(restoreDir);
    }
  }

  /**
   * Restore a backup from the PC/server folder or MongoDB GridFS.
   */
  async restoreBackup(fileName) {
    const timestamp = Date.now();
    const restoreDir = path.join(this.tempDir, `restore-source-${timestamp}`);
    try {
      const backupFile = await this.getRestorableBackupFile(fileName, restoreDir);
      return await this.restoreBackupFromArchive(backupFile, fileName);
    } finally {
      this.cleanupTempFiles(restoreDir);
    }
  }

  /**
   * Create a safe file name for an imported backup copy.
   */
  async getSafeImportedBackupFileName(originalFileName) {
    const baseName = path.basename(String(originalFileName || '')).replace(/[^a-zA-Z0-9._-]/g, '_');

    if (!baseName.toLowerCase().endsWith('.tar.gz')) {
      throw new Error('Only .tar.gz backup files can be imported');
    }

    let candidate = baseName.startsWith('barangay-backup-')
      ? baseName
      : `barangay-backup-imported-${Date.now()}.tar.gz`;

    let client = null;
    try {
      client = new MongoClient(this.mongoUri);
      await client.connect();
      const db = client.db(this.dbName);

      const existsInLocal = fs.existsSync(this.getBackupFilePath(candidate));
      const existsInDatabase = await db.collection('backupRecords').findOne({ fileName: candidate });

      if (existsInLocal || existsInDatabase) {
        candidate = candidate.replace(/\.tar\.gz$/i, `-imported-${Date.now()}.tar.gz`);
      }

      return candidate;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Restore a backup selected from the user's PC, then save that imported copy
   * back into the configured PC/server backup folder and MongoDB GridFS.
   */
  async restoreUploadedBackup(uploadedFilePath, originalFileName) {
    let client = null;
    const importedFileName = await this.getSafeImportedBackupFileName(originalFileName);

    try {
      const result = await this.restoreBackupFromArchive(uploadedFilePath, importedFileName);

      const backupPathToUse = this.getBackupPath();
      fs.mkdirSync(backupPathToUse, { recursive: true });

      const localDest = path.join(backupPathToUse, importedFileName);
      fs.copyFileSync(uploadedFilePath, localDest);
      const fileSize = fs.statSync(localDest).size;

      const metadata = {
        timestamp: new Date().toISOString(),
        backupDate: new Date().toISOString(),
        version: '1.0.0',
        collections: this.collectionsToBackup,
        docCounts: result.restoredCounts || {},
        imported: true,
        originalFileName
      };

      let databaseBackup = { saved: false };
      try {
        client = new MongoClient(this.mongoUri);
        await client.connect();
        const db = client.db(this.dbName);
        databaseBackup = await this.saveBackupArchiveToDatabase(db, localDest, importedFileName, metadata, fileSize);
      } catch (dbError) {
        console.warn('Imported backup was restored locally, but MongoDB copy failed:', dbError.message);
        databaseBackup = { saved: false, error: dbError.message };
      }

      await this.cleanupOldBackups();

      return {
        ...result,
        message: `Imported backup ${importedFileName} restored successfully`,
        importedFileName,
        fileName: importedFileName,
        localPath: localDest,
        databaseBackup
      };
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Delete a backup from whichever storage copy exists.
   * If the PC/server copy is missing but MongoDB still has it, deletion still works.
   */
  async deleteBackup(fileName) {
    let client = null;
    try {
      const safeFileName = this.getSafeBackupFileName(fileName);
      const backupFile = this.getBackupFilePath(safeFileName);
      let localDeleted = false;

      if (fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
        localDeleted = true;
      }

      let databaseDeleted = false;
      try {
        client = new MongoClient(this.mongoUri);
        await client.connect();
        const db = client.db(this.dbName);
        const record = await db.collection('backupRecords').findOne({ fileName: safeFileName });

        if (record) {
          databaseDeleted = await this.deleteDatabaseBackupCopy(db, record);
        }
      } catch (dbDeleteError) {
        console.warn('MongoDB backup copy could not be deleted:', dbDeleteError.message);
      }

      if (!localDeleted && !databaseDeleted) {
        throw new Error(`Backup file not found in PC/server folder or MongoDB: ${safeFileName}`);
      }

      console.log(`Backup deleted: ${safeFileName}`);
      return {
        success: true,
        message: `Backup ${safeFileName} deleted`,
        localDeleted,
        databaseDeleted,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Delete failed:', error.message);
      throw new Error(`Delete failed: ${error.message}`);
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Schedule automatic backups
   * Default: Daily at 2 AM
   */
  /**
   * Convert schedule settings to cron expression
   */
  getScheduleCronExpression(schedule) {
    if (!schedule || schedule.frequency === 'disabled') {
      return null;
    }

    const [hours, minutes] = schedule.time.split(':').map(Number);
    
    switch (schedule.frequency) {
      case 'daily':
        return `${minutes} ${hours} * * *`; // Every day at HH:MM
      case 'weekly':
        return `${minutes} ${hours} * * 0`; // Every Sunday at HH:MM
      case 'monthly':
        return `${minutes} ${hours} 1 * *`; // Every 1st of month at HH:MM
      default:
        return null;
    }
  }

  /**
   * Load settings from config file
   */
  loadSettings() {
    try {
      const configPath = path.join(__dirname, '../config/backupConfig.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config;
      }
    } catch (error) {
      console.error('Failed to load backup settings:', error.message);
    }
    return {
      schedule: { frequency: 'daily', time: '02:00' },
      backupPath: this.getDefaultBackupPath(),
      maxBackups: 10
    };
  }

  scheduleAutomaticBackups(cronExpression) {
    // If no cron expression provided, load from settings
    if (!cronExpression) {
      const settings = this.loadSettings();
      cronExpression = this.getScheduleCronExpression(settings.schedule);
      
      if (!cronExpression) {
        console.log('Automatic backups disabled in settings');
        return;
      }
    }

    cron.schedule(cronExpression, async () => {
      try {
        console.log('Running scheduled backup...');
        await this.createBackup();
        console.log('Scheduled backup completed');
      } catch (error) {
        console.error('Scheduled backup failed:', error.message);
      }
    });

    console.log(`Automatic backups scheduled: ${cronExpression}`);
  }

  /**
   * Helper: Get directory size
   */
  getDirectorySize(dirPath) {
    let size = 0;
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stat.size;
      }
    });

    return size;
  }

  /**
   * Helper: Clean up temporary files
   */
  cleanupTempFiles(dirPath) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Failed to cleanup temp files: ${error.message}`);
    }
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Change backup location and migrate existing backups
   */
  async changeBackupLocation(newPath) {
    try {
      // Resolve the new path
      const resolvedNewPath = this.resolvePath(newPath);

      // Check if new path already has the same backups
      if (resolvedNewPath === this.backupsDir) {
        throw new Error('New backup path is the same as current path');
      }

      // Validate new path is writable
      try {
        if (!fs.existsSync(resolvedNewPath)) {
          fs.mkdirSync(resolvedNewPath, { recursive: true });
        }
        // Test write permissions
        fs.accessSync(resolvedNewPath, fs.constants.W_OK);
      } catch (error) {
        throw new Error(`Cannot write to new path: ${error.message}`);
      }

      const oldPath = this.backupsDir;

      // Migrate backups
      this.migrateBackupsSync(oldPath, resolvedNewPath);

      // Update internal reference
      this.backupsDir = resolvedNewPath;

      // Update config file with both new and previous paths
      this.updateConfigPath(resolvedNewPath, oldPath);

      // If the new folder has more than 10 backups after migration, delete the oldest.
      const retention = await this.enforceBackupLimit();

      return {
        success: true,
        message: `Backup location changed successfully`,
        oldPath: oldPath,
        newPath: resolvedNewPath,
        retention,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to change backup location: ${error.message}`);
    }
  }

  /**
   * Get current backup location info
   */
  getBackupLocationInfo() {
    try {
      const backupPath = this.getBackupPath();
      const files = fs.readdirSync(backupPath)
        .filter(file => file.startsWith('barangay-backup-') && file.endsWith('.tar.gz'));
      
      let totalSize = 0;
      files.forEach(file => {
        const filePath = path.join(backupPath, file);
        totalSize += fs.statSync(filePath).size;
      });

      return {
        currentLocation: backupPath,
        backupCount: files.length,
        totalSize: totalSize,
        totalSizeFormatted: this.formatFileSize(totalSize),
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        currentLocation: this.backupsDir
      };
    }
  }
}

module.exports = new BackupService();
