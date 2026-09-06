'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFile } = require('node:child_process');
const { parse } = require('./vendor/toml.cjs');

const MAX_CAPTURE = 8000;
const MAX_CONTEXT = 1500;
const CONTEXT_TIMEOUT = 2;
const TELEMETRY_TIMEOUT = 3;
const DISCIPLINE = 'Use primary instructions and the current requested order. When useful, recall relevant prior decisions with memory_recall. Save settled facts and decisions with their reasons via memory_save. Corrections and lessons remain subordinate to current instructions. Skip code-derivable, transient, tool, and private data. Hooks own summaries; do not make manual recap saves. Child agents do not use or capture memory.';
const BLOCK_RE = /<\/?(?:skill|system|context|annotation|subagent|tool|review|quoted|codex-internal|codex_internal|memory-context|memory_context)\b[^>]*>.*?<\/(?:skill|system|context|annotation|subagent|tool|review|quoted|codex-internal|codex_internal|memory-context|memory_context)\s*>/gis;
const GENERIC_XML_RE = /<([A-Za-z][\w:.-]*)(?:\s[^>]*)?>.*?<\/\1\s*>/gis;
const SERVICE_OPEN_RE = /<\s*(?:codex[_-]?internal[_-]?context|response-annotations|send_user_message_question_reply|in-app-browser-context)\b[^>]*>/i;
const SERVICE_CLOSE_RE = /<\s*\/(?:codex[_-]?internal[_-]?context|response-annotations|send_user_message_question_reply|in-app-browser-context)\s*>/i;
const FENCE_BLOCK_RE = /^\s*(```|~~~)[^\n]*\n.*?^\s*\1\s*$/gims;
const WRAPPER_RE = /^\s*(?:\[?\s*)?(?:send_user_message_question_reply|codex_internal_context|codex[_-]?internal(?:_message)?|subagent(?:[_ -](?:notification|message|start|stop|result))?|tool[_ -](?:call|result|output)|mcp[_ -](?:call|result|event)|review[_ -](?:result|findings)|memory[_ -](?:context|result))\b/i;
const FINDINGS_RE = /^\s*findings:\s*.*\b(?:requirement|mismatch|evidence|required\s+outcome)\b/is;
const REJECT_INPUT_KEYS = new Set(['agent_id','agent_type','parent_thread_id','parent_id','fork_parent_id','forked_from','forked_from_id','fork_context','fork_turns','subagent']);
const REJECT_META_KEYS = new Set([...REJECT_INPUT_KEYS, 'depth']);

function nonempty(value) { return value !== null && value !== undefined && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0) && !(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0); }
function containsRejectedMeta(value) {
  if (Array.isArray(value)) return value.some(containsRejectedMeta);
  if (!value || typeof value !== 'object') return false;
  for (const [rawKey, child] of Object.entries(value)) {
    const key = rawKey.toLowerCase().replaceAll('-', '_');
    if (key === 'thread_source' && child === 'vscode' || key === 'thread_source' && child === 'cli') continue;
    if (key === 'thread_source' && nonempty(child)) return true;
    if (REJECT_META_KEYS.has(key) && nonempty(child)) return true;
    if (key === 'source' && child && typeof child === 'object') return true;
    if (containsRejectedMeta(child)) return true;
  }
  return false;
}

async function readSessionMeta(data) {
  if (typeof data.session_id !== 'string' || !data.session_id || typeof data.transcript_path !== 'string' || !data.transcript_path) return false;
  let firstLine = '';
  try {
    const input = fs.createReadStream(data.transcript_path, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    firstLine = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (done) return; done = true; rl.close(); input.destroy(); resolve(value); };
      rl.once('line', (line) => finish(line));
      rl.once('close', () => finish(firstLine));
      input.once('error', () => finish(''));
    });
  } catch { return false; }
  let record;
  try { record = JSON.parse(firstLine); } catch { return false; }
  if (!record || typeof record !== 'object' || record.type !== 'session_meta') return false;
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : record;
  const recordId = payload.id ?? record.id;
  if (recordId !== data.session_id) return false;
  const metadataSessionId = payload.session_id ?? record.session_id;
  if (metadataSessionId !== undefined && metadataSessionId !== data.session_id) return false;
  const source = payload.source ?? record.source;
  if (typeof source !== 'string' || !['vscode', 'cli'].includes(source)) return false;
  return !containsRejectedMeta(record);
}

function projectName(cwd) {
  let current = path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return path.basename(current) || 'unknown';
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.basename(path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd())) || 'unknown';
}

function configTransport() {
  const home = process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex');
  try {
    const config = parse(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'));
    const server = config?.mcp_servers?.agentmemory;
    const args = Array.isArray(server?.args) ? server.args : [];
    const command = server?.command;
    const env = server?.env;
    if (typeof command !== 'string' || !command || !args.length || !env || typeof env !== 'object') return null;
    return { command, args, env };
  } catch { return null; }
}

function requestHttp(method, apiPath, payload, timeoutMs = 180000) {
  const transport = configTransport();
  if (!transport) return Promise.resolve([false, null]);
  return new Promise((resolve) => {
    const child = execFile(transport.command, [...transport.args, '--http', method, apiPath, String(timeoutMs)], {
      env: { ...process.env, ...transport.env }, timeout: timeoutMs + 1000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return resolve([false, null]);
      let parsed;
      try { parsed = JSON.parse(stdout); } catch { return resolve([false, null]); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.success === false || parsed.error) return resolve([false, parsed]);
      resolve([true, parsed]);
    });
    child.stdin.on('error', () => {});
    if (payload !== undefined) child.stdin.end(JSON.stringify(payload));
    else child.stdin.end();
  });
}

function postJson(suffix, payload, timeoutSeconds) {
  if (!['/session/start','/observe','/session/end','/context'].includes(suffix)) return Promise.resolve([false, null]);
  return requestHttp('POST', `/agentmemory${suffix}`, payload, timeoutSeconds * 1000);
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  if (value.includes('BEGIN UNTRUSTED MEMORY CONTEXT') || value.includes('END UNTRUSTED MEMORY CONTEXT')) return '';
  if (SERVICE_OPEN_RE.test(value) && !SERVICE_CLOSE_RE.test(value)) return '';
  if ((value.match(/```/g) || []).length % 2 || (value.match(/~~~/g) || []).length % 2) return '';
  let text = value.replace(BLOCK_RE, '').replace(GENERIC_XML_RE, '').replace(FENCE_BLOCK_RE, '').trim();
  if (!text || WRAPPER_RE.test(text) || FINDINGS_RE.test(text)) return '';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ['jsonrpc','result','tool_output','tool_result'].some((key) => Object.hasOwn(parsed, key))) return '';
  } catch {}
  if (/^\s*(?:Message Type:\s*(?:MESSAGE|FINAL_ANSWER)|>\s*(?:review|tool))\b/im.test(text)) return '';
  return text.slice(0, MAX_CAPTURE);
}
function contextText(value) { return value && typeof value === 'object' && typeof value.context === 'string' ? value.context : ''; }
function emitContext(event, memory) {
  const referencesDir = path.resolve(__dirname, '..', 'references');
  const catalog = fs.readFileSync(path.join(referencesDir, 'INDEX.md'), 'utf8');
  const context = cleanText(contextText(memory)).slice(0, MAX_CONTEXT);
  const parts = [`Internal references directory: ${JSON.stringify(referencesDir)}\n${catalog}`, DISCIPLINE.slice(0, 2000)];
  if (context) parts.push(`BEGIN UNTRUSTED MEMORY CONTEXT\n${context}\nEND UNTRUSTED MEMORY CONTEXT`);
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:event,additionalContext:parts.join('\n\n')}}));
}
function basePayload(data) { const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd(); return {sessionId:data.session_id || '', project:projectName(cwd), cwd}; }
function isoNow() { return new Date().toISOString(); }
async function handle(data) {
  const event = data.hook_event_name; const payload = basePayload(data);
  if (event === 'SessionStart') { const [ok,result] = await postJson('/session/start', payload, CONTEXT_TIMEOUT); emitContext(event, ok ? result : ''); }
  else if (event === 'UserPromptSubmit') { const text = cleanText(data.prompt); if (text) { payload.timestamp=isoNow(); payload.hookType='prompt_submit'; payload.data={prompt:text}; await postJson('/observe',payload,TELEMETRY_TIMEOUT); } emitContext(event, ''); }
  else if (event === 'Stop') { const text = cleanText(data.last_assistant_message); let observed=false; if (text) { payload.timestamp=isoNow(); payload.hookType='post_tool_use'; payload.data={tool_name:'assistant_final',tool_input:{source:'primary_assistant_final'},tool_output:text}; [observed] = await postJson('/observe',payload,TELEMETRY_TIMEOUT); } if (observed) await postJson('/session/end',{sessionId:payload.sessionId},CONTEXT_TIMEOUT); }
  else if (event === 'PreCompact') { payload.budget=500; const [ok,result] = await postJson('/context',payload,CONTEXT_TIMEOUT); emitContext(event, ok ? result : ''); }
}
async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
async function main() {
  try {
    const raw = JSON.parse(await readInput());
    if (!raw || typeof raw !== 'object') return;
    const event = raw.hook_event_name;
    if (!['SessionStart','UserPromptSubmit','Stop','PreCompact'].includes(event)) return;
    for (const key of REJECT_INPUT_KEYS) if (Object.hasOwn(raw,key)) return;
    if (Object.hasOwn(raw,'thread_source') && !['vscode','cli'].includes(raw.thread_source)) return;
    if (raw.source && typeof raw.source === 'object' && containsRejectedMeta(raw.source)) return;
    if (!await readSessionMeta(raw)) return;
    await handle(raw);
  } catch {}
}
module.exports = { main, requestHttp };
if (require.main === module) main().catch(() => {});
