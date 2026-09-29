# crizon-ai — CLI dùng API AI Crizon

Gọi API AI của CrizonShop từ terminal (OpenAI-compatible: `/v1/models`, `/v1/chat/completions`).
Zero dependency — chỉ cần **Node.js ≥ 20**.

## Cài đặt

```bash
# 1 lệnh cài (cần Node >= 20 và git)
npm i -g github:Catdzx13/crizon-ai

# 1 lệnh khởi động: TUI OpenCode việt hoá (tự tải binary ~138 MB lần đầu; hiện có bản Windows x64)
crizon-ai tui

# hoặc chat nhẹ ngay trong terminal (không cần binary)
crizon-ai
```

- `crizon-ai` = CLI nhẹ (chat/ask/models/setup — chạy ngay, không cần tải gì thêm).
- `crizon-ai tui` = TUI OpenCode việt hoá đầy đủ (tự tải binary từ GitHub Releases vào `~/.crizon-ai/bin`).
- Nền tảng khác (macOS/Linux) chưa có binary phát hành — tự build: `node tools/build-opencode-vi.mjs`.

## Bắt đầu nhanh

```bash
# Lần đầu: gõ "crizon-ai" — wizard 3 bước (ngôn ngữ → key → kiểu dùng) rồi vào chat luôn
crizon-ai

# Hoặc thủ công:
crizon-ai login --key czn_xxxxxxxxxxxx   # lưu key (portal: /dashboard → API Keys)
crizon-ai models                         # danh sách model (động theo key)
crizon-ai ask "Viết giúp tôi email xác nhận đơn hàng"
crizon-ai chat
```

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `crizon-ai` | Lần đầu: wizard (ngôn ngữ/key/kiểu dùng). Đã cấu hình: vào chat ngay |
| `login [--key czn_...] [--web]` | Lưu key vào `~/.crizon-ai.json` (quyền 600) và kiểm tra kết nối. Không có `--key`: hiện **link tạo key** trên portal (`--web`: tự mở trình duyệt) |
| `portal` | Mở trang **tạo API key** trên portal (`/dashboard?view=keys`) |
| `tui [--bin <path>]` | Mở **TUI OpenCode việt hoá** với config/key Crizon thật (không mock); tham số sau `--` chuyển tiếp cho OpenCode |
| `logout` | Xoá key đã lưu |
| `config [--check]` | Xem base URL / key (che) / model / ngôn ngữ / đường dẫn config; `--check` kiểm tra kết nối |
| `models [--json]` | Danh sách model theo quyền của key |
| `ask "..."` | Hỏi một câu — stream + render markdown; `--no-stream`, `--json`, `--model`, `--system`, `--role`, `--temperature`, `--max-tokens` |
| `chat [--session <tên>]` | REPL hội thoại (tự lưu/lấy lại phiên): `/model` (picker động), `/system`, `/clear`, `/settings`, `/exit` |
| `settings` | Panel cài đặt: Ngôn ngữ · API key · Model · **Kết nối agent** · Doctor |
| `language [vi\|en]` | Đổi ngôn ngữ CLI (lưu config; trong chat dùng `/language`) |
| `setup claude\|codex\|opencode\|aider\|qwen` | Kết nối harness: preflight gateway → ghi env (600) + khối marker vào shell profile (có backup) — model chạy qua API Crizon |
| `disconnect <harness>` | Ngắt kết nối: gỡ đúng khối marker + xoá file env |
| `doctor [--json]` | Kiểm tra CLI/config/gateway/key/model/harness/**kết nối**/**hỗ trợ `/v1/messages`,`/v1/responses`** |
| `logs [--limit N] [--clear] [--json]` | Xem lịch sử hỏi đáp cục bộ (`~/.crizon-ai/logs.jsonl`) |
| `roles [list\|add\|rm]` | Quản lý role (system prompt tái sử dụng), dùng với `ask --role <tên>` |
| `env [--shell powershell]` | In `OPENAI_BASE_URL`/`OPENAI_API_KEY` cho Codex CLI & client OpenAI-compatible |

### Goal loop (`/goal`) — tính năng Crizon trong OpenCode

`crizon-ai setup opencode` cài thêm lệnh **`/goal`** + agent **`goal-runner`** (OpenCode không có sẵn tính năng này):

