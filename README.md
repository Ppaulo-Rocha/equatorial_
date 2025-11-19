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
- **Value**: `Bearer seu-token-secreto` (substitua pelo token configurado em `server.js`)

### Corpo da Requisição (Body)

A requisição deve ser do tipo `application/json` e conter os seguintes campos:

```json
{
  "cnpj": "15.070.244/0001-18",
  "email": "adm.financeiro@mov.pro.br",
  "contrato": "003026429560"
}
```

- `cnpj` (opcional): CNPJ usado para o login. Se não for fornecido, usa um valor padrão.
- `email` (opcional): E-mail usado para o login. Se não for fornecido, usa um valor padrão.
- `contrato` (**obrigatório**): O número da "Conta Contrato" da fatura que você deseja baixar.

### Resposta de Sucesso (com fatura)

```json
{
    "status": "success",
    "has_invoice": true,
    "contract": "003026429560",
    "filename": "fatura_003026429560.pdf",
    "file_base64": "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvTGFuZ..."
}
```

### Resposta de Sucesso (sem fatura encontrada)

```json
{
    "status": "success",
    "message": "Não foram encontradas faturas em aberto para o contrato 003026429560.",
    "has_invoice": false
}
```

### Resposta de Erro

```json
{
    "status": "error",
    "message": "Falha crítica após todas as tentativas.",
    "details": "Mensagem de erro específica..."
}
```