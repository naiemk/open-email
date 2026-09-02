import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

type Props = { children: ReactNode; onReset: () => void };

type State = { error: string | null };

class ErrorBoundaryInner extends Component<Props & { t: ReturnType<typeof useT> }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    const { t } = this.props;
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">{t("errorBoundary.title")}</h1>
          <p className="max-w-md text-sm text-muted-foreground">{this.state.error}</p>
          <Button
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            {t("errorBoundary.retry")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary(props: Props) {
  const t = useT();
  return <ErrorBoundaryInner {...props} t={t} />;
}
