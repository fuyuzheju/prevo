"""Test fixture: never produces output, so the adapter must time it out.

Used to exercise the adapter's timeout path.
"""
import time

time.sleep(600)
