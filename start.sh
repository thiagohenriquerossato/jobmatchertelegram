#!/bin/bash

# Script para gerenciar o bot do Telegram via Docker

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para mostrar ajuda
show_help() {
    echo "Uso: $0 [comando]"
    echo ""
    echo "Comandos:"
    echo "  start     - Iniciar o bot"
    echo "  stop      - Parar o bot"
    echo "  restart   - Reiniciar o bot"
    echo "  logs      - Mostrar logs do bot"
    echo "  status    - Verificar status do bot"
    echo "  build     - Reconstruir a imagem Docker"
    echo "  update    - Atualizar código e reconstruir"
    echo "  help      - Mostrar esta ajuda"
    echo ""
}

# Função para verificar se o .env existe
check_env() {
    if [ ! -f .env ]; then
        echo -e "${RED}Erro: Arquivo .env não encontrado!${NC}"
        echo "Crie um arquivo .env com as configurações necessárias:"
        echo "BOT_TOKEN=seu_token_aqui"
        echo "OWNER_ID=seu_id_aqui"
        echo "SMTP_HOST=smtp.gmail.com"
        echo "SMTP_USER=seu_email@gmail.com"
        echo "SMTP_PASS=sua_senha_app"
        exit 1
    fi
}

# Função para iniciar o bot
start_bot() {
  echo -e "${GREEN}Iniciando o bot do Telegram...${NC}"
  check_env
  docker compose up -d
  echo -e "${GREEN}Bot iniciado! Use '$0 logs' para ver os logs.${NC}"
}

# Função para parar o bot
stop_bot() {
  echo -e "${YELLOW}Parando o bot...${NC}"
  docker compose down
  echo -e "${GREEN}Bot parado.${NC}"
}

# Função para reiniciar o bot
restart_bot() {
  echo -e "${YELLOW}Reiniciando o bot...${NC}"
  docker compose restart
  echo -e "${GREEN}Bot reiniciado!${NC}"
}

# Função para mostrar logs
show_logs() {
  echo -e "${GREEN}Mostrando logs do bot...${NC}"
  docker compose logs -f
}

# Função para verificar status
check_status() {
  echo -e "${GREEN}Verificando status do bot...${NC}"
  docker compose ps
  echo ""
  echo -e "${GREEN}Logs recentes:${NC}"
  docker compose logs --tail=20
}

# Função para construir imagem
build_image() {
  echo -e "${GREEN}Construindo imagem Docker...${NC}"
  docker compose build --no-cache
  echo -e "${GREEN}Imagem construída com sucesso!${NC}"
}

# Função para atualizar
update_bot() {
    echo -e "${GREEN}Atualizando código e reconstruindo...${NC}"
    git pull origin main
    build_image
    restart_bot
    echo -e "${GREEN}Bot atualizado e reiniciado!${NC}"
}

# Verificar se docker compose está disponível
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Erro: docker compose não está disponível!${NC}"
    echo "Use Docker Desktop ou instale Docker Compose."
    exit 1
fi

# Verificar se Docker está rodando
if ! docker info &> /dev/null; then
    echo -e "${RED}Erro: Docker não está rodando!${NC}"
    echo "Inicie o Docker primeiro."
    exit 1
fi

# Processar comandos
case "${1:-help}" in
    start)
        start_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    logs)
        show_logs
        ;;
    status)
        check_status
        ;;
    build)
        build_image
        ;;
    update)
        update_bot
        ;;
    help|*)
        show_help
        ;;
esac
