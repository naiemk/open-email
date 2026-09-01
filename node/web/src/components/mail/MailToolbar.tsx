import {
  Archive,
  Clock,
  Flame,
  FolderInput,
  Mail,
  MailOpen,
  Tag,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  allSelected: boolean;
  someSelected: boolean;
  pending?: boolean;
  onSelectAll: (checked: boolean) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onTrash: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onMoveInbox: () => void;
  onLabels: () => void;
  onSnooze: (until: number) => void;
};

export function MailToolbar({
  allSelected,
  someSelected,
  pending = false,
  onSelectAll,
  onMarkRead,
  onMarkUnread,
  onTrash,
  onArchive,
  onSpam,
  onMoveInbox,
  onLabels,
  onSnooze,
}: Props) {
  const snoozePresets = [
    { label: "1 hour", until: () => Math.floor(Date.now() / 1000) + 3600 },
    {
      label: "Tonight",
      until: () => {
        const d = new Date();
        d.setHours(20, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return Math.floor(d.getTime() / 1000);
      },
    },
    {
      label: "Tomorrow",
      until: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        return Math.floor(d.getTime() / 1000);
      },
    },
  ];

  return (
    <div className="hidden items-center gap-1 border-b border-border bg-white px-3 py-2 md:flex">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected && !allSelected;
        }}
        disabled={pending}
        onChange={(e) => onSelectAll(e.target.checked)}
        aria-label="Select all"
      />
      <ToolbarIcon disabled={pending || !someSelected} title="Mark read" onClick={onMarkRead}>
        <MailOpen className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Mark unread" onClick={onMarkUnread}>
        <Mail className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Move to trash" onClick={onTrash}>
        <Trash2 className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Archive" onClick={onArchive}>
        <Archive className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Move to spam" onClick={onSpam}>
        <Flame className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Move to inbox" onClick={onMoveInbox}>
        <FolderInput className="h-4 w-4" />
      </ToolbarIcon>
      <ToolbarIcon disabled={pending || !someSelected} title="Labels" onClick={onLabels}>
        <Tag className="h-4 w-4" />
      </ToolbarIcon>
      <div className="group relative">
        <ToolbarIcon disabled={pending || !someSelected} title="Snooze">
          <Clock className="h-4 w-4" />
        </ToolbarIcon>
        <div className="absolute left-0 top-full z-20 hidden min-w-[140px] rounded-md border border-border bg-white py-1 shadow-lg group-hover:block group-focus-within:block">
          {snoozePresets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              disabled={pending || !someSelected}
              onClick={() => onSnooze(p.until())}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolbarIcon({
  children,
  title,
  disabled,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button type="button" variant="ghost" className="h-8 w-8 p-0" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </Button>
  );
}
