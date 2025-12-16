const axios = require('axios');

const { extractInvoiceData } = require('../pdfExtractor');
const { processCompanyAccounts } = require('../automation');

function normalizeContasResponse(data) {
  if (Array.isArray(data) && data.length > 0 && data[0]?.data) return data[0].data;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  throw new Error(`Formato de resposta inválido. Recebido: ${typeof data}`);
}

function groupByEmpresa(contas) {
  const grupos = {};
  for (const conta of contas) {
    const empresa = conta.empresa || 'default';
    if (!grupos[empresa]) grupos[empresa] = [];
    grupos[empresa].push(conta);
  }
  return grupos;
}

function isContaJaPaga(dadosExtraidos) {
  if (!dadosExtraidos?.codigo_barras) {
    return { paga: true, motivo: 'sem código de barras' };
  }

  const venc = dadosExtraidos?.data_vencimento;
  if (venc) {
    const [dia, mes, ano] = venc.split('/').map(Number);
    const dataVencimento = new Date(ano, mes - 1, dia);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (dataVencimento < hoje) {
      return { paga: true, motivo: `vencimento ${venc} < hoje` };
    }
  }

  return { paga: false, motivo: '' };
}

function computeNextRunISOString(intervalMinutes) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

function createServiceRunner({ config, logger, dashboardState }) {
  let running = false;
  let intervalTimer = null;
  let currentInterval = config.checkIntervalMinutes;

  const saved = dashboardState.read();
  const savedInterval = saved?.config?.interval;
  if (Number.isFinite(savedInterval) && savedInterval >= 1 && savedInterval <= 168) {
    currentInterval = savedInterval;
    logger.info(`Intervalo carregado do estado salvo: ${currentInterval} minuto(s)`);
  }

  function isRunning() {
    return running;
  }

  function getIntervalMinutes() {
    return currentInterval;
  }

  function clearSchedule() {
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
  }

  function startSchedule() {
    clearSchedule();
    const intervaloMs = currentInterval * 60 * 1000;
    intervalTimer = setInterval(() => {
      runCycle().catch((err) => logger.error(`Erro no ciclo agendado: ${err.message}`));
    }, intervaloMs);
    logger.info(`Agendamento configurado para ${currentInterval} minuto(s)`);
  }

  function setIntervalMinutes(newIntervalMinutes) {
    currentInterval = newIntervalMinutes;
    dashboardState.save({
      config: {
        ...(dashboardState.read()?.config || {}),
        interval: currentInterval,
        webhook_contas: config.webhookContasUrl,
      },
      nextRun: computeNextRunISOString(currentInterval),
    });
    startSchedule();
  }

  async function buscarContas() {
    try {
      logger.info(`Buscando contas do webhook: ${config.webhookContasUrl}`);
      const response = await axios.post(config.webhookContasUrl, {}, { timeout: 30000 });
      const contas = normalizeContasResponse(response.data);
      logger.info(`${contas.length} conta(s) encontrada(s)`);
      return contas;
    } catch (error) {
      logger.error(`Erro ao buscar contas: ${error.message}`);
      return [];
    }
  }

  async function enviarFatura(faturaData) {
    const conta = faturaData?.conta || faturaData?.account || 'N/A';
    try {
      logger.info(`Enviando fatura da conta ${conta} para webhook...`);
      await axios.post(config.webhookEnvioUrl, faturaData, {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' },
      });
      logger.info(`Fatura da conta ${conta} enviada com sucesso`);
    } catch (error) {
      logger.error(`Erro ao enviar fatura da conta ${conta}: ${error.message}`);
      throw error;
    }
  }

  async function runCycle() {
    if (running) {
      logger.warn('Tentativa de iniciar ciclo, mas já existe um em andamento.');
      return;
    }

    if (!config.webhookContasUrl || !config.webhookEnvioUrl) {
      const msg = 'Ciclo abortado: WEBHOOK_CONTAS_URL/WEBHOOK_ENVIO_URL não configurados.';
      logger.error(msg);
      dashboardState.save({ status: 'IDLE', lastActivity: msg, lastError: msg });
      return;
    }

    running = true;
    const inicioExecucao = new Date();

    logger.info(`\n${'#'.repeat(60)}`);
    logger.info(`INICIANDO CICLO DE VERIFICAÇÃO - ${inicioExecucao.toISOString()}`);
    logger.info(`${'#'.repeat(60)}\n`);

    dashboardState.save({
      status: 'RUNNING',
      lastRun: inicioExecucao.toISOString(),
      lastActivity: 'Iniciando ciclo de verificação',
    });

    try {
      const contas = await buscarContas();
      if (contas.length === 0) {
        logger.warn('Nenhuma conta para processar neste ciclo');
        return;
      }

      const grupos = groupByEmpresa(contas);
      logger.info(
        `Contas agrupadas em ${Object.keys(grupos).length} empresa(s): ${Object.keys(grupos).join(', ')}`,
      );

      const resultados = {
        total: contas.length,
        sucesso: 0,
        falha: 0,
        sem_fatura: 0,
      };

      for (const [empresa, contasDaEmpresa] of Object.entries(grupos)) {
        logger.info(`\n>>> Processando empresa: ${empresa.toUpperCase()} (${contasDaEmpresa.length} contas) <<<`);

        const primeiraConta = contasDaEmpresa[0] || {};
        const emailLogin = primeiraConta.email || primeiraConta['e-mail'] || config.emailDefault;
        const senhaLogin = primeiraConta.senha || config.senhaDefault;

        if (!emailLogin || !senhaLogin) {
          logger.error(`Credenciais ausentes para empresa ${empresa} (email/senha via webhook ou .env)`);
          resultados.falha += contasDaEmpresa.length;
          continue;
        }

        try {
          const resultadosEmpresa = await processCompanyAccounts(
            empresa,
            emailLogin,
            senhaLogin,
            contasDaEmpresa.map((c) => ({ conta: c.conta, id: c.id })),
          );

          for (const resultado of resultadosEmpresa) {
            if (!resultado.success) {
              logger.error(`Conta ${resultado.conta} falhou: ${resultado.error}`);
              resultados.falha++;
              continue;
            }

            logger.info('Extraindo dados do PDF...');
            const dadosExtraidos = await extractInvoiceData(resultado.file_base64);

            logger.info(
              `Dados extraídos: NF=${dadosExtraidos.nota_fiscal || 'N/A'}, Valor=${dadosExtraidos.valor || 'N/A'
              }, Vencimento=${dadosExtraidos.data_vencimento || 'N/A'}`,
            );

            const { paga, motivo } = isContaJaPaga(dadosExtraidos);
            if (paga) {
              logger.info(`Conta ${resultado.conta} IGNORADA (${motivo}) - já paga`);
              resultados.sem_fatura++;
              continue;
            }

            const faturaData = {
              conta: resultado.conta,
              email: emailLogin,
              status: 'success',
              filename: resultado.filename,
              file_base64: resultado.file_base64,
              conta_id: resultado.id,
              processado_em: new Date().toISOString(),
              nota_fiscal: dadosExtraidos.nota_fiscal,
              valor: dadosExtraidos.valor,
              codigo_barras: dadosExtraidos.codigo_barras,
              data_vencimento: dadosExtraidos.data_vencimento,
              conta_contrato: dadosExtraidos.conta_contrato,
              proxima_leitura: dadosExtraidos.proxima_leitura,
            };

            await enviarFatura(faturaData);
            logger.info(`Conta ${resultado.conta} processada e enviada`);
            resultados.sucesso++;

            dashboardState.save({
              lastActivity: `Conta ${resultado.conta} processada`,
              lastSuccess: new Date().toISOString(),
            });
          }
        } catch (error) {
          logger.error(`Erro ao processar empresa ${empresa}: ${error.message}`);
          resultados.falha += contasDaEmpresa.length;
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const fimExecucao = new Date();
      const duracao = Math.round((fimExecucao - inicioExecucao) / 1000);

      logger.info(`\n${'#'.repeat(60)}`);
      logger.info(`CICLO FINALIZADO - Duração: ${duracao}s`);
      logger.info(
        `Total: ${resultados.total} | Sucesso: ${resultados.sucesso} | Sem fatura: ${resultados.sem_fatura} | Falha: ${resultados.falha}`,
      );
      logger.info(`Próxima verificação em ${currentInterval} minuto(s)`);
      logger.info(`${'#'.repeat(60)}\n`);

      dashboardState.save({
        status: 'IDLE',
        lastActivity: 'Ciclo finalizado',
        stats: resultados,
        nextRun: computeNextRunISOString(currentInterval),
      });
    } catch (error) {
      logger.error(`Erro crítico no ciclo de verificação: ${error.message}`);
    } finally {
      running = false;
      dashboardState.save({ status: 'IDLE' });
    }
  }

  function runCycleInBackground() {
    runCycle().catch((err) => logger.error(`Erro no ciclo manual: ${err.message}`));
  }

  function stop() {
    clearSchedule();
  }

  return {
    isRunning,
    getIntervalMinutes,
    setIntervalMinutes,
    startSchedule,
    runCycle,
    runCycleInBackground,
    stop,
  };
}

module.exports = { createServiceRunner };
