import sys
import os
from data_loader import get_all_transaction_ids
from investigator import investigate_transaction

# Map of expected scenarios for verification:
# (expected_status, expected_exceptions, expected_discrepancy, expected_disc_type, expected_rc_category, expected_rc_severity)
EXPECTED_SCENARIOS = {
    "TXN_1001": ("SETTLED", [], False, "RECONCILED", "RECONCILIATION_COMPLETE", "NONE"),
    "TXN_1002": ("BANK_SETTLEMENT_PENDING", [], False, "SETTLEMENT_DELAY", "SETTLEMENT_IN_PROGRESS", "LOW"),
    "TXN_1003": ("PAYMENT_FAILED", [], False, "RECONCILED", "PAYMENT_FAILURE", "MEDIUM"),
    "TXN_1004": ("PAYMENT_PENDING", [], False, "RECONCILED", "PAYMENT_PROCESSING", "LOW"),
    "TXN_1005": ("SETTLEMENT_EXCEPTION", ["MISSING_LEDGER"], True, "MISSING_RECORD", "LEDGER_POSTING_FAILURE", "HIGH"),
    "TXN_1006": ("SETTLEMENT_EXCEPTION", ["AMOUNT_MISMATCH"], True, "AMOUNT_MISMATCH", "FINANCIAL_RECONCILIATION_MISMATCH", "HIGH"),
    "TXN_1007": ("SETTLEMENT_EXCEPTION", ["BANK_REJECTED"], False, "RECONCILED", "BANK_SETTLEMENT_REJECTION", "HIGH"),
    "TXN_1008": ("SETTLEMENT_EXCEPTION", ["SLA_BREACH"], True, "SETTLEMENT_DELAY", "SETTLEMENT_PROCESSING_DELAY", "HIGH"),
    "TXN_1009": ("INVESTIGATION_UNCERTAIN", ["CONFLICTING_RECORDS"], True, "DATA_CONFLICT", "DATA_INTEGRITY_CONFLICT", "HIGH"),
    "TXN_1010": ("INVESTIGATION_UNCERTAIN", ["MISSING_GATEWAY_RECORD"], True, "MISSING_RECORD", "MISSING_SOURCE_RECORD", "HIGH"),
    "TXN_1011": ("PAYMENT_FAILED", ["PHANTOM_RECORD_CONFLICT"], False, "RECONCILED", "DOWNSTREAM_RECORD_CONFLICT", "HIGH"),
    "TXN_1012": ("SETTLED", [], False, "RECONCILED", "RECONCILIATION_COMPLETE", "NONE"),
    "TXN_1013": ("BANK_SETTLEMENT_PENDING", [], False, "SETTLEMENT_DELAY", "SETTLEMENT_IN_PROGRESS", "LOW"),
    "TXN_1014": ("SETTLEMENT_EXCEPTION", ["AMOUNT_MISMATCH"], True, "AMOUNT_MISMATCH", "FINANCIAL_RECONCILIATION_MISMATCH", "HIGH"),
    "TXN_1015": ("SETTLEMENT_EXCEPTION", ["SLA_BREACH"], True, "SETTLEMENT_DELAY", "SETTLEMENT_PROCESSING_DELAY", "HIGH"),
}


def run_tests():
    print("==========================================")
    print(" Running PayTrace Backend Core Test Suite ")
    print("==========================================")

    all_ids = get_all_transaction_ids()
    print(f"Total Transactions Discovered: {len(all_ids)}")

    passed = 0
    failed = 0

    for tid, (expected_status, expected_exceptions, expected_discrepancy, expected_disc_type, expected_rc_category, expected_rc_severity) in EXPECTED_SCENARIOS.items():
        res = investigate_transaction(tid)
        if not res:
            print(f"[FAIL] {tid}: Record not found")
            failed += 1
            continue

        status_ok = res["final_status"] == expected_status
        exceptions_ok = set(res["exceptions"]) == set(expected_exceptions)
        trace = res.get("rule_evaluation_trace")
        trace_ok = isinstance(trace, list) and len(trace) > 0
        
        disc = res.get("discrepancy_analysis")
        disc_ok = (
            disc is not None
            and disc.get("has_discrepancy") == expected_discrepancy
            and disc.get("type") == expected_disc_type
        )

        rc = res.get("root_cause_analysis")
        rc_ok = (
            rc is not None
            and rc.get("category") == expected_rc_category
            and rc.get("severity") == expected_rc_severity
            and bool(rc.get("primary_system"))
            and bool(rc.get("root_cause"))
            and bool(rc.get("operational_impact"))
        )

        if status_ok and exceptions_ok and trace_ok and disc_ok and rc_ok:
            print(f"[PASS] {tid} -> Status: {res['final_status']}, RC Cat: {rc['category']} ({rc['severity']}), Confidence: {res['confidence']}")
            passed += 1
        else:
            print(f"[FAIL] {tid} -> StatusOK={status_ok}, ExcOK={exceptions_ok}, TraceOK={trace_ok}, DiscOK={disc_ok}, RcOK={rc_ok} (Got RC={rc})")
            failed += 1

    # Test non-existent ID
    invalid_res = investigate_transaction("TXN_9999")
    if invalid_res is None:
        print("[PASS] TXN_9999 -> Returned None (404 expected)")
        passed += 1
    else:
        print(f"[FAIL] TXN_9999 -> Expected None, got {invalid_res}")
        failed += 1

    print("------------------------------------------")
    print(f"Summary: {passed} PASSED, {failed} FAILED")
    print("------------------------------------------")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()

