import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Stethoscope, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface DoctorChecks {
  readonly runtime: "electron" | "node";
  readonly inkosJson: boolean;
  // `null` means "not applicable in this runtime" (e.g. .env files in Electron
  // mode where LLM config lives in `root/.inkos/secrets.json`).
  readonly projectEnv: boolean | null;
  readonly globalEnv: boolean | null;
  readonly secretsFile: boolean | null;
  readonly booksDir: boolean;
  readonly llmConnected: boolean;
  readonly bookCount: number;
}

interface Nav { toDashboard: () => void }

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
      {ok ? (
        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
      ) : (
        <XCircle size={18} className="text-destructive shrink-0" />
      )}
      <span className="text-sm font-medium flex-1">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}

// `null` fields = "not applicable in this runtime" — don't render the row at all.
function OptionalCheckRow({ label, value, detail }: { label: string; value: boolean | null; detail?: string }) {
  if (value === null) return null;
  return <CheckRow label={label} ok={value} detail={detail} />;
}

export function DoctorView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<DoctorChecks>("/doctor");

  // Runtime-aware "all passed" gate:
  //   - Node mode: needs at least one .env (project OR global) — legacy config path
  //   - Electron mode: needs `root/.inkos/secrets.json` — LLM key comes from
  //     Electron safeStorage, .env files are not used
  const configReachable = data
    ? (data.runtime === "electron"
        ? data.secretsFile === true
        : data.projectEnv === true || data.globalEnv === true)
    : false;
  const allPassed = data
    ? data.inkosJson && configReachable && data.llmConnected
    : false;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.doctor")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Stethoscope size={28} className="text-primary" />
          {t("doctor.title")}
        </h1>
        <button onClick={() => refetch()} className={`px-4 py-2 text-sm rounded-lg ${c.btnSecondary}`}>
          {t("doctor.recheck")}
        </button>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <CheckRow label={t("doctor.inkosJson")} ok={data.inkosJson} />
          <OptionalCheckRow label={t("doctor.projectEnv")} value={data.projectEnv} />
          <OptionalCheckRow label={t("doctor.globalEnv")} value={data.globalEnv} />
          <OptionalCheckRow label={t("doctor.secretsFile")} value={data.secretsFile} />
          <CheckRow label={t("doctor.booksDir")} ok={data.booksDir} detail={`${data.bookCount} book(s)`} />
          <CheckRow label={t("doctor.llmApi")} ok={data.llmConnected} detail={data.llmConnected ? t("doctor.connected") : t("doctor.failed")} />
        </div>
      )}

      {data && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          allPassed
            ? "bg-emerald-500/10 text-emerald-600"
            : "bg-amber-500/10 text-amber-600"
        }`}>
          {allPassed
            ? t("doctor.allPassed")
            : t("doctor.someFailed")
          }
        </div>
      )}
    </div>
  );
}
