# Telegram Job Bot — Guia de Uso (COMPLETÃO)

Este guia explica **passo a passo** como instalar, configurar e operar o seu bot que:

* lê vagas em grupos/canais do Telegram,
* filtra por um **perfil** (stack, contrato, local, salário mínimo…),
* detecta **e-mails** nos anúncios e **envia candidatura automaticamente** (opcional),
* registra **deduplicação** (para não mandar e-mail idêntico para o mesmo destino),
* funciona **mesmo quando o admin bloqueia bots** (usando **relay** via MTProto),
* envia **DMs** (resumos) para você.

Funciona tanto **em Docker** quanto rodando **localmente** com Node.js.

---

## 1) Pré-requisitos

* **Node.js 22+** (se for rodar local)
  Verifique com `node -v`.
* **Docker + docker-compose** (se for rodar em contêiner).
* Uma conta **Gmail** (para enviar e-mails) com:

  * **App Password** (recomendado) **ou**
  * **OAuth2** (caso App Password não esteja disponível).
* Conta **Telegram**:

  * Para o **bot** (BotFather).
  * Para o **relay** (sua conta pessoal), com **API\_ID** e **API\_HASH** do Telegram (my.telegram.org).

---

## 2) Estrutura do Projeto

```
telegram-job-bot/
├─ src/
│  ├─ index.ts              # servidor principal + Telegram Bot + /ingest
│  ├─ relay-login.ts        # login do relay (GramJS)
│  ├─ relay-list.ts         # lista chats disponíveis
│  └─ relay-watch.ts        # observa chats e envia para /ingest
├─ profiles/
│  └─ default.json          # perfil de matching (você pode criar outros)
├─ data/
│  └─ sent-log.json         # histórico de e-mails enviados (autogerado)
├─ assets/
│  └─ CV.pdf                # (opcional) seu currículo
├─ .env                     # configurações (ver abaixo)
├─ package.json
├─ docker-compose.yml
└─ Dockerfile
```

> **Observação:** se você ainda não tem os três arquivos `relay-*.ts`, crie-os a partir das instruções da seção **7. Relay (MTProto)**. O `src/index.ts` já expõe o endpoint `/ingest` para receber mensagens do relay.

---

## 3) Criar o Bot no Telegram (BotFather)

1. No Telegram, procure **@BotFather** e mande `/start`.
2. `/newbot` → defina nome e username (ex.: `@meu_job_bot`).
3. Copie o **BOT\_TOKEN** que o BotFather mostrar.
4. (Opcional) Em grupos/canais onde **bots são permitidos**:

   * Adicione seu bot.
   * Se precisar ler mensagens antigas, verifique **permissões**; por padrão bots só leem **novas** mensagens.
   * Se for grupo "com privacidade" (modo default do Telegram), ele **só** recebe mensagens enviadas **diretamente** (menções, respostas, comandos). Para ler tudo, o admin deve **desativar a privacidade** ou **promover** o bot a admin.
     **Se o admin não permitir** → use o **relay** (seção 7).

---

## 4) Gmail — Envio de E-mails

### Opção A — App Password (recomendado)

1. Ative **2FA** (verificação em duas etapas) na sua conta Google.
2. Acesse **App passwords** e gere uma senha (16 caracteres).
3. Guarde: `SMTP_USER` (seu e-mail), `SMTP_PASS` (app password), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`.

**Exemplo (Gmail):**

* `SMTP_HOST=smtp.gmail.com`
* `SMTP_PORT=465`
* `SMTP_SECURE=true`
* `SMTP_USER=seuemail@gmail.com`
* `SMTP_PASS=xxxxxxxxxxxxxxxx`

### Opção B — OAuth2 (quando não há App Password)

1. Crie um projeto em **Google Cloud Console**.
2. Ative a **Gmail API**.
3. Gere **Client ID** + **Client Secret** (App OAuth).
4. Obtenha **Refresh Token** (via fluxo OAuth offline).
5. Preencha no `.env`: `OAUTH_USER`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REFRESH_TOKEN`.
   Se **todos** estiverem presentes, o bot usará OAuth2; senão, cai no SMTP.

