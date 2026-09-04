import csv
import os
from typing import Dict, List, Any

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def load_csv_data(filename: str) -> List[Dict[str, str]]:
    filepath = os.path.join(DATA_DIR, filename)
    if not os.path.exists(filepath):
        return []
    with open(filepath, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        records = []
        for row in reader:
            clean_row = {k.strip(): (v.strip() if v else None) for k, v in row.items()}
            records.append(clean_row)
        return records


def get_all_records_by_datasource() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "gateway": load_csv_data("gateway_transactions.csv"),
        "bank": load_csv_data("bank_settlements.csv"),
        "ledger": load_csv_data("internal_ledger.csv"),
    }


def get_transaction_bundle(transaction_id: str) -> Dict[str, Any]:
    all_data = get_all_records_by_datasource()
    
    gw_rows = [r for r in all_data["gateway"] if r.get("transaction_id") == transaction_id]
    bank_rows = [r for r in all_data["bank"] if r.get("transaction_id") == transaction_id]
    ledger_rows = [r for r in all_data["ledger"] if r.get("transaction_id") == transaction_id]
    
    return {
        "transaction_id": transaction_id,
        "gateway_rows": gw_rows,
        "bank_rows": bank_rows,
        "ledger_rows": ledger_rows,
    }


def get_all_transaction_ids() -> List[str]:
    all_data = get_all_records_by_datasource()
    txn_ids = set()
    for source in ["gateway", "bank", "ledger"]:
        for r in all_data[source]:
            tid = r.get("transaction_id")
            if tid:
                txn_ids.add(tid)
    return sorted(list(txn_ids))
