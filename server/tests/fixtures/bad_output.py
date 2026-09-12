"""Test fixture: exits successfully but prints something that is not JSON.

Used to exercise the adapter's unparseable-output path.
"""
import sys

sys.stdout.write("{not json at all")
sys.stdout.flush()
sys.exit(0)
