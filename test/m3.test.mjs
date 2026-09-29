import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { agentsMenu, agentsStatusLine, cmdDisconnect, cmdSetup } from "../src/commands.mjs";
import { runDoctor } from "../src/doctor.mjs";
import {
  HARNESSES,
  applyProfileBlock,
  detectProfilePath,
  gatewayOrigin,
  harnessStatus,
  managedBrandFile,
  managedConfigFile,
  managedDoctorFile,
  managedEnvFile,
  managedGoalFile,
  managedGoalPluginFile,
  managedTuiConfigFile,
  probeCompat,
  profileShell,
  removeProfileBlock,
  renderEnvBlock,
  renderManagedEnv,
  renderOpencodeConfig,
} from "../src/harness.mjs";

function makeIo() {
  const lines = [];
  const writes = [];
  const errs = [];
  return {
    io: {
      out: (line = "") => lines.push(String(line)),
      write: (text) => writes.push(String(text)),
      err: (line = "") => errs.push(String(line)),
    },
    lines,
    writes,
    errs,
  };
}

function startFixture({ compat = true } = {}) {
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.url === "/v1/models") {
      if (auth !== "Bearer testkey") return send(401, { error: { code: "invalid_api_key", retryable: false } });
      return send(200, { object: "list", data: [{ id: "crizon/gpt-standard", owned_by: "crizon" }] });
    }
    if (req.method === "HEAD" && (req.url === "/v1/messages" || req.url === "/v1/responses")) {
      res.writeHead(compat ? 204 : 404);
      res.end();
      return;
    }
    send(404, { error: { code: "not_found", retryable: false } });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no address");
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

function tempEnv(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-ai-m3-"));
  const env = {
    ...process.env,
    CRIZON_CONFIG_PATH: join(dir, "config.json"),
    CRIZON_HOME: join(dir, "home"),
    CRIZON_PROFILE_PATH: join(dir, "profile.ps1"),
  };
  delete env.CRIZON_API_KEY;
  delete env.CRIZON_BASE_URL;
  delete env.CRIZON_MODEL;
  delete env.CRIZON_LANG;
  return { env: { ...env, ...extra }, dir };
}

test("harness: gatewayOrigin + env lines cho claude/codex", () => {
  assert.equal(gatewayOrigin("https://ai.crizonshop.com/v1"), "https://ai.crizonshop.com");
  assert.equal(gatewayOrigin("https://ai.crizonshop.com/"), "https://ai.crizonshop.com");
  const claude = HARNESSES.claude.env({ baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "deepseek-chat" });
  assert.deepEqual(claude[0], ["ANTHROPIC_BASE_URL", "https://gw.test"]);
  assert.deepEqual(claude[1], ["ANTHROPIC_AUTH_TOKEN", "czn_x"]);
  assert.deepEqual(claude[2], ["ANTHROPIC_MODEL", "deepseek-chat"]);
  const codex = HARNESSES.codex.env({ baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "" });
  assert.deepEqual(codex[0], ["OPENAI_BASE_URL", "https://gw.test/v1"]);
  assert.deepEqual(codex[1], ["OPENAI_API_KEY", "czn_x"]);
  assert.equal(codex.length, 2);
});

