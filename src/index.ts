// src/index.ts
//
// - Evita erros de parse no Telegram usando parse_mode="HTML" + esc().
// - Recebe mensagens via relay por POST /ingest.
// - Faz auto-envio de e-mail (se AUTO_EMAIL_SEND=true) e indica anexo nas DMs.
// - Valida caminho do CV e loga quando o arquivo não está disponível no contêiner.
//
// .env extras úteis:
// DM_REJECTED=true/false
// INCLUDE_JOB_URL_IN_EMAIL=true/false
// AUTO_EMAIL_SEND=true/false
// AUTO_EMAIL_TEMPLATE=padrao|curto|transicao
// INGEST_PORT=3210
import "dotenv/config";
import { Bot, Context } from "grammy";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as nodemailer from "nodemailer";
import type { TransportOptions } from "nodemailer";
import * as crypto from "crypto";
import * as cheerio from "cheerio";
import express from "express";

/* ===================== Perfil (matcher) ===================== */
const ProfileSchema = z.object({
  title: z.string(),
  must: z.object({
    any: z.array(z.string()).default([]),
    all: z.array(z.string()).default([]),
  }),
  related_any: z.array(z.string()).default([]),
  nice_to_have: z.array(z.string()).default([]),
  ban: z.array(z.string()).default([]),
  seniority: z.array(z.string()).default([]),
  contract: z.array(z.string()).default([]),
  location: z.array(z.string()).default([]),
  salary: z.object({
    currency: z.string().default("BRL"),
    min: z.number().optional(),
    max: z.number().optional(),
  }).partial().default({}),
});
type Profile = z.infer<typeof ProfileSchema>;

/* ===================== Env & flags ===================== */
const BOT_TOKEN = process.env.BOT_TOKEN!;
const OWNER_ID = Number(process.env.OWNER_ID || 0);
const REPLY_IN_GROUP = String(process.env.REPLY_IN_GROUP ?? "false") === "true";
const DEBUG_LOG = String(process.env.DEBUG_LOG ?? "true") === "true";
const ACTIVE_PROFILE = process.env.ACTIVE_PROFILE || "default";

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.OAUTH_USER;
const DEFAULT_SUBJECT_PREFIX = process.env.DEFAULT_SUBJECT_PREFIX || "[Candidatura]";
const SUBJECT_FALLBACK = (process.env.SUBJECT_FALLBACK || "Desenvolvedor(a) Backend").replace(/^"(.*)"$/, "$1");
const CV_PATH = process.env.CV_PATH || "";

const APPEND_SOURCE_IN_EMAIL = String(process.env.APPEND_SOURCE_IN_EMAIL ?? "false") === "true";
const RELATED_TAG_IN_EMAIL  = String(process.env.RELATED_TAG_IN_EMAIL  ?? "false") === "true";
const INCLUDE_JOB_URL_IN_EMAIL = String(process.env.INCLUDE_JOB_URL_IN_EMAIL ?? "true") === "true";

const DM_INCLUDE_URLS = String(process.env.DM_INCLUDE_URLS ?? "true") === "true";
const DM_REJECTED = String(process.env.DM_REJECTED ?? "true") === "true";

const AUTO_EMAIL_SEND = String(process.env.AUTO_EMAIL_SEND ?? "true") === "true";
const AUTO_EMAIL_TEMPLATE = (process.env.AUTO_EMAIL_TEMPLATE as TemplateId | undefined) || "padrao";

const INGEST_PORT = Number(process.env.INGEST_PORT || 3210);

const DEDUP_MODE = (process.env.DEDUP_MODE || "subject_body").toLowerCase() as
  | "subject_body" | "subject" | "to" | "off";
const DEDUP_WINDOW_DAYS = Number(process.env.DEDUP_WINDOW_DAYS || 30);

const LINKS = {
  linkedin: process.env.LINKEDIN_URL || "",
  github: process.env.GITHUB_URL || "",
  phone: process.env.PHONE_BR || "",
};

