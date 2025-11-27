const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

// Adiciona o plugin stealth ao playwright
chromium.use(stealth);

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '057ebcdc28b0b95cabe45341b209d28d';
const MAX_TENTATIVAS = 3;

// User-Agent realista para Windows 10 Chrome
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- ROTA DE HEALTHCHECK ---
app.get('/', (req, res) => {
    res.status(200).send('Equatorial Bot Online 🤖');
});

app.post('/webhook/fatura', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Não autorizado.' });
    }

    const {
        email = 'adm.financeiro@mov.pro.br',
        senha = 'Movfibra15070@',
        conta = '003014474705'
    } = req.body;

    console.log(`\n=== Nova solicitação para conta: ${conta} ===`);

    let browser = null;

    try {
        browser = await chromium.launch({
            headless: true, // Agora com stealth plugin funcionará em headless
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

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                context = await browser.newContext({
                    acceptDownloads: true,
                    userAgent: USER_AGENT,
                    viewport: { width: 1366, height: 768 },
                    locale: 'pt-BR',
                    timezoneId: 'America/Sao_Paulo',
                    ignoreHTTPSErrors: true,
                    // Headers adicionais para parecer mais realista
                    extraHTTPHeaders: {
                        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1'
                    }
                });

                page = await context.newPage();
                page.setDefaultTimeout(60000);

                // Injeta scripts para esconder traços de automação
                await page.addInitScript(() => {
                    // Remove navigator.webdriver
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });

                    // Mock de plugins
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5]
                    });

                    // Mock de languages
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['pt-BR', 'pt', 'en-US', 'en']
                    });

                    // Chrome runtime
                    window.chrome = {
                        runtime: {}
                    };

                    // Permissions
                    const originalQuery = window.navigator.permissions.query;
                    window.navigator.permissions.query = (parameters) => (
                        parameters.name === 'notifications' ?
                            Promise.resolve({ state: Notification.permission }) :
                            originalQuery(parameters)
                    );
                });

                console.log('1. Acessando portal...');
                await page.goto('https://agenciavirtual.equatorialenergia.com.br/Login/', {
                    waitUntil: 'networkidle',
                    timeout: 60000
                });

                // Aguarda um pouco para simular comportamento humano
                await sleep(2000);

                // Destruição de Popups
                await page.addStyleTag({
                    content: `
                    #pm__popup-21883, .pm__popup, .pm__overlay { display: none !important; visibility: hidden !important; pointer-events: none !important; z-index: -9999 !important; }
                `});

                // Cookies
                try {
                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 3000 })) {
                        await checkAviso.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                        await sleep(1000);
                    }
                } catch (e) { }

                console.log('2. Realizando Login...');

                // Passo 1: Clica no botão Entrar inicial
                const btnEntrarInicial = page.getByRole('button', { name: 'Entrar' });
                await btnEntrarInicial.waitFor({ state: 'visible', timeout: 10000 });
                await sleep(500);
                await btnEntrarInicial.click();
                await sleep(1500);

                // Passo 2: Preenche o email (Identificação)
                const inputIdentificacao = page.getByRole('textbox', { name: 'Identificação' });
                await inputIdentificacao.waitFor({ state: 'visible', timeout: 10000 });
                await inputIdentificacao.click();
                await sleep(300);
                // Digita com delay humano
                await inputIdentificacao.type(email, { delay: 100 });
                console.log('   Email preenchido');
                await sleep(800);

                // Passo 3: Clica em Continuar (precisa clicar 2 vezes - bug do site)
                const btnContinuar = page.getByRole('button', { name: 'Continuar' });

                // Primeira tentativa (geralmente falha)
                try {
                    await btnContinuar.click();
                    console.log('   Botão Continuar clicado (tentativa 1)');
                    await sleep(800);
                } catch (e) {
                    console.log('   Primeira tentativa de Continuar falhou (esperado)');
                }

                // Segunda tentativa (deve funcionar)
                await btnContinuar.click();
                await sleep(2000);
                console.log('   Botão Continuar clicado (tentativa 2)');

                // Passo 4: Preenche a senha
                const inputSenha = page.getByRole('textbox', { name: 'Senha' });
                await inputSenha.waitFor({ state: 'visible', timeout: 10000 });
                await inputSenha.click();
                await sleep(300);
                await inputSenha.type(senha, { delay: 100 });
                console.log('   Senha preenchida');
                await sleep(800);

                // Passo 5: Clica em Entrar para logar
                await page.getByRole('button', { name: 'Entrar' }).click();
                console.log('   Botão Entrar (login) clicado');

                // Aguarda navegação após login
                await page.waitForURL(/Home/, { timeout: 30000, waitUntil: 'domcontentloaded' });
                console.log('   Login realizado com sucesso');
                await sleep(2000);

                // Passo 6: Navega para Home (se necessário)
                if (!page.url().includes('Home')) {
                    await page.goto('https://agenciavirtual.equatorialenergia.com.br/Home/?sc=7ac192c4-caab-4967-844f-14c485483e3f', { waitUntil: 'domcontentloaded' });
                    await sleep(2000);
                }

                console.log('3. Selecionando conta...');

                // Passo 7: Digita o número da conta
                const inputConta = page.getByRole('textbox', { name: 'Digite aqui sua conta' });
                await inputConta.waitFor({ state: 'visible', timeout: 10000 });
                await inputConta.click();
                await sleep(300);
                await inputConta.type(conta, { delay: 150 });
                console.log(`   Conta ${conta} digitada`);
                await sleep(1200);

                // Passo 8: Clica em Selecionar
                await page.locator('div').filter({ hasText: /^Selecionar$/ }).first().click();
                console.log('   Botão Selecionar clicado');
                await sleep(3000);

                console.log('4. Baixando fatura...');

                // Passo 9: Baixa a segunda via
                const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
                await page.getByRole('link', { name: 'Baixar segunda via completa' }).click();
                const download = await downloadPromise;

                // Converte o download para base64
                const downloadPath = await download.path();
                const pdfBuffer = fs.readFileSync(downloadPath);
                const finalBase64 = pdfBuffer.toString('base64');

                console.log(`>> SUCESSO. Tamanho: ${finalBase64.length}`);

                await browser.close();
                return res.json({
                    status: 'success',
                    has_invoice: true,
                    account: conta,
                    filename: `fatura_${conta}.pdf`,
                    file_base64: finalBase64
                });

            } catch (error) {
                console.error(`Erro na tentativa ${tentativa}: ${error.message}`);

                // --- DEBUG: Screenshot do erro ---
                if (page) {
                    try {
                        const screenshotDir = './screenshots';
                        if (!fs.existsSync(screenshotDir)) {
                            fs.mkdirSync(screenshotDir);
                        }
                        const screenshotPath = path.join(screenshotDir, `erro_tentativa_${tentativa}.png`);
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        console.log(`[DEBUG] Screenshot salvo em: ${screenshotPath}`);
                    } catch (e) { console.log("Falha ao tirar screenshot"); }
                }

                if (page) await page.close().catch(() => { });
                if (context) await context.close().catch(() => { });

                if (tentativa === MAX_TENTATIVAS) {
                    if (browser) await browser.close().catch(() => { });
                    return res.status(500).json({ status: 'error', message: 'Falha após 3 tentativas.', last_error: error.message });
                }
                await sleep(5000);
            }
        }
    } catch (error) {
        console.error("Erro fatal:", error);
        if (browser) await browser.close().catch(() => { });
        return res.status(500).json({ error: 'Erro interno crítico.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Playwright rodando na porta ${PORT}`);
});