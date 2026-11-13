"""Run git with a scrubbed environment and no repository-controlled behaviour. Standard library only.

WHY
  A checkout that an AI has written to can carry a hostile .git/config (fsmonitor, filters, sshCommand, a remote
  rewrite) or hooks. Any git call that must touch such a tree, or hand a credential to a child, goes through
  here: no secret reaches the process, no repository config or hook runs (the user's own global and system config are kept), and no hook, fsmonitor or attribute
  file can run.

WHAT IT DOES
  env()    a copy of os.environ without STAGING_* and without any name containing PASSWORD, SECRET, TOKEN or KEY,
           without the variables that redirect git or inject config (GIT_DIR, GIT_CONFIG_COUNT, ...), and with
           terminal prompts disabled. The user's global and system git config are KEPT (see env()).
  flags()  the -c options and --literal-pathspecs every call carries, with core.hooksPath on an EMPTY directory.
  argv()   the full command line: git <flags> -C <cwd> <args>.
"""
import atexit
import os
import re
import shutil
import subprocess
import tempfile

_DROP = re.compile(r"PASSWORD|SECRET|TOKEN|KEY", re.I)
_REDIRECT = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
             "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_EXTERNAL_DIFF")


def env():
    """The scrubbed environment. The user's global and system git config stay in force on purpose: they are
    user-owned and the AI stage cannot write them, and they hold the credential helper a push needs. What the AI
    stage CAN write is the config inside the tree it edited, and no git command runs there."""
    out = {k: v for k, v in os.environ.items()
           if not k.upper().startswith("STAGING_") and not _DROP.search(k)
           and k.upper() not in ("GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS") and k.upper() not in _REDIRECT}
    out["GIT_TERMINAL_PROMPT"] = "0"
    return out


def flags(hooks_dir):
    return ["-c", f"core.hooksPath={str(hooks_dir).replace(os.sep, '/')}", "-c", "core.fsmonitor=false",
            "-c", "core.attributesFile=", "-c", "commit.gpgsign=false", "-c", "core.pager=cat",
            "--literal-pathspecs"]


def argv(cwd, args, hooks_dir):
    return ["git", *flags(hooks_dir), "-C", str(cwd), *args]


_HOOKS = None


def hooks_dir():
    """A process-wide empty directory for callers that have no scoped one; removed at exit."""
    global _HOOKS
    if _HOOKS is None or not os.path.isdir(_HOOKS):
        _HOOKS = tempfile.mkdtemp(prefix="nohooks-")
        atexit.register(shutil.rmtree, _HOOKS, True)
    return _HOOKS


def run(cwd, *args):
    """Run one git command safely and return the CompletedProcess (bytes)."""
    return subprocess.run(argv(cwd, args, hooks_dir()), capture_output=True, env=env())
