"""The language-model interface, a fake for tests, the GenAI.mil client, and model selection.

The job talks to a model only through `LLMClient.complete`. Tests use `FakeClient`. The real client
speaks the OpenAI-style wire format GenAI.mil exposes, over `urllib` (no vendor library: the
provider's own SDKs do not work against it, and the repo keeps `scripts` and admin tooling light).

Nothing here prints, logs or raises a secret: the key lives in a `Secret`, appears only in the
Authorization header, and every error text passes through `redact` first.
"""
import json
import random
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .config import Secret, Stop, redact
from . import EXIT_LLM


@dataclass
class Completion:
    text: str
    finish_reason: str = "stop"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    model: str = ""
    request_id: str = ""


class LLMError(Exception):
    """kind: retryable | bad_request | auth | locked | model_missing | budget."""

    def __init__(self, kind, message, status=None, unlock_url=None):
        super().__init__(message)
        self.kind, self.status, self.unlock_url = kind, status, unlock_url


# ── model selection ───────────────────────────────────────────────────────────────────────
_MODEL = re.compile(r"^gemini-(\d+)\.(\d+)-(flash|pro)(-preview[\w.\-]*)?$")


def parse_model(name):
    """(major, minor, family, is_preview) for a plain flash or pro model, else None.

    `-lite`, `-exp`, dated snapshots and anything else are not parsed, so they are never selected.
    """
    m = _MODEL.match(name or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), m.group(3), bool(m.group(4))


def select_models(available, role, pin=None, allow_preview=False):
    """An ordered fallback list for a role ('grade' wants flash, 'aggregate' wants pro).

    Pure function of the list the API returned. A pin that is in the list leads; a pin that is NOT
    in the list is reported and never silently swapped for a guess (the caller records it).
    Returns (ordered_models, info) where info = {"pin_missing": bool}.
    """
    family = {"grade": "flash", "aggregate": "pro"}[role]
    avail = list(available)
    parsed = []
    for name in avail:
        p = parse_model(name)
        if p and p[2] == family and (allow_preview or not p[3]):
            parsed.append((p[0], p[1], name))
    parsed.sort(reverse=True)
    order = [n for _, _, n in parsed]
    info = {"pin_missing": False}
    if pin:
        if pin in avail:
            order = [pin] + [n for n in order if n != pin]
        else:
            info["pin_missing"] = True
    return order, info


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the Authorization header to another address. Never follow one."""

    def redirect_request(self, *a, **k):
        return None


def default_opener():
    return urllib.request.build_opener(_NoRedirect()).open


class TokenBudget:
    """Counts tokens from each response's own usage figures. Stop starting work at the cap."""

    def __init__(self, cap):
        self.cap, self.used, self.calls = int(cap), 0, 0

    def add(self, completion):
        self.used += int(completion.prompt_tokens or 0) + int(completion.completion_tokens or 0)
        self.calls += 1

    @property
    def exhausted(self):
        return self.cap > 0 and self.used >= self.cap


# ── clients ───────────────────────────────────────────────────────────────────────────────
class FakeClient:
    """Scripted client for tests. `script` is a list of responses (str or Completion or Exception)
    consumed in order, or a callable (model, system, user, tag) -> str | Completion."""

    name = "fake"

    def __init__(self, script=None, models=None):
        self.script, self.models, self.calls = script, models or ["gemini-3.8-flash", "gemini-2.5-pro"], []

    def list_models(self):
        return list(self.models)

    def complete(self, *, model, system, user, max_output_tokens=2048, temperature=0.0, json_mode=True, tag=""):
        self.calls.append({"model": model, "system": system, "user": user, "tag": tag})
        if callable(self.script):
            r = self.script(model, system, user, tag)
        else:
            if not self.script:
                raise AssertionError("FakeClient has no scripted response left")
            r = self.script.pop(0)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, str):
            r = Completion(text=r, prompt_tokens=len(system + user) // 4, completion_tokens=len(r) // 4,
                           model=model, request_id=f"fake-{len(self.calls)}")
        return r


