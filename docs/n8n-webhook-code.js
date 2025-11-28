// ============================================
// CÓDIGO N8N - Code Node (CORRIGIDO)
// ============================================
// IMPORTANTE: Use "items" (SEM o $) dentro do Code node

// CÓDIGO CORRETO ✅
const contas = items.map(item => item.json);
return contas;

// ============================================
// ALTERNATIVAS
// ============================================

// Opção 2: Retornar campos específicos
/*
const contas = items.map(item => ({
  conta: item.json.conta,
  id: item.json.id,
  ultima_verificacao: item.json.ultima_verificacao,
  proxima_verificacao: item.json.proxima_verificacao,
  createdAt: item.json.createdAt,
  updatedAt: item.json.updatedAt
}));
return contas;
*/

// Opção 3: Com filtro por data
/*
const agora = new Date();
const contas = items
  .map(item => item.json)
  .filter(conta => {
    const proxima = new Date(conta.proxima_verificacao);
    return proxima <= agora;
  });
return contas;
*/

// Opção 4: Retornar dados hardcoded (para teste)
/*
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
*/

// ============================================
// IMPORTANTE: Diferença entre $items e items
// ============================================
// No n8n Code node (Run Once for All Items):
//   - Use: items (SEM $)
//   - Exemplo: items.map(item => item.json)
//
// Na expressão {{ }} em outros campos:
//   - Use: $items (COM $)
//   - Exemplo: {{ $items[0].json.conta }}
