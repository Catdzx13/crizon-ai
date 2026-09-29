#!/usr/bin/env node
/**
 * goal.mjs — quản lý trạng thái "goal loop" (tính năng Crizon trên OpenCode).
 * Trạng thái lưu tại `.opencode/goal.json` **theo thư mục dự án hiện tại**.
 *
 * Vòng đời:
 *   node goal.mjs status [--json]
 *   node goal.mjs set "<mục tiêu>" [--review]
 *   node goal.mjs approve | pause | resume | block "<lý do>" | clear
 *   node goal.mjs complete ["ghi chú"] [--force]      (chặn nếu còn tiêu chí chưa đạt)
 *   node goal.mjs log "<nội dung>"
 *   node goal.mjs budget set --minutes <N> | budget clear
 *
 * Kế hoạch (plan-first):
 *   node goal.mjs accept add "<tiêu chí nghiệm thu>"
 *   node goal.mjs accept done <số> [--evidence "<bằng chứng>"]
 *   node goal.mjs item add "<việc>" [--verify "<lệnh kiểm chứng>"]
 *   node goal.mjs item start <số>
 *   node goal.mjs item done <số> [--evidence "<bằng chứng>"]
 *   node goal.mjs item fail <số> "<lý do>"     (2 lần liên tiếp → tự `block`)
 *   node goal.mjs item rm <số>
 *
 * Duyệt kế hoạch: `set "<mục tiêu>" --review` → chặn `item start/done` (exit 7) cho tới khi `approve`.
 * Trạng thái có `version` (hiện = 1) để nâng cấp định dạng an toàn về sau.
 *
 * Ngân sách: `budget set [--minutes N] [--tokens N] [--steps N]`; hết hạn → status `budget_limited`;
 * các lệnh đẩy tiến độ bị chặn (exit 4) cho tới khi `resume` (đặt lại đồng hồ) hoặc `budget clear`.
 * Token được plugin `crizon-goal-plugin.mjs` đếm tự động (part step-finish) → `tokensUsed`.
 *
 * Bằng chứng: `item done` **tự chạy lệnh `--verify`** (nếu có), lưu exit code + output; verify fail → exit 5
 * (không cho đánh dấu xong, trừ `--force`).
 *
 * Zero dependency — Node ≥ 20.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const statePath = join(process.cwd(), ".opencode", "goal.json");

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--json" || arg === "--force" || arg === "--review") {
    flags[arg.slice(2)] = true;
    continue;
  }
  if (arg === "--verify" || arg === "--evidence" || arg === "--minutes" || arg === "--seconds" || arg === "--tokens" || arg === "--steps") {
    flags[arg.slice(2)] = argv[index + 1] ?? "";
    index += 1;
    continue;
  }
  positional.push(arg);
}

const [command, ...rest] = positional;
const text = rest.join(" ").trim();
const json = Boolean(flags.json);

const STATUS_LABEL = {
  active: "đang chạy",
  paused: "tạm dừng",
  blocked: "bị chặn",
  budget_limited: "hết ngân sách",
  complete: "hoàn tất",
};
const ITEM_LABEL = { pending: "☐", in_progress: "◐", done: "✔" };
const UNFINISHED = new Set(["paused", "blocked", "budget_limited"]);

function load() {
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8").replace(/^\uFEFF/, ""));
    if (state && state.version === undefined) state.version = 1; // migrate state cũ (chưa có version)
    return state;
  } catch {
    return null;
  }
}

function save(state) {
  mkdirSync(dirname(statePath), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function appendLog(state, message) {
  if (!message) return;
  state.log = [...(state.log ?? []), { at: new Date().toISOString(), text: message }].slice(-100);
}

function activeSeconds(state) {
  if (state?.activeSince) {
    return Math.max(0, (Date.now() - Date.parse(state.activeSince)) / 1000);
  }
  return 0;
}

function accumulateTime(state) {
  if (!state?.activeSince) return;
  state.timeUsedSeconds = (state.timeUsedSeconds ?? 0) + activeSeconds(state);
  state.activeSince = null;
}

/** Đồng hồ ngân sách: trạng thái active + có hạn mức → kiểm tra vượt hạn (thời gian/token). */
function refresh(state) {
  if (!state || state.status !== "active") return state;
  if (state.budget?.seconds && !state.activeSince) {
    state.activeSince = new Date().toISOString();
    save(state);
  }
  const overTime = state.budget?.seconds && activeSeconds(state) >= state.budget.seconds;
  const overTokens = state.budget?.tokens && (state.tokensUsed ?? 0) >= state.budget.tokens;
  if (!overTime && !overTokens) return state;
  if (overTime) accumulateTime(state);
  state.status = "budget_limited";
  const reason = overTime ? `hết thời gian (${budgetLabel(state.budget.seconds)})` : `hết token (${state.tokensUsed}/${state.budget.tokens})`;
  appendLog(state, `Hết ngân sách: ${reason}`);
  save(state);
  return state;
}