class GenAIMilClient:
    """OpenAI-style client for GenAI.mil. Written against the provider's published behaviour:
    GET /models, POST /chat/completions, Bearer auth. Retries 429, 500 and 502 with exponential
    backoff and jitter; never retries 400, 401, 403 or 404. NOT exercised live by any test."""

    name = "genai-mil"

    def __init__(self, base_url, key, sleep=time.sleep, opener=None, max_tries=5):
        self.base_url, self._key, self._sleep, self.max_tries = base_url.rstrip("/"), key, sleep, max_tries
        self._open = opener or default_opener()

    def _request(self, method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        for attempt in range(1, self.max_tries + 1):
            req = urllib.request.Request(self.base_url + path, data=data, method=method)
            req.add_header("Authorization", "Bearer " + self._key.reveal())
            req.add_header("Content-Type", "application/json")
            try:
                with self._open(req, timeout=120) as resp:
                    return json.loads(resp.read().decode("utf-8")), resp.headers.get("x-request-id", "")
            except urllib.error.HTTPError as exc:
                text = redact(exc.read().decode("utf-8", "replace")[:300], self._key)
                if exc.code in (429, 500, 502) and attempt < self.max_tries:
                    ra = exc.headers.get("Retry-After") if exc.headers else None
                    delay = float(ra) if ra and ra.replace(".", "", 1).isdigit() else min(60, 2 ** attempt)
                    self._sleep(delay + random.random())
                    continue
                if 300 <= exc.code < 400:
                    raise LLMError("bad_request", f"GenAI.mil answered with a redirect (HTTP {exc.code}); refused", exc.code)
                if exc.code in (401, 403) and "lock" in text.lower():
                    url = re.search(r"https://\S+", text)
                    raise LLMError("locked", "the GenAI.mil key is locked", exc.code, url.group(0).rstrip(".,)") if url else None)
                if exc.code in (401, 403):
                    raise LLMError("auth", f"GenAI.mil refused the key (HTTP {exc.code})", exc.code)
                if exc.code == 404:
                    raise LLMError("model_missing", "model or route not found (HTTP 404)", 404)
                if exc.code in (429, 500, 502):
                    raise LLMError("retryable", f"GenAI.mil still failing after {self.max_tries} tries (HTTP {exc.code})", exc.code)
                raise LLMError("bad_request", f"GenAI.mil rejected the request (HTTP {exc.code}): {text}", exc.code)
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt < self.max_tries:
                    self._sleep(min(60, 2 ** attempt) + random.random())
                    continue
                raise LLMError("retryable", "could not reach GenAI.mil: " + redact(exc, self._key))
        raise LLMError("retryable", "retries exhausted")

    def list_models(self):
        body, _ = self._request("GET", "/models")
        return [m["id"] for m in body.get("data", []) if isinstance(m, dict) and m.get("id")]

    def complete(self, *, model, system, user, max_output_tokens=2048, temperature=0.0, json_mode=True, tag=""):
        body = {"model": model, "temperature": temperature, "max_tokens": max_output_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        # `response_format` support is unverified for this endpoint, so it is not sent. The prompt
        # demands a bare JSON object and the validator refuses anything else.
        data, rid = self._request("POST", "/chat/completions", body)
        try:
            choice = data["choices"][0]
            usage = data.get("usage") or {}
            return Completion(text=choice["message"]["content"] or "", finish_reason=choice.get("finish_reason") or "",
                              prompt_tokens=int(usage.get("prompt_tokens") or 0),
                              completion_tokens=int(usage.get("completion_tokens") or 0),
                              model=data.get("model") or model, request_id=rid or str(data.get("id") or ""))
        except (KeyError, IndexError, TypeError, ValueError):
            raise LLMError("bad_request", "GenAI.mil returned a response this job cannot read")


def make_client(provider, cfg):
    """The gate. GenAI.mil is built only for a project flagged official Air Force work."""
    if provider == "genai-mil":
        if cfg.genai_mil_project_flag != "official-af-work":
            raise Stop(EXIT_LLM, 'GenAI.mil is off: config "genai_mil_project_flag" must be "official-af-work".')
        if not cfg.genai:
            raise Stop(EXIT_LLM, "no GenAI.mil credentials were loaded")
        return GenAIMilClient(cfg.genai["base_url"], cfg.genai["key"])
    raise Stop(EXIT_LLM, f"unknown provider {provider!r}")


def pick_models(client, cfg):
    """Choose the grading and aggregation models once per run. Raises Stop when none is usable."""
    avail = client.list_models()
    out = {"selected_from": len(avail)}
    for role, pin in (("grade", cfg.model_pin_grade), ("aggregate", cfg.model_pin_aggregate)):
        order, info = select_models(avail, role, pin, cfg.allow_preview)
        if not order:
            raise Stop(EXIT_LLM, f"no usable {role} model in the list ({'flash' if role == 'grade' else 'pro'} class, stable)")
        out[role] = order
        if info["pin_missing"]:
            out[role + "_pin_missing"] = pin
    return out
