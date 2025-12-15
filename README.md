# Equatorial Auto Invoice

Serviço em **Node.js** (com **Playwright**) para automatizar o download de faturas da Equatorial, integrar com **n8n** via webhooks e expor um **dashboard** para monitoramento.

## Requisitos

- Node.js `>=16`
- Windows 10/11 (ou Windows Server) para uso como serviço

## Como rodar (modo console)

1. Instale dependências:
   ```bash
   npm install
   ```

2. Crie seu `.env` a partir do exemplo:
   ```bash
   copy .env.example .env
   ```

3. Instale o Chromium do Playwright (se necessário):
   ```bash
   npx playwright install chromium
   ```

4. Inicie o serviço:
   ```bash
   npm run service
   ```

Dashboard: `http://localhost:2032`

## API (modo manual)

Para testes manuais do endpoint `POST /webhook/fatura`:

```bash
npm start
```

## Serviço Windows

Como Administrador:

```bash
npm run install-service
```

Para remover:

```bash
npm run uninstall-service
```

## Documentação

- `docs/SERVICE_README.md` (instalação/gerenciamento do serviço)
- `docs/N8N_SETUP.md` (configuração do n8n)
- `docs/WEBHOOK_FORMAT.md` (formatos de payload)

## Observações

- `.env`, `logs/`, `browsers/` e `dashboard-data.json` são artefatos de runtime e ficam fora do Git.

