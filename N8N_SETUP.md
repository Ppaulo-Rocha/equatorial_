# Configuração do Webhook no n8n - Guia Completo

## 📋 Estrutura do Workflow

```
┌─────────────────┐
│ Webhook Trigger │ → POST /webhook/contas_contratos
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Database Query  │ → SELECT * FROM contas WHERE ativo = true
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Code Node ⚡    │ → Transforma itens em array
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Respond Webhook │ → Retorna array JSON
└─────────────────┘
```

## 🔧 Configuração Node por Node

### 1️⃣ Webhook Trigger
- **Node**: `Webhook`
- **HTTP Method**: `POST`
- **Path**: `webhook/contas_contratos`
- **Response Mode**: `When Last Node Finishes`

### 2️⃣ Database Query (Exemplo com Postgres)
- **Node**: `Postgres`
- **Operation**: `Execute Query`
- **Query**:
```sql
SELECT 
  id,
  conta_numero as conta,
  ultima_verificacao,
  proxima_verificacao,
  created_at as createdAt,
  updated_at as updatedAt
FROM contas_contratos
WHERE ativo = true
ORDER BY proxima_verificacao ASC
```

### 3️⃣ Code Node ⚡ (CRÍTICO!)

**Este é o node mais importante!**

Cole o código de `n8n-webhook-code.js`:

```javascript
// Transforma múltiplos itens em array
const contas = $items.map(item => item.json);
return contas;
```

**⚠️ IMPORTANTE**: 
- Use `return contas` (array direto)
- **NÃO** use `return {data: contas}` (objeto)

### 4️⃣ Respond to Webhook
- **Node**: `Respond to Webhook`
- **Response Code**: `200`
- **Response Body**: `{{ $json }}`
- **Headers**: 
  - `Content-Type`: `application/json`

## 🎯 Variações do Code Node

### Opção A: Básico (Todos os Campos)
```javascript
const contas = $items.map(item => item.json);
return contas;
```

### Opção B: Campos Específicos
```javascript
const contas = $items.map(item => ({
  conta: item.json.conta,
  id: item.json.id,
  ultima_verificacao: item.json.ultima_verificacao,
  proxima_verificacao: item.json.proxima_verificacao
}));
return contas;
```

### Opção C: Com Filtro por Data
```javascript
const agora = new Date();
const contas = $items
  .map(item => item.json)
  .filter(conta => {
    const proxima = new Date(conta.proxima_verificacao);
    return proxima <= agora;
  });
return contas;
```

### Opção D: Hardcoded (Para Testes)
```javascript
return [
  {
    conta: "003031650100",
    id: 39,
    ultima_verificacao: "2025-11-24T06:00:00.000Z",
    proxima_verificacao: "2025-11-25T06:00:00.000Z"
  },
  {
    conta: "003031476819",
    id: 38,
    ultima_verificacao: "2025-11-24T06:00:00.000Z",
    proxima_verificacao: "2025-11-25T06:00:00.000Z"
  }
];
```

## ✅ Formato de Resposta Esperado

O webhook DEVE retornar:

```json
[
  {
    "conta": "003031650100",
    "id": 39,
    "ultima_verificacao": "2025-11-24T06:00:00.000Z",
    "proxima_verificacao": "2025-11-25T06:00:00.000Z"
  },
  {
    "conta": "003031476819",
    "id": 38,
    "ultima_verificacao": "2025-11-24T06:00:00.000Z",
    "proxima_verificacao": "2025-11-25T06:00:00.000Z"
  }
]
```

**❌ NÃO retorne assim**:
```json
{
  "data": [...]  // ← Isso causa erro!
}
```

## 🧪 Testar o Webhook

### Teste Manual
```bash
curl -X POST https://n8n.svd.tec.br/webhook/contas_contratos
```

### Teste via Postman
- **Method**: `POST`
- **URL**: `https://n8n.svd.tec.br/webhook/contas_contratos`
- **Body**: None

### Verificar Resposta
A resposta deve ser um **array JSON** com as contas.

## 🐛 Troubleshooting

### Erro: "Resposta do webhook não é um array"
**Causa**: O Code node está retornando `{data: [...]}` em vez de `[...]`

**Solução**: No Code node, use:
```javascript
return $items.map(item => item.json);
```

### Erro: "404 Not Found"
**Causa**: Workflow não está ativado ou URL incorreta

**Solução**: 
1. Ative o workflow no n8n
2. Verifique a URL do webhook

### Retorna Array Vazio `[]`
**Causa**: Database query não retornou resultados

**Solução**:
1. Verifique a query SQL
2. Confirme que existem dados na tabela
3. Teste a query diretamente no banco

## 📊 Exemplo Completo de Workflow

```javascript
// Example workflow setup in n8n:

// 1. Webhook (POST /webhook/contas_contratos)
// 2. Postgres Query
// 3. Code Node:
const contas = $items.map(item => ({
  conta: item.json.conta_numero,
  id: item.json.id,
  ultima_verificacao: item.json.ultima_verificacao,
  proxima_verificacao: item.json.proxima_verificacao,
  createdAt: item.json.created_at,
  updatedAt: item.json.updated_at
}));
return contas;

// 4. Respond to Webhook
```

## 💡 Dicas

- Use o **Execute Workflow** button no n8n para testar cada node
- Verifique o **output** de cada node para debugar
- Logs do serviço Windows ficam em `./logs/service.log`
- Para logs em tempo real: `Get-Content .\logs\service.log -Wait -Tail 50`
