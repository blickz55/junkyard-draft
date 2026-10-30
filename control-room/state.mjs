// Pure state reducer for the Workshop Control Room.
// Consumes the JSONL event stream (hook events + reported events) and produces
// the dashboard model. No I/O here so it can be unit-tested.

export const STAGES = ['backlog', 'design', 'implement', 'test', 'inspect', 'review', 'checkpoint'];
export const STAGE_LABELS = {
  backlog: 'Backlog',
  design: 'Design',
  implement: 'Implement',
  test: 'Test',
  inspect: 'Visual Inspection',
  review: 'Review',
  checkpoint: 'Checkpoint',
};
const FEED_LIMIT = 3000;
export const TOOL_CALL_LIMIT = 2000;

export function createState() {
  return {
    rulesVersion: 2,
    objective: null, // latest cr.objective (reported)
    tasks: {}, // id -> task (reported)
    checks: [], // cr.check (reported)
    screenshots: [], // cr.screenshot (reported, path verified at emit time)
    builds: { dev: null, verified: null, production: null },
    checkpoints: [],
    notes: [],
    selftest: [],
    sessions: {}, // session_id -> {id, startedAt, source, model, lastEventAt, endedAt, reason}
    agents: {}, // agent key -> {...}
    pendingAgentSpawns: [], // Agent tool PreToolUse not yet matched to a SubagentStart
    toolCalls: {}, // tool_use_id -> {started, ended, ok}
    feed: [], // bounded event list, newest last
    counts: { hook: 0, reported: 0, failures: 0 },
    lastHookAt: null,
    lastReportedAt: null,
    lastActivity: null, // {ts, summary, agent, file}
    cloudVisibility: 'unavailable', // scheduled cloud runs do not reach this collector
    usage: { status: 'unavailable', note: 'No reliable usage telemetry is exposed to project hooks.' },
  };
}

function agentKey(e) {
  if (e.agent_id) return `agent:${e.agent_id}`;
  return `main:${e.session_id || 'unknown'}`;
}

function describe(e) {
  const t = e.tool_name;
  const i = e.input || {};
  switch (e.event) {
    case 'PreToolUse':
      if (t === 'Bash') return `run: ${i.description || i.command || ''}`;
      if (t === 'Read') return `read ${i.file || ''}`;
      if (t === 'Write') return `write ${i.file || ''}`;
      if (t === 'Edit') return `edit ${i.file || ''}`;
      if (t === 'Glob' || t === 'Grep') return `${t.toLowerCase()} ${i.pattern || ''}`;
      if (t === 'Agent') return `spawn agent: ${i.description || ''}`;
      if (t === 'WebSearch') return `search: ${i.query || ''}`;
      if (t === 'WebFetch') return `fetch ${i.url || ''}`;
      return `${t || 'tool'} start`;
    case 'PostToolUse': {
      const r = e.response || {};
      const code = r.exit_code != null ? ` (exit ${r.exit_code})` : '';
      if (t === 'Bash') return `done: ${i.description || i.command || 'command'}${code}`;
      return `${t || 'tool'} done`;
    }
    case 'PostToolUseFailure':
      return `FAILED: ${t || 'tool'} ${i.description || i.file || i.command || ''} ${e.error || ''}`.trim();
    case 'SubagentStart':
      return `subagent started (${e.agent_type || 'unknown type'})`;
    case 'SubagentStop':
      return `subagent stopped`;
    case 'SessionStart':
      return `session started (${e.source || '?'})${e.model ? ' model=' + e.model : ''}`;
    case 'SessionEnd':
      return `session ended (${e.reason || '?'})`;
    case 'UserPromptSubmit':
      return 'user prompt submitted';
    case 'Stop':
      return 'main agent turn ended';
    case 'TaskCreated':
      return `task created: ${e.task_subject || e.task_id || ''}`;
    case 'TaskCompleted':
      return `task completed: ${e.task_subject || e.task_id || ''}`;
    case 'PostModelSwitch':
      return `model switched ${e.from_model || '?'} → ${e.to_model || '?'}`;
    case 'PreCompact':
      return `context compaction (${e.trigger || '?'})`;
    case 'Notification':
      return `notification: ${e.message || e.notification_type || ''}`;
    case 'cr.objective':
      return `objective: ${e.title || ''}`;
    case 'cr.task':
      return `task ${e.id || ''} → ${e.stage || ''}/${e.status || ''}`;
    case 'cr.check':
      return `check ${e.result === 'pass' ? 'PASSED' : 'FAILED'}: ${e.name || ''}`;
    case 'cr.screenshot':
      return `screenshot ${e.path || ''}`;
    case 'cr.build':
      return `build ${e.kind || ''}: ${e.result || ''}`;
    case 'cr.checkpoint':
      return `checkpoint ${e.commit || ''}: ${e.summary || ''}`;
    case 'cr.note':
      return `note: ${e.text || ''}`;
    case 'cr.selftest':
      return `instrumentation self-test: ${e.phase || ''} — ${e.note || ''}`;
    default:
      return e.event;
  }
}

