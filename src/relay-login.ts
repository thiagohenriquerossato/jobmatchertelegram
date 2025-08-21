// src/relay-login.ts
// Gera a RELAY_SESSION da sua conta (MTProto) para usar no relay/list.
// Uso: npm run relay:login → copie o token impresso e cole no .env em RELAY_SESSION=...

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as readline from "node:readline";

const API_ID = Number(process.env.API_ID);
const API_HASH = String(process.env.API_HASH || "");

if (!API_ID || !API_HASH) {
  throw new Error("API_ID/API_HASH ausentes no .env (gere em my.telegram.org → API development tools).");
}

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const session = new StringSession("");
  const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => await ask("Telefone (com +55...): "),
    phoneCode:   async () => await ask("Código enviado pelo Telegram: "),
    password:    async () => await ask("Senha 2FA (se houver; ENTER se não): "),
    onError: (err) => console.error(err),
  });

  console.log("\n✅ Logado com sucesso.");
  const token = client.session.save();
  console.log("\nRELAY_SESSION (cole no seu .env):\n");
  console.log(token);
  console.log("\nPronto. Saindo…");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
