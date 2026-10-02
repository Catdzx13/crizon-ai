/**
 * Kho MCP/Skill (bảng xếp hạng trên trang `crizon-ai ui`): đọc từ API công khai của Crizon
 * (`/api/ai/hub`, dữ liệu MCP Registry + GitHub) rồi cài bằng thư viện MCP/skill cục bộ.
 * Không gửi gì về server ngoài truy vấn đọc; giá trị biến môi trường chỉ ghi trên máy.
 */
import { apiOrigin } from "./browser-login.mjs";
import { addMcp, listMcp } from "./mcp-manager.mjs";
import { installGithubSkill, listSkills } from "./skills-manager.mjs";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class CatalogError extends Error {
  constructor(code, { status = 400, detail = "" } = {}) {
    super(code);
    this.name = "CatalogError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "crizon-ai" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new CatalogError("catalog_unreachable", { status: 502 });
  }
  if (res.status === 404) throw new CatalogError("catalog_not_found", { status: 404 });
  if (!res.ok) throw new CatalogError("catalog_unreachable", { status: 502, detail: String(res.status) });
  return res.json();
}

/** Danh sách theo tab, kèm trạng thái "đã cài ở app nào" trên máy này. */
export async function fetchCatalog({ cfg, env = process.env, tab = "featured", kind = "", q = "", fetchImpl = fetch }) {
  const url = new URL("/api/ai/hub", apiOrigin(cfg, env));
  url.searchParams.set("tab", tab === "hot" ? "hot" : "featured");
  if (kind === "MCP" || kind === "SKILL") url.searchParams.set("kind", kind);
  if (q) url.searchParams.set("q", String(q).slice(0, 80));
  url.searchParams.set("limit", "60");
  const data = await getJson(url, fetchImpl);
  const items = Array.isArray(data?.items) ? data.items : [];
  const installed = installedIndex(env);
  return { tab: data?.tab ?? tab, items: items.map((item) => ({ ...item, installedIn: installed(item) })) };
}

async function fetchItem({ cfg, env, id, fetchImpl }) {
  if (!ID.test(String(id ?? ""))) throw new CatalogError("invalid_id");
  return getJson(new URL(`/api/ai/hub/${id}`, apiOrigin(cfg, env)), fetchImpl);
}

/** Chi tiết một mục (README/SKILL.md đã chuyển thành khối văn bản, ảnh, bài giới thiệu tiếng Việt). */
export async function fetchCatalogItem({ cfg, env = process.env, id, fetchImpl = fetch }) {
  const item = await fetchItem({ cfg, env, id, fetchImpl });
  return { ...item, installedIn: installedIndex(env)(item) };
}

/** item → danh sách app đã có (MCP theo tên server, skill theo tên thư mục). */
function installedIndex(env) {
  let mcp = null;
  let skills = null;
  return (item) => {
    if (item.kind === "SKILL") {
      skills ??= listSkills(env);
      const skill = skills.skills.find((row) => row.dir === item.name);
      return skill ? Object.entries(skill.apps).filter(([, state]) => state === "on" || state === "off").map(([id]) => id) : [];
    }
    mcp ??= listMcp(env);
    const server = mcp.servers.find((row) => row.name === item.name);
    return server ? Object.entries(server.apps).filter(([, state]) => state === "on" || state === "off").map(([id]) => id) : [];
  };
}

/**
 * Cách cài trong kho → định nghĩa MCP ghi vào app. Biến môi trường/header lấy từ
 * `values` (người dùng nhập trên máy); bắt buộc mà thiếu thì báo lỗi, không đoán.
 */
export function catalogDef(install, values = {}, platform = process.platform) {
  const given = values && typeof values === "object" ? values : {};
  const pick = (vars) => {
    const out = {};
    for (const row of Array.isArray(vars) ? vars : []) {
      const value = String(given[row.name] ?? "").trim() || row.default || "";
      if (!value && row.required) throw new CatalogError("missing_value", { detail: row.name });
      if (value) out[row.name] = value;
    }
    return out;
  };
  if (install?.type === "stdio") {
    const args = Array.isArray(install.args) ? install.args.map(String) : [];
    // Claude Code / Cursor trên Windows chạy `npx`/`uvx` (file .cmd) qua cmd.
    const wrap = platform === "win32" && /^(npx|uvx|bunx|pnpx)$/i.test(install.command);
    return { type: "stdio", command: wrap ? "cmd" : install.command, args: wrap ? ["/c", install.command, ...args] : args, env: pick(install.env) };
  }
  if (install?.type === "http" || install?.type === "sse") return { type: install.type, url: install.url, headers: pick(install.headers) };
  throw new CatalogError("unsupported_install");
}

/** Cài một mục kho vào các app đã chọn. Đọc lại mục từ server (không tin cách cài do trang gửi). */
export async function installCatalogItem({ cfg, env = process.env, id, values, apps, fetchImpl = fetch, backups }) {
  const item = await fetchItem({ cfg, env, id, fetchImpl });
  if (item.kind === "SKILL") {
    const source = item.install ?? {};
    return { kind: "SKILL", name: item.name, ...(await installGithubSkill({ source, apps, env, fetchImpl })) };
  }
  addMcp(env, { name: item.name, def: catalogDef(item.install, values), apps }, { backups });
  return { kind: "MCP", name: item.name };
}
