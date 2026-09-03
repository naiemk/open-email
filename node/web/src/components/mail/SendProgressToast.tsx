import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useT } from "@/i18n/I18nProvider";

export type SendProgress = "sending" | "success" | "error" | null;

type Props = {
  status: SendProgress;
  errorMessage?: string;
};

export function SendProgressToast({ status, errorMessage }: Props) {
  const t = useT();
  if (!status) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 md:pb-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-md items-center gap-2 rounded-lg bg-[#1b1330] px-4 py-3 text-sm text-white shadow-lg">
        {status === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {t("compose.sending")}
          </>
        ) : status === "success" ? (
          <>
            <Check className="h-4 w-4 shrink-0 text-emerald-400" />
            {t("compose.sendSuccess")}
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span className="truncate">{errorMessage || t("errors.sendFailed")}</span>
          </>
        )}
      </div>
    </div>
  );
}
