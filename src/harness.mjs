/** Kết nối harness (Claude Code / Codex) — ghi env có marker, backup, probe gateway. */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeDir } from "./config.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const MARKER_BEGIN = "# >>> crizon-ai >>>";
export const MARKER_END = "# <<< crizon-ai <<<";
export const blockBegin = (harnessId) => `# >>> crizon-ai (${harnessId}) >>>`;

export const HARNESSES = {
  claude: {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    hint: "npm i -g @anthropic-ai/claude-code",
    description: "Claude Code (harness Claude Code, model qua API Crizon)",
    env(cfg) {
      const rows = [
        ["ANTHROPIC_BASE_URL", gatewayOrigin(cfg.baseUrl)],
        ["ANTHROPIC_AUTH_TOKEN", cfg.apiKey],
      ];
      if (cfg.model) rows.push(["ANTHROPIC_MODEL", cfg.model]);
      return rows;
    },
  },
  codex: {
    id: "codex",
    name: "Codex",
    command: "codex",
    hint: "npm i -g @openai/codex",
    description: "Codex (model qua API Crizon)",
    env(cfg) {
      const rows = [
        ["OPENAI_BASE_URL", String(cfg.baseUrl || "").replace(/\/+$/, "")],
        ["OPENAI_API_KEY", cfg.apiKey],
      ];
      return rows;
    },
  },
  aider: {
    id: "aider",
    name: "Aider",
    command: "aider",
    hint: "python -m pip install aider-install && aider-install",
    description: "Aider (pair-programming trong terminal, model qua API Crizon)",
    env(cfg) {
      const rows = [
        ["OPENAI_API_BASE", String(cfg.baseUrl || "").replace(/\/+$/, "")],
        ["OPENAI_API_KEY", cfg.apiKey],
      ];
      if (cfg.model) rows.push(["AIDER_MODEL", `openai/${cfg.model}`]);
      return rows;
    },
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    command: "qwen",
    hint: "npm i -g @qwen-code/qwen-code",
    description: "Qwen Code (CLI agent, model qua API Crizon)",
    env(cfg) {
      const rows = [
        ["OPENAI_BASE_URL", String(cfg.baseUrl || "").replace(/\/+$/, "")],
        ["OPENAI_API_KEY", cfg.apiKey],
      ];
      if (cfg.model) rows.push(["OPENAI_MODEL", cfg.model]);
      return rows;
    },
  },
  tui: {
    id: "tui",
    name: "TUI Crizon",
    command: "crizon-ai",
    hint: "crizon-ai tui (tự tải binary)",
    description: "TUI Crizon (chat/code trong terminal, model qua API Crizon)",
    env(cfg, extra = {}) {
      const rows = [];
      if (extra.configPath) rows.push(["OPENCODE_CONFIG", extra.configPath]);
      if (extra.tuiConfigPath) rows.push(["OPENCODE_TUI_CONFIG", extra.tuiConfigPath]);
      rows.push(["CRIZON_LANG", extra.lang || "vi"]);
      return rows;
    },
  },
};

export function isHarnessId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HARNESSES, resolveHarnessId(value));
}

/** Bí danh tương thích: `crizon-ai setup opencode` = harness "tui". */
export const HARNESS_ALIASES = { opencode: "tui" };

export function resolveHarnessId(value) {
  return HARNESS_ALIASES[value] ?? value;
}

/** https://ai.crizonshop.com/v1 → https://ai.crizonshop.com (SDK Anthropic tự thêm /v1). */
export function gatewayOrigin(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export function compatProbeUrl(harnessId, baseUrl) {
  // codex → Responses; aider/qwen (OpenAI-compatible) → /v1/models; còn lại → Anthropic Messages.
  const path =
    harnessId === "codex"
      ? "/v1/responses"
      : harnessId === "aider" || harnessId === "qwen"
        ? "/v1/models"
        : "/v1/messages";
  return `${gatewayOrigin(baseUrl)}${path}`;
}

export function managedEnvFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}.env`);
}

/** File config riêng cho harness dạng config (TUI Crizon). */
export function managedConfigFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}.json`);
}

/** Config TUI (plugin thương hiệu) + file plugin cho TUI Crizon. */
export function managedTuiConfigFile(env, harnessId) {
  const name = harnessId === "tui" ? "tui-config.json" : `${harnessId}-tui.json`;
  return join(homeDir(env), "harness", name);
}

export function managedBrandFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}-brand.tsx`);
}

/** Script quản lý trạng thái goal loop (tính năng Crizon). */
export function managedGoalFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}-goal.mjs`);
}

