const express = require('express');
const fs = require('fs');
const path = require('path');

function readLastLines(filePath, maxLines) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').slice(-maxLines);
  } catch {
    return [];
  }
}

function createApp({ config, logger, dashboardState, runner, downloadInvoice }) {
  const app = express();

  app.use(express.json());
  app.use(express.static(config.publicDir));

  app.get('/health', (req, res) => res.status(200).send('OK'));

  app.get('/api/status', (req, res) => {
    const data = dashboardState.read() || {};
    const status = runner?.isRunning ? (runner.isRunning() ? 'RUNNING' : 'IDLE') : data.status || 'UNKNOWN';
    res.json({ ...data, status });
  });

  app.get('/api/logs', (req, res) => {
    const logFile = path.join(config.logsDir, 'service.log');
    const lines = readLastLines(logFile, config.dashboardMaxLogLines);
    res.json({ logs: lines });
  });

  if (runner?.runCycleInBackground && runner?.isRunning) {
    app.post('/api/run', (req, res) => {
      if (runner.isRunning()) {
        return res.status(409).json({ message: 'Já existe um ciclo em execução.' });
      }

      res.json({ message: 'Ciclo iniciado com sucesso.' });
      runner.runCycleInBackground();
    });
  }

  if (runner?.setIntervalHours && runner?.getIntervalHours) {
    app.post('/api/config', (req, res) => {
      try {
        const { intervalHours } = req.body || {};
        const parsed = Number.parseInt(String(intervalHours), 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
          return res.status(400).json({ error: 'Intervalo deve ser entre 1 e 168 horas' });
        }

        runner.setIntervalHours(parsed);
        logger?.info(`Intervalo atualizado para ${parsed} hora(s)`);
        return res.json({ message: 'Configuração atualizada com sucesso', intervalHours: parsed });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    });
  }

  app.post('/webhook/fatura', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${config.authToken}`) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const { email, senha, conta } = req.body || {};

    const emailLogin = email || config.emailDefault;
    const senhaLogin = senha || config.senhaDefault;

    if (!conta) return res.status(400).json({ error: 'Conta é obrigatória' });
    if (!emailLogin || !senhaLogin) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios (env ou payload)' });
    }

    try {
      const resultado = await downloadInvoice(emailLogin, senhaLogin, conta);
      return res.json(resultado);
    } catch (error) {
      logger?.error(`Erro no webhook/fatura: ${error.message}`);
      return res.status(500).json({ status: 'error', message: error.message });
    }
  });

  return app;
}

module.exports = { createApp };
