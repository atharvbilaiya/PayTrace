import os
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from data_loader import get_all_transaction_ids
from investigator import investigate_transaction

app = FastAPI(
    title="PayTrace API",
    description="AI-powered Settlement Investigation & Support Agent API",
    version="0.1.0",
)

# Configure CORS safely for deployment & local development
cors_origins_env = os.getenv("CORS_ORIGINS", "")
if cors_origins_env:
    origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MOCK_USERS = {
    "customer@paytrace.demo": {
        "password": "customer123",
        "name": "Alex Customer",
        "email": "customer@paytrace.demo",
        "role": "CUSTOMER",
        "allowed_transactions": ["TXN_1001", "TXN_1005", "TXN_1006"],
    },
    "ops@paytrace.demo": {
        "password": "ops123",
        "name": "Operations Staff",
        "email": "ops@paytrace.demo",
        "role": "OPERATIONS_STAFF",
        "allowed_transactions": None,
    },
}


import uuid
from datetime import datetime, timezone

CASES_DB = {}


class LoginRequest(BaseModel):
    email: str
    password: str


class StatusUpdateRequest(BaseModel):
    status: str


class NoteCreateRequest(BaseModel):
    message: str


class AssignRequest(BaseModel):
    assigned_to: Optional[str] = None


def get_current_iso_time() -> str:
    return datetime.now(timezone.utc).isoformat()


def verify_ops_staff(user_email: Optional[str]) -> dict:
    if not isinstance(user_email, str) or user_email.strip().lower() not in MOCK_USERS:
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: Valid Operations Staff credentials required."
        )
    user_info = MOCK_USERS[user_email.strip().lower()]
    if user_info["role"] != "OPERATIONS_STAFF":
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: Case management is restricted to Operations Staff."
        )
    return user_info


def get_or_create_case(transaction_id: str) -> dict:
    if transaction_id not in CASES_DB:
        now_str = get_current_iso_time()
        CASES_DB[transaction_id] = {
            "transaction_id": transaction_id,
            "case_status": "NEW",
            "assigned_to": None,
            "notes": [],
            "activity": [
                {
                    "action": "CASE_CREATED",
                    "actor": "System",
                    "timestamp": now_str,
                    "details": f"Case created for transaction {transaction_id}",
                }
            ],
            "created_at": now_str,
            "updated_at": now_str,
        }
    return CASES_DB[transaction_id]


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "PayTrace API"}


@app.post("/api/auth/login")
def login(req: LoginRequest):
    email_clean = req.email.strip().lower()
    if email_clean not in MOCK_USERS:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user_data = MOCK_USERS[email_clean]
    if user_data["password"] != req.password:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return {
        "status": "success",
        "user": {
            "email": email_clean,
            "name": user_data["name"],
            "role": user_data["role"],
            "allowed_transactions": user_data.get("allowed_transactions"),
        }
    }


