import { useEffect, useRef, useState } from "react";
import { bytesToHex, hexToBytes } from "viem";
import type { Hex } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { optedIn } from "@/lib/api";
import { connectPasskey, createPasskey, generateTransportKeypair, openEnvelope, wrapDek } from "@/lib/webauthn";
import { rememberPasskey } from "@/lib/passkeys-store";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, useT } from "@/i18n/I18nProvider";
import { localizeError } from "@/i18n/localize-error";

type Props = {
  open: boolean;
  meta: Meta;
  onClose: () => void;
  onDone: (session: Session) => void;
};

export function PairScanModal({ open, meta, onClose, onDone }: Props) {
  const t = useT();
  const { messages } = useI18n();
  const [sid, setSid] = useState(() => new URLSearchParams(location.search).get("pair") ?? "");
  const [step, setStep] = useState<"scan" | "passkey" | "wait">("scan");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const transport = useRef<{ publicKey: Uint8Array; privateKey: Uint8Array } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open || step !== "scan") return;
    const params = new URLSearchParams(location.search);
    const q = params.get("pair");
    if (q) setSid(q);
  }, [open, step]);

  useEffect(() => {
    if (!open || step !== "scan" || sid) return;
    let alive = true;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!alive) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if ("BarcodeDetector" in window) {
          const detector = new (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ["qr_code"] });
          const loop = async () => {
            while (alive && videoRef.current && !sid) {
              const codes = await detector.detect(videoRef.current);
              const raw = codes[0]?.rawValue;
              if (raw) {
                const u = new URL(raw.includes("://") ? raw : `${location.origin}${raw.startsWith("/") ? raw : `/?pair=${raw}`}`);
                const p = u.searchParams.get("pair");
                if (p) setSid(p);
              }
              await new Promise((r) => setTimeout(r, 500));
            }
          };
          void loop();
        }
      } catch {
        /* camera optional */
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, [open, step, sid]);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      transport.current = generateTransportKeypair();
      const guestPub = bytesToHex(transport.current.publicKey) as Hex;
      const res = await fetch(`/pair/sessions/${encodeURIComponent(sid)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guestPub }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? t("errors.joinFailed"));
      setStep("passkey");
    } catch (e) {
      setError(localizeError(messages, e));
    } finally {
      setBusy(false);
    }
  };

  const finishPair = async (useCreate: boolean) => {
    setBusy(true);
    setError("");
    try {
      const sessionRes = await fetch(`/pair/sessions/${encodeURIComponent(sid)}`);
      const session = (await sessionRes.json()) as { name: string; status: string; sealedDek?: Hex };
      if (!sessionRes.ok) throw new Error(t("errors.unknownSession"));

      let credentialId: Hex;
      let kek: Uint8Array;
      if (useCreate) {
        const oeId = session.name.replace(/\.testnet$/, "");
        const mat = await createPasskey(oeId, meta.domain);
        credentialId = mat.credentialId;
        kek = mat.kek;
        rememberPasskey({ credentialId, oeId, label: `${oeId}@${meta.domain}`, lastUsed: Date.now() });
      } else {
        const c = await connectPasskey();
        credentialId = c.credentialId;
        kek = c.kek;
      }

      setStep("wait");
      let sealed = session.sealedDek;
      while (!sealed) {
        await new Promise((r) => setTimeout(r, 1000));
        const polled = (await (await fetch(`/pair/sessions/${encodeURIComponent(sid)}`)).json()) as {
          sealedDek?: Hex;
        };
        sealed = polled.sealedDek;
      }

      const transportKey = transport.current!;
      const dekPrivate = await openEnvelope(transportKey.privateKey, session.name, hexToBytes(sealed));
      const wrappedDek = bytesToHex(wrapDek(dekPrivate, kek)) as Hex;
      const fin = await fetch(`/pair/sessions/${encodeURIComponent(sid)}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId, wrappedDek }),
      });
      if (!fin.ok) throw new Error(t("errors.finishFailed"));

      const oeId = session.name.replace(/\.testnet$/, "");
      onDone({
        name: session.name,
        oeId,
        credentialId,
        dekPrivate,
        optedIn: await optedIn(session.name, meta.nodeKey),
      });
    } catch (e) {
      setError(localizeError(messages, e));
      setStep("passkey");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <CardHeader>
          <CardTitle>{t("pair.addThisDevice")}</CardTitle>
          <CardDescription>{t("pair.addThisDeviceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {step === "scan" ? (
            <>
              <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" muted playsInline />
              <Input value={sid} onChange={(e) => setSid(e.target.value)} placeholder={t("pair.sessionPlaceholder")} />
              <Button className="w-full" disabled={!sid || busy} onClick={() => void join()}>
                {t("common.continue")}
              </Button>
            </>
          ) : null}
          {step === "passkey" ? (
            <>
              <p className="text-sm text-muted-foreground">{t("pair.waitingOther")}</p>
              <Button className="w-full" disabled={busy} onClick={() => void finishPair(true)}>
                {t("pair.createPasskey")}
              </Button>
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => void finishPair(false)}>
                {t("pair.connectPasskey")}
              </Button>
            </>
          ) : null}
          {step === "wait" ? <p className="text-sm">{t("pair.finishing")}</p> : null}
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
