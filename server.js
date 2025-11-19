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

                // --- PASSO 5: ESTRATÉGIA "PRINT TO PDF" (Nativa do Navegador) ---
                console.log("5. Iniciando geração de PDF (Simulando Impressão)...");

                const btnVerFaturaModal = page.getByText('Ver Fatura');
                await btnVerFaturaModal.waitFor({ state: 'visible', timeout: 30000 });

                // 1. Abrir o Popup
                console.log("   Clicando em 'Ver Fatura'...");
                const [popup] = await Promise.all([
                    page.waitForEvent('popup', { timeout: 60000 }),
                    btnVerFaturaModal.click()
                ]);

                console.log("   Popup aberto. Aguardando carregamento total...");

                // 2. Garantir que a página carregou completamente (imagens, fontes, etc)
                await popup.waitForLoadState('domcontentloaded');
                await popup.waitForLoadState('networkidle'); // Espera o tráfego de rede parar (garante que a fatura renderizou)

                // Pausa de segurança para scripts de renderização visual terminarem
                await sleep(3000);

                // 3. Forçar o modo de impressão (CSS de Print)
                // Isso faz o site "pensar" que está sendo impresso, escondendo botões e menus automaticamente
                await popup.emulateMedia({ media: 'print' });

                // 4. Gerar o PDF (Equivalente ao "Salvar como PDF" do Chrome)
                console.log("   Executando comando de impressão...");
                const pdfBuffer = await popup.pdf({
                    format: 'A4',           // Formato padrão
                    printBackground: true,  // Importante para manter cores de fundo/cabeçalhos
                    margin: {               // Margens mínimas para não cortar conteúdo
                        top: '10mm',
                        bottom: '10mm',
                        left: '10mm',
                        right: '10mm'
                    },
                    // scale: 0.9 // Se a fatura estiver cortando, descomente para reduzir um pouco o zoom
                });

                // Limpeza
                if (popup && !popup.isClosed()) await popup.close();

                // Validação
                if (!pdfBuffer || pdfBuffer.length < 1000) {
                    throw new Error("O PDF gerado via impressão está vazio.");
                }

                const finalBase64 = pdfBuffer.toString('base64');
                console.log(`>> Sucesso! PDF impresso com ${pdfBuffer.length} bytes.`);

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