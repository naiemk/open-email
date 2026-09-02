import { useState } from "react";
import type { Meta } from "@/lib/api";
import type { StoredPasskey } from "@/lib/passkeys-store";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  meta: Meta;
  error: string;
  busy: boolean;
  passkeys: StoredPasskey[];
  turnstileSlot: React.ReactNode;
  onSignUp: (oeId: string) => void;
  onConnect: () => void;
  onConnectStored: (credentialId: string, oeId: string) => void;
  onAddDevice: () => void;
  onOpenExisting: (oeId: string) => void;
  onDemoSignIn?: () => void;
};

export function LandingPage({
  meta,
  error,
  busy,
  passkeys,
  turnstileSlot,
  onSignUp,
  onConnect,
  onConnectStored,
  onAddDevice,
  onOpenExisting,
  onDemoSignIn,
}: Props) {
  const t = useT();
  const [oeId, setOeId] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const preview = `${oeId.trim() || t("common.previewYou")}@${meta.domain}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f4f1fb] to-[#ebe6f5]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-6 md:py-6">
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <div className="text-lg font-bold text-accent">{meta.domain}</div>
        </div>
        <LanguagePicker />
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 pb-16 md:grid-cols-[1.1fr_0.9fr] md:px-6">
        <section>
          <h1 className="text-2xl font-bold leading-tight text-accent sm:text-3xl md:text-4xl">
            {t("landing.headline")}
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">{t("landing.subhead")}</p>
        </section>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("landing.createMailbox")}</CardTitle>
              <CardDescription>{t("landing.createMailboxDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div>
                <Label htmlFor="oe-id">{t("landing.oeId")}</Label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="oe-id"
                    value={oeId}
                    onChange={(e) => setOeId(e.target.value)}
                    placeholder={t("landing.oeIdPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-h-11"
                  />
                  <span className="whitespace-nowrap text-sm font-semibold text-primary sm:shrink-0">@{meta.domain}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preview}</p>
              </div>
              {turnstileSlot}
              <Button className="min-h-11 w-full" disabled={busy || !oeId.trim()} onClick={() => onSignUp(oeId.trim())}>
                {t("landing.signUpPasskey")}
              </Button>
              <Button
                variant="secondary"
                className="min-h-11 w-full"
                disabled={busy || !oeId.trim()}
                onClick={() => onOpenExisting(oeId.trim())}
              >
                {t("landing.openExisting")}
              </Button>
              {passkeys.length === 0 ? null : (
                <p className="text-center text-xs text-muted-foreground">{t("landing.orUsePasskey")}</p>
              )}
              <div className="space-y-2">
                {passkeys.map((p) => (
                  <button
                    key={p.credentialId}
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-start text-sm hover:bg-muted"
                    onClick={() => onConnectStored(p.credentialId, p.oeId)}
                  >
                    <span>{p.label}</span>
                    <span className="text-xs text-muted-foreground">{t("common.connect")}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {onDemoSignIn ? (
                  <Button variant="secondary" disabled={busy} onClick={onDemoSignIn}>
                    {t("landing.demoSignIn")}
                  </Button>
                ) : null}
                <Button variant="outline" disabled={busy} onClick={() => setSignInOpen(true)}>
                  {t("landing.signInPasskey")}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={onAddDevice}>
                  {t("landing.addDeviceOther")}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">{t("landing.onlyMailboxWith")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{t("landing.featureOnChain")}</p>
              <p>{t("landing.featurePasskey")}</p>
              <p>{t("landing.featureSealed")}</p>
              <p>{t("landing.featureOptIn")}</p>
            </CardContent>
          </Card>
        </div>
      </main>
      {signInOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader>
              <CardTitle>{t("landing.signIn")}</CardTitle>
              <CardDescription>{t("landing.signInDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setSignInOpen(false);
                  onConnect();
                }}
              >
                {t("landing.connectOurPasskey")}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setSignInOpen(false)}>
                {t("common.cancel")}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
