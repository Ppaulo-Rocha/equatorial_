const fs = require('fs');
const path = require('path');

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFileSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeFileAtomicSync(targetPath, content, encoding = 'utf8') {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);

  ensureDirSync(dir);

  const now = Date.now();
  const tempPath = path.join(dir, `${base}.${process.pid}.${now}.tmp`);
  const backupPath = path.join(dir, `${base}.${process.pid}.${now}.bak`);

  fs.writeFileSync(tempPath, content, encoding);

  try {
    if (fs.existsSync(targetPath)) fs.renameSync(targetPath, backupPath);
    fs.renameSync(tempPath, targetPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}

    try {
      if (fs.existsSync(backupPath) && !fs.existsSync(targetPath)) {
        fs.renameSync(backupPath, targetPath);
      }
    } catch {}

    throw error;
  }
}

function writeJsonFileAtomicSync(filePath, data) {
  writeFileAtomicSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

module.exports = {
  ensureDirSync,
  readJsonFileSync,
  writeFileAtomicSync,
  writeJsonFileAtomicSync,
};

