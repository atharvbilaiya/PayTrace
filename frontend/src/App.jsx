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

function generateVerifiedSummary(result) {
  if (!result) return ''

  const { transaction_id, final_status, confidence, exceptions, records, recommended_action } = result
  const gw = records?.gateway
  const bank = records?.bank
  const ledger = records?.ledger

  const parts = []

  // 1. Transaction & Gateway State
  if (gw) {
    const amtStr = `${gw.currency || 'INR'} ${gw.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    if (gw.status === 'SUCCESS') {
      parts.push(`Transaction ${transaction_id} was successfully authorized by the payment gateway for ${amtStr}.`)
    } else if (gw.status === 'FAILED') {
      const reasonStr = gw.failure_reason ? ` due to ${gw.failure_reason}` : ''
      parts.push(`Transaction ${transaction_id} failed at the payment gateway level for ${amtStr}${reasonStr}.`)
    } else {
      parts.push(`Transaction ${transaction_id} is currently processing at the payment gateway level.`)
    }
  } else {
    parts.push(`Transaction ${transaction_id} has no record in gateway authorization logs.`)
  }

  // 2. Downstream System Findings & Classification
  if (final_status === 'SETTLED') {
    const bankRef = bank?.bank_reference ? ` (UTR: ${bank.bank_reference})` : ''
    const ledgerId = ledger?.ledger_entry_id ? ` (Entry: ${ledger.ledger_entry_id})` : ''
    parts.push(`Funds were settled by the bank${bankRef} and credited to the internal ledger${ledgerId}. PayTrace reconciled all records with ${confidence.toLowerCase()} confidence and classified the transaction as SETTLED.`)
  } else if (final_status === 'BANK_SETTLEMENT_PENDING') {
    parts.push(`Payment settlement remains in-flight at the bank within the standard 48-hour SLA window. PayTrace determined the status as BANK_SETTLEMENT_PENDING with ${confidence.toLowerCase()} confidence.`)
  } else if (final_status === 'SETTLEMENT_EXCEPTION') {
    if (exceptions.includes('MISSING_LEDGER')) {
      parts.push(`The bank successfully settled the payment, but no matching entry was recorded in the internal ledger. PayTrace flagged this as a Settlement Exception (Missing Ledger) with ${confidence.toLowerCase()} confidence.`)
    } else if (exceptions.includes('AMOUNT_MISMATCH')) {
      const gwAmt = gw ? `${gw.currency} ${gw.amount}` : ''
      const bankAmt = bank ? `${bank.currency} ${bank.amount}` : ''
      const ledgerAmt = ledger ? `${ledger.currency} ${ledger.amount}` : ''
      parts.push(`Financial record discrepancies were detected across systems (Gateway: ${gwAmt}, Bank: ${bankAmt}, Ledger: ${ledgerAmt}). PayTrace flagged this as a Settlement Exception (Amount Mismatch) with ${confidence.toLowerCase()} confidence.`)
    } else if (exceptions.includes('SLA_BREACH')) {
      parts.push(`Bank settlement has remained pending for over 48 hours past the authorized payment timestamp. PayTrace flagged this as an SLA Breach Settlement Exception with ${confidence.toLowerCase()} confidence.`)
    } else if (exceptions.includes('BANK_REJECTED')) {
      parts.push(`The bank settlement batch was rejected during processing. PayTrace classified this as a Settlement Exception (Bank Rejected) with ${confidence.toLowerCase()} confidence.`)
    } else {
      parts.push(`A settlement exception was detected during cross-system reconciliation with ${confidence.toLowerCase()} confidence.`)
    }
  } else if (final_status === 'PAYMENT_FAILED') {
    if (exceptions.includes('PHANTOM_RECORD_CONFLICT')) {
      parts.push(`Although the gateway payment failed, unexpected downstream bank or ledger entries were detected. PayTrace flagged this as a Phantom Record Conflict with ${confidence.toLowerCase()} confidence.`)
    } else {
      parts.push(`No downstream bank settlement or ledger posting occurred. PayTrace classified this as PAYMENT_FAILED with ${confidence.toLowerCase()} confidence.`)
    }
  } else if (final_status === 'INVESTIGATION_UNCERTAIN') {
    if (exceptions.includes('CONFLICTING_RECORDS')) {
      parts.push(`Multiple duplicate or conflicting settlement records were found across datasets. PayTrace classified this transaction as INVESTIGATION_UNCERTAIN with ${confidence.toLowerCase()} confidence due to data ambiguity.`)
    } else if (exceptions.includes('MISSING_GATEWAY_RECORD')) {
      parts.push(`Downstream bank or ledger records were found, but the primary gateway authorization record is missing. PayTrace classified this transaction as INVESTIGATION_UNCERTAIN with ${confidence.toLowerCase()} confidence.`)
    } else {
      parts.push(`Data ambiguity or unmapped records prevented conclusive resolution. PayTrace classified this transaction as INVESTIGATION_UNCERTAIN with ${confidence.toLowerCase()} confidence.`)
    }
  }

  // 3. Recommended Next Step
  if (recommended_action) {
    parts.push(`Recommended Next Step: ${recommended_action}`)
  }

  return parts.join(' ')
}

function App() {
  const [txnId, setTxnId] = useState('TXN_1001')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Dashboard states
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardError, setDashboardError] = useState(null)

  const fetchDashboardSummary = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/summary`)
      if (res.ok) {
        const data = await res.json()
        setDashboardData(data)
        setDashboardError(null)
      } else {
        setDashboardError('Dashboard data temporarily unavailable.')
      }
    } catch {
      setDashboardError('Dashboard data temporarily unavailable.')
    }
  }

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
    fetchDashboardSummary()
    investigate('TXN_1001')
  }, [])

  const handleFormSubmit = (e) => {
    e.preventDefault()
    investigate(txnId)
  }

  const handleTxnSelect = (id) => {
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

      {/* Support Dashboard */}
      {dashboardError ? (
        <div className="dashboard-error-banner">{dashboardError}</div>
      ) : dashboardData ? (
        <section className="dashboard-section">
          <div className="dashboard-header">
            <div className="dashboard-title">
              Support Operations Overview
              <span className="total-badge">{dashboardData.total_transactions} Total Transactions</span>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="stat-card SETTLED">
              <span className="stat-label">SETTLED</span>
              <span className="stat-count">{dashboardData.status_counts?.SETTLED || 0}</span>
            </div>
            <div className="stat-card BANK_SETTLEMENT_PENDING">
              <span className="stat-label">BANK PENDING</span>
              <span className="stat-count">{dashboardData.status_counts?.BANK_SETTLEMENT_PENDING || 0}</span>
            </div>
            <div className="stat-card PAYMENT_FAILED">
              <span className="stat-label">PAYMENT FAILED</span>
              <span className="stat-count">{dashboardData.status_counts?.PAYMENT_FAILED || 0}</span>
            </div>
            <div className="stat-card PAYMENT_PENDING">
              <span className="stat-label">GATEWAY PENDING</span>
              <span className="stat-count">{dashboardData.status_counts?.PAYMENT_PENDING || 0}</span>
            </div>
            <div className="stat-card SETTLEMENT_EXCEPTION">
              <span className="stat-label">EXCEPTIONS</span>
              <span className="stat-count">{dashboardData.status_counts?.SETTLEMENT_EXCEPTION || 0}</span>
            </div>
            <div className="stat-card INVESTIGATION_UNCERTAIN">
              <span className="stat-label">UNCERTAIN</span>
              <span className="stat-count">{dashboardData.status_counts?.INVESTIGATION_UNCERTAIN || 0}</span>
            </div>
          </div>

          {dashboardData.recent_transactions && dashboardData.recent_transactions.length > 0 && (
            <div className="recent-txns-section">
              <div className="recent-title">Quick Select Recent Transactions (Click to Investigate)</div>
              <div className="recent-cards-scroll">
                {dashboardData.recent_transactions.map((t) => (
                  <div
                    key={t.transaction_id}
                    className="recent-txn-card"
                    onClick={() => handleTxnSelect(t.transaction_id)}
                  >
                    <span className="recent-tid">{t.transaction_id}</span>
                    <span className={`recent-status-pill ${t.final_status}`}>
                      {t.final_status}
                    </span>
                    <span className="recent-amt">
                      {t.currency} {t.amount?.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

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
              onClick={() => handleTxnSelect(item.id)}
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

          {/* Verified Investigation Summary */}
          <div className="verified-summary-box">
            <div className="summary-header">
              <h3>Investigation Summary</h3>
              <span className="trust-indicator">🛡️ Based on verified Gateway, Bank and Ledger records</span>
            </div>
            <p className="summary-text">{generateVerifiedSummary(result)}</p>
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
