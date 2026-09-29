/** Mở URL bằng trình duyệt mặc định (Windows/macOS/Linux) + tiện ích URL portal Crizon. */
import { spawn } from "node:child_process";

/**
 * Mở `url` bằng trình duyệt mặc định.
 * Trả false khi: thiếu url, CRIZON_NO_BROWSER=1 (test/CI), hoặc không spawn được.
 * `spawner` cho phép test stub.
 */
export function openUrl(url, { env = process.env, spawner = spawn } = {}) {
  if (!url) return false;
  if (env.CRIZON_NO_BROWSER) return false;
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawner(command[0], command[1], { detached: true, stdio: "ignore" });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

/** URL trang tạo API key trong portal: `<portal>?view=keys`. */
export function portalKeysUrl(portalUrl) {
  const base = String(portalUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}view=keys`;
}
