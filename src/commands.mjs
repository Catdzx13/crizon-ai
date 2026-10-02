import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { ApiError, CrizonClient } from "./client.mjs";
import { runBrowserLogin } from "./browser-login.mjs";
import { CodexConfigConflict, renderCodexBlocks } from "./codex-config.mjs";
import { createComposer } from "./composer.mjs";
import { homeDir, loadConfigFile, resolveConfig, saveConfigFile, updateConfigFile } from "./config.mjs";
import { runDoctor } from "./doctor.mjs";
import { applyProfileBlock, brandPluginSource, cleanupHarness, commandExists, detectProfilePath, doctorScriptSource, goalPluginSource, goalScriptSource, HARNESSES, harnessStatus, isHarnessId, managedBrandFile, managedConfigFile, managedDoctorFile, managedEnvFile, managedGoalFile, managedGoalPluginFile, managedTuiConfigFile, maskEnvValue, probeCompat, profileShell, removeProfileBlock, renderEnvBlock, renderManagedEnv, renderOpencodeConfig, renderTuiConfig, resolveHarnessId } from "./harness.mjs";
import { expandCommand, loadCustomCommands } from "./custom-commands.mjs";
import { openUrl, portalKeysUrl } from "./open-url.mjs";
import { getLang, LANGS, setLang, t, tIn } from "./i18n.mjs";
import { appendLog, clearLogs, readLogs } from "./logs.mjs";
import { clearSession, listSessions, loadSession, saveSession } from "./sessions.mjs";
import { recapSession } from "./recap.mjs";
import {
  MarkdownStream,
  SYM,
  askLine,
  bandLine,
  colorEnabled,
  confirm,
  createLineReader,
  createSpinner,
  inputHidden,
  paint,
  panel,
  renderMarkdown,
  searchSelect,
  select,
} from "./ui.mjs";
import { c, maskKey, VERSION } from "./util.mjs";
import { printWelcome } from "./welcome.mjs";
import { promptApiKey } from "./wizard.mjs";

export function defaultIo() {
  return {
    out: (line = "") => console.log(line),
    write: (text) => process.stdout.write(String(text)),
    err: (line = "") => console.error(line),
    stdin: process.stdin,
    stdout: process.stdout,
  };
}

const dim = (io, text) => paint(colorEnabled(io.stdout), 2, text);

/** ~/duong/dan — rút gọn cho footer kiểu TUI Crizon. */
function shortenCwd(cwd, home) {
  const value = String(cwd || "");
  const prefix = home && value.toLowerCase().startsWith(String(home).toLowerCase())
    ? `~${value.slice(String(home).length)}`
    : value;
  return prefix.length > 46 ? `…${prefix.slice(-45)}` : prefix;
}

function makeClient(cfg) {
  return new CrizonClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
}

export function explainError(err) {
  if (err instanceof ApiError) {
    const parts = [`${err.status ? `${err.status} ` : ""}${err.code}`];
    if (err.message && err.message !== err.code) parts.push(err.message);
    // Gateway gửi lý do cụ thể (hết gói, quá số request đồng thời, model ngoài gói…).
    const reasonKey = `err.reason.${err.code}`;
    const reason = t(reasonKey);
    if (reason !== reasonKey) parts.push(`→ ${reason}`);
    else if (err.status === 401) parts.push(`→ ${t("err.invalidKeyMsg")}`);
    else if (err.status === 402 || err.status === 429) parts.push(`→ ${t("err.quotaMsg")}`);
    else if (err.status === 503) parts.push(`→ ${t("err.busyMsg")}`);
    if (err.retryable) parts.push(t("err.retryable"));
    return parts.join(" — ");
  }
  return err?.message || String(err);
}

async function modelIds(client) {
  const data = await client.models();
  return (Array.isArray(data?.data) ? data.data : []).map((m) => m?.id).filter(Boolean);
}

async function pickModel(client, cfg, preferred) {
  if (preferred) return preferred;
  const ids = await modelIds(client);
  if (!ids.length) throw new Error(t("models.empty"));
  return ids[0];
}

function printUsage(io, usage) {
  if (!usage) return;
  const inTok = usage.prompt_tokens ?? usage.input_tokens ?? "?";
  const outTok = usage.completion_tokens ?? usage.output_tokens ?? "?";
  io.err(dim(io, t("tokens.line", { in: inTok, out: outTok })));
}

async function readAll(stream) {
  let data = "";
  for await (const chunk of stream) data += chunk;
  return data;
}

/* --------------------------------- roles -------------------------------- */

export function rolesFile(env = process.env) {
  return join(homeDir(env), "roles.json");
}

