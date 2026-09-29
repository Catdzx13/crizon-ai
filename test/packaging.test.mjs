import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, "..", "tools");

function run(script, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [join(tools, script), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

test("build-tui: --help in hướng dẫn (exit 0)", () => {
  const r = run("build-tui.mjs", ["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /build-tui/);
  assert.match(r.out, /--skip-install/);
  assert.match(r.out, /KHÔNG cần Bun/);
});

test("smoke-tui: thiếu tham số → hướng dẫn + exit 2", () => {
  const r = run(join("tui-vi", "smoke-tui.mjs"));
  assert.equal(r.code, 2);
  assert.match(r.out, /smoke-tui/);
});

test("smoke-tui: binary không tồn tại → báo lỗi rõ, exit 2 (không crash)", () => {
  const r = run(join("tui-vi", "smoke-tui.mjs"), [join(here, "khong-ton-tai-tui.exe")]);
  assert.equal(r.code, 2);
  assert.match(r.out, /Không thấy binary|node-pty/);
});
