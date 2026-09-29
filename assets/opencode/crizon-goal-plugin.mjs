/**
 * crizon-goal-plugin.mjs — plugin server cho OpenCode (tính năng Crizon, OpenCode không có sẵn).
 *
 * 1) Đếm **token thật** của goal đang chạy: đọc part `step-finish` (input/output/reasoning)
 *    → cộng dồn vào `.opencode/goal.json` (`tokensUsed`). Dedup theo part id (event có thể lặp).
 * 2) Chèn **briefing goal** vào system prompt mỗi lượt chat (`experimental.chat.system.transform`)
 *    → agent luôn biết goal đang dở, việc kế tiếp, tiêu chí chưa đạt; nhắc resume khi paused/blocked/hết ngân sách.
 *
 * File tự chứa (chỉ node builtins). OpenCode gọi `server(input)` → hooks. LƯU Ý: mọi export phải là function.
 *
 * Hooks:
 * - `event` + `experimental.chat.system.transform` (đếm token + briefing).
 * - `tool.goal` — tool có type (JSON Schema, không cần zod) cho model quản lý goal
 *   thay vì gọi shell `goal.mjs` (tool gọi lại chính script đã kiểm chứng).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATUS_LABEL = {
  active: "đang chạy",
  paused: "tạm dừng",
  blocked: "bị chặn",
  budget_limited: "hết ngân sách",
  complete: "hoàn tất",
};
const ITEM_LABEL = { pending: "☐", in_progress: "◐", done: "✔" };

function stateFile(directory) {
  return join(directory || process.cwd(), ".opencode", "goal.json");
}

/** Script goal.mjs nằm cạnh plugin (setup copy cùng thư mục harness). */
function goalScriptPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "opencode-goal.mjs");
}

const GOAL_ACTIONS = [
  "status",
  "set",
  "approve",
  "pause",
  "resume",
  "complete",
  "block",
  "clear",
  "log",
  "budget",
  "budget_clear",
  "accept_add",
  "accept_done",
  "item_add",
  "item_start",
  "item_done",
  "item_fail",
  "item_rm",
];

/** Tool args → argv của goal.mjs (dùng lại toàn bộ logic đã kiểm chứng). */
function toolArgv(input) {
  const action = typeof input.action === "string" && input.action ? input.action : "status";
  const note = typeof input.note === "string" ? input.note : undefined;
  const evidence = typeof input.evidence === "string" ? input.evidence : undefined;
  const verify = typeof input.verify === "string" ? input.verify : undefined;
  const index = Number.isInteger(input.index) && input.index > 0 ? String(input.index) : undefined;
  const argv = [];
  switch (action) {
    case "set":
      argv.push("set", typeof input.objective === "string" ? input.objective : "");
      if (input.review) argv.push("--review");
      break;
    case "complete":
      argv.push("complete");
      if (note) argv.push(note);
      if (input.force) argv.push("--force");
      break;
    case "block":
      argv.push("block", note ?? "");
      break;
    case "log":
      argv.push("log", note ?? "");
      break;
    case "budget": {
      const limits = [input.minutes, input.tokens, input.steps].filter((value) => Number.isFinite(value));
      argv.push("budget");
      if (limits.length) {
        argv.push("set");
        if (Number.isFinite(input.minutes)) argv.push("--minutes", String(input.minutes));
        if (Number.isFinite(input.tokens)) argv.push("--tokens", String(input.tokens));
        if (Number.isFinite(input.steps)) argv.push("--steps", String(input.steps));
      }
      break;
    }
    case "budget_clear":
      argv.push("budget", "clear");
      break;
    case "accept_add":
      argv.push("accept", "add", note ?? "");
      break;
    case "accept_done":
      argv.push("accept", "done", index ?? "");
      if (evidence) argv.push("--evidence", evidence);
      break;
    case "item_add":
      argv.push("item", "add", note ?? "");
      if (verify) argv.push("--verify", verify);
      break;
    case "item_start":
      argv.push("item", "start", index ?? "");
      break;
    case "item_done":
      argv.push("item", "done", index ?? "");
      if (evidence) argv.push("--evidence", evidence);
      if (input.force) argv.push("--force");
      break;
    case "item_fail":
      argv.push("item", "fail", index ?? "", note ?? "");
      break;
    case "item_rm":
      argv.push("item", "rm", index ?? "");
      break;
    case "approve":
    case "pause":
    case "resume":
    case "clear":
      argv.push(action);
      break;
    case "status":
    default:
      argv.push("status");
      break;
  }
  return argv;
}

