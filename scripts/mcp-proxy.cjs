'use strict';

const readline = require('node:readline');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const REQUEST_TIMEOUT_MS = 180_000;
const SSE_IDLE_TIMEOUT_MS = 300_000;
const DELETE_TIMEOUT_MS = 2_000;
const targetUrl = process.argv[2];
const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy;
let target;
let proxy;
let sessionId = '';
let protocolVersion = '';
let initialized = false;
let initializing = null;
let initializedNotification = null;
let closing = false;
let reconnectTimer = null;
let reconnectResolve = null;
const activeRequests = new Set();

function safeError(error) {
  if (error && error.code === 'HTTP') return `HTTP ${error.status}`;
  if (error && error.code === 'JSON') return 'invalid JSON response';
  if (error && error.code === 'UNSUPPORTED') return 'unsupported MCP transport';
  return 'MCP transport failed';
}
function httpError(status) { const error = new Error(); error.code = 'HTTP'; error.status = status || 0; return error; }
function jsonError() { const error = new Error(); error.code = 'JSON'; return error; }
function unsupportedError() { const error = new Error(); error.code = 'UNSUPPORTED'; return error; }
function output(message) { if (!closing && message && typeof message === 'object') process.stdout.write(`${JSON.stringify(message)}\n`); }
function fail(id, error) {
  const response = { jsonrpc: '2.0', id, error: { code: -32000, message: safeError(error) } };
  output(response);
}
function parseUrls() {
  try {
    target = new URL(targetUrl || '');
    proxy = new URL(proxyUrl || '');
    if (target.protocol !== 'http:' || !['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname) throw unsupportedError();
  } catch (error) { throw error.code === 'UNSUPPORTED' ? error : unsupportedError(); }
}
function headers(lastEventId = '') {
  const result = { Host: target.host, Accept: 'application/json, text/event-stream' };
  if (proxy.username || proxy.password) {
    const user = decodeURIComponent(proxy.username || '');
    const password = decodeURIComponent(proxy.password || '');
    result['Proxy-Authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }
  if (protocolVersion) result['MCP-Protocol-Version'] = protocolVersion;
  if (sessionId) result['MCP-Session-ID'] = sessionId;
  if (lastEventId) result['Last-Event-ID'] = lastEventId;
  return result;
}
function request(method, body, timeoutMs, options = {}) {
  if (closing && method !== 'DELETE') return Promise.reject(new Error());
  const client = proxy.protocol === 'https:' ? https : http;
  const requestHeaders = headers(options.lastEventId || '');
  let requestBody;
  if (body !== undefined) {
    requestBody = Buffer.from(JSON.stringify(body), 'utf8');
    requestHeaders['Content-Type'] = 'application/json';
    requestHeaders['Content-Length'] = requestBody.length;
  }
  const requestOptions = { protocol: proxy.protocol, hostname: proxy.hostname, port: proxy.port || undefined, method, path: target.href, headers: requestHeaders };
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let req;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeRequests.delete(req);
      if (error) reject(error); else resolve(value);
    };
    const idle = Boolean(options.stream);
    const armTimer = () => { clearTimeout(timer); timer = setTimeout(() => { finish(new Error()); req.destroy(); }, timeoutMs); };
    const onSse = (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { finish(httpError(res.statusCode)); res.destroy(); return; }
      let event = '';
      let data = [];
      let eventId = '';
      let retryValue;
      let matched = false;
      const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
      const dispatch = () => {
        if (!data.length) {
          if (options.onEventMetadata) options.onEventMetadata({ id: eventId, retry: retryValue });
          event = '';
          retryValue = undefined;
          return;
        }
        const text = data.join('\n');
        data = [];
        if (event === 'message' || event === '') {
          let item;
          try { item = JSON.parse(text); } catch { event = ''; return; }
          if (options.onEventMetadata) options.onEventMetadata({ id: eventId, retry: retryValue });
          const stop = options.onMessage ? options.onMessage(item) : false;
          if (stop && !settled) { matched = true; finish(null, { statusCode: res.statusCode, headers: res.headers }); rl.close(); res.destroy(); }
        }
        event = '';
        retryValue = undefined;
      };
      if (idle) armTimer();
      res.on('data', () => { if (idle) armTimer(); });
      res.on('error', () => finish(new Error()));
      res.on('aborted', () => finish(new Error()));
      rl.on('line', (line) => {
        if (settled) return;
        if (line === '') { dispatch(); return; }
        if (line.startsWith(':')) return;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id' && !value.includes('\0')) eventId = value;
        else if (field === 'retry' && /^\d+$/.test(value)) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) retryValue = parsed;
        }
      });
      rl.on('close', () => { if (data.length) dispatch(); if (matched || !options.stream) finish(null, { statusCode: res.statusCode, headers: res.headers }); });
      res.on('end', () => { if (data.length) dispatch(); finish(null, { statusCode: res.statusCode, headers: res.headers }); });
      return;
    };
    req = client.request(requestOptions, (res) => {
      if (method === 'POST' && res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
      if (String(res.headers['content-type'] || '').includes('text/event-stream')) { onSse(res); return; }
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); });
      res.on('error', () => finish(new Error()));
      res.on('aborted', () => finish(new Error()));
      res.on('end', () => finish(null, { statusCode: res.statusCode || 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    activeRequests.add(req);
    armTimer();
    req.on('error', () => finish(new Error()));
    if (requestBody) req.write(requestBody);
    req.end();
  });
}
function validate(response) { if (!response || response.statusCode < 200 || response.statusCode >= 300) throw httpError(response?.statusCode); return response; }
async function postMessage(message) {
  let matchedMessage = null;
  const response = validate(await request('POST', message, REQUEST_TIMEOUT_MS, {
    onMessage: (item) => {
      if (item && item.method) { output(item); return false; }
      if (message.id !== undefined && item && item.id === message.id) { matchedMessage = item; return true; }
      output(item); return false;
    },
  }));
  if (matchedMessage) return matchedMessage;
  if (!response.text) return null;
  try { return JSON.parse(response.text); } catch { throw jsonError(); }
}
async function openServerEvents() {
  let lastEventId = '';
  let retryMs = 1000;
  let consecutiveFailures = 0;
  while (!closing && sessionId) {
    try {
      validate(await request('GET', undefined, SSE_IDLE_TIMEOUT_MS, {
        stream: true,
        lastEventId,
        onMessage: output,
        onEventMetadata: ({ id, retry }) => {
          if (id) lastEventId = id;
          if (retry !== undefined) retryMs = retry;
        },
      }));
      consecutiveFailures = 0;
    } catch (error) {
      if (error.code === 'HTTP' && (error.status === 404 || error.status === 405)) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) return;
    }
    if (closing || !sessionId) return;
    await new Promise((resolve) => {
      reconnectResolve = resolve;
      reconnectTimer = setTimeout(() => { reconnectTimer = null; reconnectResolve = null; resolve(); }, retryMs);
    });
  }
}
async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  const isRequest = typeof message.method === 'string' && Object.hasOwn(message, 'id');
  try {
    if (message.method === 'initialize' && isRequest) {
      initializing = (async () => {
        const response = await postMessage(message);
        if (!response || response.id !== message.id || !response.result || typeof response.result.protocolVersion !== 'string') {
          if (response?.id === message.id && response.error) {
            const error = jsonError();
            error.rpcResponse = response;
            throw error;
          }
          throw jsonError();
        }
        protocolVersion = response.result.protocolVersion;
        output(response);
        initialized = true;
      })();
      await initializing;
      return;
    }
    if (message.method === 'notifications/initialized') {
      initializedNotification = (async () => {
        if (initializing) await initializing;
        const response = await postMessage(message);
        if (response) output(response);
        void openServerEvents();
      })();
      await initializedNotification;
      return;
    }
    if (!initialized) { if (initializing) await initializing; else throw unsupportedError(); }
    if (initializedNotification) await initializedNotification;
    const response = await postMessage(message);
    if (response) output(response);
    else if (isRequest) throw jsonError();
  } catch (error) {
    if (error?.rpcResponse) output(error.rpcResponse);
    else if (isRequest) fail(message.id, error);
    else process.stderr.write(`MCP request: ${safeError(error)}\n`);
  }
}
async function cleanup() {
  if (closing) return;
  closing = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (reconnectResolve) reconnectResolve();
  reconnectTimer = null;
  reconnectResolve = null;
  for (const req of activeRequests) req.destroy();
  if (sessionId && target && proxy) {
    try { await request('DELETE', undefined, DELETE_TIMEOUT_MS); } catch { /* best effort */ }
  }
}
async function main() {
  try { parseUrls(); } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; return; }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (closing || !line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { process.stderr.write('MCP input: invalid JSON\n'); return; }
    void handleMessage(message);
  });
  await new Promise((resolve) => rl.once('close', resolve));
  await cleanup();
}
module.exports = { main };
if (require.main === module) {
  process.once('SIGTERM', () => void cleanup().finally(() => process.exit(0)));
  process.once('SIGINT', () => void cleanup().finally(() => process.exit(0)));
  main().catch(() => { process.stderr.write('MCP transport failed\n'); process.exitCode = 1; });
}
