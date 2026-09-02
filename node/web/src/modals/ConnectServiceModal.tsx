import { useState } from "react";
import type { Hex } from "viem";
import { bytesToHex, hexToBytes } from "viem";
import type { Meta } from "@/lib/api";
import type { Session } from "@/App";
import { fetchInviteUsed, fetchNode, linkChallenge } from "@/lib/api";
import { assertWebAuthn, registryName, sealEnvelope } from "@/lib/webauthn";
import { encodeGrant, parseInvite, verifyInvite } from "@client/pair-blob.ts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n, useT } from "@/i18n/I18nProvider";
import { localizeError } from "@/i18n/localize-error";
import QRCode from "qrcode";

const GRANTED_INVITES_KEY = "open-email/granted-invites/v1";

type Props = {
  open: boolean;
  meta: Meta;
  session: Session;
  onClose: () => void;
};

export function ConnectServiceModal({ open, meta, session, onClose }: Props) {
  const t = useT();
  const { messages } = useI18n();
  const [inviteInput, setInviteInput] = useState("");
  const [confirmedDomain, setConfirmedDomain] = useState("");
  const [grantBlob, setGrantBlob] = useState("");
  const [grantQr, setGrantQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"paste" | "confirm" | "grant">("paste");

  const reset = () => {
    setInviteInput("");
    setConfirmedDomain("");
    setGrantBlob("");
    setGrantQr("");
    setError("");
    setStep("paste");
  };

  const verifyAndConfirm = async () => {
    setBusy(true);
    setError("");
    try {
      const invite = parseInvite(inviteInput.trim());
      if (!invite.nodeKey) throw new Error(t("errors.inviteMissingNode"));
      const node = await fetchNode(invite.nodeKey);
      const used = await fetchInviteUsed(invite.inviteId);
      verifyInvite(invite, {
        registryDomain: node.domain,
        inviteUsed: used,
        sessionName: session.name,
      });
      setConfirmedDomain(node.domain);
      setStep("confirm");
    } catch (e) {
      setError(localizeError(messages, e));
    } finally {
      setBusy(false);
    }
  };

  const issueGrant = async () => {
    setBusy(true);
    setError("");
    try {
      const invite = parseInvite(inviteInput.trim());
      const used = await fetchInviteUsed(invite.inviteId);
      if (used) throw new Error(t("errors.inviteUsed"));

      const granted = JSON.parse(sessionStorage.getItem(GRANTED_INVITES_KEY) ?? "[]") as string[];
      if (granted.includes(invite.inviteId)) {
        throw new Error(t("errors.grantAlreadyIssued"));
      }

      const challenge = await linkChallenge(
        invite.name,
        invite.nodeKey,
        invite.qx,
        invite.qy,
        invite.inviteId,
      );
      const auth = await assertWebAuthn(challenge, session.credentialId);
      const sealedDek = bytesToHex(
        await sealEnvelope(hexToBytes(invite.guestPub), invite.name, session.dekPrivate),
      ) as Hex;
      const grant = encodeGrant({
        v: 1,
        inviteId: invite.inviteId,
        name: invite.name,
        nodeKey: invite.nodeKey,
        qx: invite.qx,
        qy: invite.qy,
        sealedDek,
        auth,
      });
      sessionStorage.setItem(GRANTED_INVITES_KEY, JSON.stringify([...granted, invite.inviteId]));
      setGrantBlob(grant);
      setGrantQr(await QRCode.toDataURL(grant, { width: 240, margin: 2 }));
      setStep("grant");
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
          <CardTitle>{t("connectService.title")}</CardTitle>
          <CardDescription>
            {t("connectService.desc", { address: `${session.oeId}@${meta.domain}` })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {step === "paste" ? (
            <>
              <Label htmlFor="invite-blob">{t("connectService.pasteInvite")}</Label>
              <textarea
                id="invite-blob"
                className="h-24 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
              />
              <Button className="w-full" disabled={busy || !inviteInput.trim()} onClick={() => void verifyAndConfirm()}>
                {t("connectService.verifyInvite")}
              </Button>
            </>
          ) : null}
          {step === "confirm" ? (
            <>
              <p className="text-sm">
                {t("connectService.authorizing", {
                  domain: confirmedDomain,
                  name: registryName(session.oeId, meta.domain),
                })}
              </p>
              <p className="text-xs text-muted-foreground">{t("connectService.confirmDomain")}</p>
              <Button className="w-full" disabled={busy} onClick={() => void issueGrant()}>
                {t("connectService.confirmPasskey")}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep("paste")}>
                {t("common.back")}
              </Button>
            </>
          ) : null}
          {step === "grant" ? (
            <>
              {grantQr ? (
                <img src={grantQr} alt={t("connectService.grantQr")} className="mx-auto w-[min(240px,80vw)] rounded-lg" />
              ) : null}
              <textarea
                readOnly
                className="h-32 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={grantBlob}
              />
              <p className="text-sm text-primary">{t("connectService.copyGrant")}</p>
              <Button
                className="w-full"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                {t("common.done")}
              </Button>
            </>
          ) : null}
          {step !== "grant" ? (
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
          ) : null}
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
