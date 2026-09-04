# PayTrace — AI-powered Settlement Investigation & Support Agent

PayTrace is an intelligent settlement investigation and support platform designed to automate payment reconciliation across payment gateways, bank settlement files, and internal ledgers. By combining deterministic rule-based transaction tracing with AI-driven narrative synthesis, PayTrace rapidly detects settlement exceptions, pinpoints discrepancies (such as missing ledger postings, amount mismatches, and SLA breaches), and provides clear, actionable resolution steps for support and ops teams.

> **Disclaimer:** PayTrace currently operates strictly on internally generated mock data files for demonstration and testing purposes. It does not ingest, store, or process real financial transaction data or live banking records.

## Project Structure

```
PayTrace/
├── frontend/    # React (Vite + JavaScript) user interface
├── backend/     # FastAPI service for transaction tracing and API endpoints
├── .gitignore
└── README.md
```

## Running the Project

### Backend Setup (FastAPI)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Backend health check: `http://localhost:8000/health`

### Frontend Setup (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Frontend development app: `http://localhost:5173`
