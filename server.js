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
                page.setDefaultTimeout(120000);

                // 1. Acessa Home
                console.log('Carregando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/');
                await page.waitForLoadState('networkidle');

                // 2. Popups e Cookies
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
                console.log('Validando acesso...');
                try {
                    await page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 60000 });
                } catch (e) {
                    if (!page.url().includes('sua-conta')) throw new Error("Login falhou ou demorou demais.");
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

                // 8. Busca Fatura
                console.log("Buscando fatura na tabela...");
                const tbody = page.locator('#list-bills-segunda-via tbody');
                const faturaRow = tbody.locator('tr').first();

                if (!(await faturaRow.isVisible({ timeout: 15000 }))) {
                    console.log("Nenhuma fatura visível.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                const celulaValor = faturaRow.locator('.bill-value').first();
                page.once('dialog', async dialog => { await dialog.dismiss().catch(() => { }); });

                console.log("1. Clicando no valor para abrir modal...");
                await celulaValor.click();

                // Monitoramento do "Aguarde"
                console.log("2. Monitorando 'Aguarde'...");
                try {
                    const loaderAguarde = page.getByText('Aguarde');
                    if (await loaderAguarde.isVisible({ timeout: 5000 })) {
                        await loaderAguarde.waitFor({ state: 'hidden', timeout: 60000 });
                    }
                } catch (e) { }

                console.log("3. Procurando botão 'Ver Fatura'...");
                const btnVerFaturaModal = page.getByText('Ver Fatura');

                try {
                    await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 60000 });
                } catch (e) {
                    throw new Error("Botão 'Ver Fatura' não apareceu.");
                }

                console.log("4. Clicando para abrir Popup...");

                const [popup] = await Promise.all([
                    page.waitForEvent('popup'),
                    btnVerFaturaModal.click()
                ]);

                console.log(">> Popup aberto! Aguardando carregamento completo do visualizador...");

                // IMPORTANTE: Espera o visualizador do Chrome carregar o PDF
                await popup.waitForLoadState();
                await sleep(4000); // Pausa para garantir que o <embed> foi montado

                console.log(`>> URL da Guia: ${popup.url()}`);
                console.log(">> Procurando objeto PDF interno (Embed/Blob)...");

                // --- ESTRATÉGIA DE EXTRAÇÃO CORRIGIDA ---
                // O visualizador do Chrome coloca o PDF dentro de uma tag <embed type="application/pdf">
                // ou serve como um Blob. Vamos caçar esse elemento.

                const base64PDF = await popup.evaluate(async () => {
                    // 1. Verifica se a própria página já é o PDF (content-type header)
                    if (document.contentType === 'application/pdf') {
                        const resp = await fetch(window.location.href);
                        const blob = await resp.blob();
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result.split(',')[1]);
                            reader.readAsDataURL(blob);
                        });
                    }

                    // 2. Se for HTML (Wrapper), procura o <embed> que contém o PDF
                    const embed = document.querySelector('embed[type="application/pdf"]');
                    if (embed) {
                        // Pega a fonte do PDF (geralmente blob:https://...)
                        const pdfSrc = embed.src;
                        console.log(`Fonte PDF encontrada no embed: ${pdfSrc}`);

                        // Faz o fetch dessa fonte interna
                        const resp = await fetch(pdfSrc);
                        const blob = await resp.blob();
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result.split(',')[1]);
                            reader.readAsDataURL(blob);
                        });
                    }

                    return null; // Não achou nada
                });

                if (!base64PDF || base64PDF.length < 1000) {
                    // Se falhar a extração interna, última tentativa:
                    // Tenta forçar um download "salvar como" (apenas funciona se o site permitir)
                    throw new Error("Não foi possível extrair o binário do PDF do visualizador nativo.");
                }

                console.log(`>> Extração concluída! Tamanho do Base64: ${base64PDF.length} caracteres.`);

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
                        message: 'Falha ao processar fatura.',
                        last_error: error.message
                    });
                }
                console.log("Reiniciando em 10s...");
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