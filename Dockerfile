# Imagem oficial do Playwright (Ubuntu Jammy)
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

ENV TZ=America/Sao_Paulo
ENV PORT=3000

# Instala curl para healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Dependências
COPY package.json package-lock.json ./
RUN npm ci

# Instala apenas o Chromium do Playwright
RUN npx playwright install chromium

# Código
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]

