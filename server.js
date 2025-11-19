const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;

// 1. CONFIGURAÇÃO ANTI-BOT: User-Agent Real
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/webhook/fatura', async (req, res) => {
    // Autenticação
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Não autorizado. Token inválido.' });
    }

    const {
        cnpj = '15.070.244/0001-18',
        email = 'adm.financeiro@mov.pro.br',
        contrato = '000108799374'
    } = req.body;

    console.log(`\n=== Nova solicitação para contrato: ${contrato} ===`);

    let browser = null;

    try {
        // 2. CONFIGURAÇÃO ANTI-BOT: Argumentos de lançamento
        browser = await chromium.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled', // Esconde flag de automação
                '--disable-dev-shm-usage', // Evita quebras de memória (crash)
                '--disable-gpu' // Estabiliza em algumas máquinas Windows
            ]
        });

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                // 3. CONFIGURAÇÃO ANTI-BOT: Contexto com User-Agent e Viewport
                context = await browser.newContext({
                    acceptDownloads: true,
                    userAgent: USER_AGENT,
                    viewport: { width: 1366, height: 768 },
                    locale: 'pt-BR'
                });

                page = await context.newPage();
                page.setDefaultTimeout(60000); // Timeout ajustado para 60s

                // --- PASSO 1: NAVEGAÇÃO INICIAL ---
                console.log('1. Acessando portal...');
                // 4. OTIMIZAÇÃO: Substitui networkidle por domcontentloaded (mais rápido)
                await page.goto('https://pa.equatorialenergia.com.br/', { waitUntil: 'domcontentloaded' });

                // 5. OTIMIZAÇÃO: Destruição de Popups via CSS (Força Bruta)
                // Em vez de tentar clicar em "Fechar", nós injetamos um estilo que torna o popup invisível e não clicável.
                await page.addStyleTag({
                    content: `
                    #pm__popup-21883, .pm__popup, .pm__overlay { 
                        display: none !important; 
                        visibility: hidden !important; 
                        pointer-events: none !important;
                        z-index: -9999 !important;
                    }
                `});

                // Tratamento de Cookies (rápido)
                try {
                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 3000 })) {
                        await checkAviso.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { }

                // --- PASSO 2: LOGIN ---
                console.log('2. Realizando Login...');
                const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputCnpj.waitFor({ state: 'visible' });
                await inputCnpj.fill(cnpj);

                // USO DE FORCE: TRUE para ignorar qualquer sobreposição restante
                await page.getByRole('button', { name: 'Entrar' }).click({ force: true });

                const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
                await inputEmail.waitFor({ state: 'visible' });
                await inputEmail.fill(email);

                // USO DE FORCE: TRUE novamente
                await page.getByRole('button', { name: 'Entrar' }).click({ force: true });

                // Validação de Login (Sem networkidle)
                await Promise.race([
                    page.waitForURL(/sua-conta/, { timeout: 30000 }),
                    page.waitForSelector('.welcome-message', { timeout: 30000 }).catch(() => null)
                ]);

                // --- PASSO 3: ÁREA DO CLIENTE ---
                console.log('3. Indo para área de faturas...');
                if (!page.url().includes('sua-conta')) {
                    await page.goto('https://pa.equatorialenergia.com.br/sua-conta/', { waitUntil: 'domcontentloaded' });
                }

                // Termos (Logica mantida)
                try {
                    // Espera curta para ver se o modal de termos aparece
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible({ timeout: 5000 })) {
                        await checkTermo.check();
                        await page.getByRole('checkbox', { name: 'Concordo em disponibilizar' }).check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { }

                // Definir Contrato
                const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputContrato.waitFor({ state: 'visible' });
                await inputContrato.fill(contrato);
                await page.getByRole('button', { name: 'Definir' }).click();
                await sleep(3000);

                // Acessar Segunda Via
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                await linkSegundaVia.waitFor({ state: 'visible' });
                await linkSegundaVia.click();

                // 6. OTIMIZAÇÃO: Espera explícita pela tabela em vez de rede ociosa
                console.log("   Aguardando tabela carregar...");
                await page.waitForSelector('#list-bills-segunda-via tbody', { timeout: 30000 });

                // Filtros (Opcional, mantido conforme original)
                const checkboxVencidas = page.locator('#apenas-vencidas');
                if (await checkboxVencidas.count() > 0) {
                    await sleep(1000); // Pequena pausa para UI estabilizar
                }

                // --- PASSO 4: SELEÇÃO DA FATURA ---
                console.log("4. Buscando fatura na tabela...");
                const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();

                if (!(await faturaRow.isVisible({ timeout: 10000 }))) {
                    console.log("   Nenhuma fatura encontrada na tabela.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                await faturaRow.locator('.bill-value').first().click();

                // Aguarda loader desaparecer
                try {
                    const loader = page.getByText('Aguarde');
                    if (await loader.isVisible({ timeout: 2000 })) await loader.waitFor({ state: 'hidden', timeout: 30000 });
                } catch (e) { }

                // --- PASSO 5: INTERCEPTAÇÃO ---
                console.log("5. Interceptando PDF...");

                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 30000 });

                const requestPromise = context.waitForEvent('request', {
                    predicate: request => request.url().includes('exibir-faturas') && request.method() === 'POST',
                    timeout: 20000
                }).catch(() => null);

                await btnVerFaturaModal.click();

                const request = await requestPromise;
                let finalBase64 = null;

                if (request) {
                    console.log("   [SUCESSO] Requisição POST interceptada!");
                    const postData = request.postData();
                    if (postData) {
                        const params = new URLSearchParams(postData);
                        const billBase64 = params.get('bill');
                        if (billBase64 && billBase64.startsWith('JVBER')) {
                            finalBase64 = billBase64;
                        }
                    }
                }

                if (!finalBase64) throw new Error("Não foi possível capturar o PDF via interceptação.");

                finalBase64 = finalBase64.replace(/\s/g, '');
                console.log(`>> SUCESSO. Tamanho: ${finalBase64.length} chars.`);

                await browser.close();
                return res.json({
                    status: 'success',
                    has_invoice: true,
                    contract: contrato,
                    filename: `fatura_${contrato}.pdf`,
                    file_base64: finalBase64
                });

            } catch (error) {
                console.error(`Erro na tentativa ${tentativa}: ${error.message}`);
                if (page) await page.close().catch(() => { });
                if (context) await context.close().catch(() => { });

                if (tentativa === MAX_TENTATIVAS) {
                    if (browser) await browser.close().catch(() => { });
                    return res.status(500).json({
                        status: 'error',
                        message: 'Falha após 3 tentativas.',
                        last_error: error.message
                    });
                }
                console.log("Reiniciando em 5s...");
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
    console.log(`Servidor Otimizado rodando na porta ${PORT}`);
});