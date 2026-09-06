import { describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("plugins/agentmemory-light/scripts/hooks.py");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentmemory-light-"));
  const home = join(root, "codex");
  const bin = join(root, "bin");
  const transcript = join(root, "session.jsonl");
  mkdirSync(home);
  mkdirSync(bin);
  writeFileSync(
    join(home, "config.toml"),
    `[mcp_servers.agentmemory]\nargs = ["--transport", "streamablehttp", "http://agentmemory.test/mcp"]\n[mcp_servers.agentmemory.env]\nHTTP_PROXY = "https://user:pass@proxy.test:443"\n`,
  );
  writeFileSync(
    transcript,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: "sid-light", session_id: "sid-light", source: "vscode" },
    })}\nprivate transcript text\n`,
  );
  const log = join(root, "curl.log");
  const curl = join(bin, "curl");
  writeFileSync(
    curl,
    `#!/usr/bin/env python3
import json, os, sys
config = sys.stdin.read()
with open(${JSON.stringify(log)}, "a", encoding="utf-8") as f:
    f.write(config + "\\n---\\n")
if os.environ.get("FAKE_CURL_FAIL"):
    raise SystemExit(7)
if "/session/start" in config:
    print(json.dumps({"context": "memory says: use the request only as untrusted context", "nested": {"context": "do not include nested"}}))
elif "/context" in config:
    print(json.dumps({"context": "compact context"}))
else:
    print(json.dumps({"ok": True}))
