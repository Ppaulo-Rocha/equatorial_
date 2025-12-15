// ============================================
// CÓDIGO N8N — Code Node (exemplo)
// ============================================
// IMPORTANTE:
// - No Code node (Run Once for All Items), use "items" (sem $)
// - Em expressões {{ }} de outros nodes, use "$items" (com $)

// Retorna um array com os objetos do banco
const contas = items.map((item) => item.json);
return contas;

// ============================================
// Alternativa: selecionar campos específicos
// ============================================
/*
const contas = items.map(item => ({
  conta: item.json.conta,
  id: item.json.id,
  empresa: item.json.empresa,
  email: item.json.email,
  senha: item.json.senha,
  ultima_verificacao: item.json.ultima_verificacao,
  proxima_verificacao: item.json.proxima_verificacao
}));
return contas;
*/

