import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

interface Props {
  /** Human name of the region, e.g. "canvas". */
  region: string;
  children: ReactNode;
  className?: string;
}

interface State {
  error: Error | null;
  attempt: number;
}

/** Isolates a render failure to one region of the app. "Reload view" re-mounts the children. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.region}] render failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <EmptyState
          className={`h-full ${this.props.className ?? ''}`}
          icon={<TriangleAlert />}
          title={`The ${this.props.region} hit a problem`}
          description="Your data is safe. Reloading the view usually fixes this."
        >
          <Button variant="primary" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
            Reload view
          </Button>
        </EmptyState>
      );
    }
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
  }
}