function budgetLabel(seconds) {
  if (!seconds) return "không giới hạn";
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  return `${Math.round(seconds / 60)} phút`;
}

function budgetSummary(state) {
  const budget = state.budget ?? {};
  const parts = [];
  if (budget.seconds) parts.push(budgetLabel(budget.seconds));
  if (budget.tokens) parts.push(`${budget.tokens} token`);
  if (budget.steps) parts.push(`${budget.steps} bước`);
  const used = [];
  if (state.tokensUsed) used.push(`${state.tokensUsed} token`);
  if (state.stepsUsed) used.push(`${state.stepsUsed} bước`);
  if (parts.length) return `Ngân sách: ${parts.join(" · ")}${used.length ? ` · đã dùng ${used.join(", ")}` : ""}`;
  return null;
}

function runVerify(command) {
  const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf8", timeout: 600000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { status: typeof result.status === "number" ? result.status : 1, tail: output.slice(-400) };
}

function requireGoal() {
  const state = load();
  if (!state) {
    console.error("Chưa có mục tiêu nào. Tạo bằng: /goal <mục tiêu>");
    process.exit(1);
  }
  return state;
}

function blockIfBudgetLimited(state) {
  if (state.status !== "budget_limited") return;
  console.error("Hết ngân sách — không thể tiếp tục việc này.");
  console.error("→ /goal resume  (đặt lại đồng hồ)  ·  /goal budget off  (bỏ hạn mức)");
  process.exit(4);
}

function blockIfPlanUnapproved(state) {
  if (!state.review || state.planApproved) return;
  console.error("Kế hoạch CHƯA được duyệt — không thực thi.");
  console.error("→ /goal approve  (duyệt kế hoạch để chạy tiếp)");
  process.exit(7);
}

function blockIfNotActive(state) {
  if (state.status === "active" || state.status === "budget_limited") return;
  console.error(`Goal đang "${STATUS_LABEL[state.status] ?? state.status}" — không thể thực thi.`);
  console.error("→ /goal resume để tiếp tục (nếu phù hợp).");
  process.exit(8);
}

function parseIndex(value, label) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1) {
    console.error(`Số thứ tự ${label} không hợp lệ: ${value ?? ""}`);
    process.exit(2);
  }
  return index;
}

