import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, RefreshCw, ShieldCheck, Cpu, CheckCircle2, XCircle,
  Sparkles, Lock, Clock, Server, Activity
} from 'lucide-react';

const API_BASE = '/api/document-convert';

const PROVIDER_ORDER = ['aws', 'azure', 'gemini', 'openai', 'builtin'];

const PROVIDER_DESCRIPTIONS = {
  aws: 'Extracts printed text, handwriting, form key-value pairs, tables, and checkbox selection marks via Amazon Textract.',
  azure: 'Extracts layout structure, tables, and handwriting via Azure AI Document Intelligence.',
  gemini: 'Multimodal vision extraction for unconstrained documents and complex handwriting via Google Gemini.',
  openai: 'Vision-language extraction for arbitrary layouts via OpenAI GPT-4o.',
  builtin: 'Offline fallback running locally with Sharp, Tesseract.js, and computer-vision checkbox probing (zero cloud cost).'
};

export default function ConfigPage({ onNavigate }) {
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatusData(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err.message || 'Failed to fetch OCR configuration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const goHome = (e) => {
    if (e) e.preventDefault();
    if (onNavigate) {
      onNavigate('/');
    } else {
      window.location.href = '/';
    }
  };

  const activeKey = statusData?.activeProvider || 'builtin';
  const activeInfo = statusData?.providers?.[activeKey];
  const isCloudActive = activeKey !== 'builtin';
  const security = statusData?.security || {};

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      overflowY: 'auto',
      background: 'var(--bg-base)',
      color: 'var(--text-main)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Bar */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            className="back-btn"
            onClick={goHome}
            title="Return to Document Converter"
          >
            <ArrowLeft size={14} />
            <span>Back to App</span>
          </button>

          <div className="brand-wrapper" onClick={goHome} title="FormFlow AI Home" style={{ cursor: 'pointer' }}>
            <div className="brand-icon-box">
              <Sparkles size={18} color="#ffffff" />
            </div>
            <div>
              <div className="brand-title">FormFlow</div>
            </div>
            <span className="brand-badge">OCR Config</span>
          </div>
        </div>

        <div className="header-actions" style={{ gap: '10px' }}>
          {lastChecked && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Updated {lastChecked}
            </span>
          )}
          <button
            className="btn btn-secondary"
            onClick={fetchStatus}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Checking...' : 'Refresh Status'}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        width: '100%',
        maxWidth: '1040px',
        margin: '0 auto',
        padding: '28px 20px 56px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', marginBottom: '6px' }}>OCR Engine & System Configuration</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Live view of which OCR engine is currently active in <code style={{ color: 'var(--accent-cyan)' }}>Auto</code> mode, provider credentials status, and zero-storage privacy settings.
          </p>
        </div>

        {error && (
          <div style={{
            padding: '14px 18px',
            borderRadius: '10px',
            background: 'var(--rose-bg)',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#fda4af',
            fontSize: '0.88rem'
          }}>
            Could not reach backend status endpoint ({API_BASE}/status): {error}
          </div>
        )}

        {/* Active OCR Highlight Card */}
        <section style={{
          background: isCloudActive
            ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(14, 19, 31, 0.95))'
            : 'linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(14, 19, 31, 0.95))',
          border: isCloudActive
            ? '1px solid rgba(16, 185, 129, 0.45)'
            : '1px solid rgba(245, 158, 11, 0.45)',
          borderRadius: '14px',
          padding: '22px 24px',
          boxShadow: 'var(--shadow-lg)'
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Activity size={16} color={isCloudActive ? '#10b981' : '#f59e0b'} />
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: isCloudActive ? '#34d399' : '#fbbf24'
                }}>
                  Currently Active OCR Engine (Default / Auto Mode)
                </span>
              </div>

              <h2 style={{ fontSize: '1.35rem', color: '#ffffff', marginBottom: '6px' }}>
                {loading && !statusData ? 'Checking active engine...' : (statusData?.activeEngineName || activeInfo?.name || 'Built-in Local Engine')}
              </h2>

              <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', maxWidth: '700px' }}>
                {PROVIDER_DESCRIPTIONS[activeKey]}
              </p>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '6px'
            }}>
              <span style={{
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 700,
                background: statusData?.status === 'online' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                color: statusData?.status === 'online' ? '#6ee7b7' : '#fda4af',
                border: statusData?.status === 'online' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(244, 63, 94, 0.4)'
              }}>
                {statusData?.status === 'online' ? 'ONLINE & ACTIVE' : (loading ? 'CHECKING...' : 'OFFLINE')}
              </span>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                Provider ID: <code style={{ color: '#ffffff' }}>{activeKey}</code>
                {activeInfo?.region ? <> &bull; Region: <code style={{ color: '#ffffff' }}>{activeInfo.region}</code></> : null}
              </span>
            </div>
          </div>
        </section>

        {/* Runtime & Privacy Summary */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px'
        }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>
              <Lock size={14} color="#10b981" />
              <span>File Storage Mode</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.96rem', color: '#6ee7b7' }}>
              {security.diskUploadStorage === false ? 'Zero Disk Storage (RAM Only)' : 'Ephemeral'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
              Uploads &amp; JSON are never saved on disk
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>
              <Clock size={14} color="#06b6d4" />
              <span>Auto-Wipe TTL</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.96rem' }}>
              {security.documentTtlMinutes ?? 15} Minutes
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
              Or purged immediately on Back / Tab Close
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>
              <Server size={14} color="#6366f1" />
              <span>Environment</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.96rem', textTransform: 'capitalize' }}>
              {statusData?.environment || 'unknown'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
              Active RAM sessions: {security.activeSessionsCount ?? 0}
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>
              <ShieldCheck size={14} color="#a78bfa" />
              <span>Browser / Proxy Cache</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.96rem' }}>
              Disabled (no-store)
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px' }}>
              Images &amp; exports never cached by proxies
            </div>
          </div>
        </section>

        {/* All OCR Providers List */}
        <section style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '20px 22px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={17} color="var(--primary)" />
              <h3 style={{ fontSize: '1.02rem' }}>All OCR Providers (Auto Priority Order)</h3>
            </div>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-dim)' }}>
              In Auto mode, FormFlow picks the highest-priority configured engine (#1 &rarr; #5)
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {PROVIDER_ORDER.map((key, idx) => {
              const p = statusData?.providers?.[key];
              if (!p) return null;
              const isActive = !!p.activeInAuto;
              const isReady = !!p.configured || !!p.readyWithoutKey;

              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    background: isActive ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-surface)',
                    border: isActive
                      ? '1px solid rgba(16, 185, 129, 0.45)'
                      : '1px solid var(--border-subtle)'
                  }}
                >
                  <div style={{ flex: '1 1 320px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: 'var(--bg-input)',
                        color: 'var(--text-muted)'
                      }}>
                        #{p.priority || idx + 1}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff' }}>
                        {p.name}
                      </span>
                      <span style={{
                        fontSize: '0.72rem',
                        color: 'var(--accent-cyan)',
                        background: 'rgba(6, 182, 212, 0.1)',
                        padding: '2px 8px',
                        borderRadius: '4px'
                      }}>
                        {p.type || (key === 'builtin' ? 'Local Offline' : 'Cloud')}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: p.envKeys?.length ? '6px' : 0 }}>
                      {PROVIDER_DESCRIPTIONS[key]}
                    </p>

                    {p.envKeys?.length > 0 && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                        Env Keys:{' '}
                        {p.envKeys.map((k, kIdx) => (
                          <React.Fragment key={k}>
                            <code style={{ color: '#cbd5e1', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: '3px' }}>{k}</code>
                            {kIdx < p.envKeys.length - 1 ? ' ' : ''}
                          </React.Fragment>
                        ))}
                        {p.region && (
                          <span style={{ marginLeft: '8px', color: '#6ee7b7' }}>
                            (Region: <code>{p.region}</code>)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isActive && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 12px',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: 'rgba(16, 185, 129, 0.2)',
                        color: '#6ee7b7',
                        border: '1px solid rgba(16, 185, 129, 0.45)'
                      }}>
                        <CheckCircle2 size={13} />
                        ACTIVE NOW
                      </span>
                    )}

                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 11px',
                      borderRadius: '999px',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      background: isReady ? 'rgba(99, 102, 241, 0.14)' : 'rgba(100, 116, 139, 0.16)',
                      color: isReady ? '#a5b4fc' : '#94a3b8',
                      border: isReady ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid rgba(148, 163, 184, 0.25)'
                    }}>
                      {isReady ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {p.configured ? 'Configured' : (p.readyWithoutKey ? 'Fallback Ready' : 'Not Configured')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Raw Endpoint Info */}
        <section style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '14px 18px',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <span>
            Status API Endpoint:{' '}
            <a href={`${API_BASE}/status`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}>
              {API_BASE}/status
            </a>
          </span>
          <span>Secret values (API keys) are never sent to the browser.</span>
        </section>
      </main>
    </div>
  );
}