/** Plugin server (đếm token + briefing goal) — tính năng Crizon. */
export function managedGoalPluginFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}-goal-plugin.mjs`);
}

/** Script chẩn đoán `/crizon` (kiểu fcc-doctor). */
export function managedDoctorFile(env, harnessId) {
  return join(homeDir(env), "harness", `${harnessId}-doctor.mjs`);
}

export function renderTuiConfig(harnessId) {
  return `${JSON.stringify({
    $schema: "https://opencode.ai/tui.json",
    plugin: [[`./${harnessId}-brand.tsx`, {}]],
  }, null, 2)}\n`;
}

/** Nội dung plugin thương hiệu (asset trong repo). */
export function brandPluginSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "crizon-brand.tsx"), "utf8");
}

/** Lệnh /goal — tính năng của Crizon (TUI Crizon không có sẵn). */
export function goalCommandSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "goal-command.md"), "utf8").trimEnd();
}

/** Agent goal-runner — vòng lặp mục tiêu tự động (tính năng của Crizon). */
export function goalAgentSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "goal-agent.md"), "utf8").trimEnd();
}

/** Script quản lý trạng thái goal (.crizon/goal.json) — zero-dep Node. */
export function goalScriptSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "goal.mjs"), "utf8");
}

/** Plugin server goal (đếm token thật + chèn briefing vào system prompt). */
export function goalPluginSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "crizon-goal-plugin.mjs"), "utf8");
}

/** Script chẩn đoán kết nối `/crizon` — zero-dep Node. */
export function doctorScriptSource() {
  return readFileSync(join(moduleDir, "..", "assets", "tui", "crizon-doctor.mjs"), "utf8");
}

/** Config TUI Crizon: provider "crizon" trỏ vào gateway Crizon (không đụng config gốc). */
export function renderOpencodeConfig(cfg, modelIds = [], options = {}) {
  const ids = modelIds.length ? modelIds : cfg.model ? [cfg.model] : [];
  // Mức tư duy 3 bậc (khớp DeepSeek Harness + Codex). V1 runtime nhận Record<id, options>;
  // lowerer @ai-sdk/openai-compatible sẽ đổi reasoningEffort → reasoning_effort trong body.
  const variants = {
    "tắt": { thinking: { type: "disabled" } },
    "nhanh": { reasoningEffort: "low" },
    "cân-bằng": { reasoningEffort: "high" },
    "sâu": { reasoningEffort: "max" },
  };
  const models = {};
  for (const id of ids) models[id] = { name: id, variants: { ...variants } };
  const first = ids.includes(cfg.model) ? cfg.model : ids[0];
  const goalScript = options.goalScript || ".opencode/goal.mjs";
  return `${JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    provider: {
      crizon: {
        npm: "@ai-sdk/openai-compatible",
        name: "Crizon AI",
        options: { baseURL: cfg.baseUrl, apiKey: cfg.apiKey },
        models,
      },
    },
    ...(first ? { model: `crizon/${first}` } : {}),
    // Không đẩy session lên hạ tầng opencode.ai khi dùng qua Crizon (fail-closed).
    // Muốn bật lại: đổi thành "manual"/"auto" (hoặc dựng share service Crizon rồi trỏ enterprise.url).
    share: "disabled",
    ...(options.goalPlugin ? { plugin: [options.goalPlugin] } : {}),
    command: {
      goal: {
        description:
          "Mục tiêu tự động (goal loop): lập kế hoạch + tiêu chí nghiệm thu + todo — /goal pause|resume|complete|clear; trạng thái ở .crizon/goal.json",
        agent: "goal-runner",
        subtask: false,
        template: goalCommandSource().replaceAll("__GOAL_SCRIPT__", goalScript),
      },
      doctor: {
        description: "Chẩn đoán kết nối Crizon (bản text trong TUI, không mở trình duyệt)",
        template: [
          "CHẨN ĐOÁN CRIZON (tự động đọc):",
          '!`node "__DOCTOR_SCRIPT__" --config "__CONFIG_PATH__"`',
          "",
          "Tóm tắt ngắn gọn kết quả trên cho người dùng (giữ ✓/✗/•); nếu có ✗ thì nêu cách sửa. Không làm gì thêm.",
        ]
          .join("\n")
          .replaceAll("__DOCTOR_SCRIPT__", options.doctorScript || ".opencode/crizon-doctor.mjs")
          .replaceAll("__CONFIG_PATH__", options.configPath || "opencode.json"),
      },
    },
    agent: {
      "goal-runner": {
        description: "Goal runner — tự chạy vòng mục tiêu tới khi xong hoặc gặp blocker",
        mode: "all",
        steps: 40,
        prompt: goalAgentSource(),
        permission: {
          edit: "allow",
          webfetch: "allow",
          todowrite: "allow",
          bash: {
            "*": "allow",
            "git push*": "deny",
            "git reset --hard*": "deny",
            "Remove-Item -Recurse -Force*": "deny",
            "rm -rf*": "deny",
          },
        },
      },
    },
  }, null, 2)}\n`;
}

export function renderManagedEnv(harnessId, cfg, extra = {}) {
  return `${HARNESSES[harnessId].env(cfg, extra).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function escapeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "");
}