test("harness: renderManagedEnv + renderEnvBlock theo shell", () => {
  const managed = renderManagedEnv("claude", { baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "" });
  assert.match(managed, /ANTHROPIC_BASE_URL=https:\/\/gw\.test\n/);
  assert.match(managed, /ANTHROPIC_AUTH_TOKEN=czn_x\n/);
  const bash = renderEnvBlock("claude", { baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "" }, { shell: "bash" });
  assert.match(bash, /^# >>> crizon-ai \(claude\) >>>/m);
  assert.match(bash, /export ANTHROPIC_BASE_URL="https:\/\/gw\.test"/);
  assert.match(bash, /# <<< crizon-ai <<</);
  const ps = renderEnvBlock("codex", { baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "" }, { shell: "powershell" });
  assert.match(ps, /\$env:OPENAI_API_KEY = "czn_x"/);
  assert.equal(profileShell("x.ps1"), "powershell");
  assert.equal(profileShell("x/.bashrc"), "bash");
});

test("harness: apply → replace (có backup, không trùng khối) → remove", () => {
  const { dir } = tempEnv();
  const profile = join(dir, "profile.ps1");
  writeFileSync(profile, "# user profile\n");
  const cfg = { baseUrl: "https://gw.test/v1", apiKey: "czn_first", model: "" };
  const first = applyProfileBlock(profile, "claude", cfg);
  assert.ok(first.backup);
  const content1 = readFileSync(profile, "utf8");
  assert.match(content1, /# user profile/);
  assert.match(content1, /\$env:ANTHROPIC_AUTH_TOKEN = "czn_first"/);
  assert.equal(content1.split("# >>> crizon-ai (claude) >>>").length - 1, 1);

  const second = applyProfileBlock(profile, "claude", { ...cfg, apiKey: "czn_second" });
  assert.ok(second.backup);
  const content2 = readFileSync(profile, "utf8");
  assert.equal(content2.split("# >>> crizon-ai (claude) >>>").length - 1, 1);
  assert.match(content2, /czn_second/);
  assert.ok(!content2.includes("czn_first"));

  const removed = removeProfileBlock(profile, "claude");
  assert.equal(removed.removed, true);
  const content3 = readFileSync(profile, "utf8");
  assert.ok(!content3.includes("crizon-ai"));
  assert.match(content3, /# user profile/);
});

test("harness: apply vào file chưa tồn tại + detectProfilePath/status", () => {
  const { env, dir } = tempEnv();
  const profile = join(dir, "nested", "profile.sh");
  applyProfileBlock(profile, "codex", { baseUrl: "https://gw.test/v1", apiKey: "czn_x", model: "" });
  assert.ok(existsSync(profile));
  assert.equal(detectProfilePath("win32", env), env.CRIZON_PROFILE_PATH);
  const status = harnessStatus(env, "codex", { profilePath: profile });
  assert.equal(status.connected, true);
  assert.equal(status.profile, true);
  assert.equal(status.managed, false);
  assert.ok(managedEnvFile(env, "codex").startsWith(String(env.CRIZON_HOME)));
});

test("probeCompat: 204 = hỗ trợ, 404 = chưa, cổng chết = không kết nối", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const ok = await probeCompat(fixture.baseUrl, "claude");
  assert.equal(ok.status, 204);
  assert.equal(ok.supported, true);
  assert.match(ok.url, /\/v1\/messages$/);

  const missing = await startFixture({ compat: false });
  t.after(() => missing.server.close());
  const notYet = await probeCompat(missing.baseUrl, "codex");
  assert.equal(notYet.status, 404);
  assert.equal(notYet.supported, false);

  const dead = await probeCompat("http://127.0.0.1:1/v1", "claude", { timeoutMs: 1_000 });
  assert.equal(dead.status, 0);
  assert.equal(dead.supported, false);
});

test("cmdSetup: kết nối claude (ghi env 600 + profile + config), không lộ key ra stdout", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  const { io, lines } = makeIo();
  const code = await cmdSetup({
    flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["claude"] },
    env,
    io,
  });
  assert.equal(code, 0);
  const text = lines.join("\n");
  assert.ok(!text.includes("testkey"), "stdout không được chứa raw key");
  const envFile = managedEnvFile(env, "claude");
  assert.ok(existsSync(envFile));
  const envText = readFileSync(envFile, "utf8");
  assert.match(envText, /ANTHROPIC_AUTH_TOKEN=testkey/);
  assert.match(envText, new RegExp(`ANTHROPIC_BASE_URL=${fixture.baseUrl.replace(/\/v1$/, "").replace(/[.:/]/g, (c) => `\\${c}`)}\n`));
  const profile = readFileSync(String(env.CRIZON_PROFILE_PATH), "utf8");
  assert.match(profile, /\$env:ANTHROPIC_AUTH_TOKEN = "testkey"/);
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.harness, "claude");
  assert.ok(saved.harnessConfigs.claude.connectedAt);
  assert.equal(saved.harnessConfigs.claude.applied, true);
});

