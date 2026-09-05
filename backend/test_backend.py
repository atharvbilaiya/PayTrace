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

        p_ok = (
            res.get("priority_assessment") is not None
            and isinstance(res["priority_assessment"].get("reasons"), list)
            and len(res["priority_assessment"].get("reasons")) > 0
            and "priority" in res["priority_assessment"]
            and "priority_score" in res["priority_assessment"]
        )

        if status_ok and exceptions_ok and trace_ok and disc_ok and rc_ok and p_ok:
            pa = res["priority_assessment"]
            print(f"[PASS] {tid} -> Status: {res['final_status']}, Priority: {pa['priority']} ({pa['priority_score']}), RC Cat: {rc['category']}")
            passed += 1
        else:
            print(f"[FAIL] {tid} -> StatusOK={status_ok}, ExcOK={exceptions_ok}, TraceOK={trace_ok}, DiscOK={disc_ok}, RcOK={rc_ok}, PriorityOK={p_ok}")
            failed += 1

    # Test non-existent ID
    invalid_res = investigate_transaction("TXN_9999")
    if invalid_res is None:
        print("[PASS] TXN_9999 -> Returned None (404 expected)")
        passed += 1
    else:
        print(f"[FAIL] TXN_9999 -> Expected None, got {invalid_res}")
        failed += 1

    print("\n------------------------------------------")
    print(" Running Priority Queue & Dashboard Tests  ")
    print("------------------------------------------")

    from main import get_dashboard_summary, login, get_investigation, LoginRequest
    from fastapi import HTTPException

    try:
        summary = get_dashboard_summary()
        pq = summary.get("priority_queue", [])
        if len(pq) == 5:
            print(f"[PASS] Dashboard summary returned top 5 priority queue items.")
            passed += 1
        else:
            print(f"[FAIL] Expected 5 priority queue items, got {len(pq)}")
            failed += 1

        # Check sorting order
        scores = [item["priority_score"] for item in pq]
        if scores == sorted(scores, reverse=True):
            print(f"[PASS] Priority queue items sorted correctly in descending order: {scores}")
            passed += 1
        else:
            print(f"[FAIL] Priority queue not sorted in descending order: {scores}")
            failed += 1

        # Check top item is CRITICAL
        top_item = pq[0]
        if top_item["priority"] == "CRITICAL" and top_item["priority_score"] >= 90:
            print(f"[PASS] Top priority queue item is {top_item['transaction_id']} ({top_item['priority']} - Score: {top_item['priority_score']})")
            passed += 1
        else:
            print(f"[FAIL] Expected top item to be CRITICAL (>=90), got {top_item}")
            failed += 1

    except Exception as e:
        print(f"[FAIL] Dashboard priority queue test failed: {e}")
        failed += 1

    print("\n------------------------------------------")
    print(" Running Auth & Role-Based Access Tests   ")
    print("------------------------------------------")

    from main import login, get_investigation, LoginRequest
    from fastapi import HTTPException

    # Auth Test 1: Valid Customer Login
    try:
        c_login = login(LoginRequest(email="customer@paytrace.demo", password="customer123"))
        if c_login.get("user", {}).get("role") == "CUSTOMER":
            print("[PASS] Login customer@paytrace.demo -> Role: CUSTOMER")
            passed += 1
        else:
            print(f"[FAIL] Customer login returned unexpected user: {c_login}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Customer login failed with error: {e}")
        failed += 1

    # Auth Test 2: Valid Ops Login
    try:
        o_login = login(LoginRequest(email="ops@paytrace.demo", password="ops123"))
        if o_login.get("user", {}).get("role") == "OPERATIONS_STAFF":
            print("[PASS] Login ops@paytrace.demo -> Role: OPERATIONS_STAFF")
            passed += 1
        else:
            print(f"[FAIL] Ops login returned unexpected user: {o_login}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Ops login failed with error: {e}")
        failed += 1

    # Auth Test 3: Invalid Credentials Login
    try:
        login(LoginRequest(email="ops@paytrace.demo", password="wrongpassword"))
        print("[FAIL] Invalid login allowed incorrectly")
        failed += 1
    except HTTPException as e:
        if e.status_code == 401:
            print("[PASS] Invalid login -> Returned 401 Unauthorized")
            passed += 1
        else:
            print(f"[FAIL] Invalid login expected 401, got {e.status_code}")
            failed += 1

    # Auth Test 4: Customer Allowed Transaction Access
    try:
        res_allowed = get_investigation("TXN_1001", user_email="customer@paytrace.demo")
        if res_allowed.get("final_status") == "SETTLED":
            print("[PASS] Customer access to TXN_1001 (Allowed) -> 200 OK")
            passed += 1
        else:
            print(f"[FAIL] Unexpected response for customer TXN_1001: {res_allowed}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Customer TXN_1001 access failed: {e}")
        failed += 1

    # Auth Test 5: Customer Disallowed Transaction Access (403 Forbidden)
    try:
        get_investigation("TXN_1008", user_email="customer@paytrace.demo")
        print("[FAIL] Customer accessed TXN_1008 without 403 Forbidden")
        failed += 1
    except HTTPException as e:
        if e.status_code == 403:
            print("[PASS] Customer access to TXN_1008 (Disallowed) -> 403 Forbidden")
            passed += 1
        else:
            print(f"[FAIL] Customer TXN_1008 expected 403, got {e.status_code}")
            failed += 1

    # Auth Test 6: Operations Staff All Transaction Access
    try:
        res_ops = get_investigation("TXN_1008", user_email="ops@paytrace.demo")
        if res_ops.get("final_status") == "SETTLEMENT_EXCEPTION":
            print("[PASS] Operations Staff access to TXN_1008 -> 200 OK")
            passed += 1
        else:
            print(f"[FAIL] Unexpected response for ops TXN_1008: {res_ops}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Ops TXN_1008 access failed: {e}")
        failed += 1

    print("\n------------------------------------------")
    print(" Running Case Lifecycle Management Tests  ")
    print("------------------------------------------")

    from main import (
        get_case,
        update_case_status,
        add_case_note,
        assign_case,
        StatusUpdateRequest,
        NoteCreateRequest,
        AssignRequest,
    )

    # Case Test 1: Default Case Creation (NEW)
    try:
        c1 = get_case("TXN_1005", user_email="ops@paytrace.demo")
        if c1.get("case_status") == "NEW" and c1.get("transaction_id") == "TXN_1005":
            print("[PASS] GET /api/cases/TXN_1005 -> Default state NEW")
            passed += 1
        else:
            print(f"[FAIL] Expected NEW case, got {c1}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] GET case failed: {e}")
        failed += 1

    # Case Test 2: Start Investigation (NEW -> INVESTIGATING)
    try:
        c2 = update_case_status("TXN_1005", StatusUpdateRequest(status="INVESTIGATING"), user_email="ops@paytrace.demo")
        if c2.get("case_status") == "INVESTIGATING":
            print("[PASS] Status Transition NEW -> INVESTIGATING")
            passed += 1
        else:
            print(f"[FAIL] Transition to INVESTIGATING failed: {c2}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Transition to INVESTIGATING failed: {e}")
        failed += 1

    # Case Test 3: Resolve Case (INVESTIGATING -> RESOLVED)
    try:
        c3 = update_case_status("TXN_1005", StatusUpdateRequest(status="RESOLVED"), user_email="ops@paytrace.demo")
        if c3.get("case_status") == "RESOLVED":
            print("[PASS] Status Transition INVESTIGATING -> RESOLVED")
            passed += 1
        else:
            print(f"[FAIL] Transition to RESOLVED failed: {c3}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Transition to RESOLVED failed: {e}")
        failed += 1

    # Case Test 4: Reopen Case (RESOLVED -> INVESTIGATING)
    try:
        c4 = update_case_status("TXN_1005", StatusUpdateRequest(status="INVESTIGATING"), user_email="ops@paytrace.demo")
        if c4.get("case_status") == "INVESTIGATING":
            print("[PASS] Status Transition RESOLVED -> INVESTIGATING (Reopen)")
            passed += 1
        else:
            print(f"[FAIL] Reopen transition failed: {c4}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Reopen transition failed: {e}")
        failed += 1

    # Case Test 5: Invalid Transition (NEW -> RESOLVED directly)
    try:
        update_case_status("TXN_1006", StatusUpdateRequest(status="RESOLVED"), user_email="ops@paytrace.demo")
        print("[FAIL] Invalid transition NEW -> RESOLVED succeeded unexpectedly")
        failed += 1
    except HTTPException as e:
        if e.status_code == 400:
            print("[PASS] Invalid transition NEW -> RESOLVED returned 400 Bad Request")
            passed += 1
        else:
            print(f"[FAIL] Expected 400 for invalid transition, got {e.status_code}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Invalid transition failed with unexpected error: {e}")
        failed += 1

    # Case Test 6: Add Note
    try:
        c6 = add_case_note("TXN_1005", NoteCreateRequest(message="Verified bank trace with clearing team."), user_email="ops@paytrace.demo")
        notes = c6.get("notes", [])
        if len(notes) > 0 and notes[-1].get("message") == "Verified bank trace with clearing team.":
            print(f"[PASS] Added Note persisted successfully: '{notes[-1]['message']}'")
            passed += 1
        else:
            print(f"[FAIL] Note addition failed: {c6}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Add note failed: {e}")
        failed += 1

    # Case Test 7: Case Assignment
    try:
        c7 = assign_case("TXN_1005", AssignRequest(assigned_to="Operations Staff"), user_email="ops@paytrace.demo")
        if c7.get("assigned_to") == "Operations Staff":
            print(f"[PASS] Case assigned successfully to {c7['assigned_to']}")
            passed += 1
        else:
            print(f"[FAIL] Case assignment failed: {c7}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Assign case failed: {e}")
        failed += 1

    # Case Test 8: Customer Access to Case API Forbidden (403)
    try:
        get_case("TXN_1001", user_email="customer@paytrace.demo")
        print("[FAIL] Customer accessed Case API without 403 Forbidden")
        failed += 1
    except HTTPException as e:
        if e.status_code == 403:
            print("[PASS] Customer access to Case API -> 403 Forbidden")
            passed += 1
        else:
            print(f"[FAIL] Customer Case API access expected 403, got {e.status_code}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Customer Case API test failed: {e}")
        failed += 1

    print("\n------------------------------------------")
    print(" Running Customer Support Request Tests   ")
    print("------------------------------------------")

    from main import (
        create_support_request,
        get_my_support_requests,
        get_all_support_requests,
        SupportRequestCreate,
    )

    # Support Test 1: Customer submits request for allowed transaction (TXN_1006)
    try:
        s1 = create_support_request(
            SupportRequestCreate(
                transaction_id="TXN_1006",
                issue_category="Incorrect Amount",
                message="Authorized ₹10,000 but bank settled ₹9,500."
            ),
            user_email="customer@paytrace.demo"
        )
        if s1.get("request_id") and s1.get("status") == "OPEN" and s1.get("transaction_id") == "TXN_1006":
            print(f"[PASS] Customer support request created -> ID: {s1['request_id']}")
            passed += 1
        else:
            print(f"[FAIL] Support request creation failed: {s1}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Support request creation error: {e}")
        failed += 1

    # Support Test 2: Customer submits request for unauthorized transaction (TXN_1008) -> 403
    try:
        create_support_request(
            SupportRequestCreate(
                transaction_id="TXN_1008",
                issue_category="Settlement Taking Too Long",
                message="Please check"
            ),
            user_email="customer@paytrace.demo"
        )
        print("[FAIL] Customer submitted support request for unauthorized transaction without 403 Forbidden")
        failed += 1
    except HTTPException as e:
        if e.status_code == 403:
            print("[PASS] Customer unauthorized support request -> 403 Forbidden")
            passed += 1
        else:
            print(f"[FAIL] Expected 403 for unauthorized support request, got {e.status_code}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Unauthorized support request error: {e}")
        failed += 1

    # Support Test 3: Customer retrieves own requests
    try:
        my_reqs = get_my_support_requests(user_email="customer@paytrace.demo")
        if isinstance(my_reqs, list) and len(my_reqs) > 0 and my_reqs[0]["transaction_id"] == "TXN_1006":
            print(f"[PASS] Customer retrieved own support requests ({len(my_reqs)} item(s))")
            passed += 1
        else:
            print(f"[FAIL] Get my support requests failed: {my_reqs}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Get my support requests error: {e}")
        failed += 1

    # Support Test 4: Operations Staff retrieves all support requests
    try:
        all_reqs = get_all_support_requests(user_email="ops@paytrace.demo")
        if isinstance(all_reqs, list) and len(all_reqs) > 0:
            print(f"[PASS] Operations Staff retrieved all support requests ({len(all_reqs)} item(s))")
            passed += 1
        else:
            print(f"[FAIL] Ops get all support requests failed: {all_reqs}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Ops get all support requests error: {e}")
        failed += 1

    # Support Test 5: Customer cannot access all support requests endpoint (403)
    try:
        get_all_support_requests(user_email="customer@paytrace.demo")
        print("[FAIL] Customer accessed /api/support/requests without 403 Forbidden")
        failed += 1
    except HTTPException as e:
        if e.status_code == 403:
            print("[PASS] Customer access to /api/support/requests -> 403 Forbidden")
            passed += 1
        else:
            print(f"[FAIL] Expected 403 for customer /api/support/requests, got {e.status_code}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Customer /api/support/requests test failed: {e}")
        failed += 1

    print("\n------------------------------------------")
    print(" Running Operations Command Center Tests  ")
    print("------------------------------------------")

    # Command Center Test 1: Operations Staff dashboard summary metrics
    try:
        cc_summary = get_dashboard_summary(user_email="ops@paytrace.demo")
        if (
            cc_summary.get("total_transactions") == 15
            and cc_summary.get("settled_count") is not None
            and cc_summary.get("active_investigations") is not None
            and cc_summary.get("pending_count") is not None
            and cc_summary.get("reconciliation_rate") is not None
            and cc_summary.get("overall_health") in ["HEALTHY", "ATTENTION_REQUIRED", "CRITICAL"]
            and "system_breakdown" in cc_summary
            and "gateway" in cc_summary["system_breakdown"]
            and "bank" in cc_summary["system_breakdown"]
            and "ledger" in cc_summary["system_breakdown"]
            and "exception_distribution" in cc_summary
        ):
            print(f"[PASS] Command Center summary returned complete ecosystem metrics (Health: {cc_summary['overall_health']}, Recon Rate: {cc_summary['reconciliation_rate']}%)")
            passed += 1
        else:
            print(f"[FAIL] Unexpected Command Center summary metrics: {cc_summary}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Command Center summary test failed: {e}")
        failed += 1

    # Command Center Test 2: Customer access to dashboard summary is forbidden (403)
    try:
        get_dashboard_summary(user_email="customer@paytrace.demo")
        print("[FAIL] Customer accessed dashboard summary without 403 Forbidden")
        failed += 1
    except HTTPException as e:
        if e.status_code == 403:
            print("[PASS] Customer access to /api/dashboard/summary -> 403 Forbidden")
            passed += 1
        else:
            print(f"[FAIL] Customer dashboard summary expected 403, got {e.status_code}")
            failed += 1
    except Exception as e:
        print(f"[FAIL] Customer dashboard summary test failed: {e}")
        failed += 1

    print("------------------------------------------")
    print(f"Summary: {passed} PASSED, {failed} FAILED")
    print("------------------------------------------")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()