export function loadRoles(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(rolesFile(env), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function saveRoles(env, roles) {
  const file = rolesFile(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(roles, null, 2)}\n`, { mode: 0o600 });
  return file;
}

/* ------------------------------- commands ------------------------------- */

export async function cmdLogin({ flags = {}, env = process.env, io = defaultIo(), deps = {} } = {}) {
  const key = String(flags.key || "").trim();
  if (!key && flags.browser) {
    const login = deps.browserLogin ?? runBrowserLogin;
    const saved = await login({ env, io, open: deps.open ?? openUrl });
    if (!saved) return 1;
    reportReapplied(io, await reapplyConnectedHarnesses({ env, cfg: resolveConfig({ env }) }));
    return 0;
  }
  if (!key) {
    const url = portalKeysUrl(resolveConfig({ flags, env }).portalUrl);
    const open = deps.open ?? openUrl;
    const opened = flags.web || flags.open ? Boolean(open(url, { env })) : false;
    io.out(t(opened ? "login.portalOpened" : "login.portal", { url }));
    io.out(t("login.portalHint"));
    return 2;
  }
  const file = loadConfigFile(env);
  const baseUrl = String(flags["base-url"] || env.CRIZON_BASE_URL || file.baseUrl || "").trim();
  const next = { ...file, apiKey: key };
  if (baseUrl) next.baseUrl = baseUrl.replace(/\/+$/, "");
  const cfg = resolveConfig({ flags, env });
  // Kiểm tra trước khi lưu: key bị Gateway từ chối (401) không được ghi đè key đang chạy được.
  // Lỗi mạng/Gateway bận vẫn lưu để dùng được khi kết nối lại.
  let count = null;
  let failure = null;
  try {
    count = (await modelIds(makeClient(cfg))).length;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      io.out(t("login.rejected", { err: explainError(err) }));
      return 1;
    }
    failure = err;
  }
  const path = saveConfigFile(next, env);
  io.out(t("login.saved", { path }));
  // Key mới phải tới cả các app đã kết nối, nếu không chúng vẫn gọi bằng key cũ.
  reportReapplied(io, await reapplyConnectedHarnesses({ env, cfg: resolveConfig({ flags: { "base-url": flags["base-url"] }, env }) }));
  if (failure) {
    io.out(t("login.unverified", { err: explainError(failure) }));
    return 1;
  }
  io.out(t("login.valid", { count, base: cfg.baseUrl }));
  return 0;
}

/** Mở trang tạo API key trong portal (không cần key sẵn). */
export async function cmdPortal({ flags = {}, env = process.env, io = defaultIo(), deps = {} } = {}) {
  const url = portalKeysUrl(resolveConfig({ flags, env }).portalUrl);
  const open = deps.open ?? openUrl;
  const opened = Boolean(open(url, { env }));
  io.out(t(opened ? "portal.opened" : "portal.link", { url }));
  return 0;
}

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT_DIR = join(PACKAGE_DIR, "..", "..");

/**
 * Ứng viên binary TUI Crizon (theo thứ tự ưu tiên):
 * --bin > CRIZON_OPENCODE_VI_BIN > ~/.crizon-ai/bin > artifact đóng gói trong package > dist của source dev.
 */
export function tuiBinaryCandidates({ flags = {}, env = process.env, packageDir = PACKAGE_DIR, repoRoot = REPO_ROOT_DIR } = {}) {
  const isWin = process.platform === "win32";
  const platformDir = isWin ? "windows" : process.platform;
  const exeName = isWin ? "crizon-tui.exe" : "crizon-tui";
  const legacyExe = isWin ? "opencode.exe" : "opencode";
  const distName = `opencode-${platformDir}-${process.arch}`;
  return [
    flags.bin,
    env.CRIZON_TUI_BIN ?? env.CRIZON_OPENCODE_VI_BIN,
    join(homeDir(env), "bin", exeName),
    join(homeDir(env), "bin", legacyExe),
    join(packageDir, "dist", "tui", `${platformDir}-${process.arch}`, exeName),
    join(packageDir, "dist", "opencode", `${platformDir}-${process.arch}`, legacyExe),
    join(repoRoot, "reference", "ai-clis", "opencode", "packages", "opencode", "dist", distName, "bin", legacyExe),
  ].filter((path) => typeof path === "string" && path.length > 0);
}

export function resolveTuiBinary(opts = {}) {
  return tuiBinaryCandidates(opts).find((path) => existsSync(path)) ?? "";
}

/** Kho phát hành binary TUI (GitHub Releases mặc định; đổi bằng CRIZON_TUI_DOWNLOAD_BASE). */
export const DEFAULT_TUI_DOWNLOAD_BASE = "https://github.com/Catdzx13/crizon-ai/releases/latest/download";

/** Tên asset theo nền tảng/kiến trúc — trả "" nếu chưa hỗ trợ. */
export function tuiAssetName({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === "win32") return arch === "x64" ? "crizon-tui-windows-x64.exe" : "";
  if (platform === "darwin") return arch === "arm64" ? "crizon-tui-darwin-arm64" : arch === "x64" ? "crizon-tui-darwin-x64" : "";
  if (platform === "linux") return arch === "x64" ? "crizon-tui-linux-x64" : arch === "arm64" ? "crizon-tui-linux-arm64" : "";
  return "";
}

/** URL asset cho nền tảng hiện tại — trả "" nếu chưa hỗ trợ. */
export function tuiDownloadUrl({ env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const asset = tuiAssetName({ platform, arch });
  if (!asset) return "";
  const base = String(env.CRIZON_TUI_DOWNLOAD_BASE || DEFAULT_TUI_DOWNLOAD_BASE).replace(/\/+$/, "");
  return `${base}/${asset}`;
}

/** Tải binary TUI về `dest` (ghi file tạm rồi đổi tên). Trả số byte. */
export async function downloadTuiBinary({ url, dest, fetchImpl = fetch } = {}) {
  if (!url) throw new Error("chưa có bản TUI cho nền tảng này");
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("file tải về rỗng");
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, dest);
  try {
    chmodSync(dest, 0o755);
  } catch {
    /* Windows không cần */
  }
  return buffer.length;
}

/** Mở TUI Crizon với config Crizon thật (không mock). Tham số thêm chuyển tiếp cho TUI Crizon. */
export async function cmdTui({ flags = {}, env = process.env, io = defaultIo(), deps = {} } = {}) {
  const configPath = managedConfigFile(env, "tui");
  const tuiConfigPath = managedTuiConfigFile(env, "tui");
  if (!existsSync(configPath)) {
    io.out(t("tui.configMissing"));
    return 2;
  }
  let binary = (deps.resolveBinary ?? resolveTuiBinary)({ flags, env });
  if (!binary && !flags["no-download"]) {
    const url = tuiDownloadUrl({ env });
    if (url) {
      const exeName = process.platform === "win32" ? "crizon-tui.exe" : "crizon-tui";
      const dest = join(homeDir(env), "bin", exeName);
      io.out(t("tui.downloading", { url }));
      try {
        const size = await (deps.download ?? downloadTuiBinary)({ url, dest });
        io.out(t("tui.downloaded", { path: dest, mb: (size / 1024 / 1024).toFixed(1) }));
        binary = dest;
      } catch (err) {
        io.out(t("tui.downloadFailed", { err: explainError(err) }));
      }
    }
  }
  if (!binary) {
    io.out(t("tui.binMissing"));
    return 2;
  }
  const args = Array.isArray(flags._) ? flags._.map(String) : [];
  io.out(t("tui.start", { path: configPath }));
  const spawnFn = deps.spawn ?? spawn;
  try {
    const child = spawnFn(binary, args, {
      env: { ...env, OPENCODE_CONFIG: configPath, OPENCODE_TUI_CONFIG: tuiConfigPath },
      cwd: process.cwd(),
      stdio: "inherit",
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode) => resolve(typeof exitCode === "number" ? exitCode : 0));
    });
    return code;
  } catch (err) {
    io.out(t("tui.spawnError", { err: explainError(err) }));
    return 1;
  }
}

export async function cmdLogout({ env = process.env, io = defaultIo() } = {}) {
  const file = loadConfigFile(env);
  if (!file.apiKey) {
    io.out(t("logout.none"));
    return 0;
  }
  delete file.apiKey;
  const path = saveConfigFile(file, env);
  io.out(t("logout.done", { path }));
  return 0;
}

export async function cmdConfig({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const cfg = resolveConfig({ flags, env });
  io.out(`base url : ${cfg.baseUrl}`);
  io.out(`api key  : ${maskKey(cfg.apiKey)} (${t("config.source")}: ${cfg.source})`);
  io.out(`model    : ${cfg.model || t("config.modelAuto")}`);
  io.out(`lang     : ${getLang()}`);
  io.out(`config   : ${cfg.configPath}`);
  if (!flags.check) return 0;
  if (!cfg.apiKey) {
    io.out(`${SYM.err} ${t("err.noKey")}`);
    return 2;
  }
  try {
    const count = (await modelIds(makeClient(cfg))).length;
    io.out(t("config.checkOk", { count }));
    return 0;
  } catch (err) {
    io.out(`${SYM.err} ${explainError(err)}`);
    return 1;
  }
}

export async function cmdModels({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const cfg = resolveConfig({ flags, env });
  if (!cfg.apiKey) {
    io.out(`${SYM.err} ${t("err.noKey")}`);
    return 2;
  }
  try {
    const data = await makeClient(cfg).models();
    if (flags.json) {
      io.out(JSON.stringify(data, null, 2));
      return 0;
    }
    const models = Array.isArray(data?.data) ? data.data : [];
    if (!models.length) {
      io.out(t("models.empty"));
      return 0;
    }
    for (const m of models) {
      io.out(`${c.cyan(m?.id ?? "(no id)")}${m?.owned_by ? c.dim(`  ${m.owned_by}`) : ""}`);
    }
    return 0;
  } catch (err) {
    io.out(`${SYM.err} ${explainError(err)}`);
    return 1;
  }
}

export async function cmdAsk({ flags = {}, env = process.env, io = defaultIo(), stdin } = {}) {
  const cfg = resolveConfig({ flags, env });
  if (!cfg.apiKey) {
    io.out(`${SYM.err} ${t("err.noKey")}`);
    return 2;
  }
  let prompt = (flags._ || []).join(" ").trim();
  const input = stdin || io.stdin;
  if (!prompt && input && !input.isTTY) prompt = (await readAll(input)).trim();
  if (!prompt) {
    io.out(t("ask.missing"));
    return 2;
  }
  let system = flags.system ? String(flags.system) : "";
  if (flags.role) {
    const role = loadRoles(env)[String(flags.role)];
    if (!role) {
      io.out(`${SYM.err} ${t("roles.notFound", { name: flags.role })}`);
      return 2;
    }
    system = role;
  }
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const temperature = flags.temperature !== undefined ? Number(flags.temperature) : undefined;
  const maxTokens = flags["max-tokens"] !== undefined ? Number(flags["max-tokens"]) : undefined;
  const client = makeClient(cfg);
  try {
    const model = await pickModel(client, cfg, flags.model || cfg.model);
    if (flags.json) {
      const data = await client.chat({ model, messages, temperature, maxTokens });
      io.out(JSON.stringify(data, null, 2));
      appendLog(env, { kind: "ask", model, prompt, content: data?.choices?.[0]?.message?.content ?? "", usage: data?.usage });
      return 0;
    }
    if (flags["no-stream"]) {
      const spinner = createSpinner(io);
      spinner.start();
      let data;
      try {
        data = await client.chat({ model, messages, temperature, maxTokens });
      } finally {
        spinner.stop();
      }
      const content = data?.choices?.[0]?.message?.content ?? "";
      io.out(renderMarkdown(content, { color: colorEnabled(io.stdout) }));
      printUsage(io, data?.usage);
      appendLog(env, { kind: "ask", model, prompt, content, usage: data?.usage });
      return 0;
    }
    const md = new MarkdownStream({ color: colorEnabled(io.stdout), write: (s) => io.write(s) });
    const spinner = createSpinner(io);
    let started = false;
    spinner.start();
    let result;
    try {
      result = await client.chatStream({ model, messages, temperature, maxTokens }, (delta) => {
        if (!started) {
          started = true;
          spinner.stop();
        }
        md.feed(delta);
      });
    } finally {
      spinner.stop();
    }
    md.end();
    io.out("");
    printUsage(io, result.usage);
    appendLog(env, { kind: "ask", model, prompt, content: result.content, usage: result.usage });
    return 0;
  } catch (err) {
    io.out(`${SYM.err} ${explainError(err)}`);
    return 1;
  }
}

/** Tóm tắt catch-up phiên (recap kiểu Codex) — request tạm, không ghi vào phiên. */
export async function cmdRecap({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const cfg = resolveConfig({ flags, env });
  if (!cfg.apiKey) {
    io.out(`${SYM.err} ${t("err.noKey")}`);
    return 2;
  }
  const sessionName = String(flags.session || "default");
  const session = loadSession(env, sessionName);
  if (!session.messages.length) {
    io.out(t("recap.empty", { name: session.name }));
    return 0;
  }
  const client = makeClient(cfg);
  try {
    const model = await pickModel(client, cfg, flags.model || cfg.model || session.model);
    const result = await recapSession({ client, model, messages: session.messages });
    if (flags.json) {
      io.out(JSON.stringify({ session: session.name, model, ...result }, null, 2));
      return 0;
    }
    io.out(`${SYM.on} ${t("recap.title")}`);
    io.out(result.summary);
    if (result.nextAction) {
      io.out("");
      io.out(`${SYM.on} ${t("recap.next")}`);
      io.out(result.nextAction);
    }
    return 0;
  } catch (err) {
    io.out(`${SYM.err} ${explainError(err)}`);
    return 1;
  }
}

/* ------------------------------ settings menu ---------------------------- */

export async function settingsMenu({ env = process.env, io = defaultIo(), ui = {}, flags = {} } = {}) {
  const uiFns = { select, searchSelect, inputHidden, confirm: undefined, ...ui };
  for (;;) {
    const cfg = resolveConfig({ flags, env });
    const keyText = cfg.apiKey ? `${maskKey(cfg.apiKey)} ${t("settings.keyValid")}` : t("common.notSet");
    const langLabel = LANGS.find((lang) => lang.code === getLang())?.label ?? getLang();
    const items = [
      { code: "lang", label: `${t("settings.language")}  ·  ${langLabel}` },
      { code: "key", label: `${t("settings.key")}  ·  ${keyText}` },
      { code: "model", label: `${t("settings.model")}  ·  ${cfg.model || t("common.notSet")}` },
      { code: "agents", label: `${t("settings.agents")}  ·  ${agentsStatusLine(env, flags)}` },
      { code: "doctor", label: t("settings.doctor") },
      { code: "exit", label: t("settings.exit") },
    ];
    const pick = await uiFns.select(io, items, { title: t("settings.title") });
    if (!pick || pick.item.code === "exit") return 0;

    if (pick.item.code === "lang") {
      const lp = await uiFns.select(io, LANGS, { title: t("settings.language") });
      if (lp) {
        setLang(lp.item.code);
        updateConfigFile({ lang: lp.item.code }, env);
        io.out(t("settings.saved"));
      }
    } else if (pick.item.code === "key") {
      const entered = await uiFns.inputHidden(io, { prompt: t("wizard.keyPrompt") });
      if (entered === null) continue;
      const key = String(entered).trim();
      if (!key) continue;
      try {
        const count = (await modelIds(makeClient({ ...cfg, apiKey: key }))).length;
        updateConfigFile({ apiKey: key }, env);
        io.out(t("wizard.keyOk", { count }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          updateConfigFile({ apiKey: key }, env);
          io.out(t("login.unverified", { err: explainError(err) }));
        } else {
          io.out(`${SYM.err} ${explainError(err)}`);
        }
      }
    } else if (pick.item.code === "model") {
      let ids = [];
      try {
        ids = await modelIds(makeClient(cfg));
      } catch (err) {
        io.out(`${SYM.err} ${explainError(err)}`);
        continue;
      }
      const options = [{ id: "", label: t("picker.default") }, ...ids.map((id) => ({ id, label: id }))];
      const mp = await uiFns.searchSelect(io, options, { title: t("picker.title", { count: ids.length }) });
      if (mp) {
        updateConfigFile({ model: mp.item.id }, env);
        io.out(t("settings.saved"));
      }
    } else if (pick.item.code === "agents") {
      await agentsMenu({ env, io, ui: uiFns, flags });
    } else if (pick.item.code === "doctor") {
      await runDoctor({ env, flags, io, version: VERSION });
    }
  }
}

export async function cmdSettings({ flags = {}, env = process.env, io = defaultIo(), ui = {} } = {}) {
  return settingsMenu({ env, io, ui, flags });
}

export async function cmdDoctor({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  return runDoctor({ env, flags, io, version: VERSION });
}

export async function cmdLogs({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  if (flags.clear) {
    clearLogs(env);
    io.out(t("logs.cleared"));
    return 0;
  }
  const limit = flags.limit ? Math.max(1, Number(flags.limit)) : 20;
  const rows = readLogs(env, limit);
  if (flags.json) {
    io.out(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (!rows.length) {
    io.out(t("logs.empty"));
    return 0;
  }
  io.out(t("logs.title", { count: rows.length }));
  for (const row of rows) {
    const time = String(row.ts || "").replace("T", " ").slice(0, 19);
    const tok = row.usage ? `${row.usage.prompt_tokens ?? "?"}/${row.usage.completion_tokens ?? "?"}` : "-";
    const prompt = String(row.prompt || "").replace(/\s+/g, " ").slice(0, 60);
    io.out(`${dim(io, time)}  ${row.model || "-"}  ${dim(io, tok)}  ${prompt}`);
  }
  return 0;
}

export async function cmdRoles({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const [sub, name, ...rest] = flags._ || [];
  const roles = loadRoles(env);
  if (!sub || sub === "list") {
    const names = Object.keys(roles);
    io.out(names.length ? t("roles.list", { names: names.join(", ") }) : t("roles.empty"));
    return 0;
  }
  if (sub === "add") {
    const prompt = rest.join(" ").trim();
    if (!name || !prompt) {
      io.out(t("roles.usage"));
      return 2;
    }
    roles[name] = prompt;
    saveRoles(env, roles);
    io.out(t("roles.added", { name }));
    return 0;
  }
  if (sub === "rm" || sub === "remove") {
    if (!name || !roles[name]) {
      io.out(t("roles.notFound", { name: name || "" }));
      return 1;
    }
    delete roles[name];
    saveRoles(env, roles);
    io.out(t("roles.removed", { name }));
    return 0;
  }
  io.out(t("roles.usage"));
  return 2;
}

/** Lệnh trong chat — hiện trong autocomplete khi gõ "/" (kiểu TUI Crizon). */
const CHAT_COMMANDS = [
  { name: "/help", key: "cmd.help" },
  { name: "/model", key: "cmd.model" },
  { name: "/language", key: "cmd.language" },
  { name: "/settings", key: "cmd.settings" },
  { name: "/system", key: "cmd.system" },
  { name: "/sessions", key: "cmd.sessions" },
  { name: "/new", key: "cmd.new" },
  { name: "/rename", key: "cmd.rename" },
  { name: "/undo", key: "cmd.undo" },
  { name: "/export", key: "cmd.export" },
  { name: "/recap", key: "cmd.recap" },
  { name: "/status", key: "cmd.status" },
  { name: "/clear", key: "cmd.clear" },
  { name: "/exit", key: "cmd.exit" },
];

/* --------------------------------- chat --------------------------------- */

export async function cmdChat({ flags = {}, env = process.env, io = defaultIo(), ui = {}, cwd = process.cwd() } = {}) {
  const cfg = resolveConfig({ flags, env });
  if (!cfg.apiKey) {
    io.out(`${SYM.err} ${t("err.noKey")}`);
    return 2;
  }
  const uiFns = { select, searchSelect, inputHidden, confirm: undefined, ...ui };
  const client = makeClient(cfg);
  let sessionName = String(flags.session || "default");
  const session = loadSession(env, sessionName);
  const messages = session.messages.slice();
  let model = flags.model || cfg.model || session.model || "";
  if (!model) {
    try {
      model = await pickModel(client, cfg);
    } catch (err) {
      io.out(`${SYM.err} ${explainError(err)}`);
      return 1;
    }
  }
  let systemPrompt = messages.find((m) => m.role === "system")?.content || (flags.system ? String(flags.system) : "");
  const ensureSystem = () => {
    const at = messages.findIndex((m) => m.role === "system");
    if (systemPrompt) {
      if (at >= 0) messages[at].content = systemPrompt;
      else messages.unshift({ role: "system", content: systemPrompt });
    } else if (at >= 0) {
      messages.splice(at, 1);
    }
  };
  ensureSystem();
  const save = () => saveSession(env, { name: sessionName, model, messages });

  const stdout = io.stdout || process.stdout;
  const color = colorEnabled(stdout);
  const tui = Boolean(io.stdin?.isTTY && stdout?.isTTY);
  const cwdLabel = shortenCwd(cwd, homedir());
  const composerFooter = () => ({ left: cwdLabel, right: t("composer.footerRight") });
  const composerMeta = () => t("composer.meta", { model, lang: getLang() });
  const composer = tui ? createComposer(io, { meta: composerMeta(), footer: composerFooter() }) : null;
  const customCommands = loadCustomCommands({ env, cwd, configCommands: loadConfigFile(env).command });
  const refreshCommands = () => {
    const builtins = CHAT_COMMANDS.map((command) => ({
      name: command.name,
      description: t(command.key),
      // Vietsub: chỉ hiện phụ đề tiếng Việt khi UI không phải tiếng Việt
      ...(getLang() === "vi" ? {} : { subtitle: tIn("vi", command.key) }),
    }));
    const customs = customCommands.map((command) => ({ name: `/${command.name}`, description: command.description || t("cmd.custom") }));
    composer?.setCommands([...builtins, ...customs].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const refreshComposer = () => {
    composer?.setFooter(composerFooter());
    composer?.setMeta(composerMeta());
    refreshCommands();
  };
  refreshCommands();
  const reader = tui ? null : createLineReader(io);
  const emit = (line = "") => {
    if (composer) composer.print(`${line}\n`);
    else io.out(line);
  };

  if (composer) {
    await printWelcome(io, { version: VERSION, model, session: sessionName, sessionCount: session.messages.length, style: cfg.logo });
  } else {
    io.out(t("chat.header", { lang: getLang(), model, key: maskKey(cfg.apiKey) }));
    if (session.messages.length) {
      io.out(dim(io, t("chat.sessionLoaded", { name: session.name, count: session.messages.length })));
    }
  }

  /** Gửi 1 lượt: hiện prompt, stream trả lời, lưu phiên (dùng chung cho chat & custom command). */
  const sendTurn = async (promptContent, useModel, label) => {
    messages.push({ role: "user", content: promptContent });
    if (composer) {
      const width = Math.min(Math.max(60, stdout.columns || 80), 110);
      const border = paint(color, 96, "┃");
      composer.print(`\n${border}\n${border} ${bandLine(label, width - 2, { enabled: color })}\n${border}\n`);
    } else {
      io.out(`${paint(color, 96, "❯")} ${paint(color, 1, label)}`);
    }
    const md = new MarkdownStream({
      color,
      write: composer ? (chunk) => composer.print(chunk) : (chunk) => io.write(chunk),
    });
    const controller = new AbortController();
    const stdin = io.stdin;
    const onInterrupt = (_str, key = {}) => {
      if (key.name === "escape") controller.abort();
    };
    if (tui && stdin) {
      readline.emitKeypressEvents(stdin);
      stdin.on("keypress", onInterrupt);
    }
    composer?.setBusy(true, t("composer.streamingEsc"));
    let streamed = "";
    try {
      const result = await client.chatStream({ model: useModel, messages, signal: controller.signal }, (delta) => {
        streamed += delta;
        md.feed(delta);
      });
      md.end();
      if (composer) {
        composer.setBusy(false);
        if (result.usage) {
          emit(`\n${dim(io, t("tokens.line", { in: result.usage.prompt_tokens ?? "?", out: result.usage.completion_tokens ?? "?" }))}`);
        }
      } else {
        io.out("");
      }
      messages.push({ role: "assistant", content: result.content });
      appendLog(env, { kind: "chat", model: useModel, prompt: label, content: result.content, usage: result.usage });
      save();
    } catch (err) {
      md.end();
      if (controller.signal.aborted) {
        if (streamed) messages.push({ role: "assistant", content: streamed });
        if (composer) {
          composer.setBusy(false);
          emit(`\n${dim(io, t("chat.interrupted"))}`);
        } else {
          io.out(t("chat.interrupted"));
        }
        save();
      } else {
        messages.pop();
        if (composer) {
          composer.setBusy(false);
          emit(`${SYM.err} ${explainError(err)}`);
        } else {
          io.out(`${SYM.err} ${explainError(err)}`);
        }
      }
    } finally {
      if (tui && stdin) stdin.removeListener("keypress", onInterrupt);
    }
  };

  try {
    for (;;) {
      const line = composer ? await composer.read() : await reader.ask(t("chat.prompt"));
      if (line === undefined || line === null) break;
      const text = String(line).trim();
      if (!text) continue;
      if (text === "/exit" || text === "/quit") break;
      if (text === "/help") {
        emit(t("chat.help"));
        continue;
      }
      if (text === "/clear") {
        messages.length = 0;
        ensureSystem();
        save();
        emit(t("chat.cleared"));
        continue;
      }
      if (text === "/language" || text === "/lang" || text.startsWith("/language ") || text.startsWith("/lang ")) {
        const arg = text.replace(/^\/lang(?:uage)?\s*/, "").trim().toLowerCase();
        let code = arg;
        if (!code) {
          composer?.erase();
          let picked = null;
          try {
            picked = await uiFns.select(io, LANGS, { title: t("settings.language") });
          } finally {
            composer?.draw();
          }
          if (!picked) continue;
          code = picked.item.code;
        }
        if (!LANGS.some((lang) => lang.code === code)) {
          emit(t("chat.languageInvalid", { codes: LANGS.map((lang) => lang.code).join(" / ") }));
          continue;
        }
        setLang(code);
        updateConfigFile({ lang: code }, env);
        refreshComposer();
        emit(t("chat.languageSet", { name: LANGS.find((lang) => lang.code === code).label }));
        // Hiện ngay trợ giúp bằng ngôn ngữ mới để thấy rõ đã đổi
        emit(t("chat.help"));
        continue;
      }
      if (text === "/settings") {
        composer?.erase();
        await settingsMenu({ env, io, ui: uiFns, flags });
        composer?.draw();
        const after = resolveConfig({ flags, env });
        if (after.model && after.model !== cfg.model) {
          cfg.model = after.model;
          model = after.model;
        }
        refreshComposer();
        continue;
      }
      if (/^\/models?(\s|$)/.test(text)) {
        const arg = text.replace(/^\/models?\s*/, "").trim();
        if (arg) {
          model = arg;
          save();
          refreshComposer();
          emit(t("chat.modelSet", { model }));
          continue;
        }
        let ids = [];
        try {
          ids = await modelIds(client);
        } catch (err) {
          emit(`${SYM.err} ${explainError(err)}`);
          continue;
        }
        composer?.erase();
        const picked = await uiFns.searchSelect(
          io,
          ids.map((id) => ({ id, label: id })),
          { title: t("picker.title", { count: ids.length }) },
        );
        composer?.draw();
        if (picked?.item?.id) {
          model = picked.item.id;
          save();
          refreshComposer();
          emit(t("chat.modelSet", { model }));
        }
        continue;
      }
      if (text.startsWith("/system")) {
        systemPrompt = text.slice(7).trim();
        ensureSystem();
        save();
        emit(t("chat.systemSet"));
        continue;
      }
      if (text === "/sessions") {
        const names = listSessions(env);
        const items = names.map((name) => ({ id: name, label: `${name === sessionName ? "●" : " "} ${name}` }));
        if (!items.some((item) => item.id === sessionName)) items.unshift({ id: sessionName, label: `● ${sessionName}` });
        items.push({ id: "__new__", label: t("sessions.new") });
        composer?.erase();
        let picked = null;
        try {
          picked = await uiFns.select(io, items, { title: t("sessions.title") });
        } finally {
          composer?.draw();
        }
        const target = picked?.item?.id;
        if (!target || target === sessionName) continue;
        save();
        if (target === "__new__") {
          const entered = await uiFns.inputHidden(io, { prompt: t("sessions.namePrompt") });
          const name = String(entered ?? "").trim();
          if (!name) continue;
          sessionName = name;
          messages.length = 0;
          systemPrompt = "";
          ensureSystem();
          save();
          refreshComposer();
          emit(t("sessions.switched", { name: sessionName }));
          continue;
        }
        const loaded = loadSession(env, target);
        sessionName = loaded.name;
        messages.length = 0;
        messages.push(...loaded.messages);
        if (loaded.model) model = loaded.model;
        systemPrompt = messages.find((message) => message.role === "system")?.content || "";
        ensureSystem();
        save();
        composer?.setFooter(composerFooter());
        emit(t("sessions.switched", { name: sessionName }));
        continue;
      }
      if (text.startsWith("/rename")) {
        const next = text.slice(7).trim();
        if (!next) {
          emit(t("sessions.renameUsage"));
          continue;
        }
        if (next !== sessionName) {
          const previous = sessionName;
          save();
          sessionName = next;
          save();
          clearSession(env, previous);
          refreshComposer();
          emit(t("sessions.renamed", { from: previous, to: next }));
        }
        continue;
      }
      if (text === "/new" || text.startsWith("/new ")) {
        let name = text.slice(4).trim();
        if (!name) {
          const entered = await uiFns.inputHidden(io, { prompt: t("sessions.namePrompt") });
          name = String(entered ?? "").trim();
        }
        if (!name) continue;
        save();
        sessionName = name;
        messages.length = 0;
        systemPrompt = flags.system ? String(flags.system) : "";
        ensureSystem();
        save();
        refreshComposer();
        emit(t("chat.newSession", { name: sessionName }));
        continue;
      }
      if (text === "/undo") {
        let lastUser = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index].role === "user") {
            lastUser = index;
            break;
          }
        }
        if (lastUser < 0) {
          emit(t("chat.nothingToUndo"));
          continue;
        }
        messages.splice(lastUser);
        ensureSystem();
        save();
        emit(t("chat.undone"));
        continue;
      }
      if (text === "/export" || text.startsWith("/export ")) {
        const target = text.slice(7).trim() || `crizon-${sessionName}-${Date.now()}.md`;
        const lines = [`# crizon-ai · ${sessionName}`, "", `- model: ${model}`, `- ${new Date().toISOString()}`, ""];
        for (const message of messages) {
          if (message.role === "system") continue;
          lines.push(message.role === "user" ? "## ❯" : "## ✻", "", String(message.content), "");
        }
        try {
          const file = join(cwd, target);
          writeFileSync(file, lines.join("\n"), "utf8");
          emit(t("chat.exported", { path: file }));
        } catch (error) {
          emit(`${SYM.err} ${error?.message || error}`);
        }
        continue;
      }
      if (text === "/recap") {
        emit(t("chat.recapRunning"));
        try {
          const result = await recapSession({ client, model, messages });
          if (!result.ok) {
            emit(t("chat.recapEmpty"));
          } else {
            emit(`${SYM.on} ${t("chat.recapTitle")}`);
            emit(result.summary);
            if (result.nextAction) {
              emit("");
              emit(`${SYM.on} ${t("chat.recapNext")}`);
              emit(result.nextAction);
            }
          }
        } catch (error) {
          emit(`${SYM.err} ${explainError(error)}`);
        }
        continue;
      }
      if (text === "/status") {
        emit(t("chat.status", {
          base: cfg.baseUrl,
          model,
          lang: getLang(),
          session: sessionName,
          count: messages.filter((message) => message.role !== "system").length,
          commands: customCommands.length,
          config: cfg.configPath,
        }));
        continue;
      }
      if (text.startsWith("/")) {
        const match = text.match(/^\/([A-Za-z0-9._-]+)(?:\s+([\s\S]*))?$/);
        const custom = match ? customCommands.find((command) => command.name === match[1]) : null;
        if (!custom) {
          emit(t("chat.unknownCmd", { cmd: text.split(/\s+/)[0] }));
          continue;
        }
        const expanded = expandCommand(custom, match[2] ?? "", { cwd });
        if (!expanded) {
          emit(t("chat.emptyCommand", { name: custom.name }));
          continue;
        }
        await sendTurn(expanded, custom.model || model, `/${custom.name}${match[2] ? ` ${match[2]}` : ""}`);
        continue;
      }
      await sendTurn(text, model, text);
    }
  } finally {
    save();
    composer?.destroy();
  }
  io.out(t("chat.bye"));
  return 0;
}

