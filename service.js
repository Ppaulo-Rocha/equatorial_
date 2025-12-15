require('dotenv').config();

const { loadConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createDashboardState } = require('./src/dashboardState');
const { createServiceRunner } = require('./src/serviceRunner');
const { createApp } = require('./src/http/createApp');
const { downloadInvoice } = require('./automation');

function computeNextRunISOString(intervalHours) {
  return new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const dashboardState = createDashboardState({ stateFile: config.stateFile, logger });
  const runner = createServiceRunner({ config, logger, dashboardState });

  logger.info('SERVIÇO EQUATORIAL AUTO INVOICE INICIADO');
  logger.info(`Intervalo de verificação: ${runner.getIntervalHours()} hora(s)`);
  logger.info(`Webhook de contas: ${config.webhookContasUrl || '(não configurado)'}`);
  logger.info(`Webhook de envio: ${config.webhookEnvioUrl || '(não configurado)'}`);

  dashboardState.save({
    status: 'IDLE',
    startTime: new Date().toISOString(),
    config: {
      interval: runner.getIntervalHours(),
      webhook_contas: config.webhookContasUrl,
    },
    nextRun: computeNextRunISOString(runner.getIntervalHours()),
  });

  const app = createApp({ config, logger, dashboardState, runner, downloadInvoice });
  const server = app.listen(config.port, () => {
    logger.info(`Dashboard e API rodando na porta ${config.port}`);
  });

  runner.runCycleInBackground();
  runner.startSchedule();

  const shutdown = (signal) => {
    logger.info(`Encerrando serviço (${signal})...`);
    runner.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (error) => {
    logger.error(`Exceção não capturada: ${error.message}`, { stack: error.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Promise rejeitada não tratada: ${reason}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Erro fatal ao iniciar serviço:', error);
  process.exit(1);
});

