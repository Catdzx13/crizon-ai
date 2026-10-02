<div align="center">

# Crizon AI CLI

**Trợ lý AI của CrizonShop ngay trong terminal — cài 1 lệnh, chạy 1 lệnh.**

[![Release](https://img.shields.io/github/v/release/Catdzx13/crizon-ai?label=release&color=2563eb)](https://github.com/Catdzx13/crizon-ai/releases/latest)
[![Platforms](https://img.shields.io/badge/n%E1%BB%81n%20t%E1%BA%A3ng-Windows%20%7C%20macOS%20%7C%20Linux-16a34a)](#n%E1%BB%81n-t%E1%BA%A3ng-h%E1%BB%97-tr%E1%BB%A3)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-6b7280)](LICENSE)

</div>

---

## Cài đặt

```bash
# 1 lệnh cài
npm i -g github:Catdzx13/crizon-ai

# Lần đầu: chọn ngôn ngữ rồi dán API key (nhập ẩn, không lưu vào lịch sử shell)
crizon-ai

# Mở Crizon (tự tải binary theo hệ điều hành lần đầu)
crizon-ai tui
```

> Chưa có key? Tạo tại [crizonshop.com/dashboard](https://crizonshop.com/dashboard?view=keys) (mục **API key**), hoặc gõ `crizon-ai portal`.

## Tính năng

- **Crizon** — giao diện chat/lập trình trong terminal, việt hoá toàn bộ, logo & thương hiệu Crizon.
- **Goal loop `/goal`** — giao việc theo mục tiêu: kế hoạch + tiêu chí nghiệm thu, todo ngay trong phiên, ngân sách thời gian/token/bước, tự chạy lệnh kiểm chứng.
- **Recap `/recap`** — quay lại sau vẫn nắm ngay tiến độ: tóm tắt 40–60 từ (mục tiêu · đã xong · blocker · việc kế tiếp), không ghi vào hội thoại.
- **Mức tư duy theo model** — `tắt · nhanh · cân-bằng · sâu` (đổi nhanh bằng `ctrl+t`).
- **1 key dùng mọi model** — không khoá model theo key; chọn model ngay trong CLI (`crizon-ai models`, `/model`, `--model <id>`).
- **1 key dùng cho nhiều CLI** — kết nối Claude Code, Codex, Crizon, Aider, Qwen bằng cùng một API key Crizon.
- **CLI nhẹ (zero-dep)** — `chat`, `ask`, `models`, `logs`, `roles`, wizard lần đầu, i18n vi/en.
- **Tự tải binary** — `crizon-ai tui` tải bản đúng hệ điều hành từ GitHub Releases vào `~/.crizon-ai/bin`.

## Bắt đầu nhanh

```bash
crizon-ai                      # wizard 3 bước (ngôn ngữ → key → kiểu dùng) rồi vào chat
crizon-ai login --key czn_...  # lưu key thủ công (key sẽ nằm trong lịch sử shell — nên dùng wizard)
crizon-ai models               # danh sách model khả dụng theo key
crizon-ai ask "Tóm tắt giúp tôi đơn hàng #1024"
crizon-ai chat                 # phiên chat dài, tự lưu lịch sử
```

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `crizon-ai` | Vào chat ngay (lần đầu chạy wizard) |
| `crizon-ai tui` | Mở **Crizon** trong terminal (tự tải binary lần đầu) |
| `crizon-ai login [--key czn_…] [--web]` | Lưu API key + kiểm tra kết nối |
| `crizon-ai portal` | Mở trang tạo API key trên portal |
| `crizon-ai models [--json]` | Danh sách model theo key |
| `crizon-ai ask "…"` | Hỏi một câu (stream + markdown) |
| `crizon-ai chat [--session <tên>]` | Phiên chat nhiều lượt |
| `crizon-ai setup claude\|codex\|tui\|aider\|qwen` | Kết nối CLI/harness với API Crizon |
| `crizon-ai doctor` | Chẩn đoán kết nối, key, model, harness |
| `crizon-ai recap [--session <tên>]` | **Tóm tắt catch-up phiên** (kiểu Codex `/recap`): mục tiêu · đã xong · blocker · việc kế tiếp |
| `crizon-ai logs` · `roles` · `settings` · `config` · `logout` | Nhật ký · system prompt tái sử dụng · cài đặt · cấu hình |

## Nền tảng hỗ trợ

`crizon-ai tui` tự tải đúng binary cho máy bạn:

| Nền tảng | Asset phát hành |
|---|---|
| Windows x64 | `crizon-tui-windows-x64.exe` |
| macOS Apple Silicon / Intel | `crizon-tui-darwin-arm64` · `crizon-tui-darwin-x64` |
| Linux x64 / arm64 | `crizon-tui-linux-x64` · `crizon-tui-linux-arm64` |

Mỗi bản được build và chạy smoke test ngay trên hệ điều hành tương ứng. Tắt tự tải: `crizon-ai tui --no-download`.

## Chọn model

Một key Crizon **không bị giới hạn model**. Chọn model ở CLI:

```bash
crizon-ai models                          # xem toàn bộ model khả dụng
crizon-ai ask "…" --model crizon/gpt-standard
```

Trong chat: `/model` · Trong TUI: `ctrl+x m` (hoặc `/variants` để đổi mức tư duy).

## Crizon trong terminal

- Khởi động: `crizon-ai tui` — mở trong thư mục dự án hiện tại.
- Mục tiêu: `/goal <mục tiêu>` · `/goal pause|resume|complete|clear` · `/goal budget <phút>`.
- Chẩn đoán: `/doctor` — kiểm tra key, gateway, model, goal ngay trong TUI.
- Tóm tắt nhanh: **`/recap`** — catch-up 40–60 từ khi quay lại (mục tiêu · đã xong · blocker · việc kế tiếp).
- `Ctrl+P` mở bảng lệnh, `Tab` đổi agent, `Esc` dừng trả lời.
- Trạng thái mục tiêu lưu theo dự án tại `.crizon/goal.json`.

## Kết nối CLI khác bằng cùng một key

```bash
crizon-ai setup claude    # Claude Code
crizon-ai setup codex     # Codex
crizon-ai setup aider     # Aider
crizon-ai setup qwen      # Qwen Code
crizon-ai setup tui       # Crizon
```

Mỗi lệnh ghi env riêng (quyền 600) + khối marker vào shell profile (có backup), không đụng cấu hình sẵn có.

## Bảo mật

- API key lưu cục bộ với quyền `600`, không gửi đi đâu ngoài API Crizon.
- Phiên TUI mặc định **không chia sẻ ra ngoài** (`share: "disabled"`).
- Key hiển thị một lần khi tạo; có thể thu hồi/xoay vòng bất kỳ lúc nào trên portal.

## Phát triển

```bash
node --test                 # chạy bộ test (zero-dep)
node tools/build-tui.mjs    # đóng gói TUI thành 1 file binary (cần Bun + source)
node tools/demo-tui.mjs     # chạy thử TUI với gateway giả lập
```

## Bản quyền

[MIT](LICENSE) © CrizonShop. Thành phần bên thứ ba: xem [THIRD-PARTY.md](THIRD-PARTY.md).

---

<div align="center">
<a href="https://github.com/Catdzx13/crizon-ai/releases/latest">Tải bản mới nhất</a> ·
<a href="https://github.com/Catdzx13/crizon-ai/issues">Báo lỗi / góp ý</a> ·
<a href="https://crizonshop.com">CrizonShop</a>
</div>
