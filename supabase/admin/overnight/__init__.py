"""The overnight AI grader for PREP (staging only). See docs/operations/OVERNIGHT-GRADER.md.

Run through `supabase/admin/overnight_grade.py`. This package holds no credential and imports no
database driver at import time, so its logic is testable offline against a fake store and a
fake language-model client.
"""
PROMPT_VERSION = "grade-1"
AGG_PROMPT_VERSION = "aggregate-1"
RUNNER = "overnight_grade.py"

# Exit codes. One number per kind of stop, so a wrapper can tell "owed something" from "refused".
EXIT_OK = 0
EXIT_CRASH = 1
EXIT_PARTIAL = 10
EXIT_REFUSED = 20      # a safety gate: wrong target, wrong --expect-ref, bad file mode
EXIT_CONFIG = 30       # config or credential missing, unreadable, malformed
EXIT_LLM = 40          # GenAI.mil unusable: key locked, no usable model, auth failure
EXIT_DB = 50
EXIT_LOCKED = 75       # another run holds the lock
