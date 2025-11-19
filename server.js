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

                // --- FLUXO DE NAVEGAÇÃO E LOGIN (Mantido igual) ---
                console.log('1. Acessando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/');
                await page.waitForLoadState('networkidle');

                // Popups e Cookies
                try {
                    const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                    if (await btnFechar.isVisible({ timeout: 5000 })) await btnFechar.click();
                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 5000 })) {
                        await checkAviso.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { }

                // Login
                console.log('2. Realizando Login...');
                const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputCnpj.waitFor({ state: 'visible' });
                await inputCnpj.fill(cnpj);
                await page.getByRole('button', { name: 'Entrar' }).click();

                const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
                await inputEmail.waitFor({ state: 'visible' });
                await inputEmail.fill(email);
                await page.getByRole('button', { name: 'Entrar' }).click();

                // Validação de Acesso
                try {
                    await page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 60000 });
                } catch (e) {
                    if (!page.url().includes('sua-conta')) throw new Error("Login falhou.");
                }

                console.log('3. Indo para área de faturas...');
                await page.goto('https://pa.equatorialenergia.com.br/sua-conta/');
                await page.waitForLoadState('networkidle');

                // Tratamento de termos repetidos
                try {
                    const checkTermo = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkTermo.isVisible({ timeout: 3000 })) {
                        await checkTermo.check();
                        await page.getByRole('checkbox', { name: 'Concordo em disponibilizar' }).check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { }

                // Seleção de Contrato
                const inputContrato = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputContrato.waitFor({ state: 'visible' });
                await inputContrato.fill(contrato);
                await page.getByRole('button', { name: 'Definir' }).click();
                await sleep(3000);

                // Emitir Segunda Via
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                await linkSegundaVia.waitFor({ state: 'visible' });
                await linkSegundaVia.click();
                await page.waitForLoadState('networkidle');

                // Filtro "Apenas Vencidas"
                const precisaClicar = await page.$eval('#apenas-vencidas', (el) => !el.checked).catch(() => false);
                if (precisaClicar) {
                    await page.evaluate(() => {
                        const checkbox = document.getElementById('apenas-vencidas');
                        if (checkbox) checkbox.parentElement.click();
                    });
                    await sleep(4000);
                }

                // Buscar na Tabela
                console.log("4. Buscando fatura na tabela...");
                const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();
                if (!(await faturaRow.isVisible({ timeout: 15000 }))) {
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                // Abrir Modal
                await faturaRow.locator('.bill-value').first().click();

                // Esperar "Aguarde"
                try {
                    const loader = page.getByText('Aguarde');
                    if (await loader.isVisible({ timeout: 5000 })) await loader.waitFor({ state: 'hidden', timeout: 60000 });
                } catch (e) { }

                console.log("5. Preparando captura (Estratégia Híbrida)...");
                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 60000 });

                // --- INÍCIO DO ALGORITMO DE CAPTURA DO SEU DIAGRAMA ---

                // Preparar Estratégia 1: Listener de Rede (Assíncrono)
                // Inicia a escuta ANTES de clicar
                const networkPromise = context.waitForEvent('response', {
                    predicate: response => {
                        const type = response.headers()['content-type'] || '';
                        return response.status() === 200 &&
                            (type.includes('application/pdf') || type.includes('application/octet-stream')) &&
                            (response.url().includes('.pdf') || response.url().includes('exibir-faturas'));
                    },
                    timeout: 10000 // Só espera 10s pela rede, se não vier, vai pro DOM
                }).catch(() => null); // Se der timeout, retorna null sem quebrar

                // Ação: Clicar e Abrir Popup
                console.log("   Clicando em 'Ver Fatura'...");
                const [popup] = await Promise.all([
                    page.waitForEvent('popup'),
                    btnVerFaturaModal.click()
                ]);

                console.log("   Popup aberto. Executando Estratégia 1 (Rede)...");
                await popup.waitForLoadState();

                let pdfBuffer = null;

                // Tenta pegar da rede primeiro
                const networkResponse = await networkPromise;

                if (networkResponse) {
                    console.log("   [SUCESSO] Arquivo detectado via Rede!");
                    pdfBuffer = await networkResponse.body();
                }

                // Se falhou a rede ou veio vazio (ex: 345 bytes), vai para Estratégia 2
                if (!pdfBuffer || pdfBuffer.length < 1000) {
                    console.log("   [FALLBACK] Rede falhou ou arquivo vazio. Iniciando Estratégia 2 (DOM Scraping)...");

                    // Espera um pouco para o Chrome montar o visualizador interno
                    await sleep(3000);

                    // Injeta Script para extrair Blob/Embed
                    const base64FromDOM = await popup.evaluate(async () => {
                        // Helpers
                        const blobToText = async (blob) => {
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            });
                        };

                        // 1. Tenta achar Embed do Chrome
                        const embed = document.querySelector('embed[type="application/pdf"]');
                        if (embed && embed.src) {
                            console.log('Embed encontrado:', embed.src);
                            const resp = await fetch(embed.src);
                            const blob = await resp.blob();
                            return await blobToText(blob);
                        }

                        // 2. Tenta achar Iframe
                        const iframe = document.querySelector('iframe');
                        if (iframe && iframe.src) {
                            console.log('Iframe encontrado:', iframe.src);
                            const resp = await fetch(iframe.src);
                            const blob = await resp.blob();
                            return await blobToText(blob);
                        }

                        // 3. Tenta baixar a própria URL da janela (se for blob:...)
                        if (window.location.href.startsWith('blob:') || document.contentType === 'application/pdf') {
                            const resp = await fetch(window.location.href);
                            const blob = await resp.blob();
                            return await blobToText(blob);
                        }

                        return null;
                    });

                    if (base64FromDOM) {
                        console.log("   [SUCESSO] Arquivo extraído via DOM (Blob)!");
                        pdfBuffer = Buffer.from(base64FromDOM, 'base64');
                    }
                }

                // Validação Final
                if (!pdfBuffer || pdfBuffer.length < 1000) {
                    throw new Error("Falha crítica: Todas as estratégias (Rede e DOM) falharam em capturar o PDF.");
                }

                const finalBase64 = pdfBuffer.toString('base64');
                console.log(`>> Processo concluído. PDF: ${pdfBuffer.length} bytes.`);

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
                if (page) await page.close();
                if (context) await context.close();

                if (tentativa === MAX_TENTATIVAS) {
                    if (browser) await browser.close();
                    return res.status(500).json({
                        status: 'error',
                        message: 'Falha após 3 tentativas.',
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
        return res.status(500).json({ error: 'Erro crítico.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});