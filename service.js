require('dotenv').config();
const axios = require('axios');
const winston = require('winston');
const { downloadInvoice } = require('./automation');

// --- CONFIGURAÇÕES ---
const WEBHOOK_CONTAS_URL = process.env.WEBHOOK_CONTAS_URL || 'https://n8n.svd.tec.br/webhook/contas_contratos';
const WEBHOOK_ENVIO_URL = process.env.WEBHOOK_ENVIO_URL || 'https://n8n.svd.tec.br/webhook/contas';
const CHECK_INTERVAL_HOURS = parseInt(process.env.CHECK_INTERVAL_HOURS || '24', 10);
const EMAIL_DEFAULT = process.env.EMAIL_DEFAULT || 'adm.financeiro@mov.pro.br';
const SENHA_DEFAULT = process.env.SENHA_DEFAULT || 'Movfibra15070@';

// --- CONFIGURAÇÃO DE LOGS ---
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
    ),
    transports: [
        new winston.transports.File({
            filename: './logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: './logs/service.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            )
        })
    ]
});

// --- FUNÇÕES AUXILIARES ---

/**
 * Busca a lista de contas a serem verificadas do webhook
 * @returns {Promise<Array>} Lista de contas
 */
async function buscarContas() {
    try {
        logger.info(`Buscando contas do webhook: ${WEBHOOK_CONTAS_URL}`);
        const response = await axios.post(WEBHOOK_CONTAS_URL, {}, { timeout: 30000 });

        let contas;

        // Formato: [{data: [...]}] - Array contendo objeto com propriedade data
        if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].data) {
            contas = response.data[0].data;
        }
        // Formato: {data: [...]} - Objeto com propriedade data
        else if (response.data && Array.isArray(response.data.data)) {
            contas = response.data.data;
        }
        // Formato: [...] - Array direto
        else if (Array.isArray(response.data)) {
            contas = response.data;
        }
        // Formato: {...} - Objeto único
        else if (response.data && typeof response.data === 'object') {
            contas = [response.data];
        }
        else {
            throw new Error(`Formato de resposta inválido. Recebido: ${typeof response.data}`);
        }

        logger.info(`${contas.length} conta(s) encontrada(s)`);
        return contas;
    } catch (error) {
        logger.error(`Erro ao buscar contas: ${error.message}`);
        return [];
    }
}

/**
 * Envia os dados da fatura para o webhook de destino
 * @param {Object} faturaData - Dados da fatura
 */
async function enviarFatura(faturaData) {
    try {
        logger.info(`Enviando fatura da conta ${faturaData.account} para webhook...`);

        await axios.post(WEBHOOK_ENVIO_URL, faturaData, {
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        logger.info(`Fatura da conta ${faturaData.account} enviada com sucesso`);
    } catch (error) {
        logger.error(`Erro ao enviar fatura da conta ${faturaData.account}: ${error.message}`);
        throw error;
    }
}

/**
 * Processa uma conta específica
 * @param {Object} contaInfo - Informações da conta do webhook
 */
async function processarConta(contaInfo) {
    const { conta, id } = contaInfo;

    try {
        logger.info(`\n${'='.repeat(60)}`);
        logger.info(`Processando conta ${conta} (ID: ${id})`);
        logger.info(`${'='.repeat(60)}`);

        // Faz o download da fatura
        const resultado = await downloadInvoice(EMAIL_DEFAULT, SENHA_DEFAULT, conta);

        if (resultado.status === 'success' && resultado.has_invoice) {
            // Prepara dados para envio
            const faturaData = {
                conta: resultado.account,
                email: EMAIL_DEFAULT,
                status: resultado.status,
                filename: resultado.filename,
                file_base64: resultado.file_base64,
                conta_id: id, // ID da conta do webhook
                processado_em: new Date().toISOString()
            };

            // Envia para o webhook
            await enviarFatura(faturaData);

            logger.info(`✓ Conta ${conta} processada com sucesso`);
            return { success: true, conta };
        } else {
            logger.warn(`Nenhuma fatura encontrada para conta ${conta}`);
            return { success: false, conta, reason: 'no_invoice' };
        }

    } catch (error) {
        logger.error(`✗ Erro ao processar conta ${conta}: ${error.message}`);
        return { success: false, conta, error: error.message };
    }
}

/**
 * Executa um ciclo completo de verificação de contas
 */
async function executarCicloVerificacao() {
    const inicioExecucao = new Date();
    logger.info(`\n${'#'.repeat(60)}`);
    logger.info(`INICIANDO CICLO DE VERIFICAÇÃO - ${inicioExecucao.toISOString()}`);
    logger.info(`${'#'.repeat(60)}\n`);

    try {
        // Busca contas
        const contas = await buscarContas();

        if (contas.length === 0) {
            logger.warn('Nenhuma conta para processar neste ciclo');
            return;
        }

        // Estatísticas
        const resultados = {
            total: contas.length,
            sucesso: 0,
            falha: 0,
            sem_fatura: 0
        };

        // Processa cada conta
        for (const contaInfo of contas) {
            const resultado = await processarConta(contaInfo);

            if (resultado.success) {
                resultados.sucesso++;
            } else if (resultado.reason === 'no_invoice') {
                resultados.sem_fatura++;
            } else {
                resultados.falha++;
            }

            // Aguarda 5 segundos entre cada conta para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Log do resumo
        const fimExecucao = new Date();
        const duracao = Math.round((fimExecucao - inicioExecucao) / 1000);

        logger.info(`\n${'#'.repeat(60)}`);
        logger.info(`CICLO FINALIZADO - Duração: ${duracao}s`);
        logger.info(`Total: ${resultados.total} | Sucesso: ${resultados.sucesso} | Sem fatura: ${resultados.sem_fatura} | Falha: ${resultados.falha}`);
        logger.info(`Próxima verificação em ${CHECK_INTERVAL_HOURS} hora(s)`);
        logger.info(`${'#'.repeat(60)}\n`);

    } catch (error) {
        logger.error(`Erro crítico no ciclo de verificação: ${error.message}`);
    }
}

/**
 * Inicia o serviço de verificação contínua
 */
async function iniciarServico() {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('   SERVIÇO EQUATORIAL AUTO INVOICE INICIADO');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`Intervalo de verificação: ${CHECK_INTERVAL_HOURS} hora(s)`);
    logger.info(`Webhook de contas: ${WEBHOOK_CONTAS_URL}`);
    logger.info(`Webhook de envio: ${WEBHOOK_ENVIO_URL}`);
    logger.info('═══════════════════════════════════════════════════════════\n');

    // Executa o primeiro ciclo imediatamente
    await executarCicloVerificacao();

    // Agenda os próximos ciclos
    const intervaloMs = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
    setInterval(async () => {
        await executarCicloVerificacao();
    }, intervaloMs);
}

// --- TRATAMENTO DE SINAIS ---
process.on('SIGINT', () => {
    logger.info('Serviço interrompido manualmente (SIGINT)');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Serviço finalizado (SIGTERM)');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error(`Exceção não capturada: ${error.message}`, { stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Promise rejeitada não tratada: ${reason}`);
});

// --- INICIA O SERVIÇO ---
iniciarServico().catch((error) => {
    logger.error(`Erro fatal ao iniciar serviço: ${error.message}`);
    process.exit(1);
});
