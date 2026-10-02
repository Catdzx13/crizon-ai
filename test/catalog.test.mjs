import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { catalogDef, fetchCatalog, installCatalogItem } from "../src/catalog.mjs";

const NPM = { type: "stdio", runtime: "npm", package: "@x/gh-mcp", version: "1.2.3", command: "npx", args: ["-y", "@x/gh-mcp@1.2.3"], env: [{ name: "GH_TOKEN", description: "token", required: true, secret: true }, { name: "GH_HOST", description: "", required: false, secret: false, default: "github.com" }] };
const ITEMS = {
  mcp1: { id: "mcp1", kind: "MCP", name: "gh-mcp", title: "GitHub", summary: "Quản lý GitHub", stars: 900, starsWeek: 40, verified: true, install: NPM },
  skill1: { id: "skill1", kind: "SKILL", name: "pdf", title: "pdf", summary: "PDF", stars: 1000, starsWeek: 0, verified: false, install: { type: "skill", owner: "anthropics", repo: "skills", sha: "0123456789abcdef0123456789abcdef01234567", path: "skills/pdf", blob: "x" } },
};

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-catalog-"));
  const home = join(dir, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: {} }));
  const env = { ...process.env, CRIZON_USER_HOME: home, CRIZON_HOME: join(dir, "crizon"), CODEX_HOME: join(home, ".codex"), CRIZON_API_ORIGIN: "https://shop.test" };
  delete env.CLAUDE_CONFIG_DIR;
  return { env, home };
}

function backend(calls = []) {
  return async (url) => {
    const target = String(url);
    calls.push(target);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer });
    if (target.startsWith("https://shop.test/api/ai/hub?")) return ok({ tab: new URL(target).searchParams.get("tab"), items: Object.values(ITEMS) });
    const one = target.match(/^https:\/\/shop\.test\/api\/ai\/hub\/(\w+)$/);
    if (one) return ITEMS[one[1]] ? ok(ITEMS[one[1]]) : { ok: false, status: 404, json: async () => ({}) };
    if (target.includes("/git/trees/")) return ok({ tree: [{ type: "blob", path: "skills/pdf/SKILL.md", size: 30 }], truncated: false });
    if (target.startsWith("https://raw.githubusercontent.com/anthropics/skills/0123456789abcdef0123456789abcdef01234567/skills/pdf/SKILL.md")) return ok("---\nname: pdf\ndescription: PDF\n---\n");
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const cfg = { portalUrl: "https://shop.test/dashboard" };

test("catalog: cách cài → cấu hình MCP (giá trị nhập trên máy, mặc định, bọc cmd /c trên Windows)", () => {
  assert.deepEqual(catalogDef(NPM, { GH_TOKEN: "ghp_x" }, "linux"), { type: "stdio", command: "npx", args: ["-y", "@x/gh-mcp@1.2.3"], env: { GH_TOKEN: "ghp_x", GH_HOST: "github.com" } });
  assert.deepEqual(catalogDef(NPM, { GH_TOKEN: "ghp_x" }, "win32").args, ["/c", "npx", "-y", "@x/gh-mcp@1.2.3"]);
  assert.throws(() => catalogDef(NPM, {}, "linux"), { code: "missing_value", detail: "GH_TOKEN" });
  assert.deepEqual(catalogDef({ type: "http", url: "https://mcp.test/mcp", headers: [{ name: "X-Key", required: false }] }, {}), { type: "http", url: "https://mcp.test/mcp", headers: {} });
  assert.throws(() => catalogDef({ type: "weird" }), { code: "unsupported_install" });
});

test("catalog: danh sách kèm trạng thái đã cài trên máy", async () => {
  const { env, home } = tempEnv();
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "gh-mcp": { command: "npx", args: [] } } }));
  const calls = [];
  const data = await fetchCatalog({ cfg, env, tab: "hot", kind: "MCP", q: "git", fetchImpl: backend(calls) });
  assert.match(calls[0], /\/api\/ai\/hub\?tab=hot&kind=MCP&q=git&limit=60$/);
  assert.deepEqual(data.items.map((item) => [item.id, item.installedIn]), [["mcp1", ["claude"]], ["skill1", []]]);
});

test("catalog: cài MCP và skill — đọc lại mục từ server, ghi vào app đã chọn", async () => {
  const { env, home } = tempEnv();
  await installCatalogItem({ cfg, env, id: "mcp1", values: { GH_TOKEN: "ghp_secret" }, apps: ["claude", "codex"], fetchImpl: backend() });
  const claude = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers["gh-mcp"];
  assert.equal(claude.env.GH_TOKEN, "ghp_secret");
  assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.gh-mcp\]/);
  await assert.rejects(installCatalogItem({ cfg, env, id: "mcp1", values: { GH_TOKEN: "x" }, apps: ["claude"], fetchImpl: backend() }), { code: "exists" });

  const skill = await installCatalogItem({ cfg, env, id: "skill1", apps: ["codex"], fetchImpl: backend() });
  assert.equal(skill.dir, "pdf");
  assert.ok(readFileSync(join(home, ".codex", "skills", "pdf", "SKILL.md"), "utf8").includes("name: pdf"));
  await assert.rejects(installCatalogItem({ cfg, env, id: "nope", apps: ["claude"], fetchImpl: backend() }), { code: "catalog_not_found" });
  await assert.rejects(installCatalogItem({ cfg, env, id: "../x", apps: ["claude"], fetchImpl: backend() }), { code: "invalid_id" });
});

test("catalog: server Crizon không phản hồi → lỗi rõ ràng", async () => {
  const { env } = tempEnv();
  await assert.rejects(fetchCatalog({ cfg, env, fetchImpl: async () => { throw new Error("offline"); } }), { code: "catalog_unreachable" });
});
