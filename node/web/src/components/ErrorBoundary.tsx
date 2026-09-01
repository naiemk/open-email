import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; onReset: () => void };
type State = { error: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">{this.state.error}</p>
          <Button
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Sign out and retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
