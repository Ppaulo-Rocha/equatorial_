const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// --- CONFIGURAÇÕES ---
const PORT = 3000;
const AUTH_TOKEN = 'meu-token-secreto-123'; // Altere conforme necessidade
const MAX_TENTATIVAS = 3;

// Helper para pausas
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
        // Inicia o browser (uma única vez para as tentativas)
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        // Loop de Tentativas
        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
            let context = null;
            let page = null;

            try {
                console.log(`\n--- Tentativa ${tentativa} de ${MAX_TENTATIVAS} ---`);

                // Cria contexto isolado
                context = await browser.newContext({ acceptDownloads: true });
                page = await context.newPage();
                page.setDefaultTimeout(120000); // 2 minutos de timeout geral

                // --- PASSO 1: NAVEGAÇÃO INICIAL ---
                console.log('1. Acessando portal...');
                await page.goto('https://pa.equatorialenergia.com.br/');
                await page.waitForLoadState('networkidle');

                // Tratar Popups e Cookies Iniciais
                try {
                    const btnFechar = page.locator('#pm__popup-21883').getByRole('button', { name: 'Fechar' });
                    if (await btnFechar.isVisible({ timeout: 5000 })) await btnFechar.click();

                    const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                    if (await checkAviso.isVisible({ timeout: 5000 })) {
                        await checkAviso.check();
                        await page.getByRole('button', { name: 'Enviar' }).click();
                    }
                } catch (e) { /* Ignora erros não críticos de popup */ }

                // --- PASSO 2: LOGIN ---
                console.log('2. Realizando Login...');
                const inputCnpj = page.getByRole('textbox', { name: 'Digite aqui' }).first();
                await inputCnpj.waitFor({ state: 'visible' });
                await inputCnpj.fill(cnpj);
                await page.getByRole('button', { name: 'Entrar' }).click();

                const inputEmail = page.getByRole('textbox', { name: 'email@empresa.com' });
                await inputEmail.waitFor({ state: 'visible' });
                await inputEmail.fill(email);
                await page.getByRole('button', { name: 'Entrar' }).click();

                // Validação de Sucesso no Login
                try {
                    // Espera aparecer algo que confirme o login ou redirecionamento
                    await Promise.race([
                        page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 60000 }),
                        page.waitForURL(/sua-conta/, { timeout: 60000 })
                    ]);
                } catch (e) {
                    throw new Error("Login falhou ou demorou muito.");
                }

                // --- PASSO 3: ÁREA DO CLIENTE ---
                console.log('3. Indo para área de faturas...');
                if (!page.url().includes('sua-conta')) {
                    await page.goto('https://pa.equatorialenergia.com.br/sua-conta/');
                }
                await page.waitForLoadState('networkidle');

                // Termos da Área do Cliente (se aparecer)
                try {
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
                await sleep(3000); // Espera a definição do contrato processar

                // Acessar Segunda Via
                const linkSegundaVia = page.getByRole('link', { name: 'Emitir segunda via e' });
                await linkSegundaVia.waitFor({ state: 'visible' });
                await linkSegundaVia.click();
                await page.waitForLoadState('networkidle');

                // Filtros da Tabela (Apenas Vencidas vs Todas)
                const checkboxVencidas = page.locator('#apenas-vencidas');
                if (await checkboxVencidas.count() > 0) {
                    const isChecked = await checkboxVencidas.isChecked();
                    // Se quiser ver todas as abertas (vencidas ou a vencer), desmarque se necessário
                    // ou mantenha conforme regra de negócio. Aqui mantemos o padrão do site.
                    // Exemplo: Se quiser garantir que vê tudo:
                    // if (isChecked) await checkboxVencidas.click(); 
                    await sleep(2000);
                }

                // --- PASSO 4: SELEÇÃO DA FATURA ---
                console.log("4. Buscando fatura na tabela...");
                const faturaRow = page.locator('#list-bills-segunda-via tbody tr').first();

                // Se não houver linhas, não tem fatura
                if (!(await faturaRow.isVisible({ timeout: 10000 }))) {
                    console.log("   Nenhuma fatura encontrada na tabela.");
                    await browser.close();
                    return res.json({ status: 'success', message: 'Não existem faturas em aberto.', has_invoice: false });
                }

                // Abre o Modal clicando no valor
                await faturaRow.locator('.bill-value').first().click();

                // Aguarda loader desaparecer
                try {
                    const loader = page.getByText('Aguarde');
                    if (await loader.isVisible({ timeout: 3000 })) await loader.waitFor({ state: 'hidden', timeout: 30000 });
                } catch (e) { }

                // --- PASSO 5: ALGORITMO DE DOWNLOAD HÍBRIDO ---
                console.log("5. Iniciando estratégia de captura híbrida...");

                const btnVerFaturaModal = page.getByText('Ver Fatura');
                // Aguarda o botão estar clicável
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 30000 });

                // A. Listener de Rede (Prepara antes de clicar)
                // Captura se o site enviar o PDF direto por stream/download
                const responsePromise = context.waitForEvent('response', {
                    predicate: response => {
                        const headers = response.headers();
                        const cType = (headers['content-type'] || '').toLowerCase();
                        const cDisp = (headers['content-disposition'] || '').toLowerCase();

                        // Critérios para identificar PDF
                        const isPdfType = cType.includes('application/pdf') || cType.includes('application/octet-stream');
                        const isPdfExt = response.url().toLowerCase().includes('.pdf');
                        const isAttachment = cDisp.includes('attachment') && cDisp.includes('.pdf');

                        return response.status() === 200 && (isPdfType || isPdfExt || isAttachment);
                    },
                    timeout: 20000 // 20s de tolerância para rede
                }).catch(() => null); // Evita crash se der timeout

                // B. Clicar e Capturar Popup
                console.log("   Clicando em 'Ver Fatura'...");
                const [popup] = await Promise.all([
                    page.waitForEvent('popup', { timeout: 30000 }),
                    btnVerFaturaModal.click()
                ]);

                console.log("   Popup aberto. Verificando resposta de rede...");
                await popup.waitForLoadState('domcontentloaded');

                // C. Executa Estratégia 1 (Rede)
                let pdfBuffer = null;
                const networkResponse = await responsePromise;

                if (networkResponse) {
                    try {
                        pdfBuffer = await networkResponse.body();
                        if (pdfBuffer.length > 500) {
                            console.log("   [SUCESSO] Arquivo capturado via Rede (Network Event)!");
                        } else {
                            console.log("   [AVISO] Resposta de rede muito pequena, tentando DOM...");
                            pdfBuffer = null;
                        }
                    } catch (e) {
                        console.log("   [ERRO] Falha ao ler body da rede: " + e.message);
                    }
                }

                // D. Executa Estratégia 2 (DOM Scraping - Fetch Interno)
                if (!pdfBuffer) {
                    console.log("   [FALLBACK] Rede falhou. Iniciando varredura do DOM no Popup...");
                    await sleep(3000); // Tempo para o visualizador (Chrome ou PDF.js) carregar

                    // Script injetado no browser para baixar blobs ou embeds
                    const base64Data = await popup.evaluate(async () => {
                        const fetchAsBase64 = async (url) => {
                            try {
                                const response = await fetch(url);
                                const blob = await response.blob();
                                return new Promise((resolve) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                    reader.readAsDataURL(blob);
                                });
                            } catch (err) { return null; }
                        };

                        // 1. URL da aba é um Blob ou PDF direto?
                        if (window.location.href.startsWith('blob:') || window.location.href.endsWith('.pdf')) {
                            return await fetchAsBase64(window.location.href);
                        }

                        // 2. Procura <embed> (Padrão Chrome)
                        const embed = document.querySelector('embed[type="application/pdf"]');
                        if (embed && embed.src) return await fetchAsBase64(embed.src);

                        // 3. Procura <iframe>
                        const iframe = document.querySelector('iframe');
                        if (iframe && iframe.src && iframe.src.includes('.pdf')) return await fetchAsBase64(iframe.src);

                        // 4. PDF.js Viewer
                        // @ts-ignore
                        if (window.PDFViewerApplication && window.PDFViewerApplication.url) {
                            // @ts-ignore
                            return await fetchAsBase64(window.PDFViewerApplication.url);
                        }

                        return null;
                    });

                    if (base64Data) {
                        console.log("   [SUCESSO] Arquivo capturado via DOM Scraping!");
                        pdfBuffer = Buffer.from(base64Data, 'base64');
                    }
                }

                // Limpeza do Popup
                if (popup && !popup.isClosed()) await popup.close();

                // Validação Final
                if (!pdfBuffer || pdfBuffer.length < 500) {
                    throw new Error("Falha crítica: Não foi possível capturar o binário do PDF.");
                }

                // --- SUCESSO ---
                const finalBase64 = pdfBuffer.toString('base64');
                console.log(`>> Processo concluído. PDF gerado: ${pdfBuffer.length} bytes.`);

                await browser.close();

                return res.json({
                    status: 'success',
                    has_invoice: true,
                    contract: contrato,
                    filename: `fatura_${contrato}.pdf`,
                    file_base64: finalBase64
                });

            } catch (error) {
                // --- TRATAMENTO DE ERROS E RETRY ---
                console.error(`Erro na tentativa ${tentativa}: ${error.message}`);

                // Fecha páginas para limpar memória
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

                console.log("Reiniciando em 10s...");
                await sleep(10000);
            }
        }

    } catch (error) {
        console.error("Erro fatal no servidor:", error);
        if (browser) await browser.close().catch(() => { });
        return res.status(500).json({ error: 'Erro interno crítico.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de automação rodando na porta ${PORT}`);
});