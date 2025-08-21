// src/relay.ts
//
// Lê mensagens como USUÁRIO (MTProto/GramJS) e repassa para o /ingest do seu bot.
// Suporta múltiplos grupos/canais via WATCH_CHATS e exclusões via WATCH_EXCLUDE.
// Agora envia também "origin" com link para a mensagem original.
//
// .env relevantes:
//   API_ID=...
//   API_HASH=...
//   RELAY_SESSION=...            # gerado pelo relay:login
//   INGEST_URL=http://telegram-job-bot:3210/ingest
//   WATCH_CHATS=@grupo1,@grupo2,-1001234567890
//   WATCH_EXCLUDE=@spamgroup
//   RELAY_DEBUG=true
//
import "dotenv/config";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const API_ID = Number(process.env.API_ID);
const API_HASH = String(process.env.API_HASH || "");
const RELAY_SESSION = String(process.env.RELAY_SESSION || "");

const WATCH_CHATS_RAW = String(process.env.WATCH_CHATS || "");
const WATCH_EXCLUDE_RAW = String(process.env.WATCH_EXCLUDE || "");

const INGEST_URL = process.env.INGEST_URL || "http://127.0.0.1:3210/ingest";
const SHOW_DEBUG = String(process.env.RELAY_DEBUG ?? "true") === "true";

if (!API_ID || !API_HASH) throw new Error("API_ID/API_HASH ausentes.");
if (!RELAY_SESSION) throw new Error("RELAY_SESSION ausente. Rode `npm run relay:login`.");

/** Utilidades para matching de chats **/
type Token = { kind: "id" | "username" | "title" | "star"; value: string };

function normalizeToken(s: string): string {
  return s.trim();
}
function fromTMe(s: string): string | null {
  // transforma t.me/foobar em @foobar (se aplicável)
  const m = s.trim().match(/^https?:\/\/t\.me\/(@?[\w\d_+-]+)(?:\/.*)?$/i);
  if (!m) return null;
  const h = m[1];
  if (h.startsWith("@")) return h;
  if (h.startsWith("+")) return null; // links privados de convite não têm username
  return "@" + h;
}
function parseList(raw: string): Token[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => fromTMe(x) || x)
    .map((x) => normalizeToken(x))
    .map<Token>((x) => {
      if (x === "*" || x.toLowerCase() === "all") return { kind: "star", value: "*" };
      if (x.startsWith("@")) return { kind: "username", value: x.toLowerCase() };
      if (/^-?100\d{5,}$/.test(x) || /^-?\d+$/.test(x)) return { kind: "id", value: x };
      return { kind: "title", value: x.toLowerCase() };
    });
}

const WATCH_CHATS = parseList(WATCH_CHATS_RAW);
const WATCH_EXCLUDE = parseList(WATCH_EXCLUDE_RAW);

function chatIdentifiers(chat: any) {
  // Para channels/supergroups, o ID "completo" usado na API de bots costuma ser "-100" + id
  const isChannel = chat instanceof Api.Channel;
  const idNum = String(chat.id ?? "");
  const idFull = isChannel ? `-100${idNum}` : idNum;

  const username = chat.username ? `@${String(chat.username)}`.toLowerCase() : "";
  const title = String(chat.title || chat.firstName || "").toLowerCase();
  return { idNum, idFull, username, title, isChannel };
}

function tokenMatch(t: Token, ids: { idFull: string; username: string; title: string }): boolean {
  if (t.kind === "star") return true;
  if (t.kind === "id") return t.value === ids.idFull || t.value === String(Number(ids.idFull.replace("-100", "")));
  if (t.kind === "username") return !!ids.username && t.value === ids.username;
  // título: comparação case-insensitive; aceita match exato ou "contém"
  if (t.kind === "title") return !!ids.title && (ids.title === t.value || ids.title.includes(t.value));
  return false;
}

function chatAllowed(chat: any): boolean {
  const ids = chatIdentifiers(chat);

  // Exclude vence sempre
  if (WATCH_EXCLUDE.length && WATCH_EXCLUDE.some((t) => tokenMatch(t, ids))) {
    return false;
  }

  // Se WATCH_CHATS vazio ou contém "*", permite tudo (menos os excluídos)
  if (!WATCH_CHATS.length || WATCH_CHATS.some((t) => t.kind === "star")) {
    return true;
  }

  // Caso contrário, precisa bater em pelo menos um token
  return WATCH_CHATS.some((t) => tokenMatch(t, ids));
}

/** helpers de extração **/
function extractText(msg: Api.Message): string {
  return (msg.message || "").trim();
}
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)]+/gi;
  return Array.from(new Set(text.match(re) || [])).slice(0, 5);
}
function buildOriginLink(chat: any, msgId: number): string {
  const ids = chatIdentifiers(chat);
  if (ids.username) {
    // público: https://t.me/@username/123
    return `https://t.me/${ids.username.replace(/^@/, "")}/${msgId}`;
  }
  if (ids.isChannel) {
    // privado (supergrupo/canal sem username): https://t.me/c/<idNum>/<msgId>
    return `https://t.me/c/${ids.idNum}/${msgId}`;
  }
  // fallback universal (deep link cliente Telegram)
  return `tg://openmessage?chat_id=${ids.idFull}&message_id=${msgId}`;
}

/** post para o /ingest do bot **/
async function postIngest(payload: { text: string; source?: string; urls?: string[]; origin?: string }) {
  await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Cliente MTProto **/
const client = new TelegramClient(new StringSession(RELAY_SESSION), API_ID, API_HASH, {
  connectionRetries: 5,
});

async function main() {
  if (SHOW_DEBUG) {
    const fmt = (arr: Token[]) =>
      arr.length ? arr.map((t) => (t.kind === "star" ? "*" : `${t.kind}:${t.value}`)).join(", ") : "(vazio → todos)";
    console.log("[relay] WATCH_CHATS  =", fmt(WATCH_CHATS));
    console.log("[relay] WATCH_EXCLUDE=", fmt(WATCH_EXCLUDE));
    console.log("[relay] INGEST_URL   =", INGEST_URL);
  }

  console.log("Conectando MTProto (relay)...");
  await client.connect();
  console.log("Relay conectado. Ouvindo mensagens...");

  client.addEventHandler(
    async (ev) => {
      const nm = ev as any as { message?: Api.Message };
      const msg = nm.message;
      if (!msg || !(msg instanceof Api.Message)) return;

      // Ignora mensagens de serviço, joins, etc.
      if (msg instanceof Api.MessageService) return;

      const chat = await msg.getChat();
      if (!chat) return;

      if (!chatAllowed(chat)) {
        if (SHOW_DEBUG) {
          const ids = chatIdentifiers(chat);
          console.log(`[relay][skip] ${ids.username || ids.title || ids.idFull}`);
        }
        return;
      }

      const text = extractText(msg);
      if (!text) return;

      const ids = chatIdentifiers(chat);
      const source = ids.username || (ids.title ? ids.title : ids.idFull);
      const urls = extractUrls(text);
      const origin = buildOriginLink(chat, (msg as any).id || 0);

      if (SHOW_DEBUG) {
        console.log(
          `[relay] ${source}: ${text.slice(0, 140).replace(/\n/g, " ")}${text.length > 140 ? "..." : ""}`
        );
      }

      try {
        await postIngest({ text, source, urls, origin });
      } catch (e) {
        console.error("[relay] Falha ao postar no /ingest:", e);
      }
    },
    new NewMessage({})
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
