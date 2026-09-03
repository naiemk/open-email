import { Paperclip, Star } from "lucide-react";
import { EncryptionLock } from "@/components/mail/EncryptionLock";
import { Input } from "@/components/ui/input";
import type { Mail } from "@/lib/mail";
import { formatMailWeekday, isUnread, senderInitial } from "@/lib/mail";
import { useI18n, useT } from "@/i18n/I18nProvider";

type Props = {
  rows: Mail[];
  selected: number | null;
  selectedSeqs: Set<number>;
  query: string;
  searchOpen?: boolean;
  onQuery: (q: string) => void;
  onSelect: (seq: number) => void;
  onToggleSelect: (seq: number, checked: boolean) => void;
  onStar?: (seq: number, starred: boolean) => void;
};

export function MessageList({
  rows,
  selected,
  selectedSeqs,
  query,
  searchOpen = true,
  onQuery,
  onSelect,
  onToggleSelect,
  onStar,
}: Props) {
  const t = useT();
  const { intlLocale } = useI18n();

  return (
    <div className="flex h-full w-full shrink-0 flex-col border-e border-border bg-[#faf9fc] md:w-[280px] lg:w-[320px]">
      <div className={`border-b border-border p-3 ${searchOpen ? "" : "hidden md:block"}`}>
        <Input
          placeholder={t("mail.searchMessages")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="rounded-full border-border bg-white"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("mail.noMessages")}</p>
        ) : (
          rows.map((m) => {
            const unread = isUnread(m);
            return (
              <div
                key={m.seq}
                className={`flex w-full gap-2 border-b border-border px-2 py-3 ${
                  selected === m.seq ? "bg-[#ede9fe]" : "hover:bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-3 hidden h-4 w-4 shrink-0 rounded border-border md:block"
                  checked={selectedSeqs.has(m.seq)}
                  onChange={(e) => onToggleSelect(m.seq, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("labels.selectMessage", { seq: m.seq })}
                />
                <button type="button" className="flex min-w-0 flex-1 gap-3 text-start" onClick={() => onSelect(m.seq)}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {senderInitial(m.from)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-semibold" : ""}`}>
                        {m.from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] || m.from}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <EncryptionLock e2ee={Boolean(m.openPgpEncrypted)} className="h-3 w-3" />
                          {m.attachments.length > 0 ? <Paperclip className="h-3 w-3" /> : null}
                          {formatMailWeekday(m.time, intlLocale)}
                        </span>
                        {onStar ? (
                          <button
                            type="button"
                            className="md:hidden"
                            aria-label={m.starred ? t("toolbar.unstar") : t("toolbar.star")}
                            onClick={(e) => {
                              e.stopPropagation();
                              onStar(m.seq, !m.starred);
                            }}
                          >
                            <Star className={`h-4 w-4 ${m.starred ? "fill-amber-400 text-amber-400" : ""}`} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    <div className={`truncate text-sm ${unread ? "font-medium" : "text-foreground/80"}`}>
                      {m.subject || t("mail.noSubject")}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.body.slice(0, 80)}</div>
                  </div>
                  {unread ? <span className="mt-2 hidden h-2 w-2 shrink-0 rounded-full bg-primary md:block" /> : null}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
