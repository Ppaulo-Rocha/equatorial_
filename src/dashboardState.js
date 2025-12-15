const { readJsonFileSync, writeJsonFileAtomicSync } = require('./utils/fs');

function createDashboardState({ stateFile, logger }) {
  function read() {
    return readJsonFileSync(stateFile);
  }

  function save(patch) {
    try {
      const current = readJsonFileSync(stateFile) || {};
      const next = {
        ...current,
        ...patch,
        lastUpdate: new Date().toISOString(),
      };
      writeJsonFileAtomicSync(stateFile, next);
      return next;
    } catch (error) {
      logger?.error(`Erro ao salvar estado: ${error.message}`);
      return null;
    }
  }

  return { read, save };
}

module.exports = { createDashboardState };

