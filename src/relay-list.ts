// src/relay-list.ts
//
// Lista seus diálogos (canais/grupos) com título, @username (se houver) e ID.
// Requer: API_ID, API_HASH, RELAY_SESSION no .env (mesmo usados no relay).
//
// Scripts sugeridos no package.json:
//   "relay:list": "node --experimental-strip-types --no-warnings src/relay-list.ts"
//
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";

const API_ID = Number(process.env.API_ID);
const API_HASH = String(process.env.API_HASH || "");
const RELAY_SESSION = String(process.env.RELAY_SESSION || "");

if (!API_ID || !API_HASH) throw new Error("API_ID/API_HASH ausentes no .env (crie em my.telegram.org).");
if (!RELAY_SESSION) throw new Error("RELAY_SESSION ausente (rode `npm run relay:login`).");

function kind(entity: any) {
  if (entity instanceof Api.Channel) {
    if (entity.megagroup) return "Supergroup";
    if (entity.broadcast) return "Channel";
    return "Channel";
  }
  if (entity instanceof Api.Chat) return "Group";
  if (entity instanceof Api.User) return "User";
  return "Dialog";
}

async function main() {
  const client = new TelegramClient(new StringSession(RELAY_SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  const dialogs = await client.getDialogs({ limit: 200 });
  // Cabeçalho
  console.log("Tipo         | Título                              | @username         | ID");
  console.log("-------------+-------------------------------------+-------------------+-------------------");

  for (const d of dialogs) {
    const e = d.entity as any;
    if (!e) continue;

    // Filtra só grupos/canais (se quiser listar tudo, remova esse if)
    if (!(e instanceof Api.Channel) && !(e instanceof Api.Chat)) continue;

    const type = (kind(e) + "           ").slice(0, 12);
    const title = ((e.title || "") + "                              ").slice(0, 37);
    const username = (e instanceof Api.Channel && e.username ? ("@" + e.username) : "-").padEnd(17, " ");
    const id = String(e.id);

    // Para canais/supergrupos, o ID real que usamos costuma ser "-100" + id
    const fullId = (e instanceof Api.Channel) ? `-100${id}` : id;

    console.log(`${type} | ${title} | ${username} | ${fullId}`);
  }

  console.log("\nDica:");
  console.log("- Se houver @username, use ele em WATCH_CHATS (ex.: @meugrupo).");
  console.log("- Se NÃO houver @username (privado), use o ID (geralmente -100XXXXXXXXXX).");
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