- `/goal <mục tiêu>` — tạo/tiếp tục vòng mục tiêu **plan-first**: tiêu chí nghiệm thu (`accept add`) + việc nhỏ kèm lệnh kiểm chứng (`item add --verify`), tối đa 20 bước
- Tiến độ hiển thị trong TUI qua tool `todowrite` → **thanh nhiệm vụ ở sidebar Todo** (`[✓]` xong · `[•]` đang làm · `[ ]` chờ; mở sidebar bằng phím tắt `session.sidebar.toggle`); `/goal` chạy ở phiên chính nên task bar hiện suốt phiên
- `/goal pause` · `/goal resume` · `/goal complete` · `/goal clear` — `complete` **bị chặn** nếu còn tiêu chí chưa đạt (có `--force`)
- `/goal budget <phút>` — ngân sách thời gian; hết hạn thì dừng tiến độ (chặn cả tick tiêu chí), `/goal resume` để tiếp · `budget set --tokens N` / `--steps N` cũng hỗ trợ
- **Token đếm thật** bằng plugin server (đọc từng bước `step-finish`), không cần ước lượng; **briefing goal tự chèn vào system prompt mọi lượt chat** — agent luôn biết goal, việc kế tiếp, tiêu chí chưa đạt
- `item done` **tự chạy lệnh `--verify`** đã khai báo — verify fail thì không cho đánh dấu xong (`--force` để bỏ qua)
- Goal đang dở (`paused`/`blocked`/hết ngân sách) **không tự chạy** khi mở lại — `/goal` hiện cảnh báo + gợi ý resume
- `/goal review <mục tiêu>` — **chế độ duyệt**: agent lập kế hoạch rồi **dừng chờ duyệt**; gõ `/goal approve` mới thi hành
- Việc thất bại: agent gọi `item fail` — **2 lần liên tiếp tự block** (không tự chạy tiếp); `goal.json` có `version` để nâng cấp định dạng an toàn
- **Tool `goal` có type** (plugin Crizon đăng ký): model gọi `goal({action:"item_add", …})` thay vì shell — không cần zod/bundle, shell vẫn là dự phòng
- **Panel local: ĐÃ XOÁ (2026-09-28)** theo chỉ đạo (vô tích sụ) — gỡ lệnh `/fcc`, xoá script/test, hoàn nguyên FCC, xoá seed provider.
  Hiện tại: dùng key Crizon qua `crizon-ai setup claude|codex|opencode`; `/doctor` là bản text trong TUI.
- Trạng thái lưu tại **`.opencode/goal.json`** (theo dự án); script quản lý `opencode-goal.mjs` nằm trong harness
- Chặn sẵn: `git push`, `git reset --hard`, `rm -rf`, `Remove-Item -Recurse -Force`

### Mức tư duy (variants) — mới

`crizon-ai setup opencode` sinh 4 mức cho mỗi model Crizon (đổi nhanh bằng `ctrl+t` hoặc `/variants`):

| Mức | Gửi lên API |
|---|---|
| **tắt** | `thinking: { type: "disabled" }` |
| **nhanh** | `reasoning_effort: "low"` |
| **cân-bằng** | `reasoning_effort: "high"` |
| **sâu** | `reasoning_effort: "max"` |

Gateway cũng map sẵn: Claude Code gửi `thinking.budget_tokens` → 3 bậc; Codex gửi `reasoning.effort` → 3 bậc.
**`/share` bị tắt mặc định** (`share: "disabled"`) — không đẩy session lên opencode.ai.

### TUI OpenCode việt hoá (Crizon) — chạy & đóng gói 1 file

- **Chạy nhanh**: `crizon-ai tui` — nếu chưa có binary sẽ **tự tải từ GitHub Releases** (~138 MB, Windows x64)
  vào `~/.crizon-ai/bin/` rồi mở (bỏ qua bằng `--no-download`; đổi nguồn bằng `CRIZON_TUI_DOWNLOAD_BASE`).
- **Chạy từ repo**: `node tools/demo-opencode.mjs` — ưu tiên binary đã có, không có thì chạy từ source;
  `--source` ép chạy source, `--binary` quay về OpenCode gốc (`CRIZON_OPENCODE_VI_BIN` để trỏ binary khác).
