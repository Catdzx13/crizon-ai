import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { addMcp, listMcp, maskArgs, removeMcp, setMcpApp } from "../src/mcp-manager.mjs";
import { installGithubSkill, listSkills, parseGithubSkillUrl, previewGithubSkill, readFrontmatter, removeSkill, setSkillApp } from "../src/skills-manager.mjs";

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-mcp-"));
  const home = join(dir, "home");
  const env = { ...process.env, CRIZON_USER_HOME: home, CRIZON_HOME: join(dir, "crizon"), CODEX_HOME: join(home, ".codex") };
  delete env.CLAUDE_CONFIG_DIR;
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  return { env, home };
}

const CLAUDE_JSON = {
  numStartups: 12,
  projects: { "C:/work": { allowedTools: [] } },
  mcpServers: {
    github: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_supersecret123" } },
  },
};

const CODEX_TOML = [
  'model = "gpt-5"',
  "",
  "# >>> crizon-ai (codex-provider) >>>",
  "[model_providers.crizon]",
  'base_url = "https://ai.crizonshop.com/v1"',
  "# <<< crizon-ai <<<",
  "",
  "[mcp_servers.docs]",
  'url = "https://developers.example.com/mcp?key=abc123"',
  "",
  "[mcp_servers.docs.tools.search]",
  'approval_mode = "approve"',
  "",
  "[windows]",
  'sandbox = "elevated"',
  "",
].join("\r\n");

function seed(home) {
  writeFileSync(join(home, ".claude.json"), JSON.stringify(CLAUDE_JSON, null, 2));
  writeFileSync(join(home, ".codex", "config.toml"), CODEX_TOML);
}

const codexText = (home) => readFileSync(join(home, ".codex", "config.toml"), "utf8");
const claudeJson = (home) => JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
const states = (env, name) => listMcp(env).servers.find((server) => server.name === name)?.apps;

