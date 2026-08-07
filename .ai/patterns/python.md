# Python patterns — the failure modes to check before you write Python here

Every rule below carries the failure it prevents, so you can tell when it applies and argue with it when it does not.

This is a reference, not a tutorial.
It assumes you can already write Python and covers only what agents reliably get wrong in it — which is a much shorter list than "Python".
It governs **every line of Python you write or modify in this repository**: application code, maintenance scripts, and tests.
It does not describe this project's architecture, data model, services, or sharp edges — those live in [`../instructions/PROJECT.md`](../instructions/PROJECT.md).
It does not govern prose, help topics, or the wording of user-facing documentation — that is [`../skills/docs-author/references/PROSE-STYLE.md`](../skills/docs-author/references/PROSE-STYLE.md).
The authoritative operating contract is [`../instructions/CORE.md`](../instructions/CORE.md): §2 governs the runtime, the build step, the test command, and what counts as optional tooling; §3 governs secrets; §5 governs git, publishing, and `CHANGELOG.md`.
**Where this file and CORE.md disagree, CORE.md wins** — this file is downstream of the contract, and a pattern that contradicts a rule is the pattern that is wrong.

---

## The project's Python settings

**Read this table before the rules, because most of the rules are conditional on it.**
A style guide that does not know which interpreter it is targeting gives advice that is correct in general and broken here.

| setting | this project's answer |
|---|---|
| interpreter version | **Python 3.14.0** — what is installed on the owner's machine, and the only interpreter this project has been run against. Nothing is pinned by a manifest, because there is no manifest. |
| the dependency manifest | **`requirements.txt` at the repo root.** Written for `supabase/admin/`, which needs `psycopg2` from a project-local `.venv/`; it now also carries the two `scripts/` carve-outs below. Adding a dependency under `scripts/` is a decision recorded in `docs/decisions/`, not a side effect of needing an import. |
| the dependency policy | **two tiers, with three named exceptions.** `scripts/` is **standard library by default** and must run on any machine with Python 3 and no install step — that is what lets a teammate clone and immediately grade, build or sync. `supabase/admin/` may use `psycopg2` from a gitignored `.venv/`. Never blur them: a stdlib script that grows an import stops working on the machine that needed it most. **The exceptions are the three `scripts/fall2026/` term builders**, which need `python-docx` and `tzdata` ([`docs/decisions/SCRIPTS-DOCX-DEPENDENCY.md`](../../docs/decisions/SCRIPTS-DOCX-DEPENDENCY.md)). They are term-build tooling run twice a year by a course director; **nothing the lesson cycle runs is in that set.** |
| the formatter | **none installed.** Match the layout of the surrounding code by hand. |
| the linter | **none installed.** |
| the type checker | **none installed.** |
| the test framework | **none for Python** — but the repo is not untested. `supabase/admin/*_test.py` are self-contained assertion scripts run directly (`app_rls_test.py`, `grade_interactive_test.py`, …), and `tests/app-schema/` is an OPTIONAL Node harness. Nothing on the deploy path requires either. |
| the test command | **per script**, e.g. `.venv/Scripts/python supabase/admin/app_tier_check.py`. Plus `python scripts/docs/check_doc_sources.py` and, for UI, a browser against `python -m http.server 8000`. **A Node-only check is never the sole verification of a change** (CORE.md §2) — if it is all you ran, say so in `CHANGELOG.md`. |
| the lint command | **none.** |

> **No formatter, linter or type checker is installed, and that changes how you read the rest of this file.**
> Many rules below say "the linter will sort this", "the type checker turns this into a gate", "the formatter decides layout". **None of those tools exist here yet, so every one of those clauses currently means "enforced by review alone" — by one person, with no second reviewer** (`PROJECT.md` §5).
> Read the rules as advice you have to follow deliberately, because nothing will catch you. When a tool is eventually chosen, fill it into the table above and delete this banner in the same change.

The hard rule, stated once so the rest of the file can assume it:

> **This project is standard-library-only: do not add a dependency at all.** And do not use a language or standard-library feature newer than Python 3.14.0.
> Both failures have the same shape and it is the worst shape available: the code is fine on your machine, passes review because it reads correctly, and dies at the first line of the first run in production with an `ImportError` or a `SyntaxError` — before any of your error handling exists to catch it.
> A `match` statement needs 3.10, `tomllib` needs 3.11, and `X | Y` in an annotation needs 3.10 unless the module opts in with `from __future__ import annotations` ([PEP 604](https://peps.python.org/pep-0604/)).
> If you do not know the version, read CORE.md §2 rather than guessing from what your interpreter accepts.

> **An importable package is not a permitted dependency, and this machine now proves the difference.**
> `pypdf` and `pymupdf` are both installed here — `pymupdf` deliberately, on 2026-08-04, because the
> equations in the OpenStax lesson PDFs are vector paths that only a rasterizer can read
> (`PROJECT.md` §9). **They were installed for an agent to read a PDF with, not for this project to
> depend on, and nothing under `scripts/` imports either one.**
> The trap is that `import pymupdf` will simply *work* if you try it here, so the policy above fails
> silently rather than loudly — you would discover it on the next operator's machine, which is
> exactly the "fine on your machine, dies on first run" shape this section is about.
> **The test is not "does it import?" but "is it in the standard library?"** If a `scripts/` file ever
> genuinely needs one, that is a `docs/decisions/` entry and a manifest, not an import line.

> **And there is one case where "is it in the standard library?" is not sufficient either.**
> `zoneinfo` is stdlib since 3.9 and passes every test above — but it **ships no data**. It reads the
> operating system's IANA tz database, and Windows does not have one. `ZoneInfo("America/Denver")`
> therefore works on macOS and Linux and raises `ZoneInfoNotFoundError` on a stock Windows machine,
> which is this project's primary platform. The documented fallback is the `tzdata` package, now
> pinned in `requirements.txt` for the two term builders that need it.
> This one dies **loudly**, on the first line of the first run, which is the merciful version — a
> tz-naive fallback would have written silently wrong deadlines. But the lesson generalises:
> **a stdlib module can still carry a platform dependency, and only running it on the target
> platform will tell you.** Confirmed 2026-08-07, when fixing an unrelated hardcoded path made the
> Physics 110 term builder runnable on Windows for the first time and it failed here instead.

---

## 1. The dependency question comes first

**Adding an import is a decision, not a detail.**
Treat it that way before you type it — because the cost of a dependency is paid forever and the convenience it bought is paid once.

**Check the dependency policy before you reach for anything outside the standard library.**
Some projects in this kit's world are deliberately standard-library-only, and they are that way for a reason someone wrote down: no install step, no lockfile drift, no supply-chain surface, and a script that runs anywhere Python runs.
An agent that reaches for `requests` inside one of those projects has not saved four lines of `urllib.request` — it has broken the deploy for a stylistic preference, and the breakage lands on whoever runs the thing next rather than on the agent that caused it.

**Prefer the standard library when it is merely less pleasant, not when it is genuinely wrong.**
`urllib.request`, `json`, `csv`, `sqlite3`, `argparse`, `pathlib`, `dataclasses`, `datetime`, `subprocess`, `hashlib`, `unittest` — these cover most of what an internal tool needs, and none of them can go missing.
Reach outside for genuine domain problems: a wire protocol you would otherwise reimplement, a cryptographic primitive, a data format with a hostile spec.
**Never reach outside for a convenience wrapper over something you can write in ten lines** — the wrapper has a maintainer, a release cadence, a CVE feed, and a transitive tree, and you have inherited all four.

If a dependency is genuinely warranted, add it the way the dependency manifest expects, in the same change, with a pin — a dependency added to the import line and not to the manifest is a build that works exactly once, on the machine that already had it.
Modern projects declare this in `pyproject.toml` ([PEP 621](https://peps.python.org/pep-0621/)); follow whatever this project already does rather than introducing a second mechanism alongside it.

**A new dependency is a change to the project's supply chain, and it outlives the convenience it bought.**
State it in `CHANGELOG.md` per CORE.md §5, and say why the standard library was not enough — because the next person to audit the tree needs the reason, and "it was already there" is not one.

---

## 2. Mutable defaults and shared state

The classic Python trap, and agents still write it.
The mechanism is the whole explanation: **a default argument is evaluated once, when the `def` statement runs, not on each call** — so a mutable default is one object shared by every caller for the life of the process ([Python tutorial, *Default Argument Values*](https://docs.python.org/3/tutorial/controlflow.html#default-argument-values)).

```python
# ❌ one list, created at import, shared by every call forever
def add_tag(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags

# ✅ None is the sentinel; each call gets its own list
def add_tag(tag: str, tags: list[str] | None = None) -> list[str]:
    tags = [] if tags is None else tags
    tags.append(tag)
    return tags
```

The failure is not a crash.
The failure is that the second caller sees the first caller's data, the tests pass because each test runs against a fresh import, and the bug appears in a long-running process as data leaking between unrelated requests.
**This is the bug class that looks like corruption and gets debugged as a database problem.**
Google's Python style guide bans mutable default values outright for exactly this reason ([Google Python Style Guide, *Default Argument Values*](https://google.github.io/styleguide/pyguide.html#212-default-argument-values)).

**The same rule applies to any default whose value is computed at definition time**, not just containers.
`def log(when: datetime = datetime.now())` records the moment the module was imported, in every entry, forever — and it is the kind of wrong that reads as right.

**Mutable class attributes are the same trap wearing a class.**
A `list` or `dict` assigned in the class body is one object on the class, shared by every instance — so `self.items.append(x)` in one instance mutates the attribute every other instance is reading.
Assign per-instance state in `__init__`, or use a `dataclass` with `field(default_factory=list)` (§6).

---

## 3. Types and interfaces

**Put type hints on every public function and method signature** — parameters and return ([PEP 484](https://peps.python.org/pep-0484/)).
The reason is not documentation for its own sake: hints are the only documentation a machine can check, and the type checker turns them from a claim into a gate that fails the build.
Everything else you write about an interface — the docstring, the comment, the design doc — drifts silently the moment the code changes.

**A hint that lies is worse than no hint**, because everything downstream trusts it.
A function annotated `-> str` that returns `None` on the empty path teaches the type checker to approve every caller that immediately calls `.strip()` on the result, and the `AttributeError` surfaces three modules away from the lie.
No hint at least leaves the caller suspicious.

**Be honest about `None`.**
If a function can return nothing, the return type says so — `str | None` on 3.10 and later, `Optional[str]` before that.
The temptation is to annotate the happy path and let the `None` case be "obvious"; it is obvious to you today and invisible to the checker, which is the only reader that matters here.

**Do not use `Any` to make the type checker stop complaining.**
`Any` is compatible with every type in both directions, so annotating a parameter `Any` does not describe it — it switches checking off for everything that touches it ([typing docs, `Any`](https://docs.python.org/3/library/typing.html#typing.Any)).
An error the checker reports is either a real bug or a wrong annotation, and both are worth ten minutes.
Silencing it converts a compile-time failure into a runtime one and moves it to production.
The same goes for a blanket `# type: ignore` — if you must suppress, suppress the specific code on the specific line and say why in a comment.

**Prefer precise container types.**
`dict[str, int]` tells a reader and a checker what a lookup returns; `dict` tells them nothing, and the code that indexes it is unverified.
On Python 3.14.0 at 3.9 or later, use the builtin generics `list[str]` and `dict[str, int]` rather than the deprecated `typing.List` aliases ([PEP 585](https://peps.python.org/pep-0585/)).
For parameters, accept the widest type you actually use — `Iterable[str]` if you only iterate, `Sequence[str]` if you also index — and return the narrowest concrete type you actually produce.

**Docstrings state what the code cannot.**
Types carry the shape; the docstring carries the contract — what it raises, what it mutates, what a caller must guarantee ([PEP 257](https://peps.python.org/pep-0257/)).
A docstring that restates the signature in English is noise that has to be maintained.

---

## 4. Errors and exceptions

**Catch the narrowest exception that can actually occur at that line.**
A bare `except:` or an `except Exception:` does not catch "errors" — it catches your typo, your `AttributeError` from a rename, and on a bare clause it catches `KeyboardInterrupt` and `SystemExit` too, so the process you are trying to stop with Ctrl-C ignores you ([PEP 8, *Programming Recommendations*](https://peps.python.org/pep-0008/#programming-recommendations)).
**The bug you are hunting is inside the block you wrapped**, and the handler is what is hiding it from you.

**Never silently `pass` in an exception handler.**
The Zen of Python states the rule as plainly as it can be stated: errors should never pass silently, unless explicitly silenced ([PEP 20](https://peps.python.org/pep-0020/)).
If a failure genuinely does not matter, silencing it is a decision — write `except FileNotFoundError:  # first run, no cache yet` so the next reader knows it was considered rather than swallowed.
A bare `pass` is indistinguishable from an unfinished edit.

**Raise specific exceptions with messages that locate the problem.**
`raise ValueError("invalid input")` costs the reader everything the code already knew — which input, which field, which file, which value.
Include the identifier and the offending value; exclude anything CORE.md §3 calls a secret.

**Preserve the chain with `raise ... from err`.**
Re-raising inside a handler without `from` still chains implicitly, but it reports the original as an accident that happened *during* handling rather than as the cause; `from err` states the causal relationship explicitly and makes the traceback read correctly ([Python tutorial, *Exception Chaining*](https://docs.python.org/3/tutorial/errors.html#exception-chaining)).

```python
# ❌ catches everything, discards what was wrong, reports the cause as a coincidence
try:
    config = json.loads(raw)
except Exception:
    raise ValueError("bad config")

# ✅ narrow catch, locatable message, cause stated
try:
    config = json.loads(raw)
except json.JSONDecodeError as err:
    raise ValueError(f"{path} is not valid JSON at line {err.lineno}: {err.msg}") from err
```

**Use EAFP where it is idiomatic, and LBYL where a miss is a real error.**
Python's own glossary names the two styles and prefers "easier to ask forgiveness than permission" for the common case ([Python glossary, *EAFP*](https://docs.python.org/3/glossary.html#term-EAFP)).
`try: return cache[key] / except KeyError: ...` is clean.
But a `try` that wraps twenty lines to catch one expected `KeyError` also catches the nineteen other lines' bugs — **keep the `try` block down to the statement that can actually raise.**

**Every resource goes under a `with`.**
Files, locks, connections, cursors, temporary directories, subprocess pipes.
An exception raised between the open and the close skips the close, and on CPython the refcount usually saves you — until the object is caught in a reference cycle, or the code runs somewhere that is not CPython, and then you leak handles until the process hits its descriptor limit.
`with` is the only form that closes on the exception path as reliably as on the happy path.
If you are managing something that has no context manager, `contextlib.contextmanager` gives you one in five lines.

---

## 5. Idioms that separate Python from transliterated C

None of this is about elegance.
Each of these replaces an index expression you can get wrong with one you cannot.

| instead of | write | because |
|---|---|---|
| `for i in range(len(xs))` | `for x in xs` or `for i, x in enumerate(xs)` | the index exists only to be dereferenced, and it is one off-by-one away from a silent wrong answer |
| parallel indexing into two lists | `for a, b in zip(xs, ys)` | mismatched lengths are handled by `zip` instead of by an `IndexError` in production |
| `out = []` then `out.append(...)` in a loop | a comprehension | the accumulator is three lines of scaffolding whose only failure mode is being reset in the wrong place |
| `os.path.join`, `.split("/")`, string suffix checks | `pathlib.Path` | separator handling is platform-specific and hand-rolled path math breaks on the first Windows box ([pathlib](https://docs.python.org/3/library/pathlib.html)) |
| `"a" + str(x) + "b"` or `"%s" % x` | an f-string | concatenation hides type errors until runtime and `%` formatting silently accepts the wrong argument count |
| `d[k]` guarded by `if k in d` | `d.get(k, default)` | the guard and the access can drift apart, and then the guard checks a different key |

**State the limit honestly: a comprehension that needs a comment is a loop.**
Two nested `for` clauses plus a condition plus a ternary is not concise, it is compressed — and the reader who has to decompress it would have read the loop faster.
Same for chained `lambda`, and same for a one-liner that reaches 100 characters.
Readability is the point of every entry in that table; a comprehension that costs readability has stopped serving the rule it came from.

**Unpack rather than index into tuples.**
`name, count = row` documents the shape at the point of use; `row[0]` and `row[1]` document nothing and survive a column reorder without complaint.

---

## 6. Data structures and dataclasses

**Prefer a `dataclass` or a typed `NamedTuple` over a dict-of-strings for anything with a fixed shape.**
A dict has no schema, so a typo in a key is not an error — it is a new key on write and a `KeyError` on read, discovered at runtime by whoever is unlucky, usually in the path that runs least often.
A dataclass field is checked by the type checker, autocompleted by the editor, and found by every rename tool; a string key is found by grep and hope.

```python
@dataclass(frozen=True)
class Rate:
    currency: str
    value: Decimal

@dataclass
class Batch:
    name: str
    rates: list[Rate] = field(default_factory=list)  # `= []` is refused outright
```

**Use `frozen=True` for value objects** — anything that represents a measurement, a configuration, a key, or a result rather than a thing that changes.
Frozen instances are hashable and cannot be mutated by a distant caller who received a reference and assumed it was theirs, which is the aliasing bug that costs the most to find.

**`field(default_factory=list)` is §2's rule again, enforced by the library.**
`dataclasses` refuses a mutable default at class-creation time rather than letting you ship the shared-object bug ([dataclasses](https://docs.python.org/3/library/dataclasses.html)).
Take the refusal as information: wherever you see it, the same mistake is available in ordinary function signatures where nothing will stop you.

Keep the dict for what a dict is for — genuinely dynamic keys, data whose shape is decided by an external source, and lookups.
**A dict with a fixed, known set of keys is a class that was never written.**

---

## 7. Imports and module structure

**Absolute imports only.**
PEP 8 recommends them because they are more readable and better behaved, and the concrete payoff is that the same import line works whether the module is run as a script, imported by a test, or loaded by a tool that did not set your package root ([PEP 8, *Imports*](https://peps.python.org/pep-0008/#imports)).

**Group imports in three blocks, blank-line separated: standard library, third party, then local** ([PEP 8](https://peps.python.org/pep-0008/#imports)).
the linter will sort them; the grouping exists so a reader can answer "what does this module depend on that could be missing?" by looking at one block instead of reading thirty lines.

**No wildcard imports.**
`from module import *` defeats every tool that resolves names — the linter cannot tell an undefined name from an imported one, the type checker loses the source, and a `NameError` at runtime gives you no module to look in.
PEP 8 says to avoid them because they make it unclear which names are present in the namespace, confusing both readers and automated tools ([PEP 8](https://peps.python.org/pep-0008/#imports)).
The one exception people cite — re-exporting in `__init__.py` — is better served by an explicit `__all__`.

**No import-time side effects.**
A module that opens a database connection, reads a config file, makes a network call, or writes a log line at import time is a module that cannot be tested, cannot be introspected, and cannot be imported by a tool that only wanted to read its docstring.
The concrete failure: the test suite now needs a live database to *collect* tests, and `--help` fails before `argparse` has a chance to run.
Define functions and constants at module level; do work inside functions.

**Guard the entry point with `if __name__ == "__main__":`** and keep it to argument parsing plus one call ([`__main__`](https://docs.python.org/3/library/__main__.html)).
Without the guard, importing the module runs it — which is exactly what a test collector, a documentation generator, and `multiprocessing` all do.

---

## 8. Scripts that mutate anything

This section is not style.
It is CORE.md §0 and §4 restated in Python, and [`safe-change`](../skills/safe-change/SKILL.md) Step 2 is the full procedure.

**Every mutating script is idempotent and dry-run by default: it prints the plan and requires an explicit `--commit` to write.**
The flag is the gate, and the reason is behavioural — a script that writes when invoked with no arguments will eventually be invoked with no arguments, by a shell history recall, by a copy-paste that lost its tail, or by an agent reconstructing a command it saw once.

**The dry-run must build the same payload the commit would write.**
A dry-run that computes the plan one way and executes it another proves nothing about what will happen; it proves that a description of the change is printable.
Print counts and a sample of the real objects, then compare the count against the one you measured before you started.

**Use `argparse`, and exit with codes that mean something.**
`0` for success, non-zero for failure, and distinct non-zero codes when a caller might reasonably branch on the reason ([argparse](https://docs.python.org/3/library/argparse.html)).
A script that prints "ERROR" and exits `0` is a script that every wrapper, cron job, and CI step will report as a success.
**Write errors and diagnostics to `stderr` and data to `stdout`**, so the script can be piped without its complaints landing in the output file.

**Never put a credential in a script, a log line, a URL, a query string, or an error message** (CORE.md §3).
Read secrets from the environment or from the config file named in §3, and if you must confirm a value, print a mask — first few characters, then an ellipsis.
An exception message that interpolates the whole request is how a token ends up in a traceback, in a log aggregator, and in a transcript.

**When you rewrite a file you did not create, work in bytes.**
`open(p, encoding="utf-8").read()` opens in **text mode**, and universal newlines turns every `\r\n` into `\n` before your code sees it; write that string back and the file's CRLF endings are gone ([open](https://docs.python.org/3/library/functions.html#open)).
On this Windows repository that is not cosmetic: a 12-string substitution across three artifacts produced `6327 insertions(+), 6327 deletions(-)` — every line of every file, with the three real changes buried inside — and `.gitattributes` marks `courses/** -text`, so git stores the damage verbatim rather than normalizing it away (`PROJECT.md` §9).
Use `open(p, "rb")` / `open(p, "wb")`, or pass `newline=""` to **both** ends, and then **read `git diff --stat` before staging**: an edit whose diff is the size of the file is a line-ending rewrite until proven otherwise.
The general form is the one worth carrying — **a "read, transform, write" round trip is only lossless if both ends agree on the encoding *and* the newline handling**, which is the same failure the `verify.py` pipe bug is (`PROJECT.md` §9), one layer down.

---

## 9. Testing

**No Python test FRAMEWORK is chosen**, so this section is the standard to meet rather than a description of what exists. It is not true that nothing is tested: `supabase/admin/*_test.py` are assertion scripts run directly, and they are the shape to copy until a framework is chosen.
Until then, "verified" means you ran the three checks in CORE.md §4 and executed the path you changed, and `CHANGELOG.md` says that is what you did.
Once a suite exists, run it once before you change anything, so a failure you see afterwards is unambiguously yours.

**Test behaviour, not implementation.**
Assert on what the function returns, raises, or writes — not on which private helper it called or how many times.
A test bound to the implementation fails on every refactor that changed nothing observable, and a suite that cries wolf on refactors is a suite people start deleting tests from.

**One assertion concept per test**, with a name that says what it establishes.
`test_total_excludes_refunded_items` tells you what broke from the failure line alone; `test_billing` requires you to read the body to learn what the regression is.
Several `assert` statements are fine when they check one idea from several angles; two unrelated ideas are two tests, because the first failure hides the second.

**Use fixtures rather than copied setup** ([pytest fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html)).
Duplicated setup drifts: someone updates the constructor in nine tests and misses the tenth, and the tenth now tests a shape the code no longer produces while still passing.

**A test that mocks the thing it is testing verifies only that the mock was configured.**
This is the single most common way an agent produces a green suite over broken code — the patch replaces the function under test, the assertion checks the patched return value, and the test would pass if the real implementation were deleted.

```python
# ❌ patches the function under test; passes even if `total` is deleted
def test_total(monkeypatch):
    monkeypatch.setattr(billing, "total", lambda cart: 42)
    assert billing.total(cart) == 42

# ✅ patches the boundary, exercises the real logic
def test_total(monkeypatch):
    monkeypatch.setattr(billing, "fetch_rate", lambda currency: Decimal("2.0"))
    assert billing.total(Cart(items=[Item(price=Decimal("10"))])) == Decimal("20.0")
```

**Mock the boundary, never the subject.**
The network call, the clock, the filesystem, the paid API — those are boundaries.
Everything inside your own module is the subject, and replacing it removes the thing the test was for.
When you do mock, prefer an autospecced mock so a call with a signature the real object would reject fails in the test rather than passing ([`unittest.mock`, *Autospeccing*](https://docs.python.org/3/library/unittest.mock.html#autospeccing)).

**Write the test that fails first.**
For a bug fix, a test that passes before your change proves nothing about the fix — it only proves the test does not reach the bug.

---

## 10. Performance, honestly

**Do not optimize without measuring.**
The instinct to hand-optimize is almost always aimed at the wrong line, and it is paid for in readability at the exact moment you are least sure the change helped.
Knuth's warning about premature optimization is old and still correct; the modern form is that CPython's costs are not where they look, and `cProfile` and `timeit` are three lines of work ([profiling](https://docs.python.org/3/library/profile.html)).

The short list of things that are reliably worth doing without a profile, because each one changes the complexity class or avoids a known quadratic:

| do this | instead of | why |
|---|---|---|
| `"".join(parts)` | `s += part` in a loop | repeated concatenation can rebuild the whole string each time; `join` allocates once ([Python FAQ](https://docs.python.org/3/faq/programming.html#what-is-the-most-efficient-way-to-concatenate-many-strings-together)) |
| `set` or `dict` for membership | `x in some_list` inside a loop | list membership is a linear scan, so the loop is quadratic and only shows up when the data grows |
| a generator or `yield` | building the whole list first | a large stream held entirely in memory is a `MemoryError` waiting for a bigger input file |
| one pass building a lookup dict | re-scanning a list per item | this is the same quadratic as above wearing a different shape, and it is the most common one in agent-written code |

**Everything else needs a profile first.**
Micro-rewrites, caching, "avoiding function call overhead", replacing a comprehension with a loop or the reverse — if you cannot state the before and after numbers, you have not optimized anything, you have only made the code harder to read.
And if the numbers do not move, revert the change: an unmeasured optimization that stays in the codebase is a permanent readability cost against a benefit nobody ever confirmed.

---

## 11. Formatting and tooling are the mechanism

**the formatter decides layout and the linter decides what counts as an error.
Do not argue with the formatter and do not hand-format.**
The whole value of a deterministic formatter is that layout stops being a decision — Black's own documentation puts it as ceding control over the minutiae of hand-formatting in exchange for speed, determinism, and freedom from style debates in review ([Black](https://black.readthedocs.io/en/stable/the_black_code_style/current_style.html)).
Hand-aligning something the formatter will re-wrap produces a diff that changes lines you did not touch, and the reviewer now has to find your edit inside it.

**When a linter is eventually configured, run it before you commit and fix what it reports rather than suppressing it.** There is none today (see the settings table), so the rest of this paragraph is the standard to hold yourself to rather than a command to run.
A `# noqa` with no code and no reason is a permanent exemption granted by whoever was in the most hurry ([Ruff](https://docs.astral.sh/ruff/)).
If a rule is genuinely wrong for this project, disable it in the project configuration where it is visible and reviewable — not on the line, where it is invisible to everyone who did not already suspect it.

**A rule with no mechanism rots.**
That is why this section is short and why the two commands matter more than the twelve sections above them: the tools are the only part of this file that runs.

---

## 12. When an AI wrote the code

Model-written Python fails in specific, recognizable ways.
Read your own diff looking for exactly these, because each one reads as correct and none of them is caught by reading alone:

- **Invented library functions, methods, and keyword arguments.** The call is plausible, the name is what the API *should* have been called, and it does not exist in the pinned version. This is the highest-frequency fabrication, and it is silent until the line executes — which, in an error path, may be weeks.
- **Over-broad `try/except` added to make an error go away.** An exception appeared, a handler was wrapped around it, and the error is now invisible rather than fixed. **A handler written to silence a traceback is a bug with a lid on it** (§4).
- **Type hints that are decorative rather than checked.** Annotations added because the style guide asked for them, never run through the type checker, and wrong in the places that matter — the `None` return, the container element type, the `Any` that was there to stop a complaint.
- **Mocked tests that assert nothing real.** A green suite over code that was never executed, because the mock replaced the subject (§9). Green is not evidence; a test that fails when you break the code is evidence.
- **Imports added without checking the dependency policy.** The convenient library, added to the import block and not to the manifest, in a project that may be standard-library-only on purpose (§1).
- **Symmetrical over-structuring.** Every function given the same docstring template and the same defensive wrapper whether or not it needed one, which buries the two places that actually needed care.

**The rule: run it, run the tests, and run the linter before you claim it works.**
"This should work" is not a verification — it is a prediction, and the reason to run the code is that predictions about code are wrong at a rate nobody finds acceptable once they have measured it.
Execute the path you changed, run the three checks in CORE.md §4, and say in your report which you actually ran. There is no linter and no Python test framework yet — when there are, they join that list. The `supabase/admin/*_test.py` scripts DO exist and count; run the ones your change touches. Their narrowness is exactly why the "execute the path you changed" half is not optional.

**Code that is confidently wrong costs more than code that is missing.**
Missing code fails loudly and immediately at the call site.
Wrong code passes review, ships, and is trusted by everything built on top of it — and the cost of removing it grows with every caller added in the meantime.

---

## Checklist before you commit Python

Run this against the diff.
Every item is checkable by looking or by running something — none of it requires judgement about taste.

- [ ] Every language and standard-library feature used is available in Python 3.14.0.
- [ ] **No new dependency.** This project is standard-library-only and has no manifest to declare one in; adding either is a decision for recker, recorded in `docs/decisions/`.
- [ ] Type hints on every public signature. No type checker is installed, so this one is on you — no new `Any` and no unexplained `# type: ignore`.
- [ ] No bare `except:` and no `except Exception:` outside a top-level handler that logs and re-raises.
- [ ] No exception handler that silently passes; every deliberate silence carries a comment saying why.
- [ ] Re-raises inside handlers use `raise ... from err`.
- [ ] No mutable default argument, and no mutable class attribute standing in for instance state.
- [ ] Every file, lock, connection, and subprocess is opened under `with`.
- [ ] Imports are absolute, grouped standard library / third party / local, with no wildcard import.
- [ ] No work happens at import time; the entry point is behind `if __name__ == "__main__":`.
- [ ] Every mutating script is idempotent, dry-run by default, and requires `--commit` to write.
- [ ] Errors go to `stderr` and the exit code is non-zero on failure.
- [ ] No credential in code, in a log line, in a URL, or in an error message (CORE.md §3).
- [ ] No test mocks the function it is testing; each new test fails when the code under it is broken.
- [ ] The three checks in CORE.md §4 pass, and you ran them rather than assuming it. (No lint command yet. If your change touches `supabase/admin/`, the matching `*_test.py` belongs on this line too.)
- [ ] Layout matches the surrounding code. No formatter is installed, so this is done by eye.
- [ ] The changed path was actually executed at least once, not just read.
- [ ] `CHANGELOG.md` is updated per CORE.md §5, including what you deliberately did not do.
