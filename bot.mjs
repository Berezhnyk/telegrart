// Telegram pixel-art widget bot. Zero dependencies — Node >= 22.2.
// Run: npm start   (reads TELEGRAM_API_KEY from .env)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { enc, dec } from './src/codec.mjs';
import { applyPayload, blank, toPng } from './src/canvas.mjs';
import { buildWidget } from './src/widget.mjs';

try { process.loadEnvFile(join(import.meta.dirname, '.env')); } catch {}
const TOKEN = process.env.TELEGRAM_API_KEY;
if (!TOKEN) {
  console.error('Missing TELEGRAM_API_KEY (put it in .env)');
  process.exit(1);
}

const widget = buildWidget();
console.log(`widget: ${widget.raw} bytes raw, ${widget.packed}/4096 compressed`);

// ---------- Telegram API ----------
class TgError extends Error {}
async function api(method, params = {}) {
  const body = params instanceof FormData ? params : JSON.stringify(params);
  const headers = params instanceof FormData ? {} : { 'content-type': 'application/json' };
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers, body });
  const json = await res.json();
  if (!json.ok) {
    const err = new TgError(`${method}: ${json.description}`);
    err.retryAfter = json.parameters?.retry_after;
    throw err;
  }
  return json.result;
}

// ---------- Canvas storage: one image per widget message ----------
// The bot is the only writer of a widget's chat_data and there is no API to
// read it back, so the canonical image of every canvas lives here.
const DATA_DIR = join(import.meta.dirname, 'data');
const DB_FILE = join(DATA_DIR, 'canvases.json');
let db = {};
try { db = JSON.parse(readFileSync(DB_FILE, 'utf8')); } catch {}
function persist() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db));
  try { renameSync(tmp, DB_FILE); } catch { writeFileSync(DB_FILE, JSON.stringify(db)); }
}

// ---------- Handlers ----------
const CAPTION = 'Tap a cell to paint · shapes: tap start, then end · ➤ Send gives you a PNG';
// Lets people start a new canvas without typing, so the phone keyboard never opens.
const NEW_BUTTON = { inline_keyboard: [[{ text: '🎨 New canvas', callback_data: 'new' }]] };

async function newCanvas(chatId) {
  try {
    await api('sendWidget', { chat_id: chatId, html: widget.html, allow_queries: true, caption: CAPTION, reply_markup: NEW_BUTTON });
  } catch (e) {
    console.error(e.message);
    await api('sendMessage', {
      chat_id: chatId,
      text: `Couldn't create a canvas: ${e.message.replace(/^\w+: /, '')}\n(Widgets currently work only in a private chat with the bot.)`,
    });
  }
}

async function onMessage(m) {
  const cmd = (m.text || '').split(/[\s@]/)[0];
  if (cmd === '/start') {
    await api('sendMessage', { chat_id: m.chat.id, text: '🎨 Hi! I make pixel-art canvases that live right in the chat. Use /new any time for a fresh one.' });
    return newCanvas(m.chat.id);
  }
  if (cmd === '/new') return newCanvas(m.chat.id);
  if (m.chat.type === 'private') await api('sendMessage', { chat_id: m.chat.id, text: 'Send /new to get a fresh canvas.' });
}

async function onWidgetQuery(q) {
  if (q.type?.type !== 'data') return api('answerWidgetQuery', { widget_query_id: q.id });
  const target = q.inline_message_id
    ? { inline_message_id: q.inline_message_id }
    : { chat_id: q.chat.id, message_id: q.message_id };
  const key = q.inline_message_id || `${q.chat.id}:${q.message_id}`;

  // Everything up to db[key] = next runs synchronously, so concurrent queries can't lose updates.
  const st = dec(db[key]) || blank();
  const before = enc(st.W, st.p);
  let exportPng;
  try {
    exportPng = applyPayload(st, q.data);
  } catch (e) {
    console.warn(`rejected widget query from ${q.from.id}: ${e.message} (${JSON.stringify(q.data)})`);
    return api('answerWidgetQuery', { widget_query_id: q.id, data: before });
  }
  const next = enc(st.W, st.p);
  if (next !== db[key]) { db[key] = next; persist(); }

  // Push the new state to every open copy of the widget, and hand it to the requester.
  await Promise.all([
    next !== before && api('editMessageWidgetData', { ...target, chat_data: next }).catch((e) => console.error(e.message)),
    api('answerWidgetQuery', { widget_query_id: q.id, data: next }),
  ]);

  if (exportPng) {
    const form = new FormData();
    form.append('chat_id', String(q.chat?.id ?? q.from.id));
    form.append('document', new Blob([toPng(st)], { type: 'image/png' }), 'pixel-art.png');
    form.append('caption', `🎨 ${st.W}×${st.W}`);
    if (q.message_id) form.append('reply_parameters', JSON.stringify({ message_id: q.message_id, allow_sending_without_reply: true }));
    await api('sendDocument', form);
  }
}

async function onCallbackQuery(cq) {
  // Answer right away so the button stops showing its loading spinner.
  await api('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  if (cq.data === 'new') await newCanvas(cq.message?.chat?.id ?? cq.from.id);
}

async function handle(u) {
  try {
    if (u.message) await onMessage(u.message);
    else if (u.widget_query) await onWidgetQuery(u.widget_query);
    else if (u.callback_query) await onCallbackQuery(u.callback_query);
  } catch (e) {
    console.error(`update ${u.update_id}:`, e.message);
  }
}

// ---------- Long polling ----------
const me = await api('getMe');
await api('setMyCommands', { commands: [{ command: 'new', description: 'New pixel-art canvas' }] }).catch(() => {});
console.log(`@${me.username} is running — send it /new`);

let offset = 0;
for (;;) {
  try {
    const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'widget_query', 'callback_query'] });
    for (const u of updates) {
      offset = u.update_id + 1;
      handle(u); // not awaited: a slow PNG upload shouldn't stall other users
    }
  } catch (e) {
    console.error(e.message);
    await new Promise((r) => setTimeout(r, (e.retryAfter ?? 3) * 1000));
  }
}
