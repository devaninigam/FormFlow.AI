import React from 'react';
import ReactDOM from 'react-dom/client';
import DocumentConverter from './DocumentConverter';
import './index.css';

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('GlobalErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0a0e17',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Segoe UI, sans-serif'
        }}>
          <div style={{
            maxWidth: '620px',
            background: '#131b2c',
            border: '1px solid #ef4444',
            borderRadius: '12px',
            padding: '28px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            textAlign: 'center'
          }}>
            <h2 style={{ color: '#ef4444', marginBottom: '12px', fontSize: '1.2rem' }}>⚠️ Interface Error Recovered</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '18px', lineHeight: 1.5 }}>
              {this.state.error?.message || 'An error occurred during document rendering.'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 22px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              🔄 Refresh Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <DocumentConverter />
    </GlobalErrorBoundary>
  </React.StrictMode>
);

