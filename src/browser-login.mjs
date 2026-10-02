/**
 * Đăng nhập bằng trình duyệt (kiểu `codex login`): server tạm 127.0.0.1, `state`
 * chống giả mạo + PKCE S256. Trang web hỏi khách đồng ý rồi tạo một API key riêng
 * cho máy này; trình duyệt chỉ mang về một MÃ dùng 1 lần, CLI đổi mã lấy key qua
 * HTTPS. Key không bao giờ nằm trong URL.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";

import { loadConfigFile, resolveConfig, saveConfigFile } from "./config.mjs";
import { getLang, t } from "./i18n.mjs";
import { openUrl } from "./open-url.mjs";

export const LOGIN_PORT = 4731;
export const LOGIN_TTL_MS = 10 * 60_000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createLoginSession(redirectUri) {
  const { verifier, challenge } = pkcePair();
  return { state: randomBytes(24).toString("base64url"), verifier, challenge, redirectUri, createdAt: Date.now() };
}

/** Tên máy hiển thị trên trang đồng ý và trong tên key ("<máy> · Crizon CLI"). */
export function deviceName() {
  return String(hostname() || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40) || "Computer";
}

export function authorizeUrl(portalUrl, session, device = deviceName()) {
  const params = new URLSearchParams({
    client_id: "crizon-cli",
    redirect_uri: session.redirectUri,
    state: session.state,
    code_challenge: session.challenge,
    code_challenge_method: "S256",
    device,
  });
  return `${String(portalUrl).replace(/\/+$/, "")}/authorize?${params}`;
}

/** Gốc API của shop (https://crizonshop.com) — lấy từ portal, đổi được bằng CRIZON_API_ORIGIN. */
export function apiOrigin(cfg, env = process.env) {
  if (env.CRIZON_API_ORIGIN) return String(env.CRIZON_API_ORIGIN).replace(/\/+$/, "");
  return new URL(cfg.portalUrl).origin;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Kiểm tra callback: còn hạn, đúng state, có mã hợp lệ (hoặc khách bấm Từ chối). */
export function readCallback(url, session) {
  if (!session || Date.now() - session.createdAt > LOGIN_TTL_MS) return { ok: false, reason: "expired" };
  const params = url.searchParams;
  if (!safeEqual(params.get("state") || "", session.state)) return { ok: false, reason: "state" };
  if (params.get("error")) return { ok: false, reason: params.get("error") === "access_denied" ? "denied" : "error" };
  const code = params.get("code") || "";
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "code" };
  return { ok: true, code };
}

export async function exchangeCode({ origin, code, verifier, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/api/ai/cli-auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body?.key !== "string") {
    throw new Error(body?.message ? String(body.message) : `HTTP ${response.status}`);
  }
  return body;
}

/** Đổi mã lấy key rồi lưu vào file cấu hình CLI. */
export async function completeLogin({ env = process.env, code, session, fetchImpl }) {
  const cfg = resolveConfig({ env });
  const result = await exchangeCode({ origin: apiOrigin(cfg, env), code, verifier: session.verifier, fetchImpl });
  saveConfigFile({ ...loadConfigFile(env), apiKey: result.key }, env);
  return { label: String(result.label || ""), lastFour: String(result.lastFour || "") };
}

