// =================================================================================================
// IMPORTS E CONFIGURAÇÕES GLOBAIS
// =================================================================================================
const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// --- Configurações do Servidor ---
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;
const TIMEOUT_GERAL = 60000; // 60 segundos

// --- Configurações Anti-Detecção de Bots ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled', // Oculta a flag de automação do Chrome
    '--disable-dev-shm-usage', // Previne erros de memória em contêineres
    '--disable-gpu' // Ajuda a estabilizar em alguns ambientes Windows
];

// =================================================================================================
// FUNÇÕES AUXILIARES E DE AUTOMAÇÃO
// =================================================================================================

/**
 * Pausa a execução por um determinado número de milissegundos.
 * @param {number} ms - O tempo a esperar, em milissegundos.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Navega para a página inicial e aplica otimizações para remover pop-ups e avisos.
 * Utiliza injeção de CSS para ocultar elementos que atrapalham a automação.
 * @param {import('playwright').Page} page - A instância da página do Playwright.
 */
async function initialNavigationAndSetup(page) {
    console.log('1. Acessando o portal e aplicando otimizações...');
    await page.goto('https://pa.equatorialenergia.com.br/', { waitUntil: 'domcontentloaded' });

    // Injeta CSS para remover pop-ups de marketing e sobreposições de forma agressiva.
    // Isso é mais rápido e confiável do que tentar localizá-los e fechá-los.
    await page.addStyleTag({
        content: `
            #pm__popup-21883, .pm__popup, .pm__overlay { 
                display: none !important; 
                visibility: hidden !important; 
                pointer-events: none !important;
            }
        `
    });

    // Aceita o aviso de cookies, se presente.
    try {
        const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
        if (await checkAviso.isVisible({ timeout: 3000 })) {
            await checkAviso.check();
            await page.getByRole('button', { name: 'Enviar' }).click();
        }
    } catch (e) {
        console.log('   Aviso de cookies não encontrado, continuando.');
    }
}

/**
 * Executa o processo de login no portal da Equatorial.
 * @param {import('playwright').Page} page - A instância da página do Playwright.
 * @param {string} cnpj - O CNPJ para o login.
 * @param {string} email - O e-mail associado para o login.
 */
async function performLogin(page, cnpj, email) {
    console.log('2. Realizando Login...');
    const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
    await inputCnpj.waitFor({ state: 'visible' });
    await inputCnpj.fill(cnpj);
    await page.getByRole('button', { name: 'Entrar' }).click({ force: true });

    const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
    await inputEmail.waitFor({ state: 'visible' });
    await inputEmail.fill(email);
    await page.getByRole('button', { name: 'Entrar' }).click({ force: true });

    // Aguarda o redirecionamento para a área do cliente, confirmando o sucesso do login.
    await page.waitForURL(/sua-conta/, { timeout: 45000 });
    console.log('   Login realizado com sucesso.');
}

/**
 * Define a "Conta Contrato" ativa no painel do cliente.
 * Esta etapa é crucial para garantir que as faturas listadas sejam da unidade correta.
 * @param {import('playwright').Page} page - A instância da página do Playwright.
 * @param {string} contrato - O número do contrato a ser definido.
 */
async function selectContract(page, contrato) {
    console.log(`3. Definindo conta contrato ativa para: ${contrato}`);
    const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
    await inputContrato.waitFor({ state: 'visible' });
    await inputContrato.fill(contrato);
    await page.getByRole('button', { name: 'Definir' }).click();
    
    // Aguarda um indicador de que a página recarregou com o novo contrato.
    // Pode ser um loader ou uma pequena pausa.
    await page.waitForLoadState('domcontentloaded');
    await sleep(3000); // Pausa de segurança para garantir a atualização do estado da UI.
    console.log('   Conta contrato definida.');
}

/**
 * Navega para a seção de faturas, seleciona a primeira disponível e captura o PDF
 * através da interceptação de uma requisição POST interna do site.
 * @param {import('playwright').Page} page - A instância da página do Playwright.
 * @param {import('playwright').BrowserContext} context - O contexto do navegador.
 * @returns {Promise<string|null>} - O PDF em formato Base64 ou nulo se nenhuma fatura for encontrada.
 */
