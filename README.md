# 🤖 Bot do Telegram para Vagas de Emprego

Bot automatizado que monitora grupos/canais do Telegram em busca de vagas de emprego compatíveis com seu perfil e envia candidaturas automaticamente.

## ✨ Funcionalidades

- 🔍 **Monitoramento automático** de mensagens em grupos/canais
- 🎯 **Filtro inteligente** baseado em perfil configurável
- 📧 **Envio automático** de candidaturas com CV anexado
- 📝 **Templates personalizáveis** (Padrão, Curto, Transição)
- 🚫 **Detecção de duplicatas** para evitar spam
- 📊 **Análise de stack** e informações da vaga
- 🔄 **Notificações** para vagas compatíveis e incompatíveis

## 🚀 Deploy com Docker

### Pré-requisitos

- Docker instalado (versão 20.10+)
- Token do bot do Telegram (via @BotFather)
- Configurações de email SMTP

### 1. Configuração

Crie um arquivo `.env` na raiz do projeto:

```bash
# Bot do Telegram
BOT_TOKEN=123456:ABC...                # Token do @BotFather
OWNER_ID=931492018                     # Seu ID do Telegram

# Comportamento
REPLY_IN_GROUP=false                   # Mudo no grupo
DEBUG_LOG=true                         # Logs detalhados
ACTIVE_PROFILE=default                 # Perfil ativo

# SMTP (Gmail com App Password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx

# Email
MAIL_FROM="Seu Nome <seuemail@gmail.com>"
DEFAULT_SUBJECT_PREFIX=[Candidatura]
CV_PATH=/caminho/para/seu/CV.pdf

# Links
LINKEDIN_URL=https://www.linkedin.com/in/seu-perfil
GITHUB_URL=https://github.com/seu-usuario
PHONE_BR=+55 84 99999-9999
```

### 2. Perfis

Configure seus perfis de busca em `profiles/default.json`:

```json
{
  "title": "Backend TypeScript (Pleno/Sênior) — PJ Remoto",
  "must": {
    "any": ["node", "typescript", "javascript", "backend"],
    "all": ["remoto", "pj"]
  },
  "related_any": ["python", "java", "go", "php"],
  "nice_to_have": ["docker", "aws", "postgresql"],
  "ban": ["frontend", "mobile", "design"],
  "seniority": ["pleno", "senior"],
  "contract": ["pj"],
  "location": ["remoto"],
  "salary": {
    "currency": "BRL",
    "min": 5000
  }
}
```

### 3. Execução

#### Opção A: Script de inicialização (Recomendado)

```bash
# Primeira execução
./start.sh build

# Iniciar o bot
./start.sh start

# Ver logs
./start.sh logs

# Parar o bot
./start.sh stop

# Ver status
./start.sh status

# Atualizar código
./start.sh update
```

#### Opção B: Docker Compose direto

```bash
# Construir e iniciar
docker compose up -d

# Ver logs
docker compose logs -f

# Parar
docker compose down

# Reconstruir
docker compose build --no-cache
```

## 📋 Comandos do Bot

- `/start` - Mostra seu chat ID
- `/setprofile <nome>` - Define perfil ativo
- `/showprofile` - Mostra perfil atual

## 🔧 Desenvolvimento

```bash
# Instalar dependências
npm install

# Executar em modo desenvolvimento
npm run dev

# Compilar TypeScript
npm run build

# Executar produção
npm start
```

## 📁 Estrutura do Projeto

```
telegram-job-bot/
├── src/
│   ├── index.ts          # Bot principal
│   └── mailer.ts         # Configuração de email
├── profiles/
│   └── default.json      # Perfil de busca
├── data/                 # Logs de emails enviados
├── Dockerfile            # Imagem Docker
├── docker-compose.yml    # Orquestração
├── start.sh             # Script de gerenciamento
└── .env                 # Configurações (não versionado)
```

## 🚨 Troubleshooting

### Bot não responde
- Verifique se o token está correto
- Confirme se o bot foi adicionado aos grupos
- Verifique logs com `./start.sh logs`

### Erro de email
- Confirme configurações SMTP
- Para Gmail, use "Senhas de App"
- Verifique se o CV_PATH está correto

### Container não inicia
- Verifique se o Docker está rodando
- Confirme se o arquivo .env existe
- Execute `./start.sh build` primeiro

## 🔒 Segurança

- O bot roda como usuário não-root
- Arquivos sensíveis não são versionados
- Healthcheck monitora o status
- Restart automático em caso de falha

## 📈 Monitoramento

- Logs em tempo real: `./start.sh logs`
- Status do container: `./start.sh status`
- Healthcheck automático a cada 30s
- Restart automático em caso de falha

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo LICENSE para detalhes.

---

**Desenvolvido com ❤️ para automatizar candidaturas e encontrar a vaga dos sonhos!** 🚀