test("cmdSetup: --no-apply chỉ ghi file env; --print không ghi gì", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  const { io, lines } = makeIo();
  const code = await cmdSetup({
    flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["claude"], "no-apply": true, yes: true },
    env,
    io,
  });
  assert.equal(code, 0);
  assert.ok(existsSync(managedEnvFile(env, "claude")));
  assert.ok(!existsSync(String(env.CRIZON_PROFILE_PATH)));

  const { env: env2 } = tempEnv();
  const printed = makeIo();
  const code2 = await cmdSetup({
    flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["claude"], print: true },
    env: env2,
    io: printed.io,
  });
  assert.equal(code2, 0);
  const text = printed.lines.join("\n");
  assert.ok(!text.includes("testkey"));
  assert.match(text, /ANTHROPIC_AUTH_TOKEN/);
  assert.ok(!existsSync(managedEnvFile(env2, "claude")));
  assert.ok(!existsSync(String(env2.CRIZON_PROFILE_PATH)));
});

test("cmdDisconnect: gỡ khối + xoá env + reset config", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  await cmdSetup({ flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["claude"] }, env, io: makeIo().io });
  assert.ok(existsSync(managedEnvFile(env, "claude")));
  const { io, lines } = makeIo();
  const code = await cmdDisconnect({ flags: { _: ["claude"] }, env, io });
  assert.equal(code, 0);
  assert.ok(lines.join("\n").includes("Claude Code"));
  assert.ok(!existsSync(managedEnvFile(env, "claude")));
  assert.ok(!readFileSync(String(env.CRIZON_PROFILE_PATH), "utf8").includes("crizon-ai"));
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.harness, "chat");
  assert.ok(!saved.harnessConfigs?.claude);
});

test("agentsMenu: connect claude qua panel rồi thoát; status line ● ○", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const { env } = tempEnv();
  const { io } = makeIo();
  const answers = [
    { index: 0, item: { id: "claude" } },
    { index: 0, item: { code: "connect" } },
    null,
  ];
  const ui = { select: async () => answers.shift() ?? null };
  const code = await agentsMenu({
    env,
    io,
    ui,
    flags: { key: "testkey", "base-url": fixture.baseUrl },
  });
  assert.equal(code, 0);
  const saved = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(saved.harness, "claude");
  assert.ok(existsSync(managedEnvFile(env, "claude")));
  const line = agentsStatusLine(env, {});
  assert.match(line, /Claude ●/);
  assert.match(line, /Codex ○/);
});

