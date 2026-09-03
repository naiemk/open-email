import { Lock } from "lucide-react";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  e2ee: boolean;
  className?: string;
};

export function EncryptionLock({ e2ee, className = "h-4 w-4" }: Props) {
  const t = useT();
  const label = e2ee ? t("mail.e2ee") : t("mail.chainEncryption");

  return (
    <Lock
      className={`shrink-0 ${className} ${e2ee ? "fill-primary/15 text-primary" : "text-muted-foreground/70"}`}
      aria-label={label}
      title={label}
    />
  );
}
