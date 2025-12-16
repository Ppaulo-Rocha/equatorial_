function formatDate(isoString) {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('pt-BR');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

function getStatusClass(status) {
    if (status === 'RUNNING') return 'running';
    if (status === 'IDLE') return 'idle';
    return '';
}

function updateStatus(data) {
    const statusEl = document.getElementById('service-status');
    const btnRun = document.getElementById('btn-run');
    const lastRunEl = document.getElementById('last-run');
    const nextRunEl = document.getElementById('next-run');
    const lastActivityEl = document.getElementById('last-activity');

    const status = data?.status || 'UNKNOWN';
    const isRunning = status === 'RUNNING';

    if (statusEl) {
        statusEl.textContent = status;
        statusEl.className = `status-badge ${getStatusClass(status)}`.trim();
    }

    if (btnRun) {
        btnRun.disabled = isRunning;
        btnRun.textContent = isRunning ? 'Executando...' : 'Iniciar agora';
    }

    if (lastRunEl) lastRunEl.textContent = formatDate(data?.lastRun);
    if (nextRunEl) nextRunEl.textContent = formatDate(data?.nextRun);
    if (lastActivityEl) lastActivityEl.textContent = data?.lastActivity || '-';

    if (data?.stats) {
        const byId = (id) => document.getElementById(id);
        const set = (id, value) => {
            const el = byId(id);
            if (el) el.textContent = String(value ?? 0);
        };

        set('stat-success', data.stats.sucesso);
        set('stat-fail', data.stats.falha);
        set('stat-no-invoice', data.stats.sem_fatura);
        set('stat-total', data.stats.total);
    }

    if (data?.config?.interval) {
        const intervalInput = document.getElementById('interval-input');
        if (intervalInput) intervalInput.value = data.config.interval;
    }
}

function updateLogs(lines) {
    const terminal = document.getElementById('terminal-logs');
    if (!terminal) return;

    const wasScrolledToBottom = terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 5;
    const safeLines = (lines || []).map((line) => `<div class="log-line">${escapeHtml(line)}</div>`).join('');
    terminal.innerHTML = safeLines;

    if (wasScrolledToBottom) terminal.scrollTop = terminal.scrollHeight;
}

async function fetchData() {
    try {
        const statusRes = await fetch('/api/status');
        const statusData = await statusRes.json();
        updateStatus(statusData);

        const logsRes = await fetch('/api/logs');
        const logsData = await logsRes.json();
        updateLogs(logsData.logs);
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
    }
}

function initControls() {
    const btnSaveConfig = document.getElementById('btn-save-config');
    const intervalInput = document.getElementById('interval-input');
    const btnRun = document.getElementById('btn-run');

    if (btnRun) {
        btnRun.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/run', { method: 'POST' });
                const payload = await res.json().catch(() => ({}));

                if (!res.ok) {
                    alert(payload.message || payload.error || 'Falha ao iniciar ciclo.');
                    return;
                }

                alert(payload.message || 'Ciclo iniciado.');
            } catch (e) {
                console.error(e);
                alert('Erro ao iniciar ciclo.');
            } finally {
                fetchData();
            }
        });
    }

    if (btnSaveConfig && intervalInput) {
        btnSaveConfig.addEventListener('click', async () => {
            try {
                const intervalMinutes = Number.parseInt(intervalInput.value, 10);
                if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080) {
                    alert('O intervalo deve ser entre 5 e 10080 minutos');
                    return;
                }

                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ intervalMinutes }),
                });

                const payload = await res.json().catch(() => ({}));

                if (!res.ok) {
                    alert(payload.error || 'Erro ao salvar configuração');
                    return;
                }

                alert('Intervalo atualizado com sucesso!');
                fetchData();
            } catch (e) {
                console.error(e);
                alert('Erro ao salvar configuração');
            }
        });
    }
}

initControls();
fetchData();
setInterval(fetchData, 2000);

