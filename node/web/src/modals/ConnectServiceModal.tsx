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
import QRCode from "qrcode";

const GRANTED_INVITES_KEY = "open-email/granted-invites/v1";

type Props = {
  open: boolean;
  meta: Meta;
  session: Session;
  onClose: () => void;
};

export function ConnectServiceModal({ open, meta, session, onClose }: Props) {
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
      if (!invite.nodeKey) throw new Error("Invite is missing node identity");
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
      setError(e instanceof Error ? e.message : String(e));
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
      if (used) throw new Error("Invite already used");

      const granted = JSON.parse(sessionStorage.getItem(GRANTED_INVITES_KEY) ?? "[]") as string[];
      if (granted.includes(invite.inviteId)) {
        throw new Error("You already issued a grant for this invite in this browser");
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
      setError(e instanceof Error ? e.message : String(e));
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
          <CardTitle>Connect to another open-email service</CardTitle>
          <CardDescription>
            Paste the invite from {session.oeId}@{meta.domain}&apos;s new node. You will get a grant to paste back there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {step === "paste" ? (
            <>
              <Label htmlFor="invite-blob">Paste invite from the other service</Label>
              <textarea
                id="invite-blob"
                className="h-24 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
              />
              <Button className="w-full" disabled={busy || !inviteInput.trim()} onClick={() => void verifyAndConfirm()}>
                Verify invite
              </Button>
            </>
          ) : null}
          {step === "confirm" ? (
            <>
              <p className="text-sm">
                You are authorizing <strong>{confirmedDomain}</strong> to receive mail for{" "}
                <strong>{registryName(session.oeId, meta.domain)}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">Confirm this is the domain shown on the registry.</p>
              <Button className="w-full" disabled={busy} onClick={() => void issueGrant()}>
                Confirm with passkey
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep("paste")}>
                Back
              </Button>
            </>
          ) : null}
          {step === "grant" ? (
            <>
              {grantQr ? (
                <img src={grantQr} alt="Grant QR" className="mx-auto w-[min(240px,80vw)] rounded-lg" />
              ) : null}
              <textarea
                readOnly
                className="h-32 w-full rounded-md border border-border p-2 font-mono text-xs"
                value={grantBlob}
              />
              <p className="text-sm text-primary">Copy this grant back to the other service.</p>
              <Button className="w-full" onClick={() => { reset(); onClose(); }}>
                Done
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
              Cancel
            </Button>
          ) : null}
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
