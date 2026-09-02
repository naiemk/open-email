import { Menu, Search } from "lucide-react";
import type { Folder } from "@/components/mail/SidebarNav";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

const FOLDER_KEYS: Record<Folder, MessageKey> = {
  inbox: "folder.inbox",
  sent: "folder.sent",
  starred: "folder.starred",
  archive: "folder.archive",
  spam: "folder.spam",
  trash: "folder.trash",
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
  const t = useT();

  return (
    <header className="flex items-center justify-between border-b border-border bg-white px-3 py-2 md:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
          aria-label={t("aria.openMenu")}
          onClick={onMenuOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-lg font-semibold text-foreground">{t(FOLDER_KEYS[folder])}</h1>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted ${searchOpen ? "bg-muted" : ""}`}
          aria-label={t("aria.search")}
          onClick={onSearchToggle}
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
          aria-label={t("aria.settings")}
          onClick={onSettings}
        >
          {avatarInitial}
        </button>
      </div>
    </header>
  );
}
