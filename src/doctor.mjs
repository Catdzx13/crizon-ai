/** Doctor: kiểm tra CLI/config/gateway/key/model/harness. */
import { CrizonClient, ApiError } from "./client.mjs";
import { resolveConfig } from "./config.mjs";
import { commandExists, detectProfilePath, HARNESSES, harnessStatus, managedEnvFile, probeCompat } from "./harness.mjs";
import { t } from "./i18n.mjs";
import { SYM } from "./ui.mjs";

export async function runDoctor({ env = process.env, flags = {}, io, version = "?" } = {}) {
  const cfg = resolveConfig({ flags, env });
  const rows = [];

  rows.push({ level: "ok", label: t("doctor.cli"), value: `v${version} · node ${process.version} · ${process.platform}` });

  const hasCfg = cfg.apiKey || cfg.source === "file" || cfg.source === "env";
  rows.push({
    level: cfg.apiKey ? "ok" : "warn",
    label: t("doctor.config"),
    value: cfg.apiKey ? `${cfg.configPath} (${cfg.source})` : t("doctor.noConfig"),
  });

  let modelIds = [];
  if (!cfg.apiKey) {
    rows.push({ level: "err", label: t("doctor.key"), value: t("err.noKey").split("\n")[0] });
  } else {
    try {
      const data = await new CrizonClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }).models();
      modelIds = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : [];
      rows.push({ level: "ok", label: t("doctor.gateway"), value: cfg.baseUrl });
      rows.push({ level: "ok", label: t("doctor.key"), value: `${t("settings.keyValid")} — ${modelIds.length}` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        rows.push({ level: "err", label: t("doctor.gateway"), value: t("err.unreachableMsg", { base: cfg.baseUrl }) });
      } else {
        const code = err instanceof ApiError ? `${err.status} ${err.code}` : String(err?.message || err);
        rows.push({ level: "ok", label: t("doctor.gateway"), value: cfg.baseUrl });
        rows.push({ level: "err", label: t("doctor.key"), value: code });
      }
    }
  }

  if (cfg.model) {
    const inList = modelIds.length === 0 || modelIds.includes(cfg.model);
    rows.push({ level: inList ? "ok" : "warn", label: t("doctor.model"), value: cfg.model });
  } else {
    rows.push({ level: "warn", label: t("doctor.model"), value: modelIds[0] ? `${modelIds[0]} (auto)` : t("common.notSet") });
  }

  const profilePath = detectProfilePath(process.platform, env);
  for (const harness of Object.values(HARNESSES)) {
    const installed = commandExists(harness.command);
    rows.push({
      level: installed ? "ok" : "warn",
      label: `${t("doctor.harness")} · ${harness.name}`,
      value: installed ? "installed" : t("doctor.harnessMissing", { hint: harness.hint }),
    });
    const status = harnessStatus(env, harness.id, { profilePath });
    rows.push({
      level: status.connected ? "ok" : "warn",
      label: `${t("doctor.connect")} · ${harness.name}`,
      value: status.connected
        ? t("doctor.connected", { target: status.managed ? managedEnvFile(env, harness.id) : profilePath })
        : t("doctor.notConnected", { id: harness.id }),
    });
  }

  if (cfg.apiKey) {
    const probes = await Promise.all(Object.values(HARNESSES).map(async (harness) => ({
      harness,
      probe: await probeCompat(cfg.baseUrl, harness.id, { timeoutMs: 3_000 }),
    })));
    for (const { probe } of probes) {
      const label = t("doctor.compat", { path: probe.url });
      const value = probe.status === 0
        ? t("doctor.compatUnreachable")
        : probe.supported
          ? t("doctor.compatOk")
          : t("doctor.compatMissing");
      rows.push({ level: probe.supported ? "ok" : "warn", label, value });
    }
  }

  if (flags.json) {
    io.out(JSON.stringify({ baseUrl: cfg.baseUrl, ok: rows.filter((r) => r.level === "err").length === 0, rows }, null, 2));
  } else {
    io.out(t("doctor.title"));
    for (const row of rows) {
      const sym = row.level === "ok" ? SYM.ok : row.level === "warn" ? SYM.warn : SYM.err;
      io.out(`  ${sym} ${row.label}: ${row.value}`);
    }
    const errors = rows.filter((r) => r.level === "err").length;
    const warns = rows.filter((r) => r.level === "warn").length;
    io.out(errors + warns === 0 ? t("doctor.ok") : t("doctor.problems", { count: errors + warns }));
  }
  return rows.filter((r) => r.level === "err").length > 0 ? 1 : 0;
}
