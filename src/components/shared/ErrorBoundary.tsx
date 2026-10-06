import * as React from 'react';
import { Button } from '@/components/ui/primitives';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Hook a real error reporter in here in Phase 2.
    // eslint-disable-next-line no-console
    console.error('Scriptora runtime error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">!</div>
          <h1 className="text-lg font-semibold text-foreground">Something went wrong on this screen</h1>
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-6 flex gap-2">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="outline" onClick={() => window.location.assign('/dashboard')}>
              Back to dashboard
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