function print(state) {
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (!state) {
    console.log("Chưa có mục tiêu nào. Tạo bằng: /goal <mục tiêu>");
    return;
  }
  console.log(`Mục tiêu: ${state.objective}`);
  console.log(`Trạng thái: ${STATUS_LABEL[state.status] ?? state.status}`);
  if (state.blockedReason) console.log(`Lý do chặn: ${state.blockedReason}`);
  if (state.review) console.log(`Kế hoạch: ${state.planApproved ? "đã duyệt" : "CHƯA duyệt — gõ `/goal approve`"}`);
  const summary = budgetSummary(state);
  if (summary) console.log(summary);
  else if (state.tokensUsed || state.stepsUsed) {
    const used = [];
    if (state.tokensUsed) used.push(`${state.tokensUsed} token`);
    if (state.stepsUsed) used.push(`${state.stepsUsed} bước`);
    console.log(`Đã dùng: ${used.join(", ")}`);
  }
  console.log(`Tạo lúc: ${state.createdAt} · Cập nhật: ${state.updatedAt}`);

  const acceptance = state.acceptance ?? [];
  if (acceptance.length) {
    console.log("Tiêu chí nghiệm thu:");
    acceptance.forEach((entry, index) => {
      console.log(`  ${entry.done ? "[x]" : "[ ]"} ${index + 1}. ${entry.text}${entry.evidence ? ` — ${entry.evidence}` : ""}`);
    });
  }
  const checklist = state.checklist ?? [];
  if (checklist.length) {
    console.log("Kế hoạch:");
    checklist.forEach((item, index) => {
      const verify = item.verify ? ` · verify: ${item.verify}` : "";
      const fails = item.fails ? ` · thất bại ${item.fails}×` : "";
      const evidence = item.evidence ? ` · ${item.evidence}` : "";
      console.log(`  ${ITEM_LABEL[item.status] ?? "?"} ${index + 1}. ${item.text}${verify}${fails}${evidence}`);
    });
  }
  const recent = (state.log ?? []).slice(-5);
  if (recent.length) {
    console.log("Nhật ký gần nhất:");
    for (const entry of recent) console.log(`  - [${entry.at}] ${entry.text}`);
  }
  if (UNFINISHED.has(state.status)) {
    console.log("⚠ Mục tiêu đang dở — gõ `/goal resume` để tiếp tục (mở lại không tự chạy).");
  }
}

const existing = refresh(load());

