import { Paperclip } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Mail } from "@/lib/mail";
import { formatMailWeekday, isUnread, senderInitial } from "@/lib/mail";

type Props = {
  rows: Mail[];
  selected: number | null;
  selectedSeqs: Set<number>;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (seq: number) => void;
  onToggleSelect: (seq: number, checked: boolean) => void;
};

export function MessageList({ rows, selected, selectedSeqs, query, onQuery, onSelect, onToggleSelect }: Props) {
  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-[#faf9fc]">
      <div className="border-b border-border p-3">
        <Input
          placeholder="Search messages"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="rounded-full border-border bg-white"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No messages</p>
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
                  className="mt-3 h-4 w-4 shrink-0 rounded border-border"
                  checked={selectedSeqs.has(m.seq)}
                  onChange={(e) => onToggleSelect(m.seq, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select message ${m.seq}`}
                />
                <button type="button" className="flex min-w-0 flex-1 gap-3 text-left" onClick={() => onSelect(m.seq)}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {senderInitial(m.from)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? "font-semibold" : ""}`}>
                        {m.from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] || m.from}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {m.attachments.length > 0 ? <Paperclip className="h-3 w-3" /> : null}
                        {formatMailWeekday(m.time)}
                      </span>
                    </div>
                    <div className={`truncate text-sm ${unread ? "font-medium" : "text-foreground/80"}`}>
                      {m.subject || "(no subject)"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{m.body.slice(0, 80)}</div>
                  </div>
                  {unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
