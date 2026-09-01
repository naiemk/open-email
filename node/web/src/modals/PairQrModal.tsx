import { useEffect, useState } from "react";
import { bytesToHex, hexToBytes } from "viem";
import type { Hex } from "viem";
import QRCode from "qrcode";
import { sealEnvelope } from "@/lib/webauthn";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  open: boolean;
  name: string;
  credentialId: Hex;
  dekPrivate: Uint8Array;
  onClose: () => void;
};

export function PairQrModal({ open, name, credentialId, dekPrivate, onClose }: Props) {
  const t = useT();
  const [qr, setQr] = useState("");
  const [sid, setSid] = useState("");
  const [status, setStatus] = useState("");

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
          <CardTitle>{t("pair.addDevice")}</CardTitle>
          <CardDescription>{t("pair.addDeviceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {qr ? (
            <img src={qr} alt={t("pair.pairingQr")} className="mx-auto w-[min(280px,80vw)] rounded-lg" />
          ) : (
            <p>{t("pair.startingSession")}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("pair.sessionStatus", { sid: sid.slice(0, 24), status })}
          </p>
          {status === "granted" ? <p className="text-sm text-primary">{t("pair.dekSent")}</p> : null}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t("common.close")}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
