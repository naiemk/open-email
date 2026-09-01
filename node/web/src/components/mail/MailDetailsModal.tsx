import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Mail } from "@/lib/mail";
import { formatMailDate } from "@/lib/mail";

type Props = {
  open: boolean;
  mail: Mail | null;
  onClose: () => void;
};

export function MailDetailsModal({ open, mail, onClose }: Props) {
  if (!open || !mail) return null;
  return (
    <Modal title="Message details" onClose={onClose}>
      <dl className="space-y-2 text-sm">
        <Row label="From" value={mail.from} />
        <Row label="To" value={mail.to || "—"} />
        <Row label="Subject" value={mail.subject || "(no subject)"} />
        <Row label="Date" value={formatMailDate(mail.time)} />
        <Row label="Direction" value={mail.direction} />
        <Row label="Sequence" value={String(mail.seq)} />
        <Row label="Attachments" value={String(mail.attachments.length)} />
        <Row label="Labels" value={mail.labels.join(", ") || "—"} />
      </dl>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-medium">{value}</dd>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <Button type="button" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>×</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MailHeadersModal({ open, rawRfc822, onClose }: { open: boolean; rawRfc822: string; onClose: () => void }) {
  if (!open) return null;
  const split = rawRfc822.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const i = rawRfc822.indexOf(split);
  const headers = i === -1 ? rawRfc822 : rawRfc822.slice(0, i);
  return (
    <Modal title="Message headers" onClose={onClose}>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{headers}</pre>
    </Modal>
  );
}
