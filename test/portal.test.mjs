import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cmdLogin, cmdPortal } from "../src/commands.mjs";
import { portalKeysUrl } from "../src/open-url.mjs";

function makeIo() {
  const lines = [];
  return {
    io: {
      out: (line = "") => lines.push(String(line)),
      err: (line = "") => lines.push(String(line)),
      write: (text) => lines.push(String(text)),
    },
    lines,
  };
}

function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "crizon-portal-"));
  return { dir, env: { CRIZON_CONFIG_PATH: join(dir, "config.json"), CRIZON_HOME: join(dir, "home") } };
}

test("portal: URL tạo key + cmdPortal mở trình duyệt (stub)", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(portalKeysUrl("https://crizonshop.com/dashboard"), "https://crizonshop.com/dashboard?view=keys");
  assert.equal(portalKeysUrl("https://crizonshop.com/dashboard?x=1"), "https://crizonshop.com/dashboard?x=1&view=keys");

  const opened = [];
  const first = makeIo();
  const code = await cmdPortal({
    env,
    io: first.io,
    deps: { open: (url) => { opened.push(url); return true; } },
  });
  assert.equal(code, 0);
  assert.deepEqual(opened, ["https://crizonshop.com/dashboard?view=keys"]);
  assert.match(first.lines.join("\n"), /dashboard\?view=keys/);

  const custom = makeIo();
  await cmdPortal({
    env: { ...env, CRIZON_PORTAL_URL: "https://crizon.example/portal/" },
    io: custom.io,
    deps: { open: () => false },
  });
  assert.match(custom.lines.join("\n"), /https:\/\/crizon\.example\/portal\?view=keys/);
});

test("login không key: hiện link tạo key; --web thì mở trình duyệt; vẫn nhận key khi có", async (t) => {
  const { dir, env } = tempEnv();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const first = makeIo();
  const code = await cmdLogin({ flags: {}, env, io: first.io });
  assert.equal(code, 2);
  assert.match(first.lines.join("\n"), /view=keys/);
  assert.match(first.lines.join("\n"), /login --key czn_/);

  const opened = [];
  const second = makeIo();
  const code2 = await cmdLogin({
    flags: { web: true },
    env,
    io: second.io,
    deps: { open: (url) => { opened.push(url); return true; } },
  });
  assert.equal(code2, 2);
  assert.deepEqual(opened, ["https://crizonshop.com/dashboard?view=keys"]);
  assert.match(second.lines.join("\n"), /Đã mở trang tạo API key/);
});
