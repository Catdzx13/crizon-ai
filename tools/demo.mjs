#!/usr/bin/env node
/**
 * DEMO 1 LỆNH cho `crizon-ai`:
 *   node apps/ai-cli/tools/demo.mjs
 *
 * Tự động: mở mock gateway (cổng ngẫu nhiên) → trỏ CLI vào đó với config/home/profile
 * tạm (không đụng cấu hình thật) → vào chat luôn. Thoát là tự dọn dẹp.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../src/main.mjs";
import { startMockGateway } from "./mock-gateway.mjs";

const dir = mkdtempSync(join(tmpdir(), "crizon-ai-demo-"));
const mock = await startMockGateway({ port: 0, quiet: true });

// Demo mặc định tiếng Việt; đổi bằng --lang en (không kế thừa CRIZON_LANG của shell)
const demoArgs = process.argv.slice(2);
const demoLangIndex = demoArgs.indexOf("--lang");
const LANG = demoLangIndex >= 0 ? String(demoArgs[demoLangIndex + 1] || "vi").slice(0, 2) : "vi";

// Seed 2 custom command mẫu để thấy trong autocomplete khi gõ "/" (theo ngôn ngữ đang dùng)
const seed = LANG === "en"
  ? {
    helloDesc: "Sample greeting (demo)",
    helloBody: "Hello $ARGUMENTS! Keep the answer short.",
    reviewDesc: "Review with shell output (demo)",
    reviewBody: "Shell data:\n!`echo shell-output-OK`\n\nPlease review: $ARGUMENTS",
  }
  : {
    helloDesc: "Lời chào mẫu (demo)",
    helloBody: "Chào $ARGUMENTS! Trả lời ngắn gọn giúp tôi.",
    reviewDesc: "Review kèm shell output (demo)",
    reviewBody: "Dữ liệu shell:\n!`echo shell-output-OK`\n\nHãy review: $ARGUMENTS",
  };
mkdirSync(join(dir, ".crizon", "commands"), { recursive: true });
writeFileSync(join(dir, ".crizon", "commands", "hello.md"), `---\ndescription: ${seed.helloDesc}\n---\n${seed.helloBody}`);
writeFileSync(join(dir, ".crizon", "commands", "review.md"), `---\ndescription: ${seed.reviewDesc}\n---\n${seed.reviewBody}`);

process.env.CRIZON_BASE_URL = mock.baseUrl;
process.env.CRIZON_API_KEY = "czn_demo_key_1234567890";
process.env.CRIZON_CONFIG_PATH = join(dir, "config.json");
process.env.CRIZON_HOME = join(dir, "home");
process.env.CRIZON_PROFILE_PATH = join(dir, "profile.ps1");
process.env.CRIZON_LANG = LANG; // ép theo --lang của demo

const dim = (line) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\u001b[2m${line}\u001b[0m` : line);
const TXT = {
  vi: { banner: (url) => `  demo · mock gateway ${url} · config tạm, không đụng máy thật`, bye: "  demo kết thúc — đã dọn dẹp (config tạm đã xoá)." },
  en: { banner: (url) => `  demo · mock gateway ${url} · temp config, your machine is untouched`, bye: "  demo finished — cleaned up (temp config removed)." },
};
const copy = TXT[LANG] ?? TXT.vi;
process.stdout.write(`${dim(copy.banner(mock.baseUrl))}\n`);

try {
  process.chdir(dir); // để chat đọc custom command trong thư mục demo (và không đụng dự án thật)
  const code = await main(process.argv.slice(2));
  process.exitCode = Number.isInteger(code) ? code : 0;
} finally {
  await mock.close().catch(() => undefined);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