---

## 5) Montar o `.env`

Crie um arquivo `.env` na raiz do projeto (substitua seus valores):

```env
# Telegram Bot
BOT_TOKEN=1234567:ABC...DEF
OWNER_ID=931492018
REPLY_IN_GROUP=false
DEBUG_LOG=true
ACTIVE_PROFILE=default

# Gmail (App Password) - Opção A
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx

# OU Gmail OAuth2 - Opção B (deixe SMTP vazio se usar OAuth)
# OAUTH_USER=seuemail@gmail.com
# OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
# OAUTH_CLIENT_SECRET=xxxxxxxx
# OAUTH_REFRESH_TOKEN=xxxxxxxx

MAIL_FROM="Seu Nome <seuemail@gmail.com>"
DEFAULT_SUBJECT_PREFIX=[Candidatura]
SUBJECT_FALLBACK="Desenvolvedor(a) Backend"

# Anexo (apontar para caminho DENTRO do contêiner)
CV_PATH=/app/assets/CV.pdf

# Links para o corpo do e-mail
LINKEDIN_URL=https://www.linkedin.com/in/seu-perfil/
GITHUB_URL=https://github.com/seuuser
PHONE_BR=+55 11 9 9999-9999

# Comportamento de DM/Email
AUTO_EMAIL_SEND=true
AUTO_EMAIL_TEMPLATE=padrao    # padrao | curto | transicao
APPEND_SOURCE_IN_EMAIL=false  # inclui nome do grupo/canal no corpo do e-mail
RELATED_TAG_IN_EMAIL=false    # adiciona "(relacionada)" no cargo quando for related
INCLUDE_JOB_URL_IN_EMAIL=true # inclui 1º link da vaga no corpo do e-mail
DM_INCLUDE_URLS=true          # DM inclui lista de links extraídos
DM_REJECTED=true              # manda DM curta quando a vaga é rejeitada

# Matching/URL
URL_SCRAPE=true               # tenta enriquecer links (Open Graph)
URL_SCRAPE_TIMEOUT_MS=5000

# Deduplicação de e-mails
DEDUP_MODE=subject            # subject_body | subject | to | off
DEDUP_WINDOW_DAYS=90

# Relay (MTProto) — seção 7
API_ID=00000000
API_HASH=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
RELAY_SESSION=  # preenchido após login
WATCH_CHATS=@vagasa,@meucanal,https://t.me/meucanal  # vírgula separando chats/links
INGEST_URL=http://127.0.0.1:3210/ingest
INGEST_PORT=3210
```

### Sobre `CV_PATH` (anexo)

* **Em Docker**, monte o arquivo/pasta no contêiner e aponte `CV_PATH` para o caminho **interno** (ex.: `/app/assets/CV.pdf`).
* Sem Docker, use o **caminho absoluto** do seu sistema.

---

## 6) Perfil de Matching

Crie/edite `profiles/default.json`:

```json
{
  "title": "Backend TypeScript (Pleno/Sênior) — PJ Remoto (LATAM/BR)",
  "must": {
    "any": ["node", "typescript", "ts", "nest", "express", "fastify"],
    "all": []
  },
  "related_any": ["php", "laravel", "symfony", "lamp", "java", "spring", "spring boot"],
  "nice_to_have": ["aws", "postgres", "postgresql", "redis", "rabbitmq", "docker", "kubernetes"],
  "ban": ["estágio", "estagio", "trainee", "presencial", "voluntário", "voluntario"],
  "seniority": [],
  "contract": ["pj", "remoto", "remote", "híbrido", "hibrido", "clt"],
  "location": ["remoto", "anywhere", "brasil", "latam", "gmt-3", "home office"],
  "salary": { "currency": "BRL", "min": 5000 }
}
```

