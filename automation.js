const { chromium, firefox } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');

// Adiciona o plugin stealth ao playwright
chromium.use(stealth);

// User-Agent realista para Windows 10 Chrome
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseBoolEnv = (value, fallback) => {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
};

const HEADLESS = parseBoolEnv(process.env.PLAYWRIGHT_HEADLESS ?? process.env.HEADLESS, false);

/**
 * Processa múltiplas contas de uma mesma empresa em uma única sessão
 * @param {string} empresa - Nome da empresa
 * @param {string} email - Email para login
 * @param {string} senha - Senha para login
 * @param {Array} contas - Array de objetos {conta, id}
 * @returns {Promise<Array>} Resultados do processamento
 */
async function processCompanyAccounts(empresa, email, senha, contas) {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║ Processando ${contas.length} conta(s) da empresa: ${empresa.toUpperCase().padEnd(18)} ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝\n`);

    let browser = null;
    const resultados = [];

    // Helper para tentar ações múltiplas vezes
    const retryAction = async (action, description, maxRetries = 3) => {
        for (let i = 1; i <= maxRetries; i++) {
            try {
                return await action();
            } catch (e) {
                if (i === maxRetries) throw e;
                console.log(`      ⚠️  Falha em "${description}" (tentativa ${i}/${maxRetries}), tentando novamente...`);
                await sleep(2000 * i);
            }
        }
    };

    const getDashboardLocators = (page) => {
        const invoiceLink = page.getByRole('link', { name: /Baixar segunda via completa/i });
        const invoiceCardLink = page.locator('.card-segunda-via a').first();
        const noInvoice = page.getByText(/N(?:ão|ao) existem faturas/i).first();
        const nothingOwed = page.getByText(/Nada consta/i).first();
        return { invoiceLink, invoiceCardLink, noInvoice, nothingOwed };
    };

    const detectDashboardOutcome = async (page) => {
        const { invoiceLink, invoiceCardLink, noInvoice, nothingOwed } = getDashboardLocators(page);

        if (await invoiceLink.isVisible({ timeout: 1000 }).catch(() => false)) return 'FATURA';
        if (await invoiceCardLink.isVisible({ timeout: 1000 }).catch(() => false)) return 'FATURA';
        if (await noInvoice.isVisible({ timeout: 1000 }).catch(() => false)) return 'SEM_FATURA';
        if (await nothingOwed.isVisible({ timeout: 1000 }).catch(() => false)) return 'SEM_FATURA';

        // Detecta dashboard genérico (sem card de fatura) para não insistir
        try {
            const crumbDashboard = page.getByText(/\bDashboard\b/i).first();
            const acessoRapido = page.getByRole('heading', { name: /Acesso r[páa]pido/i }).first();
            const quickTile = page.getByText(/Informar falta de luz/i).first();
            const inDashboard = await Promise.all([
                crumbDashboard.isVisible({ timeout: 2000 }).catch(() => false),
                acessoRapido.isVisible({ timeout: 2000 }).catch(() => false),
                quickTile.isVisible({ timeout: 2000 }).catch(() => false)
            ]);
            const dashConfidence = inDashboard.filter(Boolean).length >= 2;
            if (dashConfidence) {
                const hasInvoiceLink = await invoiceLink.isVisible({ timeout: 800 }).catch(() => false);
                const hasInvoiceCard = await invoiceCardLink.isVisible({ timeout: 800 }).catch(() => false);
                if (!hasInvoiceLink && !hasInvoiceCard) return 'SEM_FATURA';
            }
        } catch (e) { }

        return null;
    };

    const waitForDashboardOutcome = async (page, timeoutMs) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const outcome = await detectDashboardOutcome(page);
            if (outcome) return outcome;
            await sleep(500);
        }
        // Última checagem antes de desistir
        const finalOutcome = await detectDashboardOutcome(page);
        if (finalOutcome) return finalOutcome;
        throw new Error(`DASHBOARD_TIMEOUT_${timeoutMs}ms`);
    };

    const MAX_SESSION_RETRIES = 3;

    for (let sessionAttempt = 1; sessionAttempt <= MAX_SESSION_RETRIES; sessionAttempt++) {
        try {
            // Lógica de Navegador: Chromium é o PRINCIPAL novamente
            const useFirefox = sessionAttempt > 2; // Tenta Chromium nas duas primeiras, Firefox na terceira (fallback)
            const browserType = useFirefox ? firefox : chromium;
            const browserName = useFirefox ? 'Firefox' : 'Chromium';

            if (sessionAttempt > 1) {
                console.log(`\n🔄 Reiniciando sessão do navegador (Tentativa ${sessionAttempt}/${MAX_SESSION_RETRIES})...`);
                console.log(`   💡 Alternando navegador para: ${browserName}`);
                resultados.length = 0;
                await sleep(5000);
            } else {
                console.log(`   🚀 Iniciando sessão com: ${browserName}`);
            }

            // Configuração de argumentos específica por navegador
            const launchArgs = !useFirefox ? [
                // Args Chromium (Otimizados para evitar detecção)
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--ignore-certificate-errors',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1366,768'
            ] : [
                // Args Firefox
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ];

            // Inicia o navegador
            browser = await browserType.launch({
                headless: HEADLESS,
                args: launchArgs
            });

            const context = await browser.newContext({
                acceptDownloads: true,
                userAgent: USER_AGENT,
                viewport: { width: 1366, height: 768 },
                locale: 'pt-BR',
                timezoneId: 'America/Sao_Paulo',
                ignoreHTTPSErrors: true,
                extraHTTPHeaders: {
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            const page = await context.newPage();
            // Aumentando timeout padrão para 2 minutos
            page.setDefaultTimeout(120000);

            // Mantém um rastro curto de rede para diagnóstico (somente usado em falhas)
            const networkTrace = [];
            const pushNetworkTrace = (entry) => {
                networkTrace.push(entry);
                if (networkTrace.length > 80) networkTrace.shift();
            };
            page.on('request', (req) => {
                try {
                    const rt = req.resourceType();
                    if (!['xhr', 'fetch', 'document'].includes(rt)) return;
                    pushNetworkTrace({ t: Date.now(), type: 'REQ', rt, method: req.method(), url: req.url() });
                } catch (e) { }
            });
            page.on('response', (res) => {
                try {
                    const url = res.url();
                    if (!url) return;
                    pushNetworkTrace({ t: Date.now(), type: 'RES', status: res.status(), url });
                } catch (e) { }
            });

            // Injeta scripts anti-detecção
            // Injeta scripts anti-detecção AVANÇADOS
            await page.addInitScript(() => {
                // 1. Passar no teste de WebDriver
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });

                // 2. Mock de Plugins (Chrome tem plugins, headless base não)
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5],
                });

                // 3. Mock de Languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['pt-BR', 'pt', 'en-US', 'en'],
                });

                // 4. Mock de window.chrome
                window.chrome = {
                    runtime: {},
                    loadTimes: function () { },
                    csi: function () { },
                    app: {}
                };

                // 5. Mock de Permissions (Evita que notificações entreguem o automação)
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
            });

            // LOGIN (UMA VEZ)
            console.log('🔐 Fazendo login...');
            await retryAction(async () => {
                await page.goto('https://agenciavirtual.equatorialenergia.com.br/Login/', {
                    waitUntil: 'networkidle',
                    timeout: 120000
                })
            }, 'Carregar página de login');

            await sleep(2000);

            // Destrói popups
            await page.addStyleTag({
                content: `#pm__popup-21883, .pm__popup, .pm__overlay { display: none !important; }`
            });

            // Aceita cookies se aparecer
            try {
                const checkAviso = page.getByRole('checkbox', { name: 'Li e entendi o Aviso de' });
                if (await checkAviso.isVisible({ timeout: 5000 })) {
                    await checkAviso.check();
                    await page.getByRole('button', { name: 'Enviar' }).click();
                    await sleep(1000);
                }
            } catch (e) { }

            // Passo 1: Clica em Entrar
            await retryAction(async () => {
                await page.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible', timeout: 30000 });
                await sleep(500);
                await page.getByRole('button', { name: 'Entrar' }).click();
            }, 'Clicar em Entrar iniciais');
            await sleep(1500);

            // Passo 2: Preenche email
            const inputIdentificacao = page.getByRole('textbox', { name: 'Identificação' });
            await inputIdentificacao.waitFor({ state: 'visible', timeout: 30000 });
            await inputIdentificacao.click();
            await sleep(300);
            await inputIdentificacao.type(email, { delay: 100 });
            console.log('   ✓ Email preenchido');
            await sleep(800);

            // Passo 3: Clica em Continuar (loop até senha aparecer)
            let senhaVisivel = false;
            // Tenta mais vezes o ciclo de continuar -> senha
            for (let i = 1; i <= 5; i++) {
                try {
                    const btnContinuar = page.getByRole('button', { name: 'Continuar' });
                    if (await btnContinuar.isVisible({ timeout: 5000 })) {
                        await btnContinuar.click();
                        console.log(`   ✓ Continuar clicado (${i})`);
                        await sleep(2500); // Wait um pouco maior

                        const inputSenha = page.getByRole('textbox', { name: 'Senha' });
                        if (await inputSenha.isVisible({ timeout: 10000 })) {
                            senhaVisivel = true;
                            break;
                        }
                    }
                } catch (e) { }
                await sleep(1000);
            }

            if (!senhaVisivel) {
                // Tenta verificar se a senha já está visível por algum motivo
                if (await page.getByRole('textbox', { name: 'Senha' }).isVisible({ timeout: 5000 })) {
                    senhaVisivel = true;
                } else {
                    throw new Error('Campo de senha não apareceu após várias tentativas');
                }
            }

            // Passo 4: Preenche senha
            const inputSenha = page.getByRole('textbox', { name: 'Senha' });
            await inputSenha.click();
            await sleep(300);
            await inputSenha.type(senha, { delay: 100 });
            console.log('   ✓ Senha preenchida');
            await sleep(800);

            // Passo 5: Entra
            await retryAction(async () => {
                await page.getByRole('button', { name: 'Entrar' }).click();
                await page.waitForURL(/Home/, { timeout: 120000, waitUntil: 'domcontentloaded' });
            }, 'Clicar botão Login final e carregar Home');

            console.log('   ✓ Login realizado\n');
            await sleep(2000);

            // PROCESSA CADA CONTA NA MESMA SESSÃO
            for (let i = 0; i < contas.length; i++) {
                const { conta, id } = contas[i];
                console.log(`[${i + 1}/${contas.length}] Processando conta: ${conta}`);

                try {
                    // Se não é a primeira conta, vai para Home
                    if (i > 0) {
                        console.log('   → Voltando ao Home...');
                        await retryAction(async () => {
                            await page.goto('https://agenciavirtual.equatorialenergia.com.br/Home/', { waitUntil: 'domcontentloaded', timeout: 60000 });
                        }, 'Voltar para Home');
                        await sleep(3000);
                    }

                    // Seleciona a conta
                    await retryAction(async () => {
                        const inputConta = page.getByRole('textbox', { name: 'Digite aqui sua conta' });
                        await inputConta.waitFor({ state: 'visible', timeout: 30000 });
                        await inputConta.click();
                        await sleep(300);
                        await inputConta.fill(''); // Limpa
                        await inputConta.type(conta, { delay: 150 });
                        // Alguns fluxos só aplicam o filtro no Enter/blur
                        try { await inputConta.press('Enter', { timeout: 2000 }); } catch (e) { }
                        try { await inputConta.evaluate((el) => el.blur()); } catch (e) { }
                    }, 'Preencher campo de conta');

                    console.log(`   ✓ Conta digitada`);
                    await sleep(1500);

                    // Seleciona a conta e aguarda carregamento do dashboard
                    let selecaoTentativa = 0;
                    const selecaoResultado = await retryAction(async () => {
                        selecaoTentativa++;
                        if (selecaoTentativa > 1) {
                            console.log('      → Recarregando Home para nova tentativa de seleção...');
                            await page.goto('https://agenciavirtual.equatorialenergia.com.br/Home/', { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await sleep(2500);

                            // Reaplica o filtro da conta após recarregar
                            try {
                                const inputConta = page.getByRole('textbox', { name: 'Digite aqui sua conta' });
                                await inputConta.waitFor({ state: 'visible', timeout: 30000 });
                                await inputConta.click();
                                await sleep(200);
                                await inputConta.fill('');
                                await inputConta.type(conta, { delay: 150 });
                                try { await inputConta.press('Enter', { timeout: 2000 }); } catch (e) { }
                                try { await inputConta.evaluate((el) => el.blur()); } catch (e) { }
                            } catch (e) { }

                            await sleep(1500);
                        }

                        const alreadyOutcome = await detectDashboardOutcome(page);
                        if (alreadyOutcome) {
                            console.log('      ✓ Dashboard já identificado (autoseleção ou cache), pulando clique de seleção.');
                            return alreadyOutcome;
                        }

                        // Espera o card da conta aparecer (após o filtro)
                        let contaText = page
                            .getByText(new RegExp(`Conta\\s+contrato\\s*${String(conta)}`, 'i'))
                            .first();
                        try {
                            await contaText.waitFor({ state: 'visible', timeout: 15000 });
                        } catch (e) {
                            contaText = page.getByText(String(conta)).first();
                            await contaText.waitFor({ state: 'visible', timeout: 15000 });
                        }

                        // Clica em Selecionar (ancorado no card da conta)
                        const contaCard = contaText.locator('xpath=ancestor-or-self::*[.//text()[contains(., \"Selecionar\")]][1]');
                        const anchorSelecionar = contaCard.locator('a:has-text("Selecionar")');
                        const buttonSelecionar = contaCard.locator('button:has-text("Selecionar")');
                        let btnSelecionar = anchorSelecionar;
                        if (!(await anchorSelecionar.first().isVisible({ timeout: 2000 }).catch(() => false))) {
                            if (await buttonSelecionar.first().isVisible({ timeout: 2000 }).catch(() => false)) {
                                btnSelecionar = buttonSelecionar;
                            } else {
                                btnSelecionar = contaCard.getByRole('link', { name: /Selecionar/i })
                                    .or(contaCard.getByRole('button', { name: /Selecionar/i }))
                                    .or(contaCard.getByText(/Selecionar/i))
                                    .first();
                            }
                        }

                        // Garante que, mesmo que o locator seja um <span>, usamos o ancestral clicável
                        const btnCliquePreferencial = btnSelecionar
                            .locator('xpath=ancestor::a[1]')
                            .first()
                            .or(btnSelecionar.locator('xpath=ancestor::button[1]').first())
                            .or(btnSelecionar);

                        const btnSelecionarXPathBase = page.locator(
                            'xpath=/html/body/div[7]/div/div/div[2]/div/div/div[2]/div/div/div[1]/div/div/div[2]/div[5]/div[1]/div[2]/div/div/div/div[5]',
                        );
                        const btnSelecionarXPath = btnSelecionarXPathBase
                            .locator('a,button')
                            .filter({ hasText: /Selecionar/i })
                            .first()
                            .or(btnSelecionarXPathBase);

                        try {
                            await btnCliquePreferencial.waitFor({ state: 'visible', timeout: 15000 });
                        } catch (e) {
                            const outcomeOnMissingButton = await detectDashboardOutcome(page);
                            if (outcomeOnMissingButton) return outcomeOnMissingButton;
                            // Se não achou o botão de selecionar em 15s, assume sem fatura e pula
                            throw new Error('SEM_FATURA_PENDENTE');
                        }

                        await btnCliquePreferencial.scrollIntoViewIfNeeded();
                        try {
                            const handle = await btnCliquePreferencial.elementHandle();
                            if (handle) await handle.waitForElementState('stable', { timeout: 5000 });
                        } catch (e) { }
                        await sleep(500);

                        const TOTAL_WAIT_MS = 90000;
                        const startedAt = Date.now();

                        const clickAtRightEdge = async (locator, label) => {
                            const box = await locator.boundingBox();
                            if (!box) throw new Error(`NO_BOUNDING_BOX_${label}`);
                            await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2, { delay: 140 });
                        };

                        const getSelecionarHref = async () => {
                            try {
                                const href = await btnCliquePreferencial.evaluate((el) => {
                                    const maybeAnchor = el.closest('a');
                                    if (maybeAnchor && maybeAnchor.href) return maybeAnchor.href;
                                    // fallback para elementos que armazenam link em atributo
                                    const attr = el.getAttribute('href') || el.getAttribute('data-href');
                                    return attr || '';
                                });
                                return href ? String(href).trim() : '';
                            } catch (e) {
                                return '';
                            }
                        };

                        const clickStrategies = [
                            { label: 'clique padrao (delay)', run: () => btnCliquePreferencial.click({ timeout: 10000, delay: 140 }) },
                            { label: 'hover + clique', run: async () => { await btnCliquePreferencial.hover({ timeout: 10000 }); await sleep(250); await btnCliquePreferencial.click({ timeout: 10000, delay: 140 }); } },
                            { label: 'mouse no canto direito', run: () => clickAtRightEdge(btnCliquePreferencial, 'BTN') },
                            { label: 'ativar card + clique', run: async () => { await contaCard.click({ timeout: 10000 }); await sleep(300); await btnCliquePreferencial.click({ timeout: 10000, delay: 140 }); } },
                            { label: 'clique forcado', run: () => btnCliquePreferencial.click({ timeout: 10000, force: true, delay: 140 }) },
                            {
                                label: 'dispatch eventos (pointer/mouse)',
                                run: () => btnCliquePreferencial.evaluate((el) => {
                                    const evtOpts = { bubbles: true, cancelable: true, view: window };
                                    el.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                                    el.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                                    el.dispatchEvent(new PointerEvent('pointerup', evtOpts));
                                    el.dispatchEvent(new MouseEvent('mouseup', evtOpts));
                                    el.click();
                                })
                            },
                            {
                                label: 'click via querySelector no card',
                                run: () => contaCard.evaluate((card) => {
                                    const target = card.querySelector('a:has-text("Selecionar"), button:has-text("Selecionar")') ||
                                        Array.from(card.querySelectorAll('a,button,span,div')).find((n) => /selecionar/i.test(n.textContent || ''));
                                    if (target) {
                                        const evtOpts = { bubbles: true, cancelable: true, view: window };
                                        target.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                                        target.dispatchEvent(new MouseEvent('mousedown', evtOpts));
                                        target.dispatchEvent(new PointerEvent('pointerup', evtOpts));
                                        target.dispatchEvent(new MouseEvent('mouseup', evtOpts));
                                        target.click();
                                    }
                                })
                            },
                            {
                                label: 'XPath absoluto (click)',
                                run: async () => {
                                    await btnSelecionarXPath.waitFor({ state: 'visible', timeout: 5000 });
                                    await btnSelecionarXPath.scrollIntoViewIfNeeded();
                                    await btnSelecionarXPath.click({ timeout: 10000, delay: 140 });
                                }
                            },
                            {
                                label: 'XPath absoluto (mouse no canto direito)',
                                run: async () => {
                                    await btnSelecionarXPath.waitFor({ state: 'visible', timeout: 5000 });
                                    await btnSelecionarXPath.scrollIntoViewIfNeeded();
                                    await clickAtRightEdge(btnSelecionarXPath, 'XPATH');
                                }
                            },
                            { label: 'DOM click()', run: () => btnCliquePreferencial.evaluate((el) => el.click()) },
                            {
                                label: 'Enter no botao',
                                run: async () => {
                                    await btnCliquePreferencial.focus();
                                    await page.keyboard.press('Enter');
                                }
                            },
                            { label: 'duplo clique', run: () => btnCliquePreferencial.dblclick({ timeout: 10000 }) },
                            { label: 'clique no card', run: () => contaCard.click({ timeout: 10000, force: true }) },
                            {
                                label: 'abrir via href (goto)',
                                run: async () => {
                                    const href = await getSelecionarHref();
                                    if (!href || href === '#' || href.startsWith('javascript:')) {
                                        throw new Error('SEM_HREF_SELECIONAR');
                                    }
                                    const targetUrl = href.startsWith('http') ? href : new URL(href, page.url()).toString();
                                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                                }
                            }
                        ];

                        for (let attempt = 0; attempt < clickStrategies.length; attempt++) {
                            const remainingMs = TOTAL_WAIT_MS - (Date.now() - startedAt);
                            if (remainingMs <= 0) break;

                            const outcomeBefore = await detectDashboardOutcome(page);
                            if (outcomeBefore) return outcomeBefore;

                            if (attempt > 0) {
                                console.log(`      → Dashboard não carregou, tentando fallback de clique: ${clickStrategies[attempt].label}`);
                            }

                            let clicked = false;
                            try {
                                await clickStrategies[attempt].run();
                                clicked = true;
                            } catch (e) {
                                const msg = (e && e.message) ? e.message : String(e);
                                console.log(`      → Falha no clique (${clickStrategies[attempt].label}): ${msg}`);
                                await sleep(250);
                                continue;
                            }

                            if (!clicked) continue;

                            console.log('      → Aguardando dashboard de fatura...');
                            try {
                                const waitMs = Math.min(25000, remainingMs);
                                return await waitForDashboardOutcome(page, waitMs);
                            } catch (e) {
                                await sleep(600);
                            }
                        }

                        // Se não clicou em nada mas já identificou dashboard sem fatura, retorna
                        const outcomeAfterLoop = await detectDashboardOutcome(page);
                        if (outcomeAfterLoop) return outcomeAfterLoop;

                        // Debug: entender por que o clique não dispara (somente quando falha)
                        try {
                            const urlAtual = page.url();
                            let btnInfo = null;
                            try {
                                btnInfo = await btnCliquePreferencial.evaluate((el) => {
                                    const anchor = el.closest('a');
                                    const href = (anchor && anchor.href) ? anchor.href : (el.getAttribute('href') || el.getAttribute('data-href') || '');
                                    return {
                                        tag: el.tagName,
                                        href,
                                        text: (el.textContent || '').trim().slice(0, 80),
                                        className: (el.className || '').toString().slice(0, 120),
                                        ariaDisabled: el.getAttribute('aria-disabled') || '',
                                        disabledAttr: el.getAttribute('disabled') || ''
                                    };
                                });
                            } catch (e) { }

                            let hitTest = null;
                            try {
                                const box = await btnSelecionar.boundingBox();
                                if (box) {
                                    hitTest = await page.evaluate(({ x, y }) => {
                                        const el = document.elementFromPoint(x, y);
                                        if (!el) return null;
                                        return {
                                            tag: el.tagName,
                                            className: (el.className || '').toString().slice(0, 120),
                                            text: (el.textContent || '').trim().slice(0, 80)
                                        };
                                    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
                                }
                            } catch (e) { }

                            console.log(`      → Diagnóstico: url=${urlAtual}`);
                            if (btnInfo) {
                                console.log(`      → Diagnóstico: selecionar=${btnInfo.tag} href=${btnInfo.href || '(vazio)'} aria-disabled=${btnInfo.ariaDisabled || '(vazio)'}`);
                            }
                            if (hitTest) {
                                console.log(`      → Diagnóstico: elementFromPoint=${hitTest.tag} class=${hitTest.className || '(vazio)'}`);
                            }

                            try {
                                const outer = await contaCard.evaluate((el) => (el.outerHTML || '').slice(0, 900));
                                if (outer) console.log(`      → Diagnóstico: contaCard HTML=${outer}`);
                            } catch (e) { }

                            try {
                                const recentNet = networkTrace
                                    .filter((e) => e && typeof e.t === 'number' && e.t >= startedAt - 1000)
                                    .slice(-20);
                                if (recentNet.length === 0) {
                                    console.log('      → Diagnóstico: rede=nenhuma requisição recente');
                                } else {
                                    console.log(`      → Diagnóstico: rede (últimos ${recentNet.length})`);
                                    for (const entry of recentNet) {
                                        if (entry.type === 'REQ') {
                                            console.log(`         - REQ ${entry.method} (${entry.rt}) ${entry.url}`);
                                        } else if (entry.type === 'RES') {
                                            console.log(`         - RES ${entry.status} ${entry.url}`);
                                        }
                                    }
                                }
                            } catch (e) { }
                        } catch (e) { }

                        throw new Error(`DASHBOARD_TIMEOUT_${TOTAL_WAIT_MS}ms`);
                    }, 'Selecionar conta e carregar dashboard', 3);

                    if (selecaoResultado === 'SEM_FATURA') {
                        console.log(`   ℹ️  Sem faturas pendentes para esta conta.\n`);
                        resultados.push({
                            success: true,
                            conta,
                            id,
                            info: 'Sem faturas pendentes'
                        });
                        continue;
                    }

                    console.log('   ✓ Dashboard carregado');
                    await sleep(2000);

                    // Baixa fatura
                    console.log('   → Tentando baixar fatura...');

                    const finalBase64 = await retryAction(async () => {
                        const downloadPromise = page.waitForEvent('download', { timeout: 120000 });

                        // Tenta encontrar o botão de várias formas
                        const btnBaixar = page.getByRole('link', { name: 'Baixar segunda via completa' });
                        if (await btnBaixar.isVisible({ timeout: 5000 })) {
                            await btnBaixar.click();
                        } else {
                            // Fallback selector se o texto mudar ou for diferente
                            await page.locator('.card-segunda-via a').first().click();
                        }

                        const download = await downloadPromise;
                        const downloadPath = await download.path();
                        const pdfBuffer = fs.readFileSync(downloadPath);
                        try { fs.unlinkSync(downloadPath); } catch (e) { }
                        return pdfBuffer.toString('base64');
                    }, 'Processo de Download da Fatura', 2);

                    console.log(`   ✓ Fatura baixada (${(finalBase64.length / 1024).toFixed(1)} KB)\n`);

                    resultados.push({
                        success: true,
                        conta,
                        id,
                        filename: `fatura_${conta}.pdf`,
                        file_base64: finalBase64
                    });

                } catch (error) {
                    // Captura Screenshot do erro
                    try {
                        const screenshotsDir = './screenshots';
                        if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const screenshotPath = `${screenshotsDir}/erro_${conta}_${timestamp}.png`;
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        console.log(`      📸 Screenshot salvo: ${screenshotPath}`);
                    } catch (e) {
                        console.log('      ⚠️ Falha ao tirar screenshot:', e.message);
                    }

                    if (error.message.includes('SEM_FATURA_PENDENTE')) {
                        console.log(`   ℹ️  Sem faturas pendentes para esta conta.\n`);
                        resultados.push({
                            success: true, // Consideramos sucesso pois processou corretamente
                            conta,
                            id,
                            info: 'Sem faturas pendentes'
                        });
                    } else {
                        console.error(`   ✗ Erro: ${error.message}\n`);
                        resultados.push({
                            success: false,
                            conta,
                            id,
                            error: error.message
                        });
                    }
                }
            }

            await context.close();
            await browser.close();

            // Se chegou aqui, sucesso
            break;

        } catch (error) {
            console.error(`\n✗ Erro fatal no processamento da empresa ${empresa} (Tentativa ${sessionAttempt}): ${error.message}`);
            if (browser) await browser.close().catch(() => { });

            if (sessionAttempt === MAX_SESSION_RETRIES) {
                // Marca todas as contas não processadas como erro
                for (const conta of contas) {
                    if (!resultados.find(r => r.conta === conta.conta)) {
                        resultados.push({
                            success: false,
                            conta: conta.conta,
                            id: conta.id,
                            error: `Erro no login/processamento: ${error.message}`
                        });
                    }
                }
            }
        }
    }

    return resultados;
}

/**
 * Faz o download da fatura de uma conta específica (LEGACY - mantido para compatibilidade API)
 * @param {string} email - Email para login
 * @param {string} senha - Senha para login
 * @param {string} conta - Número da conta contrato
 * @returns {Promise<{status: string, has_invoice: boolean, account: string, filename: string, file_base64: string}>}
 */
async function downloadInvoice(email, senha, conta) {
    // Chama a nova função com array de 1 conta
    const resultados = await processCompanyAccounts('api-call', email, senha, [{ conta, id: null }]);
    const resultado = resultados[0];

    if (resultado.success) {
        return {
            status: 'success',
            has_invoice: true,
            account: conta,
            filename: resultado.filename,
            file_base64: resultado.file_base64
        };
    } else {
        throw new Error(resultado.error);
    }
}

module.exports = { downloadInvoice, processCompanyAccounts };
