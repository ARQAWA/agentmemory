#!/usr/bin/env python3
"""Root-session AgentMemory hook runtime."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

MAX_CAPTURE = 8000
MAX_CONTEXT = 1500
HOOK_TIMEOUT = 10
CONTEXT_TIMEOUT = 2
TELEMETRY_TIMEOUT = 3

DISCIPLINE = """Use primary instructions and the current requested order. When useful, recall relevant prior decisions with memory_recall. Save settled facts and decisions with their reasons via memory_save. Corrections and lessons remain subordinate to current instructions. Skip code-derivable, transient, tool, and private data. Hooks own summaries; do not make manual recap saves. Child agents do not use or capture memory."""

BLOCK_RE = re.compile(
    r"(?is)</?(?:skill|system|context|annotation|subagent|tool|review|quoted|"
    r"codex-internal|codex_internal|memory-context|memory_context)\b[^>]*>.*?</"
    r"(?:skill|system|context|annotation|subagent|tool|review|quoted|"
    r"codex-internal|codex_internal|memory-context|memory_context)\s*>",
)
GENERIC_XML_RE = re.compile(r"(?is)<([A-Za-z][\w:.-]*)(?:\s[^>]*)?>.*?</\1\s*>")
SERVICE_OPEN_RE = re.compile(
    r"(?is)<\s*(?:codex[_-]?internal[_-]?context|response-annotations|"
    r"send_user_message_question_reply|in-app-browser-context)\b[^>]*>"
)
FENCE_RE = re.compile(
    r"(?ims)^\s*```(?:quoted|quote|tool(?:[-_ ]?(?:call|result))?|review|"
    r"system|context|subagent|codex[_ -]?internal|memory)\b.*?^\s*```\s*$",
)
FENCE_BLOCK_RE = re.compile(r"(?ims)^\s*(```|~~~)[^\n]*\n.*?^\s*\1\s*$")
FINDINGS_RE = re.compile(
    r"(?is)^\s*findings:\s*.*\b(?:requirement|mismatch|evidence|required\s+outcome)\b"
)
WRAPPER_RE = re.compile(
    r"^\s*(?:\[?\s*)?(?:send_user_message_question_reply|"
    r"codex_internal_context|codex[_ -]?internal(?:_message)?|"
    r"subagent(?:[_ -](?:notification|message|start|stop|result))?|"
    r"tool[_ -](?:call|result|output)|mcp[_ -](?:call|result|event)|"
    r"review[_ -](?:result|findings)|memory[_ -](?:context|result))\b",
    re.IGNORECASE,
)

REJECT_INPUT_KEYS = {
    "agent_id",
    "agent_type",
    "parent_thread_id",
    "parent_id",
    "fork_parent_id",
    "forked_from",
    "forked_from_id",
    "fork_context",
    "fork_turns",
    "subagent",
}
REJECT_META_KEYS = REJECT_INPUT_KEYS | {"depth"}


def _nonempty(value: object) -> bool:
    return value not in (None, "", False, [], {})


def _contains_rejected_meta(value: object, key: str = "") -> bool:
    if isinstance(value, dict):
        for child_key, child in value.items():
            normalized = child_key.lower().replace("-", "_")
            if normalized == "thread_source":
                if isinstance(child, str) and child in {"vscode", "cli"}:
                    continue
                if _nonempty(child):
                    return True
            if normalized in REJECT_META_KEYS and _nonempty(child):
                return True
            if normalized == "source" and isinstance(child, dict):
                return True
            if _contains_rejected_meta(child, normalized):
                return True
    elif isinstance(value, list):
        return any(_contains_rejected_meta(item, key) for item in value)
    return False


def _read_session_meta(data: dict[str, object]) -> bool:
    session_id = data.get("session_id")
    transcript_path = data.get("transcript_path")
    if not isinstance(session_id, str) or not session_id:
        return False
    if not isinstance(transcript_path, str) or not transcript_path:
        return False
    path = Path(transcript_path)
    try:
        with path.open("r", encoding="utf-8") as stream:
            first_line = stream.readline()
        record = json.loads(first_line)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    if not isinstance(record, dict) or record.get("type") != "session_meta":
        return False
    payload = record.get("payload")
    if not isinstance(payload, dict):
        payload = record
    record_id = payload.get("id", record.get("id"))
    if record_id != session_id:
        return False
    metadata_session_id = payload.get("session_id", record.get("session_id"))
    if metadata_session_id is not None and metadata_session_id != session_id:
        return False
    source = payload.get("source", record.get("source"))
    if not isinstance(source, str) or source not in {"vscode", "cli"}:
        return False
    if _contains_rejected_meta(record):
        return False
    return True



def project_name(cwd: object) -> str:
    path = str(cwd) if isinstance(cwd, str) and cwd else os.getcwd()
    try:
        result = subprocess.run(
            ["git", "-C", path, "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=0.5,
            check=False,
        )
        root = result.stdout.strip()
        if root:
            return Path(root).name
    except (OSError, subprocess.SubprocessError):
        pass
    return Path(path).name or "unknown"


def _config_transport() -> tuple[str, str] | None:
    home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    config_path = home / "config.toml"
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
        server = config.get("mcp_servers", {}).get("agentmemory", {})
        args = server.get("args", []) if isinstance(server, dict) else []
        endpoint = next(
            (item for item in args if isinstance(item, str) and item.endswith("/mcp")),
            None,
        )
        env = server.get("env", {}) if isinstance(server, dict) else {}
        proxy = env.get("HTTP_PROXY") if isinstance(env, dict) else None
    except (OSError, UnicodeError, tomllib.TOMLDecodeError, AttributeError):
        return None
    if not isinstance(endpoint, str) or not isinstance(proxy, str):
        return None
    if not endpoint.startswith(("http://", "https://")) or not proxy:
        return None
    return endpoint[:-4], proxy


def _curl_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def post_json(suffix: str, payload: dict[str, object], timeout: int) -> tuple[bool, object]:
    if suffix not in {"/session/start", "/observe", "/session/end", "/context"}:
        return False, None
    transport = _config_transport()
    if transport is None:
        return False, None
    base_url, proxy = transport
    proxy_parts = urlsplit(proxy)
    if not proxy_parts.scheme or not proxy_parts.hostname:
        return False, None
    proxy_base = urlunsplit((proxy_parts.scheme, proxy_parts.hostname + (f":{proxy_parts.port}" if proxy_parts.port else ""), "", "", ""))
    proxy_user = unquote(proxy_parts.username or "")
    proxy_password = unquote(proxy_parts.password or "")
    request_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    curl_config = "\n".join(
        [
            f"proxy = {_curl_quote(proxy_base)}",
            f"proxy-user = {_curl_quote(f'{proxy_user}:{proxy_password}')}" if proxy_parts.username is not None else "",
            "request = POST",
            "header = \"Content-Type: application/json\"",
            f"data-raw = {_curl_quote(request_json)}",
            f"url = {_curl_quote(base_url + '/agentmemory' + suffix)}",
            "",
        ]
    )
    try:
        result = subprocess.run(
            ["curl", "--silent", "--show-error", "--fail", "--noproxy", "", "--max-time", str(timeout), "--config", "-"],
            input=curl_config,
            capture_output=True,
            text=True,
            timeout=timeout + 1,
            check=False,
        )
        if result.returncode != 0:
            return False, None
        body = json.loads(result.stdout)
        if not isinstance(body, dict) or body.get("success") is False or body.get("error"):
            return False, body
        return True, body
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return False, None


def clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    if "BEGIN UNTRUSTED MEMORY CONTEXT" in value or "END UNTRUSTED MEMORY CONTEXT" in value:
        return ""
    if SERVICE_OPEN_RE.search(value) and not re.search(
        r"(?is)</\s*(?:codex[_-]?internal[_-]?context|response-annotations|"
        r"send_user_message_question_reply|in-app-browser-context)\s*>", value,
    ):
        return ""
    if value.count("```") % 2 or value.count("~~~") % 2:
        return ""
    text = BLOCK_RE.sub("", value)
    text = GENERIC_XML_RE.sub("", text)
    text = FENCE_BLOCK_RE.sub("", text)
    text = FENCE_RE.sub("", text)
    text = text.strip()
    if not text or WRAPPER_RE.match(text) or FINDINGS_RE.match(text):
        return ""
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and any(
            key in parsed for key in ("jsonrpc", "result", "tool_output", "tool_result")
        ):
            return ""
    except json.JSONDecodeError:
        pass
    if re.search(r"(?im)^\s*(?:Message Type:\s*(?:MESSAGE|FINAL_ANSWER)|>\s*(?:review|tool))\b", text):
        return ""
    return text[:MAX_CAPTURE]


def _context_text(value: object) -> str:
    if not isinstance(value, dict):
        return ""
    context = value.get("context")
    return context if isinstance(context, str) else ""


def emit_context(memory: object = "") -> None:
    parts = [DISCIPLINE[:2000]]
    context = clean_text(_context_text(memory))[:MAX_CONTEXT]
    if context:
        parts.append(f"BEGIN UNTRUSTED MEMORY CONTEXT\n{context}\nEND UNTRUSTED MEMORY CONTEXT")
    output = {"hookSpecificOutput": {"hookEventName": CURRENT_EVENT, "additionalContext": "\n\n".join(parts)}}
    sys.stdout.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")))


def _base_payload(data: dict[str, object]) -> dict[str, object]:
    session_id = data.get("session_id", "")
    cwd = data.get("cwd", os.getcwd())
    return {
        "sessionId": session_id,
        "project": project_name(cwd),
        "cwd": cwd,
    }


CURRENT_EVENT = ""


def handle(data: dict[str, object]) -> None:
    global CURRENT_EVENT
    CURRENT_EVENT = str(data.get("hook_event_name", ""))
    payload = _base_payload(data)
    if CURRENT_EVENT == "SessionStart":
        ok, result = post_json("/session/start", payload, CONTEXT_TIMEOUT)
        emit_context(result if ok else "")
    elif CURRENT_EVENT == "UserPromptSubmit":
        text = clean_text(data.get("prompt"))
        if text:
            payload["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            payload["hookType"] = "prompt_submit"
            payload["data"] = {"prompt": text}
            post_json("/observe", payload, TELEMETRY_TIMEOUT)
        emit_context("")
    elif CURRENT_EVENT == "Stop":
        text = clean_text(data.get("last_assistant_message"))
        observed = False
        if text:
            payload["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            payload["hookType"] = "post_tool_use"
            payload["data"] = {
                "tool_name": "assistant_final",
                "tool_input": {"source": "primary_assistant_final"},
                "tool_output": text,
            }
            observed, _ = post_json("/observe", payload, TELEMETRY_TIMEOUT)
        if observed:
            post_json("/session/end", {"sessionId": payload["sessionId"]}, CONTEXT_TIMEOUT)
    elif CURRENT_EVENT == "PreCompact":
        payload["budget"] = 500
        ok, result = post_json("/context", payload, CONTEXT_TIMEOUT)
        emit_context(result if ok else "")


def main() -> int:
    try:
        raw = json.loads(sys.stdin.read())
        if not isinstance(raw, dict):
            return 0
        event = raw.get("hook_event_name")
        if not isinstance(event, str) or event not in {
            "SessionStart",
            "UserPromptSubmit",
            "Stop",
            "PreCompact",
        }:
            return 0
        data = read_input_from_value(raw, event)
        if data is not None:
            handle(data)
    except Exception:
        return 0
    return 0


def read_input_from_value(value: dict[str, object], expected_event: str) -> dict[str, object] | None:
    if value.get("hook_event_name") != expected_event:
        return None
    for key in REJECT_INPUT_KEYS:
        if key in value:
            return None
    if "thread_source" in value and value["thread_source"] not in {"vscode", "cli"}:
        return None
    source = value.get("source")
    if isinstance(source, dict) and _contains_rejected_meta(source):
        return None
    if not _read_session_meta(value):
        return None
    return value


if __name__ == "__main__":
    raise SystemExit(main())