* `must.any` — pelo menos **um** termo deve estar presente.
* `must.all` — **todos** os termos devem aparecer.
* `related_any` — caso `must.any` falhe, mas uma stack "relacionada" apareça, classifica como **relacionada**.
* `ban` — rejeita se encontrar a palavra/frase (com bordas de palavra).
* `salary.min` — extrator robusto tenta interpretar **R\$**, `k`, milhares etc. (só reprova se detecta número confiável **abaixo** do mínimo).

> Você pode criar outros perfis: `profiles/meunome.json` e trocar com `/setprofile meunome`.

---

## 7) Relay (MTProto) — Quando o admin bloqueia bots

Se o grupo/canal **não permite bots**, rode um **relay** que usa sua **conta pessoal** para:

* **ouvir** os chats de interesse,
* **reenviar** cada mensagem nova para o endpoint `POST /ingest` do `src/index.ts`.

### 7.1 Obter API\_ID e API\_HASH

* Vá em **[https://my.telegram.org](https://my.telegram.org)** → *API Development Tools*.
* Crie um app, copie **API\_ID** e **API\_HASH**.
* Coloque no `.env`.

### 7.2 Scripts do relay

Crie estes arquivos:

**`src/relay-login.ts`** (login e geração do `RELAY_SESSION`):

```ts
import "dotenv/config";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramClient } from "telegram";
import input from "input";
import { Logger } from "telegram/extensions/index.js";

async function main() {
  const API_ID = Number(process.env.API_ID);
  const API_HASH = process.env.API_HASH!;
  Logger.setLevel("info");
  const session = new StringSession("");
  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => await input.text("Telefone (com +55...): "),
    password: async () => await input.text("Senha 2FA (se tiver): "),
    phoneCode: async () => await input.text("Código (SMS/Telegram): "),
    onError: (err) => console.log(err),
  });
  console.log("RELAY_SESSION=", client.session.save());
  await client.disconnect();
}
main();
```

**`src/relay-list.ts`** (lista chats e @usernames/IDs que você pode monitorar):

```ts
import "dotenv/config";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramClient } from "telegram";
import { Api } from "telegram/tl/index.js";

async function main() {
  const API_ID = Number(process.env.API_ID);
  const API_HASH = process.env.API_HASH!;
  const RELAY_SESSION = process.env.RELAY_SESSION!;
  if (!RELAY_SESSION) throw new Error("RELAY_SESSION ausente (rode `npm run relay:login`).");

  const client = new TelegramClient(new StringSession(RELAY_SESSION), API_ID, API_HASH, { connectionRetries: 5 });
  await client.connect();

  const dialogs = await client.getDialogs({});
  console.log("Tipo         | Título                              | @username              | ID");
  console.log("-------------+-------------------------------------+------------------------+-------------------");
  for (const d of dialogs) {
    const ent = d.entity as any;
    const title = (ent.title || ent.firstName || ent.username || "").toString().slice(0, 35).padEnd(35);
    const username = (ent.username ? `@${ent.username}` : "").padEnd(22);
    const id = (ent.id?.toString() || "").padEnd(19);
    let tipo = "Desconhecido";
    if ("megagroup" in ent && ent.megagroup) tipo = "Supergroup";
    else if ("broadcast" in ent && ent.broadcast) tipo = "Canal";
    else if (ent.usernames || ent.username) tipo = "Usuário";
    else if (ent.className === "Chat" || ent.className === "Channel") tipo = ent.className;
    console.log(`${tipo.padEnd(12)}| ${title} | ${username} | ${id}`);
  }

  await client.disconnect();
}
main();
```

**`src/relay-watch.ts`** (observa chats e envia para `/ingest`):

```ts
import "dotenv/config";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramClient } from "telegram";
import { Api } from "telegram/tl/index.js";

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH!;
const RELAY_SESSION = process.env.RELAY_SESSION!;
const WATCH_CHATS = (process.env.WATCH_CHATS || "").split(",").map(s => s.trim()).filter(Boolean);
const INGEST_URL = process.env.INGEST_URL!;

if (!RELAY_SESSION) throw new Error("RELAY_SESSION ausente. Rode `npm run relay:login`.");
if (!WATCH_CHATS.length) throw new Error("WATCH_CHATS vazio.");

function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)]+/gi;
  return Array.from(new Set(text.match(re) || [])).slice(0, 5);
}

async function sendIngest(payload: any) {
  await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function main() {
  const client = new TelegramClient(new StringSession(RELAY_SESSION), API_ID, API_HASH, { connectionRetries: 5 });
  await client.connect();

  const resolved: any[] = [];
  for (const chat of WATCH_CHATS) {
    try {
      const res = await client.getEntity(chat);
      resolved.push(res);
      console.log("Watching:", chat, "->", res?.id?.toString());
    } catch (e) {
      console.warn("Falha ao resolver", chat, e);
    }
  }

  client.addEventHandler(async (update) => {
    try {
      if (!(update instanceof Api.UpdateNewMessage)) return;
      const message: any = update.message;
      if (!message || !message.message) return;

      const peer = message.peerId;
      const chatId = (peer.userId || peer.channelId || peer.chatId)?.toString();
      const isWatched = resolved.some((r: any) => r.id?.toString() === chatId);
      if (!isWatched) return;

      const text = message.message.toString();
      const urls = extractUrls(text);

      // origin link (só funciona para canais/grupos públicos com username)
      let origin = "";
      try {
        const ent = await client.getEntity(peer);
        if ((ent as any).username) {
          const mid = message.id?.toString();
          origin = `https://t.me/${(ent as any).username}/${mid}`;
        }
      } catch {}

      await sendIngest({ text, source: chatId, urls, origin });
    } catch (e) {
      console.error("Relay handler err:", e);
    }
  });

  console.log("Relay ativo. Aguardando mensagens…");
}

