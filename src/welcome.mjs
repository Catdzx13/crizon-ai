/** Màn chào kiểu OpenCode/Gemini CLI: wordmark nửa ô + phiên bản + tips + info phiên. */
import { t } from "./i18n.mjs";
import { colorEnabled, paint } from "./ui.mjs";

// Kiểu OpenCode (packages/tui/src/logo.ts): chữ khối nửa ô 3 dòng, viền dưới ▀▀▀▀.
const FONT_OC = {
  C: ["█▀▀▀", "█___", "▀▀▀▀"],
  R: ["█▀▀▄", "█▀▀_", "▀__▀"],
  I: ["█", "█", "▀"],
  Z: ["▀▀▀▄", "_▄▀_", "▀▀▀▀"],
  O: ["█▀▀█", "█__█", "▀▀▀▀"],
  N: ["█▀▀▄", "█__█", "▀~~▀"],
};

// Kiểu figlet "Big" (truyền thống hơn).
const FONT_BIG = {
  C: ["  ____ ", " / ___|", "| |    ", "| |___ ", " \\____|"],
  R: [" ____  ", "|  _ \\ ", "| |_) |", "|  _ < ", "|_| \\_\\"],
  I: [" ___ ", "|_ _|", " | | ", " | | ", "|___|"],
  Z: [" _____", "|__  /", "  / / ", " / /_ ", "/____|"],
  O: ["  ___  ", " / _ \\ ", "| | | |", "| |_| |", " \\___/ "],
  N: [" _   _ ", "| \\ | |", "|  \\| |", "| |\\  |", "|_| \\_|"],
};

const FONTS = { oc: FONT_OC, big: FONT_BIG };
export const LOGO_STYLES = ["oc", "big", "mark", "off"];

// Gradient chạy ngang: cyan → xanh → tím (kiểu Crush TitleColorA→B).
const COL_RAMP = [51, 50, 49, 48, 45, 39, 33, 63, 99];

function compose(font, word) {
  const rows = Array.from({ length: 5 }, () => "");
  for (const char of word.toUpperCase()) {
    const glyph = font[char] ?? font.I;
    glyph.forEach((line, index) => {
      if (rows[index]) rows[index] += " ";
      rows[index] += line;
    });
  }
  const width = Math.max(...rows.map((line) => line.length));
  return rows.map((line) => line.padEnd(width, " "));
}

export function logoLines(style = "oc", word = "CRIZON") {
  const font = FONTS[style] ?? FONT_OC;
  const rows = compose(font, word);
  return rows.filter((line) => line.trim().length > 0);
}

/** Tô gradient theo cột; shimmer = vị trí (cột) đang được quét sáng. */
export function colorizeLogo(lines, shimmer = null, enabled = true) {
  const width = Math.max(...lines.map((line) => line.length), 1);
  return lines.map((line) => {
    const chars = [...line];
    return chars
      .map((char, index) => {
        if (char === " ") return char;
        const at = width <= 1 ? 0 : Math.round((index / (width - 1)) * (COL_RAMP.length - 1));
        let code = COL_RAMP[at];
        if (shimmer !== null) {
          const distance = Math.abs(index - shimmer);
          if (distance <= 1) code = 231;
          else if (distance <= 3) code = 195;
        }
        return enabled ? `\u001b[38;5;${code}m${char}\u001b[0m` : char;
      })
      .join("");
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function printWelcome(io, { version, model, session, sessionCount = 0, style = "big" }) {
  const color = colorEnabled(io.stdout);
  const count = sessionCount > 0 ? t("welcome.sessionCount", { count: sessionCount }) : "";
  const info = paint(color, 2, t("welcome.info", { model, session, count }));
  const title = paint(color, 1, t("welcome.title", { version }));

  const tail = [];
  if (style !== "mark" && style !== "off") tail.push("", `${title}   ${info}`);
  else tail.push(`${paint(color, 96, "✻")} ${title}   ${info}`);
  tail.push(
    "",
    paint(color, 1, t("welcome.tipsTitle")),
    `1. ${t("welcome.tip1")}`,
    `2. ${t("welcome.tip2")}`,
    `3. ${t("welcome.tip3")}`,
    `4. ${t("welcome.tip4")}`,
    "",
  );

  const logo = style === "mark" || style === "off" ? [] : logoLines(style);
  if (!logo.length) {
    for (const line of tail) io.out(line);
    return;
  }

  // Shimmer chỉ chạy trên terminal thật (không chạy khi test/pipe).
  const live = color && io.stdout?.isTTY && io.stdout === process.stdout;
  if (!live) {
    for (const line of colorizeLogo(logo, null, color)) io.out(line);
    for (const line of tail) io.out(line);
    return;
  }

  const width = logo[0].length;
  for (let frame = -3; frame <= width + 3; frame += 1) {
    if (frame > -3) io.stdout.write(`\x1b[${logo.length}A\x1b[J`);
    io.stdout.write(`${colorizeLogo(logo, frame).join("\n")}\n`);
    await sleep(18);
  }
  for (const line of tail) io.out(line);
}
