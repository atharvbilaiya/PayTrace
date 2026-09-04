from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from data_loader import get_all_transaction_ids
from investigator import investigate_transaction

app = FastAPI(
    title="PayTrace API",
    description="AI-powered Settlement Investigation & Support Agent API",
    version="0.1.0",
)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for hackathon simplicity
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/investigate/{transaction_id}")
def get_investigation(transaction_id: str):
    res = investigate_transaction(transaction_id)
    if not res:
        raise HTTPException(
            status_code=404,
            detail=f"Transaction ID '{transaction_id}' was not found in Gateway, Bank, or Ledger data."
        )
    return res


@app.get("/api/dashboard/summary")
def get_dashboard_summary():
    all_ids = get_all_transaction_ids()
    status_counts = {
        "SETTLED": 0,
        "BANK_SETTLEMENT_PENDING": 0,
        "PAYMENT_FAILED": 0,
        "PAYMENT_PENDING": 0,
        "SETTLEMENT_EXCEPTION": 0,
        "INVESTIGATION_UNCERTAIN": 0,
    }

    recent_list = []

    for tid in all_ids:
        inv = investigate_transaction(tid)
        if inv:
            st = inv["final_status"]
            if st in status_counts:
                status_counts[st] += 1
            else:
                status_counts[st] = 1

            gw = inv["records"]["gateway"] or {}
            bank = inv["records"]["bank"] or {}
            ledger = inv["records"]["ledger"] or {}

            amt = gw.get("amount") or bank.get("amount") or ledger.get("amount") or 0.0
            curr = gw.get("currency") or bank.get("currency") or ledger.get("currency") or "INR"
            timestamp = gw.get("payment_timestamp") or bank.get("settlement_timestamp") or ledger.get("recorded_at")

            recent_list.append(
                {
                    "transaction_id": tid,
                    "final_status": st,
                    "confidence": inv["confidence"],
                    "exceptions": inv["exceptions"],
                    "amount": amt,
                    "currency": curr,
                    "payment_timestamp": timestamp,
                }
            )

    return {
        "total_transactions": len(all_ids),
        "status_counts": status_counts,
        "recent_transactions": recent_list,
    }
