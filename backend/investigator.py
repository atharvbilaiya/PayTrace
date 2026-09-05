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


def build_discrepancy_analysis(
    gw_rec: Optional[Dict[str, Any]],
    bank_rec: Optional[Dict[str, Any]],
    ledger_rec: Optional[Dict[str, Any]],
    final_status: str,
    exceptions: List[str],
    has_duplicates: bool,
) -> Dict[str, Any]:
    def get_amt(rec):
        if not rec or rec.get("amount") is None:
            return None
        try:
            return float(rec["amount"])
        except (ValueError, TypeError):
            return None

    gw_amt = get_amt(gw_rec)
    bank_amt = get_amt(bank_rec)
    ledger_amt = get_amt(ledger_rec)

    currency = (
        (gw_rec and gw_rec.get("currency"))
        or (bank_rec and bank_rec.get("currency"))
        or (ledger_rec and ledger_rec.get("currency"))
        or "INR"
    )

    amount_comp = {
        "gateway_amount": gw_amt,
        "bank_amount": bank_amt,
        "ledger_amount": ledger_amt,
        "currency": currency,
    }

    # Data conflict check
    if has_duplicates or "CONFLICTING_RECORDS" in exceptions:
        return {
            "has_discrepancy": True,
            "type": "DATA_CONFLICT",
            "missing_records": [],
            "amount_comparison": amount_comp,
            "variances": [],
            "currency_match": True,
            "summary": "Conflicting source records prevent reliable financial reconciliation.",
        }

    # Missing record check
    missing_list = []
    if "MISSING_GATEWAY_RECORD" in exceptions or not gw_rec:
        missing_list.append("GATEWAY")
    if "MISSING_LEDGER" in exceptions or (gw_rec and bank_rec and bank_rec.get("status") == "SETTLED" and not ledger_rec):
        missing_list.append("LEDGER")

    if missing_list:
        missing_str = ", ".join(missing_list)
        return {
            "has_discrepancy": True,
            "type": "MISSING_RECORD",
            "missing_records": missing_list,
            "amount_comparison": amount_comp,
            "variances": [],
            "currency_match": True,
            "summary": f"System record for {missing_str} is missing from datasets.",
        }

    # Settlement delay / SLA breach check
    if "SLA_BREACH" in exceptions or final_status == "BANK_SETTLEMENT_PENDING":
        is_breach = "SLA_BREACH" in exceptions
        summary_msg = (
            "Bank settlement has exceeded the configured 48-hour SLA window."
            if is_breach
            else "Bank settlement is in-flight within standard 48-hour SLA window."
        )
        return {
            "has_discrepancy": is_breach,
            "type": "SETTLEMENT_DELAY",
            "missing_records": [],
            "amount_comparison": amount_comp,
            "variances": [],
            "currency_match": True,
            "summary": summary_msg,
        }

    # Currency mismatch check
    currencies = [
        r.get("currency")
        for r in [gw_rec, bank_rec, ledger_rec]
        if r and r.get("currency")
    ]
    currency_match = len(set(currencies)) <= 1 if currencies else True

    if not currency_match:
        variances = []
        if gw_rec and bank_rec and gw_rec.get("currency") != bank_rec.get("currency"):
            variances.append(
                {
                    "comparison": "Gateway vs Bank",
                    "type": "CURRENCY_MISMATCH",
                    "details": f"Gateway currency {gw_rec.get('currency')} does not match Bank currency {bank_rec.get('currency')}.",
                }
            )
        if gw_rec and ledger_rec and gw_rec.get("currency") != ledger_rec.get("currency"):
            variances.append(
                {
                    "comparison": "Gateway vs Ledger",
                    "type": "CURRENCY_MISMATCH",
                    "details": f"Gateway currency {gw_rec.get('currency')} does not match Ledger currency {ledger_rec.get('currency')}.",
                }
            )
        if bank_rec and ledger_rec and bank_rec.get("currency") != ledger_rec.get("currency"):
            variances.append(
                {
                    "comparison": "Bank vs Ledger",
                    "type": "CURRENCY_MISMATCH",
                    "details": f"Bank currency {bank_rec.get('currency')} does not match Ledger currency {ledger_rec.get('currency')}.",
                }
            )

        return {
            "has_discrepancy": True,
            "type": "CURRENCY_MISMATCH",
            "missing_records": [],
            "amount_comparison": amount_comp,
            "variances": variances,
            "currency_match": False,
            "summary": "Currency mismatch detected across transaction records.",
        }

    # Amount comparison & variance calculation
    variances = []

    # Gateway vs Bank comparison
    if gw_amt is not None and bank_amt is not None and gw_amt != bank_amt:
        diff = bank_amt - gw_amt
        abs_diff = abs(diff)
        if diff < 0:
            det = f"Bank settled {currency} {abs_diff:.2f} less than the Gateway authorized amount."
        else:
            det = f"Bank settled {currency} {abs_diff:.2f} more than the Gateway authorized amount."
        variances.append(
            {
                "comparison": "Gateway vs Bank",
                "difference": round(diff, 2),
                "absolute_difference": round(abs_diff, 2),
                "details": det,
            }
        )

    # Gateway vs Ledger comparison
    if gw_amt is not None and ledger_amt is not None and gw_amt != ledger_amt:
        diff = ledger_amt - gw_amt
        abs_diff = abs(diff)
        if diff < 0:
            det = f"Ledger posted {currency} {abs_diff:.2f} less than the Gateway authorized amount."
        else:
            det = f"Ledger posted {currency} {abs_diff:.2f} more than the Gateway authorized amount."
        variances.append(
            {
                "comparison": "Gateway vs Ledger",
                "difference": round(diff, 2),
                "absolute_difference": round(abs_diff, 2),
                "details": det,
            }
        )

    # Bank vs Ledger comparison (if gw and bank match but ledger differs, or vice versa)
    if bank_amt is not None and ledger_amt is not None and bank_amt != ledger_amt and gw_amt == bank_amt:
        diff = ledger_amt - bank_amt
        abs_diff = abs(diff)
        if diff < 0:
            det = f"Ledger posted {currency} {abs_diff:.2f} less than the Bank settled amount."
        else:
            det = f"Ledger posted {currency} {abs_diff:.2f} more than the Bank settled amount."
        variances.append(
            {
                "comparison": "Bank vs Ledger",
                "difference": round(diff, 2),
                "absolute_difference": round(abs_diff, 2),
                "details": det,
            }
        )

    if variances:
        max_abs = max(v["absolute_difference"] for v in variances)
        summary_msg = f"A financial variance of {currency} {max_abs:.2f} was detected between system records."
        return {
            "has_discrepancy": True,
            "type": "AMOUNT_MISMATCH",
            "missing_records": [],
            "amount_comparison": amount_comp,
            "variances": variances,
            "currency_match": True,
            "summary": summary_msg,
        }

    # Reconciled
    return {
        "has_discrepancy": False,
        "type": "RECONCILED",
        "missing_records": [],
        "amount_comparison": amount_comp,
        "variances": [],
        "currency_match": True,
        "summary": "All available financial records reconcile successfully.",
    }


