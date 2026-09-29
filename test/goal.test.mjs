import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { goalScriptSource } from "../src/harness.mjs";

function makeProject(t) {
  const dir = mkdtempSync(join(tmpdir(), "crizon-goal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "goal.mjs");
  writeFileSync(script, goalScriptSource());
  writeFileSync(join(dir, "verify-ok.js"), "process.exit(0)\n");
  writeFileSync(join(dir, "verify-fail.js"), "process.exit(1)\n");
  return { dir, script };
}

function run(script, dir, args) {
  return execFileSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
}

test("goal.mjs: vòng đời mục tiêu (set→pause→resume→log→block→complete→clear)", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  assert.equal(JSON.parse(run(script, dir, ["status", "--json"])), null, "chưa có goal thì trả null");

  run(script, dir, ["set", "hoàn tất GĐ1", "--json"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.objective, "hoàn tất GĐ1");
  assert.equal(state.status, "active");
  assert.ok(state.createdAt && state.updatedAt, "có mốc thời gian");

  run(script, dir, ["pause"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).status, "paused");
  run(script, dir, ["resume"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).status, "active");

  run(script, dir, ["log", "pytest 12/12 pass"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.ok(
    state.log.some((entry) => entry.text.includes("12/12")),
    "log phải chứa bằng chứng",
  );

  run(script, dir, ["block", "cần API key AdsPower"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.status, "blocked");
  assert.equal(state.blockedReason, "cần API key AdsPower");

  run(script, dir, ["complete", "xong hết"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.status, "complete");

  run(script, dir, ["clear"]);
  assert.ok(!existsSync(stateFile), "clear phải xoá file trạng thái");
});

test("goal.mjs: đặt mục tiêu mới thay thế mục tiêu cũ nhưng giữ lịch sử", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "mục tiêu A"]);
  run(script, dir, ["complete", "A xong"]);
  run(script, dir, ["set", "mục tiêu B"]);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.objective, "mục tiêu B");
  assert.equal(state.status, "active", "mục tiêu mới quay lại active");
  assert.ok(
    state.log.some((entry) => entry.text.includes("mục tiêu A")),
    "giữ lịch sử mục tiêu cũ",
  );
});

test("goal.mjs: plan-first + verify + gate complete", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "hoàn tất GĐ1"]);
  run(script, dir, ["accept", "add", "test suite xanh"]);
  run(script, dir, ["accept", "add", "build không lỗi"]);
  run(script, dir, ["item", "add", "sửa test đỏ", "--verify", "node verify-ok.js"]);
  run(script, dir, ["item", "start", "1"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[0].status, "in_progress");
  assert.equal(state.checklist[0].verify, "node verify-ok.js", "item giữ lệnh verify");

  run(script, dir, ["item", "done", "1", "--evidence", "pytest 12/12 pass"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[0].status, "done");
  assert.match(state.checklist[0].evidence, /12\/12/);

  assert.throws(
    () => run(script, dir, ["complete"]),
    (error) => error.status === 3,
    "complete phải bị chặn khi còn tiêu chí chưa đạt",
  );

  run(script, dir, ["accept", "done", "1", "--evidence", "CI xanh"]);
  assert.throws(
    () => run(script, dir, ["complete"]),
    (error) => error.status === 3,
    "còn tiêu chí 2 thì vẫn chặn",
  );

  run(script, dir, ["accept", "done", "2", "--evidence", "build OK"]);
  run(script, dir, ["complete", "xong hết"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.status, "complete");
  assert.ok(state.acceptance.every((entry) => entry.done));
});

test("goal.mjs: ngân sách thời gian — hoàn thành hạn mức thì chặn tiến độ, resume/bỏ hạn mức để tiếp", async (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "chạy có ngân sách"]);
  run(script, dir, ["budget", "set", "--seconds", "0.05"]);
  run(script, dir, ["item", "add", "việc 1"]);
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.throws(
    () => run(script, dir, ["item", "start", "1"]),
    (error) => error.status === 4,
    "hết ngân sách phải chặn item start (exit 4)",
  );
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.status, "budget_limited");
  assert.ok(state.timeUsedSeconds >= 0);

  run(script, dir, ["budget", "clear"]);
  run(script, dir, ["resume"]);
  run(script, dir, ["item", "start", "1"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.status, "active");
  assert.equal(state.checklist[0].status, "in_progress");
});

