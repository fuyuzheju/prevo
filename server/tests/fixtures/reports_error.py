"""Test fixture: reports a structured failure the way main.py does.

Used to exercise the adapter's `ok: false` path.
"""
import json
import sys

json.dump({"ok": False, "error": {"code": "PREDICT_FAILED", "message": "boom"}},
          sys.stdout)
sys.stdout.flush()
sys.exit(1)