main().catch(console.error);
```

### 7.3 Scripts no `package.json`

Adicione:

```json
{
  "scripts": {
    "dev": "node --experimental-strip-types --no-warnings --watch src/index.ts",
    "start": "node --experimental-strip-types --no-warnings src/index.ts",
    "relay:login": "node --experimental-strip-types --no-warnings src/relay-login.ts",
    "relay:list": "node --experimental-strip-types --no-warnings src/relay-list.ts",
    "relay:watch": "node --experimental-strip-types --no-warnings src/relay-watch.ts"
  }
}
```

### 7.4 Fluxo de uso do relay

1. `npm run relay:login` → siga o fluxo (telefone, código, 2FA). Copie o `RELAY_SESSION=` impresso e cole no `.env`.
2. `npm run relay:list` → veja os chats, pegue os **@usernames** ou **IDs**.
3. Em `.env`, defina `WATCH_CHATS=@grupo1,@canal2,https://t.me/...` (vírgula separando).
4. `npm run relay:watch` → começa a enviar mensagens novas para `INGEST_URL`.

> **Dica:** Se o chat é público com username, o relay manda um `origin` clicável (ex.: `https://t.me/grupo/12345`) que o bot inclui na DM.

---

## 8) Rodar em Docker

### `docker-compose.yml` (exemplo)

```yaml
services:
  telegram-bot:
    build: .
    container_name: telegram-job-bot
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data:rw
      - ./profiles:/app/profiles:ro
      - ./assets:/app/assets:ro     # <-- monte seu CV aqui (CV_PATH=/app/assets/CV.pdf)
    networks:
      - bot-network
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Bot is running')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  bot-network:
    driver: bridge
```

### Comandos Docker

#### **Opção A: Script de inicialização (Recomendado)**

```bash
# Primeira execução - construir imagem
./start.sh build

# Iniciar o bot
./start.sh start

# Ver logs em tempo real
./start.sh logs

# Parar o bot
./start.sh stop

# Ver status do container
./start.sh status

# Atualizar código e reiniciar
./start.sh update

# Reconstruir imagem (força rebuild)
./start.sh rebuild
```

