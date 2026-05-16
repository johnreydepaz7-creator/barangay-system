const express = require('express');
const mongoose = require('mongoose');
// Use the MongoDB/BSON classes bundled with Mongoose's MongoDB driver.
// This prevents BSON version mismatch errors during GridFS image/file uploads.
const { GridFSBucket, ObjectId } = mongoose.mongo;
const router = express.Router();
const { writeActivityLog } = require('../services/activityLogger');

const ITEMS_COLLECTION = 'file_manager_items';
const BUCKET_NAME = 'fileManagerFiles';
const FREE_TIER_DISPLAY_LIMIT_BYTES = 512 * 1024 * 1024; // MongoDB Atlas M0 commonly provides 512 MB / 0.5 GB.
let indexesReady = false;

// Video uploads are intentionally blocked while File Manager uses MongoDB GridFS.
// This protects the free MongoDB storage from being consumed by large video files.
const BLOCKED_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.3gp', '.3g2',
  '.mpeg', '.mpg', '.mpe', '.mpv', '.ogv', '.ts', '.mts', '.m2ts', '.vob', '.divx', '.f4v'
]);

function looksLikeVideoBySignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const head12 = buffer.slice(0, 12).toString('latin1');
  const head4 = buffer.slice(0, 4).toString('latin1');

  // MP4/MOV/M4V family normally has an ftyp box at byte 4.
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('latin1') === 'ftyp') return true;

  // AVI uses RIFF....AVI. WebP also uses RIFF, so require AVI marker.
  if (head4 === 'RIFF' && buffer.slice(8, 11).toString('latin1') === 'AVI') return true;

  // FLV header.
  if (head4.slice(0, 3) === 'FLV') return true;

  // Matroska/WebM EBML header.
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return true;

  // MPEG program/transport stream common starts.
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && [0xBA, 0xB3].includes(buffer[3])) return true;
  if (buffer[0] === 0x47 && buffer.length > 188 && buffer[188] === 0x47) return true;

  return false;
}

function isVideoFile(file) {
  const name = String(file.originalName || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  const mime = String(file.mimeType || '').toLowerCase();
  return mime.startsWith('video/') || BLOCKED_VIDEO_EXTENSIONS.has(ext) || looksLikeVideoBySignature(file.content);
}

function getDb() {
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) {
    const err = new Error('MongoDB is not connected yet. Please try again.');
    err.status = 503;
    throw err;
  }
  return db;
}

async function ensureIndexes() {
  if (indexesReady) return;
  const col = getDb().collection(ITEMS_COLLECTION);
  await col.createIndex({ parentPath: 1, name: 1 }, { unique: true });
  await col.createIndex({ path: 1 }, { unique: true });
  await col.createIndex({ type: 1, updatedAt: -1 });
  indexesReady = true;
}

function itemsCol() {
  return getDb().collection(ITEMS_COLLECTION);
}

function bucket() {
  return new GridFSBucket(getDb(), { bucketName: BUCKET_NAME });
}

function safeName(name) {
  return String(name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+$/, '_')
    .trim()
    .slice(0, 180) || 'untitled';
}

function normalizePath(relPath = '') {
  const clean = String(relPath || '')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/^[/\\]+|[/\\]+$/g, '')
    .replace(/\\/g, '/');

  if (!clean) return '';
  const parts = clean.split('/').filter(Boolean).map(part => safeName(part));
  if (parts.some(part => part === '..')) {
    const err = new Error('Invalid file path.');
    err.status = 400;
    throw err;
  }
  return parts.join('/');
}

function joinPath(parentPath, name) {
  const parent = normalizePath(parentPath || '');
  const child = safeName(name);
  return parent ? `${parent}/${child}` : child;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getUniqueName(parentPath, originalName) {
  const col = itemsCol();
  const safeOriginal = safeName(originalName);
  const dot = safeOriginal.lastIndexOf('.');
  const base = dot > 0 ? safeOriginal.slice(0, dot) : safeOriginal;
  const ext = dot > 0 ? safeOriginal.slice(dot) : '';
  let candidate = safeOriginal;
  let counter = 1;
  while (await col.findOne({ parentPath, name: candidate })) {
    candidate = `${base} (${counter++})${ext}`;
  }
  return candidate;
}

function splitBuffer(buf, separator) {
  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(separator, start)) !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + separator.length;
  }
  parts.push(buf.slice(start));
  return parts;
}

function parseMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return reject(new Error('Invalid upload request.'));

    const boundary = Buffer.from('--' + (match[1] || match[2]));
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const files = [];
        for (let part of splitBuffer(body, boundary)) {
          if (!part || part.length < 10) continue;
          if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
          if (part.slice(0, 2).toString() === '--') continue;
          const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
          if (headerEnd === -1) continue;
          const header = part.slice(0, headerEnd).toString('utf8');
          const filenameMatch = header.match(/filename="([^"]*)"/i);
          if (!filenameMatch || !filenameMatch[1]) continue;
          const typeMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
          let content = part.slice(headerEnd + 4);
          if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
          files.push({
            originalName: safeName(filenameMatch[1]),
            mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            content
          });
        }
        resolve(files);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function uploadToGridFS(fileName, buffer, metadata) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(fileName, { metadata });
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

async function deleteGridFile(gridFsId) {
  if (!gridFsId) return;
  try {
    await bucket().delete(new ObjectId(gridFsId));
  } catch (error) {
    if (!String(error.message || '').includes('FileNotFound')) {
      console.warn('Could not delete GridFS file:', error.message);
    }
  }
}

function readGridFile(gridFsId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    bucket().openDownloadStream(new ObjectId(gridFsId))
      .on('data', chunk => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function copyItemRecursive(item, destinationPath, now, copied) {
  const col = itemsCol();
  const uniqueName = await getUniqueName(destinationPath, item.name);
  const newPath = joinPath(destinationPath, uniqueName);

  if (item.type === 'folder') {
    const folderDoc = {
      name: uniqueName,
      path: newPath,
      parentPath: destinationPath,
      type: 'folder',
      size: 0,
      createdAt: now,
      updatedAt: now
    };
    await col.insertOne(folderDoc);
    copied.push(folderDoc);

    const children = await col.find({ parentPath: item.path }).sort({ type: 1, name: 1 }).toArray();
    for (const child of children) {
      await copyItemRecursive(child, newPath, now, copied);
    }
    return folderDoc;
  }

  const buffer = await readGridFile(item.gridFsId);
  const gridFsId = await uploadToGridFS(uniqueName, buffer, {
    path: newPath,
    parentPath: destinationPath,
    originalName: uniqueName,
    mimeType: item.mimeType || 'application/octet-stream',
    copiedFrom: item.path,
    uploadedAt: now
  });

  const fileDoc = {
    name: uniqueName,
    path: newPath,
    parentPath: destinationPath,
    type: 'file',
    size: buffer.length,
    mimeType: item.mimeType || 'application/octet-stream',
    gridFsId,
    createdAt: now,
    updatedAt: now
  };
  await col.insertOne(fileDoc);
  copied.push(fileDoc);
  return fileDoc;
}


function itemTypeLabel(item) {
  return item && item.type === 'folder' ? 'folder' : 'file';
}

function namesList(items, max = 5) {
  const names = (items || []).map(item => item.name || item.path).filter(Boolean);
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown}, and ${names.length - max} more` : shown;
}

function itemToClient(item) {
  return {
    id: item.path,
    name: item.name,
    path: item.path,
    type: item.type,
    isFolder: item.type === 'folder',
    size: item.size || 0,
    mimeType: item.mimeType || '',
    modifiedTime: (item.updatedAt || item.createdAt || new Date()).toISOString(),
    source: 'mongodb'
  };
}

router.get('/info', async (req, res) => {
  try {
    await ensureIndexes();
    const agg = await itemsCol().aggregate([
      { $match: { type: 'file' } },
      { $group: { _id: null, usedBytes: { $sum: '$size' }, files: { $sum: 1 } } }
    ]).toArray();
    const totals = agg[0] || { usedBytes: 0, files: 0 };
    const folders = await itemsCol().countDocuments({ type: 'folder' });
    res.json({
      success: true,
      provider: 'MongoDB Online Storage',
      storagePath: 'MongoDB Atlas / GridFS',
      usedBytes: totals.usedBytes || 0,
      limitBytes: FREE_TIER_DISPLAY_LIMIT_BYTES,
      files: totals.files || 0,
      folders
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    await ensureIndexes();
    const currentPath = normalizePath(req.query.path || '');
    const items = await itemsCol()
      .find({ parentPath: currentPath })
      .sort({ type: 1, name: 1 })
      .toArray();
    items.sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.name.localeCompare(b.name));
    res.json({ success: true, currentPath, storagePath: 'MongoDB Atlas / GridFS', items: items.map(itemToClient) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/upload', async (req, res) => {
  try {
    await ensureIndexes();
    const parentPath = normalizePath(req.query.path || '');
    if (parentPath && !(await itemsCol().findOne({ path: parentPath, type: 'folder' }))) {
      return res.status(404).json({ success: false, message: 'Destination folder not found.' });
    }

    const incoming = await parseMultipartUpload(req);
    const blockedVideos = incoming.filter(isVideoFile);
    if (blockedVideos.length) {
      return res.status(400).json({
        success: false,
        message: 'Video upload is temporarily disabled to save MongoDB GridFS storage. Please upload documents, images, audio, or compressed files only.'
      });
    }

    const saved = [];
    for (const file of incoming) {
      const name = await getUniqueName(parentPath, file.originalName);
      const filePath = joinPath(parentPath, name);
      const now = new Date();
      const gridFsId = await uploadToGridFS(name, file.content, {
        path: filePath,
        parentPath,
        originalName: file.originalName,
        mimeType: file.mimeType,
        uploadedAt: now
      });
      const doc = {
        name,
        path: filePath,
        parentPath,
        type: 'file',
        size: file.content.length,
        mimeType: file.mimeType,
        gridFsId,
        createdAt: now,
        updatedAt: now
      };
      await itemsCol().insertOne(doc);
      saved.push(itemToClient(doc));
    }
    if (saved.length) {
      await writeActivityLog({
        req,
        action: saved.length === 1 ? 'Uploaded File' : 'Uploaded Files',
        details: `Uploaded ${saved.length} file${saved.length !== 1 ? 's' : ''}${parentPath ? ` to ${parentPath}` : ' to Home'}: ${saved.map(f => f.name).join(', ')}`,
        module: 'File Manager'
      });
    }
    res.json({ success: true, files: saved });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/folder', express.json(), async (req, res) => {
  try {
    await ensureIndexes();
    const parentPath = normalizePath(req.body.path || '');
    if (parentPath && !(await itemsCol().findOne({ path: parentPath, type: 'folder' }))) {
      return res.status(404).json({ success: false, message: 'Parent folder not found.' });
    }
    const name = safeName(req.body.name || 'New Folder');
    if (await itemsCol().findOne({ parentPath, name })) {
      return res.status(409).json({ success: false, message: 'Folder already exists.' });
    }
    const now = new Date();
    const doc = { name, path: joinPath(parentPath, name), parentPath, type: 'folder', size: 0, createdAt: now, updatedAt: now };
    await itemsCol().insertOne(doc);
    await writeActivityLog({
      req,
      action: 'Created Folder',
      details: `Created folder ${doc.path || doc.name}`,
      module: 'File Manager'
    });
    res.json({ success: true, folder: itemToClient(doc) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});


router.patch('/move', express.json(), async (req, res) => {
  try {
    await ensureIndexes();
    const sourcePathsRaw = Array.isArray(req.body.paths)
      ? req.body.paths
      : (req.body.path ? [req.body.path] : []);
    const sourcePaths = [...new Set(sourcePathsRaw.map(normalizePath).filter(Boolean))];
    const destinationPath = normalizePath(req.body.destinationPath || '');

    if (!sourcePaths.length) {
      return res.status(400).json({ success: false, message: 'No item selected to move.' });
    }

    if (destinationPath) {
      const dest = await itemsCol().findOne({ path: destinationPath, type: 'folder' });
      if (!dest) return res.status(404).json({ success: false, message: 'Destination folder not found.' });
    }

    const now = new Date();
    const moved = [];

    for (const sourcePath of sourcePaths) {
      const item = await itemsCol().findOne({ path: sourcePath });
      if (!item) {
        return res.status(404).json({ success: false, message: `Item not found: ${sourcePath}` });
      }

      if (item.parentPath === destinationPath) continue;

      if (item.type === 'folder') {
        if (destinationPath === item.path || destinationPath.startsWith(item.path + '/')) {
          return res.status(400).json({ success: false, message: 'A folder cannot be moved inside itself or one of its subfolders.' });
        }
      }

      const uniqueName = await getUniqueName(destinationPath, item.name);
      const newPath = joinPath(destinationPath, uniqueName);
      const oldPath = item.path;

      await itemsCol().updateOne(
        { _id: item._id },
        { $set: { name: uniqueName, path: newPath, parentPath: destinationPath, updatedAt: now } }
      );

      if (item.type === 'folder') {
        const descendants = await itemsCol().find({ path: { $regex: '^' + escapeRegex(oldPath + '/') } }).toArray();
        for (const child of descendants) {
          const childNewPath = newPath + child.path.slice(oldPath.length);
          const childNewParent = child.parentPath === oldPath
            ? newPath
            : newPath + child.parentPath.slice(oldPath.length);
          await itemsCol().updateOne(
            { _id: child._id },
            { $set: { path: childNewPath, parentPath: childNewParent, updatedAt: now } }
          );
        }
      } else if (item.gridFsId) {
        // Keep GridFS metadata in sync for easier maintenance and future recovery.
        try {
          await getDb().collection(`${BUCKET_NAME}.files`).updateOne(
            { _id: new ObjectId(item.gridFsId) },
            { $set: { 'metadata.path': newPath, 'metadata.parentPath': destinationPath, 'metadata.originalName': item.name } }
          );
        } catch (metadataError) {
          console.warn('Could not update GridFS metadata after move:', metadataError.message);
        }
      }

      moved.push({ from: oldPath, to: newPath, name: uniqueName });
    }

    if (moved.length) {
      await writeActivityLog({
        req,
        action: moved.length === 1 ? 'Moved File Manager Item' : 'Moved File Manager Items',
        details: `Moved ${moved.length} item${moved.length !== 1 ? 's' : ''} to ${destinationPath || 'Home'}: ${moved.map(m => `${m.from} → ${m.to}`).join('; ')}`,
        module: 'File Manager'
      });
    }
    res.json({ success: true, moved });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});


router.post('/copy', express.json(), async (req, res) => {
  try {
    await ensureIndexes();
    const sourcePathsRaw = Array.isArray(req.body.paths)
      ? req.body.paths
      : (req.body.path ? [req.body.path] : []);
    const sourcePaths = [...new Set(sourcePathsRaw.map(normalizePath).filter(Boolean))];
    const destinationPath = normalizePath(req.body.destinationPath || '');

    if (!sourcePaths.length) {
      return res.status(400).json({ success: false, message: 'No item selected to copy.' });
    }

    if (destinationPath) {
      const dest = await itemsCol().findOne({ path: destinationPath, type: 'folder' });
      if (!dest) return res.status(404).json({ success: false, message: 'Destination folder not found.' });
    }

    const sourceItems = [];
    for (const sourcePath of sourcePaths) {
      const item = await itemsCol().findOne({ path: sourcePath });
      if (!item) return res.status(404).json({ success: false, message: `Item not found: ${sourcePath}` });
      if (item.type === 'folder' && (destinationPath === item.path || destinationPath.startsWith(item.path + '/'))) {
        return res.status(400).json({ success: false, message: 'A folder cannot be copied inside itself or one of its subfolders.' });
      }
      sourceItems.push(item);
    }

    const now = new Date();
    const copied = [];
    const topLevelCopies = [];
    for (const item of sourceItems) {
      const top = await copyItemRecursive(item, destinationPath, now, copied);
      topLevelCopies.push(top);
    }

    await writeActivityLog({
      req,
      action: topLevelCopies.length === 1 ? 'Copied File Manager Item' : 'Copied File Manager Items',
      details: `Copied ${topLevelCopies.length} item${topLevelCopies.length !== 1 ? 's' : ''} to ${destinationPath || 'Home'}: ${namesList(topLevelCopies)}. Total created: ${copied.length}`,
      module: 'File Manager'
    });

    res.json({
      success: true,
      copied: topLevelCopies.map(itemToClient),
      totalCreated: copied.length
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.patch('/rename', express.json(), async (req, res) => {
  try {
    await ensureIndexes();
    const oldPath = normalizePath(req.body.path || '');
    const item = await itemsCol().findOne({ path: oldPath });
    if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
    const newName = safeName(req.body.name || 'renamed');
    const newPath = joinPath(item.parentPath, newName);
    if (newPath !== oldPath && await itemsCol().findOne({ parentPath: item.parentPath, name: newName })) {
      return res.status(409).json({ success: false, message: 'A file or folder with that name already exists.' });
    }

    const now = new Date();
    if (item.type === 'folder') {
      const descendants = await itemsCol().find({ path: { $regex: '^' + escapeRegex(oldPath + '/') } }).toArray();
      await itemsCol().updateOne({ _id: item._id }, { $set: { name: newName, path: newPath, updatedAt: now } });
      for (const child of descendants) {
        const childNewPath = newPath + child.path.slice(oldPath.length);
        const childNewParent = child.parentPath === oldPath ? newPath : newPath + child.parentPath.slice(oldPath.length);
        await itemsCol().updateOne({ _id: child._id }, { $set: { path: childNewPath, parentPath: childNewParent, updatedAt: now } });
      }
    } else {
      await itemsCol().updateOne({ _id: item._id }, { $set: { name: newName, path: newPath, updatedAt: now } });
    }
    await writeActivityLog({
      req,
      action: `Updated ${itemTypeLabel(item)} Name`,
      details: `Renamed ${oldPath} to ${newPath}`,
      module: 'File Manager'
    });
    res.json({ success: true, item: { name: newName, path: newPath } });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.delete('/item', express.json(), async (req, res) => {
  try {
    await ensureIndexes();
    const targetPath = normalizePath(req.body.path || '');
    const target = await itemsCol().findOne({ path: targetPath });
    if (!target) return res.status(404).json({ success: false, message: 'Item not found.' });

    let items = [target];
    if (target.type === 'folder') {
      const children = await itemsCol().find({ path: { $regex: '^' + escapeRegex(targetPath + '/') } }).toArray();
      items = items.concat(children);
    }

    for (const item of items) {
      if (item.type === 'file') await deleteGridFile(item.gridFsId);
    }
    await itemsCol().deleteMany({ _id: { $in: items.map(i => i._id) } });
    await writeActivityLog({
      req,
      action: target.type === 'folder' ? 'Deleted Folder' : 'Deleted File',
      details: `Deleted ${target.type} ${target.path}. Total removed: ${items.length}${items.length > 1 ? ` (${namesList(items)})` : ''}`,
      module: 'File Manager'
    });
    res.json({ success: true, deleted: items.length });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/download', async (req, res) => {
  try {
    await ensureIndexes();
    const targetPath = normalizePath(req.query.path || '');
    const item = await itemsCol().findOne({ path: targetPath, type: 'file' });
    if (!item) return res.status(404).send('File not found');
    await writeActivityLog({
      req,
      action: 'Downloaded File',
      details: `Downloaded file ${item.path}`,
      module: 'File Manager'
    });
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.name)}"`);
    bucket().openDownloadStream(new ObjectId(item.gridFsId))
      .on('error', () => res.status(404).end('Stored file content not found'))
      .pipe(res);
  } catch (error) {
    res.status(error.status || 500).send(error.message);
  }
});

module.exports = router;
