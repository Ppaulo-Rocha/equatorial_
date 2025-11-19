const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;

// Helper para pausas (usado raramente agora)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/webhook/fatura', async (req, res) => {
    // 1. Autenticação
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

    console.log(`\n=== Contrato: ${contrato} ===`);

    let browser = null;

    try {
        // OTIMIZAÇÃO 1: Args para performance máxima (Modo Turbo)
        browser = await chromium.launch({
            headless: false, // Mude para false apenas se precisar debugar visualmente
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-extensions'
            ]
        });

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                context = await browser.newContext({
                    acceptDownloads: true,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });

                // OTIMIZAÇÃO 2: Bloquear carregamento de "Lixo" (Imagens, CSS, Fontes)
                // Isso reduz o tempo de carregamento em até 80%
                await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,ttf,otf}', route => route.abort());

                page = await context.newPage();
                // Reduzi o timeout pois o script agora é muito mais rápido. 
                // Se travar por 60s, é melhor reiniciar do que esperar 2 min.
                page.setDefaultTimeout(60000);

                // --- PASSO 1: LOGIN RÁPIDO ---
                console.log('1. Acessando portal...');
                // 'domcontentloaded' é mais rápido que networkidle
                await page.goto('https://pa.equatorialenergia.com.br/', { waitUntil: 'domcontentloaded' });

                // Estratégia "Fail-Fast" para Popup:
                // Tenta preencher o login direto. Se não der, fecha o popup.
                try {
                    const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                    if (await inputCnpj.isVisible({ timeout: 3000 })) {
                        await inputCnpj.fill(cnpj);
                    } else {
                        // Se o input não está visível, provavelmente tem popup
                        const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                        if (await btnFechar.isVisible({ timeout: 2000 })) await btnFechar.click();

                        // Tenta preencher de novo
                        await inputCnpj.fill(cnpj);
                    }
                    await page.getByRole('button', { name: 'Entrar' }).click();

                    // Preenche email
                    await page.getByRole('textbox', { name: 'email@empresa.com' }).fill(email);
                    await page.getByRole('button', { name: 'Entrar' }).click();

                } catch (e) {
                    throw new Error(`Erro no fluxo de login: ${e.message}`);
                }

                // Validação de Login (Espera URL mudar ou elemento da home)
                try {
                    await Promise.race([
                        page.waitForURL(/sua-conta/, { timeout: 30000, waitUntil: 'domcontentloaded' }),
                        page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 30000 })
                    ]);
                } catch (e) {
                    if (!page.url().includes('sua-conta')) throw new Error("Login falhou (Timeout).");
                }

                // --- PASSO 2: NAVEGAÇÃO E CONTRATO ---
                console.log('2. Área de faturas...');
                if (!page.url().includes('sua-conta')) {
                    await page.goto('https://pa.equatorialenergia.com.br/sua-conta/', { waitUntil: 'domcontentloaded' });
                }

                // Tratamento rápido de termos (se houver)
                try {
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible({ timeout: 3000 })) {
                        await checkTermo.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { }

                // Contrato
                const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputContrato.waitFor({ state: 'visible' });
                await inputContrato.fill(contrato);
                await page.getByRole('button', { name: 'Definir' }).click();

                // Pequeno delay técnico para o AJAX do site atualizar o contrato na sessão
                await sleep(2000);

                // Ir para Segunda Via
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                // Força o clique via JS se o elemento estiver coberto ou animando
                await linkSegundaVia.click({ force: true });

                // Aqui usamos um waitForSelector em vez de networkidle para ser mais rápido
                await page.waitForSelector('#list-bills-segunda-via tbody tr', { timeout: 20000 });

                // --- PASSO 3: SELEÇÃO DA FATURA ---
                console.log("3. Abrindo fatura...");
                const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();

                if (!(await faturaRow.isVisible())) {
                    console.log("   Nenhuma fatura encontrada.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                await faturaRow.locator('.bill-value').first().click();

                // Aguarda o botão do modal aparecer
                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 15000 });

                // --- PASSO 4: ESTRATÉGIA CIRÚRGICA (INTERCEPTAÇÃO INSTANTÂNEA) ---
                console.log("4. Capturando Payload POST (Modo Turbo)...");

                // A. Prepara a armadilha para pegar o POST "exibir-faturas"
                const requestPromise = context.waitForEvent('request', {
                    predicate: request => {
                        return request.url().includes('exibir-faturas') &&
                            request.method() === 'POST';
                    },
                    timeout: 15000 // 15s é muito tempo para um clique disparar
                }).catch(() => null);

                // B. Clica no botão
                // Não esperamos popup, não esperamos navegação visual. Apenas o clique.
                await btnVerFaturaModal.click();

                // C. Pega os dados "no ar"
                const request = await requestPromise;

                if (!request) {
                    throw new Error("A requisição POST com o PDF não foi disparada pelo clique.");
                }

                // D. Extrai o Base64 do corpo da requisição
                const postData = request.postData();
                const params = new URLSearchParams(postData);
                let finalBase64 = params.get('bill');

                if (!finalBase64 || !finalBase64.startsWith('JVBER')) {
                    throw new Error("O payload interceptado não contém um PDF válido (bill).");
                }

                // Limpeza final
                finalBase64 = finalBase64.replace(/\s/g, ''); // Remove quebras de linha/espaços
                const tamanhoBytes = Buffer.from(finalBase64, 'base64').length;

                console.log(`>> SUCESSO! PDF capturado na origem: ${tamanhoBytes} bytes.`);

                // Fecha tudo imediatamente (não precisa esperar logout ou renderização)
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

                // Tenta salvar screenshot do erro apenas se a página existir
                if (page && !page.isClosed()) {
                    try {
                        await page.screenshot({ path: `erro_tentativa_${tentativa}.png` });
                    } catch (e) { }
                }

                if (page) await page.close().catch(() => { });
                if (context) await context.close().catch(() => { });

                if (tentativa === MAX_TENTATIVAS) {
                    console.log("Esgotadas todas as tentativas.");
                    if (browser) await browser.close().catch(() => { });

                    return res.status(500).json({
                        status: 'error',
                        message: 'Falha após 3 tentativas.',
                        last_error: error.message
                    });
                }

                // Espera curta antes de tentar de novo
                await sleep(5000);
            }
        }

    } catch (error) {
        console.error("Erro fatal no servidor:", error);
        if (browser) await browser.close().catch(() => { });
        return res.status(500).json({ error: 'Erro interno crítico.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Turbo rodando na porta ${PORT}`);
});