@app.get("/api/investigate/{transaction_id}")
def get_investigation(
    transaction_id: str,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    # Role-based access validation if user_email is provided
    if isinstance(user_email, str) and user_email.strip().lower() in MOCK_USERS:
        u = MOCK_USERS[user_email.strip().lower()]
        if u["role"] == "CUSTOMER":
            if transaction_id not in u["allowed_transactions"]:
                raise HTTPException(
                    status_code=403,
                    detail=f"Access forbidden: Customer does not have access to transaction '{transaction_id}'."
                )

    res = investigate_transaction(transaction_id)
    if not res:
        raise HTTPException(
            status_code=404,
            detail=f"Transaction ID '{transaction_id}' was not found in Gateway, Bank, or Ledger data."
        )
    return res



@app.get("/api/dashboard/summary")
def get_dashboard_summary(
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    email_str = user_email if isinstance(user_email, str) else None
    if email_str and email_str.strip().lower() in MOCK_USERS:
        u = MOCK_USERS[email_str.strip().lower()]
        if u["role"] == "CUSTOMER":
            raise HTTPException(
                status_code=403,
                detail="Access forbidden: Customers are not permitted to access Operations Dashboard metrics."
            )

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
    priority_items = []

    settled_count = 0
    active_investigations = 0
    pending_count = 0
    failed_count = 0
    high_priority_count = 0

    gw_healthy = 0
    gw_problem = 0
    bank_settled = 0
    bank_pending = 0
    bank_exceptions = 0
    ledger_recorded = 0
    ledger_mismatched_or_missing = 0

    category_counts = {}

    EXCEPTION_LABEL_MAP = {
        "MISSING_LEDGER": "Missing Ledger",
        "AMOUNT_MISMATCH": "Amount Mismatch",
        "BANK_REJECTED": "Bank Rejected",
        "SLA_BREACH": "SLA Breach",
        "CONFLICTING_RECORDS": "Conflicting Records",
        "MISSING_GATEWAY_RECORD": "Missing Gateway Record",
        "PHANTOM_RECORD_CONFLICT": "Phantom Record Conflict",
    }

    has_critical_priority = False
    high_exception_severity_count = 0

    for tid in all_ids:
        inv = investigate_transaction(tid)
        if inv:
            st = inv["final_status"]
            if st in status_counts:
                status_counts[st] += 1
            else:
                status_counts[st] = 1

            if st == "SETTLED":
                settled_count += 1
            elif st in ["SETTLEMENT_EXCEPTION", "INVESTIGATION_UNCERTAIN"]:
                active_investigations += 1
            elif st in ["PAYMENT_PENDING", "BANK_SETTLEMENT_PENDING"]:
                pending_count += 1
            elif st == "PAYMENT_FAILED":
                failed_count += 1

            gw = inv["records"]["gateway"] or {}
            bank = inv["records"]["bank"] or {}
            ledger = inv["records"]["ledger"] or {}

            # Gateway Breakdown
            if gw.get("status") == "SUCCESS":
                gw_healthy += 1
            else:
                gw_problem += 1

            # Bank Breakdown
            if bank.get("status") == "SETTLED":
                bank_settled += 1
            elif bank.get("status") == "PENDING":
                bank_pending += 1
            else:
                bank_exceptions += 1

            # Ledger Breakdown
            has_missing_ledger = "MISSING_LEDGER" in inv["exceptions"]
            has_amount_mismatch = "AMOUNT_MISMATCH" in inv["exceptions"]
            if ledger and ledger.get("ledger_entry_id") and not (has_missing_ledger or has_amount_mismatch):
                ledger_recorded += 1
            else:
                ledger_mismatched_or_missing += 1

            # Exceptions Distribution
            for exc in inv.get("exceptions", []):
                cat_label = EXCEPTION_LABEL_MAP.get(exc, exc.replace("_", " ").title())
                category_counts[cat_label] = category_counts.get(cat_label, 0) + 1

            pa = inv.get("priority_assessment", {})
            p_level = pa.get("priority")
            if p_level in ["HIGH", "CRITICAL"]:
                high_priority_count += 1
            if p_level == "CRITICAL":
                has_critical_priority = True

            rc = inv.get("root_cause_analysis", {})
            if rc and rc.get("severity") == "HIGH":
                high_exception_severity_count += 1

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
                    "priority": pa.get("priority"),
                    "priority_score": pa.get("priority_score"),
                }
            )

            priority_items.append(
                {
                    "transaction_id": tid,
                    "final_status": st,
                    "priority": pa.get("priority"),
                    "priority_score": pa.get("priority_score"),
                    "reasons": pa.get("reasons", []),
                    "amount": amt,
                    "currency": curr,
                    "exceptions": inv["exceptions"],
                }
            )

    # Sort priority queue by priority_score DESC, tie-break transaction_id ASC
    priority_items.sort(key=lambda x: (- (x["priority_score"] or 0), x["transaction_id"]))
    priority_queue = priority_items[:5]

    total_count = len(all_ids)
    reconciliation_rate = round((settled_count / total_count) * 100, 1) if total_count > 0 else 0.0

    # Count open cases
    open_cases_count = 0
    for tid in all_ids:
        c = CASES_DB.get(tid)
        c_status = c["case_status"] if c else "NEW"
        if c_status in ["NEW", "INVESTIGATING"]:
            open_cases_count += 1

    # Count open support requests
    open_support_requests_count = sum(1 for r in SUPPORT_REQUESTS if r.get("status") == "OPEN")

    # System Health Determination
    if has_critical_priority or high_exception_severity_count >= 2:
        overall_health = "CRITICAL"
        health_summary = "Critical data integrity conflicts and high-severity exceptions detected requiring immediate operational intervention."
    elif active_investigations > 0 or pending_count > 0 or open_support_requests_count > 0:
        overall_health = "ATTENTION_REQUIRED"
        health_summary = "Active settlement exceptions and pending bank clearing require operational monitoring."
    else:
        overall_health = "HEALTHY"
        health_summary = "All systems operational and 100% of transactions reconciled successfully."

    system_breakdown = {
        "gateway": {
            "name": "Payment Gateway",
            "status": "ATTENTION_REQUIRED" if gw_problem > 0 else "HEALTHY",
            "healthy_count": gw_healthy,
            "problem_count": gw_problem,
            "insight": f"{gw_healthy} authorized, {gw_problem} failed or missing authorization" if gw_problem > 0 else "All gateway authorizations healthy"
        },
        "bank": {
            "name": "Bank Settlement",
            "status": "ATTENTION_REQUIRED" if bank_exceptions > 0 else "HEALTHY",
            "settled_count": bank_settled,
            "pending_count": bank_pending,
            "exception_count": bank_exceptions,
            "insight": f"{bank_settled} settled, {bank_pending} in-flight pending, {bank_exceptions} exceptions or SLA breaches" if bank_exceptions > 0 else "All bank clearing complete"
        },
        "ledger": {
            "name": "Internal Ledger",
            "status": "ATTENTION_REQUIRED" if ledger_mismatched_or_missing > 0 else "HEALTHY",
            "recorded_count": ledger_recorded,
            "mismatched_or_missing_count": ledger_mismatched_or_missing,
            "insight": f"{ledger_recorded} successfully posted, {ledger_mismatched_or_missing} missing postings or amount mismatches" if ledger_mismatched_or_missing > 0 else "All ledger postings verified"
        }
    }

    exception_distribution = [
        {"category": cat, "count": cnt}
        for cat, cnt in sorted(category_counts.items(), key=lambda x: (-x[1], x[0]))
        if cnt > 0
    ]

    return {
        "total_transactions": total_count,
        "settled_count": settled_count,
        "active_investigations": active_investigations,
        "pending_count": pending_count,
        "failed_count": failed_count,
        "high_priority_count": high_priority_count,
        "open_cases_count": open_cases_count,
        "open_support_requests_count": open_support_requests_count,
        "reconciliation_rate": reconciliation_rate,
        "overall_health": overall_health,
        "health_summary": health_summary,
        "system_breakdown": system_breakdown,
        "exception_distribution": exception_distribution,
        "status_counts": status_counts,
        "recent_transactions": recent_list,
        "priority_queue": priority_queue,
    }



