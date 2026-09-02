import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  open: boolean;
  secret: string;
  error?: string;
  busy: boolean;
  onSaved: () => void;
};

export function RecoveryModal({ open, secret, error, busy, onSaved }: Props) {
  const t = useT();
  const lock = useRef(false);
  if (!busy) lock.current = false;

  return (
    <Dialog open={open} onClose={() => {}}>
      <DialogContent>
        <CardHeader>
          <CardTitle>{t("recovery.title")}</CardTitle>
          <CardDescription>{t("recovery.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="max-h-[40vh] overflow-auto rounded-lg bg-accent p-4 text-[11px] text-accent-foreground md:text-xs">{secret}</pre>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => {
              if (busy || lock.current) return;
              lock.current = true;
              onSaved();
            }}
          >
            {busy ? t("common.waitingPasskey") : t("recovery.savedOptIn")}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