const PAGE_COPY = {
  vi: {
    okTitle: "Đã kết nối Crizon AI",
    okBody: (label) => `Key "${label}" đã được lưu trên máy này. Bạn có thể đóng tab và quay lại terminal hoặc trình quản lý.`,
    failTitle: "Chưa kết nối được",
    reasons: {
      denied: "Bạn đã bấm Từ chối. Chạy lại lệnh đăng nhập nếu muốn thử lại.",
      expired: "Phiên đăng nhập đã hết hạn. Chạy lại lệnh đăng nhập.",
      state: "Yêu cầu không khớp với phiên đăng nhập này. Chạy lại lệnh đăng nhập.",
      code: "Thiếu mã xác nhận. Chạy lại lệnh đăng nhập.",
      error: "Trang web báo lỗi. Chạy lại lệnh đăng nhập.",
      exchange: "Không đổi được mã lấy key",
    },
  },
  en: {
    okTitle: "Crizon AI is connected",
    okBody: (label) => `Key "${label}" is saved on this computer. You can close this tab and go back to the terminal or the manager.`,
    failTitle: "Not connected",
    reasons: {
      denied: "You chose Deny. Run the login command again to retry.",
      expired: "This login session expired. Run the login command again.",
      state: "This request does not match the login session. Run the login command again.",
      code: "The confirmation code is missing. Run the login command again.",
      error: "The website reported an error. Run the login command again.",
      exchange: "Could not exchange the code for a key",
    },
  },
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** Trang kết quả (kiểu Apple, có giao diện tối) — CSS nội tuyến nên tự đứng được. */
export function resultPage({ ok, label = "", reason = "", detail = "" }) {
  const copy = PAGE_COPY[getLang()] ?? PAGE_COPY.vi;
  const title = ok ? copy.okTitle : copy.failTitle;
  const body = ok ? copy.okBody(label) : `${copy.reasons[reason] ?? copy.reasons.error}${detail ? ` (${detail})` : ""}`;
  const icon = ok
    ? '<path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M8.5 8.5l7 7m0-7l-7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>';
  return `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--fg:#1d1d1f;--muted:#6e6e73}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#f5f5f7;--muted:#98989d}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:24px}
main{width:min(420px,100%);background:var(--card);border-radius:22px;padding:36px 28px;text-align:center}
.icon{width:64px;height:64px;border-radius:18px;margin:0 auto 18px;display:grid;place-items:center;background:${ok ? "#34c759" : "#ff3b30"}}
h1{font-size:22px;letter-spacing:-.02em;margin:0 0 8px}p{margin:0;color:var(--muted)}
</style></head><body><main><div class="icon"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}

export function sendResultPage(res, page) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(page);
}

/** Lắng nghe trên 127.0.0.1, ưu tiên cổng cố định, bận thì để hệ điều hành chọn. */
export function listenLoopback(server, preferredPort) {
  return new Promise((resolve, reject) => {
    const tryListen = (port) => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (port !== 0 && error?.code === "EADDRINUSE") tryListen(0);
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address().port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryListen(preferredPort);
  });
}

/** `crizon-ai login --browser`: mở trang đồng ý, chờ callback, lưu key. Trả { label, lastFour } hoặc null. */
export async function runBrowserLogin({ env = process.env, io, open = openUrl, fetchImpl, timeoutMs = LOGIN_TTL_MS, port = LOGIN_PORT } = {}) {
  const cfg = resolveConfig({ env });
  let session = null;
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const callback = readCallback(url, session);
    if (!callback.ok) {
      sendResultPage(res, resultPage({ ok: false, reason: callback.reason }));
      settle({ ok: false, reason: callback.reason });
      return;
    }
    try {
      const saved = await completeLogin({ env, code: callback.code, session, fetchImpl });
      sendResultPage(res, resultPage({ ok: true, label: saved.label }));
      settle({ ok: true, ...saved });
    } catch (error) {
      sendResultPage(res, resultPage({ ok: false, reason: "exchange", detail: error?.message }));
      settle({ ok: false, reason: "exchange", error: error?.message });
    }
  });
  const actualPort = await listenLoopback(server, port);
  session = createLoginSession(`http://127.0.0.1:${actualPort}/callback`);
  const url = authorizeUrl(cfg.portalUrl, session);
  const opened = Boolean(open(url, { env }));
  io.out(t(opened ? "login.browserOpened" : "login.browserOpen", { url }));
  io.out(t("login.browserWaiting"));
  const timer = setTimeout(() => settle({ ok: false, reason: "expired" }), timeoutMs);
  const result = await finished;
  clearTimeout(timer);
  server.close();
  if (result.ok) {
    io.out(t("login.browserOk", { label: result.label, lastFour: result.lastFour }));
    return { label: result.label, lastFour: result.lastFour };
  }
  io.out(t(`login.browserFail.${result.reason}`, { err: result.error || "" }));
  return null;
}
