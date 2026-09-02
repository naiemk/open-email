import { Forward, Reply, ReplyAll } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

type Props = {
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  className?: string;
};

export function MessageLocalToolbar({ onReply, onReplyAll, onForward, className = "" }: Props) {
  const t = useT();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.reply")} onClick={onReply}>
        <Reply className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.replyAll")} onClick={onReplyAll}>
        <ReplyAll className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" className="h-8 w-8 p-0" title={t("compose.forward")} onClick={onForward}>
        <Forward className="h-4 w-4" />
      </Button>
    </div>
  );
}