test("mcp: gộp server từ Claude Code + Codex, không lộ giá trị env/khoá trong URL", () => {
  const { env, home } = tempEnv();
  seed(home);
  const list = listMcp(env);
  assert.deepEqual(list.servers.map((server) => server.name), ["docs", "github"]);
  assert.deepEqual(states(env, "github"), { claude: "on", codex: "absent", cursor: "missing", "claude-desktop": "missing", gemini: "missing", qwen: "missing" });
  assert.equal(states(env, "docs").codex, "on");
  const github = list.servers.find((server) => server.name === "github").summary;
  assert.deepEqual(github.envKeys, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  const text = JSON.stringify(list);
  assert.ok(!text.includes("ghp_supersecret123"));
  assert.ok(!text.includes("abc123"));
});

test("mcp: bật github cho Codex = chép sang TOML (giữ CRLF, khối crizon và bảng khác)", () => {
  const { env, home } = tempEnv();
  seed(home);
  const backups = new Set();
  setMcpApp(env, "github", "codex", true, { backups });
  const text = codexText(home);
  assert.ok(text.includes("\r\n") && !/[^\r]\n/.test(text));
  assert.match(text, /\[mcp_servers\.github\]\r\ncommand = "npx"\r\nargs = \["-y", "@modelcontextprotocol\/server-github@2025\.4\.8"\]\r\n\r\n\[mcp_servers\.github\.env\]\r\nGITHUB_PERSONAL_ACCESS_TOKEN = "ghp_supersecret123"/);
  assert.ok(text.startsWith(CODEX_TOML.trimEnd()));
  assert.equal(states(env, "github").codex, "on");
  assert.equal(readdirSync(join(home, ".codex")).filter((name) => name.includes(".crizon-backup-")).length, 1);
});

test("mcp: tắt/bật ở Codex dùng enabled = false, giữ nguyên tools.* của người dùng", () => {
  const { env, home } = tempEnv();
  seed(home);
  setMcpApp(env, "docs", "codex", false);
  assert.match(codexText(home), /\[mcp_servers\.docs\]\r\nenabled = false\r\nurl = /);
  assert.match(codexText(home), /\[mcp_servers\.docs\.tools\.search\]\r\napproval_mode = "approve"/);
  assert.equal(states(env, "docs").codex, "off");
  setMcpApp(env, "docs", "codex", true);
  assert.equal(codexText(home), CODEX_TOML);
});

test("mcp: tắt ở Claude Code = cất vào kho Crizon rồi gỡ; bật lại trả về nguyên vẹn, khoá khác không đổi", () => {
  const { env, home } = tempEnv();
  seed(home);
  setMcpApp(env, "github", "claude", false);
  const after = claudeJson(home);
  assert.deepEqual(after.mcpServers, {});
  assert.equal(after.numStartups, 12);
  assert.deepEqual(after.projects, CLAUDE_JSON.projects);
  assert.equal(states(env, "github").claude, "off");
  setMcpApp(env, "github", "claude", true);
  assert.deepEqual(claudeJson(home), CLAUDE_JSON);
  assert.deepEqual(JSON.parse(readFileSync(join(env.CRIZON_HOME, "mcp-off.json"), "utf8")), {});
});

test("mcp: chép sang Gemini (httpUrl) / Cursor; xoá khỏi mọi app gỡ cả tools.* nhưng giữ khối crizon", () => {
  const { env, home } = tempEnv();
  seed(home);
  mkdirSync(join(home, ".gemini"));
  mkdirSync(join(home, ".cursor"));
  writeFileSync(join(home, ".gemini", "settings.json"), JSON.stringify({ theme: "Default" }, null, 2));
  setMcpApp(env, "docs", "gemini", true);
  setMcpApp(env, "docs", "cursor", true);
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf8")), { theme: "Default", mcpServers: { docs: { httpUrl: "https://developers.example.com/mcp?key=abc123" } } });
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.docs, { url: "https://developers.example.com/mcp?key=abc123" });
  removeMcp(env, "docs");
  const text = codexText(home);
  assert.ok(!text.includes("mcp_servers.docs"));
  assert.match(text, /# <<< crizon-ai <<<\r\n\r\n\[windows\]/);
  assert.equal(listMcp(env).servers.some((server) => server.name === "docs"), false);
  assert.throws(() => removeMcp(env, "docs"), { code: "not_found" });
});

test("mcp: thêm server mới — kiểm tra tên, URL, loại app hỗ trợ, trùng tên", () => {
  const { env, home } = tempEnv();
  seed(home);
  addMcp(env, { name: "fs", def: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2025.8.21", "C:/work"], env: {} }, apps: ["claude", "codex"] });
  assert.deepEqual(claudeJson(home).mcpServers.fs, { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2025.8.21", "C:/work"] });
  assert.match(codexText(home), /\[mcp_servers\.fs\]/);
  assert.throws(() => addMcp(env, { name: "fs", def: { type: "stdio", command: "x" }, apps: ["claude"] }), { code: "exists" });
  assert.throws(() => addMcp(env, { name: "a b", def: { type: "stdio", command: "x" }, apps: ["claude"] }), { code: "invalid_name" });
  assert.throws(() => addMcp(env, { name: "web", def: { type: "http", url: "javascript:alert(1)" }, apps: ["claude"] }), { code: "invalid_def" });
  assert.throws(() => addMcp(env, { name: "web", def: { type: "sse", url: "https://x.test/sse" }, apps: ["codex"] }), { code: "unsupported_kind" });
  assert.throws(() => addMcp(env, { name: "web", def: { type: "stdio", command: "x\ny" }, apps: ["claude"] }), { code: "invalid_def" });
  assert.throws(() => addMcp(env, { name: "web", def: { type: "stdio", command: "x" }, apps: ["cursor"] }), { code: "app_missing" });
});

test("mcp: file cấu hình hỏng thì báo lỗi, không ghi đè", () => {
  const { env, home } = tempEnv();
  writeFileSync(join(home, ".claude.json"), "{ broken");
  assert.equal(listMcp(env).apps.find((app) => app.id === "claude").error, "config_unreadable");
  assert.throws(() => addMcp(env, { name: "x", def: { type: "stdio", command: "x" }, apps: ["claude"] }), { code: "config_unreadable" });
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), "{ broken");
});

test("mcp: che tham số bí mật", () => {
  assert.deepEqual(maskArgs(["--api-key", "sk-live-1", "--token=abc", "-y", "pkg@1.0.0", "a1B2c3D4e5F6g7H8i9J0k1L2m3"]), ["--api-key", "••••", "--token=••••", "-y", "pkg@1.0.0", "••••"]);
});

/* ── Skill ────────────────────────────────────────────────────────── */

const SKILL_MD = "---\nname: pdf\ndescription: >\n  Đọc và tạo file PDF.\n  Dùng khi cần.\n---\n# PDF\n";

function seedSkill(home) {
  const dir = join(home, ".claude", "skills", "pdf");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
  writeFileSync(join(dir, "scripts", "fill.py"), "print(1)\n");
  mkdirSync(join(home, ".codex", "skills", ".system", "imagegen"), { recursive: true });
  writeFileSync(join(home, ".codex", "skills", ".system", "imagegen", "SKILL.md"), "---\nname: imagegen\n---\n");
}

test("skill: đọc frontmatter (cả khối nhiều dòng)", () => {
  assert.deepEqual(readFrontmatter(SKILL_MD), { name: "pdf", description: "Đọc và tạo file PDF. Dùng khi cần." });
  assert.deepEqual(readFrontmatter('---\nname: "x"\ndescription: one line\n---'), { name: "x", description: "one line" });
});

test("skill: liệt kê, chép sang Codex, tắt/bật (chuyển thư mục), xoá vào thùng rác", () => {
  const { env, home } = tempEnv();
  seedSkill(home);
  const list = listSkills(env);
  assert.deepEqual(list.skills.map((skill) => skill.dir), ["pdf"]);
  assert.deepEqual(list.skills[0].apps, { claude: "on", codex: "absent" });
  assert.equal(list.skills[0].description, "Đọc và tạo file PDF. Dùng khi cần.");

  setSkillApp(env, "pdf", "codex", true);
  assert.ok(existsSync(join(home, ".codex", "skills", "pdf", "scripts", "fill.py")));
  setSkillApp(env, "pdf", "claude", false);
  assert.ok(!existsSync(join(home, ".claude", "skills", "pdf")));
  assert.ok(existsSync(join(env.CRIZON_HOME, "skills-off", "claude", "pdf", "SKILL.md")));
  assert.deepEqual(listSkills(env).skills[0].apps, { claude: "off", codex: "on" });
  setSkillApp(env, "pdf", "claude", true);
  assert.deepEqual(listSkills(env).skills[0].apps, { claude: "on", codex: "on" });

  removeSkill(env, "pdf", "codex");
  assert.deepEqual(listSkills(env).skills[0].apps, { claude: "on", codex: "absent" });
  removeSkill(env, "pdf");
  assert.equal(listSkills(env).skills.length, 0);
  assert.equal(readdirSync(join(env.CRIZON_HOME, "trash", "skills", "claude")).length, 1);
  assert.throws(() => setSkillApp(env, "../x", "claude", true), { code: "invalid_name" });
});

test("skill: phân tích link GitHub", () => {
  assert.deepEqual(parseGithubSkillUrl("https://github.com/anthropics/skills/tree/main/skills/pdf"), { owner: "anthropics", repo: "skills", ref: "main", path: "skills/pdf" });
  assert.deepEqual(parseGithubSkillUrl("https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md"), { owner: "anthropics", repo: "skills", ref: "main", path: "skills/pdf" });
  assert.equal(parseGithubSkillUrl("https://github.com/anthropics/skills"), null);
  assert.equal(parseGithubSkillUrl("http://github.com/a/b/tree/main/x"), null);
  assert.equal(parseGithubSkillUrl("https://evil.test/a/b/tree/main/x"), null);
  assert.equal(parseGithubSkillUrl("https://github.com/a/b/tree/main/x/..%2fy"), null);
});

function fakeGithub({ tree, files }) {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
    if (url.endsWith("/commits/main")) return ok({ sha: SHA });
    if (url.includes(`/git/trees/${SHA}`)) return ok({ tree, truncated: false });
    const raw = url.match(new RegExp(`^https://raw\\.githubusercontent\\.com/anthropics/skills/${SHA}/(.+)$`));
    if (raw && files[raw[1]] !== undefined) return ok(files[raw[1]]);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { SHA, calls, fetchImpl };
}

test("skill: cài từ GitHub ghim commit SHA, xem trước trước khi ghi", async () => {
  const { env, home } = tempEnv();
  const gh = fakeGithub({
    tree: [
      { type: "blob", path: "skills/pdf/SKILL.md", size: SKILL_MD.length },
      { type: "blob", path: "skills/pdf/scripts/fill.py", size: 9 },
      { type: "blob", path: "skills/other/SKILL.md", size: 5 },
    ],
    files: { "skills/pdf/SKILL.md": SKILL_MD, "skills/pdf/scripts/fill.py": "print(1)\n" },
  });
  const preview = await previewGithubSkill({ url: "https://github.com/anthropics/skills/tree/main/skills/pdf", env, fetchImpl: gh.fetchImpl });
  assert.equal(preview.source.sha, gh.SHA);
  assert.equal(preview.dir, "pdf");
  assert.deepEqual(preview.files.map((file) => file.path), ["SKILL.md", "scripts/fill.py"]);
  assert.ok(!existsSync(join(home, ".claude", "skills", "pdf")));

  const result = await installGithubSkill({ source: preview.source, apps: ["claude", "codex"], env, fetchImpl: gh.fetchImpl });
  assert.equal(result.files, 2);
  assert.equal(readFileSync(join(home, ".codex", "skills", "pdf", "scripts", "fill.py"), "utf8"), "print(1)\n");
  assert.ok(gh.calls.filter((url) => url.startsWith("https://raw.")).every((url) => url.includes(gh.SHA)));
  await assert.rejects(installGithubSkill({ source: preview.source, apps: ["claude"], env, fetchImpl: gh.fetchImpl }), { code: "exists" });
  await assert.rejects(installGithubSkill({ source: { ...preview.source, sha: "main" }, apps: ["claude"], env, fetchImpl: gh.fetchImpl }), { code: "invalid_source" });
});

test("skill: từ chối thư mục không có SKILL.md hoặc quá lớn", async () => {
  const { env } = tempEnv();
  const noSkill = fakeGithub({ tree: [{ type: "blob", path: "skills/pdf/README.md", size: 3 }], files: {} });
  await assert.rejects(previewGithubSkill({ url: "https://github.com/anthropics/skills/tree/main/skills/pdf", env, fetchImpl: noSkill.fetchImpl }), { code: "no_skill_md" });
  const huge = fakeGithub({ tree: [{ type: "blob", path: "skills/pdf/SKILL.md", size: 3 }, { type: "blob", path: "skills/pdf/big.bin", size: 5 * 1024 * 1024 }], files: {} });
  await assert.rejects(previewGithubSkill({ url: "https://github.com/anthropics/skills/tree/main/skills/pdf", env, fetchImpl: huge.fetchImpl }), { code: "too_large" });
});