test("opencode: config provider Crizon + setup/disconnect", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const sample = JSON.parse(renderOpencodeConfig(
    { baseUrl: fixture.baseUrl, apiKey: "k", model: "crizon/gpt-standard" },
    ["crizon/gpt-standard", "crizon/deepseek-pro"],
    { goalScript: "C:\\crizon\\harness\\opencode-goal.mjs", goalPlugin: "C:\\crizon\\harness\\opencode-goal-plugin.mjs", doctorScript: "C:\\crizon\\harness\\opencode-doctor.mjs", configPath: "C:\\crizon\\harness\\opencode.json" },
  ));
  assert.ok(sample.plugin.includes("C:\\crizon\\harness\\opencode-goal-plugin.mjs"), "plugin server phải được khai báo");
  assert.ok(!sample.command.crizon, "panel tự vẽ đã bỏ khỏi menu");
  assert.ok(!sample.command.fcc, "panel FCC local đã bỏ khỏi menu");
  assert.match(sample.command.doctor.template, /opencode-doctor\.mjs/, "lệnh /doctor chạy script doctor");
  assert.match(sample.command.doctor.template, /--config "C:\\crizon\\harness\\opencode\.json"/, "lệnh /doctor truyền đúng config path");
  assert.equal(sample.provider.crizon.npm, "@ai-sdk/openai-compatible");
  assert.equal(sample.provider.crizon.name, "Crizon AI");
  assert.equal(sample.provider.crizon.options.baseURL, fixture.baseUrl);
  assert.ok(sample.provider.crizon.models["crizon/deepseek-pro"]);
  assert.equal(sample.model, "crizon/crizon/gpt-standard");
  const variants = sample.provider.crizon.models["crizon/gpt-standard"].variants;
  assert.deepEqual(Object.keys(variants), ["tắt", "nhanh", "cân-bằng", "sâu"]);
  assert.deepEqual(variants["tắt"], { thinking: { type: "disabled" } });
  assert.equal(variants["nhanh"].reasoningEffort, "low");
  assert.equal(variants["sâu"].reasoningEffort, "max");
  assert.equal(sample.share, "disabled", "không đẩy session lên opencode.ai");
  assert.equal(sample.command.goal.agent, "goal-runner");
  assert.equal(sample.command.goal.subtask, false, "chạy ở phiên chính để hiện thanh nhiệm vụ (giống Claude/Codex)");
  assert.match(sample.command.goal.template, /\$ARGUMENTS/);
  assert.equal(sample.agent["goal-runner"].mode, "all");
  assert.ok(sample.agent["goal-runner"].prompt.length > 100);
  assert.equal(sample.agent["goal-runner"].permission.bash["git push*"], "deny");
  assert.equal(sample.agent["goal-runner"].permission.bash["*"], "allow");
  assert.equal(sample.agent["goal-runner"].permission.todowrite, "allow", "subagent cần quyền todowrite");
  assert.ok(!("permissions" in sample.agent["goal-runner"]), "runtime V1 không nhận V2 permissions");
  assert.ok(!sample.command.goal.template.includes("__GOAL_SCRIPT__"), "placeholder phải được thay");
  assert.match(sample.command.goal.template, /opencode-goal\.mjs/);
  assert.match(sample.command.goal.template, /opencode-goal\.mjs" status/);
  assert.match(sample.command.goal.template, /accept add/);
  assert.match(sample.command.goal.template, /item add/);
  assert.match(sample.command.goal.template, /todowrite/);
  assert.match(sample.command.goal.template, /budget/);
  assert.match(sample.command.goal.template, /approve/);
  assert.match(sample.command.goal.template, /item fail/);
  assert.match(sample.command.goal.template, /pause/);
  assert.match(sample.command.goal.template, /goal\.json/);

  const { env } = tempEnv();
  const { io, lines } = makeIo();
  const code = await cmdSetup({
    flags: { key: "testkey", "base-url": fixture.baseUrl, _: ["opencode"] },
    env,
    io,
  });
  assert.equal(code, 0);
  const configFile = managedConfigFile(env, "opencode");
  assert.ok(existsSync(configFile), "phải ghi config OpenCode");
  const saved = JSON.parse(readFileSync(configFile, "utf8"));
  assert.equal(saved.provider.crizon.options.apiKey, "testkey");
  assert.ok(Object.keys(saved.provider.crizon.models).length >= 1);
  assert.ok(saved.command?.goal, "config OpenCode phải có lệnh /goal");
  assert.equal(saved.share, "disabled", "config phải tắt share mặc định");
  assert.equal(saved.command.goal.agent, "goal-runner");
  assert.match(saved.command.goal.template, /opencode-goal\.mjs/);
  assert.ok(existsSync(managedGoalFile(env, "opencode")), "phải copy script goal vào harness");
  const goalScript = readFileSync(managedGoalFile(env, "opencode"), "utf8");
  assert.match(goalScript, /"\.opencode", "goal\.json"/, "script lưu trạng thái ở .opencode/goal.json");
  assert.match(goalScript, /complete/);
  assert.ok(existsSync(managedGoalPluginFile(env, "opencode")), "phải copy plugin server goal");
  assert.deepEqual(saved.plugin, [managedGoalPluginFile(env, "opencode")], "config phải trỏ plugin server goal");
  assert.ok(existsSync(managedDoctorFile(env, "opencode")), "phải copy script doctor");
  assert.match(saved.command.doctor.template, /opencode-doctor\.mjs/);
  assert.match(saved.command.doctor.template, /opencode\.json/);
  assert.ok(!saved.command.fcc, "panel FCC local đã bỏ");
  assert.ok(!saved.command.crizon, "panel tự vẽ đã bỏ");
  assert.ok(saved.agent?.["goal-runner"], "config OpenCode phải có agent goal-runner");
  assert.match(saved.agent["goal-runner"].prompt, /goal-runner/, "prompt giữ nhân xưng goal-runner");
  assert.equal(saved.agent["goal-runner"].permission.bash["rm -rf*"], "deny");
  const envText = readFileSync(managedEnvFile(env, "opencode"), "utf8");
  assert.match(envText, /OPENCODE_CONFIG=.*opencode\.json/);
  assert.match(envText, /OPENCODE_TUI_CONFIG=.*opencode-tui\.json/);
  assert.match(envText, /CRIZON_LANG=vi/);
  const tuiConfigFile = managedTuiConfigFile(env, "opencode");
  assert.ok(existsSync(tuiConfigFile), "phải ghi tui config (thương hiệu)");
  const tuiConfig = JSON.parse(readFileSync(tuiConfigFile, "utf8"));
  assert.deepEqual(tuiConfig.plugin, [["./opencode-brand.tsx", {}]]);
  const brandFile = managedBrandFile(env, "opencode");
  assert.ok(existsSync(brandFile), "phải copy plugin thương hiệu");
  const brandSource = readFileSync(brandFile, "utf8");
  assert.match(brandSource, /crizon\.brand/);
  assert.match(brandSource, /Cổng API AI/, "i18n vi");
  assert.match(brandSource, /AI API gateway/, "i18n en");
  assert.ok(!brandSource.includes("한국어"), "đã bỏ tiếng Hàn");
  assert.ok(!brandSource.includes("C R I Z O N   A I"), "không còn tiêu đề trên cùng");
  assert.match(brandSource, /slashName: "language"/, "phải có lệnh /language trong menu OpenCode");
  assert.match(brandSource, /desc:/, "lệnh /language phải có mô tả (desc) cho command palette");
  assert.ok(!/from "node:/.test(brandSource), "plugin không dùng node builtins (load an toàn)");
  assert.match(brandSource, /DIALOG_TITLE/, "dialog /language phải i18n");
  assert.match(brandSource, /TOAST/, "toast /language phải i18n");
  assert.match(brandSource, /setInterval/, "phải có hiệu ứng animation");
  assert.ok(!lines.join("\n").includes("testkey"), "stdout không được chứa raw key");
  const config = JSON.parse(readFileSync(String(env.CRIZON_CONFIG_PATH), "utf8"));
  assert.equal(config.harness, "opencode");

  const dis = makeIo();
  const code2 = await cmdDisconnect({ flags: { _: ["opencode"] }, env, io: dis.io });
  assert.equal(code2, 0);
  assert.ok(!existsSync(configFile));
  assert.ok(!existsSync(managedGoalFile(env, "opencode")), "disconnect phải xoá script goal");
  assert.ok(!existsSync(managedGoalPluginFile(env, "opencode")), "disconnect phải xoá plugin server goal");
  assert.ok(!existsSync(managedDoctorFile(env, "opencode")), "disconnect phải xoá script doctor");
  assert.ok(!existsSync(managedEnvFile(env, "opencode")));
  assert.ok(!existsSync(tuiConfigFile));
  assert.ok(!existsSync(brandFile));
});

test("doctor: báo kết nối + hỗ trợ gateway đúng", async (t) => {
  const fixture = await startFixture({ compat: true });
  t.after(() => fixture.server.close());
  const { env } = tempEnv({ CRIZON_BASE_URL: fixture.baseUrl, CRIZON_API_KEY: "testkey" });
  const ok = makeIo();
  const code = await runDoctor({ env, flags: { json: true }, io: ok.io, version: "1.0.0" });
  assert.equal(code, 0);
  const parsed = JSON.parse(ok.lines.join("\n"));
  assert.ok(parsed.rows.some((row) => row.label.includes("/v1/messages") && row.level === "ok"));
  assert.ok(parsed.rows.some((row) => row.label.includes("/v1/responses") && row.level === "ok"));
  assert.ok(parsed.rows.some((row) => row.label.includes("Codex") && row.value.includes("setup codex")));

  const missing = await startFixture({ compat: false });
  t.after(() => missing.server.close());
  const { env: env2 } = tempEnv({ CRIZON_BASE_URL: missing.baseUrl, CRIZON_API_KEY: "testkey" });
  const warn = makeIo();
  const code2 = await runDoctor({ env: env2, flags: {}, io: warn.io, version: "1.0.0" });
  assert.equal(code2, 0);
  assert.ok(warn.lines.join("\n").includes("404"));
});
