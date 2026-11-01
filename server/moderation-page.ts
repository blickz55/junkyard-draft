/**
 * The queue page a moderator works from (production roadmap 0.11.2), served by the verifier at /moderation/ so it needs no build and
 * no other host. Compiled in, as the migrations are, so the verifier stays one file. It holds no data: the moderation token or a
 * trusted moderator's key is typed in and kept in memory, and everything else comes from /moderation/queue. Players' words are only
 * ever set as text, never as markup, and the page's policy allows nothing but its own two files and its own origin.
 */
export const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Moderation queue</title>
<link rel="stylesheet" href="/moderation/app.css">
</head>
<body>
<main>
<h1>Moderation queue</h1>
<form id="signin" data-testid="mod-signin">
  <label for="key">Moderation token, or your key if you are a trusted moderator</label>
  <input id="key" type="password" autocomplete="off" spellcheck="false" data-testid="mod-key" required>
  <button type="submit" data-testid="mod-enter">Open the queue</button>
  <p id="error" class="error" role="alert" data-testid="mod-error"></p>
</form>
<div id="app" hidden>
  <p id="summary" data-testid="mod-summary"></p>
  <p id="off" class="error" data-testid="mod-off" hidden>The classifier is off, so nothing can be written. Set ANTHROPIC_API_KEY to turn writing on.</p>
  <div class="row"><button type="button" id="refresh" data-testid="mod-refresh">Refresh</button><span id="status" role="status" data-testid="mod-status"></span></div>
  <h2>Waiting for a person</h2>
  <div id="queue" data-testid="mod-queue"></div>
  <h2>Reported messages</h2>
  <div id="messages" data-testid="mod-messages"></div>
  <h2>Appeals</h2>
  <div id="appeals" data-testid="mod-appeals"></div>
  <h2>Reported names</h2>
  <div id="names" data-testid="mod-names"></div>
  <h2>Latest decisions</h2>
  <div id="recent" data-testid="mod-recent"></div>
  <section id="owner" hidden>
    <h2>Thresholds</h2>
    <form id="settings" data-testid="mod-settings"></form>
    <p id="usage" class="dim" data-testid="mod-usage"></p>
    <h2>Trusted moderators</h2>
    <div id="trusted" data-testid="mod-trusted"></div>
    <form id="grant">
      <label for="grant-id">Player id of someone who signed in with email</label>
      <input id="grant-id" spellcheck="false" data-testid="mod-grant-id" required>
      <button type="submit" data-testid="mod-grant">Make moderator</button>
    </form>
  </section>