if (!BOT_TOKEN) throw new Error("BOT_TOKEN ausente no .env");
if (!MAIL_FROM) throw new Error("MAIL_FROM (ou SMTP_USER/OAUTH_USER) ausente no .env");

/* ===================== Bot & perfis ===================== */
const bot = new Bot(BOT_TOKEN);
let currentProfileName = ACTIVE_PROFILE;
const profilesDir = path.join(process.cwd(), "profiles");

/* ===================== Utils ===================== */
function loadProfile(name: string): Profile {
  const file = path.join(profilesDir, `${name}.json`);
  const raw = fs.readFileSync(file, "utf-8");
  return ProfileSchema.parse(JSON.parse(raw));
}
function normalize(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, " ");
}
function toWordSpace(s: string) {
  return normalize(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasTermHaystack(hay: string, term: string) {
  const H = toWordSpace(hay);
  const T = toWordSpace(term);
  if (!T) return false;
  const pat = T.includes(" ") ? `\\b${T.replace(/\s+/g, "\\s+")}\\b` : `\\b${T}\\b`;
  return new RegExp(pat, "i").test(H);
}
function hitAny(hay: string, arr: string[]) { return arr.some(t => hasTermHaystack(hay, t)); }
function hitAll(hay: string, arr: string[]) { return arr.every(t => hasTermHaystack(hay, t)); }

function normSubject(s: string) {
  return normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)]+/gi;
  return Array.from(new Set(text.match(re) || [])).slice(0, 5);
}
function extractEmails(text: string): string[] {
  const raw = text
    .replace(/\[at\]|\(at\)|\sat\s/gi, "@")
    .replace(/\[dot\]|\(dot\)|\sdot\s/gi, ".")
    .replace(/\s+/g, " ");
  const re = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) set.add(m[1].toLowerCase());
  return [...set];
}
function esc(s: string) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ========= Inferência dinâmica do cargo ========= */
function inferRole(raw: string, profile?: Profile): string {
  const t = toWordSpace(raw);
  const rules: Array<{ role: string; all?: RegExp[]; any?: RegExp[] }> = [
    { role: "Full-stack (Node + React)", all: [/node\b|nodejs\b|node\s+js\b|typescript\b|ts\b|javascript\b/, /\breact\b/] },
    { role: "Full-stack (PHP + Vue/React)", all: [/\bphp\b|\blaravel\b|\bsymfony\b/, /\bvue\b|\breact\b/] },
    { role: "Backend (Node/TS)", any: [/node\b|nodejs\b|node\s+js\b|typescript\b|ts\b/] },
    { role: "Backend (PHP/Laravel)", any: [/\bphp\b|\blaravel\b|\bsymfony\b/] },
    { role: "Backend (Java/Spring)", any: [/\bjava\b|\bspring\b|\bkotlin\b/] },
    { role: "Backend (Python/Django)", any: [/\bpython\b|\bdjango\b|\bflask\b/] },
    { role: "Backend (Go)", any: [/\bgo\b|\bgolang\b/] },
    { role: "Backend (.NET/C#)", any: [/\bc#\b|\bdotnet\b|\basp\s*net\b/] },
    { role: "Frontend (React)", any: [/\breact\b/] },
    { role: "Frontend (Vue)", any: [/\bvue\b/] },
    { role: "Frontend (Angular)", any: [/\bangular\b/] },
    { role: "DevOps/Cloud", any: [/\baws\b|\bazure\b|\bgcp\b|\bkubernetes\b|\bdocker\b/] },
    { role: "Mobile (iOS/Android)", any: [/\bios\b|\bandroid\b|\bflutter\b|\breact\s+native\b/] },
  ];
  for (const r of rules) {
    if (r.all && r.all.every((rx) => rx.test(t))) return r.role;
    if (r.any && r.any.some((rx) => rx.test(t))) return r.role;
  }
  if (profile?.title) return profile.title;
  return SUBJECT_FALLBACK;
}

/* ===================== URL enrichment (Open Graph) ===================== */
const HAS_FETCH = typeof (globalThis as any).fetch === "function";
async function fetchWithTimeout(url: string, ms: number) {
  if (!HAS_FETCH) throw new Error("fetch indisponível no runtime");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await (globalThis as any).fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; TelegramJobBot/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}
async function scrapeUrlPreview(url: string): Promise<string | null> {
  try {
    const html = await fetchWithTimeout(url, Number(process.env.URL_SCRAPE_TIMEOUT_MS || 6000));
    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").text() || "";
    const desc =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") || "";
    const out = [title.trim(), desc.trim()].filter(Boolean).join(" — ");
    return out && out.length > 5 ? out : null;
  } catch {
    return null;
  }
}
async function enrichFromUrls(urls: string[]): Promise<string | null> {
  if (String(process.env.URL_SCRAPE ?? "true") !== "true") return null;
  if (!HAS_FETCH || !urls.length) return null;
  const chunks: string[] = [];
  for (const u of urls.slice(0, 2)) {
    const p = await scrapeUrlPreview(u);
    if (p) chunks.push(`🔗 ${u}\n${p}`);
  }
  return chunks.length ? chunks.join("\n") : null;
}

/* ===================== Salário robusto ===================== */
function findSalaryBRL(text: string): number | null {
  const t = text.toLowerCase();
  const re = /(r\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,\.](\d{2}))?\s*(k)?/g;
  const goodCtx = ["sal", "remuner", "pag", "compensa", "fixo", "mensal"];
  const badCtx = ["hora", "/h", "por hora"];

  let best: { val: number; score: number } | null = null;
  let m: RegExpExecArray | null;

  while ((m = re.exec(t))) {
    const hasCurrency = !!m[1];
    const hasK = !!m[4];
    const rawNum = m[2].replace(/[.\s]/g, "");
    let val = parseInt(rawNum, 10);
    if (!Number.isFinite(val)) continue;
    if (hasK) val *= 1000;

    let score = 0;
    if (hasCurrency) score += 3;
    const start = Math.max(0, m.index - 25);
    const end = Math.min(t.length, re.lastIndex + 25);
    const ctx = t.slice(start, end);
    if (goodCtx.some((w) => ctx.includes(w))) score += 2;
    if (badCtx.some((w) => ctx.includes(w))) score -= 3;

    const hadThousands = /\d{1,3}(?:[.\s]\d{3})+/.test(m[2]);
    if (!hasCurrency && !hasK && !hadThousands && val < 1000) continue;

    if (!best || score > best.score || (score === best.score && val > best.val)) {
      best = { val, score };
    }
  }
  return best ? best.val : null;
}

/* ===================== Scoring ===================== */
function scoreMessage(msg: string, profile: Profile) {
  const n = msg;

  for (const b of profile.ban) {
    if (hasTermHaystack(n, b)) return { matched: false, reason: `banido: ${b}` };
  }
  if (!hitAll(n, profile.must.all)) {
    const missing = profile.must.all.find((x) => !hasTermHaystack(n, x));
    return { matched: false, reason: `faltou obrigatório (all): ${missing}` };
  }
  if (profile.must.any.length > 0 && !hitAny(n, profile.must.any)) {
    if (profile.related_any.length && hitAny(n, profile.related_any)) {
      const salary = findSalaryBRL(msg);
      if (profile.salary?.min && salary !== null && salary < profile.salary.min!) {
        return { matched: false, reason: `salário (${salary}) < mínimo (${profile.salary.min})` };
      }
      return { matched: true, reason: "relacionada", tier: "related" as const };
    }
    return { matched: false, reason: "nenhum termo obrigatório encontrado" };
  }
  const salary = findSalaryBRL(msg);
  if (profile.salary?.min && salary !== null && salary < profile.salary.min!) {
    return { matched: false, reason: `salário (${salary}) < mínimo (${profile.salary.min})` };
  }
  return { matched: true, reason: "ok", tier: "primary" as const };
}

/* ===================== Mail (SMTP / OAuth2) ===================== */
function createTransport() {
  const oUser = process.env.OAUTH_USER;
  const oClientId = process.env.OAUTH_CLIENT_ID;
  const oClientSecret = process.env.OAUTH_CLIENT_SECRET;
  const oRefresh = process.env.OAUTH_REFRESH_TOKEN;

  if (oUser && oClientId && oClientSecret && oRefresh) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: oUser,
        clientId: oClientId,
        clientSecret: oClientSecret,
        refreshToken: oRefresh,
      },
    } as TransportOptions);
  }
  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE ?? "false") === "true";
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASS!;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/** Retorna o caminho do anexo se existir/acessível, senão null, e loga o motivo. */
function getAttachmentPath(): string | null {
  if (!CV_PATH) {
    if (DEBUG_LOG) console.warn("[CV] CV_PATH vazio — e-mail irá sem anexo.");
    return null;
  }
  try {
    if (fs.existsSync(CV_PATH)) return CV_PATH;
    if (DEBUG_LOG) console.warn(`[CV] Arquivo não encontrado em ${CV_PATH}. Monte o volume no contêiner e ajuste o .env.`);
    return null;
  } catch (e) {
    if (DEBUG_LOG) console.warn(`[CV] Falha ao acessar ${CV_PATH}:`, e);
    return null;
  }
}
function hasAttachment() { return !!getAttachmentPath(); }

