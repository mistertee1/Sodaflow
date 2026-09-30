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
        <div className="bg-[#121218] border border-rose-800/40 rounded-2xl p-6 text-center space-y-3 my-4 shadow-lg">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-rose-400" />
          </div>
          <h3 className="font-bold text-sm text-white">
            {this.props.fallbackTitle || 'حدث تنبيه أثناء عرض هذا المكون'}
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {this.props.fallbackMessage ||
              'تم استعادة حالة المكون بأمان لحماية بياناتك المحاسبية. يمكنك الضغط على إعادة المحاولة.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-2 bg-rose-900/50 hover:bg-rose-800 text-rose-100 rounded-xl text-xs font-bold border border-rose-700 transition-colors inline-flex items-center gap-1.5"
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
