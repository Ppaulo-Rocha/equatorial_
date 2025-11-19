const express = require('express');
const { chromium } = require('playwright');
const app = express();

app.use(express.json());

// CONFIGURAÇÕES
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123';
const MAX_TENTATIVAS = 3;

// Aumentei o sleep padrão se precisar usar
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
            headless: false, // Mude para false se quiser ver o "Aguarde" na tela
            args: ['--no-sandbox']
        });

        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                context = await browser.newContext({ acceptDownloads: true });
                page = await context.newPage();
                // Aumentei o timeout geral para 90s (sites lentos exigem paciência)
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

                // 4. Navegação Interna
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

                // 8. Captura da Fatura (COM A NOVA ESPERA)
                console.log("Buscando fatura na tabela...");
                const tbody = page.locator('#list-bills-segunda-via tbody');
                const faturaRow = tbody.locator('tr').first();

                if (!(await faturaRow.isVisible({ timeout: 10000 }))) {
                    console.log("Nenhuma fatura visível na lista.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                const celulaValor = faturaRow.locator('.bill-value').first();

                // Prepara para aceitar Dialogs
                page.once('dialog', async dialog => { await dialog.dismiss().catch(() => { }); });

                console.log("Clicando na fatura...");

                // --- INÍCIO DA LÓGICA DE ESPERA DO "AGUARDE" ---

                // Clica no valor para abrir o modal
                await celulaValor.click();

                console.log("Aguardando processamento do sistema (Tela 'Aguarde')...");

                // 1. Pausa fixa generosa (solicitada) - 10 segundos para garantir
                await sleep(10000);

                // 2. Pausa Inteligente: Se o texto "Aguarde" ainda estiver visível, esperamos ele sumir.
                // Isso garante que se a internet estiver muito lenta e levar 20s, o robô espera.
                try {
                    const loaderAguarde = page.getByText('Aguarde');
                    if (await loaderAguarde.isVisible()) {
                        console.log("O sistema ainda está processando. Esperando 'Aguarde' sumir...");
                        await loaderAguarde.waitFor({ state: 'hidden', timeout: 60000 }); // Espera até 60s sumir
                        console.log("Processamento finalizado.");
                    }
                } catch (e) {
                    console.log("Aviso: Não foi possível verificar o estado do botão 'Aguarde'. Seguindo...");
                }

                // --- FIM DA LÓGICA DE ESPERA ---

                console.log("Capturando Popup do PDF...");

                // Tenta pegar a página que (esperamos) já abriu ou vai abrir
                // Como já clicamos antes, usamos waitForEvent esperando o resultado daquele clique anterior
                // Se o popup não abriu no clique inicial, pode ser necessário clicar em algum botão "Visualizar" dentro do modal?
                // Assumindo que o fluxo é: Clique Valor -> Modal Carregando -> Popup Abre Sozinho:
                const pagePromise = context.waitForEvent('page').catch(() => null);
                const popup = await pagePromise;

                if (!popup) {
                    // Se o popup não abriu sozinho, talvez tenha um botão "Baixar" ou "Visualizar" no modal final?
                    // Vamos tentar achar o botão "Ver Fatura" ou "Baixar" dentro do modal se o popup não veio
                    console.log("Popup não abriu automaticamente. Procurando botão no modal...");
                    // (Lógica opcional de fallback se o clique inicial não abrir a janela)
                    throw new Error("O popup da fatura não abriu após o tempo de espera.");
                }

                await popup.waitForLoadState();
                const pdfUrl = popup.url();
                console.log(`>> Sucesso! PDF gerado: ${pdfUrl}`);

                const responsePDF = await context.request.get(pdfUrl);
                const base64PDF = (await responsePDF.body()).toString('base64');

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
                        message: 'Falha após 3 tentativas.',
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