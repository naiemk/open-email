import { useEffect, useState } from "react";
import { bytesToHex, hexToBytes } from "viem";
import type { Hex } from "viem";
import QRCode from "qrcode";
import { sealEnvelope } from "@/lib/webauthn";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  name: string;
  credentialId: Hex;
  dekPrivate: Uint8Array;
  onClose: () => void;
};

export function PairQrModal({ open, name, credentialId, dekPrivate, onClose }: Props) {
  const [qr, setQr] = useState("");
  const [sid, setSid] = useState("");
  const [status, setStatus] = useState("");
  const [guestPub, setGuestPub] = useState<Hex | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const res = await fetch("/pair/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, hostCredentialId: credentialId }),
      });
      const body = (await res.json()) as { sid: string; joinUrl: string };
      if (!alive) return;
      setSid(body.sid);
      setQr(await QRCode.toDataURL(body.joinUrl, { width: 280, margin: 2 }));
      const poll = async () => {
        while (alive) {
          const s = (await (await fetch(`/pair/sessions/${encodeURIComponent(body.sid)}`)).json()) as {
            status: string;
            guestPub?: Hex;
          };
          setStatus(s.status);
          if (s.status === "joined" && s.guestPub) {
            setGuestPub(s.guestPub);
            const sealed = bytesToHex(await sealEnvelope(hexToBytes(s.guestPub), name, dekPrivate));
            await fetch(`/pair/sessions/${encodeURIComponent(body.sid)}/grant`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ hostCredentialId: credentialId, sealedDek: sealed }),
            });
            setStatus("granted");
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      };
      void poll();
    })();
    return () => {
      alive = false;
    };
  }, [open, name, credentialId, dekPrivate]);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <CardHeader>
          <CardTitle>Add another device</CardTitle>
          <CardDescription>Scan this QR on the new device (Add device to another account).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {qr ? <img src={qr} alt="Pairing QR" className="mx-auto rounded-lg" /> : <p>Starting session…</p>}
          <p className="text-xs text-muted-foreground">Session {sid.slice(0, 24)}… · {status}</p>
          {status === "granted" ? <p className="text-sm text-primary">DEK sent. Finish on the other device.</p> : null}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
