import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import {
  fetchName,
  optedIn,
  signServiceInvite,
  storeServiceWrap,
  submitLink,
} from "@/lib/api";
import {
  createPasskey,
  generateTransportKeypair,
  isValidOeId,
  openEnvelope,
  registryName,
  wrapDek,
} from "@/lib/webauthn";
import { rememberPasskey } from "@/lib/passkeys-store";
import { parseGrant } from "@client/pair-blob.ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, useT } from "@/i18n/I18nProvider";
import { localizeError } from "@/i18n/localize-error";
import QRCode from "qrcode";

const PAIR_SESSION_KEY = "open-email/service-pair/v1";

type PairSession = {
  oeId: string;
  name: string;
  credentialId: Hex;
  qx: Hex;
  qy: Hex;
  kek: number[];
  transportPriv: number[];
  inviteBlob: string;
};

type Props = {
  open: boolean;
  meta: Meta;
  initialOeId?: string;
  onClose: () => void;
  onDone: (session: Session) => void;
};

export function ServicePairOpenModal({ open, meta, initialOeId = "", onClose, onDone }: Props) {
  const t = useT();
  const { messages } = useI18n();
  const [oeId, setOeId] = useState(initialOeId);
  const [step, setStep] = useState<"id" | "invite" | "grant">("id");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteBlob, setInviteBlob] = useState("");
  const [inviteQr, setInviteQr] = useState("");
  const [grantInput, setGrantInput] = useState("");

  useEffect(() => {
    if (open) setOeId(initialOeId);
  }, [open, initialOeId]);

  const reset = () => {
    setStep("id");
    setError("");
    setInviteBlob("");
    setInviteQr("");
    setGrantInput("");
    sessionStorage.removeItem(PAIR_SESSION_KEY);
  };

  const startOpen = async () => {
    setBusy(true);
    setError("");
    try {
      if (!isValidOeId(oeId.trim())) throw new Error(t("errors.invalidOeId"));
      const name = registryName(oeId.trim(), meta.domain);
      const record = await fetchName(name);
      if (!record.exists) throw new Error(t("errors.noMailbox"));

      const mat = await createPasskey(oeId.trim(), meta.domain);
      rememberPasskey({
        credentialId: mat.credentialId,
        oeId: oeId.trim(),
        label: `${oeId.trim()}@${meta.domain}`,
        lastUsed: Date.now(),
        qx: mat.qx,
        qy: mat.qy,
      });
      const transport = generateTransportKeypair();
      const guestPub = bytesToHex(transport.publicKey) as Hex;
      const signed = await signServiceInvite({
        name,
        qx: mat.qx,
        qy: mat.qy,
        guestPub,
      });
      const blob = signed.blob;
      setInviteBlob(blob);
      setInviteQr(await QRCode.toDataURL(blob, { width: 240, margin: 2 }));
      const session: PairSession = {
        oeId: oeId.trim(),
        name,
        credentialId: mat.credentialId,
        qx: mat.qx,
        qy: mat.qy,
        kek: [...mat.kek],
        transportPriv: [...transport.privateKey],
        inviteBlob: blob,
      };
      sessionStorage.setItem(PAIR_SESSION_KEY, JSON.stringify(session));
      setStep("invite");
    } catch (e) {
      setError(localizeError(messages, e));
    } finally {
      setBusy(false);
    }
  };

  const acceptGrant = async () => {
    setBusy(true);
    setError("");
    try {
      const raw = sessionStorage.getItem(PAIR_SESSION_KEY);
      if (!raw) throw new Error(t("errors.pairingExpired"));
      const pending = JSON.parse(raw) as PairSession;
      const grant = parseGrant(grantInput.trim());
      if (grant.name !== pending.name) throw new Error(t("errors.grantNameMismatch"));
      if (grant.qx.toLowerCase() !== pending.qx.toLowerCase()) throw new Error(t("errors.grantPasskeyMismatch"));
      if (grant.qy.toLowerCase() !== pending.qy.toLowerCase()) throw new Error(t("errors.grantPasskeyMismatch"));

      await submitLink({
        name: grant.name,
        nodeKey: grant.nodeKey,
        newQx: grant.qx,
        newQy: grant.qy,
        inviteId: grant.inviteId,
        auth: grant.auth,
      });

      const dekPrivate = await openEnvelope(
        new Uint8Array(pending.transportPriv),
        grant.name,
        hexToBytes(grant.sealedDek),
      );
      const kek = new Uint8Array(pending.kek);
      const wrappedDek = bytesToHex(wrapDek(dekPrivate, kek)) as Hex;
      await storeServiceWrap({
        name: grant.name,
        credentialId: pending.credentialId,
        wrappedDek,
      });
      sessionStorage.removeItem(PAIR_SESSION_KEY);
      onDone({
        name: grant.name,
        oeId: pending.oeId,
        credentialId: pending.credentialId,
        dekPrivate,
        optedIn: await optedIn(grant.name, meta.nodeKey),
      });
    } catch (e) {
      setError(localizeError(messages, e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <DialogContent>
        <CardHeader>
          <CardTitle>{t("servicePair.openExisting")}</CardTitle>
          <CardDescription>{t("servicePair.openExistingDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {step === "id" ? (
            <>
              <div>
                <Label htmlFor="open-oe-id">{t("servicePair.yourOeId")}</Label>
                <Input
                  id="open-oe-id"
                  value={oeId}
                  onChange={(e) => setOeId(e.target.value)}
                  placeholder={t("landing.oeIdPlaceholder")}
                  className="mt-1"
                />
              </div>
              <Button className="w-full" disabled={busy || !oeId.trim()} onClick={() => void startOpen()}>
                {t("common.continue")}
              </Button>
            </>
          ) : null}
          {step === "invite" ? (
            <>
              {inviteQr ? (
                <img src={inviteQr} alt={t("servicePair.inviteQr")} className="mx-auto w-[min(240px,80vw)] rounded-lg" />
              ) : null}
              <textarea
                readOnly
                className="h-24 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={inviteBlob}
              />
              <p className="text-sm text-muted-foreground">{t("servicePair.inviteInstructions")}</p>
              <Button variant="outline" className="w-full" onClick={() => setStep("grant")}>
                {t("servicePair.haveGrant")}
              </Button>
            </>
          ) : null}
          {step === "grant" ? (
            <>
              <Label htmlFor="grant-blob">{t("servicePair.pasteGrant")}</Label>
              <textarea
                id="grant-blob"
                className="h-24 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={grantInput}
                onChange={(e) => setGrantInput(e.target.value)}
              />
              <Button className="w-full" disabled={busy || !grantInput.trim()} onClick={() => void acceptGrant()}>
                {t("servicePair.finishPairing")}
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("common.cancel")}
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
