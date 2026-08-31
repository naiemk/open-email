import { useEffect, useState } from "react";
import type { Meta } from "@/lib/api";
import type { SignupState } from "@/App";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
};

export function PayModal({ open, meta, signup, error, busy, onClose, onPoll, onRegister, onStatus }: Props) {
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!open || !signup || signup.status === "paid") return;
    let alive = true;
    setPolling(true);
    const tick = async () => {
      while (alive && signup.status !== "paid") {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await onPoll();
        onStatus(status);
        if (status === "paid") break;
      }
      if (alive) setPolling(false);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [open, signup?.invoiceId, signup?.status]);

  if (!signup) return null;

  const payUrl = signup.payLink.startsWith("http") ? signup.payLink : `${location.origin}${signup.payLink}`;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <CardHeader>
          <CardTitle>Activate your mailbox</CardTitle>
          <CardDescription>
            One-time payment for on-chain registration and {meta.fakeCheckout ? "testnet" : ""} storage on this node.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="font-semibold">${meta.signupPrice} USDC</p>
            <p className="mt-2 text-muted-foreground">
              Your OE id <strong>{signup.oeId}</strong> is registered on-chain. Mail blobs are encrypted to your DEK;
              this node only stores ciphertext and your opt-in choice.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-sm">
            Status: <strong>{signup.status}</strong>
            {polling ? " (checking…)" : ""}
          </p>
          <Button variant="outline" className="w-full" onClick={() => window.open(payUrl, "_blank", "noopener")}>
            Open invoice in new tab
          </Button>
          {signup.status === "paid" ? (
            <Button className="w-full" disabled={busy} onClick={onRegister}>
              Register on-chain & continue
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {meta.fakeCheckout
                ? "Testnet: open the invoice page and click Mark paid, then we continue automatically."
                : "Pay in the new tab. This modal updates when payment is confirmed."}
            </p>
          )}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
