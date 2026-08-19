#!/usr/bin/env python3
"""Move artifact sources between the local builder tree and the Supabase Storage bucket.

WHY STORAGE AND NOT THE REPOSITORY
    46 published artifacts come to ~8 MB of `.jsx`. Committing them would put that in every
    clone's history forever, and the source is not secret anyway — claude.ai shows an artifact's
    formatted source behind a Code button. So the repository keeps the human record (BUILD-LOG.md,
    REVIEW-NOTES.json, the course profiles) and Storage keeps the bytes.

    The bucket is PRIVATE and read-gated on staff. The `.jsx` is public-by-other-means; the
    BUILD RECORD is not — it carries grounding page numbers (CORE.md section 6: never surfaced
    to a cadet), the tutor prompt, and worked extension problems.

WHY THIS IS ALSO THE REVERSAL LEVER
    `purge` is the L1 lever in the import plan, and it deletes ONLY the paths listed in the
    manifest a `push` wrote. Never a prefix sweep. If somebody else has put an object in this
    bucket, purge leaves it alone and the bucket then refuses to drop — which is the correct
    outcome rather than an obstacle, because a blind sweep is how a reversal turns into an
    incident.

COMMANDS
    push          local tree -> Storage   (sources, index.json, build.json)
    pull          Storage -> a directory  (the round-trip proof, and how a fresh clone gets
                                           the sources its local review tools need)
    pull-reviews  Storage -> the repo     (review decisions made on the site, back into git)
    purge         remove everything this tool uploaded
    status        compare local and remote without changing either

USE
    python scripts/artifacts/sync_artifacts.py status
    python scripts/artifacts/sync_artifacts.py push                    # dry run
    python scripts/artifacts/sync_artifacts.py push --commit
    python scripts/artifacts/sync_artifacts.py pull --into /tmp/rt --commit
    python scripts/artifacts/sync_artifacts.py pull-reviews --commit
    python scripts/artifacts/sync_artifacts.py purge --commit

    Standard library only. Service-role key from ~/.claude/skills/preflight-analyze/config.json
    (CORE.md section 3) — that key bypasses RLS, so this tool works regardless of the browser
    policies in migration 023. Dry-run by default, idempotent: every object is compared by
    sha256 and skipped when it already matches.

SOURCE OF TRUTH FOR A PUSH
    `_builder/courses/<id>/` for the profile, BUILD-LOG.md and REVIEW-NOTES.json, and
    `_builder/courses/<id>/artifacts/*.jsx` for the sources. That artifacts directory is
    GITIGNORED — it is a local cache, populated by `pull`. During the initial import it is
    populated instead from the other repository, via --from.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import artifact_parse as ap  # noqa: E402

# BOTH streams, not just stdout. Every failure message here goes to stderr and every one of
# them contains an em dash; a cp1252 console renders those as a replacement character, which is
# how a precise instruction ("apply migration 023 first") turns into something that looks like
# corruption. Reconfiguring one stream and not the other is the version of this bug that hides.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

REPO = pathlib.Path(__file__).resolve().parents[2]
BUILDER = REPO / "_builder" / "courses"
CONFIG_PATH = pathlib.Path(os.path.expanduser("~/.claude/skills/preflight-analyze/config.json"))
BUCKET = "artifact-sources"
MANIFEST = REPO / "_snapshots" / "artifact-sources-manifest.json"
COURSES = ("phys-215", "phys-310")

EXIT_OK, EXIT_PROBLEM, EXIT_UNUSABLE = 0, 1, 2


class Unusable(Exception):
    pass


# ── Storage REST ─────────────────────────────────────────────────────────────

# A staff session, when --as-staff is in force: (url, publishable_key, access_token).
# None means the documented service-role path.
#
# WHY THIS EXISTS. This tool read a service-role key from CONFIG_PATH and nothing else, and
# that key is deliberately NOT on every operating machine any more — scoped access replaced
# it. Two pushes have now needed the same workaround: the 2026-08-14 backup-button
# republish and the 2026-08-18 PHYS 310 Lab 1 rebuild. Both swapped the request function for
# one carrying a staff session and let every other line of this tool run unchanged. Two
# incidents of one monkeypatch is the argument for a committed flag.
#
# A staff session is strictly LESS privileged than the service role: it obeys migration
# 023's RLS instead of bypassing it, and `artifact-sources` admits a director of any
# offering for writes. Per CORE.md §3 it is the right instrument for a WRITE and the wrong
# one for an AUDIT, because RLS answers "what may you see" and never "what is there".
# NOTHING IN THIS TOOL COUNTS ANYTHING — it compares local objects against the listing and
# uploads the differences — so that hazard does not arise here. Do not reuse this session to
# answer a "how many are there" question; use prep_app_read over the pooler.
_SESSION = None


def _site_config():
    """The project URL and the PUBLISHABLE key, from the committed site config.

    Both are public by that file's own declaration — the publishable key is protected by
    RLS — which is why --as-staff needs no config file of its own.
    """
    s = (REPO / "site" / "js" / "config.js").read_text(encoding="utf-8")
    url = re.search(r"https://[a-z0-9]+\.supabase\.co", s)
    key = re.search(r"['\"](sb_publishable_[A-Za-z0-9_\-]+)['\"]", s)
    if not url or not key:
        raise Unusable("could not read the project URL and publishable key from site/js/config.js")
    return url.group(0), key.group(1)


def _read_env(path):
    """A minimal KEY=VALUE parser, matching tests/browser-harness/env.mjs."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        i = s.index("=")
        v = s[i + 1:].strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[s[:i].strip()] = v
    return out


