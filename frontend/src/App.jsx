import { useState, useEffect } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')

const EXAMPLE_TXNS = [
  { id: 'TXN_1001', label: 'TXN_1001 (Settled)' },
  { id: 'TXN_1005', label: 'TXN_1005 (Missing Ledger)' },
  { id: 'TXN_1006', label: 'TXN_1006 (Amount Mismatch)' },
  { id: 'TXN_1008', label: 'TXN_1008 (SLA Breach)' },
  { id: 'TXN_1009', label: 'TXN_1009 (Conflicting Records)' },
]

const CUSTOMER_TXNS = [
  { id: 'TXN_1001', label: 'TXN_1001 (Settled)' },
  { id: 'TXN_1005', label: 'TXN_1005 (Missing Ledger)' },
  { id: 'TXN_1006', label: 'TXN_1006 (Amount Mismatch)' },
]

const DEMO_SCENARIOS = [
  {
    id: 'TXN_1001',
    name: 'Successful Settlement',
    icon: '✅',
    badge: 'RECONCILED',
    badgeClass: 'SETTLED',
    description: 'All Gateway, Bank Settlement, and Internal Ledger records reconcile successfully.',
    highlight: 'Clean three-way amount and currency reconciliation.',
  },
  {
    id: 'TXN_1005',
    name: 'Missing Ledger Entry',
    icon: '📘',
    badge: 'MISSING RECORD',
    badgeClass: 'SETTLEMENT_EXCEPTION',
    description: 'Bank settled payment, but no corresponding Internal Ledger record was found.',
    highlight: 'Missing ledger posting detection & Root Cause Analysis.',
  },
  {
    id: 'TXN_1006',
    name: 'Amount Mismatch',
    icon: '💰',
    badge: 'VARIANCE DETECTED',
    badgeClass: 'SETTLEMENT_EXCEPTION',
    description: 'Gateway authorized ₹10,000 while the Bank settled ₹9,500.',
    highlight: '₹500 financial variance calculation & shortfall trace.',
  },
  {
    id: 'TXN_1008',
    name: 'Settlement SLA Breach',
    icon: '⏱️',
    badge: 'SLA BREACH',
    badgeClass: 'SETTLEMENT_EXCEPTION',
    description: 'Bank settlement has remained pending beyond the configured 48-hour SLA.',
    highlight: 'Operational delay detection & SLA breach alert.',
  },
  {
    id: 'TXN_1009',
    name: 'Conflicting Records',
    icon: '🚨',
    badge: 'DATA CONFLICT',
    badgeClass: 'INVESTIGATION_UNCERTAIN',
    description: 'Multiple duplicate or conflicting settlement records across data sources.',
    highlight: 'Data integrity conflict & low-confidence investigation.',
  },
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
  // Auth state
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('paytrace_user')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return parsed?.user ? parsed.user : parsed
      } catch {
        return null
      }
    }
    return null
  })
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loginLoading, setLoginLoading] = useState(false)

  // Guided Mode state (Operations Staff)
  const [guidedMode, setGuidedMode] = useState(false)
  const [guidedStep, setGuidedStep] = useState(1)

  // Smart Demo Scenarios state (Operations Staff)
  const [demoTourActive, setDemoTourActive] = useState(false)
  const [demoTourStepIndex, setDemoTourStepIndex] = useState(0)
  const [activeScenarioId, setActiveScenarioId] = useState(null)

  // Search & Investigation states
  const [txnId, setTxnId] = useState('TXN_1001')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Dashboard states
  const [dashboardData, setDashboardData] = useState(null)
  const [dashboardError, setDashboardError] = useState(null)

  // Case Lifecycle states (Operations Staff)
  const [caseData, setCaseData] = useState(null)
  const [caseLoading, setCaseLoading] = useState(false)
  const [caseError, setCaseError] = useState(null)
  const [noteInput, setNoteInput] = useState('')
  const [caseActionLoading, setCaseActionLoading] = useState(false)

  // Customer Portal & Support Request states
  const [supportFormOpen, setSupportFormOpen] = useState(false)
  const [supportCategory, setSupportCategory] = useState('Payment Not Completed')
  const [supportMessage, setSupportMessage] = useState('')
  const [supportSubmitting, setSupportSubmitting] = useState(false)
  const [supportSuccess, setSupportSuccess] = useState(null)
  const [supportError, setSupportError] = useState(null)
  const [mySupportRequests, setMySupportRequests] = useState([])
  const [opsSupportRequests, setOpsSupportRequests] = useState([])
  const [opsSupportLoading, setOpsSupportLoading] = useState(false)
  const [customerTxnsData, setCustomerTxnsData] = useState([])

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

  const fetchCaseData = async (targetId, activeUser) => {
    const usr = activeUser || user
    if (!usr || usr.role !== 'OPERATIONS_STAFF') return
    setCaseLoading(true)
    setCaseError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(targetId)}`, {
        headers: { 'X-User-Email': usr.email },
      })
      if (!res.ok) {
        throw new Error('Failed to load case lifecycle data.')
      }
      const data = await res.json()
      setCaseData(data)
    } catch (err) {
      setCaseError(err.message)
    } finally {
      setCaseLoading(false)
    }
  }

  const handleUpdateCaseStatus = async (newStatus) => {
    if (!user || user.role !== 'OPERATIONS_STAFF' || !txnId) return
    setCaseActionLoading(true)
    setCaseError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(txnId)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user.email,
        },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || 'Failed to update case status.')
      }
      const updated = await res.json()
      setCaseData(updated)
    } catch (err) {
      setCaseError(err.message)
    } finally {
      setCaseActionLoading(false)
    }
  }

  const handleAssignCase = async () => {
    if (!user || user.role !== 'OPERATIONS_STAFF' || !txnId) return
    setCaseActionLoading(true)
    setCaseError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(txnId)}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user.email,
        },
        body: JSON.stringify({ assigned_to: user.name }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || 'Failed to assign case.')
      }
      const updated = await res.json()
      setCaseData(updated)
    } catch (err) {
      setCaseError(err.message)
    } finally {
      setCaseActionLoading(false)
    }
  }

  const handleAddCaseNote = async (e) => {
    if (e) e.preventDefault()
    if (!user || user.role !== 'OPERATIONS_STAFF' || !txnId || !noteInput.trim()) return
    setCaseActionLoading(true)
    setCaseError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(txnId)}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user.email,
        },
        body: JSON.stringify({ note: noteInput.trim() }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || 'Failed to add note.')
      }
      const updated = await res.json()
      setCaseData(updated)
      setNoteInput('')
    } catch (err) {
      setCaseError(err.message)
    } finally {
      setCaseActionLoading(false)
    }
  }

  const handleLogin = async (emailToUse, passToUse) => {
    const email = emailToUse || loginEmail
    const password = passToUse || loginPassword
    if (!email || !password) return

    setLoginLoading(true)
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || 'Invalid login credentials.')
      }

      const responseData = await response.json()
      const authenticatedUser = responseData?.user || responseData

      // Reset transient workspace & state
      setResult(null)
      setError(null)
      setDashboardData(null)
      setDashboardError(null)
      setCaseData(null)
      setCaseError(null)
      setNoteInput('')
      setGuidedMode(false)
      setGuidedStep(1)
      setDemoTourActive(false)
      setDemoTourStepIndex(0)
      setActiveScenarioId(null)

      // Set user session
      setUser(authenticatedUser)
      localStorage.setItem('paytrace_user', JSON.stringify(authenticatedUser))

      setLoginEmail('')
      setLoginPassword('')
    } catch (err) {
      setLoginError(err.message)
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('paytrace_user')
    setResult(null)
    setError(null)
    setDashboardData(null)
    setDashboardError(null)
    setCaseData(null)
    setCaseError(null)
    setNoteInput('')
    setGuidedMode(false)
    setGuidedStep(1)
    setDemoTourActive(false)
    setDemoTourStepIndex(0)
    setActiveScenarioId(null)
    setSupportFormOpen(false)
    setSupportMessage('')
    setSupportSuccess(null)
    setSupportError(null)
    setMySupportRequests([])
    setOpsSupportRequests([])
    setCustomerTxnsData([])
  }

  const fetchMySupportRequests = async (activeUser) => {
    const usr = activeUser || user
    if (!usr || usr.role !== 'CUSTOMER') return
    try {
      const res = await fetch(`${API_BASE}/api/support/my-requests`, {
        headers: { 'X-User-Email': usr.email }
      })
      if (res.ok) {
        const data = await res.json()
        setMySupportRequests(data)
      }
    } catch {
      // ignore
    }
  }

  const fetchOpsSupportRequests = async (activeUser) => {
    const usr = activeUser || user
    if (!usr || usr.role !== 'OPERATIONS_STAFF') return
    setOpsSupportLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/support/requests`, {
        headers: { 'X-User-Email': usr.email }
      })
      if (res.ok) {
        const data = await res.json()
        setOpsSupportRequests(data)
      }
    } catch {
      // ignore
    } finally {
      setOpsSupportLoading(false)
    }
  }

  const fetchCustomerTransactions = async (activeUser) => {
    const usr = activeUser || user
    if (!usr || usr.role !== 'CUSTOMER') return
    const allowed = usr.allowed_transactions || []
    const results = []
    for (const id of allowed) {
      try {
        const res = await fetch(`${API_BASE}/api/investigate/${encodeURIComponent(id)}`, {
          headers: { 'X-User-Email': usr.email }
        })
        if (res.ok) {
          const data = await res.json()
          results.push(data)
        }
      } catch {
        // ignore
      }
    }
    setCustomerTxnsData(results)
  }

  const handleSubmitSupportRequest = async (e) => {
    e.preventDefault()
    if (!user || user.role !== 'CUSTOMER' || !result?.transaction_id) return

    setSupportSubmitting(true)
    setSupportSuccess(null)
    setSupportError(null)

    try {
      const res = await fetch(`${API_BASE}/api/support/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user.email,
        },
        body: JSON.stringify({
          transaction_id: result.transaction_id,
          issue_category: supportCategory,
          message: supportMessage,
        }),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || 'Failed to submit support request.')
      }

      const created = await res.json()
      setSupportSuccess(`Support Request Submitted! Request ID: ${created.request_id}`)
      setSupportMessage('')
      setSupportFormOpen(false)
      fetchMySupportRequests(user)
    } catch (err) {
      setSupportError(err.message)
    } finally {
      setSupportSubmitting(false)
    }
  }

  const scrollToResults = () => {
    setTimeout(() => {
      const target = document.querySelector('.results-container') || document.querySelector('.customer-portal')
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 100)
  }

  const handleSelectScenario = (scenarioId) => {
    setActiveScenarioId(scenarioId)
    setTxnId(scenarioId)
    investigate(scenarioId)
    scrollToResults()
  }

  const handleStartDemoTour = () => {
    setDemoTourActive(true)
    setDemoTourStepIndex(0)
    const firstScenario = DEMO_SCENARIOS[0]
    setActiveScenarioId(firstScenario.id)
    setTxnId(firstScenario.id)
    investigate(firstScenario.id)
    scrollToResults()
  }

  const handleDemoTourNext = () => {
    if (demoTourStepIndex < DEMO_SCENARIOS.length - 1) {
      const nextIdx = demoTourStepIndex + 1
      setDemoTourStepIndex(nextIdx)
      const nextScenario = DEMO_SCENARIOS[nextIdx]
      setActiveScenarioId(nextScenario.id)
      setTxnId(nextScenario.id)
      investigate(nextScenario.id)
      scrollToResults()
    } else {
      setDemoTourActive(false)
    }
  }

  const handleDemoTourPrev = () => {
    if (demoTourStepIndex > 0) {
      const prevIdx = demoTourStepIndex - 1
      setDemoTourStepIndex(prevIdx)
      const prevScenario = DEMO_SCENARIOS[prevIdx]
      setActiveScenarioId(prevScenario.id)
      setTxnId(prevScenario.id)
      investigate(prevScenario.id)
      scrollToResults()
    }
  }

  const handleExitDemoTour = () => {
    setDemoTourActive(false)
    setActiveScenarioId(null)
  }

  const investigate = async (idToSearch, currentUserOverride) => {
    const targetId = (idToSearch || txnId).trim()
    if (!targetId) return

    setTxnId(targetId)
    setLoading(true)
    setError(null)
    setGuidedStep(1)

    const activeUser = currentUserOverride || user
    const headers = {}
    if (activeUser?.email) {
      headers['X-User-Email'] = activeUser.email
    }

    try {
      const response = await fetch(`${API_BASE}/api/investigate/${encodeURIComponent(targetId)}`, { headers })
      if (!response.ok) {
        if (response.status === 403) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.detail || `Access Denied: You do not have permission to view transaction ${targetId}.`)
        }
        if (response.status === 404) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.detail || `Transaction ID "${targetId}" was not found.`)
        }
        throw new Error(`Server error (${response.status}). Please verify the backend service.`)
      }
      const data = await response.json()
      setResult(data)

      if (activeUser?.role === 'OPERATIONS_STAFF') {
        fetchCaseData(targetId, activeUser)
      } else {
        setCaseData(null)
      }
    } catch (err) {
      setResult(null)
      setCaseData(null)
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError(`Backend API unavailable. Please verify the FastAPI backend server is running on ${API_BASE}.`)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  // Load initial data when user changes
  useEffect(() => {
    if (user && user.role) {
      if (user.role === 'OPERATIONS_STAFF') {
        fetchDashboardSummary()
        fetchOpsSupportRequests(user)
        investigate('TXN_1001', user)
      } else if (user.role === 'CUSTOMER') {
        setDashboardData(null)
        setDashboardError(null)
        const defaultTxn = user.allowed_transactions && user.allowed_transactions.length > 0
          ? user.allowed_transactions[0]
          : 'TXN_1001'
        setTxnId(defaultTxn)
        fetchCustomerTransactions(user)
        fetchMySupportRequests(user)
        investigate(defaultTxn, user)
      }
    }
  }, [user?.email, user?.role])

  const handleFormSubmit = (e) => {
    e.preventDefault()
    setDemoTourActive(false)
    setActiveScenarioId(null)
    investigate(txnId)
  }

  const handleTxnSelect = (id) => {
    setTxnId(id)
    const matchingScenario = DEMO_SCENARIOS.find(s => s.id === id)
    if (matchingScenario) {
      setActiveScenarioId(id)
    } else {
      setActiveScenarioId(null)
      setDemoTourActive(false)
    }
    investigate(id)
  }

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // ------------------------------------------------------------------------
  // LOGIN SCREEN VIEW
  // ------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="login-page-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">PayTrace</div>
            <p className="login-tagline">Settlement Investigation & Reconciliation Platform</p>
          </div>

          {loginError && <div className="login-error-banner">⚠️ {loginError}</div>}

          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault()
              handleLogin()
            }}
          >
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                className="login-input"
                placeholder="name@paytrace.demo"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="login-input"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="login-submit-btn" disabled={loginLoading}>
              {loginLoading ? 'Authenticating...' : 'Sign In to PayTrace'}
            </button>
          </form>

          <div className="demo-credentials-section">
            <div className="demo-divider">
              <span>OR USE DEMO ACCESS</span>
            </div>

            <div className="demo-cards-grid">
              <div
                className="demo-role-card customer-card"
                onClick={() => handleLogin('customer@paytrace.demo', 'customer123')}
              >
                <div className="demo-role-header">
                  <span className="demo-role-icon">👤</span>
                  <span className="demo-role-title">Customer Portal</span>
                </div>
                <p className="demo-role-desc">View assigned payment status & simplified settlement updates</p>
                <div className="demo-cred-tag">customer@paytrace.demo</div>
              </div>

              <div
                className="demo-role-card ops-card"
                onClick={() => handleLogin('ops@paytrace.demo', 'ops123')}
              >
                <div className="demo-role-header">
                  <span className="demo-role-icon">🛡️</span>
                  <span className="demo-role-title">Operations Staff</span>
                </div>
                <p className="demo-role-desc">Full 3-way reconciliation, decision traces & root cause analysis</p>
                <div className="demo-cred-tag">ops@paytrace.demo</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isCustomer = user?.role === 'CUSTOMER'
  const isOpsStaff = user?.role === 'OPERATIONS_STAFF'

  // Helper for customer journey status
  const getCustomerStageStatus = (stage, resultData) => {
    if (!resultData) return { label: 'PENDING', class: 'PENDING' }
    const gw = resultData.records?.gateway
    const bank = resultData.records?.bank

    if (stage === 'gateway') {
      if (gw?.status === 'SUCCESS') return { label: 'AUTHORIZED', class: 'SETTLED' }
      if (gw?.status === 'FAILED') return { label: 'FAILED', class: 'FAILED' }
      return { label: 'PROCESSING', class: 'PENDING' }
    }
    if (stage === 'bank') {
      if (bank?.status === 'SETTLED') return { label: 'SETTLED BY BANK', class: 'SETTLED' }
      if (bank?.status === 'PENDING') return { label: 'IN-FLIGHT (PROCESSING)', class: 'PENDING' }
      if (bank?.status === 'REJECTED') return { label: 'BANK REJECTED', class: 'FAILED' }
      return { label: 'AWAITING BANK', class: 'PENDING' }
    }
    if (stage === 'confirmation') {
      if (resultData.final_status === 'SETTLED') return { label: 'PAYMENT CONFIRMED', class: 'SETTLED' }
      if (resultData.final_status === 'BANK_SETTLEMENT_PENDING') return { label: 'SETTLEMENT IN-PROGRESS', class: 'PENDING' }
      if (resultData.final_status === 'PAYMENT_FAILED') return { label: 'PAYMENT UNSUCCESSFUL', class: 'FAILED' }
      return { label: 'ACTION REQUIRED', class: 'EXCEPTION' }
    }
    return { label: 'UNKNOWN', class: 'PENDING' }
  }

  const getCustomerStatusExplanation = (status) => {
    switch (status) {
      case 'SETTLED':
        return 'Your payment has been successfully completed and reconciled.'
      case 'BANK_SETTLEMENT_PENDING':
        return 'Your payment was successful and is currently being processed by the bank.'
      case 'PAYMENT_PENDING':
        return 'Your payment is still being processed. Please allow some time for confirmation.'
      case 'SETTLEMENT_EXCEPTION':
        return 'We found an issue while processing your payment settlement.'
      case 'PAYMENT_FAILED':
        return 'Your payment could not be completed successfully.'
      case 'INVESTIGATION_UNCERTAIN':
        return 'We found inconsistent transaction information and our support team may need to review it.'
      default:
        return 'Payment status update available.'
    }
  }

  const get3StageJourney = (resultData) => {
    if (!resultData) return []
    const st = resultData.final_status
    const gw = resultData.records?.gateway

    if (st === 'SETTLED') {
      return [
        { step: 1, title: 'Payment', statusLabel: 'Completed', statusClass: 'completed', icon: '✓', detail: 'Payment Authorized' },
        { step: 2, title: 'Bank Processing', statusLabel: 'Completed', statusClass: 'completed', icon: '✓', detail: 'Settled by Bank' },
        { step: 3, title: 'Confirmation', statusLabel: 'Completed', statusClass: 'completed', icon: '✓', detail: 'Reconciled & Confirmed' },
      ]
    }
    if (st === 'BANK_SETTLEMENT_PENDING') {
      return [
        { step: 1, title: 'Payment', statusLabel: 'Completed', statusClass: 'completed', icon: '✓', detail: 'Payment Authorized' },
        { step: 2, title: 'Bank Processing', statusLabel: 'In Progress', statusClass: 'in-progress', icon: '⏳', detail: 'Bank Processing (SLA: 48 hrs)' },
        { step: 3, title: 'Confirmation', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Pending Bank Clearance' },
      ]
    }
    if (st === 'PAYMENT_PENDING') {
      return [
        { step: 1, title: 'Payment', statusLabel: 'In Progress', statusClass: 'in-progress', icon: '⏳', detail: 'Authorization In Progress' },
        { step: 2, title: 'Bank Processing', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Pending Authorization' },
        { step: 3, title: 'Confirmation', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Pending' },
      ]
    }
    if (st === 'PAYMENT_FAILED') {
      return [
        { step: 1, title: 'Payment', statusLabel: 'Issue Detected', statusClass: 'issue', icon: '❌', detail: gw?.failure_reason ? `Failed: ${gw.failure_reason}` : 'Payment Failed' },
        { step: 2, title: 'Bank Processing', statusLabel: 'Not Started', statusClass: 'waiting', icon: '⚪', detail: 'Cancelled' },
        { step: 3, title: 'Confirmation', statusLabel: 'Not Completed', statusClass: 'waiting', icon: '⚪', detail: 'Unsuccessful' },
      ]
    }
    if (st === 'SETTLEMENT_EXCEPTION') {
      const isGwFailed = gw?.status === 'FAILED'
      return [
        { step: 1, title: 'Payment', statusLabel: isGwFailed ? 'Issue Detected' : 'Completed', statusClass: isGwFailed ? 'issue' : 'completed', icon: isGwFailed ? '❌' : '✓', detail: isGwFailed ? 'Authorization Issue' : 'Payment Authorized' },
        { step: 2, title: 'Bank Processing', statusLabel: 'Issue Detected', statusClass: 'issue', icon: '⚠️', detail: 'Settlement Exception Flagged' },
        { step: 3, title: 'Confirmation', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Under Support Review' },
      ]
    }
    if (st === 'INVESTIGATION_UNCERTAIN') {
      return [
        { step: 1, title: 'Payment', statusLabel: 'Completed', statusClass: 'completed', icon: '✓', detail: 'Payment Authorized' },
        { step: 2, title: 'Bank Processing', statusLabel: 'Issue Detected', statusClass: 'issue', icon: '⚠️', detail: 'Conflicting Data Records' },
        { step: 3, title: 'Confirmation', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Support Review Required' },
      ]
    }

    return [
      { step: 1, title: 'Payment', statusLabel: 'Processing', statusClass: 'in-progress', icon: '⏳', detail: 'Checking status' },
      { step: 2, title: 'Bank Processing', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Pending' },
      { step: 3, title: 'Confirmation', statusLabel: 'Waiting', statusClass: 'waiting', icon: '⚪', detail: 'Pending' },
    ]
  }

  const renderOpsSupportRequestsPanel = () => {
    if (!isOpsStaff) return null
    return (
      <div id="ops-support-panel" className="ops-support-panel">
        <div className="ops-support-header">
          <div className="ops-support-title">
            📥 Incoming Customer Support Requests
            <span className="total-badge">{opsSupportRequests.length} Requests</span>
          </div>
          <button
            type="button"
            className="refresh-btn"
            onClick={() => fetchOpsSupportRequests(user)}
          >
            🔄 Refresh
          </button>
        </div>

        {opsSupportRequests.length > 0 ? (
          <div className="ops-support-grid">
            {opsSupportRequests.map((req) => (
              <div key={req.request_id} className="ops-support-card">
                <div className="ops-req-top">
                  <span className="ops-req-id">{req.request_id}</span>
                  <span className="ops-req-tid">{req.transaction_id}</span>
                  <span className={`case-status-pill case-status-new`}>{req.status}</span>
                </div>
                <div className="ops-req-customer">
                  👤 <strong>{req.customer_name}</strong> ({req.customer_email})
                </div>
                <div className="ops-req-cat">
                  📌 <strong>Category:</strong> {req.issue_category}
                </div>
                {req.message && (
                  <div className="ops-req-msg">
                    "{req.message}"
                  </div>
                )}
                <div className="ops-req-bottom">
                  <span className="ops-req-time">
                    ⏱️ {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    type="button"
                    className="investigate-req-btn"
                    onClick={() => {
                      handleTxnSelect(req.transaction_id)
                      scrollToResults()
                    }}
                  >
                    🔍 Investigate Transaction
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-ops-support-msg">
            No incoming customer support requests. All clear!
          </div>
        )}
      </div>
    )
  }

  const renderOperationsCommandCenter = () => {
    if (!isOpsStaff || !dashboardData) return null

    const maxExcCount = dashboardData.exception_distribution && dashboardData.exception_distribution.length > 0
      ? Math.max(...dashboardData.exception_distribution.map(e => e.count))
      : 1

    return (
      <section className="command-center-section">
        {/* Title & Header */}
        <div className="command-center-header">
          <div className="cc-title-group">
            <span className="cc-badge">COMMAND CENTER</span>
            <h2 className="cc-title">Settlement Operations Overview</h2>
            <p className="cc-subtitle">
              Real-time reconciliation intelligence across payment gateway, bank settlement, and internal ledger systems. <span className="dataset-tag">(Mock/Demo Dataset)</span>
            </p>
          </div>

          {/* System Health Status */}
          <div className={`health-status-box health-${dashboardData.overall_health?.toLowerCase() || 'healthy'}`}>
            <div className="health-status-top">
              <span className="health-dot" />
              <span className="health-label">SYSTEM HEALTH: {dashboardData.overall_health?.replace('_', ' ')}</span>
            </div>
            <p className="health-summary-text">{dashboardData.health_summary}</p>
          </div>
        </div>

        {/* KEY METRICS GRID */}
        <div className="cc-metrics-grid">
          <div className="cc-metric-card neutral">
            <span className="metric-label">TOTAL TRANSACTIONS</span>
            <span className="metric-val">{dashboardData.total_transactions}</span>
            <span className="metric-sub">Dataset transactions</span>
          </div>

          <div className="cc-metric-card success">
            <span className="metric-label">SUCCESSFULLY SETTLED</span>
            <span className="metric-val">{dashboardData.settled_count}</span>
            <span className="metric-sub">100% Reconciled</span>
          </div>

          <div
            className="cc-metric-card warning clickable"
            onClick={() => scrollToSection('priority-queue-section')}
            title="Click to view Priority Queue"
          >
            <span className="metric-label">ACTIVE EXCEPTIONS 🔗</span>
            <span className="metric-val">{dashboardData.active_investigations}</span>
            <span className="metric-sub">Exceptions & Uncertain</span>
          </div>

          <div className="cc-metric-card pending">
            <span className="metric-label">PENDING CLEARING</span>
            <span className="metric-val">{dashboardData.pending_count}</span>
            <span className="metric-sub">In-Flight / Gateway Pending</span>
          </div>

          <div
            className="cc-metric-card critical clickable"
            onClick={() => scrollToSection('priority-queue-section')}
            title="Click to view Priority Queue"
          >
            <span className="metric-label">HIGH PRIORITY CASES 🔗</span>
            <span className="metric-val">{dashboardData.high_priority_count}</span>
            <span className="metric-sub">High & Critical Priority</span>
          </div>

          <div
            className="cc-metric-card support clickable"
            onClick={() => scrollToSection('ops-support-panel')}
            title="Click to view Support Requests"
          >
            <span className="metric-label">OPEN SUPPORT REQUESTS 🔗</span>
            <span className="metric-val">{dashboardData.open_support_requests_count}</span>
            <span className="metric-sub">Incoming Customer Tickets</span>
          </div>
        </div>

        {/* 3-COLUMN SYSTEM HEALTH PANEL */}
        {dashboardData.system_breakdown && (
          <div className="system-health-panel">
            <div className="sh-panel-header">
              <h4>System Health & Component Breakdown</h4>
            </div>

            <div className="sh-columns-grid">
              {/* Payment Gateway */}
              <div className="sh-column">
                <div className="sh-col-header">
                  <span className="sh-col-title">Payment Gateway</span>
                  <span className={`sh-status-pill ${dashboardData.system_breakdown.gateway?.status}`}>
                    {dashboardData.system_breakdown.gateway?.status === 'HEALTHY' ? '🟢 HEALTHY' : '⚠️ ATTENTION'}
                  </span>
                </div>
                <div className="sh-col-metrics">
                  <div className="sh-metric-row green">
                    <span>✓ Authorized</span>
                    <strong>{dashboardData.system_breakdown.gateway?.healthy_count}</strong>
                  </div>
                  <div className="sh-metric-row red">
                    <span>⚠ Failures / Missing</span>
                    <strong>{dashboardData.system_breakdown.gateway?.problem_count}</strong>
                  </div>
                </div>
                <p className="sh-col-insight">{dashboardData.system_breakdown.gateway?.insight}</p>
              </div>

              {/* Bank Settlement */}
              <div className="sh-column">
                <div className="sh-col-header">
                  <span className="sh-col-title">Bank Settlement</span>
                  <span className={`sh-status-pill ${dashboardData.system_breakdown.bank?.status}`}>
                    {dashboardData.system_breakdown.bank?.status === 'HEALTHY' ? '🟢 HEALTHY' : '⚠️ ATTENTION'}
                  </span>
                </div>
                <div className="sh-col-metrics">
                  <div className="sh-metric-row green">
                    <span>✓ Settled</span>
                    <strong>{dashboardData.system_breakdown.bank?.settled_count}</strong>
                  </div>
                  <div className="sh-metric-row amber">
                    <span>⏳ Pending In-Flight</span>
                    <strong>{dashboardData.system_breakdown.bank?.pending_count}</strong>
                  </div>
                  <div className="sh-metric-row red">
                    <span>⚠ Exceptions / SLA</span>
                    <strong>{dashboardData.system_breakdown.bank?.exception_count}</strong>
                  </div>
                </div>
                <p className="sh-col-insight">{dashboardData.system_breakdown.bank?.insight}</p>
              </div>

              {/* Internal Ledger */}
              <div className="sh-column">
                <div className="sh-col-header">
                  <span className="sh-col-title">Internal Ledger</span>
                  <span className={`sh-status-pill ${dashboardData.system_breakdown.ledger?.status}`}>
                    {dashboardData.system_breakdown.ledger?.status === 'HEALTHY' ? '🟢 HEALTHY' : '⚠️ ATTENTION'}
                  </span>
                </div>
                <div className="sh-col-metrics">
                  <div className="sh-metric-row green">
                    <span>✓ Successfully Posted</span>
                    <strong>{dashboardData.system_breakdown.ledger?.recorded_count}</strong>
                  </div>
                  <div className="sh-metric-row red">
                    <span>⚠ Missing / Mismatched</span>
                    <strong>{dashboardData.system_breakdown.ledger?.mismatched_or_missing_count}</strong>
                  </div>
                </div>
                <p className="sh-col-insight">{dashboardData.system_breakdown.ledger?.insight}</p>
              </div>
            </div>
          </div>
        )}

        {/* RECONCILIATION PERFORMANCE & EXCEPTION LANDSCAPE ROW */}
        <div className="cc-secondary-grid">
          {/* Reconciliation Performance Card */}
          <div className="cc-sec-card recon-card">
            <h4>Reconciliation Performance</h4>
            <div className="recon-rate-box">
              <span className="recon-percentage">{dashboardData.reconciliation_rate}%</span>
              <span className="recon-sub">Overall Settlement Success Rate</span>
            </div>

            <div className="recon-bar-container">
              <div
                className="recon-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, dashboardData.reconciliation_rate))}%` }}
              />
            </div>

            <div className="recon-summary-text">
              <strong>{dashboardData.settled_count}</strong> of <strong>{dashboardData.total_transactions}</strong> transactions reconciled successfully
            </div>
          </div>

          {/* Exception Landscape Card */}
          <div className="cc-sec-card landscape-card">
            <h4>Exception Landscape & Category Distribution</h4>

            {dashboardData.exception_distribution && dashboardData.exception_distribution.length > 0 ? (
              <div className="landscape-bars-list">
                {dashboardData.exception_distribution.map((item) => {
                  const pct = Math.round((item.count / maxExcCount) * 100)
                  return (
                    <div key={item.category} className="landscape-item">
                      <div className="landscape-item-header">
                        <span className="landscape-cat-name">{item.category}</span>
                        <span className="landscape-count-badge">{item.count}</span>
                      </div>
                      <div className="landscape-bar-track">
                        <div className="landscape-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-landscape-msg">No active exceptions detected.</div>
            )}
          </div>
        </div>

        {/* PRIORITY QUEUE SECTION */}
        {dashboardData.priority_queue && dashboardData.priority_queue.length > 0 && (
          <div id="priority-queue-section" className="priority-queue-section">
            <div className="priority-queue-header">
              <span className="priority-queue-title">🔥 Priority Investigation Queue</span>
              <span className="priority-queue-subtitle">Highest-Risk Transactions Requiring Operational Focus</span>
            </div>
            <div className="priority-queue-grid">
              {dashboardData.priority_queue.map((item) => (
                <div
                  key={item.transaction_id}
                  className={`priority-queue-card priority-border-${item.priority.toLowerCase()}`}
                  style={{ pointerEvents: loading ? 'none' : 'auto', opacity: loading ? 0.7 : 1 }}
                  onClick={() => {
                    handleTxnSelect(item.transaction_id)
                    scrollToResults()
                  }}
                >
                  <div className="pq-card-top">
                    <span className={`priority-badge priority-badge-${item.priority.toLowerCase()}`}>
                      {item.priority === 'CRITICAL' ? '🚨' : item.priority === 'HIGH' ? '⚠️' : item.priority === 'MEDIUM' ? '⚡' : '🟢'} {item.priority} ({item.priority_score})
                    </span>
                    <span className="pq-card-tid">{item.transaction_id}</span>
                  </div>
                  <div className="pq-card-mid">
                    <span className={`recent-status-pill ${item.final_status}`}>{item.final_status}</span>
                    <span className="pq-card-amt">{item.currency} {item.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {item.reasons && item.reasons.length > 0 && (
                    <div className="pq-card-reason">
                      {item.reasons[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RECENT TRANSACTIONS */}
        {dashboardData.recent_transactions && dashboardData.recent_transactions.length > 0 && (
          <div className="recent-txns-section">
            <div className="recent-title">Quick Select Recent Transactions (Click to Investigate)</div>
            <div className="recent-cards-scroll">
              {dashboardData.recent_transactions.map((t) => (
                <div
                  key={t.transaction_id}
                  className="recent-txn-card"
                  style={{ pointerEvents: loading ? 'none' : 'auto', opacity: loading ? 0.7 : 1 }}
                  onClick={() => {
                    handleTxnSelect(t.transaction_id)
                    scrollToResults()
                  }}
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
    )
  }

  const renderCustomerPaymentsDashboard = () => {
    if (!isCustomer) return null
    return (
      <section className="my-payments-section">
        <div className="my-payments-header">
          <div>
            <h3 className="my-payments-title">💳 My Payments Dashboard</h3>
            <p className="my-payments-subtitle">
              Select a payment to view details, progress, or request support
            </p>
          </div>
        </div>

        <div className="my-payments-grid">
          {user?.allowed_transactions?.map((tid) => {
            const info = customerTxnsData.find((item) => item.transaction_id === tid)
            const isSelected = txnId === tid
            const status = info?.final_status || 'LOADING'
            const amtStr = info
              ? `${info.records?.gateway?.currency || info.records?.bank?.currency || 'INR'} ${(info.records?.gateway?.amount || info.records?.bank?.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
              : 'Loading...'

            return (
              <div
                key={tid}
                className={`my-payment-card ${isSelected ? 'active-payment-card' : ''}`}
                onClick={() => {
                  setTxnId(tid)
                  investigate(tid)
                  scrollToResults()
                }}
              >
                <div className="card-top-row">
                  <span className="card-tid-pill">{tid}</span>
                  <span className={`recent-status-pill ${status}`}>{status}</span>
                </div>
                <div className="card-amt-row">{amtStr}</div>
                <div className="card-desc-row">
                  {getCustomerStatusExplanation(status)}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  const renderDemoScenariosSection = () => {
    if (!isOpsStaff) return null
    return (
      <section className="demo-scenarios-section">
        <div className="demo-scenarios-header">
          <div className="demo-scenarios-title-group">
            <span className="demo-section-badge">🎯 HACKATHON DEMO MODE</span>
            <h3 className="demo-scenarios-title">Interactive Scenario Guide</h3>
            <p className="demo-scenarios-subtitle">
              Simulate key payment exception workflows and explore PayTrace's deterministic investigation engine.
            </p>
          </div>
          <button
            type="button"
            className="start-tour-btn"
            onClick={handleStartDemoTour}
            disabled={loading}
          >
            ▶️ Start Guided Demo Tour
          </button>
        </div>

        <div className="demo-scenarios-grid">
          {DEMO_SCENARIOS.map((scenario, index) => {
            const isSelected = activeScenarioId === scenario.id || (txnId === scenario.id && !activeScenarioId)
            const isTourCurrent = demoTourActive && demoTourStepIndex === index
            return (
              <div
                key={scenario.id}
                className={`demo-scenario-card ${isSelected || isTourCurrent ? 'active-scenario' : ''}`}
                onClick={() => {
                  if (demoTourActive) {
                    setDemoTourStepIndex(index)
                  }
                  handleSelectScenario(scenario.id)
                }}
              >
                <div className="scenario-card-top">
                  <div className="scenario-card-title">
                    <span className="scenario-icon">{scenario.icon}</span>
                    <span className="scenario-name">{scenario.name}</span>
                  </div>
                  <span className={`scenario-badge ${scenario.badgeClass}`}>
                    {scenario.badge}
                  </span>
                </div>

                <div className="scenario-card-id-row">
                  <span className="scenario-tid-pill">{scenario.id}</span>
                  {isTourCurrent && <span className="tour-current-pill">📍 Tour Step {index + 1}</span>}
                </div>

                <p className="scenario-desc">{scenario.description}</p>

                <div className="scenario-highlight">
                  <span className="highlight-tag">KEY FINDING</span>
                  <span>{scenario.highlight}</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  const renderDemoTourBanner = () => {
    if (!isOpsStaff) return null

    if (demoTourActive) {
      const currentScenario = DEMO_SCENARIOS[demoTourStepIndex]
      const nextScenario = demoTourStepIndex < DEMO_SCENARIOS.length - 1 ? DEMO_SCENARIOS[demoTourStepIndex + 1] : null

      return (
        <div className="demo-tour-banner">
          <div className="tour-banner-left">
            <div className="tour-banner-header">
              <span className="tour-badge">🎯 PAYTRACE GUIDED DEMO</span>
              <span className="tour-step-counter">Scenario {demoTourStepIndex + 1} of {DEMO_SCENARIOS.length}</span>
            </div>
            <div className="tour-scenario-title">
              <span className="tour-icon">{currentScenario.icon}</span>
              <h3>{currentScenario.name} <span className="tour-tid">({currentScenario.id})</span></h3>
              <span className={`scenario-badge ${currentScenario.badgeClass}`}>{currentScenario.badge}</span>
            </div>
            <p className="tour-scenario-desc">{currentScenario.description}</p>
            <div className="tour-scenario-highlight">
              <strong>Expected Operational Finding:</strong> {currentScenario.highlight}
            </div>
          </div>

          <div className="tour-banner-controls">
            <button
              type="button"
              className="tour-ctrl-btn prev"
              onClick={handleDemoTourPrev}
              disabled={demoTourStepIndex === 0 || loading}
            >
              ⬅️ Previous
            </button>

            <button
              type="button"
              className="tour-ctrl-btn next"
              onClick={handleDemoTourNext}
              disabled={loading}
            >
              {nextScenario ? `Next: ${nextScenario.name} ➡️` : 'Finish Tour 🎉'}
            </button>

            <button
              type="button"
              className="tour-ctrl-btn exit"
              onClick={handleExitDemoTour}
            >
              ✖ Exit Tour
            </button>
          </div>
        </div>
      )
    }

    if (activeScenarioId && !demoTourActive) {
      const scenario = DEMO_SCENARIOS.find(s => s.id === activeScenarioId)
      if (!scenario) return null
      return (
        <div className="active-scenario-bar">
          <div className="active-scenario-info">
            <span className="active-scenario-icon">{scenario.icon}</span>
            <span>Currently Exploring Demo Scenario: <strong>{scenario.name}</strong> ({scenario.id})</span>
            <span className={`scenario-badge ${scenario.badgeClass}`}>{scenario.badge}</span>
          </div>
          <button
            type="button"
            className="exit-scenario-btn"
            onClick={() => setActiveScenarioId(null)}
          >
            Clear Selection ✖
          </button>
        </div>
      )
    }

    return null
  }

  const renderCaseManagementPanel = () => {
    if (!isOpsStaff) return null
    return (
      <section className="case-management-panel">
        <div className="case-mgmt-header">
          <div className="case-title-group">
            <span className="case-mgmt-tag">CASE LIFECYCLE MANAGEMENT</span>
            <span className={`case-status-pill case-status-${caseData?.case_status?.toLowerCase() || 'new'}`}>
              {caseData?.case_status === 'NEW' ? '🔵 NEW' : caseData?.case_status === 'INVESTIGATING' ? '🟠 INVESTIGATING' : '🟢 RESOLVED'}
            </span>
          </div>
          <div className="case-meta-group">
            <span className="case-assignee-text">
              👤 Assigned: <strong>{caseData?.assigned_to || 'Unassigned'}</strong>
            </span>
            {caseData?.updated_at && (
              <span className="case-updated-text">
                ⏱️ Updated: {new Date(caseData.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {caseError && <div className="case-error-banner">⚠️ {caseError}</div>}

        {/* Actions Toolbar */}
        <div className="case-actions-toolbar">
          <div className="status-transition-actions">
            {caseData?.case_status === 'NEW' && (
              <button
                type="button"
                className="case-btn action-start-btn"
                disabled={caseActionLoading}
                onClick={() => handleUpdateCaseStatus('INVESTIGATING')}
              >
                {caseActionLoading ? 'Saving...' : '▶ Start Investigation'}
              </button>
            )}

            {caseData?.case_status === 'INVESTIGATING' && (
              <button
                type="button"
                className="case-btn action-resolve-btn"
                disabled={caseActionLoading}
                onClick={() => handleUpdateCaseStatus('RESOLVED')}
              >
                {caseActionLoading ? 'Saving...' : '✓ Mark as Resolved'}
              </button>
            )}

            {caseData?.case_status === 'RESOLVED' && (
              <button
                type="button"
                className="case-btn action-reopen-btn"
                disabled={caseActionLoading}
                onClick={() => handleUpdateCaseStatus('INVESTIGATING')}
              >
                {caseActionLoading ? 'Saving...' : '🔄 Reopen Case'}
              </button>
            )}

            <button
              type="button"
              className="case-btn action-assign-btn"
              disabled={caseActionLoading || caseData?.assigned_to === user?.name}
              onClick={handleAssignCase}
            >
              {caseData?.assigned_to === user?.name ? '✓ Assigned to You' : '👤 Assign to Me'}
            </button>
          </div>
        </div>

        {/* Case Notes & Activity Grid */}
        <div className="case-details-grid">
          {/* Notes Section */}
          <div className="case-notes-column">
            <div className="column-header-title">📝 Investigation Notes ({caseData?.notes?.length || 0})</div>
            <form onSubmit={handleAddCaseNote} className="note-input-form">
              <textarea
                className="note-textarea"
                placeholder="Add investigation note..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                disabled={caseActionLoading}
                rows={2}
              />
              <button
                type="submit"
                className="add-note-btn"
                disabled={caseActionLoading || !noteInput.trim()}
              >
                {caseActionLoading ? 'Adding...' : 'Add Note'}
              </button>
            </form>

            <div className="notes-list-scroll">
              {caseData?.notes && caseData.notes.length > 0 ? (
                caseData.notes.slice().reverse().map((note) => (
                  <div key={note.id} className="case-note-card">
                    <div className="note-card-header">
                      <span className="note-author">{note.author}</span>
                      <span className="note-time">
                        {new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="note-body-text">{note.message}</div>
                  </div>
                ))
              ) : (
                <div className="empty-notes-msg">No notes added yet for this case.</div>
              )}
            </div>
          </div>

          {/* Activity Timeline Column */}
          <div className="case-activity-column">
            <div className="column-header-title">📜 Case Activity Timeline</div>
            <div className="activity-list-scroll">
              {caseData?.activity && caseData.activity.length > 0 ? (
                caseData.activity.slice().reverse().map((act, idx) => (
                  <div key={idx} className="activity-item-row">
                    <span className="act-dot"></span>
                    <div className="act-content">
                      <div className="act-top">
                        <span className="act-details">{act.details}</span>
                        <span className="act-time">
                          {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span className="act-actor">By: {act.actor}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-notes-msg">No activity recorded.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="app-container">
      {/* Top Navigation Header */}
      <header className="app-header">
        <div className="brand-section">
          <span className="logo-text">PayTrace</span>
          <span className="subtitle">
            {isCustomer ? 'My Payment Status Portal' : 'Settlement Investigation & Support Engine'}
          </span>
        </div>
        <div className="header-meta">
          <div className={`role-user-badge ${isCustomer ? 'customer-badge' : 'ops-badge'}`}>
            <span className="user-icon">{isCustomer ? '👤' : '🛡️'}</span>
            <div className="user-info-text">
              <span className="user-name-str">{user.name}</span>
              <span className="user-role-str">{isCustomer ? 'Customer' : 'Operations Staff'}</span>
            </div>
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            Logout 🚪
          </button>
        </div>
      </header>

      {/* OPERATIONS ONLY: Support Dashboard */}
      {/* OPERATIONS ONLY: Support Dashboard / Command Center */}
      {isOpsStaff && (
        <>
          {dashboardError ? (
            <div className="dashboard-error-banner">{dashboardError}</div>
          ) : (
            renderOperationsCommandCenter()
          )}

          {/* Interactive Demo Scenarios Section */}
          {renderDemoScenariosSection()}

          {/* Incoming Customer Support Requests Panel */}
          {renderOpsSupportRequestsPanel()}
        </>
      )}

      {/* CUSTOMER ONLY: My Payments Dashboard */}
      {isCustomer && renderCustomerPaymentsDashboard()}

      {/* Hero / Search Section */}
      <section className="search-hero">
        <h2>{isCustomer ? 'Track Your Payment' : 'Investigate a Transaction'}</h2>
        <p>
          {isCustomer
            ? 'Select or enter your Transaction Reference ID below to view payment progress and settlement details.'
            : 'Enter a transaction ID to perform real-time cross-system reconciliation across Gateway, Bank, and Internal Ledger records.'}
        </p>

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
            {loading ? 'Searching...' : isCustomer ? 'Check Status' : 'Investigate'}
          </button>
        </form>

        <div className="sample-chips">
          <span className="chips-label">{isCustomer ? 'My Transactions:' : 'Quick Load Scenario:'}</span>
          {(isCustomer ? CUSTOMER_TXNS : EXAMPLE_TXNS).map((item) => (
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
              <span>{isCustomer ? 'Checking Payment Details...' : 'Executing Cross-System Investigation...'}</span>
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
            <h3>{isCustomer ? 'Select a Transaction to View Status' : 'Ready for Settlement Investigation'}</h3>
            <p>
              {isCustomer
                ? 'Choose one of your registered transactions above to check settlement status.'
                : 'Enter a Transaction ID above or click any sample scenario to initiate real-time three-way reconciliation.'}
            </p>
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
                {error.includes('Access Denied')
                  ? 'Access Restricted'
                  : error.includes('not found')
                  ? 'Transaction Not Found'
                  : 'Backend Service Unavailable'}
              </h3>
            </div>
            <span className="error-target-pill">Target ID: {txnId}</span>
          </div>

          <div className="error-body">
            <p className="error-desc-text">{error}</p>

            <div className="error-action-hint">
              <span className="hint-label">Suggested Resolution:</span>
              <p>
                {error.includes('Access Denied')
                  ? 'You only have permission to view your assigned transactions (TXN_1001, TXN_1005, TXN_1006). Please select one of these IDs.'
                  : error.includes('not found')
                  ? 'Please verify the Transaction ID spelling or select one of the sample scenarios above.'
                  : `Ensure the FastAPI backend server is running on ${API_BASE}.`}
              </p>
            </div>

            <div className="error-actions-row">
              <button type="button" className="retry-btn" onClick={() => investigate(txnId)}>
                🔄 Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER PORTAL VIEW */}
      {!loading && result && isCustomer && (
        <main className="customer-portal-results">
          {/* Status Hero Banner */}
          <div className={`status-hero ${result.final_status}`}>
            <div className="status-main">
              <span className="status-label">PAYMENT STATUS</span>
              <div className="status-value-group">
                <span className="status-icon">{getStatusIcon(result.final_status)}</span>
                <span className="status-value">{result.final_status}</span>
              </div>
              <p className="customer-explanation-text">
                {getCustomerStatusExplanation(result.final_status)}
              </p>
            </div>
            <div className="status-meta">
              <div className="meta-tid-group">
                <span className="meta-label">Transaction ID</span>
                <span className="txn-id-pill">{result.transaction_id}</span>
              </div>
              <div className="meta-amt-group">
                <span className="meta-label">Amount</span>
                <span className="txn-amt-val">
                  {result.records?.gateway?.currency || result.records?.bank?.currency || 'INR'}{' '}
                  {(result.records?.gateway?.amount || result.records?.bank?.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* 3-Stage Visual Journey */}
          <section className="customer-journey-section">
            <h3 className="customer-section-title">Payment Progress Journey</h3>
            <div className="customer-journey-grid">
              {get3StageJourney(result).map((stg) => (
                <div key={stg.step} className={`journey-card journey-${stg.statusClass}`}>
                  <div className="journey-header">
                    <span className="journey-step-num">{stg.step}</span>
                    <span className="journey-step-title">{stg.title}</span>
                  </div>
                  <div className="journey-body">
                    <span className={`journey-status-pill ${stg.statusClass}`}>
                      {stg.icon} {stg.statusLabel}
                    </span>
                    <div className="journey-detail">{stg.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Customer Explanation & Next Steps */}
          <section className="customer-summary-section">
            <div className="verified-summary-box">
              <div className="summary-header">
                <h3>Transaction Details Summary</h3>
                <span className="trust-indicator">🛡️ Verified PayTrace Update</span>
              </div>
              <p className="summary-text">{generateVerifiedSummary(result)}</p>
            </div>

            {result.recommended_action && (
              <div className="recommended-action-box">
                <div className="action-icon">🎯</div>
                <div className="action-content">
                  <h4>What happens next?</h4>
                  <p>{result.recommended_action}</p>
                </div>
              </div>
            )}
          </section>

          {/* Need Help? Support Request Section */}
          <section className="customer-support-section">
            <div className="support-header-bar">
              <div>
                <h3>💬 Need Help with this Payment?</h3>
                <p>If you suspect an issue or have a question, submit a direct support ticket to our operations team.</p>
              </div>
              <button
                type="button"
                className="toggle-support-btn"
                onClick={() => setSupportFormOpen(!supportFormOpen)}
              >
                {supportFormOpen ? 'Cancel Request ✖' : 'Request Support 💬'}
              </button>
            </div>

            {supportSuccess && <div className="support-success-banner">✓ {supportSuccess}</div>}
            {supportError && <div className="support-error-banner">⚠️ {supportError}</div>}

            {supportFormOpen && (
              <form onSubmit={handleSubmitSupportRequest} className="support-request-form">
                <div className="form-group">
                  <label>Transaction Reference ID (Read-only)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={result.transaction_id}
                    disabled
                  />
                </div>

                <div className="form-group">
                  <label>Issue Category *</label>
                  <select
                    className="form-control"
                    value={supportCategory}
                    onChange={(e) => setSupportCategory(e.target.value)}
                    required
                  >
                    <option value="Payment Not Completed">Payment Not Completed</option>
                    <option value="Settlement Taking Too Long">Settlement Taking Too Long</option>
                    <option value="Incorrect Amount">Incorrect Amount</option>
                    <option value="Transaction Information Issue">Transaction Information Issue</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Message / Details (Optional)</label>
                  <textarea
                    className="form-control textarea"
                    placeholder="Explain your issue or question..."
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    rows={3}
                  />
                </div>

                <button type="submit" className="submit-support-btn" disabled={supportSubmitting}>
                  {supportSubmitting ? 'Submitting...' : 'Submit Support Request'}
                </button>
              </form>
            )}

            {/* My Support Requests History */}
            {mySupportRequests.length > 0 && (
              <div className="my-requests-history">
                <h4 className="my-reqs-title">📋 My Support Tickets ({mySupportRequests.length})</h4>
                <div className="my-reqs-list">
                  {mySupportRequests.slice().reverse().map((req) => (
                    <div key={req.request_id} className="my-req-card">
                      <div className="my-req-top">
                        <span className="my-req-id">{req.request_id}</span>
                        <span className="my-req-tid">{req.transaction_id}</span>
                        <span className={`case-status-pill case-status-new`}>{req.status}</span>
                      </div>
                      <div className="my-req-cat"><strong>Category:</strong> {req.issue_category}</div>
                      {req.message && <div className="my-req-msg">"{req.message}"</div>}
                      <div className="my-req-time">
                        Submitted: {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {/* OPERATIONS STAFF PORTAL VIEW */}
      {!loading && result && isOpsStaff && (
        <main className="results-container">
          {/* Demo Tour Banner */}
          {renderDemoTourBanner()}

          {/* Header with Mode Toggle */}
          <div className="results-dossier-header">
            <div className="dossier-title-group">
              <span className="dossier-badge">RECONCILIATION DOSSIER</span>
              <span className="dossier-subtext">Active Investigation Results</span>
            </div>

            <div className="guided-toggle-control">
              <span className="guided-toggle-label">View Mode:</span>
              <div className="toggle-pill-group">
                <button
                  type="button"
                  className={`toggle-pill-btn ${!guidedMode ? 'active' : ''}`}
                  onClick={() => setGuidedMode(false)}
                >
                  Full Dossier
                </button>
                <button
                  type="button"
                  className={`toggle-pill-btn ${guidedMode ? 'active' : ''}`}
                  onClick={() => setGuidedMode(true)}
                >
                  Guided Mode
                </button>
              </div>
            </div>
          </div>

          {/* GUIDED MODE WORKSPACE */}
          {guidedMode ? (
            <div className="guided-workspace-wrapper">
              {/* Case Context Bar */}
              <div className="case-context-bar">
                <div className="ctx-item">
                  <span className="ctx-label">CASE:</span>
                  <span className="ctx-val txn-id">{result.transaction_id}</span>
                </div>
                <div className="ctx-item">
                  <span className="ctx-label">STATUS:</span>
                  <span className={`ctx-val status-badge ${result.final_status}`}>{result.final_status}</span>
                </div>
                <div className="ctx-item">
                  <span className="ctx-label">CONFIDENCE:</span>
                  <span className={`ctx-val confidence-badge ${result.confidence}`}>{result.confidence}</span>
                </div>
                <div className="ctx-item">
                  <span className="ctx-label">EXCEPTIONS:</span>
                  <span className="ctx-val exceptions-pill">{result.exceptions?.length || 0}</span>
                </div>
                {result.priority_assessment && (
                  <div className="ctx-item">
                    <span className="ctx-label">PRIORITY:</span>
                    <span className={`ctx-val priority-badge priority-badge-${result.priority_assessment.priority.toLowerCase()}`}>
                      {result.priority_assessment.priority} ({result.priority_assessment.priority_score})
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Indicator */}
              <div className="guided-progress-container">
                <div className="guided-progress-header">
                  <span className="progress-sub-title">INVESTIGATION PROGRESS</span>
                  <span className="progress-step-counter">
                    STEP {guidedStep} OF 6 — {
                      guidedStep === 1 ? 'Executive Summary' :
                      guidedStep === 2 ? 'System Records' :
                      guidedStep === 3 ? 'Financial Reconciliation' :
                      guidedStep === 4 ? 'Root Cause' :
                      guidedStep === 5 ? 'Decision Trace' : 'Audit Timeline'
                    }
                  </span>
                </div>

                <div className="progress-stepper-bar">
                  {[
                    { step: 1, label: '01 Overview' },
                    { step: 2, label: '02 Records' },
                    { step: 3, label: '03 Reconciliation' },
                    { step: 4, label: '04 Root Cause' },
                    { step: 5, label: '05 Decision' },
                    { step: 6, label: '06 Timeline' },
                  ].map((s) => (
                    <button
                      key={s.step}
                      type="button"
                      className={`progress-step-btn ${
                        guidedStep === s.step
                          ? 'active'
                          : guidedStep > s.step
                          ? 'completed'
                          : 'future'
                      }`}
                      onClick={() => setGuidedStep(s.step)}
                    >
                      <span className="step-indicator">
                        {guidedStep > s.step ? '✓' : s.step}
                      </span>
                      <span className="step-btn-text">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Step Workspace */}
              <div key={guidedStep} className="guided-active-workspace fade-in-step">
                {guidedStep === 1 && (
                  <section className="executive-summary-section">
                    <div className={`status-hero-mini status-hero ${result.final_status}`}>
                      <div className="status-main">
                        <span className="status-label">FINAL RECONCILIATION STATUS</span>
                        <div className="status-value-group">
                          <span className="status-icon">{getStatusIcon(result.final_status)}</span>
                          <span className="status-value">{result.final_status}</span>
                        </div>
                      </div>
                      <div className="status-meta">
                        <span className={`confidence-badge ${result.confidence}`}>
                          {result.confidence === 'HIGH' ? '✓ ' : result.confidence === 'MEDIUM' ? '⚠️ ' : '🚨 '}
                          {result.confidence} Confidence
                        </span>
                        {result.priority_assessment && (
                          <span className={`priority-badge priority-badge-${result.priority_assessment.priority.toLowerCase()}`}>
                            {result.priority_assessment.priority === 'CRITICAL' ? '🚨' : result.priority_assessment.priority === 'HIGH' ? '⚠️' : result.priority_assessment.priority === 'MEDIUM' ? '⚡' : '🟢'} {result.priority_assessment.priority} ({result.priority_assessment.priority_score})
                          </span>
                        )}
                      </div>
                    </div>

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

                    {result.priority_assessment && (
                      <div className={`priority-assessment-box priority-border-${result.priority_assessment.priority.toLowerCase()}`}>
                        <div className="priority-box-header">
                          <span className="priority-box-title">🛡️ Priority Assessment Justification</span>
                          <span className={`priority-badge priority-badge-${result.priority_assessment.priority.toLowerCase()}`}>
                            {result.priority_assessment.priority} Priority — Score {result.priority_assessment.priority_score}/100
                          </span>
                        </div>
                        <ul className="priority-reasons-list">
                          {result.priority_assessment.reasons?.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

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

                    {renderCaseManagementPanel()}
                  </section>
                )}

                {guidedStep === 2 && (
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
                )}

                {guidedStep === 3 && (
                  <section className="financial-analysis-section">
                    <div className="section-header-block">
                      <span className="section-step-tag">03</span>
                      <div className="section-title-group">
                        <h3 className="section-title">Financial Variance Analysis</h3>
                        <span className="section-subtitle">Three-way amount and currency reconciliation</span>
                      </div>
                    </div>

                    {result.discrepancy_analysis ? (
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
                    ) : (
                      <div className="no-record-msg">Financial Reconciliation Analysis N/A</div>
                    )}
                  </section>
                )}

                {guidedStep === 4 && (
                  <section className="root-cause-section">
                    <div className="section-header-block">
                      <span className="section-step-tag">04</span>
                      <div className="section-title-group">
                        <h3 className="section-title">Root Cause & Operational Impact</h3>
                        <span className="section-subtitle">Deterministic failure diagnosis and operational action plan</span>
                      </div>
                    </div>

                    {result.root_cause_analysis ? (
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
                    ) : (
                      <div className="no-record-msg">Root Cause Analysis N/A</div>
                    )}
                  </section>
                )}

                {guidedStep === 5 && (
                  <section className="decision-trace-section">
                    <div className="section-header-block">
                      <span className="section-step-tag">05</span>
                      <div className="section-title-group">
                        <h3 className="section-title">Investigation Decision Trace</h3>
                        <span className="section-subtitle">Deterministic rule evaluation based on verified system records</span>
                      </div>
                    </div>

                    {result.rule_evaluation_trace && result.rule_evaluation_trace.length > 0 ? (
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
                    ) : (
                      <div className="no-record-msg">No Decision Trace available</div>
                    )}
                  </section>
                )}

                {guidedStep === 6 && (
                  <section className="timeline-section">
                    <div className="section-header-block">
                      <span className="section-step-tag">06</span>
                      <div className="section-title-group">
                        <h3 className="section-title">Visual Audit Timeline</h3>
                        <span className="section-subtitle">Sequential event progression across payment stages</span>
                      </div>
                    </div>

                    {result.timeline && result.timeline.length > 0 ? (
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
                    ) : (
                      <div className="no-record-msg">No Timeline events available</div>
                    )}
                  </section>
                )}
              </div>

              {/* Guided Step Navigation Footer Controls */}
              <div className="guided-step-nav-footer">
                <button
                  type="button"
                  className="guided-nav-btn prev-btn"
                  disabled={guidedStep === 1}
                  onClick={() => setGuidedStep((prev) => Math.max(1, prev - 1))}
                >
                  ← Previous
                </button>

                <span className="guided-nav-counter">
                  Step {guidedStep} of 6
                </span>

                {guidedStep < 6 ? (
                  <button
                    type="button"
                    className="guided-nav-btn next-btn"
                    onClick={() => setGuidedStep((prev) => Math.min(6, prev + 1))}
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="guided-nav-btn complete-btn"
                    onClick={() => setGuidedStep(1)}
                  >
                    ✓ Investigation Complete
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* FULL DOSSIER MODE (Existing Experience) */
            <>
              {/* Operations Sticky Bar */}
              <nav className="nav-sticky-bar">
                <div className="nav-sticky-content">
                  <span className="nav-label">Jump to Section:</span>
                  <button className="nav-link-btn" onClick={() => scrollToSection('overview')}>
                    01 Overview
                  </button>
                  <button className="nav-link-btn" onClick={() => scrollToSection('records')}>
                    02 Records
                  </button>
                  {result.discrepancy_analysis && (
                    <button className="nav-link-btn" onClick={() => scrollToSection('reconciliation')}>
                      03 Reconciliation
                    </button>
                  )}
                  {result.root_cause_analysis && (
                    <button className="nav-link-btn" onClick={() => scrollToSection('root-cause')}>
                      04 Root Cause
                    </button>
                  )}
                  {result.rule_evaluation_trace?.length > 0 && (
                    <button className="nav-link-btn" onClick={() => scrollToSection('decision-trace')}>
                      05 Decision Trace
                    </button>
                  )}
                  {result.timeline?.length > 0 && (
                    <button className="nav-link-btn" onClick={() => scrollToSection('timeline')}>
                      06 Timeline
                    </button>
                  )}
                </div>
              </nav>

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
                  {result.priority_assessment && (
                    <span className={`priority-badge priority-badge-${result.priority_assessment.priority.toLowerCase()}`}>
                      {result.priority_assessment.priority === 'CRITICAL' ? '🚨' : result.priority_assessment.priority === 'HIGH' ? '⚠️' : result.priority_assessment.priority === 'MEDIUM' ? '⚡' : '🟢'} {result.priority_assessment.priority} ({result.priority_assessment.priority_score})
                    </span>
                  )}
                </div>
              </div>

              {/* Executive Summary Block */}
              <section id="overview" className="executive-summary-section">
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

                {result.priority_assessment && (
                  <div className={`priority-assessment-box priority-border-${result.priority_assessment.priority.toLowerCase()}`}>
                    <div className="priority-box-header">
                      <span className="priority-box-title">🛡️ Priority Assessment Justification</span>
                      <span className={`priority-badge priority-badge-${result.priority_assessment.priority.toLowerCase()}`}>
                        {result.priority_assessment.priority} Priority — Score {result.priority_assessment.priority_score}/100
                      </span>
                    </div>
                    <ul className="priority-reasons-list">
                      {result.priority_assessment.reasons?.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

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

                {renderCaseManagementPanel()}

                <div className="next-section-bar">
                  <button className="next-section-btn" onClick={() => scrollToSection('records')}>
                    Next: System Record Trace ↓
                  </button>
                </div>
              </section>

              {/* System Trace Section */}
              <section id="records" className="system-trace-section">
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

                <div className="next-section-bar">
                  <button className="next-section-btn" onClick={() => scrollToSection('reconciliation')}>
                    Next: Financial Variance Analysis ↓
                  </button>
                </div>
              </section>

              {/* Financial Reconciliation Analysis Section */}
              {result.discrepancy_analysis && (
                <section id="reconciliation" className="financial-analysis-section">
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

                  <div className="next-section-bar">
                    <button className="next-section-btn" onClick={() => scrollToSection('root-cause')}>
                      Next: Root Cause Analysis ↓
                    </button>
                  </div>
                </section>
              )}

              {/* Root Cause & Operational Impact Section */}
              {result.root_cause_analysis && (
                <section id="root-cause" className="root-cause-section">
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

                  <div className="next-section-bar">
                    <button className="next-section-btn" onClick={() => scrollToSection('decision-trace')}>
                      Next: Decision Trace ↓
                    </button>
                  </div>
                </section>
              )}

              {/* Investigation Decision Trace Stepper */}
              {result.rule_evaluation_trace && result.rule_evaluation_trace.length > 0 && (
                <section id="decision-trace" className="decision-trace-section">
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

                  <div className="next-section-bar">
                    <button className="next-section-btn" onClick={() => scrollToSection('timeline')}>
                      Next: Audit Timeline ↓
                    </button>
                  </div>
                </section>
              )}

              {/* Investigation Timeline */}
              {result.timeline && result.timeline.length > 0 && (
                <section id="timeline" className="timeline-section">
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
            </>
          )}
        </main>
      )}
    </div>
  )
}

export default App

