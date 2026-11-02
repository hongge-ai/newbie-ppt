/* Resident status surface: hash routing, snapshot fetch, SSE change signal. */

const view = document.getElementById('view');
const connState = document.getElementById('conn-state');
const brand = document.getElementById('brand');
const navHome = document.getElementById('nav-home');

const esc = (value) => String(value === undefined || value === null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const STATE_LABEL = {
  idle: '未开始', running: '运行中', waiting_user: '等待确认',
  interrupted: '已中断', failed: '失败', done: '已完成',
};

function chip(state) {
  return `<span class="chip ${esc(state)}">${esc(STATE_LABEL[state] || state || '-')}</span>`;
}

function timeText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function api(path, options) {
  const resp = await fetch(path, options);
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(payload.error || `${resp.status}`);
  return payload;
}

/* ---------- project list ---------- */

async function renderHome() {
  view.innerHTML = '<div class="placeholder">Loading…</div>';
  const { projects } = await api('/api/projects');
  if (!projects.length) {
    view.innerHTML = '<div class="placeholder">还没有项目。先创建项目并调用 agent_bridge.py run start。</div>';
    return;
  }
  view.innerHTML = '<div class="task-grid">' + projects.map((item) => {
    const progress = item.progress && item.progress.total
      ? `${item.progress.done}/${item.progress.total} ${esc(item.progress.unit || '')}`
      : '';
    const waiting = item.open_requests && item.open_requests.length
      ? `<span class="chip waiting_user">待回答 ${item.open_requests.length}</span>`
      : '';
    return `<a class="task-card" href="#/p/${encodeURIComponent(item.slug)}">
      <div class="row">
        <span class="slug">${esc(item.slug)}</span>
        ${chip(item.state)}
        ${waiting}
        <span class="muted">${esc(item.route || '')}${item.profile ? ' · ' + esc(item.profile) : ''}</span>
      </div>
      <div class="meta">
        ${esc(item.stage_label || item.stage || '—')}
        ${progress ? ' · ' + progress : ''}
        · 更新 ${esc(timeText(item.updated_at))}
      </div>
    </a>`;
  }).join('') + '</div>';
}

/* ---------- one project ---------- */

async function renderProject(slug) {
  view.innerHTML = '<div class="placeholder">Loading…</div>';
  const [{ status, summary }, { requests }, { events }] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(slug)}`),
    api(`/api/projects/${encodeURIComponent(slug)}/requests`),
    api(`/api/projects/${encodeURIComponent(slug)}/events?limit=200`),
  ]);
  const open = requests.filter((item) => !item.response);
  const answered = requests.filter((item) => item.response);

  view.innerHTML = `
    <section class="panel">
      <h2>${esc(slug)} ${chip(status.state)}</h2>
      <div class="muted">${esc(status.route || '')} · ${esc(status.profile || '')}
        ${status.run && status.run.run_id ? ' · <span class="mono">' + esc(status.run.run_id) + '</span>' : ''}</div>
      ${status.state === 'interrupted'
        ? '<div class="notice warn" style="margin-top:12px">写入租约已过期：生成可能已中断。重新连接请调用 <code>agent_bridge.py run start --resume</code>。</div>'
        : ''}
      ${status.error ? `<div class="notice bad" style="margin-top:12px">
          ${esc(status.error.code)}: ${esc(status.error.message)}
          ${status.error.recover ? ' · 恢复见 ' + esc(status.error.recover) : ''}</div>` : ''}
      ${renderProgress(status.progress)}
      ${renderTimeline(status)}
    </section>

    <section class="panel">
      <h2>待确认 ${open.length ? `(${open.length})` : ''}</h2>
      ${open.length ? open.map((item) => renderRequestCard(slug, item.request)).join('')
        : '<div class="muted">没有等待用户回答的请求。</div>'}
    </section>

    ${answered.length ? `<section class="panel">
      <h3>已回答</h3>
      <ul class="timeline">${answered.slice().reverse().map((item) => `
        <li><span class="mark">✓</span>
          <span>${esc(item.request.title)} — ${esc(item.response.status)}
            <span class="muted">· ${esc(item.response.by)} · ${esc(timeText(item.response.at))}
            ${item.response.choice && item.response.choice.length ? ' · ' + esc(item.response.choice.join(', ')) : ''}</span>
          </span>
        </li>`).join('')}
      </ul>
    </section>` : ''}

    <section class="panel">
      <h2>事件</h2>
      <div class="events">${events.slice().reverse().map((event) => `
        <div><span class="t">${esc(timeText(event.at))}</span>
          <span class="type">${esc(event.type)}</span>
          <span class="muted">${esc(brief(event))}</span>
        </div>`).join('') || '<div class="muted">暂无事件</div>'}
      </div>
    </section>`;

  view.querySelectorAll('[data-answer]').forEach((button) => {
    button.onclick = () => submitAnswer(slug, button);
  });
}

function brief(event) {
  const data = event.data || {};
  switch (event.type) {
    case 'stage/enter': return `${data.stage} — ${data.label || ''}`;
    case 'progress': return `${data.done}/${data.total ?? '?'} ${data.unit || ''}`;
    case 'ask/open': return `${data.req_id} ${data.kind}: ${data.prompt || ''}`;
    case 'ask/answered': return `${data.req_id} → ${data.status}`;
    case 'say': return data.text || '';
    case 'error': return `${data.code}: ${data.message || ''}`;
    case 'takeover': return `from ${data.prev_run_id || '-'} (${data.reason || ''})`;
    default: return Object.keys(data).length ? JSON.stringify(data) : '';
  }
}

function renderProgress(progress) {
  if (!progress || !progress.total) return '';
  const pct = Math.max(0, Math.min(100, Math.round(progress.done / progress.total * 100)));
  return `<div style="margin:12px 0">
    <div class="muted">${progress.done}/${progress.total} ${esc(progress.unit || '')}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

function renderTimeline(status) {
  const order = STATUS_ORDER[status.route] || [];
  if (!order.length) return '';
  const current = typeof status.stage_index === 'number' ? status.stage_index : -1;
  return `<ul class="timeline">${order.map((stage, index) => {
    const cls = index < current ? 'done' : index === current ? 'current' : '';
    const mark = index < current ? '✓' : index === current ? '●' : '○';
    const label = index === current && status.stage_label ? status.stage_label : stage;
    return `<li class="${cls}"><span class="mark">${mark}</span><span>${esc(label)}</span></li>`;
  }).join('')}</ul>`;
}

/* Stage tables mirror agent_bridge.STAGE_TABLES; the server sends the route,
   and an unknown route simply renders no timeline. */
const STATUS_ORDER = {
  generate: ['init', 'source', 'template_prep', 'confirm_stage1', 'template_install',
    'spec', 'spec_review', 'lock', 'images', 'execute', 'finalize', 'export', 'done'],
  'create-template': ['init', 'intake', 'brief', 'confirm', 'child_run', 'assets',
    'review_pptx', 'register', 'done'],
  'edit-native': ['import', 'plan', 'confirm', 'edit', 'notes_motion', 'export', 'done'],
};

function renderRequestCard(slug, request) {
  const options = request.options || [];
  const multi = request.multi ? 'checkbox' : 'radio';
  return `<div class="panel" style="background:#fbfdff">
    <h3 style="margin-top:0">${esc(request.title)}</h3>
    <div class="muted mono">${esc(request.kind)} · ${esc(request.id)}</div>
    <div style="white-space:pre-wrap;margin:10px 0">${esc(request.body || '')}</div>
    ${options.length ? `<div class="choices">${options.map((option, index) => `
      <label class="choice">
        <input type="${multi}" name="choice-${esc(request.id)}" value="${esc(option.id)}" ${index === 0 ? 'checked' : ''}>
        <span><strong>${esc(option.label || option.id)}</strong>
          ${option.detail ? `<span class="detail"> — ${esc(option.detail)}</span>` : ''}</span>
      </label>`).join('')}</div>` : ''}
    ${request.allow_text ? `<label class="field" style="margin-top:10px">
      <span>补充说明（可选）</span>
      <textarea rows="2" data-text="${esc(request.id)}"></textarea>
    </label>` : ''}
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" data-answer="${esc(request.id)}" data-status="answered">提交</button>
      <button class="btn" data-answer="${esc(request.id)}" data-status="declined">暂不处理</button>
      ${request.url ? `<a class="btn" href="${esc(request.url)}" target="_blank" rel="noreferrer">原页面</a>` : ''}
    </div>
  </div>`;
}

async function submitAnswer(slug, button) {
  const reqId = button.getAttribute('data-answer');
  const status = button.getAttribute('data-status');
  const checked = Array.from(
    document.querySelectorAll(`input[name="choice-${CSS.escape(reqId)}"]:checked`)
  ).map((input) => input.value);
  const textBox = document.querySelector(`[data-text="${CSS.escape(reqId)}"]`);
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(slug)}/requests/${encodeURIComponent(reqId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, choice: checked, text: textBox ? textBox.value : null }),
    });
    await renderProject(slug);
  } catch (error) {
    button.disabled = false;
    alert('提交失败：' + error.message);
  }
}

/* ---------- routing ---------- */

function route() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const project = hash.match(/^\/p\/([^/]+)(?:\/req\/[^/]+)?$/);
  if (project) {
    return renderProject(decodeURIComponent(project[1]));
  }
  return renderHome();
}

brand.onclick = (event) => { event.preventDefault(); window.location.hash = '#/'; };
navHome.onclick = (event) => { event.preventDefault(); window.location.hash = '#/'; };

window.addEventListener('hashchange', () => { route().catch(showError); });

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { route().catch(() => {}); }, 300);
}

function connect() {
  const source = new EventSource('/api/events');
  source.addEventListener('open', () => {
    connState.textContent = 'live';
    connState.className = 'conn-state on';
  });
  source.addEventListener('change', scheduleRefresh);
  source.onerror = () => {
    connState.textContent = 'reconnecting…';
    connState.className = 'conn-state off';
  };
}

function showError(error) {
  view.innerHTML = `<div class="placeholder">加载失败：${esc(error.message)}</div>`;
}

route().catch(showError);
connect();
