/**
 * Composer dính đáy kiểu Gemini CLI / Claude Code:
 *   ╭──────────────────────────────╮
 *   │ ❯ gõ ở đây…                  │
 *   ╰──────────────────────────────╯
 *   model · phiên · ↑↓ lịch sử · /help
 *
 * - erase()/draw() để stream nội dung phía trên mà khung nhập luôn ở đáy.
 * - setBusy(true, text): spinner trong khung khi chờ/đang trả lời.
 * - Chỉ hoạt động khi stdin/stdout là TTY (caller fallback chế độ thường).
 */
import readline from "node:readline";

import { t } from "./i18n.mjs";
import { SYM, bandLine, colorEnabled, paint } from "./ui.mjs";

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("");
const BAND = 236;

export function createComposer(io, { footer = "", meta = "", history = [], placeholder } = {}) {
  const stdin = io.stdin;
  const stdout = io.stdout;
  if (!stdin?.isTTY || !stdout?.isTTY) return null;

  const color = colorEnabled(stdout);
  const state = {
    buffer: "",
    status: "",
    footer,
    meta,
    placeholder: placeholder ?? t("composer.placeholder"),
    busy: false,
    frame: 0,
    timer: null,
    drawn: false,
    lines: 0,
    ctrlCAt: 0,
    hintTimer: null,
    commands: [],
    sugIndex: 0,
  };
  const lines = [...history];
  let index = lines.length;
  let draft = "";

  const width = () => Math.min(Math.max(40, stdout.columns || 80), 110);
  const truncate = (text, size) => (text.length <= size ? text : `…${text.slice(text.length - size + 1)}`);

  function footerText(width) {
    const value = state.footer;
    if (!value) return "";
    const left = typeof value === "string" ? value : value.left ?? "";
    const right = typeof value === "string" ? "" : value.right ?? "";
    const capacity = width - 4;
    const leftShown = left.length > capacity - 12 ? `…${left.slice(-(capacity - 13))}` : left;
    let rightShown = right;
    if (rightShown && leftShown.length + rightShown.length + 2 > capacity) {
      const room = capacity - leftShown.length - 2;
      rightShown = room > 8 ? `…${rightShown.slice(-(room - 1))}` : "";
    }
    const gap = Math.max(1, capacity - leftShown.length - rightShown.length);
    return `  ${leftShown}${" ".repeat(gap)}${rightShown}`;
  }

  /** Gợi ý lệnh khi gõ "/" — lọc theo tiền tố (kiểu autocomplete của TUI Crizon). */
  function activeSuggestions() {
    const query = state.buffer;
    if (!query.startsWith("/") || query.includes(" ") || !state.commands.length) return [];
    const prefix = query.slice(1).toLowerCase();
    return state.commands.filter((command) => command.name.slice(1).toLowerCase().startsWith(prefix));
  }

  function suggestionRows(width) {
    const list = activeSuggestions();
    if (!list.length) return [];
    const maxRows = 10;
    const contentWidth = width - 2;
    const border = paint(color, 36, "┃");
    const start = Math.max(0, Math.min(state.sugIndex - Math.floor(maxRows / 2), list.length - maxRows));
    const view = list.slice(start, start + maxRows);
    const rows = [];
    if (start > 0) rows.push(`${border} ${paint(color, 2, `  … ↑ +${start}`)}`);
    view.forEach((command, offset) => {
      const index = start + offset;
      const label = command.name.padEnd(12);
      let text = `${index === state.sugIndex ? SYM.cur : " "} ${label} ${command.description}`;
      if (text.length > contentWidth - 1) text = `${text.slice(0, contentWidth - 2)}…`;
      const body = index === state.sugIndex
        ? bandLine(text, contentWidth, { bg: 237, enabled: color })
        : text;
      rows.push(`${border} ${body}`);
      if (index === state.sugIndex && command.subtitle) {
        let sub = `  ${command.subtitle}`;
        if (sub.length > contentWidth - 1) sub = `${sub.slice(0, contentWidth - 2)}…`;
        rows.push(`${border} ${paint(color, 2, sub)}`);
      }
    });
    if (start + maxRows < list.length) {
      rows.push(`${border} ${paint(color, 2, `  … ↓ +${list.length - start - maxRows}`)}`);
    }
    return rows;
  }

  function rows() {
    const w = width();
    const contentWidth = w - 2;
    const border = paint(color, 36, "┃");
    const out = [...suggestionRows(w)];
    if (state.busy) {
      const text = truncate(`${SPINNER[state.frame % SPINNER.length]} ${state.status || t("composer.streaming")}`, contentWidth);
      out.push(`${border} ${bandLine("", contentWidth, { bg: BAND, enabled: color })}`);
      out.push(`${border} ${bandLine(text, contentWidth, { bg: BAND, enabled: color })}`);
    } else {
      const empty = !state.buffer;
      const text = state.status
        ? truncate(empty ? `${SYM.cur} ${state.status}` : `${state.buffer}  ${state.status}`, contentWidth)
        : truncate(empty ? `${SYM.cur} ${state.placeholder}` : `${SYM.cur} ${state.buffer}`, contentWidth);
      out.push(`${border} ${bandLine("", contentWidth, { bg: BAND, enabled: color })}`);
      out.push(`${border} ${bandLine(text, contentWidth, { bg: BAND, fg: empty && !state.status ? 245 : null, enabled: color })}`);
    }
    out.push(`${border} ${bandLine(truncate(state.meta, contentWidth), contentWidth, { bg: BAND, fg: 245, enabled: color })}`);
    out.push(paint(color, 36, "╹"));
    const footer = footerText(w);
    if (footer) out.push(paint(color, 2, footer));
    return out;
  }

  function erase() {
    if (!state.drawn) return;
    stdout.write(`\x1b[${state.lines}A\x1b[J`);
    state.drawn = false;
  }

  function draw() {
    erase();
    const out = rows();
    stdout.write(`${out.join("\n")}\n`);
    state.lines = out.length;
    state.drawn = true;
  }

  function stopTimer() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function flashHint(text) {
    state.status = text;
    draw();
    if (state.hintTimer) clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => {
      state.status = "";
      if (!state.busy) draw();
    }, 1600);
  }

  return {
    /** In nội dung (có thể nhiều dòng) phía trên khung nhập. */
    print(text) {
      let output = String(text);
      if (!output) return;
      if (!output.endsWith("\n")) output += "\n";
      erase();
      stdout.write(output);
      draw();
    },
    draw,
    erase,
    setFooter(text) {
      state.footer = text;
      if (state.drawn && !state.busy) draw();
    },
    setMeta(text) {
      state.meta = text;
      if (state.drawn && !state.busy) draw();
    },
    setBusy(busy, status = "") {
      state.busy = busy;
      state.status = busy ? status : "";
      if (busy) {
        if (!state.timer) {
          state.timer = setInterval(() => {
            state.frame += 1;
            if (state.busy) draw();
          }, 90);
          state.timer.unref?.();
        }
      } else {
        stopTimer();
      }
      draw();
    },
    /** Danh sách lệnh cho autocomplete khi gõ "/". */
    setCommands(list) {
      state.commands = Array.isArray(list) ? list : [];
      if (state.drawn && !state.busy) draw();
    },
    /** Đọc 1 dòng; null khi Ctrl+C hai lần. */
    read() {
      state.buffer = "";
      state.status = "";
      state.sugIndex = 0;
      index = lines.length;
      draft = "";
      return new Promise((resolve) => {
        if (typeof stdin.setRawMode === "function") {
          try {
            stdin.setRawMode(true);
          } catch {
            /* ignore */
          }
        }
        stdin.resume?.();
        readline.emitKeypressEvents(stdin);
        const finish = (value) => {
          stdin.removeListener("keypress", onKey);
          resolve(value);
        };
        const onKey = (str, key = {}) => {
          if (key.ctrl && key.name === "c") {
            const now = Date.now();
            if (now - state.ctrlCAt < 1500) {
              erase();
              finish(null);
            } else {
              state.ctrlCAt = now;
              flashHint(t("composer.exitHint"));
            }
            return;
          }
          const suggestions = activeSuggestions();
          if (suggestions.length) {
            if (key.name === "up") {
              state.sugIndex = Math.max(0, state.sugIndex - 1);
              draw();
              return;
            }
            if (key.name === "down") {
              state.sugIndex = Math.min(suggestions.length - 1, state.sugIndex + 1);
              draw();
              return;
            }
            if (key.name === "tab") {
              state.buffer = `${suggestions[state.sugIndex].name} `;
              draw();
              return;
            }
            if (key.name === "return" && !suggestions.some((command) => command.name === state.buffer.trim())) {
              state.buffer = `${suggestions[state.sugIndex].name} `;
              draw();
              return;
            }
          }
          if (key.name === "return") {
            const line = state.buffer.trim();
            if (!line) {
              draw();
              return;
            }
            erase();
            if (line) lines.push(line);
            finish(line);
            return;
          }
          if (key.name === "backspace" || key.name === "delete") {
            state.buffer = state.buffer.slice(0, -1);
            state.sugIndex = 0;
            draw();
            return;
          }
          if (key.name === "up") {
            if (!lines.length) return;
            if (index === lines.length) draft = state.buffer;
            index = Math.max(0, index - 1);
            state.buffer = lines[index] ?? "";
            draw();
            return;
          }
          if (key.name === "down") {
            if (index >= lines.length) return;
            index += 1;
            state.buffer = index === lines.length ? draft : lines[index] ?? "";
            draw();
            return;
          }
          if (key.name === "escape") {
            state.buffer = "";
            state.sugIndex = 0;
            draw();
            return;
          }
          if (str && !key.ctrl && !key.meta && key.name !== "escape") {
            state.buffer += str;
            state.sugIndex = 0;
            draw();
          }
        };
        draw();
        stdin.on("keypress", onKey);
      });
    },
    destroy() {
      stopTimer();
      if (state.hintTimer) clearTimeout(state.hintTimer);
      erase();
      try {
        stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      stdin.pause?.();
    },
    get history() {
      return [...lines];
    },
  };
}