switch (command) {
  case undefined:
  case "status":
    print(existing);
    break;

  case "set": {
    if (!text) {
      console.error('Thiếu mục tiêu. Dùng: node goal.mjs set "<mục tiêu>"');
      process.exit(2);
    }
    const state = existing ?? {
      version: 1,
      createdAt: new Date().toISOString(),
      log: [],
      checklist: [],
      acceptance: [],
    };
    if (state.version === undefined) state.version = 1;
    if (state.objective && state.objective !== text) {
      appendLog(state, `Mục tiêu mới thay thế mục tiêu cũ: "${state.objective}"`);
    }
    accumulateTime(state);
    state.objective = text;
    state.status = "active";
    state.blockedReason = null;
    state.activeSince = new Date().toISOString();
    state.review = Boolean(flags.review);
    state.planApproved = !state.review;
    appendLog(state, state.review ? `Đặt mục tiêu (cần duyệt kế hoạch): "${text}"` : `Đặt mục tiêu: "${text}"`);
    save(state);
    print(state);
    break;
  }

  case "approve": {
    const state = requireGoal();
    state.planApproved = true;
    appendLog(state, "Duyệt kế hoạch");
    save(state);
    print(state);
    break;
  }

  case "pause":
  case "resume":
  case "complete": {
    const state = requireGoal();
    if (command === "complete") {
      const pending = (state.acceptance ?? []).filter((entry) => !entry.done);
      if (pending.length && !flags.force) {
        console.error("Chưa đạt tiêu chí nghiệm thu — không thể hoàn tất:");
        pending.forEach((entry, index) => console.error(`  [ ] ${index + 1}. ${entry.text}`));
        console.error('Đánh dấu đạt bằng: node goal.mjs accept done <số> --evidence "<bằng chứng>"');
        console.error("(hoặc --force nếu thật sự cần bỏ qua)");
        process.exit(3);
      }
      accumulateTime(state);
      state.status = "complete";
      appendLog(state, text ? `Hoàn tất: ${text}` : "Hoàn tất");
    } else if (command === "pause") {
      accumulateTime(state);
      state.status = "paused";
      appendLog(state, "Tạm dừng");
    } else {
      // resume: đặt lại đồng hồ ngân sách
      accumulateTime(state);
      state.status = "active";
      state.activeSince = new Date().toISOString();
      appendLog(state, "Tiếp tục (đặt lại đồng hồ ngân sách)");
    }
    save(state);
    print(state);
    break;
  }

  case "block": {
    const state = requireGoal();
    accumulateTime(state);
    state.status = "blocked";
    state.blockedReason = text || "không rõ";
    appendLog(state, `Bị chặn: ${state.blockedReason}`);
    save(state);
    print(state);
    break;
  }

  case "log": {
    const state = requireGoal();
    if (!text) {
      console.error("Thiếu nội dung log.");
      process.exit(2);
    }
    appendLog(state, text);
    save(state);
    print(state);
    break;
  }

  case "budget": {
    const state = requireGoal();
    const [action] = rest;
    if (action === "set") {
      const seconds = flags.seconds !== undefined ? Number(flags.seconds) : flags.minutes !== undefined ? Number(flags.minutes) * 60 : null;
      const tokens = flags.tokens !== undefined ? Number(flags.tokens) : null;
      const steps = flags.steps !== undefined ? Number(flags.steps) : null;
      if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0)) {
        console.error("Số phút/giây không hợp lệ.");
        process.exit(2);
      }
      if (tokens !== null && (!Number.isInteger(tokens) || tokens <= 0)) {
        console.error("Số token không hợp lệ.");
        process.exit(2);
      }
      if (steps !== null && (!Number.isInteger(steps) || steps <= 0)) {
        console.error("Số bước không hợp lệ.");
        process.exit(2);
      }
      if (seconds === null && tokens === null && steps === null) {
        console.error("Thiếu hạn mức. Dùng: budget set [--minutes N] [--tokens N] [--steps N]");
        process.exit(2);
      }
      state.budget = { seconds, tokens, steps };
      if (state.status === "active") state.activeSince = new Date().toISOString();
      const label = [seconds ? budgetLabel(seconds) : null, tokens ? `${tokens} token` : null, steps ? `${steps} bước` : null]
        .filter(Boolean)
        .join(" · ");
      appendLog(state, `Đặt ngân sách: ${label}`);
      save(state);
      print(state);
      break;
    }
    if (action === "clear") {
      state.budget = { seconds: null, tokens: null, steps: null };
      appendLog(state, "Bỏ ngân sách");
      save(state);
      print(state);
      break;
    }
    console.log(budgetSummary(state) ?? "Chưa đặt ngân sách. Dùng: goal.mjs budget set [--minutes N] [--tokens N] [--steps N]");
    break;
  }

  case "accept": {
    const [action, ...args] = rest;
    const payload = args.join(" ").trim();
    if (action === "add") {
      const state = requireGoal();
      if (!payload) {
        console.error('Thiếu tiêu chí. Dùng: accept add "<tiêu chí>"');
        process.exit(2);
      }
      state.acceptance = [...(state.acceptance ?? []), { text: payload, done: false, evidence: "" }];
      appendLog(state, `Thêm tiêu chí: ${payload}`);
      save(state);
      print(state);
      break;
    }
    if (action === "done") {
      const state = requireGoal();
      blockIfBudgetLimited(state);
      blockIfPlanUnapproved(state);
      blockIfNotActive(state);
      const index = parseIndex(args[0], "tiêu chí");
      const entry = (state.acceptance ?? [])[index - 1];
      if (!entry) {
        console.error(`Không có tiêu chí số ${index}.`);
        process.exit(2);
      }
      entry.done = true;
      entry.evidence = flags.evidence ?? entry.evidence;
      appendLog(state, `Đạt tiêu chí ${index}: ${entry.text}${entry.evidence ? ` — ${entry.evidence}` : ""}`);
      save(state);
      print(state);
      break;
    }
    console.error('Dùng: accept add "<tiêu chí>" | accept done <số> [--evidence "..."]');
    process.exit(2);
  }

  case "item": {
    const [action, ...args] = rest;
    if (action === "add") {
      const state = requireGoal();
      const payload = args.join(" ").trim();
      if (!payload) {
        console.error('Thiếu việc. Dùng: item add "<việc>" [--verify "<lệnh>"]');
        process.exit(2);
      }
      state.checklist = [...(state.checklist ?? []), { text: payload, status: "pending", verify: flags.verify ?? "", evidence: "" }];
      appendLog(state, `Thêm việc: ${payload}`);
      save(state);
      print(state);
      break;
    }
    const state = requireGoal();
    if (action === "start" || action === "done") {
      blockIfBudgetLimited(state);
      blockIfPlanUnapproved(state);
      blockIfNotActive(state);
    }
    const index = parseIndex(args[0], "việc");
    const item = (state.checklist ?? [])[index - 1];
    if (!item) {
      console.error(`Không có việc số ${index}.`);
      process.exit(2);
    }
    if (action === "start") {
      item.status = "in_progress";
      appendLog(state, `Bắt đầu việc ${index}: ${item.text}`);
    } else if (action === "done") {
      let verifyNote = "";
      if (item.verify && !flags.force) {
        const verify = runVerify(item.verify);
        if (verify.status !== 0) {
          appendLog(state, `Verify FAIL (exit ${verify.status}): ${item.verify}`);
          save(state);
          console.error(`✗ Verify không đạt (exit ${verify.status}): ${item.verify}`);
          if (verify.tail) console.error(verify.tail);
          console.error("Sửa cho đạt rồi thử lại, hoặc dùng --force nếu thật sự cần bỏ qua.");
          process.exit(5);
        }
        verifyNote = `[verify exit 0] ${verify.tail.slice(0, 200)}`;
      } else if (item.verify && flags.force) {
        verifyNote = "[verify bị bỏ qua do --force]";
      }
      item.status = "done";
      const evidence = [flags.evidence, verifyNote].filter(Boolean).join(" · ");
      if (evidence) item.evidence = evidence;
      state.stepsUsed = (state.stepsUsed ?? 0) + 1;
      appendLog(state, `Xong việc ${index}: ${item.text}${item.evidence ? ` — ${item.evidence}` : ""}`);
      if (state.budget?.steps && state.stepsUsed >= state.budget.steps) {
        accumulateTime(state);
        state.status = "budget_limited";
        appendLog(state, `Hết ngân sách bước (${state.stepsUsed}/${state.budget.steps})`);
      }
    } else if (action === "fail") {
      const reason = args.slice(1).join(" ").trim() || "không rõ";
      item.status = "pending";
      item.fails = (item.fails ?? 0) + 1;
      appendLog(state, `Việc ${index} thất bại lần ${item.fails}: ${reason}`);
      if (item.fails >= 2) {
        accumulateTime(state);
        state.status = "blocked";
        state.blockedReason = `việc ${index} thất bại 2 lần liên tiếp: ${reason}`;
        appendLog(state, `Tự chặn: ${state.blockedReason}`);
      }
    } else if (action === "rm") {
      state.checklist.splice(index - 1, 1);
      appendLog(state, `Bỏ việc ${index}: ${item.text}`);
    } else {
      console.error('Dùng: item add|start|done|fail|rm <số> [--verify|--evidence "..."]');
      process.exit(2);
    }
    save(state);
    print(state);
    break;
  }

  case "clear": {
    try {
      rmSync(statePath, { force: true });
    } catch {
      /* ignore */
    }
    console.log("Đã xoá mục tiêu.");
    break;
  }

  default:
    console.error(`Lệnh không hợp lệ: ${command}`);
    console.error("Dùng: status|set|approve|pause|resume|complete|block|log|budget|accept|item|clear");
    process.exit(2);
}
