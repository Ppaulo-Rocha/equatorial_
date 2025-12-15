# Serviço Windows — Equatorial Auto Invoice

Este projeto pode rodar de 2 formas:

- **Serviço (recomendado)**: `service.js` — agenda ciclos, integra com n8n e expõe o dashboard.
- **API manual**: `server.js` — útil para testes do `POST /webhook/fatura`.

## Pré-requisitos

- Windows 10/11 (ou Windows Server)
- Node.js `>=16`
- Permissões de administrador (apenas para instalar/remover o serviço)

## Configuração

Crie um `.env` (não versionado) baseado em `.env.example`.

Variáveis principais:

- `PORT` (padrão: `2032`)
- `AUTH_TOKEN` (token Bearer obrigatório no `POST /webhook/fatura`)
- `WEBHOOK_CONTAS_URL` (entrada: lista de contas)
- `WEBHOOK_ENVIO_URL` (saída: envio da fatura + dados extraídos)
- `EMAIL_DEFAULT` / `SENHA_DEFAULT` (fallback se o webhook não enviar credenciais)
- `CHECK_INTERVAL_HOURS` (intervalo do ciclo em horas)
- `LOG_LEVEL`

## Instalar browsers do Playwright

Se a máquina ainda não tiver o Chromium do Playwright:

```bash
npx playwright install chromium
```

## Rodar em modo console (sem instalar serviço)

```bash
npm run service
```

Dashboard: `http://localhost:2032`

## Instalar como Serviço Windows

Execute como Administrador:

```bash
npm run install-service
```

Para remover:

```bash
npm run uninstall-service
```

## Rotas

- `GET /health`
- `GET /api/status`
- `GET /api/logs`
- `POST /api/run` (apenas no modo `service.js`)
- `POST /api/config` (apenas no modo `service.js`)
- `POST /webhook/fatura` (requer `Authorization: Bearer <AUTH_TOKEN>`)

## Logs e arquivos de runtime

- Logs: `./logs/service.log` e `./logs/error.log`
- Estado do dashboard: `./dashboard-data.json`

Esses arquivos/pastas ficam fora do Git.

