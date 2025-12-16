# Guia de Implantação - Equatorial Auto Invoice

Este tutorial orienta sobre como implantar o serviço de automação **Equatorial Auto Invoice** em um ambiente de produção (Windows Server ou Desktop).

O sistema pode ser implantado de duas formas principais:
1. **Nativo como Serviço do Windows** (Recomendado para servidores Windows padrão)
2. **Container Docker** (Recomendado para ambientes virtualizados ou Linux)

---

## 1. Pré-requisitos Gerais

Antes de iniciar, certifique-se de ter instalado:
*   [Git](https://git-scm.com/downloads)
*   [Node.js](https://nodejs.org/) (Versão LTS 18+ ou 20+) - *Apenas para instalação nativa*
*   [Docker Desktop](https://www.docker.com/products/docker-desktop/) - *Apenas para instalação via Docker*

---

## 2. Configuração Inicial (Comum a todos os métodos)

1. **Clone o repositório:**
   ```powershell
   git clone https://github.com/Ppaulo-Rocha/equatorial_.git
   cd equatorial_
   ```

2. **Configure as variáveis de ambiente:**
   Duplique o arquivo `.env.example` e renomeie para `.env`. Configure as chaves:

   ```ini
   # Exemplo de configuração mínima
   PORT=3000
   HEADLESS=true
   CRON_SCHEDULE="0 */6 * * *"  # Executa a cada 6 horas
   
   # Webhooks do n8n (Obrigatórios)
   WEBHOOK_CONTAS_URL=https://n8n.seu-servidor.com/webhook/contas_contratos
   WEBHOOK_ENVIO_URL=https://n8n.seu-servidor.com/webhook/contas
   
   # Credenciais (Opcional, se não usar webhook de contas)
   EQUATORIAL_USER=seu_usuario
   EQUATORIAL_PASS=sua_senha
   ```

---

## 3. Método 1: Instalação Nativa (Serviço Windows)

Este método instala a automação como um serviço de background do Windows, que inicia automaticamente com o sistema.

### Passo 1: Instalar Dependências
Abra o **PowerShell como Administrador** na pasta do projeto e execute:

```powershell
npm install
npx playwright install chromium
```

> **Nota:** O comando do playwright é necessário para baixar o navegador compatível.

### Passo 2: Teste Manual (Smoke Test)
Antes de instalar o serviço, verifique se a automação roda corretamente:

```powershell
npm run service
```
*   Acesse o painel em: `http://localhost:2032` (ou porta configurada).
*   Verifique se não há erros no console.
*   Pressione `Ctrl+C` para parar.

### Passo 3: Instalar o Serviço
Ainda no PowerShell como **Administrador**:

```powershell
npm run install-service
```
*   Você verá a mensagem: *"Serviço 'EquatorialAutoInvoice' instalado com sucesso."*
*   O serviço aparecerá no gerenciador do Windows (`services.msc`) como **EquatorialAutoInvoice**.

### Gerenciamento do Serviço

*   **Verificar Status:** Abra `services.msc` e procure por "EquatorialAutoInvoice".
*   **Parar/Reiniciar:** Botão direito no serviço > Parar/Reiniciar.
*   **Logs:** Os logs ficam na pasta `./logs/` dentro do diretório do projeto.
    *   `service.log`: Logs gerais de execução.
    *   `error.log`: Erros críticos.

### Desinstalação
Para remover o serviço do Windows:
```powershell
npm run uninstall-service
```

---

## 4. Método 2: Instalação via Docker

Este método isola a aplicação em um container, ideal para evitar conflitos de dependência.

### Passo 1: Build e Deploy
Na raiz do projeto (onde está o `docker-compose.yml`), execute:

```powershell
docker-compose up -d --build
```

### Passo 2: Verificações
*   O serviço estará rodando na porta **2031** (definida no docker-compose).
*   Acesse o dashboard: `http://localhost:2031`
*   Ver logs em tempo real:
    ```powershell
    docker-compose logs -f
    ```

### Passo 3: Atualização
Para atualizar o container com novas versões do código:
```powershell
git pull
docker-compose up -d --build
```

---

## 5. Monitoramento e Manutenção

### Dashboard de Status
A aplicação expõe um dashboard web leve para verificar a saúde do serviço:
*   **URL:** `http://localhost:2032` (Nativo) ou `http://localhost:2031` (Docker)
*   **Informações:** Status atual (IDLE/RUNNING), Próxima execução programada, Último erro.

### Rotação de Logs
A aplicação gerencia logs automaticamente, mas recomenda-se limpar a pasta `./logs/` e `./screenshots/` periodicamente se o espaço em disco for crítico.

### Troubleshooting Comum

**Problema: O navegador não abre ou dá erro de "Browser closed"**
*   **Solução:** Certifique-se que instalou o Chromium (`npx playwright install chromium`) e que a variável `HEADLESS=true` está setada no `.env`. Serviços Windows não podem abrir janelas visíveis (GUI).

**Problema: Erro de Permissão no Windows Service**
*   **Solução:** O serviço roda por padrão como "Local System". Se precisar salvar arquivos em rede, modifique o usuário de logon no `services.msc` > Propriedades > Logon.

**Problema: Porta em uso**
*   **Solução:** Mude a porta no arquivo `.env` (Nativo) ou no `docker-compose.yml` (Docker).
