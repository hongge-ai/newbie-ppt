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
    ['init', '初始化'], ['source', '素材'], ['outline', '大纲'],
    ['template_prep', '模板'], ['confirm_stage1', '风格'],
    ['template_install', '装入模板'], ['spec', '规格'], ['lock', '锁定'],
    ['image', '配图'], ['execute', '页面'], ['finalize', '收尾'],
    ['export', '导出'], ['done', '完成']
  ];

  var JOURNEY_STEPS = [
    ['outline', '1', '确认内容大纲', '逐页核对或批注修改'],
    ['theme', '2', '选择模板与风格', '挑版面骨架与配色气质'],
    ['slides', '3', '生成幻灯片', '逐页绘制并导出 PPTX']
  ];

  var SLIDE_EXEC_STAGES = {
    spec: true, lock: true, image: true, execute: true,
    finalize: true, export: true, done: true
  };

  var OUTLINE_ROLES = ['封面', '目录', '章节', '正文', '数据', '总结', '结束'];

  var STAGE_LABELS = STEPS.reduce(function (map, item) {
    map[item[0]] = item[1];
    return map;
  }, {});

  var TOOLS = [
    ['preview', '页面预览'], ['confirm', '阶段确认']
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
  var activeStepState = { taskId: null, step: null, lastNatural: null };
  var outlineSession = null;
  var outlineBubbleEl = null;
  var outlineDocClickBound = false;
  var commentSeq = 0;
  var activeFocusCtrl = null;
  var activePlanCtrl = null;

  function teardownFocusView() {
    if (activeFocusCtrl && typeof activeFocusCtrl.destroy === 'function') {
      try { activeFocusCtrl.destroy(); } catch (_) {}
    }
    activeFocusCtrl = null;
    if (workspace) workspace.classList.remove('is-focus');
  }

  function teardownPlanView() {
    if (activePlanCtrl && typeof activePlanCtrl.destroy === 'function') {
      try { activePlanCtrl.destroy(); } catch (_) {}
    }
    activePlanCtrl = null;
  }

  function teardownActiveViews() {
    teardownFocusView();
    teardownPlanView();
  }

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
      '<p class="card-hint">提交后分三步推进：① 先核对逐页内容大纲（支持划词批注或直接手改）→ ② 再挑模板与视觉风格 → ③ 自动生成幻灯片。</p>' +
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
      '<div class="page-sub">写清主题、上传参考材料即可：AI 会先整理逐页内容大纲供你审阅修改，定稿后再挑选模板风格并生成 PPT。</div>' +
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

  var lastProgressCache = null;

  function loadTask(taskId, focus, query) {
    teardownActiveViews();
    lastSignature = '';
    proposalTaskId = null;
    lastProgressCache = null;
    outlineSession = null;
    closeOutlineBubble();
    if (activeStepState.taskId !== taskId) {
      activeStepState = { taskId: taskId, step: null, lastNatural: null };
    }
    Promise.all([
      api('GET', '/api/tasks/' + enc(taskId)),
      loadOptions()
    ]).then(function (results) {
      var task = results[0];
      refreshRail(taskId);
      if (focus) renderFocus(task, focus, query);
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
    return '<div class="page-head"><div><h1 id="task-head-title">' + esc(title) + '</h1>' +
      '<div class="page-sub">' + esc(sub.join(' · ')) + '</div></div>' +
      statusBadge(task.status) + '</div>';
  }

  function renderTaskHome(task) {
    if (task.status === 'draft') {
      workspace.innerHTML = headerHtml(task) + '<div id="pane"></div>';
      renderForm($('#pane'), task);
      return;
    }
    if (task.status === 'submitted') {
      workspace.innerHTML = headerHtml(task) +
        '<div id="pane"><div class="loading">加载中…</div></div>';
      renderTakeover(task);
      poll(5, function () { loadTask(task.task_id); });
      return;
    }
    workspace.innerHTML = headerHtml(task) +
      '<div id="journey-bar"></div>' +
      '<div id="step-outline-slot"></div>' +
      '<div id="proposal-slot"></div>' +
      '<div id="pane"><div class="loading">加载中…</div></div>';

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

  // ---------- 3-step journey & Step 1 outline workspace ----------

  function naturalJourneyStep(progress) {
    var runtime = (progress && progress.runtime) || {};
    var outline = (progress && progress.outline) || {};
    var plan = (progress && progress.plan) || {};
    var slides = (progress && progress.slides) || [];
    var exports = (progress && progress.exports) || [];
    if (!plan.review_due && (
      progress.status === 'done' ||
      exports.length > 0 ||
      slides.length > 0 ||
      SLIDE_EXEC_STAGES[runtime.stage]
    )) {
      return 'slides';
    }
    if (plan.review_due) return 'theme';
    if (outline.status === 'confirmed') return 'theme';
    if (!outline.exists && (runtime.stage === 'confirm_stage1' || runtime.stage === 'template_install')) {
      return 'theme';
    }
    return 'outline';
  }

  function unlockedJourneySteps(progress, natural) {
    var runtime = (progress && progress.runtime) || {};
    var outline = (progress && progress.outline) || {};
    var plan = (progress && progress.plan) || {};
    var slides = (progress && progress.slides) || [];
    var exports = (progress && progress.exports) || [];
    return {
      outline: true,
      theme: !!(
        natural === 'theme' ||
        natural === 'slides' ||
        outline.status === 'confirmed' ||
        (!outline.exists && (runtime.stage === 'confirm_stage1' || runtime.stage === 'template_install' || plan.review_due))
      ),
      slides: !!(
        natural === 'slides' ||
        slides.length > 0 ||
        exports.length > 0 ||
        progress.status === 'done'
      )
    };
  }

  function completedJourneySteps(progress, natural) {
    var outline = (progress && progress.outline) || {};
    var plan = (progress && progress.plan) || {};
    var exports = (progress && progress.exports) || [];
    return {
      outline: outline.status === 'confirmed' || (!outline.exists && (natural === 'theme' || natural === 'slides')),
      theme: natural === 'slides' || !!plan.confirmed,
      slides: progress.status === 'done' || exports.length > 0
    };
  }

  function currentJourneyStep(task, progress) {
    var natural = naturalJourneyStep(progress);
    if (activeStepState.taskId !== task.task_id || !activeStepState.step) {
      activeStepState = { taskId: task.task_id, step: natural, lastNatural: natural };
    } else if (activeStepState.lastNatural !== natural) {
      activeStepState.step = natural;
      activeStepState.lastNatural = natural;
    }
    var unlocked = unlockedJourneySteps(progress, natural);
    if (!unlocked[activeStepState.step]) {
      activeStepState.step = natural;
    }
    return activeStepState.step;
  }

  function switchJourneyStep(task, targetStep) {
    if (!lastProgressCache) return;
    var natural = naturalJourneyStep(lastProgressCache);
    var unlocked = unlockedJourneySteps(lastProgressCache, natural);
    if (!unlocked[targetStep]) {
      toast('请先完成上一步确认后再进入此步骤');
      return;
    }
    if (targetStep !== 'theme') {
      teardownPlanView();
      if (proposalTaskId && proposalTaskId.indexOf('plan:') === 0) {
        proposalTaskId = null;
      }
    }
    closeOutlineBubble();
    closeModalListener();
    activeStepState.step = targetStep;
    syncJourneyView(task, lastProgressCache);
  }

  function renderJourneyBar(task, progress, activeStep) {
    var bar = $('#journey-bar');
    if (!bar) return;
    var natural = naturalJourneyStep(progress);
    var unlocked = unlockedJourneySteps(progress, natural);
    var done = completedJourneySteps(progress, natural);
    var outline = progress.outline || {};

    bar.innerHTML = '<div class="journey-steps" role="tablist" aria-label="制作流程">' +
      JOURNEY_STEPS.map(function (item, idx) {
        var key = item[0];
        var num = item[1];
        var title = item[2];
        var sub = item[3];
        if (key === 'outline' && outline.slide_count > 0) {
          sub = (outline.status === 'confirmed' ? '已定稿 · ' : '') + '共 ' + outline.slide_count + ' 页';
        } else if (key === 'slides' && (progress.slides || []).length > 0) {
          sub = '已绘 ' + progress.slides.length + ' 页';
        }
        var isCurrent = key === activeStep;
        var isDone = !!done[key];
        var isLocked = !unlocked[key];
        var cls = 'journey-step' +
          (isCurrent ? ' is-current' : '') +
          (isDone ? ' is-done' : '') +
          (isLocked ? ' is-locked' : '');
        var badge = isDone && !isCurrent ? '✓' : num;
        var arrow = idx < JOURNEY_STEPS.length - 1 ? '<span class="journey-sep" aria-hidden="true">→</span>' : '';
        return '<button type="button" class="' + cls + '" data-journey-step="' + key + '"' +
          (isLocked ? ' disabled' : '') + '>' +
          '<span class="journey-num">' + esc(badge) + '</span>' +
          '<span class="journey-copy"><strong>' + esc(title) + '</strong><small>' + esc(sub) + '</small></span>' +
          '</button>' + arrow;
      }).join('') + '</div>';

    Array.prototype.forEach.call(bar.querySelectorAll('[data-journey-step]'), function (btn) {
      btn.addEventListener('click', function () {
        switchJourneyStep(task, btn.getAttribute('data-journey-step'));
      });
    });
  }

  function inferSlideRole(headingText, index, totalHint) {
    var text = String(headingText || '');
    if (/封面|主标题|cover|title\s*slide/i.test(text)) return '封面';
    if (/目录|议程|导航|agenda|toc/i.test(text)) return '目录';
    if (/章节|过渡|第[一二三四五六七八九十\d]+\s*[部章节篇幕]|part\s*\d|section/i.test(text)) return '章节';
    if (/致谢|结束|尾页|Q\s*&\s*A|thank|closing/i.test(text) && index > 0) return '结束';
    if (/总结|回顾|小结|倡议|takeaway|summary/i.test(text) && index > 1) return '总结';
    if (/数据|指标|对比|统计|KPI|chart/i.test(text)) return '数据';
    if (index === 0 && totalHint > 1) return '封面';
    return '正文';
  }

  function parseSlideHeading(rawLine, index, totalHint) {
    var rest = String(rawLine || '').replace(/^##\s+/, '').trim();
    rest = rest.replace(/^(?:第\s*\d+\s*页|P\d{1,3}|Slide\s*\d{1,3}|\d{1,2})\s*(?:[·:：.\-—]\s*)?/i, '').trim();
    var role = '';
    var bracketMatch = rest.match(/^(?:\[([^\]]+)\]|【([^】]+)】)\s*/);
    if (bracketMatch) {
      role = (bracketMatch[1] || bracketMatch[2] || '').trim();
      rest = rest.slice(bracketMatch[0].length).trim();
    }
    if (!role) role = inferSlideRole(rest || rawLine, index, totalHint);
    return {
      role: role,
      title: rest || ('第 ' + (index + 1) + ' 页')
    };
  }

  function parseOutlineMarkdown(markdown, fallbackTitle) {
    var lines = String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var title = '';
    var summaryParts = [];
    var rawSections = [];
    var current = null;
    var inFence = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        if (current) current.bodyLines.push(line);
        continue;
      }
      if (!inFence && /^#\s+/.test(trimmed) && !/^##/.test(trimmed) && !title && !current) {
        title = trimmed.replace(/^#\s+/, '').trim();
        continue;
      }
      if (!inFence && /^##\s+/.test(trimmed) && !/^###/.test(trimmed)) {
        if (current) rawSections.push(current);
        current = { heading: trimmed, bodyLines: [] };
        continue;
      }
      if (current) {
        current.bodyLines.push(line);
      } else if (trimmed) {
        summaryParts.push(trimmed.replace(/^>\s*/, '').trim());
      }
    }
    if (current) rawSections.push(current);

    var slides = rawSections.map(function (sec, idx) {
      var parsed = parseSlideHeading(sec.heading, idx, rawSections.length);
      return {
        role: parsed.role,
        title: parsed.title,
        body: sec.bodyLines.join('\n').trim()
      };
    });

    if (!slides.length && String(markdown || '').trim()) {
      slides.push({
        role: '封面',
        title: title || fallbackTitle || '演示封面',
        body: summaryParts.join('\n')
      });
      summaryParts = [];
    }

    return {
      title: title || fallbackTitle || '未命名演示文稿',
      summary: summaryParts.join(' '),
      slides: slides
    };
  }

  function serializeOutlineMarkdown(doc) {
    var out = [];
    var title = String((doc && doc.title) || '').trim() || '未命名演示文稿';
    out.push('# ' + title);
    var summary = String((doc && doc.summary) || '').trim();
    if (summary) {
      out.push('');
      out.push('> ' + summary.replace(/\n+/g, ' '));
    }
    ((doc && doc.slides) || []).forEach(function (slide, idx) {
      var role = String(slide.role || '正文').trim();
      var sTitle = String(slide.title || ('第 ' + (idx + 1) + ' 页')).trim();
      var body = String(slide.body || '').replace(/\r\n/g, '\n').trim();
      out.push('');
      out.push('## 第 ' + (idx + 1) + ' 页 [' + role + '] ' + sTitle);
      if (body) out.push(body);
    });
    return out.join('\n') + '\n';
  }

  function inlineOutlineMd(raw) {
    var s = esc(raw);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s;
  }

  function renderOutlineBodyHtml(bodyMd) {
    var src = String(bodyMd || '').replace(/\r\n/g, '\n').trim();
    if (!src) {
      return '<p class="ol-empty-body">（本页暂无要点文字，点击右上角「✎ 编辑」补充）</p>';
    }
    var lines = src.split('\n');
    var html = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { i++; continue; }

      if (/^```/.test(trimmed)) {
        var codeBuf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeBuf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        html.push('<pre class="ol-code" data-ol-block="1"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
        continue;
      }

      var hMatch = trimmed.match(/^(#{3,5})\s+(.*)$/);
      if (hMatch) {
        html.push('<h4 class="ol-subhead" data-ol-block="1">' + inlineOutlineMd(hMatch[2]) + '</h4>');
        i++;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        var qBuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          qBuf.push(inlineOutlineMd(lines[i].trim().replace(/^>\s?/, '')));
          i++;
        }
        html.push('<blockquote class="ol-quote" data-ol-block="1">' + qBuf.join('<br>') + '</blockquote>');
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        var ulItems = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ulItems.push('<li data-ol-block="1">' + inlineOutlineMd(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
          i++;
        }
        html.push('<ul class="ol-list">' + ulItems.join('') + '</ul>');
        continue;
      }

      if (/^\d+[.、]\s+/.test(trimmed)) {
        var olItems = [];
        while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
          olItems.push('<li data-ol-block="1">' + inlineOutlineMd(lines[i].replace(/^\s*\d+[.、]\s+/, '')) + '</li>');
          i++;
        }
        html.push('<ol class="ol-list">' + olItems.join('') + '</ol>');
        continue;
      }

      var pBuf = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(```|#{3,5}\s|>\s?|[-*+]\s+|\d+[.、]\s+)/.test(lines[i].trim())
      ) {
        pBuf.push(inlineOutlineMd(lines[i].trim()));
        i++;
      }
      html.push('<p data-ol-block="1">' + pBuf.join('<br>') + '</p>');
    }
    return html.join('');
  }

  function closeOutlineBubble() {
    if (outlineBubbleEl && outlineBubbleEl.parentNode) {
      outlineBubbleEl.parentNode.removeChild(outlineBubbleEl);
    }
    outlineBubbleEl = null;
  }

  function rangeTouchesHighlight(range, container) {
    var spans = container.querySelectorAll('.ol-hl');
    for (var i = 0; i < spans.length; i++) {
      try {
        if (range.intersectsNode(spans[i])) return spans[i];
      } catch (_err) {}
    }
    return null;
  }

  function paintHighlightRange(range, container, cid) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var targets = [];
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (node.parentElement && node.parentElement.closest('.ol-hl')) continue;
      try {
        if (!range.intersectsNode(node)) continue;
      } catch (_err) {
        continue;
      }
      var start = node === range.startContainer ? range.startOffset : 0;
      var end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (end > start) targets.push({ node: node, start: start, end: end });
    }
    targets.forEach(function (seg) {
      var sub = document.createRange();
      sub.setStart(seg.node, seg.start);
      sub.setEnd(seg.node, seg.end);
      var span = document.createElement('span');
      span.className = 'ol-hl';
      span.setAttribute('data-cid', cid);
      sub.surroundContents(span);
    });
    return targets.length > 0;
  }

  function unwrapHighlight(root, cid) {
    if (!root) return;
    Array.prototype.forEach.call(
      root.querySelectorAll('.ol-hl[data-cid="' + cid + '"]'),
      function (span) {
        var parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      }
    );
  }

  function paintQuoteInReadBox(readBox, quote, cid) {
    if (!readBox || !quote) return false;
    var walker = document.createTreeWalker(readBox, NodeFilter.SHOW_TEXT, null);
    var segments = [];
    var full = '';
    var n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue) continue;
      if (n.parentElement && n.parentElement.closest('.ol-hl')) continue;
      segments.push({ node: n, from: full.length, to: full.length + n.nodeValue.length });
      full += n.nodeValue;
    }
    var pos = full.indexOf(quote);
    if (pos < 0) return false;
    var endPos = pos + quote.length;
    var startSeg = null;
    var endSeg = null;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      if (!startSeg && pos >= s.from && pos < s.to) startSeg = { node: s.node, offset: pos - s.from };
      if (endPos > s.from && endPos <= s.to) { endSeg = { node: s.node, offset: endPos - s.from }; break; }
    }
    if (!startSeg || !endSeg) return false;
    var r = document.createRange();
    r.setStart(startSeg.node, startSeg.offset);
    r.setEnd(endSeg.node, endSeg.offset);
    return paintHighlightRange(r, readBox, cid);
  }

  function restoreHighlightsOnSlides(slot, session) {
    if (!slot || !session || !session.comments || !session.comments.length) return;
    var boxes = Array.prototype.slice.call(slot.querySelectorAll('.ol-slide-read'));
    var kept = [];
    session.comments.forEach(function (c) {
      var painted = false;
      var preferred = (c.slide && boxes[c.slide - 1]) ? [c.slide - 1] : [];
      boxes.forEach(function (_b, idx) {
        if (preferred.indexOf(idx) < 0) preferred.push(idx);
      });
      for (var k = 0; k < preferred.length; k++) {
        var sIdx = preferred[k];
        var box = boxes[sIdx];
        if (box && paintQuoteInReadBox(box, c.quote, c.id)) {
          c.slide = sIdx + 1;
          c.slide_title = (session.doc.slides[sIdx] || {}).title || c.slide_title;
          painted = true;
          break;
        }
      }
      if (painted) kept.push(c);
    });
    session.comments = kept;
  }

  function setActiveHighlight(slot, session, cid) {
    session.activeCid = cid || null;
    Array.prototype.forEach.call(slot.querySelectorAll('.ol-hl'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-cid') === session.activeCid);
    });
    Array.prototype.forEach.call(slot.querySelectorAll('.ol-comment-item'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-comment-id') === session.activeCid);
    });
  }

  function roleBadgeClass(role) {
    if (role === '封面') return 'is-cover';
    if (role === '章节' || role === '目录') return 'is-chapter';
    if (role === '结束' || role === '总结') return 'is-ending';
    if (role === '数据') return 'is-data';
    return 'is-body';
  }

  function renderBatchPanel(slot, task, session) {
    var host = slot.querySelector('#ol-batch-host');
    if (!host) return;
    var isRevising = session.status === 'revising';
    var count = session.comments.length;

    var listHtml = count
      ? '<ul class="ol-comment-list">' + session.comments.map(function (c) {
          var active = c.id === session.activeCid ? ' is-active' : '';
          var pTag = c.slide ? ('P' + (c.slide < 10 ? '0' + c.slide : c.slide)) : '批注';
          return '<li class="ol-comment-item' + active + '" data-comment-id="' + esc(c.id) + '">' +
            '<div class="ol-comment-top">' +
            '<span class="ol-comment-page">' + esc(pTag) + '</span>' +
            '<span class="ol-comment-quote" title="' + esc(c.quote) + '">“' + esc(c.quote) + '”</span>' +
            '<button type="button" class="ol-comment-del" data-del-cid="' + esc(c.id) + '" title="移除这条批注"' +
            (isRevising ? ' disabled' : '') + '>×</button></div>' +
            '<div class="ol-comment-body">' + esc(c.comment) + '</div>' +
            '</li>';
        }).join('') + '</ul>'
      : '<div class="ol-batch-empty">在左侧任意页面文字上<strong>按住鼠标划选</strong>，即可针对那句话添加批注；支持跨多页攒多条后一次发给 AI 改稿。</div>';

    var canRevise = !isRevising && (count > 0 || !!(session.globalNote && session.globalNote.trim()));

    host.innerHTML = '<div class="ol-batch-panel">' +
      '<div class="ol-batch-head">' +
      '<h3>AI 批注改稿</h3>' +
      (count ? '<span class="ol-batch-count">待发送 ' + count + ' 条</span>' : '') +
      (count && !isRevising ? '<button type="button" class="btn-link" id="ol-clear-comments">清空</button>' : '') +
      '</div>' +
      listHtml +
      '<label class="field ol-global-field"><span>整体修改要求（可选）</span>' +
      '<textarea id="ol-global-note" rows="3" placeholder="例如：把第 4～5 页合并精简、补充一组退化对比数据、语气再通俗生动些…"' +
      (isRevising ? ' disabled' : '') + '>' + esc(session.globalNote || '') + '</textarea></label>' +
      '<button type="button" class="btn ol-revise-btn" id="ol-revise-btn"' +
      (canRevise ? '' : ' disabled') + '>' +
      (isRevising ? 'AI 正在按批注改稿…' : ('提交修改让 AI 改稿' + (count ? '（' + count + ' 条批注）' : ''))) +
      '</button>' +
      '<div class="ol-side-divider"></div>' +
      '<button type="button" class="btn btn-primary ol-confirm-btn" id="ol-confirm-side-btn"' +
      (isRevising ? ' disabled' : '') + '>确认大纲，下一步选模板 →</button>' +
      '<p class="ol-side-foot">定稿后进入第 2 步挑选视觉风格与页面模板；后续仍可随时切回查看大纲。</p>' +
      '</div>';

    var noteEl = host.querySelector('#ol-global-note');
    var reviseBtn = host.querySelector('#ol-revise-btn');
    if (noteEl) {
      noteEl.addEventListener('input', function () {
        session.globalNote = noteEl.value;
        if (reviseBtn) {
          reviseBtn.disabled = isRevising || !(session.comments.length > 0 || session.globalNote.trim().length > 0);
        }
      });
    }

    var clearBtn = host.querySelector('#ol-clear-comments');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        session.comments.slice().forEach(function (c) { unwrapHighlight(slot, c.id); });
        session.comments = [];
        session.activeCid = null;
        renderBatchPanel(slot, task, session);
      });
    }

    Array.prototype.forEach.call(host.querySelectorAll('[data-del-cid]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cid = btn.getAttribute('data-del-cid');
        unwrapHighlight(slot, cid);
        session.comments = session.comments.filter(function (c) { return c.id !== cid; });
        if (session.activeCid === cid) session.activeCid = null;
        renderBatchPanel(slot, task, session);
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('.ol-comment-item'), function (item) {
      item.addEventListener('click', function () {
        var cid = item.getAttribute('data-comment-id');
        setActiveHighlight(slot, session, cid);
        var span = slot.querySelector('.ol-hl[data-cid="' + cid + '"]');
        if (span) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    if (reviseBtn) {
      reviseBtn.addEventListener('click', function () {
        submitOutlineRevisionBatch(slot, task, session);
      });
    }

    var sideConfirm = host.querySelector('#ol-confirm-side-btn');
    if (sideConfirm) {
      sideConfirm.addEventListener('click', function () {
        confirmOutlineAndAdvance(slot, task, session);
      });
    }
  }

  function persistOutlineDirectEdit(slot, task, session, toastMsg) {
    var md = serializeOutlineMarkdown(session.doc);
    return api('PUT', '/api/tasks/' + enc(task.task_id) + '/outline', {
      markdown: md,
      display_title: session.doc.title
    }).then(function (view) {
      session.status = view.status;
      session.round = view.round;
      session.sha256 = view.outline_sha256;
      task.display_title = session.doc.title;
      var h1 = $('#task-head-title');
      if (h1) h1.textContent = session.doc.title;
      proposalTaskId = null;
      refreshRail(task.task_id);
      if (toastMsg) toast(toastMsg);
      paintOutlineDom(slot, task, session);
    }).catch(function (error) {
      toast('保存失败：' + error.message, true);
    });
  }

  function submitOutlineRevisionBatch(slot, task, session) {
    if (session.editingIndex !== null) {
      toast('请先保存或取消正在编辑的单页内容，再提交 AI 批注', true);
      return;
    }
    var note = (session.globalNote || '').trim();
    if (!session.comments.length && !note) {
      toast('请先在正文划词添加批注，或填写整体修改要求', true);
      return;
    }
    var md = serializeOutlineMarkdown(session.doc);
    var reviseBtn = slot.querySelector('#ol-revise-btn');
    if (reviseBtn) reviseBtn.disabled = true;
    closeOutlineBubble();

    api('POST', '/api/tasks/' + enc(task.task_id) + '/outline/revise', {
      comments: session.comments,
      global_note: note,
      markdown: md
    }).then(function (view) {
      session.status = view.status;
      session.round = view.round;
      session.pendingRevision = view.pending_revision;
      session.comments = [];
      session.globalNote = '';
      session.activeCid = null;
      toast('已提交给 AI，正在按批注修订大纲…');
      paintOutlineDom(slot, task, session);
      lastSignature = '';
    }).catch(function (error) {
      if (reviseBtn) reviseBtn.disabled = false;
      toast('提交批注失败：' + error.message, true);
    });
  }

  function confirmOutlineAndAdvance(slot, task, session) {
    if (session.editingIndex !== null) {
      toast('请先保存正在编辑的页面后再确认大纲', true);
      return;
    }
    var unsent = session.comments.length > 0 || !!(session.globalNote && session.globalNote.trim());
    if (unsent && !window.confirm('右侧还有未提交给 AI 的批注，确定忽略这些批注并直接定稿大纲吗？')) {
      return;
    }
    var md = serializeOutlineMarkdown(session.doc);
    closeOutlineBubble();

    var sideBtn = slot.querySelector('#ol-confirm-side-btn');
    if (sideBtn) sideBtn.disabled = true;

    api('POST', '/api/tasks/' + enc(task.task_id) + '/outline/confirm', {
      markdown: md,
      display_title: session.doc.title
    }).then(function (view) {
      session.status = 'confirmed';
      session.round = view.round;
      session.sha256 = view.outline_sha256;
      session.comments = [];
      session.globalNote = '';
      task.display_title = session.doc.title;
      var h1 = $('#task-head-title');
      if (h1) h1.textContent = session.doc.title;
      refreshRail(task.task_id);
      paintOutlineDom(slot, task, session);
      toast('大纲已定稿！接下来选择模板与视觉风格');
      activeStepState.step = 'theme';
      proposalTaskId = null;
      lastSignature = '';
      renderOverview(task);
    }).catch(function (error) {
      if (sideBtn) sideBtn.disabled = false;
      toast('确认大纲失败：' + error.message, true);
    });
  }

  function openOutlineBubble(slot, task, session, range, quote, slideIdx, readBox) {
    closeOutlineBubble();
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;

    var bubble = document.createElement('div');
    bubble.className = 'ol-bubble';
    var shortQuote = quote.length > 56 ? (quote.slice(0, 56) + '…') : quote;
    bubble.innerHTML =
      '<div class="ol-bubble-quote">针对：<span>“' + esc(shortQuote) + '”</span></div>' +
      '<textarea class="ol-bubble-input" rows="2" placeholder="写修改意见，例如：改成中学生听得懂的比喻 / 补充具体年份数据（Enter 添加）"></textarea>' +
      '<div class="ol-bubble-actions">' +
      '<button type="button" class="btn btn-small" data-bubble-cancel="1">取消</button>' +
      '<button type="button" class="btn btn-small btn-primary" data-bubble-save="1">加入批注</button>' +
      '</div>';
    document.body.appendChild(bubble);
    outlineBubbleEl = bubble;

    var bw = 336;
    var left = Math.max(16, Math.min(window.innerWidth - bw - 16, rect.left));
    var top = rect.bottom + 8;
    if (top + 150 > window.innerHeight) {
      top = Math.max(12, rect.top - 148);
    }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';

    var input = bubble.querySelector('.ol-bubble-input');
    window.setTimeout(function () { if (input) input.focus(); }, 10);

    function commitComment() {
      var text = input ? input.value.trim() : '';
      if (!text) {
        toast('请填写批注内容');
        if (input) input.focus();
        return;
      }
      commentSeq += 1;
      var cid = 'c_' + Date.now().toString(36) + '_' + commentSeq;
      var ok = paintHighlightRange(range, readBox, cid);
      if (!ok) {
        toast('无法标记该选区，请在同一段文字内重新划选', true);
        closeOutlineBubble();
        return;
      }
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      var slideObj = session.doc.slides[slideIdx] || {};
      session.comments.push({
        id: cid,
        slide: slideIdx + 1,
        slide_title: slideObj.title || '',
        quote: quote,
        comment: text
      });
      session.activeCid = cid;
      closeOutlineBubble();
      renderBatchPanel(slot, task, session);
      setActiveHighlight(slot, session, cid);
    }

    bubble.querySelector('[data-bubble-cancel]').addEventListener('click', function () {
      closeOutlineBubble();
    });
    bubble.querySelector('[data-bubble-save]').addEventListener('click', commitComment);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeOutlineBubble();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitComment();
      }
    });
  }

  function slideCardHtml(slide, idx, total, session) {
    var pNum = 'P' + (idx + 1 < 10 ? '0' + (idx + 1) : (idx + 1));
    var isEditing = session.editingIndex === idx;
    var isRevising = session.status === 'revising';

    if (isEditing) {
      var roleOpts = OUTLINE_ROLES.slice();
      if (roleOpts.indexOf(slide.role) < 0) roleOpts.unshift(slide.role);
      return '<article class="ol-slide-card is-editing" data-slide-idx="' + idx + '">' +
        '<div class="ol-editor">' +
        '<div class="ol-editor-head">' +
        '<span class="ol-page-no">' + esc(pNum) + '</span>' +
        '<select class="ol-role-select" id="ol-edit-role">' +
        roleOpts.map(function (r) {
          return '<option value="' + esc(r) + '"' + (r === slide.role ? ' selected' : '') + '>' + esc(r) + '</option>';
        }).join('') +
        '</select>' +
        '<input type="text" class="ol-title-input" id="ol-edit-title" maxlength="160" value="' +
        esc(slide.title) + '" placeholder="本页标题">' +
        '</div>' +
        '<textarea class="ol-body-input" id="ol-edit-body" rows="6" ' +
        'placeholder="- 要点一：支持 Markdown 列表与 **加粗**&#10;- 要点二：直接写这页要呈现在 PPT 上的核心内容">' +
        esc(slide.body) + '</textarea>' +
        '<div class="ol-editor-foot">' +
        '<span class="ol-editor-tip">提示：用 <code>- </code> 写分条要点，用 <code>**重点**</code> 标粗；按 Ctrl+Enter 快速保存</span>' +
        '<div class="ol-editor-btns">' +
        '<button type="button" class="btn btn-small" id="ol-cancel-slide">取消</button>' +
        '<button type="button" class="btn btn-small btn-primary" id="ol-save-slide">保存本页</button>' +
        '</div></div></div></article>';
    }

    return '<article class="ol-slide-card" data-slide-idx="' + idx + '">' +
      '<div class="ol-slide-head">' +
      '<span class="ol-page-no">' + esc(pNum) + '</span>' +
      '<span class="ol-role-pill ' + roleBadgeClass(slide.role) + '">' + esc(slide.role) + '</span>' +
      '<h3 class="ol-slide-title" data-ol-edit="' + idx + '" title="点击编辑本页">' + esc(slide.title) + '</h3>' +
      '<div class="ol-slide-tools">' +
      '<button type="button" class="ol-tool-btn" data-ol-edit="' + idx + '"' + (isRevising ? ' disabled' : '') + '>✎ 编辑</button>' +
      '<button type="button" class="ol-tool-btn" data-ol-add-after="' + idx + '" title="在此页下方插入新页"' + (isRevising ? ' disabled' : '') + '>＋ 加页</button>' +
      '<button type="button" class="ol-tool-btn" data-ol-up="' + idx + '" title="上移"' + (isRevising || idx === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" class="ol-tool-btn" data-ol-down="' + idx + '" title="下移"' + (isRevising || idx === total - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button type="button" class="ol-tool-btn is-danger" data-ol-del="' + idx + '" title="删除本页"' + (isRevising || total <= 1 ? ' disabled' : '') + '>删除</button>' +
      '</div></div>' +
      '<div class="ol-slide-read" data-read-idx="' + idx + '">' +
      renderOutlineBodyHtml(slide.body) +
      '</div></article>';
  }

  function paintOutlineDom(slot, task, session) {
    closeOutlineBubble();
    var slides = session.doc.slides || [];
    var isRevising = session.status === 'revising';
    var isConfirmed = session.status === 'confirmed';

    var bannerHtml = '';
    if (isRevising) {
      var pending = session.pendingRevision || {};
      var pCount = (pending.comments || []).length;
      var pNote = pending.global_note || '';
      bannerHtml = '<div class="ol-banner is-revising">' +
        '<div class="ol-banner-main"><strong>AI 正在根据你的批注修订大纲…</strong>' +
        '<span>已提交 ' + pCount + ' 条划词批注' + (pNote ? '与整体修改要求' : '') +
        '，修订完成后页面会自动刷新，请稍候。</span></div></div>';
    } else if (isConfirmed) {
      bannerHtml = '<div class="ol-banner is-confirmed">' +
        '<div class="ol-banner-main"><strong>✓ 内容大纲已确认（共 ' + slides.length + ' 页）</strong>' +
        '<span>你仍可继续手改单页或划词批注再改一轮，也可以直接进入第 2 步挑选模板风格。</span></div>' +
        '<button type="button" class="btn btn-small btn-primary" id="ol-goto-theme-btn">前往第 2 步选模板 →</button></div>';
    }

    slot.innerHTML =
      '<div class="ol-shell">' +
      bannerHtml +
      '<div class="ol-grid">' +
      '<div class="ol-main">' +
      '<div class="ol-howto">' +
      '<span><strong>划词批注：</strong>在任意文字上按住鼠标拖选 → 写批注攒到右侧，让 AI 统一改稿</span>' +
      '<span><strong>直接手改：</strong>点任意页标题或「✎ 编辑」直接改字、加删页面、上下调序</span>' +
      '</div>' +
      '<div class="ol-slides-list" id="ol-slides-list">' +
      slides.map(function (s, idx) { return slideCardHtml(s, idx, slides.length, session); }).join('') +
      '</div>' +
      '<div class="ol-list-foot">' +
      '<button type="button" class="btn" id="ol-add-end-bottom"' + (isRevising ? ' disabled' : '') + '>＋ 在末尾新增一页</button>' +
      '</div></div>' +
      '<aside class="ol-side" id="ol-batch-host"></aside>' +
      '</div></div>';

    restoreHighlightsOnSlides(slot, session);
    renderBatchPanel(slot, task, session);
    if (session.activeCid) setActiveHighlight(slot, session, session.activeCid);
    wireOutlineInteractions(slot, task, session);
  }

  function wireOutlineInteractions(slot, task, session) {
    var isRevising = session.status === 'revising';

    var gotoTheme = slot.querySelector('#ol-goto-theme-btn');
    if (gotoTheme) {
      gotoTheme.addEventListener('click', function () {
        switchJourneyStep(task, 'theme');
      });
    }

    function addSlideAt(insertIdx) {
      if (isRevising) return;
      var newSlide = {
        role: '正文',
        title: '新增页面标题',
        body: '- 核心要点一：填写本页要讲的关键事实或结论\n- 核心要点二：补充支撑论据或案例'
      };
      session.doc.slides.splice(insertIdx, 0, newSlide);
      session.editingIndex = insertIdx;
      persistOutlineDirectEdit(slot, task, session, '已新增第 ' + (insertIdx + 1) + ' 页');
    }

    var addEndBtn = slot.querySelector('#ol-add-end-bottom');
    if (addEndBtn) {
      addEndBtn.addEventListener('click', function () {
        addSlideAt(session.doc.slides.length);
      });
    }

    Array.prototype.forEach.call(slot.querySelectorAll('[data-ol-edit]'), function (el) {
      el.addEventListener('click', function (e) {
        if (isRevising) return;
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        e.stopPropagation();
        session.editingIndex = parseInt(el.getAttribute('data-ol-edit'), 10);
        paintOutlineDom(slot, task, session);
        var titleInput = slot.querySelector('#ol-edit-title');
        if (titleInput) titleInput.focus();
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-ol-add-after]'), function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ol-add-after'), 10);
        addSlideAt(idx + 1);
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-ol-up]'), function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ol-up'), 10);
        if (idx <= 0) return;
        var arr = session.doc.slides;
        var tmp = arr[idx - 1];
        arr[idx - 1] = arr[idx];
        arr[idx] = tmp;
        session.editingIndex = null;
        persistOutlineDirectEdit(slot, task, session, '已上移至第 ' + idx + ' 页');
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-ol-down]'), function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ol-down'), 10);
        var arr = session.doc.slides;
        if (idx >= arr.length - 1) return;
        var tmp = arr[idx + 1];
        arr[idx + 1] = arr[idx];
        arr[idx] = tmp;
        session.editingIndex = null;
        persistOutlineDirectEdit(slot, task, session, '已下移至第 ' + (idx + 2) + ' 页');
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-ol-del]'), function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ol-del'), 10);
        if (session.doc.slides.length <= 1) {
          toast('至少需要保留 1 页大纲', true);
          return;
        }
        var target = session.doc.slides[idx];
        if (!window.confirm('确定删除第 ' + (idx + 1) + ' 页「' + (target ? target.title : '') + '」吗？')) {
          return;
        }
        session.doc.slides.splice(idx, 1);
        session.editingIndex = null;
        persistOutlineDirectEdit(slot, task, session, '已删除页面并自动重排页码');
      });
    });

    var saveSlideBtn = slot.querySelector('#ol-save-slide');
    var cancelSlideBtn = slot.querySelector('#ol-cancel-slide');
    if (saveSlideBtn && session.editingIndex !== null) {
      var commitSlideEdit = function () {
        var rEl = slot.querySelector('#ol-edit-role');
        var tEl = slot.querySelector('#ol-edit-title');
        var bEl = slot.querySelector('#ol-edit-body');
        var editedTitle = tEl ? tEl.value.trim() : '';
        if (!editedTitle) {
          toast('请填写本页标题', true);
          if (tEl) tEl.focus();
          return;
        }
        var sObj = session.doc.slides[session.editingIndex];
        if (sObj) {
          sObj.role = rEl ? rEl.value : sObj.role;
          sObj.title = editedTitle;
          sObj.body = bEl ? bEl.value.replace(/\r\n/g, '\n').trim() : '';
          if (session.editingIndex === 0 && sObj.role === '封面') {
            session.doc.title = editedTitle;
          }
        }
        var savedNo = session.editingIndex + 1;
        session.editingIndex = null;
        persistOutlineDirectEdit(slot, task, session, '已保存第 ' + savedNo + ' 页');
      };
      saveSlideBtn.addEventListener('click', commitSlideEdit);
      var bodyTextarea = slot.querySelector('#ol-edit-body');
      if (bodyTextarea) {
        bodyTextarea.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            commitSlideEdit();
          }
        });
      }
    }
    if (cancelSlideBtn) {
      cancelSlideBtn.addEventListener('click', function () {
        session.editingIndex = null;
        paintOutlineDom(slot, task, session);
      });
    }

    var slidesList = slot.querySelector('#ol-slides-list');
    if (slidesList && !isRevising) {
      slidesList.addEventListener('click', function (e) {
        var hl = e.target && e.target.closest ? e.target.closest('.ol-hl') : null;
        if (!hl) return;
        var cid = hl.getAttribute('data-cid');
        setActiveHighlight(slot, session, cid);
        var panelItem = slot.querySelector('.ol-comment-item[data-comment-id="' + cid + '"]');
        if (panelItem) panelItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      slidesList.addEventListener('mouseup', function (e) {
        if (e.target && e.target.closest && e.target.closest('.ol-editor, button, input, textarea, select')) {
          return;
        }
        window.setTimeout(function () {
          var sel = window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) return;
          var quote = sel.toString().replace(/\s+/g, ' ').trim();
          if (quote.length < 2) return;
          var range = sel.getRangeAt(0);
          var startRead = range.startContainer.nodeType === 1
            ? range.startContainer.closest('.ol-slide-read')
            : (range.startContainer.parentElement && range.startContainer.parentElement.closest('.ol-slide-read'));
          var endRead = range.endContainer.nodeType === 1
            ? range.endContainer.closest('.ol-slide-read')
            : (range.endContainer.parentElement && range.endContainer.parentElement.closest('.ol-slide-read'));
          if (!startRead || startRead !== endRead) {
            toast('请在同一页正文内划选文字添加批注');
            return;
          }
          var existingHl = rangeTouchesHighlight(range, startRead);
          if (existingHl) {
            var existingCid = existingHl.getAttribute('data-cid');
            sel.removeAllRanges();
            setActiveHighlight(slot, session, existingCid);
            return;
          }
          var slideIdx = parseInt(startRead.getAttribute('data-read-idx'), 10);
          openOutlineBubble(slot, task, session, range.cloneRange(), sel.toString().trim(), slideIdx, startRead);
        }, 15);
      });
    }

    if (!outlineDocClickBound) {
      outlineDocClickBound = true;
      document.addEventListener('mousedown', function (e) {
        if (!outlineBubbleEl) return;
        if (outlineBubbleEl.contains(e.target)) return;
        closeOutlineBubble();
      });
    }
  }

  function syncOutlineSlot(task, progress, visible) {
    var slot = $('#step-outline-slot');
    if (!slot) return;
    slot.hidden = !visible;
    if (!visible) return;

    var outlineMeta = (progress && progress.outline) || {};
    var needFetch = false;
    var wasRevising = false;

    if (!outlineSession || outlineSession.taskId !== task.task_id) {
      needFetch = true;
    } else if (!outlineSession.available && outlineMeta.exists) {
      needFetch = true;
    } else if (
      outlineSession.status === 'revising' &&
      outlineMeta.exists &&
      (outlineMeta.status !== 'revising' || outlineMeta.round !== outlineSession.round)
    ) {
      needFetch = true;
      wasRevising = true;
    }

    if (!needFetch) return;

    if (!outlineSession || outlineSession.taskId !== task.task_id) {
      slot.innerHTML = '<div class="card"><div class="loading">正在读取内容大纲…</div></div>';
    }

    api('GET', '/api/tasks/' + enc(task.task_id) + '/outline').then(function (view) {
      if (!view.available) {
        outlineSession = {
          taskId: task.task_id,
          available: false,
          status: 'missing',
          round: 0
        };
        var rt = (progress && progress.runtime) || {};
        var stageHint = rt.stage ? ('（当前：' + (STAGE_LABELS[rt.stage] || rt.stage) + '）') : '';
        slot.innerHTML = '<div class="card ol-waiting-card">' +
          '<h2>AI 正在为你梳理逐页内容大纲…</h2>' +
          '<p class="card-hint">正在结合你的主题与参考资料提炼每一页的标题与核心要点 ' + esc(stageHint) +
          '。生成完成后会自动呈现在这里供你逐页审阅、直接修改或划词批注。</p>' +
          '</div>';
        return;
      }

      var fallbackTitle = task.display_title || task.topic || '';
      outlineSession = {
        taskId: task.task_id,
        available: true,
        status: view.status,
        round: view.round,
        sha256: view.outline_sha256,
        pendingRevision: view.pending_revision,
        doc: parseOutlineMarkdown(view.markdown, fallbackTitle),
        editingIndex: null,
        headerDirty: false,
        comments: [],
        activeCid: null,
        globalNote: ''
      };
      if (wasRevising) {
        toast('AI 已完成第 ' + view.round + ' 版大纲修订，请过目');
      }
      paintOutlineDom(slot, task, outlineSession);
    }).catch(function (error) {
      slot.innerHTML = '<div class="card"><h2>大纲读取失败</h2><p class="hint">' +
        esc(error.message) + '</p></div>';
    });
  }

  // ---------- proposal: Stage 1 inline confirmation ----------

  var KIND_HUMAN = {
    brand: '主题色调',
    style: '内容讲法',
    layout: '页面版式',
    deck: '成品模板'
  };

  var SLIDE_TOKENS = {
    TITLE: '演示主标题示例',
    SUBTITLE: '副标题与核心背景一句话说明',
    SECTION_NAME: '第一部分',
    CHAPTER_NUM: '01',
    CHAPTER_TITLE: '核心章节标题',
    CHAPTER_SUBTITLE: '章节导读与关键问题展开',
    CHAPTER_DESC: '围绕核心议题展开关键论据与分析结论',
    PAGE_TITLE: '本页核心结论与要点标题',
    CONTENT_AREA: '正文内容排版示意：围绕核心观点展开层次清晰的论据、案例与说明文字。',
    BODY_TEXT: '围绕本页主题展开核心分析，突出关键事实与结论。',
    SUPPORT_TEXT: '补充说明与关键背景信息，帮助听众快速抓住重点。',
    KEY_MESSAGE: '核心判断：聚焦最关键的一项发力点，用清晰证据支撑决策。',
    QUOTE_TEXT: '“真正打动人的演示，是让每一页只说清一件最重要的事。”',
    ATTRIBUTION: '—— 调研访谈纪要',
    CARD_1: '要点一：核心现状与关键发现',
    CARD_2: '要点二：主要成因与机制拆解',
    CARD_3: '要点三：落地路径与行动重点',
    BLOCK_1: '模块一：关键背景与现状盘点',
    BLOCK_2: '模块二：核心方案与推进策略',
    BLOCK_3: '模块三：预期成效与保障机制',
    ITEM_1: '第一项关键要点与说明',
    ITEM_2: '第二项关键要点与说明',
    ITEM_3: '第三项关键要点与说明',
    ITEM_4: '第四项关键要点与说明',
    ITEM_5: '第五项关键要点与说明',
    KPI_1: '96.8%',
    KPI_2: '3.2x',
    KPI_3: '128 项',
    KPI_4: '+42%',
    STEP_1: '01 现状诊断',
    STEP_2: '02 方案设计',
    STEP_3: '03 试点验证',
    STEP_4: '04 全面推广',
    LEFT_TITLE: '方案 A · 现状对比',
    RIGHT_TITLE: '方案 B · 优化方向',
    LEFT_CONTENT: '左侧对比要点与关键依据说明',
    RIGHT_CONTENT: '右侧核心优势与改进效果说明',
    LEFT_CAPTION: '左侧图示说明',
    RIGHT_CAPTION: '右侧图示说明',
    TOP_CONTENT: '上方重点结论概览',
    BOTTOM_CONTENT: '下方支撑细节与补充说明',
    QUADRANT_1: '高价值 · 优先推进',
    QUADRANT_2: '战略储备 · 持续培育',
    QUADRANT_3: '常规维护 · 控制投入',
    QUADRANT_4: '审慎评估 · 按需取舍',
    TOC_ITEM_1_TITLE: '背景与核心问题界定',
    TOC_ITEM_2_TITLE: '关键事实与成因剖析',
    TOC_ITEM_3_TITLE: '行动方案与实施路径',
    TOC_ITEM_4_TITLE: '总结回顾与下一步计划',
    TOC_ITEM_5_TITLE: '补充材料与附录说明',
    CAPTION: '配图与核心信息说明',
    CAPTION_1: '场景示意一',
    CAPTION_2: '场景示意二',
    CAPTION_3: '场景示意三',
    CAPTION_4: '场景示意四',
    ANNOTATION: '关键数据批注与趋势解读',
    X_AXIS: '阶段 / 时间维度',
    Y_AXIS: '核心指标表现',
    AUTHOR: '主讲人 / 课题组',
    AUTHOR_EN: 'PRESENTATION',
    DATE: '2026',
    PAGE_NUM: '03',
    SOURCE: '资料来源：项目调研与公开统计数据整理',
    FOOTER_NOTE: '内部交流与课程演示参考',
    THANK_YOU: '感谢聆听 · 欢迎交流',
    THANK_YOU_EN: 'THANK YOU',
    CLOSING_MESSAGE: '核心总结与下一步行动倡议',
    ENDING_SUBTITLE: '欢迎提问与讨论交流',
    CONTACT_INFO: '汇报团队 · 交流反馈',
    CONTACT_LINE: '联系与交流方式'
  };

  var PLACEHOLDER_PNG_RE = /data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk\+A8AAQUBAScY42YAAAAASUVORK5CYII=/g;
  var PLACEHOLDER_PICTURE_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#334155"/><stop offset="55%" stop-color="#475569"/>' +
    '<stop offset="100%" stop-color="#1e293b"/></linearGradient></defs>' +
    '<rect width="800" height="500" fill="url(#g)"/>' +
    '<circle cx="620" cy="140" r="56" fill="#94a3b8" fill-opacity="0.24"/>' +
    '<path d="M0 390 L210 250 L390 355 L560 220 L800 370 L800 500 L0 500 Z" fill="#64748b" fill-opacity="0.32"/>' +
    '<path d="M0 430 L170 330 L360 415 L610 295 L800 410 L800 500 L0 500 Z" fill="#0f172a" fill-opacity="0.45"/>' +
    '</svg>'
  );

  var svgScopeSeq = 0;
  var rosterCache = {};
  var svgTextCache = {};
  var activeModalKeyHandler = null;

  function closeModalListener() {
    if (activeModalKeyHandler) {
      document.removeEventListener('keydown', activeModalKeyHandler);
      activeModalKeyHandler = null;
    }
  }

  var activeTokenOverrides = {};

  function setOutlineTokenOverrides(sample, fallbackTitle) {
    var s = sample || {};
    var cBullets = s.content_bullets || [];
    activeTokenOverrides = {};
    if (s.cover_title || fallbackTitle) activeTokenOverrides.TITLE = s.cover_title || fallbackTitle;
    if (s.cover_sub) activeTokenOverrides.SUBTITLE = s.cover_sub;
    if (s.chapter_title) activeTokenOverrides.CHAPTER_TITLE = s.chapter_title;
    if (s.chapter_sub) {
      activeTokenOverrides.CHAPTER_SUBTITLE = s.chapter_sub;
      activeTokenOverrides.CHAPTER_DESC = s.chapter_sub;
    }
    if (s.content_title) activeTokenOverrides.PAGE_TITLE = s.content_title;
    if (cBullets[0]) { activeTokenOverrides.CARD_1 = cBullets[0]; activeTokenOverrides.BLOCK_1 = cBullets[0]; activeTokenOverrides.ITEM_1 = cBullets[0]; }
    if (cBullets[1]) { activeTokenOverrides.CARD_2 = cBullets[1]; activeTokenOverrides.BLOCK_2 = cBullets[1]; activeTokenOverrides.ITEM_2 = cBullets[1]; }
    if (cBullets[2]) { activeTokenOverrides.CARD_3 = cBullets[2]; activeTokenOverrides.BLOCK_3 = cBullets[2]; activeTokenOverrides.ITEM_3 = cBullets[2]; }
  }

  function sampleToken(name) {
    if (activeTokenOverrides[name]) return activeTokenOverrides[name];
    if (SLIDE_TOKENS[name]) return SLIDE_TOKENS[name];
    var text = String(name || '').toLowerCase().replace(/_/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function renderPreviewSvg(rawSource, imagesPrefix) {
    if (!rawSource) return '';
    svgScopeSeq += 1;
    var prefix = 'wbsvg-' + svgScopeSeq + '-';
    var svg = String(rawSource)
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');

    svg = svg.replace(PLACEHOLDER_PNG_RE, PLACEHOLDER_PICTURE_URI);
    svg = svg.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (_m, token) {
      return esc(sampleToken(token));
    });
    if (imagesPrefix) {
      svg = svg.replace(/\.\.\/images\//g, imagesPrefix + '/');
      svg = svg.replace(/(["'])images\//g, '$1' + imagesPrefix + '/');
    }

    var ids = {};
    svg = svg.replace(/\bid="([^"]+)"/g, function (_m, id) {
      ids[id] = prefix + id;
      return 'id="' + prefix + id + '"';
    });
    svg = svg.replace(/url\(#([^)]+)\)/g, function (full, id) {
      return ids[id] ? 'url(#' + ids[id] + ')' : full;
    });
    svg = svg.replace(/\b(xlink:href|href)="#([^"]+)"/g, function (full, attr, id) {
      return ids[id] ? attr + '="#' + ids[id] + '"' : full;
    });

    svg = svg.replace(/<svg\b([^>]*)>/i, function (_m, attrs) {
      var wMatch = attrs.match(/\bwidth="(\d+(?:\.\d+)?)"/i);
      var hMatch = attrs.match(/\bheight="(\d+(?:\.\d+)?)"/i);
      var cleaned = attrs
        .replace(/\s+\bwidth="[^"]*"/gi, '')
        .replace(/\s+\bheight="[^"]*"/gi, '');
      if (!/\bviewBox=/i.test(cleaned)) {
        var w = wMatch ? wMatch[1] : '1280';
        var h = hMatch ? hMatch[1] : '720';
        cleaned += ' viewBox="0 0 ' + w + ' ' + h + '"';
      }
      return '<svg' + cleaned + ' class="tpl-inline-svg">';
    });
    return svg;
  }

  function fetchRoster(slug, kind, id) {
    var cacheKey = slug + ':' + kind + ':' + id;
    if (rosterCache[cacheKey]) return rosterCache[cacheKey];
    var base = '/p/' + enc(slug) + '/confirm';
    var url = base + '/api/template-roster/' + enc(kind) + '/' + enc(id);
    rosterCache[cacheKey] = fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return null;
        data._base = base;
        return data;
      })
      .catch(function () { return null; });
    return rosterCache[cacheKey];
  }

  function fetchSvgText(url) {
    if (svgTextCache[url]) return svgTextCache[url];
    svgTextCache[url] = fetch(url)
      .then(function (r) { return r.ok ? r.text() : ''; })
      .catch(function () { return ''; });
    return svgTextCache[url];
  }

  function pickRepresentativeSlides(roster) {
    if (!roster || !roster.length) return [];
    var used = {};
    function take(regex, roleLabel) {
      for (var i = 0; i < roster.length; i++) {
        if (!used[i] && regex.test(roster[i].name)) {
          used[i] = true;
          return { page: roster[i], role: roleLabel };
        }
      }
      return null;
    }
    function takeFirstRemaining(roleLabel, avoidEnding) {
      for (var i = 0; i < roster.length; i++) {
        if (used[i]) continue;
        if (avoidEnding && /(ending|closing)/i.test(roster[i].name)) continue;
        used[i] = true;
        return { page: roster[i], role: roleLabel };
      }
      return null;
    }

    var picks = [];
    var cover = take(/(^|_)(cover|title_slide|hero_full)(\.svg|$)/i, '封面') ||
      takeFirstRemaining('封面', false);
    if (cover) picks.push(cover);

    var chapter = take(/(chapter|section_header|section_divider)/i, '章节') ||
      take(/(toc|agenda)/i, '目录') ||
      takeFirstRemaining('章节', true);
    if (chapter) picks.push(chapter);

    var content = take(/(three_card|three_block|triptych|04_content|split_bleed\.svg|kpi_dashboard|kpi_row|title_content)/i, '正文') ||
      takeFirstRemaining('正文', true) ||
      takeFirstRemaining('尾页', false);
    if (content) picks.push(content);

    return picks;
  }

  function slideRoleLabel(filename, index) {
    var stem = String(filename || '').replace(/\.svg$/i, '');
    var numMatch = stem.match(/^(\d+)/);
    var prefix = numMatch ? numMatch[1] + ' · ' : ((index + 1) + ' · ');
    var clean = stem.replace(/^\d+[_-]?/, '').toLowerCase();
    var map = {
      cover: '封面',
      title_slide: '封面',
      hero_full: '满版大图封面',
      hero_side_scrim: '侧边遮罩封面',
      toc: '目录',
      agenda: '目录议程',
      chapter: '章节过渡页',
      chapter_full: '满版章节页',
      section_header: '章节过渡页',
      section_divider: '章节分隔页',
      content: '通用正文页',
      title_content: '标题与正文',
      two_content: '双栏并列',
      comparison: '双栏对比',
      split_bleed: '左图右文排版',
      split_bleed_reverse: '左文右图排版',
      editorial_split: '画报分栏图文',
      stacked_split: '上下分栏排版',
      three_card: '三卡要点并列',
      three_block: '三栏模块并列',
      triptych: '三联图文画报',
      image_grid_four: '四宫格组图',
      content_caption: '图文对照说明',
      picture_caption: '大图配文字说明',
      title_picture: '标题与主视觉图',
      two_picture_caption: '双图对比说明',
      screenshot_focus: '界面/截图聚焦',
      hero_statement: '核心金句大字页',
      full_statement: '满版核心观点页',
      quote_over_image: '大图引语金句页',
      kpi_dashboard: '关键指标看板',
      kpi_grid: '指标网格看板',
      kpi_row: '横排数据指标',
      process_timeline: '流程与时间轴',
      data_story: '数据解读页',
      chart_insight: '图表洞察页',
      table_summary: '汇总表格页',
      matrix_2x2: '四象限矩阵',
      title_only: '纯标题自由页',
      blank: '空白画布页',
      appendix: '附录页',
      ending: '结束致谢页',
      closing: '结束致谢页',
      closing_full: '满版结束页'
    };
    return prefix + (map[clean] || clean.replace(/_/g, ' '));
  }

  function proposalFieldHtml(field, label, value, placeholder, rows) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<textarea data-contract="' + esc(field) + '" rows="' + (rows || 2) +
      '" placeholder="' + esc(placeholder || '') + '">' + esc(value) + '</textarea></label>';
  }

  function candidateMeta(item, metaMap) {
    var m = (metaMap && metaMap[item.key]) || {};
    return {
      title: m.title || item.label || item.id || item.key,
      desc: m.desc || item.summary || '',
      primaryColor: m.primary_color || null,
      canvasFormat: m.canvas_format || null,
      pageCount: m.page_count || null
    };
  }

  function groupExplicitCandidates(explicitList) {
    var byRoot = {};
    var order = [];
    (explicitList || []).forEach(function (item) {
      var root = item.workspace_root || item.key;
      if (!byRoot[root]) {
        byRoot[root] = {
          root: root,
          label: item.label || root,
          keys: [],
          kinds: []
        };
        order.push(byRoot[root]);
      }
      byRoot[root].keys.push(item.key);
      if (byRoot[root].kinds.indexOf(item.kind) < 0) {
        byRoot[root].kinds.push(item.kind);
      }
    });
    return order;
  }

  function sortedVisualStyles(recommendedId) {
    var raw = (optionsCache || {}).visual_styles || [];
    if (!recommendedId) return raw.slice();
    var rec = [];
    var rest = [];
    raw.forEach(function (item) {
      if (item.id === recommendedId) rec.push(item);
      else rest.push(item);
    });
    return rec.concat(rest);
  }

  function visualStyleCardHtml(styleItem, isRecommended, sampleCopy, fallbackTitle) {
    var renderer = window.WorkbenchStyleSlides;
    var slides = renderer
      ? renderer.buildSlides(styleItem.id, sampleCopy, fallbackTitle)
      : [];
    var swatch = renderer ? renderer.swatchOf(styleItem.id) : '#4F46E5';
    var trioHtml = slides.slice(0, 3).map(function (sl) {
      return '<div class="tpl-slide-slot">' +
        '<div class="tpl-slide-box">' + sl.svg + '</div>' +
        '<span>' + esc(sl.role) + '</span></div>';
    }).join('');
    var recBadge = isRecommended
      ? '<span class="tpl-badge is-free">★ AI 推荐</span>'
      : '';
    var groupBadge = '<span class="tpl-badge is-layout">' +
      '<i class="tpl-dot" style="background:' + esc(swatch) + '"></i>' +
      esc(styleItem.group || '自由画风') + '</span>';

    return '<div class="tpl-visual-card is-style-card" data-style-id="' + esc(styleItem.id) +
      '" data-style-group="' + esc(styleItem.group || '') + '" role="button" tabindex="0">' +
      '<div class="tpl-stage">' +
      '<div class="tpl-slides-trio">' + trioHtml + '</div>' +
      '</div>' +
      '<div class="tpl-card-body">' +
      '<div class="tpl-card-head">' +
      '<span class="tpl-radio" aria-hidden="true"></span>' +
      '<span class="tpl-title">' + esc(styleItem.label) + '</span>' +
      recBadge + groupBadge +
      '</div>' +
      (styleItem.description ? '<p class="tpl-summary">' + esc(styleItem.description) + '</p>' : '') +
      '<div class="tpl-card-foot">' +
      '<button type="button" class="tpl-zoom-btn" data-preview-style="' + esc(styleItem.id) + '">放大预览 4 类版面 ↗</button>' +
      '</div></div></div>';
  }

  function visualTemplateCardHtml(item, meta, canvasBadge) {
    var isDeck = item.kind === 'deck';
    var badgeHtml = isDeck
      ? '<span class="tpl-badge is-deck">' +
        (meta.primaryColor ? '<i class="tpl-dot" style="background:' + esc(meta.primaryColor) + '"></i>' : '') +
        '含配色与版面</span>'
      : '<span class="tpl-badge is-layout">通用版式 · 配色下一步选</span>';
    var countText = meta.pageCount ? ('查看全部 ' + meta.pageCount + ' 页') : '查看全部版面';
    var extraBadge = canvasBadge ? '<span class="tpl-badge is-canvas">' + esc(canvasBadge) + '</span>' : '';

    return '<div class="tpl-visual-card" data-visual-key="' + esc(item.key) +
      '" data-kind="' + esc(item.kind) + '"' +
      (item.id ? ' data-id="' + esc(item.id) + '"' : '') +
      ' role="button" tabindex="0">' +
      '<div class="tpl-stage">' +
      '<div class="tpl-slides-trio" data-trio>' +
      '<div class="tpl-slide-slot"><div class="tpl-slide-box is-loading"></div><span>封面</span></div>' +
      '<div class="tpl-slide-slot"><div class="tpl-slide-box is-loading"></div><span>章节</span></div>' +
      '<div class="tpl-slide-slot"><div class="tpl-slide-box is-loading"></div><span>正文</span></div>' +
      '</div>' +
      '</div>' +
      '<div class="tpl-card-body">' +
      '<div class="tpl-card-head">' +
      '<span class="tpl-radio" aria-hidden="true"></span>' +
      '<span class="tpl-title">' + esc(meta.title) + '</span>' +
      badgeHtml + extraBadge +
      '</div>' +
      (meta.desc ? '<p class="tpl-summary">' + esc(meta.desc) + '</p>' : '') +
      (item.id
        ? '<div class="tpl-card-foot"><button type="button" class="tpl-zoom-btn" data-preview-key="' +
          esc(item.key) + '">' + esc(countText) + ' ↗</button></div>'
        : '') +
      '</div></div>';
  }

  function explicitGroupCardHtml(group) {
    var kindNames = group.kinds.map(function (k) { return KIND_HUMAN[k] || k; }).join(' + ');
    return '<div class="tpl-visual-card" data-explicit-root="' + esc(group.root) +
      '" role="button" tabindex="0">' +
      '<div class="tpl-free-stage is-text-only">' +
      '<div class="tpl-free-side"><span class="tpl-stage-tag">项目指定模板</span>' +
      '<strong>' + esc(group.label) + '</strong>' +
      '<p>包含：' + esc(kindNames) + '（本地指定路径）</p></div></div>' +
      '<div class="tpl-card-body">' +
      '<div class="tpl-card-head">' +
      '<span class="tpl-radio" aria-hidden="true"></span>' +
      '<span class="tpl-title">' + esc(group.label) + '</span>' +
      '<span class="tpl-badge is-deck">指定模板</span>' +
      '</div>' +
      '<p class="tpl-summary">本次运行显式传入的模板目录，选中后将整套应用。</p>' +
      '</div></div>';
  }

  function advItemCardHtml(item, meta, extraTag) {
    var swatch = meta.primaryColor
      ? '<span class="adv-swatch" style="background:' + esc(meta.primaryColor) + '"></span>'
      : '';
    var subId = item.id && item.id !== meta.title && /^[a-z0-9-]+$/i.test(item.id)
      ? '<small class="adv-slug">' + esc(item.id) + '</small>'
      : '';
    var tag = extraTag ? '<span class="tpl-badge is-canvas">' + esc(extraTag) + '</span>' : '';
    var searchBlob = [meta.title, item.id || '', meta.desc || ''].join(' ').toLowerCase();

    return '<button type="button" class="adv-card" data-adv-key="' + esc(item.key) +
      '" data-kind="' + esc(item.kind) + '" data-search="' + esc(searchBlob) + '">' +
      '<span class="adv-card-top">' + swatch +
      '<span class="adv-name">' + esc(meta.title) + '</span>' + subId + tag +
      '<span class="adv-check" aria-hidden="true">✓</span></span>' +
      (meta.desc ? '<span class="adv-desc">' + esc(meta.desc) + '</span>' : '') +
      '</button>';
  }

  function templateSectionHtml(proposal, fallbackTitle) {
    var options = proposal.template_options || {};
    var metaMap = proposal.template_meta || {};
    var library = options.library || {};
    var taskCanvas = (proposal.constraints && proposal.constraints.canvas) || 'ppt169';
    var recStyleId = (proposal.preview && proposal.preview.visual_style) || '';
    var visualStyles = sortedVisualStyles(recStyleId);
    var sampleCopy = proposal.outline_preview || null;

    var explicitGroups = groupExplicitCandidates(options.explicit || []);
    var decks = library.deck || [];
    var allLayouts = library.layout || [];
    var matchedLayouts = [];
    var otherLayouts = [];
    allLayouts.forEach(function (item) {
      var m = candidateMeta(item, metaMap);
      if (!m.canvasFormat || m.canvasFormat === taskCanvas) matchedLayouts.push(item);
      else otherLayouts.push(item);
    });
    var brands = library.brand || [];
    var styles = library.style || [];

    var styleGroups = [];
    visualStyles.forEach(function (st) {
      if (st.group && styleGroups.indexOf(st.group) < 0) styleGroups.push(st.group);
    });
    var filterBarHtml = styleGroups.length
      ? '<div class="vs-filter-bar">' +
        '<button type="button" class="vs-filter-pill is-active" data-vs-group="">全部（' + visualStyles.length + '）</button>' +
        styleGroups.map(function (g) {
          var cnt = visualStyles.filter(function (x) { return x.group === g; }).length;
          return '<button type="button" class="vs-filter-pill" data-vs-group="' + esc(g) + '">' + esc(g) + '（' + cnt + '）</button>';
        }).join('') +
        '</div>'
      : '';

    var styleCardsHtml = visualStyles.map(function (st) {
      return visualStyleCardHtml(st, st.id === recStyleId, sampleCopy, fallbackTitle);
    }).join('');

    var fixedCards = [];
    explicitGroups.forEach(function (group) {
      fixedCards.push(explicitGroupCardHtml(group));
    });
    decks.forEach(function (item) {
      fixedCards.push(visualTemplateCardHtml(item, candidateMeta(item, metaMap), ''));
    });
    matchedLayouts.forEach(function (item) {
      fixedCards.push(visualTemplateCardHtml(item, candidateMeta(item, metaMap), ''));
    });

    var hasAdvanced = brands.length || styles.length || otherLayouts.length;
    var advHtml = '';
    if (hasAdvanced) {
      var tabs = [];
      if (brands.length) tabs.push(['brand', '主题色调（' + brands.length + '）']);
      if (styles.length) tabs.push(['style', '内容讲法（' + styles.length + '）']);
      if (otherLayouts.length) tabs.push(['other_layout', '其他画幅版式（' + otherLayouts.length + '）']);
      var firstTab = tabs[0][0];

      var tabButtons = tabs.map(function (t) {
        return '<button type="button" class="adv-tab' + (t[0] === firstTab ? ' is-active' : '') +
          '" data-adv-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
      }).join('');

      var brandPane = brands.length
        ? '<div class="adv-pane" data-adv-pane="brand"' + (firstTab === 'brand' ? '' : ' hidden') + '>' +
          '<p class="adv-pane-hint">只想要某家大厂或机构的标志性配色与字体气质？点选即可叠加（再次点击取消）。</p>' +
          '<div class="adv-grid">' + brands.map(function (item) {
            return advItemCardHtml(item, candidateMeta(item, metaMap), '');
          }).join('') + '</div></div>'
        : '';

      var stylePane = styles.length
        ? '<div class="adv-pane" data-adv-pane="style"' + (firstTab === 'style' ? '' : ' hidden') + '>' +
          '<p class="adv-pane-hint">指定整套课件的内容展开方式（如科普由浅入深、咨询结论先行、发布会场景引入）；不改变版面骨架，再次点击可取消。</p>' +
          '<div class="adv-grid">' + styles.map(function (item) {
            return advItemCardHtml(item, candidateMeta(item, metaMap), '');
          }).join('') + '</div></div>'
        : '';

      var otherLayoutPane = otherLayouts.length
        ? '<div class="adv-pane" data-adv-pane="other_layout"' + (firstTab === 'other_layout' ? '' : ' hidden') + '>' +
          '<p class="adv-pane-hint">以下版式与当前任务画幅不同，仅在确需跨画幅参考时选用。</p>' +
          '<div class="adv-grid">' + otherLayouts.map(function (item) {
            var m = candidateMeta(item, metaMap);
            var tag = m.canvasFormat === 'ppt43' ? '4:3 画幅' : (m.canvasFormat === 'ppt169' ? '16:9 画幅' : '');
            return advItemCardHtml(item, m, tag);
          }).join('') + '</div></div>'
        : '';

      advHtml = '<details class="adv-panel" id="adv-panel">' +
        '<summary><span>高级自定义：额外叠加机构色板或内容讲法（可选，默认无需展开）</span>' +
        '<span class="adv-count" id="adv-count-badge" hidden></span></summary>' +
        '<div class="adv-body">' +
        '<div class="adv-toolbar"><div class="adv-tabs">' + tabButtons + '</div>' +
        '<input type="text" class="adv-search" id="adv-search" placeholder="搜索色调或讲法…"></div>' +
        brandPane + stylePane + otherLayoutPane +
        '</div></details>';
    }

    return '<div class="tpl-block">' +
      '<div class="tpl-mode-switch" role="tablist" aria-label="风格模式">' +
      '<button type="button" class="tpl-mode-btn is-active" data-tpl-pane-btn="styles">' +
      '<strong>选画风 · AI 自由排版（' + visualStyles.length + ' 种）</strong>' +
      '<small>已代入你的大纲标题实时预览；AI 按每页内容自由构图并锁定该画风</small></button>' +
      '<button type="button" class="tpl-mode-btn" data-tpl-pane-btn="templates">' +
      '<strong>套固定母版 · 成品与通用版式（' + fixedCards.length + ' 套）</strong>' +
      '<small>严格复用模板里的固定封面、章节与内页插槽版面</small></button>' +
      '</div>' +
      '<div id="tpl-pane-styles">' +
      filterBarHtml +
      '<div class="tpl-gallery" id="vs-gallery">' + styleCardsHtml + '</div>' +
      '</div>' +
      '<div id="tpl-pane-templates" hidden>' +
      '<p class="card-hint tpl-pane-note">点选下方任意一套固定母版即可切换为模板模式（再次点击已选卡片可取消并回到 AI 自由画风）。</p>' +
      '<div class="tpl-gallery">' + fixedCards.join('') + '</div>' +
      '</div>' +
      '<div id="tpl-summary-slot"></div>' +
      advHtml +
      '<div id="tpl-modal-slot"></div>' +
      '</div>';
  }

  function loadVisualCardSlides(slot, slug) {
    Array.prototype.forEach.call(slot.querySelectorAll('.tpl-visual-card[data-id]'), function (card) {
      var trio = card.querySelector('[data-trio]');
      if (!trio || trio.getAttribute('data-loaded')) return;
      trio.setAttribute('data-loaded', '1');
      var kind = card.getAttribute('data-kind');
      var id = card.getAttribute('data-id');
      fetchRoster(slug, kind, id).then(function (data) {
        var pages = (data && data.roster) || [];
        if (!pages.length) {
          trio.innerHTML = '<div class="tpl-slide-empty">暂无页面缩略图</div>';
          return;
        }
        var picks = pickRepresentativeSlides(pages);
        var imagesPrefix = data._base + data.images_prefix;
        trio.innerHTML = picks.map(function (pick, idx) {
          return '<div class="tpl-slide-slot">' +
            '<div class="tpl-slide-box is-loading" data-slide-idx="' + idx + '"></div>' +
            '<span>' + esc(pick.role) + '</span></div>';
        }).join('');
        picks.forEach(function (pick, idx) {
          fetchSvgText(data._base + pick.page.url).then(function (svgText) {
            var box = trio.querySelector('[data-slide-idx="' + idx + '"]');
            if (!box) return;
            box.classList.remove('is-loading');
            if (svgText) {
              box.innerHTML = renderPreviewSvg(svgText, imagesPrefix);
            } else {
              box.classList.add('is-empty');
              box.textContent = '预览失败';
            }
          });
        });
      });
    });
  }

  function proposalHtml(task, proposal) {
    var c = proposal.contract || {};
    var cons = proposal.constraints || {};
    var opts = optionsCache || {};
    var outMeta = proposal.outline || {};
    var hasOutline = !!outMeta.exists;
    var canvasItem = (opts.canvas || []).filter(function (item) {
      return item.id === cons.canvas;
    })[0];
    var effectivePageCount = hasOutline && outMeta.slide_count
      ? (outMeta.slide_count + ' 页（按已定稿大纲）')
      : (cons.page_count == null ? '由 AI 决定' : cons.page_count + ' 页');
    var locked = [
      ['画幅', canvasItem ? canvasItem.label : (cons.canvas || '—')],
      ['页数', effectivePageCount],
      ['语言', optionLabel(opts.languages, cons.primary_language)]
    ].map(function (row) {
      return '<span class="locked"><em>' + esc(row[0]) + '</em>' + esc(row[1]) + '</span>';
    }).join('');

    var resolvedTitle = (hasOutline && outMeta.title) || proposal.title || task.display_title || task.topic || '';
    setOutlineTokenOverrides(proposal.outline_preview, resolvedTitle);

    if (hasOutline) {
      return '<div class="card card-proposal">' +
        '<div class="proposal-outline-bar">' +
        '<div class="proposal-outline-info">' +
        '<span class="proposal-outline-ok">✓ 第 1 步内容大纲已就绪</span>' +
        '<strong>《' + esc(resolvedTitle) + '》</strong>' +
        '<div class="proposal-outline-locks">' + locked + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-small" id="back-to-outline-btn">← 返回查看 / 修改大纲</button>' +
        '</div>' +
        '<input id="proposal-title" type="hidden" value="' + esc(resolvedTitle) + '">' +
        templateSectionHtml(proposal, resolvedTitle) +
        '<div class="actions proposal-submit-bar">' +
        '<button class="btn btn-primary" id="confirm-direct-btn" type="button">用这套风格直接生成 PPT →</button>' +
        '<button class="btn" id="confirm-tune-btn" type="button">下一步微调配色与字体</button>' +
        '</div>' +
        '<p class="proposal-submit-hint">直接生成将由 AI 自动应用匹配的配色与字体并开始逐页绘制；想自己挑选色板或更换字体可点「下一步微调配色与字体」。</p>' +
        '</div>';
    }

    return '<div class="card card-proposal">' +
      '<h2>选择模板风格与内容重点</h2>' +
      '<p class="card-hint">核对演示标题与受众重点、挑选一套顺眼的风格模板，确认后即可开始生成。</p>' +
      '<label class="field"><span>演示标题</span>' +
      '<input id="proposal-title" type="text" maxlength="200" value="' +
      esc(resolvedTitle) +
      '" placeholder="AI 会按材料起名，你可以随时改"></label>' +
      '<div class="locked-row">' + locked + '<span class="locked-note">新建任务时已设定</span></div>' +
      '<div class="field-row">' +
      proposalFieldHtml('audience', '给谁看（受众）', c.audience, '例如：中学生与公众听众 / 部门负责人', 3) +
      proposalFieldHtml('communication_intent', '要达成什么效果', c.communication_intent, '例如：讲清原理 / 汇报进展并对齐决策', 3) +
      '</div>' +
      proposalFieldHtml('core_message', '最想让人记住的一句话', c.core_message, '听完后希望对方带走的核心结论', 2) +
      '<details class="more-fields"><summary>展开更多内容设定（讲解场景、受众收获、原文取舍）</summary>' +
      '<div class="more-fields-body">' +
      proposalFieldHtml('audience_outcome', '期望听众看完后的变化', c.audience_outcome, '看完之后他们能复述、相信或决定什么', 2) +
      proposalFieldHtml('delivery_context', '演示场景', c.delivery_context, '现场投影主讲 / 会后独立阅读 / 录制视频', 2) +
      proposalFieldHtml('artifact_afterlife', '课后 / 会后用途', c.artifact_afterlife, '讲义留存 / 审批存档 / 项目交接', 2) +
      proposalFieldHtml('content_divergence', '材料组织自由度', c.content_divergence, '留空表示在现有材料内合理提炼重组', 2) +
      '</div></details>' +
      templateSectionHtml(proposal, resolvedTitle) +
      '<div class="actions proposal-submit-bar">' +
      '<button class="btn btn-primary" id="confirm-direct-btn" type="button">用这套风格直接生成 PPT →</button>' +
      '<button class="btn" id="confirm-tune-btn" type="button">下一步微调配色与字体</button>' +
      '</div>' +
      '</div>';
  }

  function wireProposal(task, proposal, slot, slug) {
    closeModalListener();
    if (slug) loadVisualCardSlides(slot, slug);

    var options = proposal.template_options || {};
    var metaMap = proposal.template_meta || {};
    var library = options.library || {};
    var explicitList = options.explicit || [];
    var explicitGroups = groupExplicitCandidates(explicitList);

    var allStyles = (optionsCache || {}).visual_styles || [];
    var styleMap = {};
    allStyles.forEach(function (s) { styleMap[s.id] = s; });
    var defaultStyleId = (proposal.preview && proposal.preview.visual_style && styleMap[proposal.preview.visual_style])
      ? proposal.preview.visual_style
      : ((allStyles[0] && allStyles[0].id) || 'soft-rounded');
    var selectedStyleId = (proposal.preferred_visual_style && styleMap[proposal.preferred_visual_style])
      ? proposal.preferred_visual_style
      : defaultStyleId;
    var outMeta = proposal.outline || {};
    var resolvedTitle = (outMeta.exists && outMeta.title) || proposal.title || task.display_title || task.topic || '';

    var byKey = {};
    ['brand', 'style', 'layout', 'deck'].forEach(function (kind) {
      (library[kind] || []).forEach(function (item) { byKey[item.key] = item; });
    });
    explicitList.forEach(function (item) { byKey[item.key] = item; });

    var explicitRootByKey = {};
    var explicitGroupMap = {};
    explicitGroups.forEach(function (group) {
      explicitGroupMap[group.root] = group;
      group.keys.forEach(function (k) { explicitRootByKey[k] = group.root; });
    });

    var selectedKeys = (options.preselected_keys || []).filter(function (k) {
      return !!byKey[k];
    });

    function hasFixedVisualPick() {
      return selectedKeys.some(function (k) {
        var it = byKey[k];
        return it && (it.kind === 'deck' || it.kind === 'layout' || it.source === 'explicit');
      });
    }

    function switchModePane(paneName) {
      var stylesPane = slot.querySelector('#tpl-pane-styles');
      var templatesPane = slot.querySelector('#tpl-pane-templates');
      if (stylesPane) stylesPane.hidden = paneName !== 'styles';
      if (templatesPane) templatesPane.hidden = paneName !== 'templates';
      Array.prototype.forEach.call(slot.querySelectorAll('[data-tpl-pane-btn]'), function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-tpl-pane-btn') === paneName);
      });
      if (paneName === 'templates' && slug) {
        loadVisualCardSlides(slot, slug);
      }
    }

    function removeKeyWithClosure(targetKey) {
      var root = explicitRootByKey[targetKey];
      if (root && explicitGroupMap[root]) {
        var groupKeys = explicitGroupMap[root].keys;
        selectedKeys = selectedKeys.filter(function (k) { return groupKeys.indexOf(k) < 0; });
      } else {
        selectedKeys = selectedKeys.filter(function (k) { return k !== targetKey; });
      }
    }

    function removeKinds(kindsToRemove) {
      var drop = {};
      kindsToRemove.forEach(function (k) { drop[k] = true; });
      selectedKeys.slice().forEach(function (k) {
        var item = byKey[k];
        if (item && drop[item.kind]) removeKeyWithClosure(k);
      });
    }

    function removeFixedVisualKeys() {
      selectedKeys.slice().forEach(function (k) {
        var it = byKey[k];
        if (it && (it.kind === 'deck' || it.kind === 'layout' || it.source === 'explicit')) {
          removeKeyWithClosure(k);
        }
      });
    }

    function selectFreeDesign() {
      selectedKeys = [];
      selectedStyleId = defaultStyleId;
      switchModePane('styles');
      syncSelectionUi();
    }

    function selectVisualStyle(styleId) {
      if (!styleMap[styleId]) return;
      selectedStyleId = styleId;
      removeFixedVisualKeys();
      switchModePane('styles');
      syncSelectionUi();
    }

    function toggleVisualKey(key, forceSelect) {
      var item = byKey[key];
      if (!item) return;
      var already = selectedKeys.indexOf(key) >= 0;
      if (already && !forceSelect) {
        removeKeyWithClosure(key);
      } else if (!already) {
        removeKinds(['deck', 'layout']);
        selectedKeys.slice().forEach(function (k) {
          var it = byKey[k];
          if (it && it.source === 'explicit') removeKeyWithClosure(k);
        });
        selectedKeys.push(key);
      }
      syncSelectionUi();
    }

    function toggleExplicitRoot(root) {
      var group = explicitGroupMap[root];
      if (!group) return;
      var allSelected = group.keys.every(function (k) { return selectedKeys.indexOf(k) >= 0; });
      if (allSelected) {
        removeKeyWithClosure(group.keys[0]);
      } else {
        var kinds = group.kinds.slice();
        if (kinds.indexOf('deck') >= 0 || kinds.indexOf('layout') >= 0) {
          if (kinds.indexOf('deck') < 0) kinds.push('deck');
          if (kinds.indexOf('layout') < 0) kinds.push('layout');
        }
        removeKinds(kinds);
        group.keys.forEach(function (k) {
          if (selectedKeys.indexOf(k) < 0) selectedKeys.push(k);
        });
      }
      syncSelectionUi();
    }

    function toggleAdvKey(key) {
      var item = byKey[key];
      if (!item) return;
      if (selectedKeys.indexOf(key) >= 0) {
        removeKeyWithClosure(key);
      } else {
        removeKinds([item.kind]);
        selectedKeys.push(key);
      }
      syncSelectionUi();
    }

    function itemDisplayTitle(item) {
      return candidateMeta(item, metaMap).title;
    }

    function renderSummaryBar() {
      var summarySlot = slot.querySelector('#tpl-summary-slot');
      var advBadge = slot.querySelector('#adv-count-badge');
      if (!summarySlot) return;

      var pickedItems = selectedKeys.map(function (k) { return byKey[k]; }).filter(Boolean);
      var byKind = {};
      pickedItems.forEach(function (it) { byKind[it.kind] = it; });

      var advCount = (byKind.brand && byKind.brand.source === 'library' ? 1 : 0) +
        (byKind.style && byKind.style.source === 'library' ? 1 : 0) +
        (byKind.layout && byKind.layout.source === 'library' &&
          !slot.querySelector('.tpl-visual-card[data-visual-key="' + byKind.layout.key + '"]') ? 1 : 0);
      if (advBadge) {
        if (advCount > 0) {
          advBadge.hidden = false;
          advBadge.textContent = '已叠加 ' + advCount + ' 项';
        } else {
          advBadge.hidden = true;
          advBadge.textContent = '';
        }
      }

      var fixedPick = hasFixedVisualPick();
      var chips = [];
      var handledRoots = {};

      if (!fixedPick) {
        var chosenSt = styleMap[selectedStyleId] || { id: selectedStyleId, label: selectedStyleId };
        var sw = window.WorkbenchStyleSlides ? window.WorkbenchStyleSlides.swatchOf(chosenSt.id) : '#4F46E5';
        chips.push('<span class="tpl-chip"><em>AI 自由画风</em>' +
          '<i class="tpl-dot" style="background:' + esc(sw) + '"></i>' +
          esc(chosenSt.label) + '</span>');
      }

      pickedItems.forEach(function (it) {
        if (it.source === 'explicit') {
          var r = explicitRootByKey[it.key];
          if (handledRoots[r]) return;
          handledRoots[r] = true;
          chips.push('<span class="tpl-chip"><em>指定模板</em>' + esc(it.label) +
            '<button type="button" data-remove-key="' + esc(it.key) + '" title="移除">×</button></span>');
          return;
        }
        chips.push('<span class="tpl-chip"><em>' + esc(KIND_HUMAN[it.kind] || it.kind) + '</em>' +
          esc(itemDisplayTitle(it)) +
          '<button type="button" data-remove-key="' + esc(it.key) + '" title="移除">×</button></span>');
      });

      var notices = [];
      if (!fixedPick) {
        var stObj = styleMap[selectedStyleId];
        notices.push('将不锁死固定插槽，由 AI 根据每页内容自由构图，并全程采用「' +
          (stObj ? stObj.label : selectedStyleId) + '」的版面审美、字体气质与配套色板。');
      } else {
        if (byKind.brand && byKind.deck) {
          notices.push('已叠加主题色调「' + itemDisplayTitle(byKind.brand) + '」，它将替换「' +
            itemDisplayTitle(byKind.deck) + '」原有的配色与字体。');
        } else {
          notices.push('将严格按所选固定母版的封面、章节与正文版面骨架生成。');
        }
      }

      var showReset = fixedPick || selectedStyleId !== defaultStyleId || pickedItems.length > 0;
      summarySlot.innerHTML = '<div class="tpl-summary-bar' + (fixedPick ? ' is-custom' : '') + '">' +
        '<div class="tpl-summary-row"><strong>当前已选：</strong>' +
        '<div class="tpl-chips">' + chips.join('') + '</div>' +
        (showReset
          ? '<button type="button" class="btn-link" id="reset-free-btn">' +
            (fixedPick ? '切回 AI 自由画风' : '恢复默认推荐画风') + '</button>'
          : '') +
        '</div>' +
        '<p class="tpl-summary-note">' + esc(notices.join(' ')) + '</p></div>';

      Array.prototype.forEach.call(summarySlot.querySelectorAll('[data-remove-key]'), function (btn) {
        btn.addEventListener('click', function () {
          removeKeyWithClosure(btn.getAttribute('data-remove-key'));
          if (!hasFixedVisualPick()) switchModePane('styles');
          syncSelectionUi();
        });
      });
      var resetBtn = summarySlot.querySelector('#reset-free-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', selectFreeDesign);
      }
    }

    function syncSelectionUi() {
      var fixedPick = hasFixedVisualPick();

      Array.prototype.forEach.call(slot.querySelectorAll('[data-style-id]'), function (card) {
        var sid = card.getAttribute('data-style-id');
        card.classList.toggle('is-picked', !fixedPick && sid === selectedStyleId);
      });

      Array.prototype.forEach.call(slot.querySelectorAll('[data-visual-key]'), function (card) {
        var key = card.getAttribute('data-visual-key');
        card.classList.toggle('is-picked', selectedKeys.indexOf(key) >= 0);
      });

      Array.prototype.forEach.call(slot.querySelectorAll('[data-explicit-root]'), function (card) {
        var root = card.getAttribute('data-explicit-root');
        var group = explicitGroupMap[root];
        var on = !!(group && group.keys.every(function (k) { return selectedKeys.indexOf(k) >= 0; }));
        card.classList.toggle('is-picked', on);
      });

      Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-key]'), function (card) {
        var key = card.getAttribute('data-adv-key');
        card.classList.toggle('is-picked', selectedKeys.indexOf(key) >= 0);
      });

      renderSummaryBar();
    }

    function openStylePreviewModal(styleId) {
      var st = styleMap[styleId];
      var modalSlot = slot.querySelector('#tpl-modal-slot');
      var renderer = window.WorkbenchStyleSlides;
      if (!st || !modalSlot || !renderer) return;

      function closeModal() {
        closeModalListener();
        modalSlot.innerHTML = '';
      }

      var slides = renderer.buildSlides(st.id, proposal.outline_preview || null, resolvedTitle);
      modalSlot.innerHTML = '<div class="tpl-modal-backdrop" id="tpl-modal-bg">' +
        '<div class="tpl-modal" role="dialog" aria-modal="true" aria-label="' + esc(st.label) + '">' +
        '<div class="tpl-modal-head">' +
        '<div><h3>' + esc(st.label) + ' · 画风实时预览</h3>' +
        '<p>' + esc(st.description || '已代入当前大纲内容展示封面、章节、正文与数据 4 类典型版面效果') + '</p></div>' +
        '<div class="tpl-modal-actions">' +
        '<button type="button" class="btn btn-primary" id="modal-pick-btn">选用「' + esc(st.label) + '」画风</button>' +
        '<button type="button" class="btn" id="modal-close-btn">关闭</button>' +
        '</div></div>' +
        '<div class="tpl-modal-body">' +
        '<div class="tpl-modal-pages is-two-col">' +
        slides.map(function (sl) {
          return '<figure class="tpl-modal-page">' +
            '<div class="tpl-modal-svg">' + sl.svg + '</div>' +
            '<figcaption>' + esc(sl.label) + '</figcaption></figure>';
        }).join('') +
        '</div></div></div></div>';

      modalSlot.querySelector('#modal-close-btn').addEventListener('click', closeModal);
      modalSlot.querySelector('#tpl-modal-bg').addEventListener('click', function (e) {
        if (e.target && e.target.id === 'tpl-modal-bg') closeModal();
      });
      modalSlot.querySelector('#modal-pick-btn').addEventListener('click', function () {
        selectVisualStyle(st.id);
        closeModal();
        toast('已选用「' + st.label + '」画风');
      });
      activeModalKeyHandler = function (e) {
        if (e.key === 'Escape') closeModal();
      };
      document.addEventListener('keydown', activeModalKeyHandler);
    }

    function openPreviewModal(key) {
      var item = byKey[key];
      var modalSlot = slot.querySelector('#tpl-modal-slot');
      if (!item || !item.id || !slug || !modalSlot) return;
      var meta = candidateMeta(item, metaMap);

      function closeModal() {
        closeModalListener();
        modalSlot.innerHTML = '';
      }

      modalSlot.innerHTML = '<div class="tpl-modal-backdrop" id="tpl-modal-bg">' +
        '<div class="tpl-modal" role="dialog" aria-modal="true" aria-label="' + esc(meta.title) + '">' +
        '<div class="tpl-modal-head">' +
        '<div><h3>' + esc(meta.title) + '</h3>' +
        '<p>' + esc(meta.desc || '包含封面、章节与多种正文排版版面') + '</p></div>' +
        '<div class="tpl-modal-actions">' +
        '<button type="button" class="btn btn-primary" id="modal-pick-btn">选用这套模板</button>' +
        '<button type="button" class="btn" id="modal-close-btn">关闭</button>' +
        '</div></div>' +
        '<div class="tpl-modal-body" id="tpl-modal-grid"><div class="loading">正在加载全部版面预览…</div></div>' +
        '</div></div>';

      modalSlot.querySelector('#modal-close-btn').addEventListener('click', closeModal);
      modalSlot.querySelector('#tpl-modal-bg').addEventListener('click', function (e) {
        if (e.target && e.target.id === 'tpl-modal-bg') closeModal();
      });
      modalSlot.querySelector('#modal-pick-btn').addEventListener('click', function () {
        toggleVisualKey(key, true);
        switchModePane('templates');
        closeModal();
        toast('已选用「' + meta.title + '」');
      });
      activeModalKeyHandler = function (e) {
        if (e.key === 'Escape') closeModal();
      };
      document.addEventListener('keydown', activeModalKeyHandler);

      fetchRoster(slug, item.kind, item.id).then(function (data) {
        var grid = modalSlot.querySelector('#tpl-modal-grid');
        if (!grid) return;
        var pages = (data && data.roster) || [];
        if (!pages.length) {
          grid.innerHTML = '<div class="empty">该模板没有可预览的页面原型。</div>';
          return;
        }
        var imagesPrefix = data._base + data.images_prefix;
        grid.innerHTML = '<div class="tpl-modal-pages">' + pages.map(function (page, idx) {
          return '<figure class="tpl-modal-page">' +
            '<div class="tpl-modal-svg is-loading" data-modal-idx="' + idx + '"></div>' +
            '<figcaption>' + esc(slideRoleLabel(page.name, idx)) + '</figcaption></figure>';
        }).join('') + '</div>';

        pages.forEach(function (page, idx) {
          fetchSvgText(data._base + page.url).then(function (svgText) {
            var holder = grid.querySelector('[data-modal-idx="' + idx + '"]');
            if (!holder) return;
            holder.classList.remove('is-loading');
            if (svgText) holder.innerHTML = renderPreviewSvg(svgText, imagesPrefix);
            else holder.textContent = '预览加载失败';
          });
        });
      });
    }

    Array.prototype.forEach.call(slot.querySelectorAll('[data-tpl-pane-btn]'), function (btn) {
      btn.addEventListener('click', function () {
        switchModePane(btn.getAttribute('data-tpl-pane-btn'));
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-vs-group]'), function (pill) {
      pill.addEventListener('click', function () {
        var grp = pill.getAttribute('data-vs-group');
        Array.prototype.forEach.call(slot.querySelectorAll('[data-vs-group]'), function (p) {
          p.classList.toggle('is-active', p === pill);
        });
        Array.prototype.forEach.call(slot.querySelectorAll('[data-style-id]'), function (card) {
          var cg = card.getAttribute('data-style-group') || '';
          card.hidden = !!(grp && cg !== grp);
        });
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-style-id]'), function (card) {
      var sid = card.getAttribute('data-style-id');
      card.addEventListener('click', function () { selectVisualStyle(sid); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectVisualStyle(sid); }
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-preview-style]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openStylePreviewModal(btn.getAttribute('data-preview-style'));
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-visual-key]'), function (card) {
      var key = card.getAttribute('data-visual-key');
      card.addEventListener('click', function () { toggleVisualKey(key, false); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVisualKey(key, false); }
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-explicit-root]'), function (card) {
      var root = card.getAttribute('data-explicit-root');
      card.addEventListener('click', function () { toggleExplicitRoot(root); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExplicitRoot(root); }
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-preview-key]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openPreviewModal(btn.getAttribute('data-preview-key'));
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-key]'), function (card) {
      card.addEventListener('click', function () {
        toggleAdvKey(card.getAttribute('data-adv-key'));
      });
    });

    Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-tab]'), function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        var target = tabBtn.getAttribute('data-adv-tab');
        Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-tab]'), function (b) {
          b.classList.toggle('is-active', b === tabBtn);
        });
        Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-pane]'), function (pane) {
          pane.hidden = pane.getAttribute('data-adv-pane') !== target;
        });
      });
    });

    var advSearch = slot.querySelector('#adv-search');
    if (advSearch) {
      advSearch.addEventListener('input', function () {
        var q = advSearch.value.trim().toLowerCase();
        Array.prototype.forEach.call(slot.querySelectorAll('[data-adv-key]'), function (card) {
          var hay = card.getAttribute('data-search') || '';
          card.hidden = !!(q && hay.indexOf(q) < 0);
        });
      });
    }

    switchModePane(hasFixedVisualPick() ? 'templates' : 'styles');
    syncSelectionUi();

    var backOutlineBtn = slot.querySelector('#back-to-outline-btn');
    if (backOutlineBtn) {
      backOutlineBtn.addEventListener('click', function () {
        switchJourneyStep(task, 'outline');
      });
    }

    var directBtn = slot.querySelector('#confirm-direct-btn');
    var tuneBtn = slot.querySelector('#confirm-tune-btn');

    function submitProposalChoice(skipStage2) {
      var contract = {};
      var baseContract = proposal.contract || {};
      Object.keys(baseContract).forEach(function (k) { contract[k] = baseContract[k] || ''; });
      Array.prototype.forEach.call(slot.querySelectorAll('[data-contract]'), function (node) {
        contract[node.getAttribute('data-contract')] = node.value.trim();
      });
      var keys = selectedKeys.slice();
      var mode = keys.length ? 'templates' : 'free_design';
      var titleNode = slot.querySelector('#proposal-title');
      var fixedPick = hasFixedVisualPick();
      if (directBtn) directBtn.disabled = true;
      if (tuneBtn) tuneBtn.disabled = true;
      api('POST', '/api/tasks/' + enc(task.task_id) + '/confirm', {
        contract: contract,
        display_title: titleNode ? titleNode.value.trim() : '',
        template_mode: mode,
        selection_keys: keys,
        options_sha256: (proposal.template_options || {}).options_sha256,
        skip_stage2_review: !!skipStage2,
        preferred_visual_style: fixedPick ? null : selectedStyleId
      }).then(function () {
        toast(skipStage2
          ? '已选定风格，等待 AI 生成 PPT…'
          : '已选定风格，等待 AI 准备配色与字体细案…');
        closeModalListener();
        proposalTaskId = null;
        lastSignature = '';
        renderOverview(task);
      }).catch(function (error) {
        if (directBtn) directBtn.disabled = false;
        if (tuneBtn) tuneBtn.disabled = false;
        toast('确认失败：' + error.message, true);
      });
    }

    if (directBtn) {
      directBtn.addEventListener('click', function () { submitProposalChoice(true); });
    }
    if (tuneBtn) {
      tuneBtn.addEventListener('click', function () { submitProposalChoice(false); });
    }
  }

  function renderProposal(task, slot, slug) {
    slot.innerHTML = '<div class="card"><div class="loading">正在读取模板与风格方案…</div></div>';
    api('GET', '/api/tasks/' + enc(task.task_id) + '/proposal').then(function (proposal) {
      if (!proposal.available) {
        if (proposal.stage1_confirmed) {
          proposalTaskId = 'confirmed:' + task.task_id;
          var allStyles = (optionsCache || {}).visual_styles || [];
          var pickedSt = allStyles.filter(function (s) { return s.id === proposal.preferred_visual_style; })[0];
          var styleNote = pickedSt ? ('（已选画风：「' + pickedSt.label + '」）') : '';
          slot.innerHTML = '<div class="card"><h2>✓ 模板与视觉风格已确认' + esc(styleNote) + '</h2>' +
            '<p class="card-hint">' +
            (proposal.delegate_stage2
              ? '你已选择直接生成 PPT，等待 AI 按已定稿大纲与所选风格绘制幻灯片。如果想换一种画风或改选其他模板，可随时重新挑选。'
              : '已保存风格选择，等待 AI 生成配色与字体细案供你微调。如果想换一种画风或模板，可点击下方重新挑选。') +
            '</p>' +
            '<div class="actions">' +
            '<button type="button" class="btn btn-primary" id="reopen-proposal-btn">重新选择画风与模板</button>' +
            '<button type="button" class="btn" id="wait-back-outline">← 返回查看大纲</button>' +
            '</div></div>';
          var reopenBtn = slot.querySelector('#reopen-proposal-btn');
          if (reopenBtn) {
            reopenBtn.addEventListener('click', function () {
              reopenBtn.disabled = true;
              api('POST', '/api/tasks/' + enc(task.task_id) + '/proposal/reopen', {}).then(function () {
                proposalTaskId = null;
                renderProposal(task, slot, slug);
              }).catch(function (err) {
                reopenBtn.disabled = false;
                toast('重置失败：' + err.message, true);
              });
            });
          }
          var backBtn1 = slot.querySelector('#wait-back-outline');
          if (backBtn1) {
            backBtn1.addEventListener('click', function () { switchJourneyStep(task, 'outline'); });
          }
          return;
        }

        proposalTaskId = 'unavailable:' + task.task_id;
        slot.innerHTML = '<div class="card"><h2>AI 正在准备候选模板与视觉风格…</h2>' +
          '<p class="card-hint">大纲已就绪，正在结合你的主题与画幅整理候选模板，请稍候几秒（页面会自动刷新）。</p>' +
          '<div class="actions"><button type="button" class="btn btn-small" id="wait-back-outline">← 返回查看大纲</button></div></div>';
        var backBtn = slot.querySelector('#wait-back-outline');
        if (backBtn) {
          backBtn.addEventListener('click', function () { switchJourneyStep(task, 'outline'); });
        }
        return;
      }
      proposalTaskId = 'ready:' + task.task_id;
      slot.innerHTML = proposalHtml(task, proposal);
      wireProposal(task, proposal, slot, slug);
    }).catch(function (error) {
      proposalTaskId = null;
      slot.innerHTML = '<div class="card"><h2>模板方案读取失败</h2><p class="hint">' +
        esc(error.message) + '</p></div>';
    });
  }

  // The Stage-2 plan is the AI's proposal, not a verdict: it opens in the
  // native confirmation view right here so colours, typography, template
  // application, page count and image strategy stay the user's to change.
  function renderPlanReview(task, slot, slug) {
    teardownPlanView();
    slot.innerHTML = '<div id="plan-native-host"></div>';
    var host = slot.querySelector('#plan-native-host');
    if (!host || !window.WorkbenchConfirmView) return;
    activePlanCtrl = window.WorkbenchConfirmView.mount(host, {
      slug: slug,
      taskId: task.task_id,
      mode: 'inline',
      onBackToOutline: function () { switchJourneyStep(task, 'outline'); },
      onConfirmed: function () {
        toast('已确认最终方案，等待 AI 生成 PPT…');
        teardownPlanView();
        proposalTaskId = null;
        lastSignature = '';
        renderOverview(task);
      }
    });
  }

  function syncProposalSlot(task, progress, visible) {
    var slot = $('#proposal-slot');
    if (!slot) return;
    slot.hidden = !visible;
    if (!visible) {
      teardownPlanView();
      if (proposalTaskId && proposalTaskId.indexOf('plan:') === 0) {
        proposalTaskId = null;
      }
      return;
    }
    var runtime = progress.runtime || {};
    var slug = runtime.slug;
    var plan = progress.plan || {};
    if (!(plan.review_due && slug)) {
      teardownPlanView();
    }
    if (plan.review_due && slug) {
      if (proposalTaskId === 'plan:' + task.task_id) return;
      teardownPlanView();
      proposalTaskId = 'plan:' + task.task_id;
      renderPlanReview(task, slot, slug);
    } else if (runtime.stage === 'template_install') {
      if (proposalTaskId === 'install:' + task.task_id) return;
      proposalTaskId = 'install:' + task.task_id;
      slot.innerHTML = '<div class="card"><h2>正在装入所选模板…</h2>' +
        '<p class="card-hint">已确认模板选择，AI 正在把模板装入项目并生成设计规格。</p></div>';
    } else if (
      proposalTaskId === 'direct_wait:' + task.task_id ||
      proposalTaskId === 'tune_wait:' + task.task_id
    ) {
      return;
    } else {
      if (proposalTaskId === 'ready:' + task.task_id) return;
      if (proposalTaskId === 'confirmed:' + task.task_id) return;
      if (proposalTaskId === 'fetching:' + task.task_id) return;
      proposalTaskId = 'fetching:' + task.task_id;
      renderProposal(task, slot, slug);
    }
  }

  // ---------- focus mode ----------

  function renderFocusBody(slug, kind, backHref) {
    if (kind === 'spec') {
      return '<div class="card"><h2>规格评审页已下线</h2>' +
        '<p class="hint">工作台已统一至轻量设计确认与页面预览流程，旧版规格评审页面已停用。</p>' +
        '<div class="actions"><a class="btn" href="' + esc(backHref) + '">返回上一页</a></div></div>';
    }
    if (!slug) {
      return '<div class="card"><h2>还没有项目</h2><p class="hint">AI 接管任务后，这里会打开对应页面。</p></div>';
    }
    if (kind === 'preview') {
      return '<div class="focus-native-host is-preview" id="focus-native-host"></div>';
    }
    if (kind === 'confirm') {
      return '<div class="focus-native-host is-confirm" id="focus-native-host"></div>';
    }
    return '<div class="card"><h2>未知工具视图</h2>' +
      '<p class="hint">当前工作台仅支持页面预览（preview）与阶段确认（confirm）。</p>' +
      '<div class="actions"><a class="btn" href="' + esc(backHref) + '">返回上一页</a></div></div>';
  }

  function mountFocusHost(slug, kind, hashPrefix, backHref, query, taskId) {
    var host = document.getElementById('focus-native-host');
    if (!host) return;
    if (kind === 'preview' && window.WorkbenchSlidePreview) {
      if (workspace) workspace.classList.add('is-focus');
      activeFocusCtrl = window.WorkbenchSlidePreview.mount(host, {
        slug: slug,
        initialSlide: (query && query.get('slide')) || null,
        onSlideChange: function (name) {
          var nextHash = hashPrefix + '/preview?slide=' + enc(name);
          if (location.hash !== nextHash && history.replaceState) {
            history.replaceState(null, '', nextHash);
          }
        }
      });
    } else if (kind === 'confirm' && window.WorkbenchConfirmView) {
      activeFocusCtrl = window.WorkbenchConfirmView.mount(host, {
        slug: slug,
        taskId: taskId || null,
        mode: 'standalone',
        onConfirmed: taskId ? function () {
          toast('已确认最终方案');
          location.hash = backHref;
        } : null
      });
    }
  }

  function renderFocus(task, kind, query) {
    teardownActiveViews();
    stopPoll();
    var toolItem = TOOLS.filter(function (item) { return item[0] === kind; })[0];
    var label = toolItem ? toolItem[1] : (kind === 'spec' ? '规格评审' : kind);
    var title = task.display_title || task.topic || task.task_id;
    var slug = (task.runtime || {}).slug;
    var backHref = '#/task/' + enc(task.task_id);

    workspace.innerHTML =
      '<div class="focus-bar"><a href="' + esc(backHref) + '">← ' + esc(title) + '</a>' +
      '<span class="focus-title">' + esc(label) + '</span></div>' +
      renderFocusBody(slug, kind, backHref);

    if (slug) {
      mountFocusHost(slug, kind, backHref, backHref, query, task.task_id);
    }
  }

  function renderProjectFocus(slug, kind, query) {
    teardownActiveViews();
    stopPoll();
    refreshRail('');
    var viewKind = kind || 'preview';
    var toolItem = TOOLS.filter(function (item) { return item[0] === viewKind; })[0];
    var label = toolItem ? toolItem[1] : (viewKind === 'spec' ? '规格评审' : viewKind);
    var backHref = '#/new';
    var hashPrefix = '#/project/' + enc(slug);

    workspace.innerHTML =
      '<div class="focus-bar"><a href="' + esc(backHref) + '">← 工作台首页</a>' +
      '<span class="focus-title">' + esc(slug + ' · ' + label) + '</span></div>' +
      renderFocusBody(slug, viewKind, backHref);

    mountFocusHost(slug, viewKind, hashPrefix, backHref, query, null);
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
    var outline = progress.outline || {};
    if (task.status === 'submitted') return '等待 AI 接管';
    if (task.status === 'done') return '全部页面已交付';
    if (task.status === 'failed') return '生成失败';
    if (task.status === 'interrupted') return 'AI 已停止，等待接续';
    if (runtime.blocking) return '等待你的回答';
    if (outline.status === 'revising') return 'AI 正在按批注修订大纲';
    if (outline.exists && outline.status === 'ready') return '等待你核对内容大纲';
    if (runtime.stage === 'confirm_stage1') return '等待你选择模板与视觉风格';
    if (runtime.progress && runtime.progress.total) {
      return '正在生成幻灯片 · ' + runtime.progress.done + '/' + runtime.progress.total + ' 页';
    }
    if (runtime.stage) return '正在进行 · ' + (STAGE_LABELS[runtime.stage] || runtime.stage);
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

  function slidesLiveGridHtml(task, slides) {
    if (!slides || !slides.length) return '';
    return '<div class="card">' +
      '<div class="slides-card-head">' +
      '<div><h2>已生成页面预览（' + slides.length + ' 页）</h2>' +
      '<p class="card-hint">点击右上角可打开独立大图预览与演讲备注。</p></div>' +
      '<a class="btn btn-small" href="#/task/' + enc(task.task_id) + '/preview">打开全屏预览 ↗</a>' +
      '</div>' +
      '<div class="slides-live-grid">' +
      slides.map(function (slide, idx) {
        var label = 'P' + (idx + 1 < 10 ? '0' + (idx + 1) : (idx + 1));
        var src = '/api/tasks/' + enc(task.task_id) + '/slides/' + enc(slide.name) + '?v=' + (slide.mtime || 0);
        return '<a class="slide-live-item" href="#/task/' + enc(task.task_id) + '/preview?slide=' + enc(slide.name) + '" title="' + esc(slide.name) + '">' +
          '<div class="slide-live-frame"><img src="' + esc(src) + '" alt="' + esc(slide.name) + '" loading="lazy"></div>' +
          '<span>' + esc(label) + ' · ' + esc(slide.name.replace(/\.svg$/i, '')) + '</span></a>';
      }).join('') +
      '</div></div>';
  }

  function syncJourneyView(task, progress, quiet) {
    var activeStep = currentJourneyStep(task, progress);
    renderJourneyBar(task, progress, activeStep);
    syncOutlineSlot(task, progress, activeStep === 'outline');
    syncProposalSlot(task, progress, activeStep === 'theme');

    var runtime = progress.runtime || {};
    var outline = progress.outline || {};
    var plan = progress.plan || {};
    var waitingOnUserStep = (outline.exists && outline.status === 'ready') ||
      runtime.stage === 'confirm_stage1' ||
      !!plan.review_due;

    var headStatus = $('.page-head .status');
    if (headStatus) {
      if (progress.status === 'interrupted' && waitingOnUserStep) {
        headStatus.className = 'status status-processing';
        headStatus.textContent = outline.exists && outline.status !== 'confirmed' ? '待确认大纲' : '待选模板';
      } else {
        headStatus.className = 'status status-' + progress.status;
        headStatus.textContent = STATUS_LABELS[progress.status] || progress.status;
      }
    }

    var pane = $('#pane');
    if (!pane) return;

    var requests = openRequests(progress);
    var exports = progress.exports || [];
    var slides = progress.slides || [];

    var html = '';

    if (requests.length) {
      html += requests.map(function (item) { return requestHtml(item.request); }).join('');
    }

    if (activeStep === 'slides') {
      html += '<div class="card"><div class="state-line">' + esc(stateLine(task, progress)) + '</div>' +
        '<p class="card-hint">' + esc(stageCaption(runtime, progress.status)) + '</p>' +
        progressBar(runtime, progress.status) +
        (runtime.error ? '<p class="empty">' + esc(runtime.error.message || '') + '</p>' : '') +
        '</div>';

      if (exports.length) {
        html += '<div class="card"><h2>PPTX 交付文件</h2><ul class="list">' +
          exports.map(function (file) {
            return '<li><span class="grow">' + esc(file.name) + '</span>' +
              '<span class="time">' + esc(fmtSize(file.size)) + '</span>' +
              '<a class="btn btn-small btn-primary" href="/api/tasks/' + enc(task.task_id) +
              '/exports/' + enc(file.name) + '" download>下载 PPTX</a></li>';
          }).join('') + '</ul></div>';
      }

      if (slides.length) {
        html += slidesLiveGridHtml(task, slides);
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
    }

    pane.hidden = !html;
    pane.innerHTML = html;
    if (html) wireOverview(task, quiet);
  }

  function renderOverview(task, quiet) {
    api('GET', '/api/tasks/' + enc(task.task_id) + '/progress').then(function (progress) {
      setConn(false);
      lastProgressCache = progress;
      var signature = JSON.stringify([
        progress.status,
        (progress.runtime || {}).stage,
        (progress.runtime || {}).updated_at,
        progress.outline || null,
        progress.plan || null,
        (progress.slides || []).length,
        (progress.requests || []).map(function (item) {
          return [item.request.id, item.response ? item.response.status : null];
        }),
        (progress.exports || []).length,
        (progress.events || []).length
      ]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      syncJourneyView(task, progress, quiet);
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
    var qIdx = raw.indexOf('?');
    var pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    var qsPart = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
    var query = new URLSearchParams(qsPart);
    var parts = pathPart.split('/').filter(Boolean);
    if (parts[0] === 'task' && parts[1]) {
      return {
        taskId: decodeURIComponent(parts[1]),
        projectSlug: null,
        focus: parts[2] ? decodeURIComponent(parts[2]) : '',
        query: query
      };
    }
    if (parts[0] === 'project' && parts[1]) {
      return {
        taskId: null,
        projectSlug: decodeURIComponent(parts[1]),
        focus: parts[2] ? decodeURIComponent(parts[2]) : '',
        query: query
      };
    }
    return { taskId: null, projectSlug: null, focus: '', query: query };
  }

  function route() {
    teardownActiveViews();
    stopPoll();
    closeModalListener();
    closeOutlineBubble();
    var parsed = parseHash();
    if (parsed.taskId) loadTask(parsed.taskId, parsed.focus, parsed.query);
    else if (parsed.projectSlug) renderProjectFocus(parsed.projectSlug, parsed.focus, parsed.query);
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