export function reduce(state, e, seq) {
  if (!e || typeof e !== 'object' || !e.event) return state;
  const ts = e.ts || new Date().toISOString();
  const currentTask = state.objective ? state.objective.task : undefined;
  const entry = {
    seq,
    ts,
    kind: e.kind || (e.event.startsWith('cr.') ? 'reported' : 'hook'),
    event: e.event,
    summary: describe(e),
    agent: e.kind === 'reported' ? e.agent || 'main' : agentKey(e),
    task: e.task || e.task_id_reported || currentTask,
    raw: e,
  };
  if (entry.kind === 'hook') {
    state.counts.hook++;
    state.lastHookAt = ts;
    const sid = e.session_id || 'unknown';
    const s = (state.sessions[sid] ||= { id: sid, startedAt: ts, source: null, model: null, lastEventAt: ts });
    s.lastEventAt = ts;
    const key = agentKey(e);
    const a = (state.agents[key] ||= {
      key,
      id: e.agent_id || null,
      session: sid,
      type: e.agent_id ? e.agent_type || 'subagent' : 'main',
      parent: e.agent_id ? `main:${sid}` : null,
      startedAt: ts,
      lastEventAt: ts,
      status: 'running',
      task: null,
      lastTool: null,
      result: null,
      modelConfigured: null,
      modelObserved: null,
      toolCount: 0,
      failures: 0,
    });
    a.lastEventAt = ts;
    if (e.agent_type && !a.type.includes(e.agent_type)) a.type = e.agent_type;
    switch (e.event) {
      case 'SessionStart':
        s.source = e.source || s.source;
        if (e.model) {
          s.model = e.model;
          a.modelObserved = e.model;
        }
        if (e.agent_id) {
          a.status = 'running';
          a.startedAt = ts;
        }
        break;
      case 'SessionEnd':
        s.endedAt = ts;
        s.reason = e.reason;
        if (!e.agent_id) a.status = 'ended';
        break;
      case 'PostModelSwitch':
        if (e.to_model) {
          s.model = e.to_model;
          a.modelObserved = e.to_model;
        }
        break;
      case 'PreToolUse':
        a.toolCount++;
        a.lastTool = { ts, tool: e.tool_name, summary: entry.summary, file: e.input?.file, command: e.input?.command, id: e.tool_use_id };
        a.status = 'running';
        if (e.tool_use_id) state.toolCalls[e.tool_use_id] = { started: ts, tool: e.tool_name, agent: key, ok: null, seq };
        if (e.tool_name === 'Agent')
          state.pendingAgentSpawns.push({
            ts,
            description: e.input?.description,
            subagent_type: e.input?.subagent_type,
            model: e.input?.model,
            tool_use_id: e.tool_use_id,
            parent: key,
          });
        break;
      case 'PostToolUse':
        if (e.tool_use_id && state.toolCalls[e.tool_use_id]) {
          const c = state.toolCalls[e.tool_use_id];
          c.ended = ts;
          c.ok = !(e.response?.is_error || (e.response?.exit_code != null && e.response.exit_code !== 0));
        }
        if (a.lastTool && a.lastTool.id === e.tool_use_id) a.lastTool.ended = ts;
        break;
      case 'PostToolUseFailure':
        state.counts.failures++;
        a.failures++;
        if (e.tool_use_id && state.toolCalls[e.tool_use_id]) {
          state.toolCalls[e.tool_use_id].ended = ts;
          state.toolCalls[e.tool_use_id].ok = false;
        }
        break;
      case 'SubagentStart': {
        a.status = 'running';
        a.startedAt = ts;
        const spawn = state.pendingAgentSpawns.shift();
        if (spawn) {
          a.task = spawn.description || null;
          a.parent = spawn.parent;
          a.modelConfigured = spawn.model || null;
          a.spawnToolUseId = spawn.tool_use_id;
          if (spawn.subagent_type && (!a.type || a.type === 'subagent')) a.type = spawn.subagent_type;
        }
        break;
      }
      case 'SubagentStop':
        a.status = 'stopped';
        a.endedAt = ts;
        a.result = e.last_message || null;
        break;
      case 'Stop':
        if (!e.agent_id) a.status = 'waiting';
        break;
      default:
        break;
    }
    state.lastActivity = { ts, summary: entry.summary, agent: key, file: e.input?.file, command: e.input?.command };
  } else {
    state.counts.reported++;
    state.lastReportedAt = ts;
    switch (e.event) {
      case 'cr.objective':
        state.objective = {
          ts,
          task: e.task,
          title: e.title,
          criterion: e.criterion,
          stage: e.stage,
          agent: e.agent || 'main',
          next: e.next,
          blocker: e.blocker && e.blocker !== 'none' ? e.blocker : null,
        };
        entry.task = e.task;
        if (e.task) {
          const t = (state.tasks[e.task] ||= { id: e.task, title: e.title, createdAt: ts, history: [] });
          if (e.stage) t.stage = e.stage;
          if (!t.status || t.status === 'queued') t.status = 'active';
          t.title = e.title || t.title;
          t.agent = e.agent || t.agent || 'main';
          t.updatedAt = ts;
        }
        break;
      case 'cr.task': {
        const t = (state.tasks[e.id] ||= { id: e.id, createdAt: ts, history: [] });
        if (e.title) t.title = e.title;
        if (e.stage) t.stage = e.stage;
        if (e.status) t.status = e.status;
        if (e.deps) t.deps = e.deps;
        if (e.agent) t.agent = e.agent;
        if (e.note) t.note = e.note;
        if (e.criterion) t.criterion = e.criterion;
        t.updatedAt = ts;
        t.history.push({ ts, stage: e.stage, status: e.status, note: e.note });
        entry.task = e.id;
        break;
      }
      case 'cr.check':
        state.checks.push({ seq, ts, task: e.task, name: e.name, command: e.command, result: e.result, report: e.report, summary: e.summary });
        entry.task = e.task;
        if (e.task && state.tasks[e.task] && e.result === 'fail')
          state.tasks[e.task].lastFailedCheck = { ts, name: e.name, command: e.command, report: e.report };
        break;
      case 'cr.screenshot':
        state.screenshots.push({ seq, ts, path: e.path, task: e.task, note: e.note, captured: e.captured });
        entry.task = e.task;
        break;
      case 'cr.build':
        state.builds[e.kind || 'dev'] = { ts, result: e.result, url: e.url, commit: e.commit, note: e.note };
        break;
      case 'cr.checkpoint':
        state.checkpoints.push({ seq, ts, commit: e.commit, summary: e.summary, task: e.task });
        entry.task = e.task;
        break;
      case 'cr.note':
        state.notes.push({ seq, ts, text: e.text, task: e.task });
        entry.task = e.task;
        break;
      case 'cr.selftest':
        state.selftest.push({ seq, ts, phase: e.phase, note: e.note });
        break;
      default:
        break;
    }
  }
  state.feed.push(entry);
  if (state.feed.length > FEED_LIMIT) state.feed.splice(0, state.feed.length - FEED_LIMIT);
  if (state.screenshots.length > 60) state.screenshots.splice(0, state.screenshots.length - 60);
  if (state.checks.length > 300) state.checks.splice(0, state.checks.length - 300);
  if (state.pendingAgentSpawns.length > 20) state.pendingAgentSpawns.splice(0, state.pendingAgentSpawns.length - 20);
  const calls = Object.keys(state.toolCalls); // tool-call history is working memory for matching start/end, not an archive (review)
  if (calls.length > TOOL_CALL_LIMIT) for (const id of calls.slice(0, calls.length - TOOL_CALL_LIMIT)) delete state.toolCalls[id];
  return state;
}

export function snapshot(state) {
  const { toolCalls, pendingAgentSpawns, ...rest } = state;
  return {
    ...rest,
    agents: Object.values(state.agents),
    tasks: Object.values(state.tasks),
    sessions: Object.values(state.sessions),
    stages: STAGES,
    stageLabels: STAGE_LABELS,
  };
}
