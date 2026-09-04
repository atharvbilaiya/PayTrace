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

const getStatusIcon = (status) => {
  switch (status) {
    case 'SETTLED':
      return '✓'
    case 'BANK_SETTLEMENT_PENDING':
    case 'PAYMENT_PENDING':
      return '⏱️'
    case 'SETTLEMENT_EXCEPTION':
      return '⚠️'
    case 'PAYMENT_FAILED':
      return '❌'
    case 'INVESTIGATION_UNCERTAIN':
      return '❓'
    default:
      return '🔍'
  }
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

    setTxnId(targetId)
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
          <span className="subtitle">Settlement Investigation & Support Engine</span>
        </div>
        <div className="header-meta">
          <span className="live-indicator">
            <span className="pulse-dot"></span> Live Engine
          </span>
          <div className="demo-badge">Mock Data Demo</div>
        </div>
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
                    style={{ pointerEvents: loading ? 'none' : 'auto', opacity: loading ? 0.7 : 1 }}
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
        <h2>Investigate a Transaction</h2>
        <p>Enter a transaction ID to perform real-time cross-system reconciliation across Gateway, Bank, and Internal Ledger records.</p>
        
        <form className="search-form" onSubmit={handleFormSubmit}>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. TXN_1001"
            value={txnId}
            disabled={loading}
            onChange={(e) => setTxnId(e.target.value)}
          />
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? 'Investigating...' : 'Investigate'}
          </button>
        </form>

        <div className="sample-chips">
          <span className="chips-label">Quick Load Scenario:</span>
          {EXAMPLE_TXNS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip-btn"
              disabled={loading}
              onClick={() => handleTxnSelect(item.id)}
            >
              {item.id}
            </button>
          ))}
        </div>
      </section>

      {/* Loading State */}
      {loading && (
        <div className="investigation-loading-panel">
          <div className="loading-panel-header">
            <div className="loading-spinner-sm"></div>
            <div className="loading-header-title">
              <span>Executing Cross-System Investigation...</span>
              <span className="loading-target-id">Target: {txnId}</span>
            </div>
          </div>
          <div className="loading-stages-grid">
            <div className="loading-stage">
              <span className="stage-dot"></span>
              <span className="stage-text">1. Connecting to Gateway Records</span>
            </div>
            <div className="loading-stage">
              <span className="stage-dot"></span>
              <span className="stage-text">2. Checking Bank Settlement</span>
            </div>
            <div className="loading-stage">
              <span className="stage-dot"></span>
              <span className="stage-text">3. Reconciling Internal Ledger</span>
            </div>
            <div className="loading-stage">
              <span className="stage-dot"></span>
              <span className="stage-text">4. Evaluating Investigation Rules</span>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !result && !error && (
        <section className="empty-workspace-container">
          <div className="empty-workspace-header">
            <span className="empty-icon">🔍</span>
            <h3>Ready for Settlement Investigation</h3>
            <p>Enter a Transaction ID above or click any sample scenario to initiate real-time three-way reconciliation.</p>
          </div>

          <div className="empty-systems-grid">
            <div className="empty-system-card">
              <div className="empty-sys-icon">💳</div>
              <h4>Payment Gateway</h4>
              <p>Traces authorization status, failure codes, amounts, and gateway reference IDs.</p>
            </div>
            <div className="empty-system-card">
              <div className="empty-sys-icon">🏦</div>
              <h4>Bank Settlement</h4>
              <p>Checks bank settlement batches, UTRs, clearing records, and 48-hour SLA status.</p>
            </div>
            <div className="empty-system-card">
              <div className="empty-sys-icon">📘</div>
              <h4>Internal Ledger</h4>
              <p>Verifies internal accounting ledger entries, entry IDs, and credited balance postings.</p>
            </div>
          </div>
        </section>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="error-workspace-box">
          <div className="error-header-row">
            <div className="error-title-group">
              <span className="error-icon">⚠️</span>
              <h3>
                {error.includes('not found') ? 'Transaction Not Found' : 'Backend Service Unavailable'}
              </h3>
            </div>
            <span className="error-target-pill">Target ID: {txnId}</span>
          </div>

          <div className="error-body">
            <p className="error-desc-text">{error}</p>
            
            <div className="error-action-hint">
              <span className="hint-label">Suggested Resolution:</span>
              <p>
                {error.includes('not found')
                  ? 'Please verify the Transaction ID spelling or select one of the sample scenarios above (e.g. TXN_1001, TXN_1005).'
                  : 'Ensure the FastAPI backend server is running on http://localhost:8000 (e.g. uvicorn main:app --port 8000).'}
              </p>
            </div>

            <div className="error-actions-row">
              <button
                type="button"
                className="retry-btn"
                onClick={() => investigate(txnId)}
              >
                🔄 Try Again
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Results Section */}
      {!loading && result && (
        <main className="results-container">
          <div className="results-dossier-header">
            <span className="dossier-badge">RECONCILIATION DOSSIER</span>
            <span className="dossier-subtext">Active Investigation Results</span>
          </div>

          {/* Status Hero Banner */}
          <div className={`status-hero ${result.final_status}`}>
            <div className="status-main">
              <span className="status-label">FINAL RECONCILIATION STATUS</span>
              <div className="status-value-group">
                <span className="status-icon">{getStatusIcon(result.final_status)}</span>
                <span className="status-value">{result.final_status}</span>
              </div>
            </div>
            <div className="status-meta">
              <div className="meta-tid-group">
                <span className="meta-label">Transaction Ref</span>
                <span className="txn-id-pill">{result.transaction_id}</span>
              </div>
              <span className={`confidence-badge ${result.confidence}`}>
                {result.confidence === 'HIGH' ? '✓ ' : result.confidence === 'MEDIUM' ? '⚠️ ' : '🚨 '}
                {result.confidence} Confidence
              </span>
            </div>
          </div>

          {/* Executive Summary Block */}
          <section className="executive-summary-section">
            <div className="section-header-block">
              <span className="section-step-tag">01</span>
              <div className="section-title-group">
                <h3 className="section-title">Executive Summary & Operational Plan</h3>
                <span className="section-subtitle">Verified findings and recommended next steps</span>
              </div>
            </div>

            <div className="verified-summary-box">
              <div className="summary-header">
                <h3>Cross-System Synthesis</h3>
                <span className="trust-indicator">🛡️ Verified Audit Record</span>
              </div>
              <p className="summary-text">{generateVerifiedSummary(result)}</p>
            </div>

            {result.recommended_action && (
              <div className="recommended-action-box">
                <div className="action-icon">🎯</div>
                <div className="action-content">
                  <h4>Recommended Operational Action</h4>
                  <p>{result.recommended_action}</p>
                </div>
              </div>
            )}

            {result.exceptions && result.exceptions.length > 0 && (
              <div className="exceptions-container">
                <div className="exceptions-title">Detected Exception Flags ({result.exceptions.length})</div>
                <div className="exceptions-tags">
                  {result.exceptions.map((exc, idx) => (
                    <span key={idx} className="exception-tag">
                      ⚠️ {exc}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* System Trace Section */}
          <section className="system-trace-section">
            <div className="section-header-block">
              <span className="section-step-tag">02</span>
              <div className="section-title-group">
                <h3 className="section-title">System Record Trace</h3>
                <span className="section-subtitle">Atomic record status across Gateway, Bank, and Ledger</span>
              </div>
            </div>

            <div className="system-trace-grid">
              {/* Gateway Stage */}
              <div className="trace-card">
                <div className="trace-card-header">
                  <span className="stage-name">💳 Gateway Authorization</span>
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
                  <span className="stage-name">🏦 Bank Settlement</span>
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
                  <span className="stage-name">📘 Internal Ledger</span>
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

          {/* Financial Reconciliation Analysis Section */}
          {result.discrepancy_analysis && (
            <section className="financial-analysis-section">
              <div className="section-header-block">
                <span className="section-step-tag">03</span>
                <div className="section-title-group">
                  <h3 className="section-title">Financial Variance Analysis</h3>
                  <span className="section-subtitle">Three-way amount and currency reconciliation</span>
                </div>
              </div>

              <div className={`discrepancy-card ${result.discrepancy_analysis.type}`}>
                {result.discrepancy_analysis.type === 'RECONCILED' && (
                  <>
                    <div className="disc-header-title">
                      ✓ All available financial records reconcile successfully
                    </div>
                    <div className="reconciled-pills">
                      <span className="amount-pill">
                        Gateway → {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.gateway_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="amount-pill">
                        Bank → {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.bank_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="amount-pill">
                        Ledger → {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.ledger_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                )}

                {result.discrepancy_analysis.type === 'AMOUNT_MISMATCH' && (
                  <>
                    <div className="disc-header-title">
                      🚨 Financial Variance Detected
                    </div>
                    <div className="sys-amt-grid">
                      <div className="sys-amt-card">
                        <span className="sys-amt-name">Gateway Authorization</span>
                        <span className="sys-amt-val">
                          {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.gateway_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || 'N/A'}
                        </span>
                      </div>
                      <div className="sys-amt-card">
                        <span className="sys-amt-name">Bank Settlement</span>
                        <span className="sys-amt-val">
                          {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.bank_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || 'N/A'}
                        </span>
                      </div>
                      <div className="sys-amt-card">
                        <span className="sys-amt-name">Internal Ledger</span>
                        <span className="sys-amt-val">
                          {result.discrepancy_analysis.amount_comparison.currency} {result.discrepancy_analysis.amount_comparison.ledger_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || 'N/A'}
                        </span>
                      </div>
                    </div>
                    {result.discrepancy_analysis.variances && result.discrepancy_analysis.variances.map((v, idx) => (
                      <div key={idx} className="variance-card">
                        <div className="variance-header">
                          <span className="variance-comp">Variance: {v.comparison}</span>
                          <span className="shortfall-badge">
                            {result.discrepancy_analysis.amount_comparison.currency} {v.absolute_difference?.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {v.difference < 0 ? 'SHORTFALL' : 'VARIANCE'}
                          </span>
                        </div>
                        <div className="variance-details">{v.details}</div>
                      </div>
                    ))}
                  </>
                )}

                {result.discrepancy_analysis.type === 'MISSING_RECORD' && (
                  <>
                    <div className="disc-header-title">
                      ⚠️ Missing System Record ({result.discrepancy_analysis.missing_records?.join(', ')})
                    </div>
                    <div className="disc-summary-desc">{result.discrepancy_analysis.summary}</div>
                  </>
                )}

                {result.discrepancy_analysis.type === 'SETTLEMENT_DELAY' && (
                  <>
                    <div className="disc-header-title">
                      ⏱️ Settlement Processing Delay
                    </div>
                    <div className="disc-summary-desc">{result.discrepancy_analysis.summary}</div>
                  </>
                )}

                {result.discrepancy_analysis.type === 'DATA_CONFLICT' && (
                  <>
                    <div className="disc-header-title">
                      ⛔ Financial Comparison Unavailable (Data Ambiguity)
                    </div>
                    <div className="disc-summary-desc">{result.discrepancy_analysis.summary}</div>
                  </>
                )}

                {result.discrepancy_analysis.type === 'CURRENCY_MISMATCH' && (
                  <>
                    <div className="disc-header-title">
                      🌐 Currency Mismatch Detected
                    </div>
                    <div className="disc-summary-desc">{result.discrepancy_analysis.summary}</div>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Root Cause & Operational Impact Section */}
          {result.root_cause_analysis && (
            <section className="root-cause-section">
              <div className="section-header-block">
                <span className="section-step-tag">04</span>
                <div className="section-title-group">
                  <h3 className="section-title">Root Cause & Operational Impact</h3>
                  <span className="section-subtitle">Deterministic failure diagnosis and operational action plan</span>
                </div>
              </div>

              <div className={`root-cause-card ${result.root_cause_analysis.severity}`}>
                <div className="root-cause-header">
                  <div className="badge-group">
                    <span className={`rc-severity-badge ${result.root_cause_analysis.severity}`}>
                      {result.root_cause_analysis.severity === 'HIGH' ? '🚨 ' : result.root_cause_analysis.severity === 'MEDIUM' ? '⚠️ ' : ''}
                      {result.root_cause_analysis.severity} SEVERITY
                    </span>
                    <span className="rc-category-badge">
                      {result.root_cause_analysis.category}
                    </span>
                  </div>
                  <span className="primary-sys-tag">
                    Primary System: <strong>{result.root_cause_analysis.primary_system}</strong>
                  </span>
                </div>

                <div className="root-cause-content-grid">
                  <div className="rc-block cause-block">
                    <div className="rc-block-title">
                      🔍 Diagnostic Root Cause
                    </div>
                    <div className="rc-block-text">
                      {result.root_cause_analysis.root_cause}
                    </div>
                  </div>

                  <div className="rc-block impact-block">
                    <div className="rc-block-title">
                      ⚡ Operational Impact
                    </div>
                    <div className="rc-block-text">
                      {result.root_cause_analysis.operational_impact}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Investigation Decision Trace Stepper */}
          {result.rule_evaluation_trace && result.rule_evaluation_trace.length > 0 && (
            <section className="decision-trace-section">
              <div className="section-header-block">
                <span className="section-step-tag">05</span>
                <div className="section-title-group">
                  <h3 className="section-title">Investigation Decision Trace</h3>
                  <span className="section-subtitle">Deterministic rule evaluation based on verified system records</span>
                </div>
              </div>

              <div className="trace-stepper-list">
                {result.rule_evaluation_trace.map((stepItem) => (
                  <div key={stepItem.step} className={`trace-stepper-item ${stepItem.result}`}>
                    <div className="trace-step-node"></div>
                    <div className="trace-item-header">
                      <div className="trace-item-title-group">
                        <span className="step-num-pill">Step {stepItem.step}</span>
                        <span className="rule-name">{stepItem.rule}</span>
                      </div>
                      <span className={`result-badge ${stepItem.result}`}>
                        {stepItem.result}
                      </span>
                    </div>
                    <div className="trace-item-details">{stepItem.details}</div>
                    {stepItem.elapsed_hours !== undefined && (
                      <div className="sla-metadata-badge">
                        <span>Elapsed: {stepItem.elapsed_hours}h</span>
                        <span>SLA Threshold: {stepItem.threshold_hours}h</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Investigation Timeline */}
          {result.timeline && result.timeline.length > 0 && (
            <section className="timeline-section">
              <div className="section-header-block">
                <span className="section-step-tag">06</span>
                <div className="section-title-group">
                  <h3 className="section-title">Visual Audit Timeline</h3>
                  <span className="section-subtitle">Sequential event progression across payment stages</span>
                </div>
              </div>

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

