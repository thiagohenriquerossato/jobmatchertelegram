# Dockerfile (arquivo completo)
#
# Imagem única para rodar tanto o bot (index.ts) quanto o relay (relay.ts)
# via docker-compose (cada serviço usa um "command" diferente).
#
FROM node:22-alpine

# Instala CA e utilitários básicos (opcional)
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copia apenas package.json/package-lock para aproveitar cache de dependências
COPY package*.json ./

# Instala dependências de produção (suporta executar .ts com --experimental-strip-types)
RUN npm ci --omit=dev

# Copia código-fonte e perfis
COPY src ./src
COPY profiles ./profiles

# Garante que a pasta de dados exista (sent-log.json etc.)
RUN mkdir -p /app/data

# Porta do /ingest (Express) — será usada pelo serviço telegram-bot
EXPOSE 3210

# Comando padrão: bot. (o docker-compose sobrescreve o command quando necessário)
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/index.ts"]
