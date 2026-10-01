import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReload = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="bg-sf-raised border border-sf-danger/40 rounded-xl p-6 text-center space-y-3 my-4 shadow-lg">
          <div className="w-12 h-12 rounded-xl bg-sf-danger-bg/10 border border-sf-danger/30 text-sf-danger flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-sf-danger" />
          </div>
          <h3 className="font-semibold text-sm text-sf-text">
            {this.props.fallbackTitle || 'حدث تنبيه أثناء عرض هذا المكون'}
          </h3>
          <p className="text-xs text-sf-muted max-w-md mx-auto">
            {this.props.fallbackMessage ||
              'تم استعادة حالة المكون بأمان لحماية بياناتك المحاسبية. يمكنك الضغط على إعادة المحاولة.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-2 bg-sf-danger-bg/50 hover:bg-sf-danger-bg text-sf-danger rounded-xl text-xs font-semibold border border-sf-danger transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
