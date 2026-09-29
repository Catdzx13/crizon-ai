/** UI kit zero-dep: menu chọn (mũi tên/số), search-select, nhập ẩn, spinner, markdown. */
import readline from "node:readline";
import readlinePromises from "node:readline/promises";

import { t } from "./i18n.mjs";

export const SYM = { ok: "✓", warn: "⚠", err: "✗", cur: "❯", on: "●", off: "○" };

export function colorEnabled(stream = process.stdout) {
  return Boolean(stream && stream.isTTY) && !process.env.NO_COLOR;
}
export function paint(enabled, code, text) {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text);
}

/* ------------------------------- markdown ------------------------------- */

function renderInline(line, color) {
  let s = line;
  s = s.replace(/`([^`]+)`/g, (_, t) => paint(color, 36, t));
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => paint(color, 1, t));
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, (_, p, t) => `${p}${paint(color, 3, t)}`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => `${txt} ${paint(color, 2, `<${url}>`)}`);
  return s;
}

function renderMdLine(line, state, color) {
  const trimmed = line.trim();
  if (trimmed.startsWith("```")) {
    state.inFence = !state.inFence;
    return paint(color, 2, "─".repeat(28));
  }
  if (state.inFence) return paint(color, 32, `  ${line}`);
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) return paint(color, "1;4", h[2]);
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return paint(color, 2, "─".repeat(28));
  const b = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (b) return `${b[1]}• ${renderInline(b[2], color)}`;
  const q = line.match(/^>\s?(.*)$/);
  if (q) return `${paint(color, 2, "│")} ${renderInline(q[1], color)}`;
  return renderInline(line, color);
}

/** Render markdown thành text terminal (line-based). */
export function renderMarkdown(text, { color = true } = {}) {
  const parts = [];
  const ms = new MarkdownStream({ color, write: (s) => parts.push(s) });
  ms.feed(String(text ?? ""));
  ms.end();
  return parts.join("");
}

/** Stream markdown theo dòng: nhận chunk, render khi đủ dòng. */
export class MarkdownStream {
  constructor({ color = true, write }) {
    this.color = color;
    this.write = write || (() => {});
    this.state = { inFence: false };
    this.buffer = "";
  }
  feed(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.write(renderMdLine(line, this.state, this.color) + "\n");
    }
  }
  end() {
    if (this.buffer.length) {
      this.write(renderMdLine(this.buffer, this.state, this.color));
      this.buffer = "";
    }
  }
}

/* -------------------------------- spinner ------------------------------- */

export function createSpinner(io) {
  const enabled = colorEnabled(io.stdout);
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("");
  let timer = null;
  let i = 0;
  return {
    start() {
      if (!enabled || timer) return;
      io.stdout.write("\x1b[?25l");
      timer = setInterval(() => io.stdout.write(`\r${frames[i++ % frames.length]}`), 80);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      io.stdout.write("\r\x1b[K\x1b[?25h");
    },
  };
}

/* ------------------------------ text prompts ---------------------------- */

/* ------------------------------ line reader ----------------------------- */

const lineReaders = new Map();

/** Reader dùng chung cho 1 stdin: giữ hàng đợi dòng để không mất dữ liệu khi pipe. */
export function createLineReader(io) {
  const key = io?.stdin || null;
  if (!key || typeof io.stdin.on !== "function") {
    return { ask: async () => null, discard() {}, close() {} };
  }
  if (lineReaders.has(key)) return lineReaders.get(key);
  const rl = readlinePromises.createInterface({ input: io.stdin, output: io.stdout });
  const queue = [];
  let waiter = null;
  let closed = false;
  rl.on("line", (line) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  });
  rl.on("close", () => {
    closed = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(null);
    }
  });
  const reader = {
    ask(prompt = "") {
      if (io.stdout?.write) io.stdout.write(prompt);
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
    discard() {
      queue.length = 0;
    },
    close() {
      try {
        rl.close();
      } catch {
        /* ignore */
      }
      lineReaders.delete(key);
    },
  };
  lineReaders.set(key, reader);
  return reader;
}

/** Bỏ các dòng "rác" lọt vào queue trong lúc menu/nhập ẩn dùng raw mode. */
export function discardPendingLines(io) {
  const reader = lineReaders.get(io?.stdin);
  if (reader) reader.discard();
}