- **Đóng gói** (khách không cần Bun): `node tools/build-opencode-vi.mjs --skip-install`
  → `apps/ai-cli/dist/opencode/<os>-<arch>/opencode[.exe]` (~138 MB, đã bỏ Web UI nhúng; upstream 172 MB).
  Script tự: vá từ điển → `bun build --single --skip-embed-web-ui` → smoke `--version` → copy artifact.
- **Kiểm tra tiếng Việt runtime**: `node tools/opencode-vi/smoke-tui.mjs <binary> --palette`
  (chạy TUI thật trong pty, bắt màn hình tìm chuỗi Việt).
- Từ điển: `tools/opencode-vi/strings.json` + `patch.mjs --check|--restore`; chạy source cần Bun + `bun install`
  trong `reference/ai-clis/opencode` (chỉ dev, gitignored).

Ghi chú UX:

- **Màn chào + composer kiểu OpenCode**: vào chat in wordmark + phiên bản + "Tips for getting started:" + phiên/model; **gradient cyan→tím chạy ngang từng ký tự + shimmer quét qua logo khi khởi động** (terminal thật); **tin nhắn người dùng = khối viền trái `┃` + nền band**; **khung nhập kiểu OpenCode** (viền trái `┃`, nền band, meta `Crizon AI · model` bên trong, đáy `╹`); footer 2 bên (trái = thư mục, phải = phím tắt); chờ/đang trả lời có spinner trong khung; ↑↓ nhớ lịch sử; `Esc` dừng stream; Ctrl+C hai lần để thoát. Đổi kiểu logo: `--logo big|oc|mark|off` (hoặc `CRIZON_LOGO` / `"logo"` trong config; mặc định `big`):

  ```
    ____   ____    ___   _____   ___    _   _
   / ___| |  _ \  |_ _| |__  /  / _ \  | \ | |
  | |     | |_) |  | |    / /  | | | | |  \| |
  | |___  |  _ <   | |   / /_  | |_| | | |\  |
   \____| |_| \_\ |___| /____|  \___/  |_| \_|

  Crizon AI 1.0.0   crizon/gpt-standard · phiên default

  Tips for getting started:
  1. /help để xem lệnh · /model đổi model (danh sách động)
  ...

  ┃
  ┃ viết giúp tôi email xác nhận đơn hàng
  ┃
  Kính gửi Anh/Chị, …
  ┃
  ┃ ❯ Hỏi bất cứ điều gì…  (/ để xem lệnh)
  ┃ Crizon AI · crizon/gpt-standard
  ╹
    ~\Downloads\crizonshop-platform        ↑↓ lịch sử · Esc dừng · /help
  ```
  (Nguồn tham chiếu: `opencode/packages/tui/src/logo.ts` — wordmark nửa ô; `gemini-cli/.../{AppHeader,Tips,Composer,Footer}.tsx` + snapshot — tips/composer/footer; `crush/internal/ui/logo/logo.go` — gradient + nhịp meta; Claude Code welcome/spinner.)
- **Autocomplete lệnh (kiểu OpenCode)**: gõ `/` → popup lệnh có mô tả (`↑↓` chọn · `Tab`/`Enter` điền · `Esc` đóng); `/sessions` mở danh sách phiên để đổi, `/rename <tên>` đổi tên phiên; **`Esc` dừng giữa lúc đang trả lời**.
- **Khung panel (TUI)** cho menu/picker/màn "Kết nối agent" — `┌─ ─┐`, dòng đang chọn reverse-video.
- **i18n vi/en** — chọn lúc wizard hoặc trong `settings`; lưu vào file config.
- **Model picker động** — `/model` trong chat (hoặc mục Model trong settings) tải danh sách từ API, gõ để lọc.
- **Markdown + spinner** — phản hồi được render theo dòng ngay khi stream (heading, đậm, code block, list…); spinner chỉ hiện trên terminal.
- **Non-TTY / pipe** — mọi menu tự chuyển sang dạng "nhập số"; `NO_COLOR=1` để tắt màu.
- **Phiên chat** — lưu tại `~/.crizon-ai/sessions/<tên>.json` (mặc định `default`), tự tiếp tục ở lần chạy sau.
- **Log cục bộ** — `~/.crizon-ai/logs.jsonl` (prompt/trả lời cắt 500 ký tự, có usage; không chứa key).