export function renderEnvBlock(harnessId, cfg, { shell = "bash", extra = {} } = {}) {
  const lines = [blockBegin(harnessId)];
  for (const [key, value] of HARNESSES[harnessId].env(cfg, extra)) {
    lines.push(shell === "powershell" ? `$env:${key} = "${escapeValue(value)}"` : `export ${key}="${escapeValue(value)}"`);
  }
  lines.push(MARKER_END);
  return `${lines.join("\n")}\n`;
}

export function profileShell(profilePath) {
  return /\.ps1$/i.test(String(profilePath)) ? "powershell" : "bash";
}

export function detectProfilePath(platform = process.platform, env = process.env) {
  if (env.CRIZON_PROFILE_PATH) return env.CRIZON_PROFILE_PATH;
  if (platform === "win32") {
    const documents = join(homedir(), "Documents");
    const candidates = [
      join(documents, "PowerShell", "Microsoft.PowerShell_profile.ps1"),
      join(documents, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }
  const home = homedir();
  const candidates = [join(home, ".zshrc"), join(home, ".bashrc"), join(home, ".profile")];
  return candidates.find((candidate) => existsSync(candidate)) ?? join(home, ".profile");
}

function stripBlock(content, begin, end) {
  const start = content.indexOf(begin);
  if (start < 0) return content;
  const stop = content.indexOf(end, start);
  if (stop < 0) return content;
  const before = content.slice(0, start).replace(/\s*$/, (match) => match.replace(/\n{2,}$/, "\n"));
  const after = content.slice(stop + end.length).replace(/^\s*\n?/, (match) => (match ? "\n" : ""));
  const merged = `${before}${before && after.trim() ? "\n\n" : ""}${after.replace(/\s+$/, "")}`;
  return merged ? `${merged.replace(/\s+$/, "")}\n` : "";
}

export function hasProfileBlock(profilePath, harnessId) {
  try {
    return readFileSync(profilePath, "utf8").includes(blockBegin(harnessId));
  } catch {
    return false;
  }
}

/** Ghi (hoặc thay) khối marker trong profile; backup file cũ trước khi sửa. */
export function applyProfileBlock(profilePath, harnessId, cfg, extra = {}) {
  mkdirSync(dirname(profilePath), { recursive: true });
  const existed = existsSync(profilePath);
  const current = existed ? readFileSync(profilePath, "utf8") : "";
  let backup = null;
  if (current.trim()) {
    backup = `${profilePath}.crizon-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(profilePath, backup);
  }
  const cleaned = stripBlock(current, blockBegin(harnessId), MARKER_END);
  const block = renderEnvBlock(harnessId, cfg, { shell: profileShell(profilePath), extra });
  const next = `${cleaned ? `${cleaned.replace(/\s+$/, "")}\n\n` : ""}${block}`;
  writeFileSync(profilePath, next, "utf8");
  return { path: profilePath, backup, applied: true };
}

export function removeProfileBlock(profilePath, harnessId) {
  if (!existsSync(profilePath)) return { path: profilePath, removed: false };
  const current = readFileSync(profilePath, "utf8");
  if (!current.includes(blockBegin(harnessId))) return { path: profilePath, removed: false };
  const backup = `${profilePath}.crizon-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(profilePath, backup);
  const cleaned = stripBlock(current, blockBegin(harnessId), MARKER_END);
  writeFileSync(profilePath, cleaned, "utf8");
  return { path: profilePath, removed: true, backup };
}

export function harnessStatus(env, harnessId, { profilePath } = {}) {
  const managed = existsSync(managedEnvFile(env, harnessId));
  const profile = profilePath ? hasProfileBlock(profilePath, harnessId) : false;
  return { connected: managed || profile, managed, profile };
}

export function commandExists(name) {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  try {
    return spawnSync(probe, [name], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** HEAD {origin}/v1/messages|responses: 2xx/401/403/405 = có endpoint, 404 = chưa có. */
export async function probeCompat(baseUrl, harnessId, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  const url = compatProbeUrl(harnessId, baseUrl);
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = response.status;
    const supported = status !== 404 && status < 500;
    return { ok: supported, supported, status, url };
  } catch (error) {
    return { ok: false, supported: false, status: 0, url, error: error?.message || String(error) };
  }
}

export function cleanupHarness(env, harnessId) {
  let removed = false;
  const files = [
    managedEnvFile(env, harnessId),
    managedConfigFile(env, harnessId),
    managedTuiConfigFile(env, harnessId),
    managedBrandFile(env, harnessId),
    managedGoalFile(env, harnessId),
    managedGoalPluginFile(env, harnessId),
    managedDoctorFile(env, harnessId),
  ];
  for (const file of files) {
    try {
      rmSync(file);
      removed = true;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function maskEnvValue(key, value, apiKey) {
  if (!apiKey || value !== apiKey) return value;
  const raw = String(value);
  if (raw.length <= 12) return `${raw.slice(0, 4)}…`;
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}