async function navigateAndCaptureInvoicePdf(page, context) {
    console.log('4. Navegando para a área de faturas e iniciando captura...');
    const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
    await linkSegundaVia.waitFor({ state: 'visible' });
    await linkSegundaVia.click();

    console.log("   Aguardando tabela de faturas carregar...");
    await page.waitForSelector('#list-bills-segunda-via tbody', { timeout: 30000 });

    const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();
    if (!(await faturaRow.isVisible({ timeout: 10000 }))) {
        console.log("   Nenhuma fatura em aberto encontrada na tabela.");
        return null;
    }

    // Prepara a interceptação da requisição que gera o PDF.
    // Esta é a forma mais eficiente de obter o arquivo, pois não depende de pop-ups.
    const requestPromise = context.waitForEvent('request', {
        predicate: req => req.url().includes('exibir-faturas') && req.method() === 'POST',
        timeout: 20000
    }).catch(() => null);

    // Clica na fatura para abrir o modal e disparar a requisição do PDF.
    await faturaRow.locator('.bill-value').first().click();
    
    const loader = page.getByText('Aguarde');
    if (await loader.isVisible({ timeout: 2000 })) {
        await loader.waitFor({ state: 'hidden', timeout: 30000 });
    }

    await page.getByText('Ver Fatura').waitFor({ state: 'visible' });
    await page.getByText('Ver Fatura').click();

    console.log('5. Aguardando interceptação da requisição do PDF...');
    const request = await requestPromise;

    if (!request) {
        throw new Error("Falha na captura: A requisição POST para 'exibir-faturas' não foi interceptada.");
    }

    const postData = request.postData();
    if (!postData) {
        throw new Error("Falha na captura: A requisição interceptada não continha dados (postData).");
    }

    const params = new URLSearchParams(postData);
    const billBase64 = params.get('bill');

    if (!billBase64 || !billBase64.startsWith('JVBER')) { // 'JVBER' é o início de um PDF em Base64
        throw new Error("Falha na captura: O parâmetro 'bill' não foi encontrado ou não é um PDF válido.");
    }
    
    console.log("   PDF interceptado com sucesso!");
    return billBase64.replace(/\s/g, ''); // Remove espaços em branco
}


// =================================================================================================
// ROTA PRINCIPAL DA API
// =================================================================================================

app.post('/webhook/fatura', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Não autorizado. Token inválido.' });
    }

    const {
        cnpj = '15.070.244/0001-18',
        email = 'adm.financeiro@mov.pro.br',
        contrato
    } = req.body;

    if (!contrato) {
        return res.status(400).json({ error: 'O campo "contrato" é obrigatório.' });
    }

    console.log(`\n=== Nova solicitação para contrato: ${contrato} ===`);

    let browser = null;
    try {
        browser = await chromium.launch({ headless: false, args: BROWSER_ARGS });

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                context = await browser.newContext({
                    acceptDownloads: true,
                    userAgent: USER_AGENT,
                    viewport: { width: 1366, height: 768 },
                    locale: 'pt-BR'
                });
                page = await context.newPage();
                page.setDefaultTimeout(TIMEOUT_GERAL);

                // --- FLUXO DE AUTOMAÇÃO MODULARIZADO ---
                await initialNavigationAndSetup(page);
                await performLogin(page, cnpj, email);
                await selectContract(page, contrato);
                const finalBase64 = await navigateAndCaptureInvoicePdf(page, context);

                if (finalBase64) {
                    await browser.close();
                    return res.json({
                        status: 'success',
                        has_invoice: true,
                        contract: contrato,
                        filename: `fatura_${contrato}.pdf`,
                        file_base64: finalBase64
                    });
                } else {
                    await browser.close();
                    return res.json({
                        status: 'success',
                        message: `Não foram encontradas faturas em aberto para o contrato ${contrato}.`,
                        has_invoice: false
                    });
                }

            } catch (error) {
                console.error(`Erro na tentativa ${tentativa}: ${error.message}`);
                if (page) await page.close().catch(() => {});
                if (context) await context.close().catch(() => {});

                if (tentativa === MAX_TENTATIVAS) {
                    throw error; // Lança o erro para o bloco catch principal
                }
                console.log("Reiniciando processo em 5 segundos...");
                await sleep(5000);
            }
        }
    } catch (error) {
        console.error("Erro fatal no processo:", error);
        if (browser) await browser.close().catch(() => {});
        return res.status(500).json({
            status: 'error',
            message: 'Falha crítica após todas as tentativas.',
            details: error.message
        });
    }
});

// =================================================================================================
// INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================

app.listen(PORT, () => {
    console.log(`Servidor Otimizado rodando na porta ${PORT}. Endpoint: http://localhost:${PORT}/webhook/fatura`);
});