const { LOGS_DIR, PUBLIC_DIR, STATE_FILE } = require('./paths');

function parseIntEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function loadConfig(env = process.env) {
  return {
    port: parseIntEnv(env.PORT, 2032),
    authToken: (env.AUTH_TOKEN || '057ebcdc28b0b95cabe45341b209d28d').trim(),

    webhookContasUrl: (env.WEBHOOK_CONTAS_URL || 'https://n8n.svd.tec.br/webhook/contas_contratos').trim(),
    webhookEnvioUrl: (env.WEBHOOK_ENVIO_URL || 'https://n8n.svd.tec.br/webhook/contas').trim(),

    checkIntervalHours: parseIntEnv(env.CHECK_INTERVAL_HOURS, 24),
    emailDefault: (env.EMAIL_DEFAULT || '').trim(),
    senhaDefault: (env.SENHA_DEFAULT || '').trim(),

    logLevel: (env.LOG_LEVEL || 'info').trim(),
    dashboardMaxLogLines: parseIntEnv(env.DASHBOARD_MAX_LOG_LINES, 100),

    playwrightHeadless: parseBoolEnv(env.PLAYWRIGHT_HEADLESS ?? env.HEADLESS, false),

    logsDir: LOGS_DIR,
    stateFile: STATE_FILE,
    publicDir: PUBLIC_DIR,
  };
}

function validateServiceConfig(config) {
  const missing = [];
  if (!config.webhookContasUrl) missing.push('WEBHOOK_CONTAS_URL');
  if (!config.webhookEnvioUrl) missing.push('WEBHOOK_ENVIO_URL');
  if (missing.length) throw new Error(`Configuração ausente: ${missing.join(', ')}`);
}

module.exports = { loadConfig, validateServiceConfig };
