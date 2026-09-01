import {
  Archive,
  ArrowLeft,
  Flame,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  folder: string;
  unread: boolean;
  pending?: boolean;
  onBack: () => void;
  onMarkRead: (read: boolean) => void;
  onTrash: () => void;
  onRestore?: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onMoveInbox: () => void;
  onMore: () => void;
};

export function MobileReaderHeader({
  folder,
  unread,
  pending = false,
  onBack,
  onMarkRead,
  onTrash,
  onRestore,
  onArchive,
  onSpam,
  onMoveInbox,
  onMore,
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white px-2 py-1 md:hidden">
      <Button type="button" variant="ghost" className="h-10 w-10 p-0" aria-label="Back" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-0.5">
        <ToolbarIcon
          disabled={pending}
          title={unread ? "Mark read" : "Mark unread"}
          onClick={() => onMarkRead(unread)}
        >
          {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </ToolbarIcon>
        {folder === "trash" ? (
          <ToolbarIcon disabled={pending} title="Restore" onClick={onRestore}>
            <FolderInput className="h-4 w-4" />
          </ToolbarIcon>
        ) : (
          <ToolbarIcon disabled={pending} title="Move to trash" onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
          </ToolbarIcon>
        )}
        <ToolbarIcon disabled={pending} title="Archive" onClick={onArchive}>
          <Archive className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon disabled={pending} title="Move to spam" onClick={onSpam}>
          <Flame className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon disabled={pending} title="Move to inbox" onClick={onMoveInbox}>
          <FolderInput className="h-4 w-4" />
        </ToolbarIcon>
        <ToolbarIcon disabled={pending} title="More" onClick={onMore}>
          <MoreHorizontal className="h-4 w-4" />
        </ToolbarIcon>
      </div>
    </header>
  );
}

function ToolbarIcon({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button type="button" variant="ghost" className="h-10 w-10 p-0" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </Button>
  );
}