/* ===================== Templates ===================== */
type TemplateId = "padrao" | "curto" | "transicao";
const TEMPLATE_LABEL: Record<TemplateId, string> = {
  padrao: "Padrão",
  curto: "Curto",
  transicao: "Transição",
};
function makeSubject(role: string) {
  return `${DEFAULT_SUBJECT_PREFIX} ${role || SUBJECT_FALLBACK} — Thiago Rossato`;
}
function maybeRefLine(jobUrl?: string) {
  return jobUrl && INCLUDE_JOB_URL_IN_EMAIL ? `\nReferência da vaga: ${jobUrl}\n` : "";
}
function bodyPadrao(role: string, source?: string, jobUrl?: string) {
  return `
Olá,

Vi a oportunidade de ${role}${source ? ` (${source})` : ""} e gostaria de me candidatar.${maybeRefLine(jobUrl)}
Tenho experiência com Node.js/TypeScript, Nest/Express, PostgreSQL, Redis, RabbitMQ e Docker. Atuei em projetos de alta disponibilidade no TJRN (Spring Boot) e em produto SaaS esportivo (Laravel/Node), lidando com picos de tráfego e integrações complexas.

Links:
- LinkedIn: ${LINKS.linkedin}
- GitHub: ${LINKS.github}
- Contato: ${LINKS.phone}

Em anexo, segue meu CV em PDF.

Obrigado pelo retorno,
Thiago Rossato
  `.trim();
}
function bodyCurto(role: string, source?: string, jobUrl?: string) {
  return `
Olá, tudo bem?

Vi a vaga ${role}${source ? ` (${source})` : ""} e tenho interesse.${maybeRefLine(jobUrl)}
Experiência: Node.js/TypeScript (Nest/Express), Postgres, Redis, RabbitMQ, Docker. Disponível PJ remoto.

LinkedIn: ${LINKS.linkedin}
GitHub: ${LINKS.github}
Contato: ${LINKS.phone}

CV em anexo.
Obrigado!
  `.trim();
}
function bodyTransicao(role: string, source?: string, jobUrl?: string) {
  return `
Olá,

Vi a vaga ${role}${source ? ` (${source})` : ""}.${maybeRefLine(jobUrl)}
Tenho base sólida em Node.js/TypeScript e também experiência com PHP/Laravel e Java/Spring, o que ajuda em integrações e migrações entre stacks. 
Foco atual: backend com boas práticas (testes, clean architecture, mensageria, observabilidade).

LinkedIn: ${LINKS.linkedin}
GitHub: ${LINKS.github}
Contato: ${LINKS.phone}

CV em anexo. Obrigado!
  `.trim();
}
function makeHtml(text: string) {
  return `<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${text.replace(/\n/g,"<br/>")}</div>`;
}
function buildEmail(template: TemplateId, role: string, source?: string, jobUrl?: string) {
  const subject = makeSubject(role);
  const text =
    template === "curto" ? bodyCurto(role, source, jobUrl)
    : template === "transicao" ? bodyTransicao(role, source, jobUrl)
    : bodyPadrao(role, source, jobUrl);
  const html = makeHtml(text);
  return { subject, text, html, template };
}

