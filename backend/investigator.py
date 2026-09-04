from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from data_loader import get_transaction_bundle


def parse_iso_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


def calculate_age_hours(payment_timestamp_str: Optional[str]) -> float:
    if not payment_timestamp_str:
        return 0.0
    dt = parse_iso_datetime(payment_timestamp_str)
    if not dt:
        return 0.0
    # Reference current time for SLA evaluation (2026-09-04T23:45:00Z)
    now = datetime(2026, 9, 4, 23, 45, 0, tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = now - dt
    return max(0.0, delta.total_seconds() / 3600.0)


def build_timeline(
    gw_rec: Optional[Dict[str, Any]],
    bank_rec: Optional[Dict[str, Any]],
    ledger_rec: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    timeline = []

    # Gateway Step
    if gw_rec:
        amount_str = f"{gw_rec.get('currency', 'INR')} {gw_rec.get('amount', '0.00')}"
        ref = gw_rec.get("gateway_reference") or "N/A"
        fail_reason = gw_rec.get("failure_reason")
        details = f"Gateway status {gw_rec.get('status')} ({amount_str}, Ref: {ref})"
        if fail_reason:
            details += f" - Reason: {fail_reason}"

        timeline.append(
            {
                "step": "Gateway Authorization",
                "status": gw_rec.get("status"),
                "timestamp": gw_rec.get("payment_timestamp"),
                "details": details,
            }
        )
    else:
        timeline.append(
            {
                "step": "Gateway Authorization",
                "status": "MISSING",
                "timestamp": None,
                "details": "Gateway transaction record not found",
            }
        )

    # Bank Step
    if bank_rec:
        amount_str = f"{bank_rec.get('currency', 'INR')} {bank_rec.get('amount', '0.00')}"
        ref = bank_rec.get("bank_reference") or "N/A"
        timeline.append(
            {
                "step": "Bank Settlement",
                "status": bank_rec.get("status"),
                "timestamp": bank_rec.get("settlement_timestamp"),
                "details": f"Bank status {bank_rec.get('status')} ({amount_str}, Ref: {ref})",
            }
        )
    else:
        timeline.append(
            {
                "step": "Bank Settlement",
                "status": "MISSING",
                "timestamp": None,
                "details": "No bank settlement record found",
            }
        )

    # Ledger Step
    if ledger_rec:
        amount_str = f"{ledger_rec.get('currency', 'INR')} {ledger_rec.get('amount', '0.00')}"
        entry_id = ledger_rec.get("ledger_entry_id") or "N/A"
        timeline.append(
            {
                "step": "Internal Ledger Posting",
                "status": ledger_rec.get("status"),
                "timestamp": ledger_rec.get("recorded_at"),
                "details": f"Ledger entry {entry_id} status {ledger_rec.get('status')} ({amount_str})",
            }
        )
    else:
        timeline.append(
            {
                "step": "Internal Ledger Posting",
                "status": "MISSING",
                "timestamp": None,
                "details": "No internal ledger entry recorded",
            }
        )

    return timeline


def format_record(rec: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not rec:
        return None
    res = {}
    for k, v in rec.items():
        if k == "amount" and v is not None:
            try:
                res[k] = float(v)
            except ValueError:
                res[k] = v
        else:
            res[k] = v
    return res


def investigate_transaction(transaction_id: str) -> Optional[Dict[str, Any]]:
    bundle = get_transaction_bundle(transaction_id)
    gw_rows = bundle["gateway_rows"]
    bank_rows = bundle["bank_rows"]
    ledger_rows = bundle["ledger_rows"]

    # Check if transaction exists at all in mock data
    if not gw_rows and not bank_rows and not ledger_rows:
        return None

    # Pick primary single records for inspection
    gw_rec = gw_rows[0] if gw_rows else None
    bank_rec = bank_rows[0] if bank_rows else None
    ledger_rec = ledger_rows[0] if ledger_rows else None

    exceptions = []
    final_status = "INVESTIGATION_UNCERTAIN"
    confidence = "LOW"
    recommended_action = ""

    # PRE-CHECK 1: Check for duplicate records
    has_duplicates = len(gw_rows) > 1 or len(bank_rows) > 1 or len(ledger_rows) > 1
    if has_duplicates:
        final_status = "INVESTIGATION_UNCERTAIN"
        exceptions.append("CONFLICTING_RECORDS")
        confidence = "LOW"
        recommended_action = "Manual review required: duplicate records detected across data sources."

    # PRE-CHECK 2: Missing gateway record
    elif not gw_rec:
        final_status = "INVESTIGATION_UNCERTAIN"
        exceptions.append("MISSING_GATEWAY_RECORD")
        confidence = "LOW"
        recommended_action = "Investigate unmapped bank/ledger entry; gateway record is missing."

    # RULE SET FOR GATEWAY FAILED
    elif gw_rec.get("status") == "FAILED":
        final_status = "PAYMENT_FAILED"
        if bank_rec or ledger_rec:
            exceptions.append("PHANTOM_RECORD_CONFLICT")
            confidence = "MEDIUM"
            recommended_action = "Contact payment gateway ops; downstream bank/ledger records exist for failed gateway payment."
        else:
            confidence = "HIGH"
            recommended_action = "No action required; payment failed at gateway level."

    # RULE SET FOR GATEWAY PENDING
    elif gw_rec.get("status") == "PENDING":
        final_status = "PAYMENT_PENDING"
        confidence = "HIGH"
        recommended_action = "Await gateway processing completion."

    # RULE SET FOR GATEWAY SUCCESS
    elif gw_rec.get("status") == "SUCCESS":
        age_hours = calculate_age_hours(gw_rec.get("payment_timestamp"))
        
        # Bank REJECTED
        if bank_rec and bank_rec.get("status") == "REJECTED":
            final_status = "SETTLEMENT_EXCEPTION"
            exceptions.append("BANK_REJECTED")
            confidence = "HIGH"
            recommended_action = "Check bank settlement failure reasons and re-initiate bank transfer."

        # Bank PENDING or Missing (age < 48h)
        elif (not bank_rec or bank_rec.get("status") == "PENDING") and age_hours < 48.0:
            final_status = "BANK_SETTLEMENT_PENDING"
            confidence = "HIGH"
            recommended_action = "Payment in-flight; await standard bank settlement SLA window."

        # Bank PENDING or Missing (age >= 48h)
        elif (not bank_rec or bank_rec.get("status") == "PENDING") and age_hours >= 48.0:
            final_status = "SETTLEMENT_EXCEPTION"
            exceptions.append("SLA_BREACH")
            confidence = "HIGH"
            recommended_action = "Escalate to banking operations; settlement delayed past 48-hour SLA window."

        # Bank SETTLED -> Check Ledger
        elif bank_rec and bank_rec.get("status") == "SETTLED":
            if not ledger_rec:
                final_status = "SETTLEMENT_EXCEPTION"
                exceptions.append("MISSING_LEDGER")
                confidence = "HIGH"
                recommended_action = "Trigger manual ledger posting for the settled transaction."
            else:
                try:
                    gw_amt = float(gw_rec.get("amount", 0))
                    bank_amt = float(bank_rec.get("amount", 0))
                    ledger_amt = float(ledger_rec.get("amount", 0))
                    amounts_match = (gw_amt == bank_amt == ledger_amt)
                except (ValueError, TypeError):
                    amounts_match = False

                currencies_match = (
                    gw_rec.get("currency") == bank_rec.get("currency") == ledger_rec.get("currency")
                )

                if ledger_rec.get("status") == "RECORDED" and amounts_match and currencies_match:
                    final_status = "SETTLED"
                    confidence = "HIGH"
                    recommended_action = "Transaction fully settled and reconciled; no action required."
                else:
                    final_status = "SETTLEMENT_EXCEPTION"
                    exceptions.append("AMOUNT_MISMATCH")
                    confidence = "HIGH"
                    recommended_action = "Reconcile amount discrepancy between gateway, bank, and ledger entries."

    timeline = build_timeline(gw_rec, bank_rec, ledger_rec)

    return {
        "transaction_id": transaction_id,
        "final_status": final_status,
        "confidence": confidence,
        "exceptions": exceptions,
        "recommended_action": recommended_action,
        "records": {
            "gateway": format_record(gw_rec),
            "bank": format_record(bank_rec),
            "ledger": format_record(ledger_rec),
        },
        "timeline": timeline,
    }
