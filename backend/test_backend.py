import sys
import os
from data_loader import get_all_transaction_ids
from investigator import investigate_transaction

# Map of expected scenarios for verification
EXPECTED_SCENARIOS = {
    "TXN_1001": ("SETTLED", []),
    "TXN_1002": ("BANK_SETTLEMENT_PENDING", []),
    "TXN_1003": ("PAYMENT_FAILED", []),
    "TXN_1004": ("PAYMENT_PENDING", []),
    "TXN_1005": ("SETTLEMENT_EXCEPTION", ["MISSING_LEDGER"]),
    "TXN_1006": ("SETTLEMENT_EXCEPTION", ["AMOUNT_MISMATCH"]),
    "TXN_1007": ("SETTLEMENT_EXCEPTION", ["BANK_REJECTED"]),
    "TXN_1008": ("SETTLEMENT_EXCEPTION", ["SLA_BREACH"]),
    "TXN_1009": ("INVESTIGATION_UNCERTAIN", ["CONFLICTING_RECORDS"]),
    "TXN_1010": ("INVESTIGATION_UNCERTAIN", ["MISSING_GATEWAY_RECORD"]),
    "TXN_1011": ("PAYMENT_FAILED", ["PHANTOM_RECORD_CONFLICT"]),
    "TXN_1012": ("SETTLED", []),
    "TXN_1013": ("BANK_SETTLEMENT_PENDING", []),
    "TXN_1014": ("SETTLEMENT_EXCEPTION", ["AMOUNT_MISMATCH"]),
    "TXN_1015": ("SETTLEMENT_EXCEPTION", ["SLA_BREACH"]),
}


def run_tests():
    print("==========================================")
    print(" Running PayTrace Backend Core Test Suite ")
    print("==========================================")

    all_ids = get_all_transaction_ids()
    print(f"Total Transactions Discovered: {len(all_ids)}")

    passed = 0
    failed = 0

    for tid, (expected_status, expected_exceptions) in EXPECTED_SCENARIOS.items():
        res = investigate_transaction(tid)
        if not res:
            print(f"[FAIL] {tid}: Record not found")
            failed += 1
            continue

        status_ok = res["final_status"] == expected_status
        exceptions_ok = set(res["exceptions"]) == set(expected_exceptions)

        if status_ok and exceptions_ok:
            print(f"[PASS] {tid} -> Status: {res['final_status']}, Exceptions: {res['exceptions']}, Confidence: {res['confidence']}")
            passed += 1
        else:
            print(f"[FAIL] {tid} -> Expected ({expected_status}, {expected_exceptions}), Got ({res['final_status']}, {res['exceptions']})")
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