export async function cmdLanguage({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const arg = String((flags._ && flags._[0]) || flags.lang || "").trim().toLowerCase();
  if (!arg) {
    setLang(resolveConfig({ flags, env }).lang || getLang());
    if (flags.json) {
      io.out(JSON.stringify({ lang: getLang(), available: LANGS.map((lang) => lang.code) }, null, 2));
      return 0;
    }
    io.out(t("language.current", { name: LANGS.find((lang) => lang.code === getLang())?.label ?? getLang() }));
    io.out(t("language.usage"));
    return 0;
  }
  if (!LANGS.some((lang) => lang.code === arg)) {
    io.out(t("chat.languageInvalid", { codes: LANGS.map((lang) => lang.code).join(" / ") }));
    return 2;
  }
  setLang(arg);
  const path = updateConfigFile({ lang: arg }, env);
  if (flags.json) {
    io.out(JSON.stringify({ lang: arg, config: path }, null, 2));
    return 0;
  }
  io.out(t("chat.languageSet", { name: LANGS.find((lang) => lang.code === arg).label }));
  return 0;
}

export async function cmdEnv({ flags = {}, env = process.env, io = defaultIo() } = {}) {
  const cfg = resolveConfig({ flags, env });
  const key = cfg.apiKey || "czn_YOUR_KEY";
  if (flags.shell === "powershell") {
    io.out(`$env:OPENAI_BASE_URL = "${cfg.baseUrl}"`);
    io.out(`$env:OPENAI_API_KEY = "${key}"`);
  } else {
    io.out(`export OPENAI_BASE_URL="${cfg.baseUrl}"`);
    io.out(`export OPENAI_API_KEY="${key}"`);
  }
  if (!cfg.apiKey) io.out(dim(io, t("env.noKey")));
  io.out(dim(io, t("env.note")));
  return 0;
}

/* ------------------------- harness setup (M3) ---------------------------- */

export function agentsStatusLine(env = process.env, flags = {}) {
  const profilePath = detectProfilePath(process.platform, env);
  const shortNames = { claude: "Claude", codex: "Codex", opencode: "Crizon" };
  return Object.values(HARNESSES)
    .map((harness) => {
      const status = harnessStatus(env, harness.id, { profilePath });
      const short = shortNames[harness.id] ?? harness.name;
      return `${short} ${status.connected ? SYM.on : SYM.off}`;
    })
    .join(" · ");
}

function describeProbe(probe, cfg) {
  if (probe.status === 0) return t("setup.probe.unreachable", { base: cfg.baseUrl });
  if (probe.supported) return t("setup.probe.supported", { path: probe.url });
  return t("setup.probe.unsupported", { path: probe.url });
}

async function probeAndReport(id, cfg, io, { quiet = false } = {}) {
  if (!quiet) io.out(t("setup.probe.checking"));
  const probe = await probeCompat(cfg.baseUrl, id);
  if (!quiet) io.out(describeProbe(probe, cfg));
  return probe;
}

function harnessExtra(id, cfg, env) {
  return id === "tui"
    ? { configPath: managedConfigFile(env, id), tuiConfigPath: managedTuiConfigFile(env, id), lang: cfg.lang || "vi" }
    : {};
}

async function firstModel(cfg) {
  try {
    return (await modelIds(makeClient(cfg)))[0] || "";
  } catch {
    return "";
  }
}

/**
 * Ghi cấu hình cho một harness, không hỏi gì. Dùng chung cho `setup`, cho việc thay
 * key/model (ghi lại vào mọi app đã kết nối) và cho trang `crizon-ai ui`.
 */
export async function applyHarness({ id, cfg, env = process.env, profilePath, noApply = false, markCurrent = true }) {
  const harness = HARNESSES[id];
  const result = { id, envFile: null, profile: null, configFile: null, files: [] };
  if (harness.apply) {
    result.configFile = harness.apply(cfg, { env, model: cfg.model || (await firstModel(cfg)) });
  } else {
    const extra = harnessExtra(id, cfg, env);
    if (id === "tui") {
      let models = [];
      try {
        models = await modelIds(makeClient(cfg));
      } catch {
        models = [];
      }
      mkdirSync(dirname(extra.configPath), { recursive: true });
      const goalFile = managedGoalFile(env, id);
      const goalPluginFile = managedGoalPluginFile(env, id);
      const doctorFile = managedDoctorFile(env, id);
      writeFileSync(extra.configPath, renderOpencodeConfig(cfg, models, { goalScript: goalFile, goalPlugin: goalPluginFile, doctorScript: doctorFile, configPath: extra.configPath }), { mode: 0o600 });
      // Thương hiệu Crizon trong TUI Crizon (slot home_logo qua plugin chính thức).
      writeFileSync(extra.tuiConfigPath, renderTuiConfig(id), { mode: 0o600 });
      writeFileSync(managedBrandFile(env, id), brandPluginSource(), { mode: 0o600 });
      // Goal loop: script trạng thái (.crizon/goal.json theo dự án) + plugin server (token/briefing).
      writeFileSync(goalFile, goalScriptSource(), { mode: 0o600 });
      writeFileSync(goalPluginFile, goalPluginSource(), { mode: 0o600 });
      // Chẩn đoán /crizon (kiểu fcc-doctor) — chạy cục bộ, chỉ đọc.
      writeFileSync(doctorFile, doctorScriptSource(), { mode: 0o600 });
      result.files.push(extra.configPath, extra.tuiConfigPath);
    }
    result.envFile = managedEnvFile(env, id);
    mkdirSync(dirname(result.envFile), { recursive: true });
    writeFileSync(result.envFile, renderManagedEnv(id, cfg, extra), { mode: 0o600 });
    if (!noApply) result.profile = applyProfileBlock(profilePath, id, cfg, extra);
  }
  const file = loadConfigFile(env);
  const harnessConfigs = {
    ...(file.harnessConfigs ?? {}),
    [id]: {
      connectedAt: new Date().toISOString(),
      profilePath,
      applied: Boolean(result.profile || result.configFile),
      baseUrl: cfg.baseUrl,
      model: cfg.model || "",
    },
  };
  updateConfigFile({ ...(markCurrent ? { harness: id } : {}), harnessConfigs }, env);
  return result;
}

/**
 * Sau khi đổi key/model: ghi lại cấu hình cho các app CLI này đã kết nối (theo
 * `harnessConfigs` trong file cấu hình của CLI — không quét file người dùng tự viết).
 */
export async function reapplyConnectedHarnesses({ env = process.env, cfg }) {
  const file = loadConfigFile(env);
  const results = [];
  for (const [id, info] of Object.entries(file.harnessConfigs ?? {})) {
    if (!HARNESSES[id]) continue;
    const profilePath = info?.profilePath || detectProfilePath(process.platform, env);
    if (!harnessStatus(env, id, { profilePath }).connected) continue;
    try {
      await applyHarness({ id, cfg, env, profilePath, noApply: info?.applied === false, markCurrent: false });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err?.message || String(err) });
    }
  }
  return results;
}

