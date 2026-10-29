#!/usr/bin/env node
// Workshop Control Room — Claude Code hook collector.
// Reads one hook payload from stdin, keeps an allowlist of safe fields,
// redacts secrets, and appends a single JSON line to .control-room/events.jsonl.
// It must NEVER block Claude Code: always exit 0, never write to stdout,
// swallow every error, and stay bounded in time and size.

import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, '.control-room');
const OUT_FILE = path.join(OUT_DIR, 'events.jsonl');
const MAX_STDIN = 1_000_000;
const EXCERPT = 200;

// secret patterns and redaction live in redact.mjs (tested by tests/collector.test.mjs)
function clip(s, n = EXCERPT) {
  if (s == null) return undefined;
  const t = redact(String(s)).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
function rel(p) {
  if (typeof p !== 'string') return undefined;
  const r = path.isAbsolute(p) ? path.relative(ROOT, p) : p;
  return r.startsWith('..') ? '[outside-project]' : r || '.';
}

function summarizeInput(tool, input) {
  if (!input || typeof input !== 'object') return undefined;
  const s = {};
  switch (tool) {
    case 'Bash':
      s.command = clip(input.command, 240);
      s.description = clip(input.description, 120);
      if (input.run_in_background) s.background = true;
      break;
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      s.file = rel(input.file_path || input.notebook_path);
      if (tool === 'Write' && typeof input.content === 'string') s.bytes = input.content.length;
      break;
    case 'Glob': case 'Grep':
      s.pattern = clip(input.pattern, 120);
      if (input.path) s.path = rel(input.path);
      break;
    case 'Agent':
      s.description = clip(input.description, 120);
      s.subagent_type = input.subagent_type;
      if (input.model) s.model = input.model;
      if (input.run_in_background) s.background = true;
      break;
    case 'WebSearch': s.query = clip(input.query, 120); break;
    case 'WebFetch': s.url = clip(input.url, 160); break;
    case 'TaskCreate': case 'TaskUpdate':
      s.subject = clip(input.subject, 120); s.status = input.status; s.taskId = input.taskId; break;
    case 'SendUserFile': s.files = Array.isArray(input.files) ? input.files.slice(0, 5).map(rel) : undefined; break;
    default:
      s.keys = Object.keys(input).slice(0, 8);
  }
  return s;
}

function summarizeResponse(tool, resp) {
  if (resp == null) return undefined;
  const s = {};
  let text = '';
  if (typeof resp === 'string') text = resp;
  else if (typeof resp === 'object') {
    if (typeof resp.stdout === 'string') text = resp.stdout;
    else if (typeof resp.output === 'string') text = resp.output;
    else if (typeof resp.content === 'string') text = resp.content;
    else if (Array.isArray(resp.content)) text = resp.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
    if (typeof resp.exit_code === 'number') s.exit_code = resp.exit_code;
    if (typeof resp.exitCode === 'number') s.exit_code = resp.exitCode;
    if (typeof resp.interrupted === 'boolean') s.interrupted = resp.interrupted;
    if (typeof resp.is_error === 'boolean') s.is_error = resp.is_error;
    if (typeof resp.stderr === 'string' && resp.stderr.trim()) s.stderr = clip(resp.stderr, 160);
  }
  s.chars = text.length;
  if (tool === 'Bash' && text) {
    const m = text.match(/exit code[:\s]+(\d+)/i);
    if (m && s.exit_code == null) s.exit_code = Number(m[1]);
    s.excerpt = clip(text.slice(-400), 160);
  }
  return s;
}

function build(payload) {
  const e = { ts: new Date().toISOString(), kind: 'hook', event: payload.hook_event_name || 'Unknown' };
  for (const k of ['session_id', 'prompt_id', 'agent_id', 'agent_type', 'permission_mode', 'tool_name', 'tool_use_id', 'source', 'model', 'from_model', 'to_model', 'reason', 'trigger', 'task_id', 'task_subject', 'task_status', 'notification_type']) {
    if (payload[k] != null && (typeof payload[k] === 'string' || typeof payload[k] === 'number' || typeof payload[k] === 'boolean')) e[k] = typeof payload[k] === 'string' ? clip(payload[k], 160) : payload[k];
  }
  if (payload.cwd) e.cwd = rel(payload.cwd);
  if (payload.effort && typeof payload.effort === 'object' && payload.effort.level) e.effort = String(payload.effort.level);
  if (payload.tool_input) e.input = summarizeInput(payload.tool_name, payload.tool_input);
  if (payload.tool_response !== undefined) e.response = summarizeResponse(payload.tool_name, payload.tool_response);
  if (payload.error) e.error = clip(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error), 240);
  if (typeof payload.last_assistant_message === 'string') e.last_message = clip(payload.last_assistant_message, 300);
  if (typeof payload.message === 'string') e.message = clip(payload.message, 200);
  if (payload.task && typeof payload.task === 'object') {
    e.task_id = e.task_id ?? payload.task.id; e.task_subject = clip(payload.task.subject, 120); e.task_status = payload.task.status;
  }
  return e;
}

function main() {
  let raw = '';
  const timer = setTimeout(() => process.exit(0), 4000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { if (raw.length < MAX_STDIN) raw += c; });
  process.stdin.on('end', () => {
    clearTimeout(timer);
    try {
      const payload = JSON.parse(raw || '{}');
      const line = JSON.stringify(build(payload));
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.appendFileSync(OUT_FILE, line + '\n');
    } catch { /* never block Claude Code */ }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
}
try { main(); } catch { process.exit(0); }
