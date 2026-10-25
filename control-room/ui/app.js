/* Workshop Control Room — read-only browser client. Plain JS, no build step. */
(() => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let summary = null;
  let feed = [];
  let selectedTask = null;
  let sseOk = false;
  const filters = { agent: '', task: '', type: '', text: '' };

  const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : '—');
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function age(ts) {
    if (!ts) return '—';
    const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  }
  const shortAgent = (k) => (!k ? '—' : k.startsWith('main:') ? 'main' : k.replace('agent:', 'agent ').slice(0, 20));

  // ---------- SSE ----------
  function connect() {
    const es = new EventSource('/events');
    es.addEventListener('state', (m) => { const d = JSON.parse(m.data); state = d; summary = d.summary; feed = d.feed || []; sseOk = true; renderAll(); loadSide(); });
    es.addEventListener('event', (m) => { const e = JSON.parse(m.data); feed.push(e); if (feed.length > 3000) feed.shift(); appendFeedItem(e, true); if (e.kind === 'reported' || /Subagent|Session|Stop|Failure|ToolUse/.test(e.event)) scheduleRefresh(); });
    es.addEventListener('summary', (m) => { summary = JSON.parse(m.data); renderHeader(); renderWork(); });
    es.onopen = () => { sseOk = true; renderHeader(); };
    es.onerror = () => { sseOk = false; renderHeader(); };
  }
  let refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { try { const r = await fetch('/api/state'); state = await r.json(); summary = state.summary; renderStructural(); } catch {} }, 400); }
  async function loadSide() {
    try { const g = await (await fetch('/api/git')).json(); renderCommits(g); } catch {}
    try { const m = await (await fetch('/api/milestones')).json(); renderMilestones(m); } catch {}
  }
  setInterval(loadSide, 20000);
  setInterval(() => { renderHeader(); renderAges(); }, 1000);

  // ---------- header ----------
  function renderHeader() {
    const p = $('pill-sse'); p.className = 'pill ' + (sseOk ? 'ok' : 'bad'); p.querySelector('.lbl').textContent = sseOk ? 'stream: live' : 'stream: DISCONNECTED';
    const h = $('pill-hook'); const last = summary?.lastHookAt;
    const s = last ? (Date.now() - new Date(last).getTime()) / 1000 : Infinity;
    h.className = 'pill ' + (!last ? '' : s < 120 ? 'ok' : s < 900 ? 'warn' : '');
    h.querySelector('.lbl').textContent = 'last hook: ' + (last ? age(last) : 'none yet');
    if (summary) $('pill-counts').textContent = `${summary.counts.hook} hook · ${summary.counts.reported} reported · ${summary.counts.failures} failures`;
  }
  function renderAges() {
    if (!summary) return;
    $('last-op-age').textContent = summary.lastActivity ? age(summary.lastActivity.ts) : '—';
  }

  // ---------- current work ----------
  function renderWork() {
    const o = summary?.objective || state?.objective;
    $('obj-title').textContent = o?.title || 'No objective reported yet';
    $('obj-criterion').textContent = o?.criterion || '—';
    $('obj-stage').innerHTML = o?.stage ? `<span class="stage-chip">${esc(state?.stageLabels?.[o.stage] || o.stage)}</span>` : '—';
    $('obj-agent').textContent = o?.agent || '—';
    $('obj-task').textContent = o?.task || '—';
    $('obj-next').textContent = o?.next || '—';
    $('obj-blocker-wrap').classList.toggle('hidden', !o?.blocker); $('obj-blocker').textContent = o?.blocker || '';
    const la = summary?.lastActivity;
    $('last-op').textContent = la?.summary || 'No runtime hook event observed yet';
    $('last-op-ref').textContent = la ? [la.file, la.command].filter(Boolean).join(' · ') : '';
    $('last-hook-ts').textContent = summary?.lastHookAt ? fmtDate(summary.lastHookAt) : 'none';
    $('last-rep-ts').textContent = summary?.lastReportedAt ? fmtDate(summary.lastReportedAt) : 'none';
    $('collector-info').textContent = summary ? `${summary.eventsFile} · ${summary.fileBytes} B · up since ${fmtTime(summary.collectorStartedAt)} · ${summary.clients} viewer(s)` : '—';
    $('cloud-vis').textContent = state?.cloudVisibility || 'unavailable';
    renderAges();
  }

  // ---------- pipeline (SVG) ----------
  function renderPipeline() {
    const svg = $('pipe-svg'); if (!state) return;
    const stages = state.stages, labels = state.stageLabels;
    const tasks = (state.tasks || []).slice().sort((a, b) => (a.id > b.id ? 1 : -1));
    const colW = 150, gap = 10, pad = 12, top = 44, rowH = 58, rowGap = 8;
    const byStage = Object.fromEntries(stages.map((s) => [s, []]));
    for (const t of tasks) (byStage[stages.includes(t.stage) ? t.stage : 'backlog']).push(t);
    const rows = Math.max(3, ...Object.values(byStage).map((a) => a.length));
    const H = top + rows * (rowH + rowGap) + pad;
    const W = stages.length * (colW + gap) + pad * 2;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
    const pos = {};
    let out = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow"/></marker></defs>';
    const activeStage = state.objective?.stage;
    stages.forEach((s, i) => {
      const x = pad + i * (colW + gap);
      const isActive = s === activeStage || byStage[s].some((t) => t.status === 'active');
      out += `<rect class="col-bg ${isActive ? 'active' : ''}" x="${x}" y="${pad}" width="${colW}" height="${H - pad * 2}" rx="8"/>`;
      out += `<text class="col-title" x="${x + 10}" y="${pad + 20}">${esc(labels[s])}</text>`;
      out += `<text class="col-count" x="${x + colW - 10}" y="${pad + 20}" text-anchor="end">${byStage[s].length}</text>`;
      if (i < stages.length - 1) out += `<text class="stage-arrow" x="${x + colW + 1}" y="${pad + 21}">›</text>`;
      byStage[s].forEach((t, j) => {
        const y = top + j * (rowH + rowGap);
        pos[t.id] = { x, y, w: colW - 12, h: rowH, cx: x + (colW - 12) / 2 };
        const title = (t.title || t.id).length > 22 ? (t.title || t.id).slice(0, 21) + '…' : (t.title || t.id);
        out += `<g class="task ${esc(t.status || 'queued')}" data-id="${esc(t.id)}" transform="translate(${x + 6},${y})"><rect width="${colW - 12}" height="${rowH}"/><text class="id" x="8" y="15">${esc(t.id)}${t.lastFailedCheck ? ' ⚠' : ''}</text><text x="8" y="32">${esc(title)}</text><text class="agent" x="8" y="48">${esc(t.agent || 'main')} · ${esc(t.status || 'queued')}</text></g>`;
      });
    });
    let lines = '';
    for (const t of tasks) {
      for (const d of t.deps || []) {
        const a = pos[d], b = pos[t.id]; if (!a || !b) continue;
        if (a.x === b.x) { // same column: short hop along the left edge
          const x = a.x + 2, y1 = a.y + a.h, y2 = b.y; const up = y2 < y1;
          lines += `<path class="dep" marker-end="url(#arr)" d="M${x + 4} ${up ? a.y : y1} C ${x - 10} ${up ? a.y - 12 : y1 + 12}, ${x - 10} ${up ? y2 + a.h + 12 : y2 - 12}, ${x + 4} ${up ? y2 + a.h : y2}"/>`;
          continue;
        }
        const back = a.x > b.x;
        const x1 = back ? a.x + 6 : a.x + a.w + 6, y1 = a.y + a.h / 2, x2 = back ? b.x + b.w + 6 : b.x + 6, y2 = b.y + b.h / 2;
        const c = Math.abs(x2 - x1) / 2;
        lines += `<path class="dep" marker-end="url(#arr)" d="M${x1} ${y1} C ${x1 + (back ? -c : c)} ${y1}, ${x2 + (back ? c : -c)} ${y2}, ${x2} ${y2}"/>`;
      }
      if (t.lastFailedCheck && t.stage === 'implement') { const b = pos[t.id]; if (b) lines += `<text class="agent" x="${b.x + 6}" y="${b.y - 2}" fill="#e5574a" font-size="10">returned after failed ${esc(t.lastFailedCheck.name)}</text>`; }
    }
    svg.innerHTML = out + lines;
    svg.querySelectorAll('.task').forEach((g) => g.addEventListener('click', () => openTask(g.dataset.id)));
  }

  // ---------- agents ----------
  function renderAgents() {
    const list = $('agent-list'); if (!state) return;
    const agents = state.agents || [];
    if (!agents.length) { list.innerHTML = '<p class="note">No runtime hook events observed yet. Agents appear only when Claude Code hooks report them.</p>'; return; }
    const mains = agents.filter((a) => !a.parent), kids = agents.filter((a) => a.parent);
    const card = (a, child) => `<div class="agent ${child ? 'child' : ''}">
      <div class="agent-head"><span class="agent-name">${child ? '↳ ' : ''}${esc(a.type === 'main' ? 'Main Claude session' : `Subagent · ${a.type}`)}</span><span class="st ${esc(a.status)}">${esc(a.status)}</span></div>
      <div class="kv"><span class="k">id</span><span class="mono">${esc(a.id || a.session.slice(0, 12))}</span></div>
      ${child ? `<div class="kv"><span class="k">parent</span><span class="mono">${esc(shortAgent(a.parent))}</span></div>` : ''}
      <div class="kv"><span class="k">assigned task</span><span>${esc(a.task || (child ? 'unavailable' : state.objective?.title || '—'))}</span></div>
      <div class="kv"><span class="k">started</span><span class="mono">${fmtTime(a.startedAt)}</span></div>
      <div class="kv"><span class="k">last event</span><span class="mono">${fmtTime(a.lastEventAt)} (${age(a.lastEventAt)})</span></div>
      <div class="kv"><span class="k">model configured</span><span class="mono">${esc(a.modelConfigured || 'unavailable')}</span></div>
      <div class="kv"><span class="k">model observed</span><span class="mono">${esc(a.modelObserved || 'unavailable')}</span></div>
      <div class="kv"><span class="k">tool calls / failures</span><span class="mono">${a.toolCount} / ${a.failures}</span></div>
      <div class="kv"><span class="k">last tool</span><span class="small">${esc(a.lastTool?.summary || '—')}</span></div>
      ${a.result ? `<div class="kv"><span class="k">final result</span><span class="small">${esc(a.result)}</span></div>` : ''}
    </div>`;
    list.innerHTML = mains.map((m) => card(m, false) + kids.filter((k) => k.parent === m.key).map((k) => card(k, true)).join('')).join('') + kids.filter((k) => !mains.some((m) => m.key === k.parent)).map((k) => card(k, true)).join('');
  }

  // ---------- feed ----------
  function typeOf(e) {
    if (e.event === 'PostToolUseFailure' || e.event === 'cr.check' && e.raw.result === 'fail') return 'failure';
    if (e.event === 'cr.checkpoint') return 'checkpoint';
    if (e.kind === 'reported') return 'reported';
    if (/Subagent|^Agent/.test(e.event) || e.raw.tool_name === 'Agent') return 'agent';
    if (['Edit', 'Write', 'NotebookEdit'].includes(e.raw.tool_name)) return 'edit';
    if (e.raw.tool_name === 'Bash') return 'command';
    if (/ToolUse/.test(e.event)) return 'tool';
    return 'other';
  }
  function matches(e) {
    if (filters.agent && e.agent !== filters.agent) return false;
    if (filters.task && e.task !== filters.task) return false;
    if (filters.type) { const t = typeOf(e); if (filters.type === 'tool' ? !['tool', 'edit', 'command', 'failure'].includes(t) : t !== filters.type) return false; }
    if (filters.text && !JSON.stringify(e).toLowerCase().includes(filters.text.toLowerCase())) return false;
    return true;
  }
  function feedItem(e) {
    const li = document.createElement('li');
    li.className = `${typeOf(e)} ${e.kind}`;
    const details = { ...e.raw }; delete details.ts;
    li.innerHTML = `<span class="t" title="${esc(e.ts)}">${fmtTime(e.ts)}</span><span class="ag" title="${esc(e.agent)}">${esc(shortAgent(e.agent))}${e.task ? ' · ' + esc(e.task) : ''}</span><details><summary class="summary">${esc(e.summary)}</summary><pre>${esc(JSON.stringify(details, null, 1))}</pre></details>`;
    return li;
  }
  function renderFeed() {
    const ol = $('feed-list'); ol.innerHTML = '';
    const items = feed.filter(matches).slice(-400);
    for (const e of items) ol.appendChild(feedItem(e));
    ol.scrollTop = ol.scrollHeight;
    const ag = new Set(feed.map((e) => e.agent).filter(Boolean)), tk = new Set(feed.map((e) => e.task).filter(Boolean));
    fillSelect($('f-agent'), [...ag], shortAgent, filters.agent); fillSelect($('f-task'), [...tk], (x) => x, filters.task);
  }
  function fillSelect(sel, values, label, cur) {
    const first = sel.options[0].outerHTML; sel.innerHTML = first + values.map((v) => `<option value="${esc(v)}">${esc(label(v))}</option>`).join(''); sel.value = cur;
  }
  function appendFeedItem(e, isNew) {
    if (!matches(e)) return;
    const ol = $('feed-list'); const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    const li = feedItem(e); if (isNew) li.classList.add('new'); ol.appendChild(li);
    while (ol.children.length > 400) ol.removeChild(ol.firstChild);
    if (atBottom) ol.scrollTop = ol.scrollHeight;
  }
  for (const [id, key] of [['f-agent', 'agent'], ['f-task', 'task'], ['f-type', 'type'], ['f-text', 'text']]) $(id).addEventListener('input', (ev) => { filters[key] = ev.target.value; renderFeed(); });

  // ---------- game & verification ----------
  function renderGame() {
    if (!state) return;
    const dev = state.builds?.dev, ver = state.builds?.verified;
    $('dev-link').href = dev?.url || state.gameDevUrl; $('dev-frame').dataset.src = dev?.url || state.gameDevUrl;
    $('dev-build-meta').textContent = dev ? `${dev.result} · ${fmtDate(dev.ts)}${dev.commit ? ' · ' + dev.commit : ''}` : 'no build result reported yet';
    $('ver-build-meta').textContent = ver ? `${ver.result} · ${fmtDate(ver.ts)}${ver.commit ? ' · commit ' + ver.commit : ''}${ver.note ? ' · ' + ver.note : ''}` : 'none recorded';
    $('check-rows').innerHTML = (state.checks || []).slice(-40).reverse().map((c) => `<tr><td class="mono small">${fmtTime(c.ts)}</td><td>${esc(c.name)}<div class="small mono">${esc(c.command || '')}</div>${c.summary ? `<div class="small">${esc(c.summary)}</div>` : ''}</td><td class="res ${esc(c.result)}">${esc(c.result)}</td><td><a href="#" data-task="${esc(c.task || '')}" class="mono">${esc(c.task || '—')}</a></td><td>${c.report ? `<a href="/reports/${esc(c.report.replace(/^\.control-room\/reports\//, ''))}" target="_blank">report</a>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="small">No check results reported yet.</td></tr>';
    $('check-rows').querySelectorAll('a[data-task]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); if (a.dataset.task) openTask(a.dataset.task); }));
    $('selftest').innerHTML = (state.selftest || []).map((s) => `<li><span class="res ${s.phase === 'pass' ? 'pass' : 'fail'}">${esc(s.phase)}</span> <span class="mono small">${fmtTime(s.ts)}</span> ${esc(s.note)}</li>`).join('') || '<li class="small">Not run yet.</li>';
    $('shots').innerHTML = (state.screenshots || []).slice(-12).reverse().map((s) => { const f = s.path.replace(/^\.control-room\/screenshots\//, ''); return `<a class="shot" href="/screenshots/${esc(f)}" target="_blank"><img src="/screenshots/${esc(f)}" alt="${esc(s.note || f)}" loading="lazy"/><div class="cap">${esc(f)}<br/>captured ${esc(s.captured && s.captured !== 'unavailable' ? fmtDate(s.captured) : 'unavailable')}${s.task ? ' · ' + esc(s.task) : ''}${s.note ? '<br/>' + esc(s.note) : ''}</div></a>`; }).join('') || '<p class="note">No gameplay screenshots recorded yet.</p>';
  }
  $('dev-embed').addEventListener('click', () => { const w = $('dev-frame-wrap'); w.classList.toggle('hidden'); if (!w.classList.contains('hidden')) $('dev-frame').src = $('dev-frame').dataset.src; else $('dev-frame').src = 'about:blank'; });
  function renderCommits(g) {
    $('git-meta').textContent = g.available ? `${g.commits.length} shown · ${g.dirtyFiles ?? '?'} uncommitted file(s)` : 'git unavailable';
    $('commits').innerHTML = g.commits.map((c) => `<li><span style="color:var(--amber)">${esc(c.hash)}</span> ${esc(c.subject)} <span style="color:var(--text-3)">${fmtDate(c.date)}</span></li>`).join('') || '<li class="small">No commits yet.</li>';
  }
  function renderMilestones(m) {
    if (!m.available) { $('ms-list').innerHTML = '<p class="note">docs/ROADMAP.md not found.</p>'; return; }
    $('ms-list').innerHTML = m.sections.map((s) => `<div class="ms"><div style="display:flex;justify-content:space-between"><strong>${esc(s.title)}</strong><span class="mono small">${s.done}/${s.total} criteria met</span></div><div class="bar"><i style="width:${s.total ? (100 * s.done / s.total).toFixed(0) : 0}%"></i></div><ul class="plain">${s.items.map((i) => `<li class="${i.done ? 'done' : i.active ? 'active' : ''}">${esc(i.text)}</li>`).join('')}</ul></div>`).join('');
  }

  // ---------- task drawer ----------
  function openTask(id) {
    selectedTask = id; const t = (state?.tasks || []).find((x) => x.id === id); if (!t) return;
    $('drawer').classList.remove('hidden'); $('drawer-title').textContent = `${t.id} · ${t.title || ''}`;
    const checks = (state.checks || []).filter((c) => c.task === id), shots = (state.screenshots || []).filter((s) => s.task === id), cps = (state.checkpoints || []).filter((c) => c.task === id);
    const hooks = feed.filter((e) => e.task === id && e.kind === 'hook').slice(-30);
    $('drawer-body').innerHTML = `
      <div class="kv"><span class="k">stage</span><span class="stage-chip">${esc(state.stageLabels[t.stage] || t.stage || 'backlog')}</span></div>
      <div class="kv"><span class="k">status</span><span class="st ${esc(t.status)}">${esc(t.status || 'queued')}</span></div>
      <div class="kv"><span class="k">agent</span><span>${esc(t.agent || 'main')}</span></div>
      <div class="kv"><span class="k">depends on</span><span class="mono">${esc((t.deps || []).join(', ') || '—')}</span></div>
      ${t.criterion ? `<div class="kv"><span class="k">criterion</span><span>${esc(t.criterion)}</span></div>` : ''}
      ${t.note ? `<div class="kv"><span class="k">note</span><span>${esc(t.note)}</span></div>` : ''}
      <h4>Stage history (reported)</h4><ul>${(t.history || []).map((h) => `<li><span class="mono small">${fmtTime(h.ts)}</span> ${esc(h.stage || '')} / ${esc(h.status || '')} ${h.note ? '— ' + esc(h.note) : ''}</li>`).join('') || '<li>—</li>'}</ul>
      <h4>Checks</h4><ul>${checks.map((c) => `<li><span class="res ${esc(c.result)}">${esc(c.result)}</span> ${esc(c.name)} <span class="mono small">${esc(c.command || '')}</span>${c.report ? ` · <a href="/reports/${esc(c.report.replace(/^\.control-room\/reports\//, ''))}" target="_blank">report</a>` : ''}</li>`).join('') || '<li>none</li>'}</ul>
      <h4>Screenshots</h4><div class="shots">${shots.map((s) => { const f = s.path.replace(/^\.control-room\/screenshots\//, ''); return `<a class="shot" href="/screenshots/${esc(f)}" target="_blank"><img src="/screenshots/${esc(f)}" alt=""/><div class="cap">${esc(f)}</div></a>`; }).join('') || '<span class="small">none</span>'}</div>
      <h4>Checkpoints</h4><ul>${cps.map((c) => `<li><span class="mono">${esc(c.commit)}</span> ${esc(c.summary)}</li>`).join('') || '<li>none</li>'}</ul>
      <h4>Recent runtime activity attributed to this task</h4><p class="note">Attribution uses the objective that was current when each hook event arrived.</p><ul>${hooks.map((e) => `<li><span class="mono small">${fmtTime(e.ts)}</span> ${esc(e.summary)}</li>`).join('') || '<li>none</li>'}</ul>`;
  }
  $('drawer-close').addEventListener('click', () => { $('drawer').classList.add('hidden'); selectedTask = null; });

  function renderStructural() { renderWork(); renderPipeline(); renderAgents(); renderGame(); if (selectedTask) openTask(selectedTask); }
  function renderAll() { renderHeader(); renderStructural(); renderFeed(); }
  connect();
})();