def build_root_cause_analysis(
    gw_rec: Optional[Dict[str, Any]],
    bank_rec: Optional[Dict[str, Any]],
    ledger_rec: Optional[Dict[str, Any]],
    final_status: str,
    exceptions: List[str],
) -> Dict[str, Any]:
    if "CONFLICTING_RECORDS" in exceptions:
        return {
            "category": "DATA_INTEGRITY_CONFLICT",
            "primary_system": "Data Reconciliation",
            "root_cause": "Multiple conflicting records were found for the same transaction.",
            "operational_impact": "Reliable reconciliation cannot continue until source data is verified.",
            "severity": "HIGH",
        }
    if "MISSING_GATEWAY_RECORD" in exceptions:
        return {
            "category": "MISSING_SOURCE_RECORD",
            "primary_system": "Payment Gateway",
            "root_cause": "A downstream record exists without a corresponding Gateway transaction record.",
            "operational_impact": "The transaction cannot be reliably traced across systems.",
            "severity": "HIGH",
        }
    if "PHANTOM_RECORD_CONFLICT" in exceptions:
        return {
            "category": "DOWNSTREAM_RECORD_CONFLICT",
            "primary_system": "Cross-System Reconciliation",
            "root_cause": "The Gateway recorded the payment as failed, but downstream Bank or Ledger records exist.",
            "operational_impact": "The transaction lifecycle contains conflicting system states and requires manual investigation.",
            "severity": "HIGH",
        }
    if "BANK_REJECTED" in exceptions:
        return {
            "category": "BANK_SETTLEMENT_REJECTION",
            "primary_system": "Bank Settlement",
            "root_cause": "The Bank rejected the settlement after Gateway authorization.",
            "operational_impact": "The transaction requires investigation or retry before settlement can be completed.",
            "severity": "HIGH",
        }
    if "SLA_BREACH" in exceptions:
        return {
            "category": "SETTLEMENT_PROCESSING_DELAY",
            "primary_system": "Bank Settlement",
            "root_cause": "Bank settlement exceeded the configured 48-hour settlement SLA.",
            "operational_impact": "The transaction is delayed and requires operational follow-up.",
            "severity": "HIGH",
        }
    if "MISSING_LEDGER" in exceptions:
        return {
            "category": "LEDGER_POSTING_FAILURE",
            "primary_system": "Internal Ledger",
            "root_cause": "The Bank successfully settled the transaction, but no corresponding Internal Ledger entry was found.",
            "operational_impact": "Funds may be settled externally but not reflected correctly in internal accounting.",
            "severity": "HIGH",
        }
    if "AMOUNT_MISMATCH" in exceptions:
        return {
            "category": "FINANCIAL_RECONCILIATION_MISMATCH",
            "primary_system": "Reconciliation",
            "root_cause": "Amounts recorded across Gateway, Bank, and/or Ledger systems do not reconcile.",
            "operational_impact": "A financial variance exists and requires reconciliation before the transaction can be considered fully settled.",
            "severity": "HIGH",
        }
    if final_status == "SETTLED":
        return {
            "category": "RECONCILIATION_COMPLETE",
            "primary_system": "All Systems",
            "root_cause": "All Gateway, Bank, and Ledger records reconcile successfully.",
            "operational_impact": "No operational action is required.",
            "severity": "NONE",
        }
    if final_status == "BANK_SETTLEMENT_PENDING":
        return {
            "category": "SETTLEMENT_IN_PROGRESS",
            "primary_system": "Bank Settlement",
            "root_cause": "The Gateway payment succeeded but bank settlement is still within the configured processing window.",
            "operational_impact": "Settlement processing is ongoing and no immediate intervention is required.",
            "severity": "LOW",
        }
    if final_status == "PAYMENT_PENDING":
        return {
            "category": "PAYMENT_PROCESSING",
            "primary_system": "Payment Gateway",
            "root_cause": "The payment is still being processed by the Gateway.",
            "operational_impact": "Final settlement has not yet started.",
            "severity": "LOW",
        }
    if final_status == "PAYMENT_FAILED":
        fail_reason = gw_rec.get("failure_reason") if gw_rec else None
        rc = (
            f"The payment failed at the Gateway before settlement processing ({fail_reason})."
            if fail_reason
            else "The payment failed at the Gateway before settlement processing."
        )
        return {
            "category": "PAYMENT_FAILURE",
            "primary_system": "Payment Gateway",
            "root_cause": rc,
            "operational_impact": "No bank settlement or ledger posting should occur.",
            "severity": "MEDIUM",
        }

    return {
        "category": "UNCLASSIFIED_EXCEPTION",
        "primary_system": "System Reconciliation",
        "root_cause": "Transaction status could not be unambiguously resolved.",
        "operational_impact": "Manual investigation required by operations team.",
        "severity": "MEDIUM",
    }