function reportReapplied(io, results) {
  const ok = results.filter((row) => row.ok).map((row) => HARNESSES[row.id].name);
  if (ok.length) io.out(t("login.reapplied", { names: ok.join(", ") }));
  for (const row of results.filter((item) => !item.ok)) io.out(t("login.reapplyFailed", { name: HARNESSES[row.id].name, err: row.error }));
}

async function setupHarness({ id, cfg, flags = {}, env = process.env, io, uiFns, assumeConnect = false }) {
  const harness = HARNESSES[id];
  const profilePath = flags.profile ? String(flags.profile) : detectProfilePath(process.platform, env);
  const status = harnessStatus(env, id, { profilePath });
  const installed = commandExists(harness.command);
  const extra = harnessExtra(id, cfg, env);
  const preview = () => {
    const rows = [`${t("setup.status")}: ${status.connected ? t("setup.statusOn") : t("setup.statusOff")}`];
    if (!installed) rows.push(t("setup.harnessMissing", { name: harness.name, hint: harness.hint }));
    if (harness.configFile) {
      rows.push(t("setup.willWriteConfig"));
      rows.push(`  ${harness.configFile(env)}`);
    } else {
      rows.push(t("setup.willWrite"));
      for (const [key, value] of harness.env(cfg, extra)) rows.push(`  ${key} = ${maskEnvValue(key, value, cfg.apiKey)}`);
      rows.push(`  ${profilePath}`);
    }
    panel(io, t("setup.title", { name: harness.name }), rows);
  };

  if (flags.print) {
    preview();
    if (id === "codex") {
      const blocks = renderCodexBlocks({ ...cfg, apiKey: maskKey(cfg.apiKey) }, { model: cfg.model });
      io.out(`${blocks.top}\n…\n${blocks.provider}`);
    } else {
      io.out(renderEnvBlock(id, { ...cfg, apiKey: maskKey(cfg.apiKey) }, { shell: profileShell(profilePath), extra }));
    }
    return 0;
  }

  if (!flags.json) preview();

  if (io.stdin?.isTTY && !assumeConnect && !flags.yes) {
    const actions = [
      { code: "connect", label: t("setup.actions.connect") },
      { code: "check", label: t("setup.actions.check") },
      ...(status.connected ? [{ code: "disconnect", label: t("setup.actions.disconnect") }] : []),
      { code: "cancel", label: t("setup.actions.cancel") },
    ];
    const picked = await uiFns.select(io, actions, {
      title: `${harness.name} · ${status.connected ? t("setup.statusOn") : t("setup.statusOff")}`,
    });
    if (!picked || picked.item.code === "cancel") return 0;
    if (picked.item.code === "check") {
      const probe = await probeAndReport(id, cfg, io);
      return probe.supported ? 0 : 1;
    }
    if (picked.item.code === "disconnect") return disconnectHarness({ id, env, io, profilePath });
  }

  const probe = await probeAndReport(id, cfg, io, { quiet: true });
  if (!probe.supported) io.out(describeProbe(probe, cfg));

  let result;
  try {
    result = await applyHarness({ id, cfg, env, profilePath, noApply: Boolean(flags["no-apply"]) });
  } catch (err) {
    if (err instanceof CodexConfigConflict) {
      io.out(`${SYM.err} ${t("setup.codexConflict", { path: harness.configFile(env) })}`);
      return 1;
    }
    throw err;
  }

  if (!flags.json) {
    if (id === "tui") {
      io.out(t("setup.wroteConfig", { path: extra.configPath }));
      io.out(t("setup.wroteBrand", { path: extra.tuiConfigPath }));
    }
    if (result.configFile) {
      io.out(t("setup.wroteCodex", { path: result.configFile.path }));
      if (result.configFile.backup) io.out(t("setup.backup", { backup: result.configFile.backup }));
    }
    if (result.envFile) io.out(t("setup.wroteEnv", { path: result.envFile }));
    if (result.profile) {
      io.out(result.profile.backup
        ? t("setup.appliedProfile", { path: result.profile.path, backup: result.profile.backup })
        : t("setup.appliedProfileNew", { path: result.profile.path }));
    }
    // Codex đọc config.toml mỗi lần chạy: không cần mở terminal mới.
    io.out(t(result.configFile ? "setup.connectedNow" : "setup.connected", { command: id === "tui" ? "crizon-ai tui" : harness.command }));
    if (id === "tui") io.out(t("setup.tuiHint"));
  }
  if (flags.json) {
    io.out(JSON.stringify({
      ok: true,
      harness: id,
      envFile: result.envFile,
      configFile: result.configFile?.path ?? null,
      profilePath,
      applied: Boolean(result.profile || result.configFile),
      gatewaySupported: probe.supported,
      gatewayStatus: probe.status,
    }, null, 2));
  }
  return 0;
}

