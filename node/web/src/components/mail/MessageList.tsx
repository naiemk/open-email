import { Input } from "@/components/ui/input";
import type { Mail } from "@/lib/mail";
import { formatMailDate, senderInitial } from "@/lib/mail";

type Props = {
  rows: Mail[];
  selected: number | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (seq: number) => void;
};

export function MessageList({ rows, selected, query, onQuery, onSelect }: Props) {
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
          rows.map((m) => (
            <button
              key={m.seq}
              type="button"
              className={`flex w-full gap-3 border-b border-border px-3 py-3 text-left ${
                selected === m.seq ? "bg-[#ede9fe]" : "hover:bg-white"
              }`}
              onClick={() => onSelect(m.seq)}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {senderInitial(m.from)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${m.unread ? "font-semibold" : ""}`}>
                    {m.from.replace(/^.*<([^>]+)>.*$/, "$1").split("@")[0] || m.from}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatMailDate(m.time)}</span>
                </div>
                <div className={`truncate text-sm ${m.unread ? "font-medium" : "text-foreground/80"}`}>
                  {m.subject || "(no subject)"}
                </div>
                <div className="truncate text-xs text-muted-foreground">{m.body.slice(0, 80)}</div>
              </div>
              {m.unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
