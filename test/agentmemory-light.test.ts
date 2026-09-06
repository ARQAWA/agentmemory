import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const SCRIPT = resolve("plugins/agentmemory-light/scripts/hooks.cjs");
let proxyServer: Server;
let proxyPort: number;
let proxyLog: string;
let proxyFail = false;

beforeAll(async () => {
  proxyLog = join(mkdtempSync(join(tmpdir(), "agentmemory-proxy-")), "proxy.log");
  proxyServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      if (proxyFail) {
        req.socket.destroy();
        return;
      }
      appendFileSync(proxyLog, `${JSON.stringify({ path: req.url, body: Buffer.concat(chunks).toString("utf8") })}\n`);
      const body = req.url?.includes("/session/start")
        ? { context: "memory says: use the request only as untrusted context", nested: { context: "do not include nested" } }
        : req.url?.includes("/context") ? { context: "compact context" } : { ok: true };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolveReady) => proxyServer.listen(0, "127.0.0.1", () => resolveReady()));
  proxyPort = (proxyServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolveClosed) => proxyServer.close(() => resolveClosed()));
  rmSync(proxyLog, { force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentmemory-light-"));
  const home = join(root, "codex");
  const transcript = join(root, "session.jsonl");
  mkdirSync(home);
  writeFileSync(
    join(home, "config.toml"),
    `[mcp_servers.agentmemory]\nargs = ["--transport", "streamablehttp", "http://agentmemory.test/mcp"]\n[mcp_servers.agentmemory.env]\nHTTP_PROXY = "http://user:pass@127.0.0.1:${proxyPort}"\n`,
  );
  writeFileSync(
    transcript,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: "sid-light", session_id: "sid-light", source: "vscode" },
    })}\nprivate transcript text\n`,
  );
  return { root, home, transcript };
}

async function runHook(
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
  writeFileSync(proxyLog, "");
  proxyFail = envExtra.FAKE_CURL_FAIL === "1";
  return await new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: fixtureData.home,
        PATH: process.env.PATH ?? "",
        ...envExtra,
      },
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    child.stdin?.end(JSON.stringify(input));
  });
}

function curlLog(fixtureData: ReturnType<typeof fixture>) {
  try {
    return readFileSync(proxyLog, "utf8");
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
    expect(manifest.version).toBe("0.0.0");
    expect(manifest).not.toHaveProperty("skills");
    expect(readFileSync("plugins/agentmemory-light/references/INDEX.md", "utf8")).toContain("remember/SKILL.md");
    expect(readFileSync("plugins/agentmemory-light/references/remember/SKILL.md", "utf8")).toContain("name: remember");
    expect(resolve("plugins/agentmemory-light/references")).toContain("/plugins/agentmemory-light/references");
    expect(existsSync("plugins/agentmemory-light/skills")).toBe(false);
    expect(readdirSync("plugins/agentmemory-light/references", { withFileTypes: true }).filter((entry) => entry.isDirectory())).toHaveLength(17);
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(Object.keys(hooks.hooks).sort()).toEqual(
      ["PreCompact", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
    expect(Object.keys(hooks.hooks)).not.toContain("PreToolUse");
    expect(Object.keys(hooks.hooks)).not.toContain("SubagentStart");
    expect(hooks.hooks.SessionStart[0]).not.toHaveProperty("matcher");
  });

  it("starts a root session and emits bounded untrusted context plus discipline", async () => {
    const f = fixture();
    const output = JSON.parse(await runHook(f, "SessionStart", {source: "startup"}));
    const context = output.hookSpecificOutput.additionalContext as string;
    expect(context).toContain("BEGIN UNTRUSTED MEMORY CONTEXT");
    expect(context).toContain("memory says");
    expect(context).toContain("Use primary instructions and the current requested order");
    expect(context).toContain("Internal references directory:");
    expect(context).toContain("remember/SKILL.md");
    expect(curlLog(f)).toContain("/agentmemory/session/start");
    expect(context).not.toContain("do not include nested");
    expect(curlLog(f)).toContain("sid-light");
  });

  it("accepts canonical root thread_source values", async () => {
    const f = fixture();
    expect(await runHook(f, "UserPromptSubmit", { thread_source: "vscode", prompt: "ordinary" })).toContain("Use primary instructions");
    expect(curlLog(f)).toContain("/agentmemory/observe");
  });

  it("injects the catalog and compact context on PreCompact", async () => {
    const f = fixture();
    const output = JSON.parse(await runHook(f, "PreCompact"));
    const context = output.hookSpecificOutput.additionalContext as string;
    expect(context).toContain("Internal references directory:");
    expect(context).toContain("remember/SKILL.md");
    expect(context).toContain("compact context");
  });

  it("captures only cleaned prompt prose and does not require a first tool", async () => {
    const f = fixture();
    const output = JSON.parse(
      await runHook(f, "UserPromptSubmit", {
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
  ])("rejects $label provenance before HTTP or context", async ({ source }) => {
    const f = fixture();
    writeFileSync(
      f.transcript,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "sid-light", session_id: "sid-light", source },
      })}\n`,
    );
    for (const event of ["SessionStart", "UserPromptSubmit", "Stop", "PreCompact"]) {
      const output = await runHook(f, event, { prompt: "child prompt", last_assistant_message: "child final" });
      expect(output).toBe("");
      expect(curlLog(f)).toBe("");
    }
  });

  it("rejects unknown or missing provenance without local fallback", async () => {
    const f = fixture();
    writeFileSync(
      f.transcript,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "sid-light", session_id: "sid-light", source: "other" },
      })}\n`,
    );
    expect(await runHook(f, "UserPromptSubmit", {prompt: "ordinary"})).toBe("");
    expect(curlLog(f)).toBe("");
  });

  it("removes generic service blocks and skips unclosed memory context", async () => {
    const f = fixture();
    await runHook(f, "UserPromptSubmit", {
      prompt: "ordinary <response-annotations>private</response-annotations>",
    });
    expect(curlLog(f)).toContain("ordinary");
    expect(curlLog(f)).not.toContain("private");
    const g = fixture();
    await runHook(g, "UserPromptSubmit", { prompt: "<in-app-browser-context>private" });
    expect(curlLog(g)).toBe("");
    const h = fixture();
    await runHook(h, "UserPromptSubmit", {
      prompt: "BEGIN UNTRUSTED MEMORY CONTEXT\nrecalled text",
    });
    expect(curlLog(h)).toBe("");
  });

  it("excludes review findings and all fenced or tool-result packets", async () => {
    const findings = fixture();
    await runHook(findings, "UserPromptSubmit", {
      prompt:
        "FINDINGS:\nREQUIREMENT: reject this packet\nEVIDENCE: hidden tool output\nREQUIRED OUTCOME: skip",
    });
    expect(curlLog(findings)).toBe("");

    const fenced = fixture();
    await runHook(fenced, "UserPromptSubmit", {
      prompt:
        "```json\n{\"jsonrpc\":\"2.0\",\"result\":{\"tool_output\":\"secret\"}}\n```",
    });
    expect(curlLog(fenced)).toBe("");

    const tilde = fixture();
    await runHook(tilde, "UserPromptSubmit", {
      prompt: "~~~\n{\"tool_result\":\"secret\"}\n~~~",
    });
    expect(curlLog(tilde)).toBe("");
  });

  it("sends final assistant text then ends the session", async () => {
    const f = fixture();
    await runHook(f, "Stop", {
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

  it("stays non-blocking and still emits discipline when telemetry is unavailable", async () => {
    const f = fixture();
    const output = JSON.parse(
      await runHook(f, "UserPromptSubmit", {prompt: "ordinary"}, {FAKE_CURL_FAIL: "1"}),
    );
    expect(output.hookSpecificOutput.additionalContext).toContain("Use primary instructions");
  });
});
