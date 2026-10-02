import { t } from "./i18n.mjs";

export const VERSION = "1.0.2";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
};

/** czn_abcd1234wxyz → czn_abcd…wxyz */
export function maskKey(key) {
  const value = String(key || "");
  if (!value) return t("common.notSet");
  if (value.length <= 12) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

const VALUE_FLAGS = new Set(["key", "base-url", "model", "system", "shell", "temperature", "max-tokens", "config", "session", "role", "lang", "limit", "profile", "logo", "port"]);

/**
 * Parser argv tối giản: --flag value, --flag=value, -h, -v, --no-*.
 * Trả { flags, positionals, error? }.
 */
export function parseArgs(argv = []) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      flags.version = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith("--") && next.length > 2)) {
          return { flags, positionals, error: `Thiếu giá trị cho --${body}` };
        }
        flags[body] = next;
        i += 1;
        continue;
      }
      flags[body] = true;
      continue;
    }
    positionals.push(arg);
  }
  return { flags, positionals };
}
