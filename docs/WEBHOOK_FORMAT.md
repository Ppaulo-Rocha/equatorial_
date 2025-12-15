# Formatos de Webhook

## 1) Webhook de contas (entrada) — `WEBHOOK_CONTAS_URL`

O serviço aceita estes formatos:

### Formato A (array direto)
```json
[
  { "conta": "0030...", "id": 1, "empresa": "empresa-a", "email": "user@exemplo.com", "senha": "..." },
  { "conta": "0030...", "id": 2, "empresa": "empresa-a" }
]
```

### Formato B (`data: [...]`)
```json
{ "data": [ { "conta": "0030...", "id": 1 } ] }
```

### Campos aceitos por item

- `conta` (obrigatório)
- `id` (opcional)
- `empresa` (opcional): usado para agrupar contas e fazer 1 login por empresa
- `email` ou `e-mail` (opcional): credencial por conta/empresa
- `senha` (opcional): credencial por conta/empresa

Se `email/senha` não vierem no webhook, o serviço usa `EMAIL_DEFAULT/SENHA_DEFAULT` do `.env`.

## 2) Webhook de envio (saída) — `WEBHOOK_ENVIO_URL`

Exemplo de payload enviado:

```json
{
  "conta": "0030...",
  "email": "user@exemplo.com",
  "status": "success",
  "filename": "fatura_0030....pdf",
  "file_base64": "JVBERi0xLjQK...",
  "conta_id": 1,
  "processado_em": "2025-11-28T11:30:00.000Z",
  "nota_fiscal": "123456",
  "valor": "123,45",
  "codigo_barras": "1234...",
  "data_vencimento": "10/12/2025",
  "conta_contrato": "0030...",
  "proxima_leitura": "15/12/2025"
}
```

