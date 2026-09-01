import { useEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/api";
import type { SignupState } from "@/App";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { passkeyLog } from "@/lib/passkey-log";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  open: boolean;
  meta: Meta;
  signup: SignupState | null;
  error: string;
  busy: boolean;
  onClose: () => void;
  onPoll: () => Promise<string>;
  onRegister: () => void;
  onStatus: (status: string) => void;
  onMarkPaid?: () => Promise<void>;
};

export function PayModal({
  open,
  meta,
  signup,
  error,
  busy,
  onClose,
  onPoll,
  onRegister,
  onStatus,
  onMarkPaid,
}: Props) {
  const t = useT();
  const [polling, setPolling] = useState(false);
  const registerLock = useRef(false);

  useEffect(() => {
    if (!open || !signup || signup.status === "paid") return;
    let alive = true;
    setPolling(true);
    const tick = async () => {
      while (alive && signup.status !== "paid") {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const status = await onPoll();
          onStatus(status);
          if (status === "paid") break;
        } catch {
          /* keep polling */
        }
      }
      if (alive) setPolling(false);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [open, signup?.invoiceId, signup?.status]);

  useEffect(() => {
    if (!busy) registerLock.current = false;
  }, [busy]);

  if (!signup) return null;

  const payUrl = signup.payLink.startsWith("http") ? signup.payLink : `${location.origin}${signup.payLink}`;

  const handleRegister = () => {
    passkeyLog("PayModal:register-click", {
      busy,
      registerLock: registerLock.current,
      status: signup.status,
      credentialId: signup.credentialId.slice(0, 18),
    });
    if (busy || registerLock.current) {
      passkeyLog("PayModal:register-blocked", { busy, registerLock: registerLock.current });
      return;
    }
    registerLock.current = true;
    passkeyLog("PayModal:register-invoke-onRegister");
    onRegister();
  };

  return (
    <Dialog open={open} onClose={busy ? () => undefined : onClose}>
      <DialogContent>
        <CardHeader>
          <CardTitle>{t("pay.activateMailbox")}</CardTitle>
          <CardDescription>
            {t("pay.activateDesc", { testnet: meta.fakeCheckout ? t("pay.testnet") : "" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="font-semibold">{t("pay.priceLine", { price: meta.signupPrice })}</p>
            <p className="mt-2 text-muted-foreground">{t("pay.priceDesc", { oeId: signup.oeId })}</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-sm">
            {t("pay.status")} <strong>{signup.status}</strong>
            {polling ? t("pay.checking") : ""}
            {busy ? t("pay.waitingPasskeyInline") : ""}
          </p>
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => window.open(payUrl, "_blank", "noopener")}
          >
            {t("pay.openInvoice")}
          </Button>
          {signup.status !== "paid" && onMarkPaid ? (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => void onMarkPaid().catch(() => undefined)}
            >
              {t("pay.markPaidTest")}
            </Button>
          ) : null}
          {signup.status === "paid" ? (
            <Button className="w-full" disabled={busy} onClick={handleRegister}>
              {busy ? t("common.waitingPasskey") : t("pay.registerContinue")}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t("pay.payHint")}</p>
          )}
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