# ====================================================
# CASE LIFECYCLE MANAGEMENT ENDPOINTS
# ====================================================

@app.get("/api/cases/{transaction_id}")
def get_case(
    transaction_id: str,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    verify_ops_staff(user_email)
    return get_or_create_case(transaction_id)


@app.post("/api/cases/{transaction_id}/status")
def update_case_status(
    transaction_id: str,
    req: StatusUpdateRequest,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    user_info = verify_ops_staff(user_email)
    case = get_or_create_case(transaction_id)

    curr_status = case["case_status"]
    new_status = req.status.strip().upper()

    valid_transitions = {
        "NEW": ["INVESTIGATING"],
        "INVESTIGATING": ["RESOLVED"],
        "RESOLVED": ["INVESTIGATING"],
    }

    if new_status not in valid_transitions.get(curr_status, []):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from '{curr_status}' to '{new_status}'."
        )

    case["case_status"] = new_status
    now_str = get_current_iso_time()
    case["updated_at"] = now_str

    if new_status == "INVESTIGATING":
        action_code = "INVESTIGATION_STARTED"
        action_label = "Investigation started"
    elif new_status == "RESOLVED":
        action_code = "CASE_RESOLVED"
        action_label = "Case resolved"
    else:
        action_code = "STATUS_UPDATED"
        action_label = f"Status updated to {new_status}"

    case["activity"].append(
        {
            "action": action_code,
            "actor": user_info["name"],
            "timestamp": now_str,
            "details": f"{action_label} by {user_info['name']}",
        }
    )

    return case


@app.post("/api/cases/{transaction_id}/notes")
def add_case_note(
    transaction_id: str,
    req: NoteCreateRequest,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    user_info = verify_ops_staff(user_email)
    case = get_or_create_case(transaction_id)

    msg = req.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Note message cannot be empty.")

    now_str = get_current_iso_time()
    note_obj = {
        "id": f"note_{uuid.uuid4().hex[:8]}",
        "message": msg,
        "author": user_info["name"],
        "created_at": now_str,
    }

    case["notes"].append(note_obj)
    case["updated_at"] = now_str

    case["activity"].append(
        {
            "action": "NOTE_ADDED",
            "actor": user_info["name"],
            "timestamp": now_str,
            "details": f"Investigation note added by {user_info['name']}",
        }
    )

    return case


@app.post("/api/cases/{transaction_id}/assign")
def assign_case(
    transaction_id: str,
    req: Optional[AssignRequest] = None,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    user_info = verify_ops_staff(user_email)
    case = get_or_create_case(transaction_id)

    assignee = (req and req.assigned_to and req.assigned_to.strip()) or user_info["name"]

    now_str = get_current_iso_time()
    case["assigned_to"] = assignee
    case["updated_at"] = now_str

    case["activity"].append(
        {
            "action": "CASE_ASSIGNED",
            "actor": user_info["name"],
            "timestamp": now_str,
            "details": f"Case assigned to {assignee}",
        }
    )

    return case


# ====================================================
# CUSTOMER SUPPORT REQUEST ENDPOINTS
# ====================================================

SUPPORT_REQUESTS = []

VALID_ISSUE_CATEGORIES = [
    "Payment Not Completed",
    "Settlement Taking Too Long",
    "Incorrect Amount",
    "Transaction Information Issue",
    "Other",
]


class SupportRequestCreate(BaseModel):
    transaction_id: str
    issue_category: str
    message: Optional[str] = None


def verify_customer(user_email: Optional[str]) -> dict:
    if not isinstance(user_email, str) or user_email.strip().lower() not in MOCK_USERS:
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: Valid Customer credentials required."
        )
    user_info = MOCK_USERS[user_email.strip().lower()]
    if user_info["role"] != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: Restricted to Customer accounts."
        )
    return user_info


@app.post("/api/support/request")
def create_support_request(
    req: SupportRequestCreate,
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    user_info = verify_customer(user_email)

    tid = req.transaction_id.strip()
    allowed = user_info.get("allowed_transactions") or []
    if tid not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Access forbidden: You can only submit support requests for your allowed transactions."
        )

    cat = req.issue_category.strip()
    if cat not in VALID_ISSUE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid issue category. Allowed categories: {', '.join(VALID_ISSUE_CATEGORIES)}"
        )

    req_id = f"REQ_{len(SUPPORT_REQUESTS) + 1001}"
    now_str = get_current_iso_time()

    support_obj = {
        "request_id": req_id,
        "transaction_id": tid,
        "customer_name": user_info["name"],
        "customer_email": user_info["email"],
        "issue_category": cat,
        "message": (req.message or "").strip(),
        "status": "OPEN",
        "created_at": now_str,
    }

    SUPPORT_REQUESTS.append(support_obj)
    return support_obj


@app.get("/api/support/my-requests")
def get_my_support_requests(
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    user_info = verify_customer(user_email)
    my_reqs = [r for r in SUPPORT_REQUESTS if r["customer_email"] == user_info["email"]]
    return my_reqs


@app.get("/api/support/requests")
def get_all_support_requests(
    user_email: Optional[str] = Header(None, alias="X-User-Email"),
):
    verify_ops_staff(user_email)
    return SUPPORT_REQUESTS