export function closeLineReaders() {
  for (const reader of [...lineReaders.values()]) reader.close();
}

export async function askLine(io, prompt = "") {
  return createLineReader(io).ask(prompt);
}

export async function confirm(io, { prompt, defaultYes = true } = {}) {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const ans = (await askLine(io, `${prompt}${suffix}`)).trim().toLowerCase();
  if (!ans) return defaultYes;
  return ans === "y" || ans === "yes" || ans === "c" || ans === "co" || ans === "có";
}

/** Nhập ẩn (cho API key): hiển thị •, Enter xác nhận, Ctrl+C huỷ (trả null). */
export async function inputHidden(io, { prompt = "" } = {}) {
  const stdin = io.stdin;
  const stdout = io.stdout;
  if (!stdin?.isTTY || !stdout?.isTTY) return String((await askLine(io, prompt)) ?? "").trim();
  return new Promise((resolve) => {
    const prevRaw = Boolean(stdin.isRaw);
    readline.emitKeypressEvents(stdin);
    const finish = (value) => {
      stdin.removeListener("keypress", onKey);
      try {
        stdin.setRawMode(prevRaw);
      } catch {
        /* ignore */
      }
      if (!prevRaw) stdin.pause();
      discardPendingLines(io);
      resolve(value);
    };
    let buf = "";
    const onKey = (str, key = {}) => {
      if (key.name === "return") {
        stdout.write("\n");
        finish(buf.trim());
        return;
      }
      if (key.ctrl && key.name === "c") {
        stdout.write("\n");
        finish(null);
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        if (buf.length) {
          buf = buf.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (str && !key.ctrl && !key.meta && key.name !== "escape") {
        buf += str;
        stdout.write("•".repeat(String(str).length));
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
  });
}

/* ------------------------------ list selects ---------------------------- */

export function filterItems(items, query) {
  const q = String(query || "").toLowerCase();
  if (!q) return items.slice();
  const scored = [];
  for (const item of items) {
    const label = String(item?.label ?? item?.id ?? item).toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.includes(q)) score = 1;
    else {
      const words = q.split(/\s+/).filter(Boolean);
      if (words.length && words.every((w) => label.includes(w))) score = 2;
    }
    if (score >= 0) scored.push({ score, item });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}

const itemLabel = (item) => String(item?.label ?? item?.id ?? item ?? "");

const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, "");
}

export function visibleLen(text) {
  return stripAnsi(text).length;
}

/** Khung panel zero-dep: ┌─ title ─┐ / │ nội dung │ / └─┘. */
export function box(title, lines, { width = 0 } = {}) {
  const content = lines.map((line) => String(line));
  const widest = Math.max(...content.map(visibleLen), title ? visibleLen(title) + 2 : 0, 24);
  const inner = Math.max(24, Math.min(width || widest, widest));
  const pad = (line) => {
    const fill = Math.max(0, inner - visibleLen(line));
    return `│ ${line}${" ".repeat(fill)} │`;
  };
  const head = title
    ? `┌─ ${title} ${"─".repeat(Math.max(0, inner - visibleLen(title) - 1))}┐`
    : `┌${"─".repeat(inner + 2)}┐`;
  return [head, ...content.map(pad), `└${"─".repeat(inner + 2)}┘`];
}

/** In panel: TTY vẽ khung, non-TTY chỉ text (spec §4). */
export function panel(io, title, lines = []) {
  if (!io?.stdout?.isTTY) {
    if (title) io.out(title);
    for (const line of lines) io.out(line);
    return;
  }
  const columns = Math.min(Math.max(40, io.stdout.columns || 80), 110);
  const widest = Math.max(...lines.map(visibleLen), title ? visibleLen(title) + 2 : 0, 24);
  for (const line of box(title, lines, { width: Math.min(widest, columns - 6) })) io.out(line);
}

/** Dòng có nền (band) kiểu OpenCode: nội dung + padding tô cùng màu nền. */
export function bandLine(text, width, { bg = 236, fg = null, enabled = true } = {}) {
  const value = String(text ?? "");
  const fill = " ".repeat(Math.max(0, width - visibleLen(value)));
  if (!enabled) return `${value}${fill}`;
  const open = `\u001b[48;5;${bg}m${fg ? `\u001b[38;5;${fg}m` : ""}`;
  return `${open}${value}\u001b[0m\u001b[48;5;${bg}m${fill}\u001b[0m`;
}

async function numberedFallback(io, items, { title }) {
  if (title) io.out(title);
  items.forEach((it, i) => io.out(`  ${i + 1}. ${itemLabel(it)}`));
  const ans = String((await askLine(io, `${items.length}? `)) ?? "").trim();
  const n = Number(ans);
  if (Number.isInteger(n) && n >= 1 && n <= items.length) return { index: n - 1, item: items[n - 1] };
  const idx = items.findIndex((it) => itemLabel(it).toLowerCase() === ans.toLowerCase());
  return idx >= 0 ? { index: idx, item: items[idx] } : null;
}

/**
 * Menu chọn: mũi tên ↑↓ / gõ số / (searchable) gõ để lọc. Esc → null.
 * Non-TTY: in danh sách + nhập số.
 */
export async function select(io, items, { title = "", searchable = false, initial = 0, maxRows = 12 } = {}) {
  const stdin = io.stdin;
  const stdout = io.stdout;
  if (!items.length) return null;
  if (!stdin?.isTTY || !stdout?.isTTY) return numberedFallback(io, items, { title });

  readline.emitKeypressEvents(stdin);
  const prevRaw = Boolean(stdin.isRaw);
  stdout.write("\x1b[?25l");

  let query = "";
  let filtered = items.map((it, i) => ({ it, i }));
  let cursor = Math.min(initial, filtered.length - 1);
  let printed = 0;

  const color = colorEnabled(stdout);
  const draw = () => {
    const columns = Math.min(Math.max(40, stdout.columns || 80), 110);
    const rows = [];
    if (searchable) rows.push(paint(color, 2, `${t("picker.search")}${query}█`));
    const view = filtered.slice(0, maxRows);
    view.forEach((entry, vi) => {
      rows.push(`${vi === cursor ? SYM.cur : " "} ${itemLabel(entry.it)}`);
    });
    if (filtered.length > maxRows) rows.push(paint(color, 2, `… +${filtered.length - maxRows}`));
    rows.push(paint(color, 2, searchable ? t("picker.hint") : t("common.moveHint")));
    const widest = Math.max(...rows.map(visibleLen), title ? visibleLen(title) + 2 : 0, 24);
    const boxed = box(title, rows, { width: Math.min(widest, columns - 6) });
    const cursorLine = 1 + (searchable ? 1 : 0) + cursor;
    if (color && boxed[cursorLine] !== undefined) boxed[cursorLine] = `\u001b[7m${boxed[cursorLine]}\u001b[0m`;
    if (printed > 0) stdout.write(`\x1b[${printed}A`);
    for (const line of boxed) stdout.write(`\x1b[2K${line}\n`);
    printed = boxed.length;
  };

  return new Promise((resolve) => {
    const finish = (value) => {
      stdin.removeListener("keypress", onKey);
      try {
        stdin.setRawMode(prevRaw);
      } catch {
        /* ignore */
      }
      if (!prevRaw) stdin.pause();
      stdout.write("\x1b[?25h");
      discardPendingLines(io);
      resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (key.name === "return") {
        const entry = filtered[cursor];
        finish(entry ? { index: entry.i, item: entry.it } : null);
        return;
      }
      if (key.name === "escape") {
        finish(null);
        return;
      }
      if (key.ctrl && key.name === "c") {
        finish(null);
        return;
      }
      if (key.name === "up") cursor = (cursor - 1 + filtered.length) % filtered.length;
      else if (key.name === "down") cursor = (cursor + 1) % filtered.length;
      else if (key.name === "backspace") {
        if (query.length) query = query.slice(0, -1);
        else finish(null);
      } else if (str && !key.ctrl && !key.meta && str !== "\t") {
        if (searchable) query += str;
        else if (/^[1-9]$/.test(str)) {
          const n = Number(str) - 1;
          if (n < filtered.length) cursor = n;
        }
      }
      if (searchable) {
        filtered = filterItems(items, query).map((it) => ({ it, i: items.indexOf(it) }));
        cursor = Math.min(cursor, Math.max(0, filtered.length - 1));
        if (!filtered.length) cursor = 0;
      }
      draw();
    };
    draw();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
  });
}

/** Select có tìm kiếm (dành cho danh sách model). */
export function searchSelect(io, items, opts = {}) {
  return select(io, items, { ...opts, searchable: true });
}
