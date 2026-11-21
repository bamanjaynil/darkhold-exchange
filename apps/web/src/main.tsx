import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('[DARKHOLD_ROOT_ERROR]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0b0e14', color: '#f8fafc', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ background: '#121824', border: '1px solid #ef4444', borderRadius: 8, padding: 32, maxWidth: 520, textAlign: 'center' }}>
            <h2 style={{ color: '#f59e0b', margin: 0, fontSize: 20 }}>⚡ THE DARKHOLD EXCHANGE</h2>
            <div style={{ color: '#ef4444', fontWeight: 600, marginTop: 12, fontSize: 15 }}>Terminal Rendering Exception Intercepted</div>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{ marginTop: 20, background: '#2563eb', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Reload Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);