#### **Opção B: Docker Compose direto**

```bash
# Construir e iniciar em background
docker compose up -d

# Ver logs em tempo real
docker compose logs -f

# Ver logs das últimas 100 linhas
docker compose logs --tail=100

# Parar todos os serviços
docker compose down

# Parar e remover volumes
docker compose down -v

# Reconstruir imagem (força rebuild)
docker compose build --no-cache

# Reconstruir e reiniciar
docker compose up -d --build

# Ver status dos serviços
docker compose ps

# Executar comando no container
docker compose exec telegram-bot sh

# Ver uso de recursos
docker stats telegram-job-bot
```

#### **Opção C: Docker CLI direto**

```bash
# Construir imagem
docker build -t telegram-job-bot .

# Executar container
docker run -d \
  --name telegram-job-bot \
  --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/data:/app/data:rw \
  -v $(pwd)/profiles:/app/profiles:ro \
  -v $(pwd)/assets:/app/assets:ro \
  -p 3210:3210 \
  telegram-job-bot

# Ver logs
docker logs -f telegram-job-bot

# Parar container
docker stop telegram-job-bot

# Remover container
docker rm telegram-job-bot

# Ver imagens
docker images | grep telegram-job-bot

# Limpar imagens não utilizadas
docker image prune -f
```

### Build & Run

```bash
# Construir imagem
docker compose build

# Iniciar em background
docker compose up -d

# Ver logs
docker compose logs -f telegram-job-bot

# Verificar status
docker compose ps
```

Você verá:

```
Logado como @seu_bot (id: ...) | perfil ativo: default
Ingest HTTP ouvindo em :3210/ingest
Bot rodando…
```

> O relay roda **fora** do contêiner por padrão (`npm run relay:watch`). Se quiser, você também pode dockerizar o relay em um serviço separado.

---

## 9) Rodar local (sem Docker)

```bash
npm install
cp .env.example .env  # se tiver um exemplo
# edite o .env
npm run dev           # hot reload
# ou
npm start
```

Endpoint `/ingest`:

```bash
curl -X POST http://127.0.0.1:3210/ingest \
  -H 'content-type: application/json' \
  -d '{"text":"Vaga Node. Envie CV para foo@bar.com","source":"@grupo","urls":["https://site.com/vaga"]}'
```

---

## 10) Como usar (no Telegram)

* **/start** → mostra seu chat id.
* **/setprofile nome** → troca para `profiles/nome.json`.
* **/showprofile** → mostra resumo do perfil ativo.

### Fluxo de mensagens

* **Vaga compatível**: você recebe **DM curta** com um trecho da vaga.

  * Se tiver **e-mail** e `AUTO_EMAIL_SEND=true` → o bot **envia automaticamente** usando o **modelo** definido em `AUTO_EMAIL_TEMPLATE`.
  * DM informa: para quem foi enviado, modelo, assunto, **Anexo: Sim/Não** e uma **prévia** do corpo.
* **Vaga com link** (sem e-mail) → DM "🔗 Vaga de link".
* **Vaga rejeitada**: DM **curta** com motivo (pode desligar com `DM_REJECTED=false`).

### Deduplicação

* Controlada por:

  * `DEDUP_MODE` = `subject_body` | `subject` | `to` | `off`
  * `DEDUP_WINDOW_DAYS`
* Histórico em `data/sent-log.json` (autogerenciado).

---

## 11) Dicas para Ajustar o Matching

* O bot usa **bordas de palavra** e normalização.
  Ex.: `"java"` não casa com `"javascript"` (bom para evitar falsos positivos).
* Use listas:

  * `must.any` com palavras **do seu stack**.
  * `related_any` para stacks **próximos** (classifica como **relacionada**).
  * `ban` para palavras que você **não quer** (ex.: "presencial", "estágio"…).
* `salary.min`: só reprova quando consegue extrair um valor confiável **abaixo** do mínimo.
  Se a vaga **não menciona salário**, ela **não é reprovada por isso**.