export async function disconnectHarness({ id, env = process.env, io, profilePath, quiet = false }) {
  const harness = HARNESSES[id];
  const removed = harness.remove ? harness.remove({ env }) : removeProfileBlock(profilePath, id);
  cleanupHarness(env, id);
  const file = loadConfigFile(env);
  const harnessConfigs = { ...(file.harnessConfigs ?? {}) };
  const hadConfig = Boolean(harnessConfigs[id]);
  delete harnessConfigs[id];
  if (hadConfig || file.harness === id) {
    updateConfigFile({ ...(hadConfig ? { harnessConfigs } : {}), ...(file.harness === id ? { harness: "chat" } : {}) }, env);
  }
  if (!quiet) {
    io.out(t("setup.disconnected", { name: harness.name }));
    if (removed.removed) io.out(t("setup.removedFrom", { path: removed.path }));
  }
  return 0;
}

/**
 * Chưa có key: cho chọn đăng nhập bằng trình duyệt (khuyên dùng) hoặc dán key.
 * Trả true khi đã lưu được key.
 */
async function askForKey({ env, io, uiFns, deps = {} }) {
  const method = await uiFns.select(io, [
    { code: "browser", label: t("key.methodBrowser") },
    { code: "paste", label: t("key.methodPaste") },
  ], { title: t("key.methodTitle") });
  if (!method) return false;
  if (method.item.code === "browser") {
    const login = deps.browserLogin ?? runBrowserLogin;
    return Boolean(await login({ env, io, open: deps.open ?? openUrl }));
  }
  const entered = await promptApiKey({ cfg: resolveConfig({ env }), io, uiFns });
  if (!entered) return false;
  const path = saveConfigFile({ ...loadConfigFile(env), apiKey: entered.apiKey }, env);
  io.out(t("login.saved", { path }));
  return true;
}

