import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div className="min-h-dvh p-6 bg-bg-0 text-ink-0 flex flex-col gap-4">
          <h1 className="text-xl font-medium text-bad">Something went wrong</h1>
          <div className="text-ink-1 text-sm">{e.message || String(e)}</div>
          <pre className="text-xs text-ink-2 whitespace-pre-wrap break-all bg-bg-1 p-3 rounded-xl border border-bg-3">{(e.stack || '').slice(0, 4000)}</pre>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => location.reload()}>Reload</button>
            <button className="btn-secondary" onClick={() => { this.setState({ error: null }); }}>Try again</button>
          </div>
          <div className="text-xs text-ink-3">
            If the problem persists, hard-refresh in Safari (Settings → Safari → Advanced → Website Data → remove this site) and re-open.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
