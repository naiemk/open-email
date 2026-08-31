import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  secret: string;
  busy: boolean;
  onSaved: () => void;
};

export function RecoveryModal({ open, secret, busy, onSaved }: Props) {
  return (
    <Dialog open={open} onClose={() => {}}>
      <DialogContent>
        <CardHeader>
          <CardTitle>Save your recovery secret</CardTitle>
          <CardDescription>
            Lose every device and this secret → the mailbox is gone. Store it offline before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-auto rounded-lg bg-accent p-4 text-xs text-accent-foreground">{secret}</pre>
          <Button className="w-full" disabled={busy} onClick={onSaved}>
            I saved it — opt in to this node
          </Button>
        </CardContent>
      </DialogContent>
    </Dialog>
  );
}
