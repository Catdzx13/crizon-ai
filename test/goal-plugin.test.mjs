import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { goalPluginSource, goalScriptSource } from "../src/harness.mjs";

function makeFixture(t, state) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-goal-plugin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pluginFile = join(dir, "goal-plugin.mjs");
  writeFileSync(pluginFile, goalPluginSource());
  writeFileSync(join(dir, "opencode-goal.mjs"), goalScriptSource());
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  if (state) writeFileSync(join(dir, ".opencode", "goal.json"), `${JSON.stringify(state, null, 2)}\n`);
  return { dir, pluginFile };
}

async function loadPlugin(t, pluginFile) {
  const mod = await import(`${pathToFileURL(pluginFile).href}?t=${Date.now()}`);
  t.after(() => undefined);
  return mod;
}

const ACTIVE_STATE = {
  objective: "hoàn tất GĐ1",
  status: "active",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  checklist: [
    { text: "sửa test đỏ", status: "in_progress", verify: "pytest -q", evidence: "" },
    { text: "cập nhật docs", status: "pending", verify: "", evidence: "" },
  ],
  acceptance: [{ text: "CI xanh", done: false, evidence: "" }],
  log: [],
  budget: { seconds: null, tokens: 1000, steps: null },
  tokensUsed: 123,
  stepsUsed: 1,
};

test("goal-plugin: chèn briefing vào system prompt khi goal active", async (t) => {
  const { dir, pluginFile } = makeFixture(t, ACTIVE_STATE);
  const mod = await loadPlugin(t, pluginFile);
  const hooks = await mod.server({ directory: dir });
  const output = { system: ["base system"] };
  await hooks["experimental.chat.system.transform"]({}, output);
  assert.equal(output.system.length, 2);
  const briefing = output.system[0];
  assert.match(briefing, /hoàn tất GĐ1/);
  assert.match(briefing, /sửa test đỏ/);
  assert.match(briefing, /CI xanh/);
  assert.match(briefing, /1000 token/);
});

test("goal-plugin: không chèn khi goal đã complete hoặc chưa có goal", async (t) => {
  const done = makeFixture(t, { ...ACTIVE_STATE, status: "complete" });
  const modDone = await loadPlugin(t, done.pluginFile);
  const hooksDone = await modDone.server({ directory: done.dir });
  const out1 = { system: ["base"] };
  await hooksDone["experimental.chat.system.transform"]({}, out1);
  assert.deepEqual(out1.system, ["base"]);

  const none = makeFixture(t, null);
  const modNone = await loadPlugin(t, none.pluginFile);
  const hooksNone = await modNone.server({ directory: none.dir });
  const out2 = { system: ["base"] };
  await hooksNone["experimental.chat.system.transform"]({}, out2);
  assert.deepEqual(out2.system, ["base"]);
});

test("goal-plugin: nhắc khi kế hoạch chưa duyệt", async (t) => {
  const { dir, pluginFile } = makeFixture(t, { ...ACTIVE_STATE, review: true, planApproved: false });
  const mod = await loadPlugin(t, pluginFile);
  const hooks = await mod.server({ directory: dir });
  const output = { system: ["base"] };
  await hooks["experimental.chat.system.transform"]({}, output);
  assert.match(output.system[0], /CHƯA duyệt/);
});

test("goal-plugin: tool `goal` có type + gọi đúng script (không cần zod)", async (t) => {
  const { dir, pluginFile } = makeFixture(t, null);
  const mod = await loadPlugin(t, pluginFile);
  const hooks = await mod.server({ directory: dir });
  const tool = hooks.tool?.goal;
  assert.ok(tool, "phải đăng ký tool goal");
  assert.ok(Array.isArray(tool.args.action.enum) && tool.args.action.enum.includes("item_fail"), "enum đủ action");
  assert.equal(typeof tool.execute, "function");

  const status = await tool.execute({ action: "status" }, { directory: dir });
  assert.match(status.output, /Chưa có mục tiêu/);

  const set = await tool.execute({ action: "set", objective: "hoàn tất GĐ1" }, { directory: dir });
  assert.match(set.output, /hoàn tất GĐ1/);
  await tool.execute({ action: "item_add", note: "việc 1", verify: "node -v" }, { directory: dir });
  await tool.execute({ action: "item_start", index: 1 }, { directory: dir });
  const state = JSON.parse(readFileSync(join(dir, ".opencode", "goal.json"), "utf8"));
  assert.equal(state.objective, "hoàn tất GĐ1");
  assert.equal(state.checklist[0].status, "in_progress");

  await tool.execute({ action: "item_fail", index: 1, note: "lỗi A" }, { directory: dir });
  await tool.execute({ action: "item_fail", index: 1, note: "lỗi B" }, { directory: dir });
  const blocked = JSON.parse(readFileSync(join(dir, ".opencode", "goal.json"), "utf8"));
  assert.equal(blocked.status, "blocked", "fail 2 lần qua tool → tự block");
  const denied = await tool.execute({ action: "item_start", index: 1 }, { directory: dir });
  assert.match(denied.output, /\[exit 8\]/, "bị chặn thì output kèm exit code");
});

test("goal-plugin: đếm token từ part step-finish, dedup theo part id, chỉ khi active", async (t) => {
  const { dir, pluginFile } = makeFixture(t, ACTIVE_STATE);
  const mod = await loadPlugin(t, pluginFile);
  const hooks = await mod.server({ directory: dir });
  const stateFile = join(dir, ".opencode", "goal.json");

  const part = { id: "prt_1", type: "step-finish", tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 0, write: 0 } } };
  await hooks.event({ event: { type: "message.part.updated", properties: { sessionID: "ses_1", part } } });
  await hooks.event({ event: { type: "message.part.updated", properties: { sessionID: "ses_1", part } } });
  let saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.tokensUsed, 123 + 17, "cộng 17 token đúng 1 lần (dedup)");

  await hooks.event({
    event: { type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "prt_2", type: "step-finish", tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 0, write: 0 } } } } },
  });
  saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.tokensUsed, 123 + 17 + 3);

  // goal paused → không đếm nữa
  const paused = JSON.parse(readFileSync(stateFile, "utf8"));
  paused.status = "paused";
  writeFileSync(stateFile, `${JSON.stringify(paused, null, 2)}\n`);
  await hooks.event({
    event: { type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "prt_3", type: "step-finish", tokens: { input: 9, output: 9, reasoning: 0, cache: { read: 0, write: 0 } } } } },
  });
  saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(saved.tokensUsed, 143, "paused thì không cộng token");
});
