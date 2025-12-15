const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');

// Adiciona o plugin stealth ao playwright
chromium.use(stealth);

// User-Agent realista para Windows 10 Chrome
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseBoolEnv = (value, fallback) => {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
};

const HEADLESS = parseBoolEnv(process.env.PLAYWRIGHT_HEADLESS ?? process.env.HEADLESS, false);

/**
 * Processa múltiplas contas de uma mesma empresa em uma única sessão
 * @param {string} empresa - Nome da empresa
 * @param {string} email - Email para login
 * @param {string} senha - Senha para login
 * @param {Array} contas - Array de objetos {conta, id}
 * @returns {Promise<Array>} Resultados do processamento
 */
async function processCompanyAccounts(empresa, email, senha, contas) {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║ Processando ${contas.length} conta(s) da empresa: ${empresa.toUpperCase().padEnd(18)} ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝\n`);

    let browser = null;
    const resultados = [];

    // Helper para tentar ações múltiplas vezes
    const retryAction = async (action, description, maxRetries = 3) => {
        for (let i = 1; i <= maxRetries; i++) {
            try {
                return await action();
            } catch (e) {
                if (i === maxRetries) throw e;
                console.log(`      ⚠️  Falha em "${description}" (tentativa ${i}/${maxRetries}), tentando novamente...`);
                await sleep(2000 * i);
            }
        }
    };

    try {
        // Inicia o navegador UMA vez
        browser = await chromium.launch({
            headless: HEADLESS,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--ignore-certificate-errors',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1366,768'
            ]
        });

        const context = await browser.newContext({
            acceptDownloads: true,
            userAgent: USER_AGENT,
            viewport: { width: 1366, height: 768 },
            locale: 'pt-BR',
            timezoneId: 'America/Sao_Paulo',
            ignoreHTTPSErrors: true,
            extraHTTPHeaders: {
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        const page = await context.newPage();
        // Aumentando timeout padrão para 2 minutos
        page.setDefaultTimeout(120000);

        // Injeta scripts anti-detecção
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
        });

        // LOGIN (UMA VEZ)
        console.log('🔐 Fazendo login...');
        await retryAction(async () => {
            await page.goto('https://agenciavirtual.equatorialenergia.com.br/Login/', {
                waitUntil: 'networkidle',
                timeout: 120000
            })
        }, 'Carregar página de login');

        await sleep(2000);

        // Destrói popups
        await page.addStyleTag({
            content: `#pm__popup-21883, .pm__popup, .pm__overlay { display: none !important; }`
        });

        // Aceita cookies se aparecer
        try {
            const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
            if (await checkAviso.isVisible({ timeout: 5000 })) {
                await checkAviso.check();
                await page.getByRole('button', { name: 'Enviar' }).click();
                await sleep(1000);
            }
        } catch (e) { }

        // Passo 1: Clica em Entrar
        await retryAction(async () => {
            await page.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible', timeout: 30000 });
            await sleep(500);
            await page.getByRole('button', { name: 'Entrar' }).click();
        }, 'Clicar em Entrar iniciais');
        await sleep(1500);

        // Passo 2: Preenche email
        const inputIdentificacao = page.getByRole('textbox', { name: 'Identificação' });
        await inputIdentificacao.waitFor({ state: 'visible', timeout: 30000 });
        await inputIdentificacao.click();
        await sleep(300);
        await inputIdentificacao.type(email, { delay: 100 });
        console.log('   ✓ Email preenchido');
        await sleep(800);

        // Passo 3: Clica em Continuar (loop até senha aparecer)
        let senhaVisivel = false;
        // Tenta mais vezes o ciclo de continuar -> senha
        for (let i = 1; i <= 5; i++) {
            try {
                const btnContinuar = page.getByRole('button', { name: 'Continuar' });
                if (await btnContinuar.isVisible({ timeout: 5000 })) {
                    await btnContinuar.click();
                    console.log(`   ✓ Continuar clicado (${i})`);
                    await sleep(2500); // Wait um pouco maior

                    const inputSenha = page.getByRole('textbox', { name: 'Senha' });
                    if (await inputSenha.isVisible({ timeout: 10000 })) {
                        senhaVisivel = true;
                        break;
                    }
                }
            } catch (e) { }
            await sleep(1000);
        }

        if (!senhaVisivel) {
            // Tenta verificar se a senha já está visível por algum motivo
            if (await page.getByRole('textbox', { name: 'Senha' }).isVisible({ timeout: 5000 })) {
                senhaVisivel = true;
            } else {
                throw new Error('Campo de senha não apareceu após várias tentativas');
            }
        }

        // Passo 4: Preenche senha
        const inputSenha = page.getByRole('textbox', { name: 'Senha' });
        await inputSenha.click();
        await sleep(300);
        await inputSenha.type(senha, { delay: 100 });
        console.log('   ✓ Senha preenchida');
        await sleep(800);

        // Passo 5: Entra
        await retryAction(async () => {
            await page.getByRole('button', { name: 'Entrar' }).click();
            await page.waitForURL(/Home/, { timeout: 120000, waitUntil: 'domcontentloaded' });
        }, 'Clicar botão Login final e carregar Home');

        console.log('   ✓ Login realizado\n');
        await sleep(2000);

        // PROCESSA CADA CONTA NA MESMA SESSÃO
        for (let i = 0; i < contas.length; i++) {
            const { conta, id } = contas[i];
            console.log(`[${i + 1}/${contas.length}] Processando conta: ${conta}`);

            try {
                // Se não é a primeira conta, vai para Home
                if (i > 0) {
                    console.log('   → Voltando ao Home...');
                    await retryAction(async () => {
                        await page.goto('https://agenciavirtual.equatorialenergia.com.br/Home/', { waitUntil: 'domcontentloaded', timeout: 60000 });
                    }, 'Voltar para Home');
                    await sleep(3000);
                }

                // Seleciona a conta
                await retryAction(async () => {
                    const inputConta = page.getByRole('textbox', { name: 'Digite aqui sua conta' });
                    await inputConta.waitFor({ state: 'visible', timeout: 30000 });
                    await inputConta.click();
                    await sleep(300);
                    await inputConta.fill(''); // Limpa
                    await inputConta.type(conta, { delay: 150 });
                }, 'Preencher campo de conta');

                console.log(`   ✓ Conta digitada`);
                await sleep(1500);

                // Clica em Selecionar
                await retryAction(async () => {
                    await page.locator('div').filter({ hasText: /^Selecionar$/ }).first().click();
                }, 'Clicar em Selecionar Conta');

                console.log('   ✓ Selecionada (Aguardando carregamento...)');

                // Aguarda carregamento de forma mais inteligente
                // Tenta esperar algum elemento que indique sucesso ou o desaparecimento de loaders
                try {
                    // Estratégia mista: Espera um pouco garantido, e depois espera algo da home mudar
                    // O site da equatorial costuma ter um delay grande aqui.
                    await sleep(5000);
                    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
                } catch (e) { }

                // Sleep de segurança ainda necessário devido a natureza do site, mas aumentado
                await sleep(5000);

                // Baixa fatura
                console.log('   → Tentando baixar fatura...');

                const finalBase64 = await retryAction(async () => {
                    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });

                    // Tenta encontrar o botão de várias formas
                    const btnBaixar = page.getByRole('link', { name: 'Baixar segunda via completa' });
                    if (await btnBaixar.isVisible({ timeout: 5000 })) {
                        await btnBaixar.click();
                    } else {
                        // Fallback selector se o texto mudar ou for diferente
                        await page.locator('.card-segunda-via a').first().click();
                    }

                    const download = await downloadPromise;
                    const downloadPath = await download.path();
                    const pdfBuffer = fs.readFileSync(downloadPath);
                    try { fs.unlinkSync(downloadPath); } catch (e) { }
                    return pdfBuffer.toString('base64');
                }, 'Processo de Download da Fatura', 2);

                console.log(`   ✓ Fatura baixada (${(finalBase64.length / 1024).toFixed(1)} KB)\n`);

                resultados.push({
                    success: true,
                    conta,
                    id,
                    filename: `fatura_${conta}.pdf`,
                    file_base64: finalBase64
                });

            } catch (error) {
                console.error(`   ✗ Erro: ${error.message}\n`);
                resultados.push({
                    success: false,
                    conta,
                    id,
                    error: error.message
                });
            }
        }

        await context.close();
        await browser.close();

    } catch (error) {
        console.error(`\n✗ Erro fatal no processamento da empresa ${empresa}: ${error.message}`);
        if (browser) await browser.close().catch(() => { });

        // Marca todas as contas não processadas como erro
        for (const conta of contas) {
            if (!resultados.find(r => r.conta === conta.conta)) {
                resultados.push({
                    success: false,
                    conta: conta.conta,
                    id: conta.id,
                    error: `Erro no login/processamento: ${error.message}`
                });
            }
        }
    }

    return resultados;
}

/**
 * Faz o download da fatura de uma conta específica (LEGACY - mantido para compatibilidade API)
 * @param {string} email - Email para login
 * @param {string} senha - Senha para login
 * @param {string} conta - Número da conta contrato
 * @returns {Promise<{status: string, has_invoice: boolean, account: string, filename: string, file_base64: string}>}
 */
async function downloadInvoice(email, senha, conta) {
    // Chama a nova função com array de 1 conta
    const resultados = await processCompanyAccounts('api-call', email, senha, [{ conta, id: null }]);
    const resultado = resultados[0];

    if (resultado.success) {
        return {
            status: 'success',
            has_invoice: true,
            account: conta,
            filename: resultado.filename,
            file_base64: resultado.file_base64
        };
    } else {
        throw new Error(resultado.error);
    }
}

module.exports = { downloadInvoice, processCompanyAccounts };
