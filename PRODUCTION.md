# Checklist de Produção — Equatorial Auto Invoice

## Antes do deploy

- [ ] Atualizar `.env` (não versionado) com URLs, token e credenciais
- [ ] Confirmar acesso aos webhooks do n8n (`WEBHOOK_CONTAS_URL` e `WEBHOOK_ENVIO_URL`)
- [ ] Instalar browsers do Playwright (se necessário): `npx playwright install chromium`
- [ ] Validar permissões do usuário do serviço (Windows)

## Subir em modo console (smoke test)

```bash
npm install
npm run service
```

- Dashboard: `http://localhost:2032`
- Logs: `./logs/service.log` e `./logs/error.log`

## Instalação como Serviço Windows

Como Administrador:

```bash
npm run install-service
```

Verificar em `services.msc`:
- Nome: `EquatorialAutoInvoice`
- Status: Em execução
- Inicialização: Automático

## Pós-deploy

- [ ] Acompanhar logs por algumas execuções
- [ ] Validar envio de payload para o webhook de destino
- [ ] Confirmar que o dashboard mostra `RUNNING/IDLE` e `nextRun`

