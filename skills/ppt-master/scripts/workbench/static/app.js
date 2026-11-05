/* Workbench single-page app: action-first task page, tools open in focus mode. */
(function () {
  'use strict';

  // The shell is never shown inside a frame: a surface that navigates here must
  // drive the top window instead of nesting the workbench inside itself.
  if (window.top !== window.self) {
    document.body.textContent = '此页面不支持嵌套显示，请在工作台窗口中打开。';
    return;
  }

  var STATUS_LABELS = {
    draft: '草稿', submitted: '待处理', processing: '生成中',
    interrupted: '已中断', done: '已完成', failed: '失败', error: '损坏'
  };

  var STEPS = [
    ['init', '初始化'], ['source', '素材'], ['template_prep', '模板'],
    ['confirm_stage1', '确认'], ['spec', '规格'], ['lock', '锁定'],
    ['execute', '页面'], ['finalize', '收尾'], ['export', '导出'], ['done', '完成']
  ];

  var STAGE_LABELS = STEPS.reduce(function (map, item) {
    map[item[0]] = item[1];
    return map;
  }, {});

  var TOOLS = [
    ['preview', '页面预览'], ['confirm', '阶段确认'], ['spec', '规格评审']
  ];

  var EVENT_LABELS = {
    'run/start': function (data) { return data.resume ? '恢复运行' : '开始运行'; },
    'run/end': function (data) {
      var outcomes = { done: '成功', failed: '失败', aborted: '中止' };
      return '运行结束（' + (outcomes[data.outcome] || data.outcome || '成功') + '）';
    },
    'stage/enter': function (data) {
      return '进入阶段：' + (STAGE_LABELS[data.stage] || data.stage || '');
    },
    'progress': function (data) {
      return '进度 ' + data.done + (data.total ? '/' + data.total : '');
    },
    'ask/open': function (data) { return '等待回答：' + (data.prompt || ''); },
    'ask/answered': function (data) {
      return '已回答：' + ((data.choice || []).join('、') || data.status || '');
    },
    'takeover': function () { return '接管运行'; },
    'error': function (data) { return '错误：' + (data.message || ''); },
    'say': function (data) { return data.text || ''; }
  };

  var workspace = document.getElementById('workspace');
  var optionsCache = null;
  var pollTimer = null;
  var lastSignature = '';
  // Which task's proposal card is mounted, so polling never rebuilds it and
  // wipes text the user is editing.
  var proposalTaskId = null;

  // ---------- helpers ----------

  function $(selector) { return document.querySelector(selector); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function enc(value) { return encodeURIComponent(value); }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function setConn(bad) {
    var node = $('#conn');
    if (node) node.hidden = !bad;
  }

  function toast(message, isError) {
    var node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.className = 'toast' + (isError ? ' is-error' : '');
    node.hidden = false;
    window.setTimeout(function () { node.hidden = true; }, isError ? 6000 : 2600);
  }

  function api(method, path, body) {
    var options = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) options.body = JSON.stringify(body);
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
        if (!response.ok) {
          var failure = new Error((data && data.error) || ('HTTP ' + response.status));
          failure.body = data;
          throw failure;
        }
        return data;
      });
    });
  }

  function poll(seconds, fn) {
    stopPoll();
    pollTimer = window.setInterval(fn, seconds * 1000);
  }

  function stopPoll() {
    if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
  }

  function statusBadge(status) {
    return '<span class="status status-' + esc(status) + '">' +
      esc(STATUS_LABELS[status] || status) + '</span>';
  }

  // ---------- options ----------

  function loadOptions() {
    if (optionsCache) return Promise.resolve(optionsCache);
    return api('GET', '/api/options').then(function (data) {
      optionsCache = data;
      return data;
    }).catch(function () { return null; });
  }

  function options(list, value) {
    return (list || []).map(function (item) {
      var id = item.value != null ? item.value : item.id;
      var selected = String(id) === String(value) ? ' selected' : '';
      return '<option value="' + esc(id) + '"' + selected + '>' + esc(item.label || id) + '</option>';
    }).join('');
  }

  function optionLabel(list, value) {
    var found = (list || []).filter(function (item) {
      var id = item.value != null ? item.value : item.id;
      return String(id) === String(value);
    })[0];
    return found ? (found.label || value) : (value == null ? '—' : String(value));
  }

  // ---------- rail ----------

  function railItem(task, activeId) {
    var title = task.display_title || task.topic || task.task_id;
    var runtime = task.runtime || {};
    var meta = '';
    if (runtime.blocking) meta = '待你回答';
    else if (task.status === 'draft') meta = '待配置';
    return '<a class="rail-item' + (task.task_id === activeId ? ' is-active' : '') +
      '" href="#/task/' + enc(task.task_id) + '">' +
      '<span class="rail-title"><i class="dot dot-' + esc(task.status) + '"></i>' +
      esc(title) + '</span>' +
      (meta ? '<span class="rail-meta">' + esc(meta) + '</span>' : '') +
      '</a>';
  }

  function refreshRail(activeId) {
    return api('GET', '/api/tasks').then(function (data) {
      setConn(false);
      var list = $('#rail-list');
      if (!list) return;
      var count = $('#rail-count');
      if (count) count.textContent = data.tasks.length ? String(data.tasks.length) : '';
      list.innerHTML = data.tasks.length
        ? data.tasks.map(function (task) { return railItem(task, activeId || ''); }).join('')
        : '<div class="rail-empty">还没有任务</div>';
    }).catch(function () {
      setConn(true);
      var list = $('#rail-list');
      if (list) list.innerHTML = '<div class="rail-empty">任务列表加载失败</div>';
    });
  }

  // ---------- task form: #/new and a draft share one renderer ----------

  var newTaskId = null;

  function draftModel() {
    return {
      task_id: null,
      topic: '',
      display_title: null,
      params: {
        canvas: 'ppt169',
        page_count: null,
        primary_language: 'zh-CN',
        speaker_notes: false,
        image_policy: 'auto'
      },
      requirements: { feel: '' },
      uploads_present: []
    };
  }

  function canvasPickerHtml(value) {
    return '<div class="canvas-picker">' +
      [['ppt169', '16:9', '1280 × 720'], ['ppt43', '4:3', '1024 × 768']]
        .map(function (item) {
          return '<button type="button" class="canvas-option' +
            (item[0] === value ? ' is-picked' : '') + '" data-canvas="' + item[0] + '">' +
            '<strong>' + item[1] + '</strong><small>' + item[2] + '</small></button>';
        }).join('') + '</div>';
  }

  function formHtml(model) {
    var p = model.params || {};
    var r = model.requirements || {};
    var opts = optionsCache || {};
    var editing = !!model.task_id;
    return '<div class="card"><h2>任务</h2>' +
      '<label class="field"><span>主题 / 需求描述</span>' +
      '<textarea id="f-topic" rows="3" placeholder="例如：根据这份季度报告做一份 10 页的汇报 PPT">' +
      esc(model.topic || '') + '</textarea></label>' +
      '<label class="field"><span>想要的感觉（可选）</span>' +
      '<input id="f-feel" type="text" value="' + esc(r.feel) +
      '" placeholder="例如：克制专业，像咨询报告；或轻快一点给学生看"></label>' +
      '<div class="field"><span>画幅</span>' + canvasPickerHtml(p.canvas || 'ppt169') + '</div>' +
      '<div class="field-row">' +
      '<label class="field"><span>页数</span><input id="f-pages" type="number" min="1" max="60" ' +
      'value="' + esc(p.page_count == null ? '' : p.page_count) + '" placeholder="留空由 AI 决定"></label>' +
      '<label class="field"><span>语言</span><select id="f-lang">' +
      options(opts.languages, p.primary_language) + '</select></label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label class="field"><span>配图策略</span><select id="f-image">' +
      options(opts.image_policies, p.image_policy) + '</select></label>' +
      '<label class="field-check"><input id="f-notes" type="checkbox"' +
      (p.speaker_notes ? ' checked' : '') + '> 生成讲者备注</label>' +
      '</div>' +
      '<p class="card-hint">受众、核心信息、使用场景这些，AI 读完材料后会在下一步给建议，你改完确认一次就开跑。</p>' +
      '<div class="actions">' +
      (editing ? '<button class="btn" id="save-btn" type="button">保存修改</button>' : '') +
      '<button class="btn btn-primary" id="submit-btn" type="button">' +
      (editing ? '提交生成' : '创建并提交') + '</button></div>' +
      '</div>' +
      '<div class="card"><h2>参考材料</h2>' +
      '<p class="card-hint">可选。提交时会一起交给 AI。</p>' +
      '<ul class="list" id="upload-list">' + uploadRows(model.uploads_present || []) + '</ul>' +
      '<label class="btn" for="f-files">上传文件</label>' +
      '<input id="f-files" type="file" multiple hidden></div>';
  }

  function selectedCanvas() {
    var picked = document.querySelector('.canvas-option.is-picked');
    return picked ? picked.getAttribute('data-canvas') : 'ppt169';
  }

  function formValues() {
    var pages = $('#f-pages').value.trim();
    return {
      topic: $('#f-topic').value.trim(),
      params: {
        canvas: selectedCanvas(),
        page_count: pages ? parseInt(pages, 10) : null,
        primary_language: $('#f-lang').value,
        speaker_notes: $('#f-notes').checked,
        image_policy: $('#f-image').value
      },
      requirements: {
        feel: $('#f-feel').value.trim()
      }
    };
  }

  function wireCanvas() {
    Array.prototype.forEach.call(document.querySelectorAll('.canvas-option'), function (button) {
      button.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.canvas-option'), function (other) {
          other.classList.remove('is-picked');
        });
        button.classList.add('is-picked');
      });
    });
  }

  function createTaskFromForm() {
    var values = formValues();
    if (!values.topic) { toast('请先填写主题', true); return Promise.reject(new Error('topic required')); }
    return api('POST', '/api/tasks', {
      topic: values.topic,
      params: values.params,
      requirements: values.requirements
    }).then(function (data) {
      newTaskId = data.task_id;
      return data.task_id;
    });
  }

  function wireUploads(model) {
    function currentTaskId() { return (model && model.task_id) || newTaskId; }

    function refreshUploads(taskId) {
      return api('GET', '/api/tasks/' + enc(taskId)).then(function (task) {
        var list = $('#upload-list');
        if (list) list.innerHTML = uploadRows(task.uploads_present || []);
        wireDeletes(taskId);
      });
    }

    function wireDeletes(taskId) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-del-upload]'), function (button) {
        button.addEventListener('click', function () {
          api('DELETE', '/api/tasks/' + enc(taskId) + '/uploads/' +
            enc(button.getAttribute('data-del-upload')))
            .then(function () { return refreshUploads(taskId); })
            .catch(function (error) { toast('删除失败：' + error.message, true); });
        });
      });
    }

    $('#f-files').addEventListener('change', function (event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      if (!files.length) return;
      var ready = currentTaskId() ? Promise.resolve(currentTaskId()) : createTaskFromForm();
      ready.then(function (taskId) {
        var form = new FormData();
        files.forEach(function (file) { form.append('files', file); });
        return fetch('/api/tasks/' + enc(taskId) + '/uploads', { method: 'POST', body: form })
          .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            toast('已上传 ' + files.length + ' 个文件');
            return refreshUploads(taskId);
          });
      }).catch(function (error) {
        if (error && error.message !== 'topic required') toast('上传失败：' + error.message, true);
      });
    });

    var taskId = currentTaskId();
    if (taskId) wireDeletes(taskId);
  }

  function wireSubmit(model) {
    var editing = !!(model && model.task_id);
    var submit = $('#submit-btn');
    var save = $('#save-btn');

    function persist(create) {
      var values = formValues();
      if (!values.topic) { toast('请填写主题', true); return; }
      var ready = editing || newTaskId
        ? Promise.resolve((model && model.task_id) || newTaskId)
        : createTaskFromForm();
      ready.then(function (taskId) {
        return api('PATCH', '/api/tasks/' + enc(taskId), {
          params: values.params,
          requirements: values.requirements
        }).then(function () {
          if (!create) { toast('已保存'); loadTask(taskId); return null; }
          return api('POST', '/api/tasks/' + enc(taskId) + '/submit').then(function () {
            toast('已提交，交给 AI 处理');
            newTaskId = null;
            location.hash = '#/task/' + enc(taskId);
          });
        });
      }).catch(function (error) {
        if (error && error.message !== 'topic required') toast('保存失败：' + error.message, true);
      });
    }

    submit.addEventListener('click', function () { persist(true); });
    if (save) save.addEventListener('click', function () { persist(false); });
  }

  function renderNewTask() {
    newTaskId = null;
    refreshRail('');
    workspace.innerHTML =
      '<div class="page-head"><div><h1>新建任务</h1>' +
      '<div class="page-sub">把想做的说清楚就行：主题、材料、画幅页数语言。受众和方案由 AI 读完材料后给建议，你改完确认一次。</div>' +
      '</div></div><div id="pane"><div class="loading">加载中…</div></div>';
    loadOptions().then(function () {
      var pane = $('#pane');
      if (!pane) return;
      pane.innerHTML = formHtml(draftModel());
      wireCanvas();
      wireUploads(null);
      wireSubmit(null);
    });
    poll(5, function () { refreshRail(''); });
  }

  // ---------- task page ----------

  function loadTask(taskId, focus) {
    lastSignature = '';
    proposalTaskId = null;
    Promise.all([
      api('GET', '/api/tasks/' + enc(taskId)),
      loadOptions()
    ]).then(function (results) {
      var task = results[0];
      refreshRail(taskId);
      if (focus) renderFocus(task, focus);
      else renderTaskHome(task);
    }).catch(function (error) {
      setConn(true);
      workspace.innerHTML = '<div class="card"><h2>加载失败</h2><p class="hint">' +
        esc(error.message) + '</p><a class="btn" href="#/new">新建任务</a></div>';
    });
  }

  function headerHtml(task) {
    var title = task.display_title || task.topic || task.task_id;
    var runtime = task.runtime || {};
    var sub = [task.task_id];
    if (runtime.project_dir) sub.push(runtime.project_dir);
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' +
      '<div class="page-sub">' + esc(sub.join(' · ')) + '</div></div>' +
      statusBadge(task.status) + '</div>';
  }

  function renderTaskHome(task) {
    var runtime = task.runtime || {};
    if (task.status === 'draft') {
      workspace.innerHTML = headerHtml(task) + '<div id="pane"></div>';
      renderForm($('#pane'), task);
      return;
    }
    workspace.innerHTML = headerHtml(task) +
      '<div id="proposal-slot"></div>' +
      '<div id="pane"><div class="loading">加载中…</div></div>';

    if (task.status === 'submitted') {
      renderTakeover(task);
      poll(5, function () { loadTask(task.task_id); });
      return;
    }

    renderOverview(task);
    poll(2, function () { renderOverview(task, true); });
  }


  // A submitted task waits for an agent to claim it. Agents register and
  // heartbeat on their own; the page never guesses who is available, and the
  // human always presses dispatch — even when exactly one agent is online.
  function renderTakeover(task) {
    var pane = $('#pane');
    pane.innerHTML = '<div class="card card-takeover" id="takeover-card">' +
      '<div class="loading">正在读取在线的 AI…</div></div>';
    refreshTakeover(task);
    poll(4, function () { refreshTakeover(task); });
  }

  function refreshTakeover(task) {
    Promise.all([
      api('GET', '/api/tasks/' + enc(task.task_id)),
      api('GET', '/api/agents')
    ]).then(function (results) {
      var card = $('#takeover-card');
      if (!card) return;
      var detail = results[0] || {};
      var agents = (results[1] && results[1].agents) || [];
      card.innerHTML = takeoverHtml(detail, agents);
      wireTakeover(task);
    }).catch(function (error) {
      var card = $('#takeover-card');
      if (card) card.innerHTML = '<div class="empty">读取失败：' + esc(error.message) + '</div>';
    });
  }

  function onlineAgents(agents) {
    return (agents || []).filter(function (agent) { return agent.online; });
  }

  function takeoverHtml(detail, agents) {
    var assignment = detail.assignment;
    var online = onlineAgents(agents);
    var head = '<h2>等待 AI 接管</h2>';

    if (assignment) {
      return head +
        '<div class="assigned">已分派给 <b>' + esc(assignment.name || assignment.agent_id) +
        '</b>，等待它接手…</div>' +
        '<p class="card-hint">接手后页面会自动切到进度视图。分派只在几分钟内有效，过期可重新分派。</p>' +
        '<div class="actions"><button class="btn" id="cancel-dispatch" type="button">撤销分派</button></div>';
    }

    if (!online.length) {
      return head +
        '<p class="card-hint">现在没有 AI 连接。在你正在使用的 AI 工具里运行下面这条命令，它会连到工作台并等待你分派：</p>' +
        '<pre class="hint-text">uv run python skills/ppt-master/scripts/workbench_agent.py attach --name "我的 AI"</pre>' +
        '<p class="card-hint">连上之后，这个页面会出现它的名字；由你点「分派」，任务才会交出去。</p>' +
        '<div class="actions"><button class="btn" id="refresh-agents" type="button">重新检测</button></div>';
    }

    var rows = online.map(function (agent, index) {
      return '<label class="agent-row">' +
        '<input type="radio" name="agent" value="' + esc(agent.agent_id) + '"' +
        (index === 0 ? ' checked' : '') + '>' +
        '<span class="agent-name">' + esc(agent.name) + '</span>' +
        '<span class="agent-meta">' + esc(agent.host || '') + ' · 在线</span>' +
        '</label>';
    }).join('');

    return head +
      '<p class="card-hint">' + online.length + ' 个 AI 已连接。选一个并点「分派」，任务才会交给它。' +
      (online.length > 1 ? '一次只能分派给一个。' : '') + '</p>' +
      '<div class="agent-list">' + rows + '</div>' +
      '<div class="actions"><button class="btn btn-primary" id="dispatch-agent" type="button">分派</button>' +
      '<button class="btn" id="refresh-agents" type="button">刷新</button></div>';
  }

  function wireTakeover(task) {
    var dispatch = $('#dispatch-agent');
    if (dispatch) {
      dispatch.addEventListener('click', function () {
        var picked = document.querySelector('input[name="agent"]:checked');
        if (!picked) { toast('请选择一个 AI', true); return; }
        dispatch.disabled = true;
        api('POST', '/api/tasks/' + enc(task.task_id) + '/assign', {
          agent_id: picked.value
        }).then(function (data) {
          toast('已分派给 ' + ((data.assignment || {}).name || 'AI'));
          refreshTakeover(task);
        }).catch(function (error) {
          dispatch.disabled = false;
          toast('分派失败：' + error.message, true);
        });
      });
    }
    var cancel = $('#cancel-dispatch');
    if (cancel) {
      cancel.addEventListener('click', function () {
        api('DELETE', '/api/tasks/' + enc(task.task_id) + '/assign')
          .then(function () { refreshTakeover(task); })
          .catch(function (error) { toast('撤销失败：' + error.message, true); });
      });
    }
    var refresh = $('#refresh-agents');
    if (refresh) {
      refresh.addEventListener('click', function () { refreshTakeover(task); });
    }
  }

  // ---------- proposal: the one confirmation, inline ----------

  var KIND_LABELS = { brand: '品牌', style: '风格', layout: '版式', deck: '整套' };

  function proposalFieldHtml(field, label, value, placeholder, rows) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<textarea data-contract="' + esc(field) + '" rows="' + (rows || 2) +
      '" placeholder="' + esc(placeholder || '') + '">' + esc(value) + '</textarea></label>';
  }

  function stylePreviewHtml(proposal) {
    var preview = proposal.preview || {};
    var styles = (optionsCache || {}).visual_styles || [];
    var chosen = styles.filter(function (item) { return item.id === preview.visual_style; })[0];
    var html = '<div class="style-block"><div class="subhead">风格预览</div>';
    if (chosen) {
      html += '<div class="style-hero">' +
        '<img src="' + esc(chosen.preview_url) + '" alt="' + esc(chosen.label) + '">' +
        '<div><strong>' + esc(chosen.label) + '</strong>' +
        '<p class="card-hint">' + esc(preview.note || chosen.description) + '</p></div></div>';
    } else if (preview.note) {
      html += '<p class="preview-note">' + esc(preview.note) + '</p>';
    } else {
      html += '<p class="card-hint">AI 还没有写视觉方向，会在生成时按材料和你填的感觉来定。</p>';
    }
    if (styles.length) {
      html += '<details class="style-gallery"><summary>看看还有哪些视觉方向（仅参考）</summary>' +
        '<div class="style-strip">' + styles.map(function (item) {
          return '<figure class="style-thumb' + (item.id === preview.visual_style ? ' is-chosen' : '') +
            '" title="' + esc(item.label) + '"><img src="' + esc(item.preview_url) +
            '" alt="' + esc(item.label) + '"><figcaption>' + esc(item.label) + '</figcaption></figure>';
        }).join('') + '</div></details>';
    }
    return html + '</div>';
  }

  function candidateCardHtml(item, picked) {
    // Identity-only workspaces (brand / style) have no prototype pages; the
    // card is just its name and summary.
    var thumbs = item.id
      ? '<span class="tpl-thumbs" data-thumbs><span class="tpl-thumb is-loading"></span></span>'
      : '';
    return '<button type="button" class="tpl-card' + (picked ? ' is-picked' : '') +
      '" data-key="' + esc(item.key) + '" data-kind="' + esc(item.kind) + '"' +
      (item.id ? ' data-id="' + esc(item.id) + '"' : '') + '>' + thumbs +
      '<span class="tpl-name">' + esc(item.label) + '</span>' +
      (item.summary ? '<span class="tpl-desc">' + esc(item.summary) + '</span>' : '') +
      '</button>';
  }

  function templateBlockHtml(options) {
    var library = (options && options.library) || {};
    var explicit = (options && options.explicit) || [];
    var preselected = (options && options.preselected_keys) || [];
    var groups = ['brand', 'style', 'layout', 'deck'].map(function (kind) {
      var items = (library[kind] || []).concat(explicit.filter(function (item) {
        return item.kind === kind;
      }));
      if (!items.length) return '';
      return '<div class="tpl-group"><div class="tpl-group-name">' + esc(KIND_LABELS[kind] || kind) + '</div>' +
        '<div class="tpl-grid" data-kind="' + esc(kind) + '">' + items.map(function (item) {
          return candidateCardHtml(item, preselected.indexOf(item.key) >= 0);
        }).join('') + '</div></div>';
    }).join('');
    if (!groups) {
      return '<div class="tpl-block"><div class="subhead">模板</div>' +
        '<p class="card-hint">项目里没有可用的模板工作区，无法继续；请先把模板登记到模板库。</p></div>';
    }
    return '<div class="tpl-block"><div class="subhead">模板（必选）</div>' +
      '<p class="card-hint">选一个工作区，AI 会按它的身份和版式来做；每类最多选一个，至少要选一个。</p>' +
      '<div class="tpl-picker">' + groups + '</div>' +
      '</div>';
  }

  // Each candidate shows its real prototype pages, served by the mounted
  // confirmation surface next to this page.
  function loadTemplateThumbs(slot, slug) {
    Array.prototype.forEach.call(slot.querySelectorAll('.tpl-card[data-id]'), function (card) {
      var holder = card.querySelector('[data-thumbs]');
      if (!holder || holder.getAttribute('data-loaded')) return;
      holder.setAttribute('data-loaded', '1');
      var base = '/p/' + enc(slug) + '/confirm';
      fetch(base + '/api/template-roster/' + enc(card.getAttribute('data-kind')) +
        '/' + enc(card.getAttribute('data-id')))
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          var pages = (data && data.roster) || [];
          if (!pages.length) {
            holder.remove();
            return;
          }
          holder.innerHTML = pages.slice(0, 3).map(function (page) {
            return '<img class="tpl-thumb" src="' + esc(base + page.url) + '" alt="">';
          }).join('');
        })
        .catch(function () { holder.innerHTML = ''; });
    });
  }

  function proposalHtml(task, proposal) {
    var c = proposal.contract || {};
    var cons = proposal.constraints || {};
    var opts = optionsCache || {};
    var canvasItem = (opts.canvas || []).filter(function (item) {
      return item.id === cons.canvas;
    })[0];
    var locked = [
      ['画幅', canvasItem ? canvasItem.label : (cons.canvas || '—')],
      ['页数', cons.page_count == null ? '由 AI 决定' : cons.page_count + ' 页'],
      ['语言', optionLabel(opts.languages, cons.primary_language)]
    ].map(function (row) {
      return '<span class="locked"><em>' + esc(row[0]) + '</em>' + esc(row[1]) + '</span>';
    }).join('');

    return '<div class="card card-proposal">' +
      '<h2>AI 建议</h2>' +
      '<p class="card-hint">AI 读完材料后给的判断，都可以直接改；改完点一次「确认并生成」就开始。</p>' +
      '<label class="field"><span>任务标题</span>' +
      '<input id="proposal-title" type="text" maxlength="200" value="' +
      esc(proposal.title || task.display_title || task.topic || '') +
      '" placeholder="AI 会按材料起名，你可以改"></label>' +
      '<div class="locked-row">' + locked + '<span class="locked-note">这些是你在新建时定的</span></div>' +
      proposalFieldHtml('audience', '受众是谁', c.audience, '谁会看这份演示', 2) +
      proposalFieldHtml('communication_intent', '这次要达成什么', c.communication_intent, '汇报 / 说服 / 对齐 / 教学…', 2) +
      proposalFieldHtml('core_message', '核心信息', c.core_message, '希望被记住的那一句', 2) +
      '<details class="more-fields"><summary>展开其余契约字段</summary>' +
      proposalFieldHtml('audience_outcome', '期望的受众变化', c.audience_outcome, '看完之后他们会知道 / 相信 / 做什么', 2) +
      proposalFieldHtml('delivery_context', '使用场景', c.delivery_context, '现场主讲 / 会后自读 / 录制播放', 2) +
      proposalFieldHtml('artifact_afterlife', '会后去向', c.artifact_afterlife, '审批记录 / 交接依据 / 归档', 2) +
      proposalFieldHtml('content_divergence', '与原文的偏离', c.content_divergence, '留空表示在原文范围内合理重组', 2) +
      '</details>' +
      stylePreviewHtml(proposal) +
      templateBlockHtml(proposal.template_options) +
      '<div class="actions"><button class="btn btn-primary" id="confirm-btn" type="button">确认并生成</button>' +
      '<a class="btn" href="#/task/' + enc(task.task_id) + '/confirm">打开完整确认页</a></div>' +
      '<p class="card-hint">这是第一次确认：定契约和模板。之后 AI 会把完整方案（配色、字体、页数、配图）拿回来，你再确认一次才开跑。</p>' +
      '</div>';
  }

  function wireProposal(task, proposal, slot, slug) {
    if (slug) loadTemplateThumbs(slot, slug);
    // One workspace per kind: picking a card replaces its siblings' pick.
    Array.prototype.forEach.call(slot.querySelectorAll('.tpl-card'), function (card) {
      card.addEventListener('click', function () {
        var grid = card.parentNode;
        Array.prototype.forEach.call(grid.querySelectorAll('.tpl-card'), function (other) {
          other.classList.remove('is-picked');
        });
        card.classList.add('is-picked');
      });
    });
    var button = slot.querySelector('#confirm-btn');
    if (!button) return;
    button.addEventListener('click', function () {
      var contract = {};
      Array.prototype.forEach.call(slot.querySelectorAll('[data-contract]'), function (node) {
        contract[node.getAttribute('data-contract')] = node.value.trim();
      });
      var keys = Array.prototype.map.call(slot.querySelectorAll('.tpl-card.is-picked'), function (card) {
        return card.getAttribute('data-key');
      });
      if (!keys.length) {
        toast('先选一个模板工作区，再确认', true);
        return;
      }
      var titleNode = slot.querySelector('#proposal-title');
      button.disabled = true;
      api('POST', '/api/tasks/' + enc(task.task_id) + '/confirm', {
        contract: contract,
        display_title: titleNode ? titleNode.value.trim() : '',
        template_mode: 'templates',
        selection_keys: keys,
        options_sha256: (proposal.template_options || {}).options_sha256
      }).then(function () {
        toast('已确认，AI 开始生成');
        proposalTaskId = null;
        loadTask(task.task_id);
      }).catch(function (error) {
        button.disabled = false;
        toast('确认失败：' + error.message, true);
      });
    });
  }

  function renderProposal(task, slot, slug) {
    slot.innerHTML = '<div class="card"><div class="loading">正在读取 AI 的建议…</div></div>';
    api('GET', '/api/tasks/' + enc(task.task_id) + '/proposal').then(function (proposal) {
      if (!proposal.available) {
        slot.innerHTML = '<div class="card"><h2>等待 AI 给建议</h2><p class="hint">' +
          esc(proposal.reason || '') + '</p></div>';
        return;
      }
      slot.innerHTML = proposalHtml(task, proposal);
      wireProposal(task, proposal, slot, slug);
    }).catch(function (error) {
      slot.innerHTML = '<div class="card"><h2>建议读取失败</h2><p class="hint">' +
        esc(error.message) + '</p></div>';
    });
  }

  // The Stage-2 plan is the AI's proposal, not a verdict: it opens in the
  // confirmation surface right here so colours, typography, template
  // application, page count and image strategy stay the user's to change.
  function renderPlanReview(task, slot, slug) {
    slot.innerHTML = '<div class="card card-plan">' +
      '<h2>方案已就绪，等你确认</h2>' +
      '<p class="card-hint">AI 按你确认的契约配好了方案。配色、字体、图标、模板怎么用、页数、配图策略都在下面，改完点「确认最终方案」；确认之后才落终稿。</p>' +
      '<div class="plan-frame"><iframe src="/p/' + enc(slug) +
      '/confirm/" title="方案确认"></iframe></div></div>';
  }

  function syncProposalSlot(task, progress) {
    var slot = $('#proposal-slot');
    if (!slot) return;
    var runtime = progress.runtime || {};
    var slug = runtime.slug;
    var plan = progress.plan || {};
    if (plan.review_due && slug) {
      if (proposalTaskId === 'plan:' + task.task_id) return;
      proposalTaskId = 'plan:' + task.task_id;
      renderPlanReview(task, slot, slug);
    } else if (runtime.stage === 'confirm_stage1') {
      if (proposalTaskId === task.task_id) return;
      proposalTaskId = task.task_id;
      renderProposal(task, slot, slug);
    } else if (runtime.stage === 'template_install') {
      if (proposalTaskId === 'install:' + task.task_id) return;
      proposalTaskId = 'install:' + task.task_id;
      slot.innerHTML = '<div class="card"><h2>正在安装模板</h2>' +
        '<p class="card-hint">已确认，AI 正在把选中的模板装进项目，装好后会把完整方案拿回来给你过目。</p></div>';
    } else {
      slot.innerHTML = '';
    }
  }

  // ---------- focus mode ----------

  function renderFocus(task, kind) {
    var label = (TOOLS.filter(function (item) { return item[0] === kind; })[0] || [])[1] || kind;
    var title = task.display_title || task.topic || task.task_id;
    var slug = (task.runtime || {}).slug;
    stopPoll();

    var body = slug
      ? '<div class="focus-frame"><iframe src="/p/' + enc(slug) + '/' + enc(kind) +
        '/" title="' + esc(label) + '"></iframe></div>'
      : '<div class="card"><h2>还没有项目</h2><p class="hint">AI 接管任务后，这里会打开对应页面。</p></div>';

    workspace.innerHTML =
      '<div class="focus-bar"><a href="#/task/' + enc(task.task_id) + '">← ' + esc(title) + '</a>' +
      '<span class="focus-title">' + esc(label) + '</span></div>' + body;
  }

  // ---------- pane: form ----------

  function renderForm(pane, task) {
    pane.innerHTML = formHtml(task);
    wireCanvas();
    wireUploads(task);
    wireSubmit(task);
  }

  function uploadRows(uploads) {
    if (!uploads.length) return '<li class="empty">还没有上传材料</li>';
    return uploads.map(function (item) {
      return '<li><span class="grow">' + esc(item.name) + '</span>' +
        '<span class="time">' + esc(fmtSize(item.size)) + '</span>' +
        '<button class="btn btn-small btn-danger" data-del-upload="' + esc(item.name) +
        '" type="button">删除</button></li>';
    }).join('');
  }

  // ---------- overview: one primary column ----------

  function openRequests(progress) {
    return (progress.requests || []).filter(function (item) { return !item.response; });
  }

  function stateLine(task, progress) {
    var runtime = progress.runtime || {};
    if (task.status === 'submitted') return '等待 AI 接管';
    if (task.status === 'done') return '全部页面已交付';
    if (task.status === 'failed') return '生成失败';
    if (task.status === 'interrupted') return 'AI 已停止，等待接续';
    if (runtime.blocking) return '等待你的回答';
    if (runtime.stage === 'confirm_stage1') return '等你确认方案';
    if (runtime.progress && runtime.progress.total) {
      return '正在生成 · ' + runtime.progress.done + '/' + runtime.progress.total + ' 页';
    }
    if (runtime.stage) return '正在生成 · ' + (STAGE_LABELS[runtime.stage] || runtime.stage);
    return '正在生成';
  }

  function progressBar(runtime, status) {
    if (status === 'failed' || status === 'interrupted') {
      var stuck = runtime.stage ? (STAGE_LABELS[runtime.stage] || runtime.stage) : '未知步骤';
      return '<p class="stuck">停在了：' + esc(stuck) + '</p>';
    }
    if (status === 'done') return '';
    var progress = runtime.progress || {};
    var total = progress.total || 0;
    if (!total) return '';
    var done = progress.done || 0;
    var percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    return '<div class="bar" role="progressbar" aria-valuenow="' + done +
      '" aria-valuemin="0" aria-valuemax="' + total + '"><span style="width:' + percent +
      '%"></span></div>';
  }

  function renderOverview(task, quiet) {
    api('GET', '/api/tasks/' + enc(task.task_id) + '/progress').then(function (progress) {
      setConn(false);
      var signature = JSON.stringify([
        progress.status, (progress.runtime || {}).updated_at,
        (progress.requests || []).map(function (item) {
          return [item.request.id, item.response ? item.response.status : null];
        }),
        (progress.exports || []).length,
        (progress.events || []).length
      ]);
      if (signature === lastSignature) return;
      lastSignature = signature;

      var runtime = progress.runtime || {};
      var requests = openRequests(progress);
      var exports = progress.exports || [];
      var events = (progress.events || []).filter(function (event) {
        return !!EVENT_LABELS[event.type];
      }).slice(-6).reverse();

      var html = '<div class="card"><div class="state-line">' + esc(stateLine(task, progress)) + '</div>' +
        '<p class="card-hint">' + esc(stageCaption(runtime, progress.status)) + '</p>' +
        progressBar(runtime, progress.status) +
        (runtime.error ? '<p class="empty">' + esc(runtime.error.message || '') + '</p>' : '') +
        '</div>';

      if (requests.length) {
        html += requests.map(function (item) { return requestHtml(item.request); }).join('');
      }

      if (exports.length) {
        html += '<div class="card"><h2>交付物</h2><ul class="list">' +
          exports.map(function (file) {
            return '<li><span class="grow">' + esc(file.name) + '</span>' +
              '<span class="time">' + esc(fmtSize(file.size)) + '</span>' +
              '<a class="btn btn-small" href="/api/tasks/' + enc(task.task_id) +
              '/exports/' + enc(file.name) + '" download>下载</a></li>';
          }).join('') + '</ul></div>';
      }

      if (runtime.slug) {
        var confirmDue = (runtime.stage === 'confirm_stage1' || runtime.stage === 'template_install');
        var visible = TOOLS.filter(function (item) {
          if (item[0] === 'confirm') return confirmDue;
          return true;
        });
        html += '<div class="tools">' + visible.map(function (item) {
          var hint = item[0] === 'confirm' && confirmDue ? '待你确认' : '';
          return '<a class="tool" href="#/task/' + enc(task.task_id) + '/' + item[0] + '">' +
            '<span>' + item[1] + '</span>' + (hint ? '<em>' + hint + '</em>' : '') +
            '<b>↗</b></a>';
        }).join('') + '</div>';
      }

      html += '<details class="details"><summary>任务参数</summary><div class="details-body">' +
        detailsHtml(task) + '</div></details>';

      if (events.length) {
        html += '<details class="details"><summary>活动记录</summary><div class="details-body">' +
          '<ul class="list">' + events.map(function (event) {
            return '<li><span class="time">' + esc(shortTime(event.at)) + '</span>' +
              '<span class="grow">' + esc(eventText(event)) + '</span></li>';
          }).join('') + '</ul></div></details>';
      }

      if (progress.status === 'done' || progress.status === 'failed') {
        html += '<div class="card" id="feedback-card"><h2>反馈</h2>' +
          '<p class="card-hint">这次的结果符合预期吗？</p>' +
          '<div class="stars" id="stars">' + [1, 2, 3, 4, 5].map(function (star) {
            return '<button class="star" type="button" data-star="' + star + '">★</button>';
          }).join('') + '</div>' +
          '<label class="field"><span>评语（可选）</span>' +
          '<textarea id="fb-comment" rows="2"></textarea></label>' +
          '<label class="field-check"><input id="fb-revision" type="checkbox"> 希望进一步修订</label>' +
          '<div class="actions"><button class="btn" id="fb-save" type="button">提交反馈</button>' +
          '<span class="answered" id="fb-state"></span></div></div>';
      }

      $('#pane').innerHTML = html;
      wireOverview(task, quiet);
      syncProposalSlot(task, progress);
    }).catch(function (error) {
      setConn(true);
      if (!quiet) {
        $('#pane').innerHTML = '<div class="card"><h2>进度加载失败</h2>' +
          '<p class="hint">' + esc(error.message) + '</p></div>';
      }
    });
  }

  function stageCaption(runtime, status) {
    if (status === 'done') return '可下载 PPTX，或打开页面预览逐页查看';
    if (status === 'failed') return '';
    if (status === 'interrupted') return '';
    if (runtime.stage) return '当前阶段：' + (STAGE_LABELS[runtime.stage] || runtime.stage);
    return '等待 AI 接管';
  }

  function detailsHtml(task) {
    var p = task.params || {};
    var r = task.requirements || {};
    var opts = optionsCache || {};
    var canvasItem = (opts.canvas || []).filter(function (item) { return item.id === p.canvas; })[0];
    var rows = [
      ['画幅', canvasItem ? canvasItem.label + '（' + canvasItem.dimensions + '）' : '由 AI 决定（Stage 1 确认）'],
      ['页数', p.page_count == null ? '由 AI 决定' : String(p.page_count)],
      ['语言', optionLabel(opts.languages, p.primary_language)],
      ['配图', optionLabel(opts.image_policies, p.image_policy)],
      ['讲者备注', p.speaker_notes ? '开启' : '关闭'],
      ['想要的感觉', r.feel || '—']
    ];
    if (task.runtime && task.runtime.error) rows.push(['错误', task.runtime.error.message || '']);
    return '<dl class="meta">' + rows.map(function (row) {
      return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
    }).join('') + '</dl>';
  }

  function shortTime(value) {
    var match = String(value || '').match(/T(\d{2}:\d{2})/);
    return match ? match[1] : '';
  }

  function eventText(event) {
    var label = EVENT_LABELS[event.type];
    return label ? label(event.data || {}) : '';
  }

  function requestHtml(request) {
    var options = (request.options || []).map(function (option) {
      return '<button class="option" type="button" data-choice="' + esc(option.id) + '">' +
        esc(option.label || option.id) +
        (option.detail ? '<small>' + esc(option.detail) + '</small>' : '') + '</button>';
    }).join('');
    return '<div class="question" data-request="' + esc(request.id) + '" data-multi="' +
      (request.multi ? '1' : '') + '">' +
      '<h2>' + esc(request.title || '需要你的决定') + '</h2>' +
      (request.body ? '<p>' + esc(request.body) + '</p>' : '') +
      (options ? '<div class="options">' + options + '</div>' : '') +
      (request.allow_text === false ? '' :
        '<label class="field"><span>补充说明（可选）</span>' +
        '<textarea class="request-text" rows="2"></textarea></label>') +
      '<div class="question-actions">' +
      '<button class="btn btn-primary request-send" type="button">提交回答</button></div></div>';
  }

  function wireOverview(task, quiet) {
    Array.prototype.forEach.call(document.querySelectorAll('.question'), function (card) {
      var requestId = card.getAttribute('data-request');
      var multi = card.getAttribute('data-multi') === '1';
      var picked = [];
      Array.prototype.forEach.call(card.querySelectorAll('.option'), function (button) {
        button.addEventListener('click', function () {
          var id = button.getAttribute('data-choice');
          if (multi) {
            var at = picked.indexOf(id);
            if (at >= 0) { picked.splice(at, 1); button.classList.remove('is-picked'); }
            else { picked.push(id); button.classList.add('is-picked'); }
          } else {
            picked = [id];
            Array.prototype.forEach.call(card.querySelectorAll('.option'), function (other) {
              other.classList.remove('is-picked');
            });
            button.classList.add('is-picked');
          }
        });
      });
      var send = card.querySelector('.request-send');
      if (!send) return;
      send.addEventListener('click', function () {
        var text = card.querySelector('.request-text');
        send.disabled = true;
        api('POST', '/api/tasks/' + enc(task.task_id) + '/requests/' + enc(requestId), {
          status: 'answered', choice: picked,
          text: text ? text.value.trim() : null
        }).then(function () {
          toast('回答已提交');
          lastSignature = '';
          renderOverview(task);
        }).catch(function (error) {
          send.disabled = false;
          toast('提交失败：' + error.message, true);
        });
      });
    });

    var stars = document.getElementById('stars');
    if (stars && !quiet) {
      var rating = null;
      Array.prototype.forEach.call(stars.querySelectorAll('.star'), function (star) {
        star.addEventListener('click', function () {
          rating = parseInt(star.getAttribute('data-star'), 10);
          Array.prototype.forEach.call(stars.querySelectorAll('.star'), function (other) {
            other.classList.toggle('is-on', parseInt(other.getAttribute('data-star'), 10) <= rating);
          });
        });
      });
      document.getElementById('fb-save').addEventListener('click', function () {
        api('POST', '/api/tasks/' + enc(task.task_id) + '/feedback', {
          rating: rating,
          comment: document.getElementById('fb-comment').value.trim(),
          wants_revision: document.getElementById('fb-revision').checked
        }).then(function () {
          document.getElementById('fb-state').textContent = '已记录';
        }).catch(function (error) { toast('反馈失败：' + error.message, true); });
      });
    }
  }

  // ---------- router ----------

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/');
    if (parts[0] === 'task' && parts[1]) {
      return { taskId: decodeURIComponent(parts[1]), focus: parts[2] || '' };
    }
    return { taskId: null, focus: '' };
  }

  function route() {
    stopPoll();
    var parsed = parseHash();
    if (parsed.taskId) loadTask(parsed.taskId, parsed.focus);
    else renderNewTask();
  }

  document.getElementById('new-task').addEventListener('click', function () {
    location.hash = '#/new';
  });

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/new';
  route();
  refreshRail('');
})();

