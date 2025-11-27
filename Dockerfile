# Usa a imagem oficial do Playwright (baseada no Ubuntu Jammy)
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Define o diretório de trabalho
WORKDIR /app

# Define o fuso horário
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Instala curl para healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copia os arquivos de dependência
COPY package.json ./

# Instala as dependências do projeto
RUN npm install

# Instala apenas o navegador Chromium do Playwright
RUN npx playwright install chromium

# Copia o restante do código fonte
COPY . .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar
CMD ["node", "server.js"]