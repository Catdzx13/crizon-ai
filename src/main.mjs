import * as cmd from "./commands.mjs";
import { resolveConfig } from "./config.mjs";
import { detectLang, setLang, t } from "./i18n.mjs";
import { closeLineReaders } from "./ui.mjs";
import { c, parseArgs, VERSION } from "./util.mjs";
import { runWizard } from "./wizard.mjs";

function helpText() {
  return [
    t("help.title", { version: VERSION }),
    "",
    t("help.usage"),
    `  crizon-ai                                  ${t("help.cmdChat")}`,
    `  crizon-ai login [--key czn_...] [--web]   ${t("help.cmdLogin")}`,
    `  crizon-ai portal                           ${t("help.cmdPortal")}`,
    `  crizon-ai tui [--bin <path>]               ${t("help.cmdTui")}`,
    `  crizon-ai models                           ${t("help.cmdModels")}`,
    `  crizon-ai ask "câu hỏi"                    ${t("help.cmdAsk")}`,
    `  crizon-ai chat [--session <tên>]           ${t("help.cmdChat")}`,
    `  crizon-ai settings                         ${t("help.cmdSettings")}`,
    `  crizon-ai language [vi|en|ko]              ${t("help.cmdLanguage")}`,
    `  crizon-ai doctor [--json]                  ${t("help.cmdDoctor")}`,
    `  crizon-ai logs [--limit N] [--clear]       ${t("help.cmdLogs")}`,
    `  crizon-ai roles [list|add|rm]              ${t("help.cmdRoles")}`,
    `  crizon-ai setup claude|codex|opencode|aider|qwen   ${t("help.cmdSetup")}`,
    `  crizon-ai disconnect <harness>            ${t("help.cmdDisconnect")}`,
    `  crizon-ai env [--shell powershell]         ${t("help.cmdEnv")}`,
    `  crizon-ai config [--check]                 ${t("help.cmdConfig")}`,
    `  crizon-ai logout                           ${t("help.cmdLogout")}`,
    "  crizon-ai help | --version",
    "",
    t("help.askOptions"),
    "  --model <id>  --system \"<text>\"  --role <tên>  --no-stream  --json",
    "  --temperature <n>  --max-tokens <n>",
    "",
    t("help.env"),
  ].join("\n");
}

export async function main(argv = []) {
  const { flags, positionals, error } = parseArgs(argv);
  const env = process.env;
  const early = resolveConfig({ flags, env });
  setLang(early.lang || detectLang(env));

  if (error) {
    console.error(`${c.red("✗")} ${error}`);
    console.error(helpText());
    return 2;
  }
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (flags.help) {
    console.log(helpText());
    return 0;
  }

  const io = cmd.defaultIo();
  const command = positionals[0];
  flags._ = positionals.slice(1);
  try {
    switch (command) {
      case undefined: {
        if (!early.apiKey) {
          const result = await runWizard({ env, io });
          if (!result) return 0;
        }
        return await cmd.cmdChat({ flags, io });
      }
      case "help":
        console.log(helpText());
        return 0;
      case "login":
        return await cmd.cmdLogin({ flags, io });
      case "portal":
        return await cmd.cmdPortal({ flags, io });
      case "tui":
        return await cmd.cmdTui({ flags, io });
      case "logout":
        return await cmd.cmdLogout({ io });
      case "config":
        return await cmd.cmdConfig({ flags, io });
      case "models":
        return await cmd.cmdModels({ flags, io });
      case "ask":
        return await cmd.cmdAsk({ flags, io, stdin: process.stdin });
      case "chat":
        return await cmd.cmdChat({ flags, io });
      case "settings":
        return await cmd.cmdSettings({ flags, io });
      case "language":
        return await cmd.cmdLanguage({ flags, io });
      case "doctor":
        return await cmd.cmdDoctor({ flags, io });
      case "logs":
        return await cmd.cmdLogs({ flags, io });
      case "roles":
        return await cmd.cmdRoles({ flags, io });
      case "setup":
        return await cmd.cmdSetup({ flags, io });
      case "disconnect":
        return await cmd.cmdDisconnect({ flags, io });
      case "env":
        return await cmd.cmdEnv({ flags, io });
      default:
        console.error(t("chat.unknownCmd", { cmd: command }));
        console.error(helpText());
        return 2;
    }
  } catch (err) {
    console.error(`${c.red("✗")} ${err?.message || err}`);
    return 1;
  } finally {
    closeLineReaders();
  }
}