export async function cmdSetup({ flags = {}, env = process.env, io = defaultIo(), ui = {}, deps = {} } = {}) {
  const uiFns = { select, searchSelect, inputHidden, askLine, confirm, ...ui };
  let cfg = resolveConfig({ flags, env });
  if (!cfg.apiKey) {
    if (!io.stdin?.isTTY) {
      io.out(`${SYM.err} ${t("err.noKey")}`);
      return 2;
    }
    if (!(await askForKey({ env, io, uiFns, deps }))) return 0;
    cfg = resolveConfig({ flags, env });
  }
  let id = flags._?.[0];
  if (id !== undefined && !isHarnessId(id)) {
    io.out(`${SYM.err} ${t("setup.usage")}`);
    return 2;
  }
  if (id !== undefined) id = resolveHarnessId(id);
  if (!id) {
    if (!io.stdin?.isTTY) {
      io.out(t("setup.usage"));
      return 2;
    }
    const picked = await uiFns.select(
      io,
      Object.values(HARNESSES).map((harness) => ({ id: harness.id, label: harness.description })),
      { title: t("agents.title") },
    );
    if (!picked) return 0;
    id = picked.item.id;
  }
  return setupHarness({ id, cfg, flags, env, io, uiFns });
}

export async function cmdDisconnect({ flags = {}, env = process.env, io = defaultIo(), ui = {} } = {}) {
  const uiFns = { select, ...ui };
  let id = flags._?.[0];
  if (id === undefined) {
    if (!io.stdin?.isTTY) {
      io.out(t("setup.usage"));
      return 2;
    }
    const profilePath = detectProfilePath(process.platform, env);
    const items = Object.values(HARNESSES).map((harness) => {
      const status = harnessStatus(env, harness.id, { profilePath });
      return { id: harness.id, label: `${harness.name}  ${status.connected ? t("setup.statusOn") : t("setup.statusOff")}` };
    });
    const picked = await uiFns.select(io, items, { title: t("agents.title") });
    if (!picked) return 0;
    id = picked.item.id;
  }
  if (!isHarnessId(id)) {
    io.out(`${SYM.err} ${t("setup.usage")}`);
    return 2;
  }
  id = resolveHarnessId(id);
  const profilePath = flags.profile ? String(flags.profile) : detectProfilePath(process.platform, env);
  return disconnectHarness({ id, env, io, profilePath });
}

