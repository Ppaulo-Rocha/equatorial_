# Configuração do n8n

O serviço faz:

1. `POST` em `WEBHOOK_CONTAS_URL` para buscar contas a processar
2. Processa as contas (automação)
3. `POST` em `WEBHOOK_ENVIO_URL` com a fatura (base64) + dados extraídos do PDF

## Webhook de contas (`WEBHOOK_CONTAS_URL`)

### Exemplo de workflow

1. **Webhook Trigger**
   - Method: `POST`
   - Path: `webhook/contas_contratos`
2. **Database Query** (ex.: Postgres)
3. **Code Node** (transforma itens em array)
4. **Respond to Webhook** (retorna o array)

### Code Node

Use o exemplo em `docs/n8n-webhook-code.js`.

O retorno deve ser um **array JSON** (ou um objeto contendo `data: [...]` — o serviço aceita ambos).

## Webhook de envio (`WEBHOOK_ENVIO_URL`)

O serviço envia um JSON com:
- `conta`, `email`, `filename`, `file_base64`, `conta_id`, `processado_em`
- Campos extraídos do PDF: `nota_fiscal`, `valor`, `codigo_barras`, `data_vencimento`, `conta_contrato`, `proxima_leitura`

Detalhes e exemplos: `docs/WEBHOOK_FORMAT.md`.

