/**
 * Custom slash commands kiểu TUI Crizon (docs/commands):
 * - File markdown: global `~/.config/opencode/commands/` + `~/.crizon-ai/commands/`,
 *   project `<cwd>/.opencode/commands/` + `<cwd>/.crizon/commands/` (tên file = tên lệnh).
 * - Frontmatter: description, agent, model (agent bỏ qua ở CLI này).
 * - Template hỗ trợ: $ARGUMENTS, $1..$n, !`shell`, @file.
 * - Thêm từ JSON config: `"command": { "test": { "template": "...", "description": "...", "model": "..." } }`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { homeDir } from "./config.mjs";
import { t } from "./i18n.mjs";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_SHELL_BUFFER = 4 * 1024 * 1024;

export function commandDirs(env = process.env, cwd = process.cwd()) {
  const home = env.USERPROFILE || homedir();
  const opencodeConfigDir = env.OPENCODE_CONFIG_DIR
    || join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  return [
    { scope: "global", dir: join(opencodeConfigDir, "commands") },
    { scope: "global", dir: join(homeDir(env), "commands") },
    { scope: "project", dir: join(cwd, ".opencode", "commands") },
    { scope: "project", dir: join(cwd, ".crizon", "commands") },
  ];
}

/** Tách frontmatter `--- ... ---` khỏi template. */
export function parseCommandFile(source) {
  const text = String(source ?? "");
  const meta = {};
  let body = text;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const index = line.indexOf(":");
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && value) meta[key] = value;
    }
  }
  return { meta, body: body.trim() };
}

/** Nạp toàn bộ custom command (config JSON trước, file sau — file project đè global). */
export function loadCustomCommands({ env = process.env, cwd = process.cwd(), configCommands = {} } = {}) {
  const commands = new Map();
  for (const [name, value] of Object.entries(configCommands ?? {})) {
    if (!value || typeof value !== "object" || typeof value.template !== "string") continue;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    commands.set(name, {
      name,
      description: typeof value.description === "string" ? value.description : "",
      template: value.template,
      model: typeof value.model === "string" ? value.model : "",
      scope: "config",
    });
  }
  for (const { scope, dir } of commandDirs(env, cwd)) {
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!/\.md$/i.test(file)) continue;
      const name = file.slice(0, -3);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      const path = join(dir, file);
      try {
        if (statSync(path).size > MAX_FILE_BYTES) continue;
        const { meta, body } = parseCommandFile(readFileSync(path, "utf8"));
        commands.set(name, {
          name,
          description: meta.description || "",
          template: body,
          model: meta.model || "",
          scope,
          path,
        });
      } catch {
        /* bỏ qua file lỗi */
      }
    }
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Tách tham số kiểu shell (hỗ trợ "..." và '...'). */
export function tokenizeArgs(text) {
  const args = [];
  let current = "";
  let quote = null;
  const value = String(text ?? "");
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === "\\" && quote === '"' && value[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function runShell(command, cwd, exec) {
  try {
    if (exec) return String(exec(command)).trim();
    const output = process.platform === "win32"
      ? execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: MAX_SHELL_BUFFER,
      })
      : execFileSync("/bin/sh", ["-c", command], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: MAX_SHELL_BUFFER,
      });
    return String(output).trim();
  } catch (error) {
    return t("cmd.shellError", { message: error?.message || error });
  }
}

function readIncludedFile(path, cwd) {
  try {
    const full = join(cwd, path);
    if (!existsSync(full)) return null;
    if (statSync(full).size > MAX_FILE_BYTES) return t("cmd.fileTooLarge", { path });
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

/** Mở rộng template: $ARGUMENTS, $1.., !`shell`, @file. */
export function expandCommand(command, argsText, { cwd = process.cwd(), exec } = {}) {
  const args = tokenizeArgs(argsText);
  let text = String(command?.template ?? "");
  text = text.replace(/\$ARGUMENTS/g, String(argsText ?? "").trim());
  text = text.replace(/\$(\d+)/g, (_, index) => args[Number(index) - 1] ?? "");
  text = text.replace(/!`([^`]+)`/g, (_, shellCommand) => runShell(shellCommand, cwd, exec));
  text = text.replace(/(^|\s)@([^\s@]+)/g, (full, prefix, path) => {
    const content = readIncludedFile(path, cwd);
    if (content === null) return full;
    return `${prefix}\`\`\`\n${content.replace(/\s+$/, "")}\n\`\`\``;
  });
  return text.trim();
}
