/** Wizard lần đầu: ngôn ngữ → key (validate) → kiểu dùng. */
import { CrizonClient, ApiError } from "./client.mjs";
import { loadConfigFile, resolveConfig, saveConfigFile } from "./config.mjs";
import { LANGS, detectLang, setLang, t } from "./i18n.mjs";
import { portalKeysUrl } from "./open-url.mjs";
import * as uiReal from "./ui.mjs";

/**
 * @param {object} opts
 * @param {object} opts.env - biến môi trường (test truyền env giả)
 * @param {object} opts.io  - { out, write, err, stdin, stdout }
 * @param {object} opts.uiFns - inject { select, inputHidden, confirm } cho test
 */
export async function runWizard({ env = process.env, io, uiFns = uiReal } = {}) {
  const cfg = resolveConfig({ env });

  // 1) ngôn ngữ
  const langPick = await uiFns.select(io, LANGS, { title: t("wizard.langTitle") });
  const lang = langPick?.item?.code || detectLang(env);
  setLang(lang);

  // 2) key
  let apiKey = "";
  let savedUnverified = false;
  uiReal.panel(io, t("wizard.keyTitle"));
  io.out(t("wizard.keyPortal", { url: portalKeysUrl(cfg.portalUrl) }));
  for (;;) {
    const entered = await uiFns.inputHidden(io, { prompt: t("wizard.keyPrompt") });
    if (entered === null) return null; // Ctrl+C
    apiKey = String(entered || "").trim();
    if (!apiKey) {
      io.out(t("wizard.keyEmpty"));
      continue;
    }
    io.out(t("wizard.keyChecking"));
    try {
      const data = await new CrizonClient({ baseUrl: cfg.baseUrl, apiKey }).models();
      const count = Array.isArray(data?.data) ? data.data.length : 0;
      io.out(t("wizard.keyOk", { count }));
      break;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        io.out(t("wizard.keyUnreachable", { base: cfg.baseUrl, code: err.code }));
        const retry = await uiFns.confirm(io, { prompt: t("wizard.keyRetry"), defaultYes: false });
        if (!retry) {
          savedUnverified = true;
          break;
        }
      } else {
        const code = err instanceof ApiError ? `${err.status} ${err.code}` : String(err?.message || err);
        io.out(t("wizard.keyInvalid", { code }));
        const retry = await uiFns.confirm(io, { prompt: t("wizard.keyRetry"), defaultYes: true });
        if (!retry) return null;
      }
    }
  }

  // 3) kiểu dùng
  const modes = [
    { code: "chat", label: t("wizard.modeChat") },
    { code: "claude", label: t("wizard.modeClaude") },
    { code: "codex", label: t("wizard.modeCodex") },
    { code: "opencode", label: t("wizard.modeOpencode") },
  ];
  const modePick = await uiFns.select(io, modes, { title: `${t("wizard.modeTitle")}  ${t("wizard.modeNote")}` });
  const harness = modePick?.item?.code || "chat";

  const file = loadConfigFile(env);
  const path = saveConfigFile({ ...file, lang, apiKey, harness }, env);
  io.out(t("wizard.saved", { path }));
  if (savedUnverified) io.out(t("login.unverified", { err: t("err.unreachableMsg", { base: cfg.baseUrl }) }));
  if (harness === "chat") io.out(t("wizard.done"));
  else io.out(t("wizard.modePending", { harness: { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" }[harness] ?? harness }));
  return { lang, apiKey, harness };
}