export async function agentsMenu({ env = process.env, io = defaultIo(), ui = {}, flags = {} } = {}) {
  const uiFns = { select, searchSelect, inputHidden, askLine, ...ui };
  const profilePath = flags.profile ? String(flags.profile) : detectProfilePath(process.platform, env);
  for (;;) {
    const cfg = resolveConfig({ flags, env });
    const items = Object.values(HARNESSES).map((harness) => {
      const status = harnessStatus(env, harness.id, { profilePath });
      return { id: harness.id, label: `${harness.name}  ${status.connected ? t("setup.statusOn") : t("setup.statusOff")}` };
    });
    const picked = await uiFns.select(io, items, { title: t("agents.title") });
    if (!picked) return 0;
    const id = picked.item.id;
    const harness = HARNESSES[id];
    const status = harnessStatus(env, id, { profilePath });
    const actions = [
      status.connected
        ? { code: "disconnect", label: t("setup.actions.disconnect") }
        : { code: "connect", label: t("setup.actions.connect") },
      { code: "check", label: t("setup.actions.check") },
      { code: "back", label: t("common.back") },
    ];
    const action = await uiFns.select(io, actions, {
      title: `${harness.name} · ${status.connected ? t("setup.statusOn") : t("setup.statusOff")}`,
    });
    if (!action || action.item.code === "back") continue;
    if (action.item.code === "check") {
      await probeAndReport(id, cfg, io);
      await askLine(io, "");
      continue;
    }
    if (action.item.code === "disconnect") {
      await disconnectHarness({ id, env, io, profilePath });
      continue;
    }
    await setupHarness({ id, cfg, flags, env, io, uiFns, assumeConnect: true });
  }
}
