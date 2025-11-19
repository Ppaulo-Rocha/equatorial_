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
                page.setDefaultTimeout(120000); // 2 minutos de tolerância total

                // 1. Acessa Home
                console.log('Carregando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/');
                await page.waitForLoadState('networkidle');

                // 2. Popups/Cookies
                try {
                    const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                    if (await btnFechar.isVisible({ timeout: 5000 })) await btnFechar.click();

                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 5000 })) {
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

                // Validação "mov"
                console.log('Validando acesso (Aguardando até 60s)...');
                try {
                    await page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 60000 });
                } catch (e) {
                    if (!page.url().includes('sua-conta')) throw new Error("Login demorou demais ou falhou.");
                    console.log("Aviso: Validação visual falhou, mas URL parece correta. Prosseguindo...");
                }

                // 4. Navegação
                console.log('Acessando "Sua Conta"...');
                await page.goto('https://pa.equatorialenergia.com.br/sua-conta/');
                await page.waitForLoadState('networkidle');

                // Termos internos
                try {
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible({ timeout: 5000 })) {
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

                // 8. Tabela
                console.log("Buscando fatura na tabela...");
                const tbody = page.locator('#list-bills-segunda-via tbody');
                const faturaRow = tbody.locator('tr').first();

                if (!(await faturaRow.isVisible({ timeout: 15000 }))) {
                    console.log("Nenhuma fatura visível na lista.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                const celulaValor = faturaRow.locator('.bill-value').first();
                page.once('dialog', async dialog => { await dialog.dismiss().catch(() => { }); });

                console.log("1. Clicando no valor para abrir modal...");
                await celulaValor.click();

                // Monitoramento do "Aguarde"
                console.log("2. Monitorando status do processamento...");
                try {
                    const loaderAguarde = page.getByText('Aguarde');
                    if (await loaderAguarde.isVisible({ timeout: 5000 })) {
                        console.log("   Status: Processando (Aguarde visível)...");
                        await loaderAguarde.waitFor({ state: 'hidden', timeout: 60000 });
                        console.log("   Status: Processamento concluído.");
                    }
                } catch (e) { }

                console.log("3. Procurando botão 'Ver Fatura' (Timeout 60s)...");
                const btnVerFaturaModal = page.getByText('Ver Fatura');

                try {
                    await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 60000 });
                    console.log("   Botão encontrado!");
                } catch (e) {
                    throw new Error("O botão 'Ver Fatura' não apareceu após 60 segundos de espera.");
                }

                // --- CORREÇÃO: MONITORA A REDE GLOBALMENTE ---
                console.log("4. Configurando interceptador de PDF...");

                // Usamos waitForEvent('response') no CONTEXTO. 
                // Isso captura qualquer resposta de qualquer aba (inclusive a nova popup).
                // Corrige o erro "context.waitForResponse is not a function".
                const pdfPromise = context.waitForEvent('response', response => {
                    const isPDF = response.headers()['content-type'] === 'application/pdf' ||
                        response.headers()['content-type'] === 'application/octet-stream';
                    const isCorrectURL = response.url().includes('exibir-faturas') || response.url().includes('.pdf');

                    return response.status() === 200 && isPDF && isCorrectURL;
                });

                console.log("5. Clicando no botão 'Ver Fatura'...");

                // Não precisamos esperar a variável 'popup', apenas o evento de clique
                // pois estamos vigiando a rede, não a janela.
                await btnVerFaturaModal.click();

                console.log(">> Aguardando chegada do arquivo pela rede...");

                // Espera a promessa da rede ser cumprida (Timeout de 60s)
                const responsePDF = await pdfPromise.catch(() => null);

                if (!responsePDF) {
                    throw new Error("Timeout: O arquivo PDF não foi detectado na rede.");
                }

                console.log(">> Pacote capturado! Baixando buffer...");
                const pdfBuffer = await responsePDF.body();
                console.log(`>> Tamanho capturado: ${pdfBuffer.length} bytes`);

                if (pdfBuffer.length < 1000) {
                    throw new Error("Arquivo capturado inválido ou vazio (menos de 1KB).");
                }

                const base64PDF = pdfBuffer.toString('base64');

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
                console.log("Lentidão detectada. Reiniciando em 10 segundos...");
                await sleep(10000);
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