const express = require('express');
const { chromium } = require('playwright');
const app = express();

app.use(express.json());

// CONFIGURAÇÕES
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/webhook/fatura', async (req, res) => {
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
        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox']
        });

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                context = await browser.newContext({ acceptDownloads: true });
                page = await context.newPage();
                page.setDefaultTimeout(90000);

                // 1. Acessa Home
                console.log('Carregando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/');
                await page.waitForLoadState('networkidle');

                // 2. Popups/Cookies
                try {
                    const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                    if (await btnFechar.isVisible({ timeout: 3000 })) await btnFechar.click();

                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 3000 })) {
                        await checkAviso.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                        await sleep(1000);
                    }
                } catch (e) { }

                // 3. Login
                console.log('Realizando Login...');
                const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputCnpj.waitFor({ state: 'visible' });
                await inputCnpj.fill(cnpj);
                await sleep(500);
                await page.getByRole('button', { name: 'Entrar' }).click();

                const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
                await inputEmail.waitFor({ state: 'visible' });
                await inputEmail.fill(email);
                await sleep(500);
                await page.getByRole('button', { name: 'Entrar' }).click();

                // Validação
                console.log('Validando acesso...');
                await page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 20000 });

                // 4. Navegação
                console.log('Acessando "Sua Conta"...');
                await page.goto('https://pa.equatorialenergia.com.br/sua-conta/');
                await page.waitForLoadState('networkidle');

                // Termos internos
                try {
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible({ timeout: 3000 })) {
                        await checkTermo.check();
                        await page.getByRole('checkbox', { name: 'Concordo em disponibilizar' }).check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                        await sleep(1000);
                    }
                } catch (e) { }

                // 5. Selecionar Contrato
                console.log('Selecionando contrato...');
                const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputContrato.waitFor({ state: 'visible' });
                await inputContrato.fill(contrato);
                await page.getByRole('button', { name: 'Definir' }).click();
                await sleep(3000);

                // 6. Segunda Via
                console.log('Indo para faturas...');
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                await linkSegundaVia.waitFor({ state: 'visible' });
                await linkSegundaVia.click();
                await page.waitForLoadState('networkidle');

                // 7. Filtro
                console.log('Aplicando filtro...');
                const precisaClicar = await page.$eval('#apenas-vencidas', (el) => !el.checked).catch(() => false);
                if (precisaClicar) {
                    await page.evaluate(() => {
                        const checkbox = document.getElementById('apenas-vencidas');
                        if (checkbox) checkbox.parentElement.click();
                    });
                    await sleep(4000);
                }

                // 8. Tabela e Modal
                console.log("Buscando fatura na tabela...");
                const tbody = page.locator('#list-bills-segunda-via tbody');
                const faturaRow = tbody.locator('tr').first();

                if (!(await faturaRow.isVisible({ timeout: 10000 }))) {
                    console.log("Nenhuma fatura visível na lista.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                const celulaValor = faturaRow.locator('.bill-value').first();
                page.once('dialog', async dialog => { await dialog.dismiss().catch(() => { }); });

                console.log("1. Clicando no valor para abrir modal...");
                await celulaValor.click();

                console.log("2. Aguardando processamento do modal...");
                try {
                    const loaderAguarde = page.getByText('Aguarde');
                    if (await loaderAguarde.isVisible({ timeout: 5000 })) {
                        await loaderAguarde.waitFor({ state: 'hidden', timeout: 60000 });
                    }
                    await sleep(1500);
                } catch (e) { }

                console.log("3. Procurando botão 'Ver Fatura' dentro do modal...");
                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 15000 });

                console.log("4. Clicando em 'Ver Fatura' para abrir o PDF...");

                const [popup] = await Promise.all([
                    page.waitForEvent('popup'),
                    btnVerFaturaModal.click()
                ]);

                console.log(">> Popup capturado! Aguardando carregamento...");
                await popup.waitForLoadState();

                // Pequena pausa para garantir renderização da URL final
                await sleep(2000);

                const pdfUrl = popup.url();
                console.log(`>> URL Final Capturada: ${pdfUrl}`);

                // --- NOVA LÓGICA DE VALIDAÇÃO DE DOWNLOAD ---
                console.log(">> Baixando arquivo para validar...");

                const responsePDF = await context.request.get(pdfUrl);

                // Verifica status HTTP
                if (!responsePDF.ok()) {
                    throw new Error(`Falha no download. Status HTTP: ${responsePDF.status()}`);
                }

                const pdfBuffer = await responsePDF.body();
                const contentType = responsePDF.headers()['content-type'];

                console.log(`>> Tamanho do arquivo: ${pdfBuffer.length} bytes`);
                console.log(`>> Tipo do arquivo: ${contentType}`);

                // Validações Críticas
                if (!pdfBuffer || pdfBuffer.length < 500) {
                    // Se for menor que 500 bytes, provavelmente é erro ou arquivo vazio
                    throw new Error("O arquivo baixado está vazio ou corrompido (tamanho insuficiente).");
                }

                // Opcional: Validar se é PDF mesmo (alguns servidores retornam octet-stream, então o check é flexível)
                if (contentType && contentType.includes('text/html')) {
                    throw new Error("A URL retornou uma página HTML em vez do PDF.");
                }

                const base64PDF = pdfBuffer.toString('base64');

                // Se chegou aqui, o arquivo é válido. Fecha e envia.
                await browser.close();

                return res.json({
                    status: 'success',
                    has_invoice: true,
                    contract: contrato,
                    filename: `fatura_${contrato}.pdf`,
                    file_base64: base64PDF
                });

            } catch (error) {
                console.error(`Erro na tentativa ${tentativa}: ${error.message}`);

                // Garante limpeza antes da próxima tentativa
                if (page) await page.close();
                if (context) await context.close();

                if (tentativa === MAX_TENTATIVAS) {
                    console.log("Número máximo de tentativas excedido.");
                    if (browser) await browser.close();
                    return res.status(500).json({
                        status: 'error',
                        message: 'Falha ao obter o PDF após 3 tentativas.',
                        last_error: error.message
                    });
                }
                console.log("Reiniciando processo...");
                await sleep(3000);
            }
        }

    } catch (error) {
        console.error("Erro fatal:", error);
        if (browser) await browser.close();
        return res.status(500).json({ error: 'Erro crítico no servidor.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});