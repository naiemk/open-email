import { Button } from "@/components/ui/button";
import type { Mail } from "@/lib/mail";
import { formatMailDate } from "@/lib/mail";

type Props = {
  mail: Mail | undefined;
  folder: "inbox" | "sent" | "trash";
  onTrash: () => void;
};

export function MessageReader({ mail, folder, onTrash }: Props) {
  if (!mail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white text-muted-foreground">
        Select a message
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-xl font-semibold text-foreground">{mail.subject || "(no subject)"}</h2>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">From </span>
            <span className="font-medium">{mail.from}</span>
          </p>
          <p className="text-xs text-muted-foreground">{formatMailDate(mail.time)}</p>
        </div>
        <div className="mt-3 flex gap-2">
          {folder !== "trash" ? (
            <Button variant="outline" className="h-8 text-xs" onClick={onTrash}>
              Move to trash
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{mail.body}</pre>
      </div>
    </div>
  );
}