def build_priority_assessment(result: Dict[str, Any]) -> Dict[str, Any]:
    exceptions = result.get("exceptions", [])
    final_status = result.get("final_status", "")
    confidence = result.get("confidence", "")

    reasons = []
    score = 0

    if "CONFLICTING_RECORDS" in exceptions:
        score = max(score, 95)
        reasons.append("Conflicting source records across datasets require immediate data team intervention.")

    if "MISSING_GATEWAY_RECORD" in exceptions:
        score = max(score, 95)
        reasons.append("Downstream records exist without Gateway authorization.")

    if "PHANTOM_RECORD_CONFLICT" in exceptions:
        score = max(score, 85)
        reasons.append("Downstream bank or ledger records exist for a failed gateway payment.")

    if "AMOUNT_MISMATCH" in exceptions:
        score = max(score, 80)
        reasons.append("Financial variance detected across system records.")

    if "MISSING_LEDGER" in exceptions:
        score = max(score, 75)
        reasons.append("Settled payment missing internal ledger entry.")

    if "BANK_REJECTED" in exceptions:
        score = max(score, 75)
        reasons.append("Bank settlement batch rejected during clearing.")

    if "SLA_BREACH" in exceptions:
        score = max(score, 70)
        reasons.append("Bank settlement pending for over 48 hours.")

    if confidence == "LOW" and not reasons:
        score = max(score, 90)
        reasons.append("Low investigation confidence requires manual operational review.")

    if not reasons:
        if final_status == "PAYMENT_FAILED":
            score = 50
            reasons.append("Gateway payment authorization failed.")
        elif final_status == "BANK_SETTLEMENT_PENDING":
            score = 25
            reasons.append("Bank settlement in-flight within standard 48h window.")
        elif final_status == "PAYMENT_PENDING":
            score = 25
            reasons.append("Gateway payment processing in-flight.")
        elif final_status == "SETTLED":
            score = 0
            reasons.append("Fully reconciled transaction.")
        else:
            score = 20
            reasons.append("Standard operational monitoring.")

    if score >= 90:
        priority = "CRITICAL"
    elif score >= 70:
        priority = "HIGH"
    elif score >= 40:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    return {
        "priority": priority,
        "priority_score": score,
        "reasons": reasons,
    }


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
    rule_evaluation_trace = []
    step_num = 1

    def add_trace_step(rule: str, result: str, details: str, **kwargs):
        nonlocal step_num
        step_dict = {
            "step": step_num,
            "rule": rule,
            "result": result,
            "details": details,
        }
        for k, v in kwargs.items():
            if v is not None:
                step_dict[k] = v
        rule_evaluation_trace.append(step_dict)
        step_num += 1

    # 1. Record Availability Check
    if gw_rec:
        add_trace_step(
            "Record Availability Check",
            "PASSED",
            f"Primary Gateway authorization record found for Transaction {transaction_id}."
        )
    else:
        add_trace_step(
            "Record Availability Check",
            "DETECTED",
            f"Primary Gateway authorization record is missing for Transaction {transaction_id}."
        )

    # 2. Duplicate/Conflicting Record Check
    has_duplicates = len(gw_rows) > 1 or len(bank_rows) > 1 or len(ledger_rows) > 1
    if has_duplicates:
        add_trace_step(
            "Duplicate Record Check",
            "DETECTED",
            f"Duplicate records detected across datasets (Gateway: {len(gw_rows)}, Bank: {len(bank_rows)}, Ledger: {len(ledger_rows)})."
        )
        final_status = "INVESTIGATION_UNCERTAIN"
        exceptions.append("CONFLICTING_RECORDS")
        confidence = "LOW"
        recommended_action = "Manual review required: duplicate records detected across data sources."

    # 3. Missing Gateway Record Check
    elif not gw_rec:
        add_trace_step(
            "Gateway Record Validation",
            "DETECTED",
            "Downstream Bank/Ledger records exist, but Gateway authorization record is missing."
        )
        final_status = "INVESTIGATION_UNCERTAIN"
        exceptions.append("MISSING_GATEWAY_RECORD")
        confidence = "LOW"
        recommended_action = "Investigate unmapped bank/ledger entry; gateway record is missing."

    # 4. Gateway Status Rules
    else:
        add_trace_step(
            "Duplicate Record Check",
            "PASSED",
            "No duplicate records found across Gateway, Bank, or Ledger datasets."
        )

        gw_status = gw_rec.get("status")

        if gw_status == "FAILED":
            fail_reason = gw_rec.get("failure_reason") or "Gateway reported failure"
            add_trace_step(
                "Gateway Status Evaluation",
                "FAILED",
                f"Gateway payment authorization failed ({fail_reason})."
            )

            final_status = "PAYMENT_FAILED"
            if bank_rec or ledger_rec:
                add_trace_step(
                    "Downstream Phantom Check",
                    "DETECTED",
                    "Phantom record conflict: Downstream bank or ledger entry exists for a failed gateway payment."
                )
                exceptions.append("PHANTOM_RECORD_CONFLICT")
                confidence = "MEDIUM"
                recommended_action = "Contact payment gateway ops; downstream bank/ledger records exist for failed gateway payment."
            else:
                add_trace_step(
                    "Downstream Phantom Check",
                    "PASSED",
                    "No downstream bank or ledger entries found for failed payment."
                )
                confidence = "HIGH"
                recommended_action = "No action required; payment failed at gateway level."

        elif gw_status == "PENDING":
            add_trace_step(
                "Gateway Status Evaluation",
                "TRIGGERED",
                "Gateway transaction is currently processing in-flight."
            )
            final_status = "PAYMENT_PENDING"
            confidence = "HIGH"
            recommended_action = "Await gateway processing completion."

        elif gw_status == "SUCCESS":
            add_trace_step(
                "Gateway Status Evaluation",
                "PASSED",
                f"Gateway payment authorized successfully ({gw_rec.get('currency', 'INR')} {gw_rec.get('amount')})."
            )

            age_hours = calculate_age_hours(gw_rec.get("payment_timestamp"))
            bank_status = bank_rec.get("status") if bank_rec else None

            # Bank REJECTED
            if bank_rec and bank_status == "REJECTED":
                add_trace_step(
                    "Bank Settlement Evaluation",
                    "FAILED",
                    f"Bank settlement batch was REJECTED during clearing (Ref: {bank_rec.get('bank_reference')})."
                )
                final_status = "SETTLEMENT_EXCEPTION"
                exceptions.append("BANK_REJECTED")
                confidence = "HIGH"
                recommended_action = "Check bank settlement failure reasons and re-initiate bank transfer."

            # Bank PENDING or Missing
            elif not bank_rec or bank_status == "PENDING":
                elapsed_int = int(round(age_hours))
                if age_hours < 48.0:
                    add_trace_step(
                        "Settlement SLA Evaluation",
                        "TRIGGERED",
                        f"Bank settlement in-flight ({elapsed_int} hours elapsed), within standard 48-hour SLA window.",
                        elapsed_hours=elapsed_int,
                        threshold_hours=48
                    )
                    final_status = "BANK_SETTLEMENT_PENDING"
                    confidence = "HIGH"
                    recommended_action = "Payment in-flight; await standard bank settlement SLA window."
                else:
                    add_trace_step(
                        "Settlement SLA Evaluation",
                        "BREACHED",
                        f"Bank settlement pending for {elapsed_int} hours, exceeding the 48-hour SLA threshold.",
                        elapsed_hours=elapsed_int,
                        threshold_hours=48
                    )
                    final_status = "SETTLEMENT_EXCEPTION"
                    exceptions.append("SLA_BREACH")
                    confidence = "HIGH"
                    recommended_action = "Escalate to banking operations; settlement delayed past 48-hour SLA window."

            # Bank SETTLED -> Check Ledger
            elif bank_rec and bank_status == "SETTLED":
                add_trace_step(
                    "Bank Settlement Evaluation",
                    "PASSED",
                    f"Bank settlement confirmed as SETTLED (Ref: {bank_rec.get('bank_reference')})."
                )

                if not ledger_rec:
                    add_trace_step(
                        "Ledger Record Validation",
                        "DETECTED",
                        "No internal ledger entry recorded for the settled bank transaction."
                    )
                    final_status = "SETTLEMENT_EXCEPTION"
                    exceptions.append("MISSING_LEDGER")
                    confidence = "HIGH"
                    recommended_action = "Trigger manual ledger posting for the settled transaction."
                else:
                    add_trace_step(
                        "Ledger Record Validation",
                        "PASSED",
                        f"Internal ledger entry recorded (Entry ID: {ledger_rec.get('ledger_entry_id')})."
                    )

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
                        add_trace_step(
                            "Three-Way Reconciliation Check",
                            "PASSED",
                            f"Three-way amount and currency reconciliation verified ({gw_rec.get('currency', 'INR')} {gw_amt})."
                        )
                        final_status = "SETTLED"
                        confidence = "HIGH"
                        recommended_action = "Transaction fully settled and reconciled; no action required."
                    else:
                        add_trace_step(
                            "Three-Way Reconciliation Check",
                            "FAILED",
                            f"Financial discrepancy detected across systems (Gateway: {gw_rec.get('currency')} {gw_rec.get('amount')}, Bank: {bank_rec.get('currency')} {bank_rec.get('amount')}, Ledger: {ledger_rec.get('currency')} {ledger_rec.get('amount')})."
                        )
                        final_status = "SETTLEMENT_EXCEPTION"
                        exceptions.append("AMOUNT_MISMATCH")
                        confidence = "HIGH"
                        recommended_action = "Reconcile amount discrepancy between gateway, bank, and ledger entries."

    # Final Decision Trace Step
    decision_result = "PASSED" if final_status == "SETTLED" else ("TRIGGERED" if "PENDING" in final_status else ("FAILED" if final_status == "PAYMENT_FAILED" else "DETECTED"))
    add_trace_step(
        "Final Investigation Decision",
        decision_result,
        f"Final status classified as {final_status} with {confidence} confidence."
    )

    timeline = build_timeline(gw_rec, bank_rec, ledger_rec)

    # Discrepancy Analysis
    discrepancy_analysis = build_discrepancy_analysis(
        gw_rec, bank_rec, ledger_rec, final_status, exceptions, has_duplicates
    )

    # Root Cause Analysis
    root_cause_analysis = build_root_cause_analysis(
        gw_rec, bank_rec, ledger_rec, final_status, exceptions
    )

    # Priority Assessment
    priority_assessment = build_priority_assessment(
        {"final_status": final_status, "confidence": confidence, "exceptions": exceptions}
    )

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
        "rule_evaluation_trace": rule_evaluation_trace,
        "discrepancy_analysis": discrepancy_analysis,
        "root_cause_analysis": root_cause_analysis,
        "priority_assessment": priority_assessment,
    }

