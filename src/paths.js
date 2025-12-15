const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const STATE_FILE = path.join(ROOT_DIR, 'dashboard-data.json');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

module.exports = {
  ROOT_DIR,
  LOGS_DIR,
  STATE_FILE,
  PUBLIC_DIR,
};

