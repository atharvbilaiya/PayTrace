import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = 'http://localhost:8000'

const EXAMPLE_TXNS = [
  { id: 'TXN_1001', label: 'TXN_1001 (Settled)' },
  { id: 'TXN_1005', label: 'TXN_1005 (Missing Ledger)' },
  { id: 'TXN_1006', label: 'TXN_1006 (Amount Mismatch)' },
  { id: 'TXN_1008', label: 'TXN_1008 (SLA Breach)' },
  { id: 'TXN_1009', label: 'TXN_1009 (Conflicting Records)' },
]

function App() {
  const [txnId, setTxnId] = useState('TXN_1001')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const investigate = async (idToSearch) => {
    const targetId = (idToSearch || txnId).trim()
    if (!targetId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE}/api/investigate/${encodeURIComponent(targetId)}`)
      if (!response.ok) {
        if (response.status === 404) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.detail || `Transaction ID "${targetId}" was not found.`)
        }
        throw new Error(`Server error (${response.status}). Please verify the backend service.`)
      }
      const data = await response.json()
      setResult(data)
    } catch (err) {
      setResult(null)
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError('Backend API unavailable. Please verify the FastAPI backend server is running on http://localhost:8000.')
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  // Initial load
  useEffect(() => {
    investigate('TXN_1001')
  }, [])

  const handleFormSubmit = (e) => {
    e.preventDefault()
    investigate(txnId)
  }

  const handleChipClick = (id) => {
    setTxnId(id)
    investigate(id)
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <span className="logo-text">PayTrace</span>
          <span className="subtitle">Settlement Investigation & Support</span>
        </div>
        <div className="demo-badge">Mock Data Demo</div>
      </header>

      {/* Hero / Search Section */}
      <section className="search-hero">
        <h2>Investigate a transaction</h2>
        <p>Enter a transaction ID to perform instant cross-system reconciliation across Gateway, Bank, and Ledger records.</p>
        
        <form className="search-form" onSubmit={handleFormSubmit}>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. TXN_1001"
            value={txnId}
            onChange={(e) => setTxnId(e.target.value)}
          />
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? 'Investigating...' : 'Investigate'}
          </button>
        </form>

        <div className="sample-chips">
          <span className="chips-label">Sample Scenarios:</span>
          {EXAMPLE_TXNS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip-btn"
              onClick={() => handleChipClick(item.id)}
            >
              {item.id}
            </button>
          ))}
        </div>
      </section>

      {/* Loading State */}
      {loading && (
        <div className="state-box">
          <div className="loading-spinner"></div>
          <p style={{ color: 'var(--text-muted)' }}>Cross-referencing Gateway, Bank, and Internal Ledger records...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="state-box">
          <div className="error-title">Investigation Failed</div>
          <div className="error-desc">{error}</div>
        </div>
      )}

      {/* Results Section */}
      {!loading && result && (
        <main className="results-container">
          {/* Status Hero Banner */}
          <div className={`status-hero ${result.final_status}`}>
            <div className="status-main">
              <span className="status-label">Final Investigation Status</span>
              <span className="status-value">{result.final_status}</span>
            </div>
            <div className="status-meta">
              <span className="txn-id-pill">{result.transaction_id}</span>
              <span className={`confidence-badge ${result.confidence}`}>
                {result.confidence} Confidence
              </span>
            </div>
          </div>

          {/* Recommended Action */}
          {result.recommended_action && (
            <div className="recommended-action-box">
              <div className="action-icon">🎯</div>
              <div className="action-content">
                <h4>Recommended Action</h4>
                <p>{result.recommended_action}</p>
              </div>
            </div>
          )}

          {/* Exceptions List */}
          {result.exceptions && result.exceptions.length > 0 && (
            <div className="exceptions-container">
              <div className="section-title">Detected Exception Tags</div>
              <div className="exceptions-tags">
                {result.exceptions.map((exc, idx) => (
                  <span key={idx} className="exception-tag">
                    {exc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* System Trace Section */}
          <section className="system-trace-section">
            <div className="section-title">System Reconciliation Trace</div>
            <div className="system-trace-grid">
              {/* Gateway Stage */}
              <div className="trace-card">
                <div className="trace-card-header">
                  <span className="stage-name">Gateway Authorization</span>
                  {result.records.gateway ? (
                    <span className={`stage-badge ${result.records.gateway.status}`}>
                      {result.records.gateway.status}
                    </span>
                  ) : (
                    <span className="stage-badge MISSING">MISSING</span>
                  )}
                </div>
                {result.records.gateway ? (
                  <div className="trace-body">
                    <div className="trace-field">
                      <span className="field-label">Amount</span>
                      <span className="field-value">
                        {result.records.gateway.currency} {result.records.gateway.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Reference</span>
                      <span className="field-value">{result.records.gateway.gateway_reference || 'N/A'}</span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Timestamp</span>
                      <span className="field-value">{result.records.gateway.payment_timestamp || 'N/A'}</span>
                    </div>
                    {result.records.gateway.failure_reason && (
                      <div className="trace-field" style={{ color: '#f87171' }}>
                        <span className="field-label" style={{ color: '#f87171' }}>Failure Reason</span>
                        <span className="field-value">{result.records.gateway.failure_reason}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="no-record-msg">No record found in Gateway logs</div>
                )}
              </div>

              {/* Bank Settlement Stage */}
              <div className="trace-card">
                <div className="trace-card-header">
                  <span className="stage-name">Bank Settlement</span>
                  {result.records.bank ? (
                    <span className={`stage-badge ${result.records.bank.status}`}>
                      {result.records.bank.status}
                    </span>
                  ) : (
                    <span className="stage-badge MISSING">MISSING</span>
                  )}
                </div>
                {result.records.bank ? (
                  <div className="trace-body">
                    <div className="trace-field">
                      <span className="field-label">Amount</span>
                      <span className="field-value">
                        {result.records.bank.currency} {result.records.bank.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Bank UTR</span>
                      <span className="field-value">{result.records.bank.bank_reference || 'N/A'}</span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Timestamp</span>
                      <span className="field-value">{result.records.bank.settlement_timestamp || 'In-Flight'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="no-record-msg">No record found in Bank settlement files</div>
                )}
              </div>

              {/* Internal Ledger Stage */}
              <div className="trace-card">
                <div className="trace-card-header">
                  <span className="stage-name">Internal Ledger</span>
                  {result.records.ledger ? (
                    <span className={`stage-badge ${result.records.ledger.status}`}>
                      {result.records.ledger.status}
                    </span>
                  ) : (
                    <span className="stage-badge MISSING">MISSING</span>
                  )}
                </div>
                {result.records.ledger ? (
                  <div className="trace-body">
                    <div className="trace-field">
                      <span className="field-label">Amount</span>
                      <span className="field-value">
                        {result.records.ledger.currency} {result.records.ledger.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Entry ID</span>
                      <span className="field-value">{result.records.ledger.ledger_entry_id || 'N/A'}</span>
                    </div>
                    <div className="trace-field">
                      <span className="field-label">Recorded At</span>
                      <span className="field-value">{result.records.ledger.recorded_at || 'N/A'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="no-record-msg">No record found in Internal Ledger</div>
                )}
              </div>
            </div>
          </section>

          {/* Investigation Timeline */}
          {result.timeline && result.timeline.length > 0 && (
            <section className="timeline-section">
              <div className="section-title">Visual Audit Timeline</div>
              <div className="timeline-list">
                {result.timeline.map((stepItem, idx) => (
                  <div key={idx} className={`timeline-item ${stepItem.status}`}>
                    <div className="timeline-dot"></div>
                    <div className="timeline-header">
                      <span className="timeline-step">{stepItem.step}</span>
                      {stepItem.timestamp && (
                        <span className="timeline-time">{stepItem.timestamp}</span>
                      )}
                    </div>
                    <div className="timeline-details">{stepItem.details}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  )
}

export default App
