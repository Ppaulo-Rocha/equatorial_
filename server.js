require('dotenv').config();

const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createDashboardState } = require('./src/dashboardState');
const { createApp } = require('./src/http/createApp');
const { downloadInvoice } = require('./automation');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const dashboardState = createDashboardState({ stateFile: config.stateFile, logger });

  const app = createApp({ config, logger, dashboardState, runner: null, downloadInvoice });

  app.listen(config.port, () => {
    logger.info(`Servidor API rodando na porta ${config.port}`);
    logger.info(`Use POST /webhook/fatura com Authorization: Bearer ${config.authToken}`);
    logger.info(`Dashboard disponível em http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Erro fatal ao iniciar servidor:', error);
  process.exit(1);
});