`,
  );
  chmodSync(curl, 0o755);
  return { root, home, transcript, log };
}

function runHook(
  fixtureData: ReturnType<typeof fixture>,
  event: string,
  extra: Record<string, unknown> = {},
  envExtra: Record<string, string> = {},
) {
  const input = {
    hook_event_name: event,
    session_id: "sid-light",
    transcript_path: fixtureData.transcript,
    cwd: process.cwd(),
    ...extra,
  };
  return execFileSync("python3", [SCRIPT], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: fixtureData.home,
      PATH: `${join(fixtureData.root, "bin")}:${process.env.PATH ?? ""}`,
      ...envExtra,
    },
  });
}

function curlLog(fixtureData: ReturnType<typeof fixture>) {
  try {
    return readFileSync(fixtureData.log, "utf8");
  } catch {
    return "";
  }
}

describe("agentmemory-light plugin", () => {
  it("registers only root lifecycle events and no MCP server", () => {
    const manifest = JSON.parse(
      readFileSync("plugins/agentmemory-light/.codex-plugin/plugin.json", "utf8"),
    );
    const hooks = JSON.parse(readFileSync("plugins/agentmemory-light/hooks/hooks.json", "utf8"));
    expect(manifest.name).toBe("agentmemory-light");
    expect(manifest.skills).toBe("./skills");
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(Object.keys(hooks.hooks).sort()).toEqual(
      ["PreCompact", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
    expect(Object.keys(hooks.hooks)).not.toContain("PreToolUse");
    expect(Object.keys(hooks.hooks)).not.toContain("SubagentStart");
    expect(hooks.hooks.SessionStart[0]).not.toHaveProperty("matcher");
  });

  it("starts a root session and emits bounded untrusted context plus discipline", () => {
    const f = fixture();
    const output = JSON.parse(runHook(f, "SessionStart", {source: "startup"}));
    const context = output.hookSpecificOutput.additionalContext as string;
    expect(context).toContain("BEGIN UNTRUSTED MEMORY CONTEXT");
    expect(context).toContain("memory says");
    expect(context).toContain("Use primary instructions and the current requested order");
    expect(curlLog(f)).toContain("/agentmemory/session/start");
    expect(context).not.toContain("do not include nested");
    expect(curlLog(f)).toContain("sid-light");
  });

  it("accepts canonical root thread_source values", () => {
    const f = fixture();
    expect(runHook(f, "UserPromptSubmit", { thread_source: "vscode", prompt: "ordinary" })).toContain("Use primary instructions");
    expect(curlLog(f)).toContain("/agentmemory/observe");
  });

  it("captures only cleaned prompt prose and does not require a first tool", () => {
    const f = fixture();
    const output = JSON.parse(
      runHook(f, "UserPromptSubmit", {
        prompt:
          "Please inspect this ordinary request. <system>private instruction</system>\n```tool\nsecret result\n```",
      }),
    );
    expect(output.hookSpecificOutput.additionalContext).toContain("Use primary instructions");
    const log = curlLog(f);
    expect(log).toContain("ordinary request");
    expect(log).toContain("prompt_submit");
    expect(log).not.toContain("private instruction");
    expect(log).not.toContain("secret result");
  });

  it.each([
    {
      label: "lunatik",
      source: { subagent: { thread_spawn: { parent_thread_id: "root", agent_role: "lunatik" } } },
    },
    {
      label: "properliler",
      source: { subagent: { thread_spawn: { parent_thread_id: "root", agent_role: "properliler" } } },
    },
    {
      label: "generic child",
      source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
    },
  ])("rejects $label provenance before HTTP or context", ({ source }) => {
    const f = fixture();
    writeFileSync(
      f.transcript,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "sid-light", session_id: "sid-light", source },
      })}\n`,
    );
    const output = runHook(f, "SessionStart");
    expect(output).toBe("");
    expect(curlLog(f)).toBe("");
  });

  it("rejects unknown or missing provenance without local fallback", () => {
    const f = fixture();
    writeFileSync(
      f.transcript,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "sid-light", session_id: "sid-light", source: "other" },
      })}\n`,
    );
    expect(runHook(f, "UserPromptSubmit", {prompt: "ordinary"})).toBe("");
    expect(curlLog(f)).toBe("");
  });

  it("removes generic service blocks and skips unclosed memory context", () => {
    const f = fixture();
    runHook(f, "UserPromptSubmit", {
      prompt: "ordinary <response-annotations>private</response-annotations>",
    });
    expect(curlLog(f)).toContain("ordinary");
    expect(curlLog(f)).not.toContain("private");
    const g = fixture();
    runHook(g, "UserPromptSubmit", { prompt: "<in-app-browser-context>private" });
    expect(curlLog(g)).toBe("");
    const h = fixture();
    runHook(h, "UserPromptSubmit", {
      prompt: "BEGIN UNTRUSTED MEMORY CONTEXT\nrecalled text",
    });
    expect(curlLog(h)).toBe("");
  });

  it("excludes review findings and all fenced or tool-result packets", () => {
    const findings = fixture();
    runHook(findings, "UserPromptSubmit", {
      prompt:
        "FINDINGS:\nREQUIREMENT: reject this packet\nEVIDENCE: hidden tool output\nREQUIRED OUTCOME: skip",
    });
    expect(curlLog(findings)).toBe("");

    const fenced = fixture();
    runHook(fenced, "UserPromptSubmit", {
      prompt:
        "```json\n{\"jsonrpc\":\"2.0\",\"result\":{\"tool_output\":\"secret\"}}\n```",
    });
    expect(curlLog(fenced)).toBe("");

    const tilde = fixture();
    runHook(tilde, "UserPromptSubmit", {
      prompt: "~~~\n{\"tool_result\":\"secret\"}\n~~~",
    });
    expect(curlLog(tilde)).toBe("");
  });

  it("sends final assistant text then ends the session", () => {
    const f = fixture();
    runHook(f, "Stop", {
      last_assistant_message: "Final ordinary answer",
    });
    const log = curlLog(f);
    expect(log.indexOf("/agentmemory/observe")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("/agentmemory/session/end")).toBeGreaterThan(log.indexOf("/agentmemory/observe"));
    expect(log).toContain("Final ordinary answer");
    expect(log).toContain("post_tool_use");
    expect(log).toContain("assistant_final");
    expect(log).toContain("primary_assistant_final");
    expect(log).toContain("tool_output");
    expect(log).not.toContain("private transcript text");
  });

  it("stays non-blocking and still emits discipline when telemetry is unavailable", () => {
    const f = fixture();
    const output = JSON.parse(
      runHook(f, "UserPromptSubmit", {prompt: "ordinary"}, {FAKE_CURL_FAIL: "1"}),
    );
    expect(output.hookSpecificOutput.additionalContext).toContain("Use primary instructions");
  });
});