## Slash commands (copy từ OpenCode)

**Có sẵn trong chat**: `/help` · `/model` (alias `/models`) · **`/language [vi|en]`** · `/settings` · `/system` · `/sessions` · `/new [tên]` · `/rename <tên>` · `/undo` · `/export [file]` · `/status` · `/clear` · `/exit`. Gõ `/` để mở danh sách (↑↓ · Tab/Enter điền · Esc đóng).

**Lệnh tự tạo** (giống `docs/commands` của OpenCode):

- **Thư mục**: `<cwd>/.opencode/commands/` · `<cwd>/.crizon/commands/` · `~/.config/opencode/commands/` · `~/.crizon-ai/commands/` — tên file = tên lệnh (`test.md` → `/test`); project đè global.
- **Frontmatter**: `description`, `model` (lệnh chạy bằng model riêng); `agent` được chấp nhận nhưng bỏ qua.
- **Template**: `$ARGUMENTS` (toàn bộ tham số) · `$1..$n` (theo từng tham số, hỗ trợ quote) · **!`shell`** (chạy trong cwd, chèn stdout) · **@file** (chèn nội dung file).
- Hoặc khai báo trong `~/.crizon-ai.json`: `"command": { "test": { "template": "...", "description": "...", "model": "..." } }`.

Ví dụ `.crizon/commands/review.md`:

```md
---
description: Review thay đổi gần đây
model: crizon/deepseek-pro
---

Git log gần đây:
!`git log --oneline -5`

Đọc @README.md rồi review: $ARGUMENTS
```

→ trong chat gõ `/review phần thanh toán` là prompt được mở rộng và gửi đi.

## Kết nối Claude Code / Codex / OpenCode (M3)

```bash
crizon-ai setup claude     # preflight gateway → ghi env + khối marker vào shell profile
crizon-ai setup codex      # hoặc: crizon-ai settings → Kết nối agent
crizon-ai setup opencode   # OpenCode (MIT) chạy nguyên TUI của nó, model qua API Crizon
crizon-ai disconnect claude
```

- **Claude Code**: ghi `ANTHROPIC_BASE_URL` (origin, không `/v1`), `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL` (nếu đã chọn model) → chạy `claude` là dùng model qua API Crizon.
- **Codex**: ghi `OPENAI_BASE_URL` (có `/v1`), `OPENAI_API_KEY`.
- **OpenCode**: ghi config riêng `~/.crizon-ai/harness/opencode.json` (provider `crizon` = `@ai-sdk/openai-compatible` + baseURL + model lấy động từ `/v1/models`) + `opencode-tui.json` + plugin thương hiệu `opencode-brand.tsx` (**logo CRIZON trên màn hình chính qua slot `home_logo`** — plugin chính thức của OpenCode) và env `OPENCODE_CONFIG`/`OPENCODE_TUI_CONFIG` — **không đụng config OpenCode của bạn**; chạy `opencode --standalone` (đã kiểm chứng end-to-end với gateway giả: `> build · crizon/gpt-standard` + trả lời qua SSE).
- **An toàn**: không đè file người dùng — chỉ ghi khối `# >>> crizon-ai (<harness>) >>> … # <<< crizon-ai <<<` và tạo backup trước khi sửa; file env riêng `~/.crizon-ai/harness/<harness>.env` (quyền 600). **Raw key không bao giờ in ra stdout** (chỉ hiện dạng che; key thật nằm trong file 600).
- **Tuỳ chọn**: `--print` (xem khối sẽ ghi, không ghi gì) · `--no-apply` (chỉ ghi file env, không đụng profile) · `--profile <path>` (đổi file profile đích) · `--json`.
- **Preflight**: `setup`/`settings`/`doctor` tự probe `HEAD /v1/messages` / `/v1/responses` — gateway cũ trả 404 sẽ hiện cảnh báo "chưa hỗ trợ" thay vì kết nối hỏng.

## Chạy thử ngay — 1 lệnh duy nhất

