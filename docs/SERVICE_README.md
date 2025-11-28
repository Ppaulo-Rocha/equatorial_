# Serviço Windows - Equatorial Auto Invoice

Este documento descreve como instalar, configurar e gerenciar o serviço Windows para download automático de faturas da Equatorial.

## 📋 Visão Geral

O **EquatorialAutoInvoice** é um serviço Windows que:
- ✅ Inicia automaticamente com o Windows
- ✅ Roda em segundo plano (sem interface gráfica)
- ✅ Verifica contas a cada 24 horas (configurável)
- ✅ Busca lista de contas de um webhook
- ✅ Faz download automático de faturas em aberto
- ✅ Envia faturas para webhook de destino
- ✅ Gera logs detalhados de todas operações

## 🚀 Instalação

### Pré-requisitos

- Windows 10/11 ou Windows Server
- Node.js v16 ou superior
- Permissões de administrador

### Passo a Passo

1. **Instalar dependências**:
   ```bash
   npm install
   ```

2. **Configurar variáveis de ambiente** (opcional):
   
   Edite o arquivo `.env` se necessário:
   ```env
   WEBHOOK_CONTAS_URL=https://n8n.svd.tec.br/webhook/contas_contratos
   WEBHOOK_ENVIO_URL=https://n8n.svd.tec.br/webhook/contas
   EMAIL_DEFAULT=adm.financeiro@mov.pro.br
   SENHA_DEFAULT=Movfibra15070@
   CHECK_INTERVAL_HOURS=24
   LOG_LEVEL=info
   ```

3. **Instalar o navegador Playwright** (se ainda não instalou):
   ```bash
   npx playwright install chromium
   ```

4. **Instalar o serviço Windows** (como Administrador):
   ```bash
   npm run install-service
   ```

5. **Verificar instalação**:
   - Pressione `Win + R`
   - Digite `services.msc` e pressione Enter
   - Procure por "EquatorialAutoInvoice"
   - O serviço deve estar com status "Em execução"

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `WEBHOOK_CONTAS_URL` | URL do webhook que retorna lista de contas | `https://n8n.svd.tec.br/webhook/contas_contratos` |
| `WEBHOOK_ENVIO_URL` | URL do webhook para envio das faturas | `https://n8n.svd.tec.br/webhook/contas` |
| `EMAIL_DEFAULT` | Email para login na Equatorial | `adm.financeiro@mov.pro.br` |
| `SENHA_DEFAULT` | Senha para login na Equatorial | `Movfibra15070@` |
| `CHECK_INTERVAL_HOURS` | Intervalo entre verificações (em horas) | `24` |
| `LOG_LEVEL` | Nível de log (error, warn, info, debug) | `info` |

### Formato do Webhook de Entrada

O webhook `WEBHOOK_CONTAS_URL` deve retornar um array JSON:

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

### Formato de Envio para Webhook

O serviço envia para `WEBHOOK_ENVIO_URL`:

```json
{
  "conta": "003031650100",
  "email": "adm.financeiro@mov.pro.br",
  "status": "success",
  "filename": "fatura_003031650100.pdf",
  "file_base64": "JVBERi0xLjQK...",
  "conta_id": 39,
  "processado_em": "2025-11-28T11:30:00.000Z"
}
```

## 📊 Monitoramento

### Logs

Os logs são salvos em `./logs/`:
- `service.log` - Logs gerais de operação
- `error.log` - Apenas erros

**Visualizar logs em tempo real**:
```bash
# Windows PowerShell
Get-Content .\logs\service.log -Wait -Tail 50
```

### Status do Serviço

**Via interface gráfica**:
1. Abra `services.msc` (Win+R)
2. Procure "EquatorialAutoInvoice"
3. Veja status, tipo de inicialização, etc.

**Via linha de comando**:
```bash
sc query EquatorialAutoInvoice
```

## 🔧 Gerenciamento

### Parar o Serviço
```bash
sc stop EquatorialAutoInvoice
```

### Iniciar o Serviço
```bash
sc start EquatorialAutoInvoice
```

### Reiniciar o Serviço
```bash
sc stop EquatorialAutoInvoice && sc start EquatorialAutoInvoice
```

### Desinstalar o Serviço
```bash
npm run uninstall-service
```

## 🧪 Testes

### Testar Manualmente (sem instalar como serviço)

```bash
node service.js
```

Isso executará o serviço em modo de console, permitindo ver os logs em tempo real.

### Testar a API Express (modo legado)

O servidor Express continua disponível para testes manuais:

```bash
npm start
```

Então faça uma requisição:
```bash
curl -X POST http://localhost:2031/webhook/fatura \
  -H "Authorization: Bearer 057ebcdc28b0b95cabe45341b209d28d" \
  -H "Content-Type: application/json" \
  -d "{\"conta\": \"003014474705\"}"
```

## 🐛 Troubleshooting

### Serviço não inicia

1. Verifique os logs em `./logs/error.log`
2. Confirme que todas as dependências foram instaladas
3. Verifique se o Chromium do Playwright foi instalado: `npx playwright install chromium`

### Contas não são processadas

1. Verifique se o webhook de contas está acessível
2. Teste a URL do webhook manualmente:
   ```bash
   curl https://n8n.svd.tec.br/webhook/contas_contratos
   ```
3. Verifique os logs para ver erros específicos

### Faturas não são enviadas

1. Verifique se o webhook de envio está acessível
2. Confirme que o formato da fatura está correto
3. Verifique logs de erro

### Serviço consome muita memória

1. Reduza a frequência de verificação (aumente `CHECK_INTERVAL_HOURS`)
2. Verifique se há vazamentos de memória nos logs
3. Reinicie o serviço periodicamente via agendador de tarefas do Windows

## 📁 Estrutura de Arquivos

```
equatorial_11/
├── automation.js           # Módulo de automação Playwright
├── service.js             # Serviço principal (background)
├── server.js              # API Express (para testes manuais)
├── install-service.js     # Script de instalação do serviço
├── uninstall-service.js   # Script de desinstalação
├── .env                   # Variáveis de ambiente
├── .env.example           # Template de configuração
├── logs/                  # Diretório de logs
│   ├── service.log
│   └── error.log
└── package.json
```

## ⚠️ Notas Importantes

- O serviço roda com as permissões do usuário que o instalou
- Certifique-se de que as credenciais no `.env` estão corretas
- Logs são rotacionados automaticamente (máximo 5MB por arquivo)
- O primeiro ciclo de verificação inicia imediatamente após o serviço iniciar
- Após cada ciclo, o serviço aguarda o intervalo configurado antes do próximo

## 🔄 Atualizações

Para atualizar o código do serviço:

1. Desinstale o serviço:
   ```bash
   npm run uninstall-service
   ```

2. Atualize os arquivos de código

3. Reinstale o serviço:
   ```bash
   npm run install-service
   ```
