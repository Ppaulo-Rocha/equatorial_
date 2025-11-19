const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;

// User Agent de um navegador comum (Chrome Windows)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/webhook/fatura', async (req, res) => {
    // 1. Autenticação Básica
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Não autorizado. Token inválido.' });
    }

    // 2. Extração de Dados
    const {
        cnpj = '15.070.244/0001-18',
        email = 'adm.financeiro@mov.pro.br',
        contrato = '000108799374'
    } = req.body;

    console.log(`\n=== Nova solicitação para contrato: ${contrato} ===`);

    let browser = null;

    try {
        // Inicia o browser
        browser = await chromium.launch({
            headless: false, // Mude para true em produção se preferir
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled' // Tenta esconder que é automação
            ]
        });

        // Loop de Tentativas
        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                // OTIMIZAÇÃO 1: Contexto configurado como usuário real
                context = await browser.newContext({
                    userAgent: USER_AGENT,
                    viewport: { width: 1366, height: 768 },
                    locale: 'pt-BR',
                    timezoneId: 'America/Sao_Paulo',
                    acceptDownloads: true,
                    permissions: ['geolocation'], // Engana algumas verificações
                });

                page = await context.newPage();
                page.setDefaultTimeout(60000); // Reduzi para 60s, pois deve ser rápido agora

                // OTIMIZAÇÃO 2: Bloqueio agressivo de recursos inúteis
                await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,css}', route => route.abort());
                await page.route('**/*analytics*', route => route.abort());
                await page.route('**/*google-services*', route => route.abort());
                await page.route('**/*facebook*', route => route.abort());
                // Não bloqueie JS geral, pois o site precisa dele para funcionar

                // --- PASSO 1: NAVEGAÇÃO INICIAL ---
                console.log('1. Acessando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/', { waitUntil: 'domcontentloaded' });

                // OTIMIZAÇÃO 3: Não espera networkidle, espera o modal ou o botão de login
                // Tenta fechar popup se aparecer rápido
                try {
                    const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                    if (await btnFechar.isVisible({ timeout: 3000 })) await btnFechar.click();
                } catch (e) { }

                // --- PASSO 2: LOGIN ---
                console.log('2. Realizando Login...');

                const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputCnpj.waitFor({ state: 'visible', timeout: 15000 }); // Timeout curto para falhar logo se não carregar
                await inputCnpj.fill(cnpj);

                // Clica e espera o campo de email aparecer (indica que o CNPJ foi aceito)
                await page.getByRole('button', { name: 'Entrar' }).click();

                const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
                await inputEmail.waitFor({ state: 'visible' });
                await inputEmail.fill(email);

                // Clica e aguarda navegação
                await page.getByRole('button', { name: 'Entrar' }).click();

                // Validação de Login (espera URL mudar OU elemento da home)
                await Promise.race([
                    page.waitForURL(/sua-conta/, { timeout: 30000 }),
                    page.waitForSelector('.welcome-message', { timeout: 30000 }).catch(() => null) // Exemplo genérico
                ]);

                // --- PASSO 3: ÁREA DO CLIENTE ---
                console.log('3. Indo para área de faturas...');
                // Se já não estiver na URL certa, força a ida
                if (!page.url().includes('sua-conta')) {
                    await page.goto('https://pa.equatorialenergia.com.br/sua-conta/', { waitUntil: 'domcontentloaded' });
                }

                // Definir Contrato
                const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                // Tenta preencher direto. Se falhar, pode ser o modal de termos
                try {
                    await inputContrato.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) {
                    // Trata modal de termos apenas se o input não aparecer
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible()) {
                        await checkTermo.check();
                        await page.getByRole('checkbox', { name: 'Concordo em disponibilizar' }).check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                        await inputContrato.waitFor({ state: 'visible' });
                    }
                }

                await inputContrato.fill(contrato);
                await page.getByRole('button', { name: 'Definir' }).click();

                // Aguarda visualmente a confirmação ou o desaparecimento do loading
                await sleep(1500);

                // Acessar Segunda Via
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                await linkSegundaVia.waitFor({ state: 'visible' });
                await linkSegundaVia.click();

                // OTIMIZAÇÃO: Espera a tabela carregar especificamente
                const tabelaSelector = '#list-bills-segunda-via tbody';
                await page.waitForSelector(tabelaSelector, { timeout: 20000 });

                // --- PASSO 4: SELEÇÃO DA FATURA ---
                console.log("4. Buscando fatura na tabela...");
                const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();

                if (!(await faturaRow.isVisible())) {
                    console.log("   Nenhuma fatura encontrada.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                // Clica no valor
                await faturaRow.locator('.bill-value').first().click();

                // --- PASSO 5: INTERCEPTAÇÃO ---
                console.log("5. Aguardando modal e interceptando...");

                // Aguarda o botão do modal aparecer (sinal que o loader sumiu)
                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 15000 });

                // Prepara listener
                const requestPromise = context.waitForEvent('request', {
                    predicate: request => request.url().includes('exibir-faturas') && request.method() === 'POST',
                    timeout: 15000
                }).catch(() => null);

                // Clica
                await btnVerFaturaModal.click();

                // Aguarda requisição
                const request = await requestPromise;
                let finalBase64 = null;

                if (request) {
                    const postData = request.postData();
                    if (postData) {
                        const params = new URLSearchParams(postData);
                        const billBase64 = params.get('bill');
                        if (billBase64 && billBase64.startsWith('JVBER')) {
                            finalBase64 = billBase64;
                        }
                    }
                }

                if (!finalBase64) throw new Error("Falha ao capturar PDF via interceptação.");

                // Sucesso!
                finalBase64 = finalBase64.replace(/\s/g, '');
                console.log(`>> SUCESSO! PDF recuperado: ${finalBase64.length} chars.`);

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
                    return res.status(500).json({ status: 'error', message: 'Falha após tentativas.', error: error.message });
                }
                await sleep(5000); // Espera menor entre tentativas
            }
        }
    } catch (error) {
        console.error("Erro crítico:", error);
        if (browser) await browser.close().catch(() => { });
        return res.status(500).json({ error: 'Erro interno.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Otimizado rodando na porta ${PORT}`);
});