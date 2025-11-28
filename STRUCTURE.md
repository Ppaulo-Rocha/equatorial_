# Estrutura do Projeto

```
equatorial_11/
├── docs/                          # Documentação
│   ├── SERVICE_README.md          # Guia completo do serviço Windows
│   ├── N8N_SETUP.md              # Configuração do n8n
│   ├── WEBHOOK_FORMAT.md         # Formato dos webhooks
│   └── n8n-webhook-code.js       # Código exemplo para n8n
│
├── logs/                          # Logs do serviço (gerado em runtime)
│   ├── service.log               # Logs gerais
│   └── error.log                 # Apenas erros
│
├── screenshots/                   # Screenshots de erro (debug)
│
├── automation.js                  # Módulo core de automação Playwright
├── service.js                     # Serviço Windows principal
├── server.js                      # API Express (testes manuais)
├── install-service.js             # Script de instalação do serviço
├── uninstall-service.js          # Script de desinstalação
│
├── .env                          # Variáveis de ambiente (não versionado)
├── .env.example                  # Template de configuração
├── .gitignore                    # Arquivos ignorados pelo Git
│
├── package.json                  # Dependências do projeto
├── package-lock.json            # Lock de versões
│
├── Dockerfile                    # Imagem Docker (opcional)
├── docker-compose.yml           # Compose para dev (opcional)
├── docker-stack.yml             # Swarm deploy (opcional)
│
└── README.md                     # Este arquivo
```

## 📁 Diretórios Principais

### `/docs`
Toda a documentação do projeto:
- Guias de instalação
- Configuração de webhooks
- Formatos de dados
- Exemplos de código

### `/logs`
Gerado automaticamente pelo serviço. Contém:
- `service.log` - Todos os logs
- `error.log` - Apenas erros
- Rotação automática (5MB máximo por arquivo)

### `/screenshots`
Screenshots de debug quando há erros na automação.

## 🔧 Arquivos Core

### `automation.js`
Módulo reutilizável com a lógica de automação Playwright.
- Função exportada: `downloadInvoice(email, senha, conta)`
- Anti-detecção de bot
- Retry logic embutido

### `service.js`
Serviço principal que roda em background:
- Busca contas de webhook
- Processa automaticamente
- Envia resultados para webhook destino
- Logging robusto com Winston

### `server.js`
API Express para testes manuais:
- Endpoint: `POST /webhook/fatura`
- Útil para debug e testes
- Usa o mesmo módulo `automation.js`

### Scripts de Serviço
- `install-service.js` - Instala como serviço Windows
- `uninstall-service.js` - Remove o serviço

## 🔐 Configuração

### `.env`
Arquivo com variáveis sensíveis (não compartilhar):
```env
WEBHOOK_CONTAS_URL=https://...
WEBHOOK_ENVIO_URL=https://...
EMAIL_DEFAULT=...
SENHA_DEFAULT=...
```

### `.env.example`
Template para criar seu `.env`.

## 📦 Package Files

### `package.json`
Dependências principais:
- `express` - API REST
- `playwright` - Automação web
- `winston` - Logging
- `axios` - HTTP requests
- `node-windows` - Serviço Windows
- `dotenv` - Variáveis de ambiente

## 🐳 Docker (Opcional)

Se você preferir usar Docker em vez de serviço Windows:
- `Dockerfile` - Build da imagem
- `docker-compose.yml` - Dev local
- `docker-stack.yml` - Deploy em Swarm

## 📝 Ordem de Leitura da Documentação

1. **README.md** (você está aqui) - Visão geral
2. **docs/SERVICE_README.md** - Instalação do serviço Windows
3. **docs/N8N_SETUP.md** - Configuração do n8n
4. **docs/WEBHOOK_FORMAT.md** - Formatos de dados