---

## 12) Personalização de E-mail

* Modelos: `padrao`, `curto`, `transicao`.
  Configure `AUTO_EMAIL_TEMPLATE`.
* `APPEND_SOURCE_IN_EMAIL=true` → acrescenta `(nome do grupo)` após o cargo.
* `RELATED_TAG_IN_EMAIL=true` → se classificada como "relacionada", adiciona "(relacionada)" no cargo.
* `INCLUDE_JOB_URL_IN_EMAIL=true` → inclui **1º link** detectado no corpo do e-mail.
* **Anexo**: `CV_PATH` (ver seção 5). O bot indica **"Anexo: Sim/Não"** nas DMs.

---

## 13) Segurança & Boas Práticas

* **NUNCA** comite `.env` nem `data/sent-log.json`.
* Proteja `RELAY_SESSION`, `SMTP_PASS`, tokens OAuth.
* Respeite termos de uso de plataformas (ex.: LinkedIn) ao seguir links.

---

## 14) Erros Comuns & Soluções

* **`can't parse entities`**: usar `parse_mode: "HTML"` (o projeto já faz isso) e **escapar** com `esc()`.
  E-mails com `_` não quebram mais.
* **Anexo não vai**: o caminho do `CV_PATH` **não existe no contêiner**.
  Monte `./assets:/app/assets:ro` e use `CV_PATH=/app/assets/CV.pdf`.
* **Falha SMTP (`Invalid login`)**: verifique `SMTP_USER/PASS`.
  Se 2FA ativa, o **PASS deve ser App Password**, não sua senha normal.
* **Limites do Gmail**: contas novas têm restrições. Evite bursts.
* **Relay não recebe**: confira `WATCH_CHATS` (use `relay:list`), verifique se o chat é o correto e se a conta do relay **tem acesso**.
  `INGEST_URL` deve estar acessível (localhost/porta).
* **Grupo não permite bot**: use **relay** (seção 7).

---

## 15) Testes Rápidos

* **DM**: mande pra você mesmo uma mensagem com e-mail e veja o envio automático.
* **curl**: simule o relay com `/ingest` (seção 9).
* **Dedup**: mande duas vezes com o mesmo assunto/corpo → a segunda deve **bloquear** (conforme `DEDUP_MODE`).

---

## 16) FAQ

**Q:** Ele lê mensagens antigas?
**A:** Não. Nem o Bot API nem o relay varrem histórico por padrão — só **novas** mensagens.

**Q:** Posso ouvir **vários** grupos/canais?
**A:** Sim. Em `WATCH_CHATS` use vírgula para separar: `@grupo1,@canal2,https://t.me/...`.

**Q:** Como mudar de perfil?
**A:** Crie `profiles/meu.json` e rode `/setprofile meu`.

**Q:** Como incluir link clicável da mensagem original?
**A:** Para **canais/grupos públicos** com username, o relay envia `origin` (ex.: `https://t.me/grupo/12345`), e o bot mostra na DM.

---

## 17) Comandos Úteis

### **Local (Node.js)**

```bash
# Instalar dependências
npm install

# Desenvolvimento com hot reload
npm run dev

# Produção
npm start

# Relay
npm run relay:login
npm run relay:list
npm run relay:watch
```

### **Docker (Recomendado)**

```bash
# Script de gerenciamento
./start.sh build      # Primeira execução
./start.sh start      # Iniciar
./start.sh logs       # Ver logs
./start.sh stop       # Parar
./start.sh status     # Status
./start.sh update     # Atualizar
./start.sh rebuild    # Reconstruir
```

### **Docker Compose direto**

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

### **Docker CLI direto**

```bash
# Construir
docker build -t telegram-job-bot .

# Executar
docker run -d --name telegram-job-bot --env-file .env -v $(pwd)/data:/app/data:rw telegram-job-bot

# Logs
docker logs -f telegram-job-bot

# Parar
docker stop telegram-job-bot
```


