import { Menu, Search } from "lucide-react";
import type { Folder } from "@/components/mail/SidebarNav";

const FOLDER_LABELS: Record<Folder, string> = {
  inbox: "Inbox",
  sent: "Sent",
  starred: "Starred",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

type Props = {
  folder: Folder;
  searchOpen: boolean;
  onMenuOpen: () => void;
  onSearchToggle: () => void;
  onSettings: () => void;
  avatarInitial: string;
};

export function MobileMailHeader({
  folder,
  searchOpen,
  onMenuOpen,
  onSearchToggle,
  onSettings,
  avatarInitial,
}: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white px-3 py-2 md:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
          aria-label="Open menu"
          onClick={onMenuOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-lg font-semibold text-foreground">{FOLDER_LABELS[folder]}</h1>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted ${searchOpen ? "bg-muted" : ""}`}
          aria-label="Search"
          onClick={onSearchToggle}
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
          aria-label="Settings"
          onClick={onSettings}
        >
          {avatarInitial}
        </button>
      </div>
    </header>
  );
}
