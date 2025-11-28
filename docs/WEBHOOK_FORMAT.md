# Formato do Webhook de Contas - Atualizado

## 📋 Formato Esperado

O webhook de entrada deve retornar um array de contas com as seguintes propriedades:

```json
[
  {
    "data": [
      {
        "conta": "003031130114",
        "id": 28,
        "email": "usuario@exemplo.com",
        "senha": "SenhaSegura123",
        "ultima_verificacao": "2025-11-24T06:00:00.000Z",
        "proxima_verificacao": "2025-11-25T06:00:00.000Z",
        "enviar": true,
        "createdAt": "2025-11-24T18:07:44.277Z",
        "updatedAt": "2025-11-28T14:34:47.561Z"
      },
      {
        "conta": "003031161290",
        "id": 29,
        "email": "outro@exemplo.com",
        "senha": "OutraSenha456",
        "ultima_verificacao": "2025-11-24T06:00:00.000Z",
        "proxima_verificacao": "2025-11-25T06:00:00.000Z",
        "enviar": true,
        "createdAt": "2025-11-24T18:07:45.163Z",
        "updatedAt": "2025-11-28T14:36:41.305Z"
      }
    ]
  }
]
```

## 🔑 Credenciais por Conta

Agora **cada conta** pode ter suas próprias credenciais:
- `email` ou `e-mail`: Email para login na Equatorial
- `senha`: Senha para login na Equatorial

### Fallback para Credenciais Padrão

Se uma conta **NÃO** tiver `email` e `senha` no webhook, o serviço usará as credenciais padrão do `.env`:
- `EMAIL_DEFAULT`
- `SENHA_DEFAULT`

Isso permite:
- ✅ Contas com credenciais específicas
- ✅ Contas que compartilham credenciais padrão
- ✅ Migração gradual (adicionar credenciais aos poucos)

## 📝 Exemplo N8N Code Node

```javascript
// Transforma itens do banco em array com credenciais
const contas = items.map(item => ({
  conta: item.json.conta_numero,
  id: item.json.id,
  email: item.json.email_acesso,        // Email específico da conta
  senha: item.json.senha_acesso,        // Senha específica da conta
  ultima_verificacao: item.json.ultima_verificacao,
  proxima_verificacao: item.json.proxima_verificacao,
  enviar: item.json.enviar,
  createdAt: item.json.created_at,
  updatedAt: item.json.updated_at
}));

return contas;
```

## ⚠️ Compatibilidade

O código também aceita o formato alternativo com hífen:
- `"e-mail"` (aceito)
- `"email"` (preferido)

Ambos funcionam perfeitamente!
