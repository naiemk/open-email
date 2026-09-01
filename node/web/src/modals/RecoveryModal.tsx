import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  secret: string;
  error?: string;
  busy: boolean;
  onSaved: () => void;
};

export function RecoveryModal({ open, secret, error, busy, onSaved }: Props) {
  const lock = useRef(false);
  if (!busy) lock.current = false;

  return (
    <Dialog open={open} onClose={() => {}}>
      <DialogContent>
        <CardHeader>
          <CardTitle>Save your recovery secret</CardTitle>
          <CardDescription>
            Lose every device and this secret → the mailbox is gone. Store it offline before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-auto rounded-lg bg-accent p-4 text-xs text-accent-foreground">{secret}</pre>
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
            {busy ? "Waiting for passkey…" : "I saved it — opt in to this node"}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