test("goal.mjs: item done tự chạy verify — fail thì chặn (exit 5)", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "x"]);
  run(script, dir, ["item", "add", "việc ok", "--verify", "node verify-ok.js"]);
  run(script, dir, ["item", "done", "1", "--evidence", "xong"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[0].status, "done");
  assert.match(state.checklist[0].evidence, /verify exit 0/);
  assert.match(state.checklist[0].evidence, /xong/);

  run(script, dir, ["item", "add", "việc fail", "--verify", "node verify-fail.js"]);
  assert.throws(
    () => run(script, dir, ["item", "done", "2"]),
    (error) => error.status === 5,
    "verify fail phải chặn done (exit 5)",
  );
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[1].status, "pending", "item chưa được đánh dấu done");

  run(script, dir, ["item", "done", "2", "--force"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[1].status, "done");
  assert.match(state.checklist[1].evidence, /bỏ qua do --force/);
});

test("goal.mjs: ngân sách token — chặn khi vượt, clear + resume để tiếp", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "x"]);
  run(script, dir, ["budget", "set", "--tokens", "5"]);
  run(script, dir, ["item", "add", "việc 1"]);

  // giả lập plugin đã đếm token vượt hạn mức
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.tokensUsed = 10;
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  assert.throws(
    () => run(script, dir, ["item", "start", "1"]),
    (error) => error.status === 4,
    "vượt token phải chặn (exit 4)",
  );
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).status, "budget_limited");

  run(script, dir, ["budget", "clear"]);
  run(script, dir, ["resume"]);
  run(script, dir, ["item", "start", "1"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).checklist[0].status, "in_progress");
});

test("goal.mjs: ngân sách bước — done đủ bước thì chặn", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "x"]);
  run(script, dir, ["item", "add", "việc 1"]);
  run(script, dir, ["item", "add", "việc 2"]);
  run(script, dir, ["budget", "set", "--steps", "1"]);
  run(script, dir, ["item", "done", "1"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.stepsUsed, 1);
  assert.equal(state.status, "budget_limited", "đủ bước thì chuyển budget_limited");

  assert.throws(
    () => run(script, dir, ["item", "start", "2"]),
    (error) => error.status === 4,
  );

  run(script, dir, ["budget", "clear"]);
  run(script, dir, ["resume"]);
  run(script, dir, ["item", "start", "2"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[1].status, "in_progress");
});

test("goal.mjs: state có version + migrate file cũ không version", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "x"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).version, 1, "state mới có version");

  const legacy = JSON.parse(readFileSync(stateFile, "utf8"));
  delete legacy.version;
  writeFileSync(stateFile, `${JSON.stringify(legacy, null, 2)}\n`);
  run(script, dir, ["log", "legacy ok"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).version, 1, "tự thêm version khi ghi lại");
});

test("goal.mjs: chế độ duyệt — chặn thi hành tới khi approve (exit 7)", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "có duyệt", "--review"]);
  run(script, dir, ["item", "add", "việc 1"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.review, true);
  assert.equal(state.planApproved, false);

  assert.throws(
    () => run(script, dir, ["item", "start", "1"]),
    (error) => error.status === 7,
    "chưa duyệt thì không cho start (exit 7)",
  );

  run(script, dir, ["approve"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.planApproved, true);
  run(script, dir, ["item", "start", "1"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).checklist[0].status, "in_progress");
});

test("goal.mjs: item fail 2 lần liên tiếp → tự block + chặn thi hành (exit 8)", (t) => {
  const { dir, script } = makeProject(t);
  const stateFile = join(dir, ".crizon", "goal.json");

  run(script, dir, ["set", "x"]);
  run(script, dir, ["item", "add", "việc 1"]);
  run(script, dir, ["item", "start", "1"]);
  run(script, dir, ["item", "fail", "1", "lỗi mạng"]);
  let state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[0].fails, 1);
  assert.equal(state.checklist[0].status, "pending");
  assert.equal(state.status, "active", "1 lần lỗi chưa chặn");

  run(script, dir, ["item", "start", "1"]);
  run(script, dir, ["item", "fail", "1", "lỗi nữa"]);
  state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.checklist[0].fails, 2);
  assert.equal(state.status, "blocked", "2 lần liên tiếp → tự block");
  assert.match(state.blockedReason, /2 lần/);

  assert.throws(
    () => run(script, dir, ["item", "start", "1"]),
    (error) => error.status === 8,
    "đang blocked thì chặn thi hành (exit 8)",
  );

  run(script, dir, ["resume"]);
  run(script, dir, ["item", "start", "1"]);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).checklist[0].status, "in_progress");
});

test("goal.mjs: lệnh sai hoặc thiếu goal → exit khác 0", (t) => {
  const { dir, script } = makeProject(t);
  assert.throws(() => run(script, dir, ["resume"]), "resume khi chưa có goal phải lỗi");
  assert.throws(() => run(script, dir, ["set"]), "set thiếu mục tiêu phải lỗi");
  assert.throws(() => run(script, dir, ["khong-ton-tai"]), "lệnh lạ phải lỗi");
});