```powershell
# TUI crizon-ai (tự làm)
node apps\ai-cli\tools\demo.mjs

# Mở OpenCode THẬT với API Crizon (mock) — TUI của OpenCode
node apps\ai-cli\tools\demo-opencode.mjs
# chạy nhanh 1 câu không tương tác:
node apps\ai-cli\tools\demo-opencode.mjs "xin chào"
```

Lệnh này tự: mở mock gateway (cổng ngẫu nhiên) → trỏ CLI vào đó với config/home/profile **tạm** (không đụng máy thật hay OpenCode thật) → vào chat/TUI luôn. Gõ câu hỏi để thử, `/exit` (CLI) hoặc Ctrl+C (OpenCode) để thoát (tự dọn dẹp).

<details>
<summary>Nâng cao (chỉ khi cần)</summary>

- Chạy mock riêng để test client khác (VD Claude Code thật):

  ```powershell
  node apps\ai-cli\tools\mock-gateway.mjs          # terminal 1 (cổng 18787)
  $env:ANTHROPIC_BASE_URL="http://127.0.0.1:18787"; $env:ANTHROPIC_AUTH_TOKEN="czn_local_test"; claude
  ```

- Mock giả lập đủ 3 giao thức: `/v1/models`, `/v1/chat/completions`, `/v1/messages` (+`count_tokens`), `/v1/responses`, HEAD preflight — dùng được cho cả `setup`/`doctor`.

</details>

## Cấu hình

Thứ tự ưu tiên: **flags > biến môi trường > file > mặc định**

| Nguồn | Giá trị |
|---|---|
| Biến môi trường | `CRIZON_API_KEY`, `CRIZON_BASE_URL`, `CRIZON_MODEL`, `CRIZON_LANG`, `CRIZON_CONFIG_PATH`, `CRIZON_HOME` |
| File | `~/.crizon-ai.json` — `{ "apiKey": "czn_...", "baseUrl": "...", "model": "...", "lang": "vi", "harness": "chat" }` |
| Thư mục dữ liệu | `~/.crizon-ai/` — `sessions/`, `logs.jsonl`, `roles.json` (đổi bằng `CRIZON_HOME`) |
| Mặc định | base `https://ai.crizonshop.com/v1` |

Ví dụ dùng trong CI/script (không cần login):

```bash
CRIZON_API_KEY=czn_xxx node bin/crizon-ai.mjs ask "ping" --no-stream
echo "tóm tắt file này" | node bin/crizon-ai.mjs ask
crizon-ai roles add gia-su "Bạn là giáo sư AI, trả lời ngắn gọn"
crizon-ai ask --role gia-su "Giải thích máy học cho trẻ 10 tuổi"
```

> ⚠️ Không commit key vào git. CLI không bao giờ in raw key ra output.

## Trạng thái phát triển

- ✅ **M1** — client API: login/models/ask/chat/env/config/logout, stream SSE, envelope lỗi.
- ✅ **M2** — wizard lần đầu · settings panel · i18n vi/en · model picker động · markdown + spinner · `--json` · roles · sessions · logs · `doctor` (28 test).
- ✅ **M3 (CLI-side)** — `setup claude|codex|opencode` (preflight + env 600 + khối marker có backup) · `disconnect` · panel "Kết nối agent" (●/○) · `doctor` probe `/v1/messages`/`/v1/responses` (38 test). Nghiệm thu thật (Claude Code chạy với model qua API Crizon) chờ gateway deploy + DNS.

## Lỗi thường gặp

| Mã | Nghĩa | Cách xử lý |
|---|---|---|
| `401 invalid_api_key` | Key sai/hết hiệu lực | Kiểm tra lại key, tạo key mới ở portal |
| `402` | Ví/hạn mức không đủ | Nạp tiền / đổi gói trên portal |
| `429` | Hết hạn mức hoặc request dồn | Thử lại sau; xem Usage trên portal |
| `503` | Gateway tạm bận / control-plane không sẵn sàng | Thử lại sau |
| `network_error` | Không kết nối được base URL | Kiểm tra mạng/base URL — chạy `crizon-ai doctor` |

## Phát triển

```bash
cd apps/ai-cli
npm test          # node --test (fixture HTTP nội bộ, không cần gateway thật)
```

Kế hoạch & phạm vi: `docs/ai-cli-plan.md` · Đặc tả UI: `docs/ai-cli-ui-spec.md`.
