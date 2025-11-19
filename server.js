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
            headless: false,
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
                        page.locator('span').filter({ hasText: 'mov' }).first().waitFor({ state: 'visible', timeout: 90000 }),
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

                // --- PASSO 5: ESTRATÉGIA CIRÚRGICA (Interceptação de Payload POST) ---
                console.log("5. Iniciando estratégia: Interceptação de Form Data (Payload 'bill')...");

                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 30000 });

                // 1. Preparar a Armadilha (Listener de Requisição)
                // Vamos capturar a requisição POST que o navegador envia ao abrir o visualizador
                const requestPromise = context.waitForEvent('request', {
                    predicate: request => {
                        return request.url().includes('exibir-faturas') &&
                            request.method() === 'POST';
                    },
                    timeout: 20000 // 20s para o clique disparar a requisição
                }).catch(() => null);

                // 2. Clicar no Botão
                console.log("   Clicando em 'Ver Fatura'...");
                // Não precisamos esperar o popup carregar visualmente, só precisamos que o clique dispare a requisição
                await btnVerFaturaModal.click();

                console.log("   Aguardando disparo da requisição POST...");

                // 3. Capturar os Dados
                const request = await requestPromise;
                let finalBase64 = null;

                if (request) {
                    console.log("   [SUCESSO] Requisição POST interceptada!");

                    // Obtém o corpo do POST (onde está o 'bill=JVBER...')
                    const postData = request.postData();

                    if (postData) {
                        // O corpo vem como "bill=JVBERi0xLjQKJe...", precisamos extrair o valor
                        // Usamos URLSearchParams para decodificar corretamente caracteres especiais
                        const params = new URLSearchParams(postData);
                        const billBase64 = params.get('bill');

                        if (billBase64 && billBase64.startsWith('JVBER')) {
                            console.log("   [SUCESSO] Base64 do PDF extraído do payload 'bill'.");
                            finalBase64 = billBase64;
                        } else {
                            console.log("   [ERRO] Campo 'bill' não encontrado ou inválido no payload.");
                        }
                    } else {
                        console.log("   [ERRO] A requisição interceptada não tinha corpo (payload).");
                    }
                } else {
                    console.log("   [FALHA] A requisição POST para 'exibir-faturas' não foi detectada.");
                }

                // Tenta fechar qualquer popup que tenha aberto (limpeza)
                const pages = context.pages();
                if (pages.length > 1) {
                    await pages[pages.length - 1].close().catch(() => { });
                }

                // 4. Validação Final
                if (!finalBase64) {
                    throw new Error("Não foi possível extrair o Base64 do payload da requisição.");
                }

                // Verifica se o Base64 precisa de limpeza (espaços ou quebras de linha)
                finalBase64 = finalBase64.replace(/\s/g, '');

                const bufferTamanho = Buffer.from(finalBase64, 'base64').length;
                console.log(`>> Processo concluído. PDF original recuperado: ${bufferTamanho} bytes.`);

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