</div>
</main>
<script src="/moderation/app.js" defer></script>
</body>
</html>
`;

export const PAGE_CSS = `:root { color-scheme: dark; --bg: #16181d; --card: #20242c; --line: #343a46; --text: #e8e6e1; --dim: #a5a9b3; --amber: #f2b84b; --red: #ff8f7a; --green: #8fd694; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; color: var(--amber); }
label { display: block; margin-bottom: 0.25rem; color: var(--dim); font-size: 0.875rem; }
input, select, button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0.4rem 0.6rem; min-height: 2.5rem; }
input { width: 100%; }
button { background: #2c323d; cursor: pointer; }
button:hover, button:focus-visible { border-color: var(--amber); }
button.danger { color: var(--red); }
button.good { color: var(--green); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem; }
.meta, .dim { color: var(--dim); font-size: 0.875rem; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0; }
.appeal { border-left: 3px solid var(--amber); padding-left: 0.6rem; }
.row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; align-items: center; }
.row input { flex: 1 1 12rem; width: auto; }
.badge { display: inline-block; padding: 0 0.4rem; border-radius: 4px; background: #39404c; font-size: 0.8rem; }
.badge.hidden { background: #5a2c28; }
.badge.unread { background: #5a4a1e; }
.error { color: var(--red); }
#settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.75rem; align-items: end; }
#signin { max-width: 26rem; }
#signin button { margin-top: 0.5rem; }
#grant { margin-top: 0.75rem; max-width: 34rem; }
#grant button { margin-top: 0.5rem; }
`;

export const PAGE_JS = `'use strict';
var key = '';
var data = null;
var $ = function (id) { return document.getElementById(id); };

/** An element. Text is always text: players' words never become markup. */
function el(tag, props) {
  var node = document.createElement(tag);
  Object.keys(props || {}).forEach(function (k) {
    if (k === 'tid') node.setAttribute('data-testid', props[k]);
    else if (k === 'onClick') node.addEventListener('click', props[k]);
    else node[k] = props[k];
  });
  for (var i = 2; i < arguments.length; i++) {
    var kid = arguments[i];
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid);
  }
  return node;
}
function ago(ms) {
  var hours = (Date.now() - ms) / 3600000;
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' min ago';
  if (hours < 48) return Math.round(hours) + ' h ago';
  return Math.round(hours / 24) + ' days ago';
}
function call(method, path, body) {
  return fetch('/moderation/' + path, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'X-Moderation-Token': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(function (res) {
    return res.json().then(function (json) {
      if (!res.ok || !json.ok) throw new Error(json.error || 'status ' + res.status);
      return json;
    });
  });
}
function say(text) {
  $('status').textContent = text;
}
function act(path, body, done) {
  say('Working…');
  call('POST', path, body).then(load).then(function () {
    say(done);
  }).catch(function (e) {
    say('Not done: ' + e.message);
  });
}

function reasonSelect(id, chosen) {
  var select = el('select', { title: 'The reason the player sees', tid: 'mod-reason-' + id });
  data.reasons.forEach(function (r) {
    select.append(el('option', { value: r, selected: r === chosen }, r));
  });
  return select;
}
function queueCard(item) {
  var chosen = data.reasons.indexOf(item.reasonCode) >= 0 ? item.reasonCode : data.reasons.indexOf(item.triageCategory) >= 0 ? item.triageCategory : 'other';
  var reason = reasonSelect(item.id, chosen);
  var note = el('input', { placeholder: 'Note for the log (the player does not see it)', tid: 'mod-note-' + item.id });
  var post = function (action, done) {
    return function () {
      act('post', { id: item.id, action: action, code: reason.value, note: note.value }, done);
    };
  };
  var player = function (action, done) {
    return function () {
      act('player', { id: item.authorId, action: action, code: reason.value, note: note.value }, done);
    };
  };
  var rec = item.record;
  var unread = item.triageCategory === 'unread';
  var why = unread ? 'the classifier did not read this' : item.triageCategory ? 'classifier: ' + item.triageCategory + ' ' + item.triageScore : 'no classifier answer';
  var reports = item.reports.map(function (r) { return r.reason + ' × ' + r.n; }).join(', ');
  return el(
    'div',
    { className: 'card', tid: 'mod-item-' + item.id },
    el(
      'div',
      { className: 'meta' },
      el('span', { className: 'badge ' + (item.state === 'hidden' ? 'hidden' : unread ? 'unread' : '') }, item.state === 'hidden' ? 'down' : 'up'),
      ' ' + item.author + ' · ' + item.threadKind + ' ' + item.threadKey + ' · ' + ago(item.createdAt),
    ),
    el('div', { className: 'body', tid: 'mod-body-' + item.id }, item.body),
    el(
      'div',
      { className: 'meta' },
      why + (reports ? ' · reports: ' + reports : '') + (rec ? ' · ' + rec.posts + ' posts, ' + rec.hidden + ' down, ' + rec.removed + ' removed' : ''),
    ),
    el('div', { className: 'row' }, reason, note),
    el(
      'div',
      { className: 'row' },
      el('button', { type: 'button', className: 'good', tid: 'mod-clear-' + item.id, onClick: post('clear', 'Cleared.') }, 'Fine, clear it'),
      el('button', { type: 'button', tid: 'mod-hide-' + item.id, onClick: post('hide', 'Hidden.') }, 'Hide'),
      el('button', { type: 'button', className: 'danger', tid: 'mod-delete-' + item.id, onClick: post('delete', 'Removed.') }, 'Remove'),
      item.authorId && el('button', { type: 'button', tid: 'mod-mute24-' + item.id, onClick: player('mute-24h', 'Muted for 24 hours.') }, 'Mute 24 h'),
      item.authorId && el('button', { type: 'button', tid: 'mod-mute7-' + item.id, onClick: player('mute-7d', 'Muted for 7 days.') }, 'Mute 7 days'),
      item.authorId && data.who === 'owner' && el('button', { type: 'button', className: 'danger', tid: 'mod-ban-' + item.id, onClick: player('ban', 'Banned.') }, 'Ban'),
      el('button', { type: 'button', tid: 'mod-lock-' + item.id, onClick: function () { act('thread', { id: item.threadId, locked: !item.threadLocked }, item.threadLocked ? 'Thread open.' : 'Thread closed.'); } }, item.threadLocked ? 'Open the thread' : 'Close the thread'),
      el('button', { type: 'button', tid: 'mod-pin-' + item.id, onClick: function () { act('thread', { id: item.threadId, pinned: !item.threadPinned }, item.threadPinned ? 'Unpinned.' : 'Pinned.'); } }, item.threadPinned ? 'Unpin the thread' : 'Pin the thread'),
    ),
  );
}
function messageCard(m) {
  var reason = reasonSelect('m' + m.id, data.reasons.indexOf(m.triageCategory) >= 0 ? m.triageCategory : 'other');
  var note = el('input', { placeholder: 'Note for the log (the player does not see it)', tid: 'mod-note-m' + m.id });
  var post = function (action, done) {
    return function () {
      act('message', { id: m.id, action: action, code: reason.value, note: note.value }, done);
    };
  };
  var player = function (action, done) {
    return function () {
      act('player', { id: m.senderId, action: action, code: reason.value, note: note.value }, done);
    };
  };
  var reports = m.reports.map(function (r) { return r.reason + ' × ' + r.n; }).join(', ');
  var why = m.triageCategory === 'unread' || !m.triageCategory ? 'the classifier did not read this' : 'classifier: ' + m.triageCategory + ' ' + m.triageScore;
  return el(
    'div',
    { className: 'card', tid: 'mod-message-' + m.id },
    el('div', { className: 'meta' }, m.from + ' to ' + m.to + ' · ' + ago(m.createdAt) + ' · reports: ' + reports + ' · ' + why),
    ...m.context.map(function (c) {
      var who = c.senderId === m.senderId ? m.from : m.to;
      return el('div', { className: 'body' + (c.id === m.id ? ' appeal' : ' dim'), tid: 'mod-context-' + c.id }, who + ': ' + c.body);
    }),
    el('div', { className: 'row' }, reason, note),
    el(
      'div',
      { className: 'row' },
      el('button', { type: 'button', className: 'good', tid: 'mod-clear-m' + m.id, onClick: post('clear', 'Cleared.') }, 'Fine, clear it'),
      el('button', { type: 'button', className: 'danger', tid: 'mod-delete-m' + m.id, onClick: post('delete', 'Removed.') }, 'Remove'),
      el('button', { type: 'button', tid: 'mod-mute24-m' + m.id, onClick: player('mute-24h', 'Muted for 24 hours.') }, 'Mute 24 h'),
      el('button', { type: 'button', tid: 'mod-mute7-m' + m.id, onClick: player('mute-7d', 'Muted for 7 days.') }, 'Mute 7 days'),
      data.who === 'owner' && el('button', { type: 'button', className: 'danger', tid: 'mod-ban-m' + m.id, onClick: player('ban', 'Banned.') }, 'Ban'),
    ),
  );
}
function appealCard(a) {
  var note = el('input', { placeholder: 'Note for the log', tid: 'mod-appeal-note-' + a.id });
  var answer = function (result, done) {
    return function () {
      act('appeal', { id: a.id, result: result, note: note.value }, done);
    };
  };
  return el(
    'div',
    { className: 'card', tid: 'mod-appeal-' + a.id },
    el('div', { className: 'meta' }, a.player + ' · ' + a.action + (a.reasonCode ? ' (' + a.reasonCode + ')' : '') + ' · appealed ' + ago(a.appealedAt)),
    a.body && el('div', { className: 'body' }, a.body),
    el('div', { className: 'body appeal', tid: 'mod-appeal-body-' + a.id }, a.appealBody),
    el('div', { className: 'row' }, note),
    el(
      'div',
      { className: 'row' },
      el('button', { type: 'button', tid: 'mod-appeal-keep-' + a.id, onClick: answer('upheld', 'The decision stands.') }, 'Keep the decision'),
      el('button', { type: 'button', className: 'good', tid: 'mod-appeal-undo-' + a.id, onClick: answer('overturned', 'The decision is undone.') }, 'Undo the decision'),
    ),
  );
}
function nameCard(n) {
  var send = function (path, done) {
    return function () {
      act(path, { playerId: n.playerId }, done);
    };
  };
  return el(
    'div',
    { className: 'card', tid: 'mod-name-' + n.playerId },
    el('div', { className: 'body' }, n.name + '#' + n.tag),
    el('div', { className: 'meta' }, (n.hidden ? 'hidden · ' : 'shown · ') + n.reports.length + ' report(s) · cleared ' + n.clears + ' time(s)'),
    el(
      'div',
      { className: 'row' },
      el('button', { type: 'button', className: 'good', tid: 'mod-name-clear-' + n.playerId, onClick: send('clear', 'Name cleared.') }, 'Fine, clear it'),
      el('button', { type: 'button', tid: 'mod-name-confirm-' + n.playerId, onClick: send('confirm', 'The name stays hidden.') }, 'Keep it hidden'),
    ),
  );
}
function recentRow(a) {
  var undo = null;
  if (a.undo === 'unhide')
    undo = el('button', { type: 'button', tid: 'mod-undo-' + a.id, onClick: function () { act('post', { id: Number(a.targetRef), action: 'unhide' }, 'Back up.'); } }, 'Put it back');
  if (a.undo === 'unmute')
    undo = el('button', { type: 'button', tid: 'mod-undo-' + a.id, onClick: function () { act('player', { id: a.playerId, action: 'unmute' }, 'Unmuted.'); } }, 'Unmute');
  if (a.undo === 'unban' && data.who === 'owner')
    undo = el('button', { type: 'button', tid: 'mod-undo-' + a.id, onClick: function () { act('player', { id: a.playerId, action: 'unban' }, 'Unbanned.'); } }, 'Unban');
  return el(
    'div',
    { className: 'row meta', tid: 'mod-recent-' + a.id },
    el('span', {}, ago(a.createdAt) + ' · ' + a.by + ' · ' + a.action + (a.reasonCode ? ' (' + a.reasonCode + ')' : '') + ' · ' + a.player + (a.note ? ' · ' + a.note : '')),
    undo,
  );
}
function field(name, label, value) {
  return el('label', {}, label, el('input', { type: 'number', name: name, value: String(value), min: '0', tid: 'mod-set-' + name }));
}
function render() {
  var s = data.stats;
  $('summary').textContent =
    (s.waiting + data.messages.length + data.appeals.length) + ' waiting' + (s.oldest ? ', the oldest ' + ago(s.oldest) : '') + '. Target: every item within ' + s.slaHours + ' hours' +
    (s.medianReviewHours === null ? '.' : ', lately ' + s.medianReviewHours + ' hours.') +
    (s.away ? ' The queue has been left alone, so the bar for hiding is lower until someone reviews it.' : '');
  $('off').hidden = data.enabled;
  $('queue').replaceChildren(...(data.queue.length ? data.queue.map(queueCard) : [el('p', { className: 'dim' }, 'Nothing waiting.')]));
  $('messages').replaceChildren(...(data.messages.length ? data.messages.map(messageCard) : [el('p', { className: 'dim' }, 'No reported messages.')]));
  $('appeals').replaceChildren(...(data.appeals.length ? data.appeals.map(appealCard) : [el('p', { className: 'dim' }, 'No open appeals.')]));
  $('names').replaceChildren(...(data.names.length ? data.names.map(nameCard) : [el('p', { className: 'dim' }, 'No reported names.')]));
  $('recent').replaceChildren(...(data.recent.length ? data.recent.map(recentRow) : [el('p', { className: 'dim' }, 'Nothing decided yet.')]));
  var owner = data.who === 'owner';
  $('owner').hidden = !owner;
  if (!owner) return;
  var t = data.settings;
  $('settings').replaceChildren(
    field('queueAt', 'Queue from score', t.queueAt),
    field('hideAt', 'Hide from score', t.hideAt),
    field('awayHideAt', 'Hide from score when away', t.awayHideAt),
    field('awayAfterHours', 'Away after hours', t.awayAfterHours),
    field('dailyCalls', 'Classifier calls a day', t.dailyCalls),
    el('button', { type: 'submit', tid: 'mod-save' }, 'Save'),
  );
  var u = data.usage;
  $('usage').textContent = 'Since ' + u.since + ': ' + u.calls + ' classifier calls, ' + u.failures + ' failed, ' + u.inputTokens + ' tokens in, ' + u.outputTokens + ' out.';
  $('trusted').replaceChildren(
    ...(data.trusted.length
      ? data.trusted.map(function (m) {
          return el(
            'div',
            { className: 'row' },
            el('span', {}, m.label),
            el('button', { type: 'button', tid: 'mod-untrust-' + m.id, onClick: function () { act('trust', { playerId: m.id, trusted: false }, 'Role taken back.'); } }, 'Take back'),
          );
        })
      : [el('p', { className: 'dim' }, 'Nobody yet.')]),
  );
}
function load() {
  return call('GET', 'queue').then(function (json) {
    data = json;
    $('signin').hidden = true;
    $('app').hidden = false;
    render();
  });
}
$('signin').addEventListener('submit', function (e) {
  e.preventDefault();
  key = $('key').value.trim();
  $('error').textContent = '';
  load().catch(function (err) {
    key = '';
    $('error').textContent = err.message;
  });
});
$('refresh').addEventListener('click', function () {
  say('Working…');
  load().then(function () {
    say('Up to date.');
  }).catch(function (err) {
    say('Not done: ' + err.message);
  });
});
$('settings').addEventListener('submit', function (e) {
  e.preventDefault();
  var values = {};
  new FormData(e.target).forEach(function (v, k) {
    values[k] = Number(v);
  });
  act('settings', values, 'Saved.');
});
$('grant').addEventListener('submit', function (e) {
  e.preventDefault();
  act('trust', { playerId: $('grant-id').value.trim(), trusted: true }, 'Role granted.');
});
`;