def start_staff_session():
    """Sign in as the PREP_TEST_FACULTY account from supabase/admin/.env.

    Reads the same gitignored file as tests/browser-harness/env.mjs, so there is one source
    of truth and no secret reaches a command line, a shell history, or a scratch file. The
    token lives in memory for the life of the process and is written nowhere.
    """
    global _SESSION
    env_file = REPO / "supabase" / "admin" / ".env"
    if not env_file.exists():
        raise Unusable(f"--as-staff needs {env_file}, which does not exist")

    env = _read_env(env_file)
    email = env.get("PREP_TEST_FACULTY_EMAIL")
    password = env.get("PREP_TEST_FACULTY_PASSWORD")
    if not email or not password:
        raise Unusable(f"no PREP_TEST_FACULTY_* block in {env_file}")

    url, publishable = _site_config()
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{url}/auth/v1/token?grant_type=password", data=body,
        headers={"apikey": publishable, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            token = json.loads(resp.read())["access_token"]
    except urllib.error.HTTPError as e:
        raise Unusable(f"staff sign-in failed ({e.code}): "
                       f"{e.read()[:200].decode('utf-8', 'replace')}")

    _SESSION = (url, publishable, token)
    print(f"staff session: {email} (token held in memory only, never written)")


def _cfg():
    if _SESSION is not None:
        url, _publishable, token = _SESSION
        return url, token
    if not CONFIG_PATH.exists():
        raise Unusable(
            f"no config at {CONFIG_PATH} — run /setup-preflight (CORE.md section 3),\n"
            "  or pass --as-staff to run through the PREP_TEST_FACULTY session in\n"
            "  supabase/admin/.env instead (less privileged — it obeys RLS)")
    c = json.loads(CONFIG_PATH.read_bytes().decode("utf-8"))
    return c["supabase_url"].rstrip("/"), c["supabase_service_key"]


def _req(method, path, key, data=None, ctype=None, timeout=90, extra=None):
    url, _ = _cfg()
    # With a service-role key the same value is correct in both headers. With a SESSION it is
    # not: the gateway validates `apikey` as a PROJECT key (sb_publishable_ / sb_secret_),
    # while `Authorization` carries who you are. Putting the JWT in both is how this fails,
    # and it fails as a 401 that reads like a permissions problem rather than a header one.
    if _SESSION is not None:
        _url, publishable, token = _SESSION
        headers = {"apikey": publishable, "Authorization": f"Bearer {token}"}
    else:
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if ctype:
        headers["Content-Type"] = ctype
    if extra:
        headers.update(extra)
    req = urllib.request.Request(f"{url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def require_bucket(key):
    """Fail loudly when the bucket is missing, because listing it does NOT.

    `POST /object/list/<absent bucket>` answers **200 with `[]`** — verified against this
    project on 2026-08-07. So the natural check ("list it and see") reports a bucket that does
    not exist as one that exists and is empty, and every caller downstream then draws the wrong
    conclusion: `status` prints a tidy zero, and `push` attempts 95 uploads that each fail
    separately with no statement of the actual cause.

    `GET /bucket/<id>` is the endpoint that tells the truth: 400 with `NoSuchBucket`.
    """
    code, body = _req("GET", f"/storage/v1/bucket/{BUCKET}", key, timeout=30)
    if code >= 400:
        detail = ""
        try:
            detail = json.loads(body).get("message", "")
        except Exception:  # noqa: BLE001 — the message is a nicety, the failure is the point
            pass
        raise Unusable(
            f"bucket '{BUCKET}' does not exist ({detail or code}).\n"
            "  Apply supabase/migrations/023_artifact_sources_storage.sql in the Supabase SQL\n"
            "  Editor with the SERVICE ROLE first — it creates the bucket and its four policies."
        )
    return json.loads(body)


def storage_list(key, prefix=""):
    """Every object under `prefix`, as {path: {size, etag}}.

    Storage's list endpoint is per-directory and paginated, so this walks. An entry with no
    `id` is a folder — that is the documented way to tell them apart, and treating one as an
    object yields a path that 404s on download.

    Call `require_bucket` before this. It does not check, and it cannot: see that function.
    """
    found = {}
    stack = [prefix]
    while stack:
        cur = stack.pop()
        offset = 0
        while True:
            payload = json.dumps({
                "prefix": cur, "limit": 100, "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            }).encode()
            code, body = _req("POST", f"/storage/v1/object/list/{BUCKET}", key,
                              payload, "application/json")
            if code == 404:
                raise Unusable(f"bucket '{BUCKET}' does not exist — apply migration 023 first")
            if code >= 400:
                raise Unusable(f"list failed ({code}): {body[:300].decode('utf-8','replace')}")
            rows = json.loads(body)
            if not rows:
                break
            for r in rows:
                name = f"{cur}/{r['name']}" if cur else r["name"]
                if r.get("id") is None:
                    stack.append(name)
                else:
                    md = r.get("metadata") or {}
                    found[name] = {"size": md.get("size"), "etag": (md.get("eTag") or "").strip('"')}
            if len(rows) < 100:
                break
            offset += len(rows)
    return found


def storage_put(key, path, blob, ctype):
    """Create or replace one object.

    `x-upsert` IS THE WHOLE FIX, and the bug it replaces is worth stating because the code
    looked correct. This used to POST and then retry as PUT `if code == 409` — but Storage
    does not answer a duplicate with HTTP 409. It answers **HTTP 400** carrying
    `{"statusCode":"409","error":"Duplicate","code":"KeyAlreadyExists"}` in the BODY. So the
    retry never fired, and every object that already existed failed permanently.

    The effect was that `push` could only ever CREATE. Updating an artifact was impossible —
    the first push of a slug succeeded and every later one reported "48 upload(s) FAILED",
    which read as a permissions problem and is not one. Observed 2026-08-07 while settling
    the build records; nothing had been uploaded, so no partial state resulted.

    Upserting in one request also removes the two-call race the retry had.
    """
    code, body = _req("POST", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}",
                      key, blob, ctype, extra={"x-upsert": "true"})
    if code >= 400:
        raise Unusable(f"upload {path} failed ({code}): {body[:300].decode('utf-8','replace')}")


def storage_get(key, path):
    code, body = _req("GET", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}", key)
    if code >= 400:
        raise Unusable(f"download {path} failed ({code})")
    return body


def storage_delete(key, paths):
    if not paths:
        return
    for i in range(0, len(paths), 100):
        chunk = paths[i:i + 100]
        code, body = _req("DELETE", f"/storage/v1/object/{BUCKET}", key,
                          json.dumps({"prefixes": chunk}).encode(), "application/json")
        if code >= 400:
            raise Unusable(f"delete failed ({code}): {body[:300].decode('utf-8','replace')}")


# ── what a push consists of ──────────────────────────────────────────────────

def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def build_payload(source_root):
    """Assemble every object to upload, as [{path, blob, ctype, kind}].

    Objects are keyed by SLUG, not by filename or lesson number, because the slug is the frozen
    identity that also equals `activities.slug` — which is what lets the faculty page ask "is
    this registered?" with a single join and no mapping table.
    """
    objects, report = [], []

    for course in COURSES:
        cdir = source_root / course
        art_dir = cdir / "artifacts"
        if not art_dir.is_dir():
            report.append((course, "SKIPPED — no artifacts/ directory", 0))
            continue

        prof = ap.profile_values(cdir)
        log = ap.parse_build_log(art_dir / "BUILD-LOG.md")
        reviews = {}
        rn = art_dir / "REVIEW-NOTES.json"
        if rn.exists():
            reviews = json.loads(ap.read_text(rn))

        index = []
        for jsx in sorted(art_dir.glob("*.jsx")):
            art = ap.parse_artifact(jsx)
            slug = art["slug"]
            sec = log["sections"].get(slug, {})
            rev = (reviews.get("artifacts") or {}).get(slug, {})

            raw = jsx.read_bytes()
            objects.append({"path": f"{course}/{slug}/source.jsx", "blob": raw,
                            "ctype": "text/plain", "kind": "source"})

            # The whole build record for one artifact: what the parser understood, plus the
            # raw markdown so nothing is lost to a parser that did not understand it.
            # NO `generated_at` HERE, deliberately. It used to carry
            # datetime.now(), which put a fresh value in the body on every run — so the
            # sha256 could never match and all 46 build records reported as `changed`
            # forever, on a tool whose whole contract is "idempotent, skipped when it
            # already matches". A push that always rewrites everything hides the one
            # thing the comparison exists to show: which artifact actually moved.
            # Nothing read the field. When the push happened is recorded once, in the
            # manifest's `written_at`, which is where a push time belongs.
            build = {
                "schema": 1,
                "slug": slug,
                "course": course,
                "course_id": prof.get("course_id", course),
                "artifact": art,
                "build_log": sec,
                "review": rev,
            }
            objects.append({
                "path": f"{course}/{slug}/build.json",
                "blob": (json.dumps(build, indent=1, ensure_ascii=False) + "\n").encode("utf-8"),
                "ctype": "application/json", "kind": "build",
            })

            index.append({
                "slug": slug,
                "file": art["file"],
                "lesson_no": art["lesson_no"] if art["lesson_no"] is not None
                             else sec.get("lesson_no"),
                "title": sec.get("heading") or art["lesson_id"] or slug,
                "component": art["component"],
                "version": art["version"],
                "built": sec.get("meta", {}).get("Built", ""),
                "published_url": sec.get("published_url", ""),
                "published_on": sec.get("published_on", ""),
                "grounding_short": (sec.get("meta", {}).get("Grounding", "") or
                                    art["grounding"]).split(";")[0][:220],
                "topic_count": art["topic_count"],
                "budget": art["budget"],
                "models": art["models"],
                "objectives": [
                    {"key": o["key"], "label": o["label"], "sha": o["sha"], "words": o["words"]}
                    for o in art["objectives"]
                ],
                # Objectives the build log records as struck through. They are NOT in the .jsx —
                # a dropped objective is genuinely gone from the source — so the library can only
                # show that history by carrying it separately.
                "dropped": [
                    {"key": o["key"], "label": o["label"], "note": o["note"]}
                    for o in sec.get("objectives", []) if o.get("dropped")
                ],
                "status": sec.get("meta", {}).get("Status", ""),
                "bytes": art["bytes"],
                "lines": art["lines"],
                "sha256": sha256_bytes(raw),
            })

        index.sort(key=lambda r: (r["lesson_no"] is None, r["lesson_no"] or 0, r["slug"]))
        index_doc = {
            "schema": 1,
            "course": course,
            "course_id": prof.get("course_id", course),
            "course_title": prof.get("course_title", ""),
            "prefill_base": prof.get("prefill_base", ""),
            "submit_endpoint": prof.get("submit_endpoint", ""),
            "build_log_title": log.get("title", ""),
            "build_log_preamble": log.get("preamble", ""),
            # No `generated_at` — same reason as the build record above.
            "artifacts": index,
        }
        objects.append({
            "path": f"{course}/index.json",
            "blob": (json.dumps(index_doc, indent=1, ensure_ascii=False) + "\n").encode("utf-8"),
            "ctype": "application/json", "kind": "index",
        })
        report.append((course, f"{len(index)} artifact(s)", len(index)))

    # PREP's own committed example artifact. Kept outside the course prefixes so it never shows
    # up in the library as a 47th lesson — it is the pilot's pre-repository copy of lesson 2,
    # superseded by the real build, and preserved rather than published.
    example = REPO / ".ai" / "artifacts" / "examples" / "lesson02_artifact.jsx"
    if example.exists():
        objects.append({"path": "_examples/lesson02_artifact.jsx", "blob": example.read_bytes(),
                        "ctype": "text/plain", "kind": "example"})
        report.append(("_examples", "1 archived example", 1))

    return objects, report


# ── the review sidecar ───────────────────────────────────────────────────────

def review_path(course):
    return f"{course}/review-notes.json"


def seed_reviews(source_root, objects):
    """Seed each course's review sidecar from its committed REVIEW-NOTES.json, once.

    Only ever seeds — `push` refuses to overwrite a sidecar that already exists remotely,
    because after the first push the SITE is the writer and the repo copy is the mirror. Pushing
    the repo copy over a newer remote one would discard decisions somebody made in a browser,
    which is exactly the clobber the local tool's merge rule was written to prevent.
    """
    seeds = []
    for course in COURSES:
        # Beside BUILD-LOG.md, inside artifacts/ — the layout the builder repo uses and the
        # local review server still expects. Only the .jsx in that directory is gitignored.
        rn = source_root / course / "artifacts" / "REVIEW-NOTES.json"
        if rn.exists():
            seeds.append({"path": review_path(course), "blob": rn.read_bytes(),
                          "ctype": "application/json", "kind": "review"})
    return seeds


# ── commands ─────────────────────────────────────────────────────────────────

def resolve_source(args):
    root = pathlib.Path(args.source).resolve() if args.source else BUILDER
    if not root.is_dir():
        raise Unusable(
            f"no source tree at {root}.\n"
            "  During the initial import the artifacts live in the other repository — pass\n"
            "  --source \"../Socratic-Artifact-Builder/courses\". Afterwards, populate the local\n"
            "  cache with `pull --into _builder/courses --commit`."
        )
    return root


def classify(objects, remote):
    """Split a payload into (new, changed, unchanged) against what Storage already holds.

    An object is unchanged when its md5 etag matches. Storage's etag is md5 for a single-part
    upload, which every object here is.

    Shared by `push` and `status` on purpose: `status` used to print `len(objects)` under the
    words "would be pushed", i.e. the whole payload, whether or not any of it differed. It
    therefore reported "95 object(s) would be pushed" against a bucket that was already
    identical, while `push` in the same breath said `changed 0`. Two commands whose entire job
    is to answer the same question must not answer it differently.
    """
    new, changed, same = [], [], []
    for o in objects:
        r = remote.get(o["path"])
        if r is None:
            new.append(o)
        elif r["etag"] == hashlib.md5(o["blob"]).hexdigest():
            same.append(o)
        else:
            changed.append(o)
    return new, changed, same


def cmd_push(args):
    _, key = _cfg()
    require_bucket(key)
    root = resolve_source(args)
    objects, report = build_payload(root)
    remote = storage_list(key)

    seeds = [s for s in seed_reviews(root, objects) if s["path"] not in remote]
    skipped_seed = [s["path"] for s in seed_reviews(root, objects) if s["path"] in remote]
    objects += seeds

    new, changed, same = classify(objects, remote)

    print(f"Source: {root}")
    for course, note, _ in report:
        print(f"  {course:<10} {note}")
    print(f"\n  new     {len(new)}\n  changed {len(changed)}\n  unchanged {len(same)}")
    if skipped_seed:
        print(f"\n  Review sidecar(s) already in Storage, NOT overwritten: {', '.join(skipped_seed)}")
        print("  After the first push the site owns them. Use `pull-reviews` to bring decisions")
        print("  back into the repo instead.")
    for o in (new + changed)[:6]:
        print(f"    + {o['path']}")
    if len(new) + len(changed) > 6:
        print(f"    … {len(new) + len(changed) - 6} more")

    if not args.commit:
        print("\nDry run — nothing uploaded. Re-run with --commit.")
        return EXIT_OK

    failed = []
    for i, o in enumerate(new + changed, 1):
        try:
            storage_put(key, o["path"], o["blob"], o["ctype"])
        except Unusable as exc:
            failed.append((o["path"], str(exc)))
        if i % 25 == 0:
            print(f"    …{i}/{len(new) + len(changed)}")

    manifest = {
        "schema": 1,
        "bucket": BUCKET,
        "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": str(root),
        # Everything this tool is responsible for. `purge` deletes exactly this list and
        # nothing else, which is what stops a reversal from taking somebody else's object
        # with it.
        "paths": sorted(o["path"] for o in objects),
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))

    if failed:
        print(f"\n  {len(failed)} upload(s) FAILED:")
        for p, e in failed[:5]:
            print(f"    {p}: {e}")
        print("\n  Re-run `push --commit`; it is idempotent and will retry only these.")
        return EXIT_PROBLEM

    print(f"\nUploaded {len(new) + len(changed)} object(s). Manifest: {MANIFEST}")
    print("Now verify the round trip:")
    print("  python scripts/artifacts/sync_artifacts.py pull --into <tmp> --commit")
    return EXIT_OK


def cmd_pull(args):
    _, key = _cfg()
    require_bucket(key)
    dest = pathlib.Path(args.into).resolve()
    remote = storage_list(key)
    sources = {p: m for p, m in remote.items() if p.endswith("/source.jsx")}
    print(f"Storage holds {len(remote)} object(s); {len(sources)} artifact source(s).")
    print(f"Destination: {dest}")
    if not args.commit:
        print("\nDry run — nothing written. Re-run with --commit.")
        return EXIT_OK

    dest.mkdir(parents=True, exist_ok=True)
    written = 0
    for path in sorted(remote):
        blob = storage_get(key, path)
        out = dest / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(blob)                      # bytes — never text mode
        written += 1
    print(f"Wrote {written} file(s) under {dest}.")
    return EXIT_OK


def cmd_pull_reviews(args):
    """Bring review decisions made on the site back into the repository.

    The site is the writer; this is the mirror. Keeping the mirror in git is what makes an
    approval diffable and gives it a history — a decision that exists only in a Storage object
    is a decision nobody can see the shape of over time.
    """
    _, key = _cfg()
    require_bucket(key)
    remote = storage_list(key)
    changes = []
    for course in COURSES:
        rp = review_path(course)
        if rp not in remote:
            continue
        blob = storage_get(key, rp)
        local = REPO / "_builder" / "courses" / course / "artifacts" / "REVIEW-NOTES.json"
        before = local.read_bytes() if local.exists() else b""
        if before == blob:
            print(f"  {course:<10} unchanged")
            continue
        changes.append((local, blob, len(before), len(blob)))
        print(f"  {course:<10} {len(before)} -> {len(blob)} bytes")

    if not changes:
        print("Nothing to bring back.")
        return EXIT_OK
    if not args.commit:
        print("\nDry run — nothing written. Re-run with --commit.")
        return EXIT_OK
    for local, blob, _, _ in changes:
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(blob)
    print(f"\nUpdated {len(changes)} file(s). Commit them — that is the durable record.")
    return EXIT_OK


def cmd_purge(args):
    """The L1 reversal lever. Deletes only what a push recorded."""
    _, key = _cfg()
    require_bucket(key)
    if not MANIFEST.exists():
        raise Unusable(
            f"no manifest at {MANIFEST} — nothing to purge, or the push predates it.\n"
            "  Refusing to guess: a prefix sweep would take any object somebody else put here."
        )
    manifest = json.loads(MANIFEST.read_bytes().decode("utf-8"))
    mine = set(manifest["paths"])
    remote = storage_list(key)
    to_delete = sorted(mine & set(remote))
    foreign = sorted(set(remote) - mine)

    print(f"Manifest lists {len(mine)} path(s), written {manifest['written_at']}.")
    print(f"  present in Storage and will be deleted : {len(to_delete)}")
    print(f"  listed but already gone                : {len(mine - set(remote))}")
    print(f"  in Storage but NOT ours                : {len(foreign)}")
    if foreign:
        print("\n  These are left alone, so the bucket will not drop afterwards:")
        for p in foreign[:10]:
            print(f"    {p}")
        print("  That is correct behaviour, not an obstacle — find out what they are first.")

    review_live = [p for p in to_delete if p.endswith("review-notes.json")]
    if review_live:
        print("\n  !! This includes the review sidecar(s). Any decision made on the site and not")
        print("     yet mirrored will be lost. Run this FIRST:")
        print("       python scripts/artifacts/sync_artifacts.py pull-reviews --commit")

    if not args.commit:
        print("\nDry run — nothing deleted. Re-run with --commit.")
        return EXIT_OK

    storage_delete(key, to_delete)
    left = storage_list(key)
    print(f"\nDeleted {len(to_delete)}. Bucket now holds {len(left)} object(s).")
    if not left:
        print("Empty — 023_artifact_sources_storage_ROLLBACK.sql can now drop the bucket.")
    return EXIT_OK


def cmd_status(args):
    _, key = _cfg()
    remote = None
    try:
        require_bucket(key)
        remote = storage_list(key)
    except Unusable as exc:
        print(f"Storage: {exc}\n")
    root = pathlib.Path(args.source).resolve() if args.source else BUILDER
    print(f"Local source tree : {root}{'' if root.is_dir() else '  (absent)'}")
    if root.is_dir():
        objects, report = build_payload(root)
        for course, note, _ in report:
            print(f"  {course:<10} {note}")
        if remote is None:
            print(f"  {len(objects)} object(s) in the local payload "
                  "(cannot compare — Storage unreachable)")
        else:
            new, changed, same = classify(objects, remote)
            pending = len(new) + len(changed)
            print(f"  {len(objects)} object(s) in the local payload — "
                  f"{pending} would be pushed ({len(new)} new, {len(changed)} changed, "
                  f"{len(same)} already identical)")
            for o in (new + changed)[:6]:
                print(f"    + {o['path']}")
            if pending > 6:
                print(f"    … {pending - 6} more")
    if remote is not None:
        kinds = {}
        for p in remote:
            k = ("index" if p.endswith("index.json") else
                 "review" if p.endswith("review-notes.json") else
                 "source" if p.endswith("source.jsx") else
                 "build" if p.endswith("build.json") else "other")
            kinds[k] = kinds.get(k, 0) + 1
        print(f"\nStorage bucket '{BUCKET}': {len(remote)} object(s)")
        for k in sorted(kinds):
            print(f"  {k:<8} {kinds[k]}")
    return EXIT_OK


def main(argv=None):
    ap_ = argparse.ArgumentParser(
        description="Sync artifact sources between the builder tree and Supabase Storage.")
    ap_.add_argument("--source", default=None,
                     help="courses/ directory to read (default: _builder/courses)")
    ap_.add_argument("--as-staff", action="store_true",
                     help="authenticate as the PREP_TEST_FACULTY staff session in "
                          "supabase/admin/.env instead of the service-role key "
                          "(less privileged: obeys RLS rather than bypassing it)")
    sub = ap_.add_subparsers(dest="cmd", required=True)

    for name, fn, helptext in (
        ("push", cmd_push, "upload sources, build records and the index"),
        ("pull-reviews", cmd_pull_reviews, "bring site review decisions back into the repo"),
        ("purge", cmd_purge, "delete everything this tool uploaded (reversal lever L1)"),
    ):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("--commit", action="store_true", help="actually make the change")
        # Also accepted AFTER the subcommand, because that is where a person naturally types
        # it. SUPPRESS is load-bearing: with a normal store_true default of False, passing the
        # flag BEFORE the subcommand and not after would have the subparser's default silently
        # overwrite the True — the tool would report the service-role path while the operator
        # believed they had asked for a session, which fails as a confusing 401.
        p.add_argument("--as-staff", action="store_true", default=argparse.SUPPRESS,
                       help="see the top-level --as-staff")
        p.set_defaults(func=fn)

    p = sub.add_parser("pull", help="download every object (round-trip proof / fresh-clone cache)")
    p.add_argument("--into", required=True, help="destination directory")
    p.add_argument("--commit", action="store_true", help="actually write files")
    p.add_argument("--as-staff", action="store_true", default=argparse.SUPPRESS,
                   help="see the top-level --as-staff")
    p.set_defaults(func=cmd_pull)

    p = sub.add_parser("status", help="compare local and remote, change nothing")
    p.add_argument("--as-staff", action="store_true", default=argparse.SUPPRESS,
                   help="see the top-level --as-staff")
    p.set_defaults(func=cmd_status)

    args = ap_.parse_args(argv)
    try:
        if getattr(args, "as_staff", False):
            start_staff_session()
        return args.func(args)
    except Unusable as exc:
        print(f"cannot proceed: {exc}", file=sys.stderr)
        return EXIT_UNUSABLE


if __name__ == "__main__":
    sys.exit(main())