function readState(directory) {
  try {
    return JSON.parse(readFileSync(stateFile(directory), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function writeState(directory, state) {
  try {
    const file = stateFile(directory);
    mkdirSync(dirname(file), { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function briefing(state) {
  const lines = [`[Crizon goal] ${state.objective}`, `Trạng thái: ${STATUS_LABEL[state.status] ?? state.status}`];
  const pending = (state.acceptance ?? []).filter((item) => !item.done);
  if (pending.length) lines.push(`Tiêu chí chưa đạt: ${pending.map((item) => item.text).join(" · ")}`);
  const next = (state.checklist ?? []).find((item) => item.status !== "done");
  if (next) {
    const verify = next.verify ? ` (verify: ${next.verify})` : "";
    const fails = next.fails ? ` · thất bại ${next.fails}×` : "";
    lines.push(`Việc kế tiếp: ${ITEM_LABEL[next.status] ?? "?"} ${next.text}${verify}${fails}`);
  }
  if (state.review && !state.planApproved) {
    lines.push("Kế hoạch CHƯA duyệt — chờ người dùng gõ `/goal approve`, không thực thi.");
  }
  const budget = state.budget ?? {};
  const parts = [];
  if (budget.seconds) parts.push(`${Math.round(budget.seconds / 60)} phút`);
  if (budget.tokens) parts.push(`${budget.tokens} token`);
  if (budget.steps) parts.push(`${budget.steps} bước`);
  const used = [];
  if (state.tokensUsed) used.push(`${state.tokensUsed} token`);
  if (state.stepsUsed) used.push(`${state.stepsUsed} bước`);
  if (parts.length) lines.push(`Ngân sách: ${parts.join(" · ")}${used.length ? ` · đã dùng ${used.join(", ")}` : ""}`);
  if (state.status === "active") {
    lines.push("Cập nhật trạng thái qua script goal (xem hướng dẫn trong lệnh /goal); không tự sửa goal.json bằng tay.");
  } else {
    lines.push("⚠ Goal đang dở — chỉ tiếp tục khi người dùng gõ `/goal resume`.");
  }
  return lines.join("\n");
}

export async function server(input) {
  const directory = input?.directory ?? process.cwd();
  const seenParts = new Set();
  return {
    event: async (payload) => {
      const event = payload?.event;
      if (event?.type !== "message.part.updated") return;
      const part = event.properties?.part;
      if (!part || part.type !== "step-finish" || !part.tokens) return;
      if (part.id) {
        if (seenParts.has(part.id)) return;
        seenParts.add(part.id);
        if (seenParts.size > 1000) seenParts.clear();
      }
      const state = readState(directory);
      if (!state || state.status !== "active") return;
      const tokens = part.tokens;
      const delta = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);
      if (delta <= 0) return;
      state.tokensUsed = (state.tokensUsed ?? 0) + delta;
      writeState(directory, state);
    },
    "experimental.chat.system.transform": async (_input, output) => {
      const state = readState(directory);
      if (!state || state.status === "complete") return;
      if (!Array.isArray(output?.system)) return;
      output.system.unshift(briefing(state));
    },
    tool: {
      goal: {
        description:
          "Quản lý goal loop của Crizon (mục tiêu bền vững ở .opencode/goal.json): xem trạng thái, đặt/duyệt/tạm dừng/tiếp tục/hoàn tất mục tiêu, kế hoạch (việc + tiêu chí nghiệm thu + lệnh kiểm chứng), log bằng chứng, ngân sách thời gian/token/bước. Ưu tiên tool này thay vì chạy shell goal.mjs.",
        args: {
          action: { type: "string", enum: GOAL_ACTIONS, description: "Thao tác cần làm" },
          objective: { type: "string", description: "Mục tiêu (action=set)" },
          note: { type: "string", description: "Ghi chú/lý do/nội dung (log, block, item_fail, item_add, accept_add, complete)" },
          evidence: { type: "string", description: "Bằng chứng thật (item_done, accept_done)" },
          verify: { type: "string", description: "Lệnh kiểm chứng (item_add)" },
          index: { type: "integer", minimum: 1, description: "Số thứ tự việc/tiêu chí (1-based)" },
          minutes: { type: "number", description: "Ngân sách phút (action=budget)" },
          tokens: { type: "integer", description: "Ngân sách token (action=budget)" },
          steps: { type: "integer", description: "Ngân sách bước (action=budget)" },
          review: { type: "boolean", description: "Yêu cầu duyệt kế hoạch trước khi thi hành (action=set)" },
          force: { type: "boolean", description: "Bỏ qua gate (complete/item_done) — chỉ khi thật sự cần" },
        },
        execute: async (args, context) => {
          const argv = toolArgv(args ?? {});
          const result = spawnSync(process.execPath, [goalScriptPath(), ...argv], {
            cwd: context?.directory ?? directory,
            encoding: "utf8",
            timeout: 600000,
          });
          const status = typeof result.status === "number" ? result.status : 1;
          const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
          const text = status === 0 ? output : `${output}\n[exit ${status}]`;
          return { title: `goal ${argv[0] ?? "status"}`, output: text || "(không có output)" };
        },
      },
    },
  };
}
