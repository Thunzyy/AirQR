import { Component, type ErrorInfo, type ReactNode } from 'react';
import Icon from './Icon';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex-1 flex items-center justify-center min-h-[60vh] px-4">
          <div className="airqr-panel max-w-md w-full p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--airqr-danger-surface)]">
              <Icon name="error" className="text-3xl text-[var(--airqr-danger-text)]" />
            </div>

            <h2 className="text-xl font-semibold text-[var(--airqr-text-primary)] mb-2">Something went wrong</h2>
            <p className="text-sm text-[var(--airqr-text-secondary)] mb-6">
              An unexpected error occurred. Try reloading the page.
            </p>

            <button
              onClick={this.handleReload}
              className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-colors"
            >
              <Icon name="refresh" className="text-lg" />
              Reload
            </button>

            <div className="mt-6">
              <button
                onClick={this.toggleDetails}
                className="text-xs text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-secondary)] transition-colors flex items-center gap-1 mx-auto"
              >
                <Icon
                  name={this.state.showDetails ? 'expand_less' : 'expand_more'}
                  className="text-sm"
                />
                {this.state.showDetails ? 'Hide details' : 'Show details'}
              </button>

              {this.state.showDetails && this.state.error && (
                <pre className="mt-3 rounded-lg bg-[var(--airqr-control-surface)] p-3 text-left text-xs text-[var(--airqr-danger-text)] overflow-auto max-h-40">
                  {this.state.error.message}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
