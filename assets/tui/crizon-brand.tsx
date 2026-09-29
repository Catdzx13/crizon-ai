/** @jsxImportSource @opentui/solid */
/**
 * Plugin thương hiệu Crizon cho TUI Crizon.
 * - Slot home_logo: wordmark line-art + subtitle, hiệu ứng shimmer + chấm nhấp nháy.
 * - Lệnh /language (và /lang): dialog chọn vi/en, đổi subtitle ngay trong phiên.
 * i18n: vi / en (mặc định từ CRIZON_LANG do `crizon-ai setup opencode` ghi vào env).
 * Chỉ dùng solid-js + API plugin chính thức (không node builtins) để load an toàn.
 */
import { For, createSignal, onCleanup } from "solid-js"

const LANGS = [
  { title: "Tiếng Việt", value: "vi" },
  { title: "English", value: "en" },
]
const TEXT = {
  vi: "Cổng API AI · kết nối model · gõ / để xem lệnh",
  en: "AI API gateway · model access · type / for commands",
}
const DIALOG_TITLE = { vi: "Ngôn ngữ", en: "Language" }
const TOAST = { vi: "Đã đổi ngôn ngữ", en: "Language changed" }

function readEnvLang() {
  const fromEnv = String(process.env.CRIZON_LANG || "").toLowerCase().slice(0, 2)
  return LANGS.some((item) => item.value === fromEnv) ? fromEnv : "vi"
}

const [lang, setLang] = createSignal(readEnvLang())
const subtitle = () => TEXT[lang()] ?? TEXT.vi

const LOGO = [
  "  ____   ____    ___   _____   ___    _   _ ",
  " / ___| |  _ \\  |_ _| |__  /  / _ \\  | \\ | |",
  "| |     | |_) |  | |    / /  | | | | |  \\| |",
  "| |___  |  _ <   | |   / /_  | |_| | | |\\  |",
  " \\____| |_| \\_\\ |___| /____|  \\___/  |_| \\_|",
]
const WIDTH = Math.max(...LOGO.map((line) => [...line].length))
const ROWS = LOGO.map((line) => [...line.padEnd(WIDTH, " ")])

// gradient cột: cyan → teal → blue → indigo
const RAMP = ["#67e8f9", "#5eead4", "#22d3ee", "#38bdf8", "#60a5fa", "#818cf8"]
const WAVE_HI = "#f8fafc"
const WAVE_SOFT = "#e0f2fe"

function View() {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((value) => (value + 1) % (WIDTH + 20)), 120)
  onCleanup(() => clearInterval(timer))

  const wave = () => tick() - 10
  const colorAt = (column) => {
    const distance = Math.abs(column - wave())
    if (distance <= 1) return WAVE_HI
    if (distance <= 3) return WAVE_SOFT
    const at = Math.round((column / Math.max(1, WIDTH - 1)) * (RAMP.length - 1))
    return RAMP[at] ?? "#22d3ee"
  }
  const dot = () => (Math.floor(tick() / 6) % 2 === 0 ? "#34d399" : "#065f46")

  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <box flexDirection="column" alignItems="flex-start">
        <For each={ROWS}>
          {(row) => (
            <box flexDirection="row">
              <For each={row}>{(charText, index) => <text fg={colorAt(index())}>{charText}</text>}</For>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={dot()}>●</text>
        <text fg="#94a3b8">{subtitle()}</text>
      </box>
    </box>
  )
}

const tui = async (api) => {
  const DialogSelect = api.ui.DialogSelect

  api.keymap.registerLayer({
    commands: [
      {
        name: "crizon.language",
        title: lang() === "en" ? "Crizon · Language" : "Crizon · Ngôn ngữ",
        desc: lang() === "en" ? "Change the Crizon UI language (vi/en)" : "Đổi ngôn ngữ giao diện Crizon (vi/en)",
        category: "Crizon",
        namespace: "palette",
        slashName: "language",
        slashAliases: ["lang"],
        run() {
          api.ui.dialog.replace(() => (
            <DialogSelect
              title={DIALOG_TITLE[lang()] ?? "Language"}
              options={LANGS}
              current={lang()}
              onSelect={(option) => {
                setLang(option.value)
                api.ui.dialog.clear()
                api.ui.toast({
                  variant: "success",
                  message: `${TOAST[option.value] ?? "Language"}: ${option.title}`,
                })
              }}
            />
          ))
        },
      },
    ],
  })

  api.slots.register({
    order: 50,
    slots: {
      home_logo() {
        return <View />
      },
    },
  })
}

const plugin = { id: "crizon.brand", tui }
export default plugin
