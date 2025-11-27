# API de Automação para Faturas Equatorial

Este projeto consiste em uma API Node.js/Express projetada para automatizar o processo de download de faturas de energia do portal da Equatorial Energia.

A API expõe um endpoint de webhook que, ao ser acionado, utiliza a biblioteca Playwright para simular a navegação de um usuário, realizar o login, encontrar uma fatura específica e extrair o arquivo PDF correspondente.

## Funcionalidades

- **Endpoint Seguro**: Acesso ao webhook protegido por autenticação Bearer Token.
- **Automação com Playwright**: Navegação, login e interação com a página web de forma automatizada e robusta.
- **Técnicas Anti-Detecção**: Utiliza user-agent de navegador real e flags específicas do Chrome para dificultar a detecção como um bot.
- **Seleção Dinâmica de Contrato**: A API define a "Conta Contrato" ativa no painel do cliente antes de buscar a fatura, garantindo que a consulta seja feita para a unidade correta.
- **Captura Eficiente de PDF**: Em vez de lidar com pop-ups e downloads, a API intercepta a comunicação interna do site (`POST request`) para extrair o PDF diretamente dos dados da requisição, um método mais rápido e confiável.
- **Lógica de Retentativas**: O processo completo é repetido até 3 vezes em caso de falhas, aumentando a confiabilidade da automação.
- **Estrutura Organizada**: O código é modularizado em funções claras e bem documentadas, facilitando a manutenção e o entendimento.

## Pré-requisitos

- [Node.js](https://nodejs.org/) (versão 16 ou superior)
- [NPM](https://www.npmjs.com/) (geralmente instalado com o Node.js)

## Instalação

1.  Clone este repositório:
    ```bash
    git clone <url-do-repositorio>
    cd equatorial_11
    ```

2.  Instale as dependências do projeto:
    ```bash
    npm install
    ```
    Este comando instalará o `express` e o `playwright`. O Playwright também fará o download dos navegadores necessários na primeira vez.

## Configuração

Antes de iniciar o servidor, você pode ajustar as seguintes constantes no topo do arquivo `server.js`:

- `PORT`: A porta em que o servidor será executado (padrão: `3000`).
- `AUTH_TOKEN`: O token secreto para autorização do webhook (padrão: `meu-token-secreto-123`).
- `MAX_TENTATIVAS`: O número de vezes que a automação tentará ser executada em caso de erro (padrão: `3`).
- `headless`: No objeto de configuração do `chromium.launch`, mude para `true` para executar o navegador em modo "headless" (sem interface gráfica), ideal para produção.

## Como Executar

Para iniciar o servidor, execute o seguinte comando no terminal:

```bash
node server.js
```

O servidor estará rodando e escutando na porta configurada.

## Uso da API

### Endpoint

`POST /webhook/fatura`

### Autenticação

A requisição deve incluir um cabeçalho de autorização com um Bearer Token.

- **Header**: `Authorization`
- **Value**:# Equatorial Bot - Automação de Download de Faturas

Bot automatizado para download de faturas da Agência Virtual Equatorial Energia usando Playwright com técnicas anti-detecção.

## 🚀 Features

- ✅ Autenticação automática
- ✅ Seleção de conta por número
- ✅ Download de fatura em PDF (base64)
- ✅ Modo headless com stealth plugin
- ✅ API REST com autenticação por token
- ✅ Retry automático (3 tentativas)
- ✅ Screenshots de erro para debug
- ✅ Docker & Docker Swarm ready

## 📦 Deploy Rápido

### Docker Compose (Desenvolvimento)

```bash
docker-compose up -d
```

### Docker Swarm (Produção)

```bash
# Deploy da stack
docker stack deploy -c docker-stack.yml equatorial

# Verificar status
docker stack services equatorial

# Ver logs
docker service logs equatorial_equatorial-bot -f
```

**Imagem Docker Hub**: `paulolimal/equatorial:latest`

## 🔧 API Usage

### Endpoint
```
POST http://SEU-IP:2031/webhook/fatura
```

### Headers
```
Authorization: Bearer 057ebcdc28b0b95cabe45341b209d28d
Content-Type: application/json
```

### Request Body
```json
{
  "email": "adm.financeiro@mov.pro.br",
  "senha": "Movfibra15070@",
  "conta": "003014474705"
}
```

### Response Success
```json
{
  "status": "success",
  "has_invoice": true,
  "account": "003014474705",
  "filename": "fatura_003014474705.pdf",
  "file_base64": "JVBERi0xLjQKJ..."
}
```

### Response No Invoice
```json
{
  "status": "success",
  "message": "Não existem faturas em aberto.",
  "has_invoice": false
}
```

## 🛠️ Configuração

### Variáveis de Ambiente

- `AUTH_TOKEN`: Token de autenticação da API (padrão: `057ebcdc28b0b95cabe45341b209d28d`)
- `NODE_ENV`: Ambiente (padrão: `production`)
- `TZ`: Timezone (padrão: `America/Sao_Paulo`)

### Portas

- **Container**: 3000
- **Host**: 2031

## 📋 Recursos do Docker Swarm

- **Replicas**: 1 (escalável)
- **CPU Limit**: 2.0 cores
- **Memory Limit**: 2GB
- **CPU Reservation**: 0.5 cores
- **Memory Reservation**: 512MB
- **Healthcheck**: A cada 30s
- **Restart Policy**: on-failure (3 tentativas)
- **Network**: overlay (bot-net)

## 🔍 Monitoramento

```bash
# Status dos serviços
docker service ps equatorial_equatorial-bot

# Logs em tempo real
docker service logs equatorial_equatorial-bot -f --tail 50

# Healthcheck
curl http://localhost:2031/
# Resposta: "Equatorial Bot Online 🤖"
```

## 🐛 Debug

Screenshots de erro são salvos em `./screenshots/erro_tentativa_X.png` quando há falhas.

## 📚 Documentação Adicional

- **Deploy Guide**: Ver arquivo `DEPLOY.md` para instruções detalhadas
- **Walkthrough**: Ver arquivo `walkthrough.md` para detalhes técnicos
### Resposta de Erro

```json
{
    "status": "error",
    "message": "Falha crítica após todas as tentativas.",
    "details": "Mensagem de erro específica..."
}
```