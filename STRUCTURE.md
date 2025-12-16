# Estrutura do Projeto

```
equatorial_11/
├─ src/                      # Refatoração (config, estado, servidor)
│  ├─ config.js
│  ├─ dashboardState.js
│  ├─ logger.js
│  ├─ paths.js
│  ├─ serviceRunner.js
│  └─ http/
│     └─ createApp.js
│
├─ public/                   # Dashboard (HTML/CSS/JS)
│  ├─ index.html
│  ├─ css/style.css
│  └─ js/app.js
│
├─ docs/                     # Documentação
│  ├─ SERVICE_README.md
│  ├─ N8N_SETUP.md
│  ├─ WEBHOOK_FORMAT.md
│  └─ n8n-webhook-code.js
│
├─ automation.js             # Automação Playwright (Equatorial)
├─ pdfExtractor.js           # Extração de dados do PDF (pdf2json)
├─ service.js                # Entry-point do serviço (agendamento + dashboard)

├─ install-service.js        # Instala como serviço Windows (node-windows)
├─ uninstall-service.js      # Remove o serviço Windows
├─ package.json
├─ package-lock.json
├─ .env.example
├─ .gitignore
└─ Dockerfile / docker-compose.yml / docker-stack.yml (opcional)
```

## Pastas/arquivos de runtime (fora do Git)

- `logs/` (gerado automaticamente pelo Winston)
- `dashboard-data.json` (estado do dashboard)
- `browsers/` (cache do Playwright, se configurado)
- `screenshots/` (debug da automação)