/* ===================== Deduplicação ===================== */
const DATA_DIR = path.join(process.cwd(), "data");
const SENT_LOG_FILE = path.join(DATA_DIR, "sent-log.json");
type SentRecord = {
  to: string;
  subjectSha: string;
  bodySha: string;
  subject: string;
  template: TemplateId;
  subjectNorm?: string;
  date: string;
};
let sentLog: SentRecord[] = [];
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SENT_LOG_FILE)) fs.writeFileSync(SENT_LOG_FILE, "[]");
}
function loadSentLog() {
  ensureDataFile();
  try { sentLog = JSON.parse(fs.readFileSync(SENT_LOG_FILE, "utf-8")); }
  catch { sentLog = []; }
}
function saveSentLog() { fs.writeFileSync(SENT_LOG_FILE, JSON.stringify(sentLog, null, 2)); }
function sha(s: string) { return crypto.createHash("sha256").update(s).digest("hex"); }
function withinWindow(dateIso: string) {
  const diff = Date.now() - new Date(dateIso).getTime();
  return diff <= DEDUP_WINDOW_DAYS * 86400000;
}
function getHistory(to: string) {
  return sentLog
    .filter((r) => r.to === to && withinWindow(r.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}
function findDuplicateSmart(to: string, subject: string, body: string) {
  if (DEDUP_MODE === "off") return null;
  const sSha = sha(subject), bSha = sha(body);
  const sNorm = normSubject(subject);
  const candidates = getHistory(to);
  if (DEDUP_MODE === "subject_body") {
    return candidates.find((r) => r.subjectSha === sSha && r.bodySha === bSha) || null;
  }
  if (DEDUP_MODE === "subject") {
    return candidates.find((r) => (r.subjectNorm ?? normSubject(r.subject)) === sNorm) || null;
  }
  return candidates[0] || null;
}
function recordSent(to: string, subject: string, body: string, template: TemplateId) {
  sentLog.push({
    to, subjectSha: sha(subject), bodySha: sha(body), subject, template,
    subjectNorm: normSubject(subject), date: new Date().toISOString(),
  });
  saveSentLog();
}

/* ===================== Envio ===================== */
async function sendBuiltEmail(
  to: string,
  email: { subject: string; text: string; html: string },
  template: TemplateId
) {
  const transporter = createTransport();
  const cv = getAttachmentPath();
  const attachments = cv ? [{ filename: path.basename(cv), path: cv }] : undefined;
  const info = await transporter.sendMail({
    from: MAIL_FROM, to, subject: email.subject, text: email.text, html: email.html, attachments
  });
  recordSent(to, email.subject, email.text, template);
  return info.messageId;
}

/* ============ Helpers de DM em HTML ============ */
function formatHistoryHtml(items: SentRecord[]) {
  if (!items.length) return "— sem envios anteriores nesta janela —";
  return items.map(i => `• ${esc(new Date(i.date).toLocaleString())} — ${esc(TEMPLATE_LABEL[i.template])} — “${esc(i.subject)}”`).join("\n");
}

/* ============ Núcleo: processa texto vindo do Relay OU do listener tradicional ============ */
async function processExternal(text: string, source?: string, urls?: string[], originLink?: string) {
  const profile = loadProfile(currentProfileName);

  const og = await enrichFromUrls(urls || extractUrls(text));
  const fullText = og ? `${text}\n\n${og}` : text;

  const res = scoreMessage(fullText, profile);
  const linksBlock = DM_INCLUDE_URLS && (urls?.length || 0) > 0
    ? `\n\n🔗 Links:\n${(urls || []).map(u => `• ${u}`).join("\n")}` : "";
  const originLine = originLink ? `\n🧷 Mensagem: ${originLink}` : "";

  if (!res.matched) {
    if (OWNER_ID && DM_REJECTED) {
      await bot.api.sendMessage(
        OWNER_ID,
        `🚫 Vaga rejeitada — motivo: ${esc(res.reason)}${esc(originLine)}`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  const emails = extractEmails(fullText);
  const jobUrl = (urls && urls.length > 0) ? urls[0] : undefined;

  if (OWNER_ID) {
    const tag = (res as any).tier === "related" ? "⚠️ Vaga relacionada" : "✅ Vaga compatível";
    const body = fullText.length > 900 ? fullText.slice(0,900) + "..." : fullText;
    const header = `${tag} com <b>${esc(profile.title)}</b>${originLine}\n———\n`;
    await bot.api.sendMessage(OWNER_ID, header + esc(body) + linksBlock, { parse_mode: "HTML" });
  }

  if (emails.length && AUTO_EMAIL_SEND) {
    const inferredRole = inferRole(fullText, profile);
    const tier = (res as any).tier || "primary";
    const roleForEmail =
      RELATED_TAG_IN_EMAIL && tier === "related" ? `${inferredRole} (relacionada)` : inferredRole;
    const sourceForEmail = APPEND_SOURCE_IN_EMAIL ? source : undefined;
    const emailBuilt = buildEmail(AUTO_EMAIL_TEMPLATE, roleForEmail, sourceForEmail, jobUrl);

    const dup = findDuplicateSmart(emails[0], emailBuilt.subject, emailBuilt.text);
    if (dup) {
      if (OWNER_ID) {
        const msg =
          `📧 Vaga de e-mail — <b>não enviado</b> (duplicado em ${DEDUP_WINDOW_DAYS}d)\n` +
          `Para: ${esc(emails[0])}\nÚltimo assunto: “${esc(dup.subject)}” em ${esc(new Date(dup.date).toLocaleString())}` +
          `${originLine}${linksBlock}\n<b>Anexo:</b> ${hasAttachment() ? "Sim" : "Não"}`;
        await bot.api.sendMessage(OWNER_ID, msg, { parse_mode: "HTML" });
      }
      return;
    }

    try {
      const id = await sendBuiltEmail(emails[0], emailBuilt, AUTO_EMAIL_TEMPLATE);
      if (OWNER_ID) {
        const msg =
          `📧 Vaga de e-mail — <b>enviado automaticamente</b>\n` +
          `Para: ${esc(emails[0])}\n` +
          `Modelo: ${esc(TEMPLATE_LABEL[AUTO_EMAIL_TEMPLATE])}\n` +
          `Assunto: ${esc(emailBuilt.subject)}\n` +
          `Anexo: ${hasAttachment() ? "Sim" : "Não"}\n` +
          `Msg-ID: ${esc(id)}${originLine}${linksBlock}\n\n` +
          `<b>Prévia:</b>\n${esc(emailBuilt.text)}`;
        await bot.api.sendMessage(OWNER_ID, msg, { parse_mode: "HTML" });
      }
    } catch (e: any) {
      if (OWNER_ID) {
        await bot.api.sendMessage(
          OWNER_ID,
          `📧 Vaga de e-mail — <b>falha no envio</b>\nPara: ${esc(emails[0])}\nErro: ${esc(String(e?.message || e))}${originLine}${linksBlock}`,
          { parse_mode: "HTML" }
        );
      }
    }
    return;
  }

  if (OWNER_ID) {
    await bot.api.sendMessage(
      OWNER_ID,
      `🔗 Vaga de link (sem e-mail detectado)${originLine}${linksBlock}`,
      { parse_mode: "HTML" }
    );
  }
}

/* ===================== Comandos ===================== */
bot.command("start", async (ctx) => {
  await ctx.reply(`Seu chat id: ${ctx.from?.id}`, { parse_mode: "HTML" });
});
bot.command("setprofile", async (ctx) => {
  const name = ctx.match?.toString().trim();
  if (!name) return ctx.reply("Uso: /setprofile &lt;nome&gt;", { parse_mode: "HTML" });
  try { loadProfile(name); currentProfileName = name; await ctx.reply(`Perfil ativo: ${esc(name)}`, { parse_mode: "HTML" }); }
  catch (e: any) { await ctx.reply(`Erro ao carregar: ${esc(e.message)}`, { parse_mode: "HTML" }); }
});
bot.command("showprofile", async (ctx) => {
  try {
    const p = loadProfile(currentProfileName);
    const msg =
      `<b>Perfil:</b> ${esc(currentProfileName)}\n` +
      `<b>Título:</b> ${esc(p.title)}\n` +
      `<b>Must.any:</b> ${esc(p.must.any.join(", ") || "-")}\n` +
      `<b>Related.any:</b> ${esc(p.related_any.join(", ") || "-")}\n` +
      `<b>Ban:</b> ${esc(p.ban.join(", ") || "-")}\n` +
      `<b>Salário min:</b> ${esc(String(p.salary.min ?? "-"))}`;
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (e: any) { await ctx.reply(`Erro: ${esc(e.message)}`, { parse_mode: "HTML" }); }
});

/* ===================== Listener tradicional ===================== */
function extractMessageText(ctx: Context): string | null {
  const m = ctx.message ?? ctx.editedMessage ?? ctx.channelPost ?? ctx.editedChannelPost;
  if (!m) return null;
  const parts: string[] = [];
  if ("text" in m && m.text) parts.push(m.text);
  if ("caption" in m && m.caption) parts.push(m.caption);
  return parts.length ? parts.join("\n") : null;
}
bot.on(["message", "edited_message", "channel_post", "edited_channel_post"], async (ctx) => {
  try {
    const text = extractMessageText(ctx);
    if (!text) return;
    const source = ("title" in (ctx.chat ?? {}) ? (ctx.chat as any).title : ctx.chat?.id)?.toString();
    await processExternal(text, source, extractUrls(text), undefined);
  } catch (e) { if (DEBUG_LOG) console.error(e); }
});

/* ===================== Express: /ingest (relay) ===================== */
const app = express();
app.use(express.json({ limit: "512kb" }));
app.post("/ingest", async (req, res) => {
  try {
    const { text, source, urls, origin } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json({ ok: false, error: "text obrigatório" });
    await processExternal(
      text,
      typeof source === "string" ? source : undefined,
      Array.isArray(urls) ? urls : undefined,
      typeof origin === "string" ? origin : undefined
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error("INGEST ERR:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ===================== Bootstrap ===================== */
async function main() {
  ensureDataFile(); loadSentLog();
  await bot.api.deleteWebhook().catch(()=>{});
  const me = await bot.api.getMe();
  console.log(`Logado como @${me.username} (id: ${me.id}) | perfil ativo: ${currentProfileName}`);
  app.listen(INGEST_PORT, () => console.log(`Ingest HTTP ouvindo em :${INGEST_PORT}/ingest`));
  await bot.start();
  console.log("Bot rodando…");
}
main().catch(console.error);
