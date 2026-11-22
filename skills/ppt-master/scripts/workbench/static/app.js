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
  var ATTENTION_LABELS = {example: '待你补选示例', outline: '待你确认大纲', template: '待你选择模板', plan: '待你确认方案', answer: '待你回答'};

  var STEPS = [
    ['init', '初始化'], ['source', '素材'], ['outline', '大纲'],
    ['template_prep', '模板'], ['confirm_stage1', '风格'],
    ['template_install', '装入模板'], ['spec', '逐页版式设计'], ['spec_review', '检查设计方案'], ['lock', '整理绘制方案'],
    ['images', '配图'], ['image', '配图'], ['execute', '绘制页面'], ['finalize', '检查页面'],
    ['export', '导出'], ['done', '完成']
  ];

  var JOURNEY_STEPS = [
    ['outline', '1', '确认内容大纲', '逐页核对或批注修改'],
    ['slides', '2', '生成幻灯片', '逐页绘制并导出 PPTX']
  ];

  var SLIDE_EXEC_STAGES = {
    spec: true, spec_review: true, lock: true, images: true, image: true, execute: true,
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

  var workspace = document.getElementById('workspace');
  var optionsCache = null;
  var pollTimer = null;
  var lastSignature = '';
  var activeStepState = { taskId: null, step: null, lastNatural: null };
  var outlineSession = null;
  var outlineBubbleEl = null;
  var outlineDocClickBound = false;
  var commentSeq = 0;
  var activeFocusCtrl = null;

  function teardownFocusView() {
    if (activeFocusCtrl && typeof activeFocusCtrl.destroy === 'function') {
      try { activeFocusCtrl.destroy(); } catch (_) {}
    }
    activeFocusCtrl = null;
    if (workspace) workspace.classList.remove('is-focus');
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

  function railItem(task, activeId) {
    var title = task.display_title || task.topic || task.task_id;
    var meta = ATTENTION_LABELS[task.attention] || (task.status === 'draft' ? '待配置' : '');
    return '<a class="rail-item' + (task.task_id === activeId ? ' is-active' : '') +
      '" href="#/task/' + enc(task.task_id) + '">' +
      '<span class="rail-title"><i class="dot dot-' + esc(task.status) + '"></i>' +
      esc(title) + '</span>' +
      (meta ? '<span class="rail-meta' + (task.attention ? ' needs-action' : '') + '">' + esc(meta) + '</span>' : '') +
      '</a>';
  }

  var lastRailHtml = null;
  var railRequest = 0;
  function refreshRail() {
    var requestId = ++railRequest;
    return api('GET', '/api/tasks').then(function (data) {
      if (requestId !== railRequest) return;
      setConn(false);
      var list = $('#rail-list');
      if (!list) return;
      var count = $('#rail-count');
      if (count) count.textContent = data.tasks.length ? String(data.tasks.length) : '';
      var activeId = parseHash().taskId;
      var html = data.tasks.length
        ? data.tasks.map(function (task) { return railItem(task, activeId); }).join('')
        : '<div class="rail-empty">还没有任务</div>';
      if (html !== lastRailHtml) list.innerHTML = html;
      lastRailHtml = html;
    }).catch(function () {
      if (requestId !== railRequest) return;
      lastRailHtml = null;
      setConn(true);
      var list = $('#rail-list');
      if (list) list.innerHTML = '<div class="rail-empty">任务列表加载失败</div>';
    });
  }

  // ---------- task form: #/new and a draft share one renderer ----------


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
        image_policy: 'ai'
      },
      uploads_present: []
    };
  }

  function formHtml(model) {
    return '<div class="card brief"><h2>你的内容</h2><p>已选示例 · ' + esc(model.example.title) + '</p>' +
      '<label class="field"><span>主题或制作要求</span><textarea id="f-topic" rows="4" placeholder="例如：中国高铁发展史">' +
      esc(model.topic || '') + '</textarea></label><div class="field"><span>参考材料</span>' +
      '<ul class="list" id="upload-list">' + uploadRows(model.uploads_present || []) + '</ul>' +
      '<button class="btn" id="upload-btn" type="button">上传文件</button><input id="f-files" type="file" multiple hidden></div>' +
      '<button class="btn btn-primary" id="submit-btn" type="button">生成大纲</button></div>';
  }

  function formValues(model) {
    return {topic: $('#f-topic').value.trim(), example_id: model.example.id};
  }

  function createTaskFromForm(model) {
    return api('POST', '/api/tasks', formValues(model)).then(function (data) {
      model.task_id = data.task_id;
      return data.task_id;
    });
  }

  function wireUploads(model) {
    var pane = $('#pane');

    function refreshUploads(taskId) {
      return api('GET', '/api/tasks/' + enc(taskId)).then(function (task) {
        var list = pane.querySelector('#upload-list');
        if (list) list.innerHTML = uploadRows(task.uploads_present || []);
        wireDeletes(taskId);
      });
    }

    function wireDeletes(taskId) {
      Array.prototype.forEach.call(pane.querySelectorAll('[data-del-upload]'), function (button) {
        button.addEventListener('click', function () {
          api('DELETE', '/api/tasks/' + enc(taskId) + '/uploads/' +
            enc(button.getAttribute('data-del-upload')))
            .then(function () { return refreshUploads(taskId); })
            .catch(function (error) { toast('删除失败：' + error.message, true); });
        });
      });
    }

    $('#upload-btn').addEventListener('click', function () { $('#f-files').click(); });
    $('#f-files').addEventListener('change', function (event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      if (!files.length) return;
      var submitButton = $('#submit-btn');
      var uploadButton = $('#upload-btn');
      submitButton.disabled = uploadButton.disabled = true;
      var ready = model.task_id ? Promise.resolve(model.task_id) : createTaskFromForm(model);
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
        toast('上传失败：' + error.message, true);
      }).finally(function () {
        submitButton.disabled = uploadButton.disabled = false;
      });
    });

    var taskId = model.task_id;
    if (taskId) wireDeletes(taskId);
  }

  function wireSubmit(model) {
    var submit = $('#submit-btn');

    function persist() {
      var values = formValues(model);
      if (!values.topic && !model.task_id) { toast('请填写主题或上传材料', true); return; }
      submit.disabled = true;
      var ready = model.task_id
        ? Promise.resolve(model.task_id)
        : createTaskFromForm(model);
      ready.then(function (taskId) {
        return api('PATCH', '/api/tasks/' + enc(taskId), values).then(function () {
          return api('POST', '/api/tasks/' + enc(taskId) + '/submit').then(function () {
            toast('已提交，交给 AI 处理');
            location.hash = '#/task/' + enc(taskId);
          });
        });
      }).catch(function (error) {
        submit.disabled = false;
        if (error) toast('提交失败：' + error.message, true);
      });
    }

    submit.addEventListener('click', persist);
  }

  function exampleImage(example, page) {
    return '/static/examples/' + enc(example.id) + '/' + String(page).padStart(2, '0') + '.webp';
  }

  function wireResumeExample(taskId, exampleId) {
    var button = $('#resume-example');
    button.onclick = async function () {
      button.disabled = true;
      try {
        await api('POST', '/api/tasks/' + enc(taskId) + '/resume-with-example', {example_id: exampleId});
        var home = '#/task/' + enc(taskId);
        if (location.hash === home) loadTask(taskId);
        else location.hash = home;
      } catch (error) {
        button.disabled = false;
        toast(error.message, true);
      }
    };
  }

  async function renderExamples(exampleId, compose, requestedPage, draftId, resumeId) {
    refreshRail();
    var hash = location.hash;
    var context = resumeId ? 'resume=' + enc(resumeId) : (draftId ? 'draft=' + enc(draftId) : '');
    var draftQuery = context ? '?' + context : '';
    workspace.innerHTML = '<p class="loading">正在读取示例…</p>';
    try {
      var items = (await api('GET', '/api/examples')).examples;
      if (location.hash !== hash) return;
      if (!exampleId) {
        var categories = {business:'商业', technology:'科技', education:'科普与教育', data:'数据',
          culture:'文化', design:'艺术与设计'};
        workspace.innerHTML = (resumeId ? '<h1>补选精选示例</h1><p>选定后将按已确认的大纲继续生成。</p>' : '<h1>精选示例</h1>') +
          '<div class="example-filters">' +
          '<input type="search" id="example-search" aria-label="搜索示例" placeholder="搜索示例">' +
          '<select id="example-category" aria-label="示例分类"><option value="">全部分类</option>' +
          Object.entries(categories).map(function (pair) {
            return '<option value="' + pair[0] + '">' + pair[1] + '</option>';
          }).join('') + '</select></div><div class="example-gallery"></div>';
        function filterExamples() {
          var term = $('#example-search').value.trim().toLowerCase();
          var category = $('#example-category').value;
          var matches = items.filter(function (e) {
            return (!category || category === e.category) &&
              [e.title, e.id, categories[e.category]].join(' ').toLowerCase().includes(term);
          });
          $('.example-gallery').innerHTML = matches.map(function (e) {
            return '<a class="example-card" href="#/example/' + enc(e.id) + draftQuery + '">' +
              '<img class="example-contact" loading="lazy" decoding="async" alt="" src="/static/examples/' +
              enc(e.id) + '/gallery.webp"><div class="example-caption"><h2>' + esc(e.title) + '</h2><span>' +
              e.pages.length + ' 页 · 查看完整示例 →</span></div></a>';
          }).join('') || '<p>没有找到匹配的示例。</p>';
        }
        $('#example-search').oninput = filterExamples;
        $('#example-category').onchange = filterExamples;
        filterExamples();
        return;
      }
      var example = items.find(function (e) { return e.id === exampleId; });
      if (!example) throw new Error('示例不存在');
      var prefix = '#/example/' + enc(example.id);
      if (compose && !resumeId) {
        workspace.innerHTML = '<a href="' + prefix + draftQuery + '">← 返回示例</a><h1>做同款</h1><div id="pane"></div>';
        var model = draftId ? await api('GET', '/api/tasks/' + enc(draftId)) : draftModel();
        if (location.hash !== hash) return;
        model.example = example;
        renderForm($('#pane'), model);
        return;
      }
      var page = Math.max(1, Math.min(example.pages.length, parseInt(requestedPage, 10) || 1));
      var backHref = '#/new' + draftQuery;
      workspace.classList.add('is-focus');
      workspace.innerHTML = '<div class="focus-bar"><a href="' + backHref + '">← 精选示例</a>' +
        '<a href="' + esc(example.source) + '" target="_blank" rel="noopener noreferrer">查看官网原例 ↗</a></div>' +
        '<div class="page-head example-reader-head"><h1>' + esc(example.title) + '</h1>' +
        (resumeId ? '<button class="btn btn-primary" id="resume-example">选用此示例并继续生成</button>' :
          '<a class="btn btn-primary" href="' + prefix + '/make' + draftQuery + '">做同款</a>') + '</div>' +
        '<div class="focus-native-host is-preview" id="focus-native-host"></div>';
      if (resumeId) wireResumeExample(resumeId, exampleId);
      activeFocusCtrl = mountSlideReader($('#focus-native-host'), {
        selected: page, backHref: backHref,
        pages: example.pages.map(function (title, index) {
          return {name: index + 1, number: index + 1, title: title, image: exampleImage(example, index + 1)};
        }),
        imageUrl: function (slide) { return slide.image; },
        pageHash: function (slide) { return prefix + '?page=' + slide.number + (context ? '&' + context : ''); }
      });
    } catch (error) {
      if (location.hash === hash) workspace.innerHTML = '<p>' + esc(error.message) + '</p><a href="#/new">返回精选示例</a>';
    }
  }

  // ---------- task page ----------

  var lastProgressCache = null;

  function loadTask(taskId, focus, query) {
    teardownFocusView();
    lastSignature = '';
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
      refreshRail();
      if (focus === 'confirm' && (task.example_id || task.attention === 'example')) {
        location.replace('#/task/' + enc(taskId));
        return;
      }
      if (focus && (focus === 'preview' || (!task.example_id && focus === 'confirm'))) renderFocus(task, focus, query);
      else renderTaskHome(task);
    }).catch(function (error) {
      setConn(true);
      workspace.innerHTML = '<div class="card"><h2>加载失败</h2><p class="hint">' +
        esc(error.message) + '</p><a class="btn" href="#/new">新建任务</a></div>';
    });
  }

  function headerHtml(task) {
    var title = task.display_title || task.topic || task.task_id;
    var ex = (optionsCache && optionsCache.examples || []).find(function (item) { return item.id === task.example_id; });
    var sub = ex ? ['所选示例 · ' + ex.title] : [];
    return '<div class="page-head"><div><h1 id="task-head-title">' + esc(title) + '</h1>' +
      '<div class="page-sub">' + esc(sub.join(' · ')) + '</div></div>' +
      (task.attention ? '<span class="status status-attention">' + esc(ATTENTION_LABELS[task.attention]) + '</span>' :
        statusBadge(task.status === 'submitted' && task.assignment && task.assignment.phase === 'accepted'
          ? 'processing' : task.status)) + '</div>';
  }

  function renderTaskHome(task) {
    if (task.attention === 'example') {
      workspace.innerHTML = headerHtml(task) + '<div class="card"><h2>为这份大纲补选示例</h2>' +
        '<p>大纲已确认，选定示例后即可继续生成。</p><a class="btn btn-primary" href="#/new?resume=' +
        enc(task.task_id) + '">选择精选示例</a></div>';
      return;
    }
    if (task.example_chosen_after_outline && task.status === 'interrupted' && !task.assignment) {
      workspace.innerHTML = headerHtml(task) + '<div class="card"><p>示例已选定，继续使用已确认的大纲。</p>' +
        '<button class="btn btn-primary" id="resume-example">继续生成</button></div>';
      wireResumeExample(task.task_id, task.example_id);
      return;
    }
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
      '<div id="pane"><div class="loading">加载中…</div></div>';

    renderOverview(task);
    poll(2, function () { renderOverview(task, true); });
  }


  // Offer connection or recovery when automatic dispatch has no available worker.
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

    if (assignment && assignment.phase === 'accepted') {
      return '<h2>Codex 已接单</h2><p class="card-hint">后台正在准备生成项目，进度会在这里自动更新。</p>';
    }
    if (assignment && assignment.phase === 'stopped') return dispatchStoppedHtml(assignment);
    if (assignment) {
      return head +
        '<div class="assigned">已分派给 <b>' + esc(assignment.name || assignment.agent_id) +
        '</b>，等待它接手…</div>' +
        '<p class="card-hint">接手后页面会自动切到进度视图。分派只在几分钟内有效，过期可重新分派。</p>' +
        '<div class="actions"><button class="btn" id="cancel-dispatch" type="button">撤销分派</button></div>';
    }

    if (!online.length) {
      return '<h2>连接 AI 工具</h2>' +
        '<p class="card-hint">把下面的命令发给已打开本项目的 AI。连接后，就可以把任务分派给它。</p>' +
        '<div class="attach-command"><pre class="hint-text" id="attach-command">uv run python skills/ppt-master/scripts/workbench_agent.py attach</pre>' +
        '<button type="button" class="btn" id="copy-attach" aria-label="复制连接命令" title="复制连接命令">' +
        '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
        '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></div>' +
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

  function dispatchStoppedHtml(assignment) {
    return '<h2>后台执行已停止</h2><p class="card-hint">任务尚未完成。' +
      (assignment.exit_code ? 'Codex 退出码：' + esc(String(assignment.exit_code)) + '。' : '') +
      '</p><button type="button" class="btn btn-primary" id="retry-dispatch">重新接单</button>';
  }

  function wireDispatchRetry(task) {
    var retry = $('#retry-dispatch');
    if (!retry) return;
    retry.onclick = async function () {
      retry.disabled = true;
      try {
        await api('POST', '/api/tasks/' + enc(task.task_id) + '/assign', {agent_id: 'codex-local', retry: true});
        loadTask(task.task_id);
      } catch (error) {
        retry.disabled = false;
        toast(error.message, true);
      }
    };
  }

  function wireTakeover(task) {
    wireDispatchRetry(task);
    var copy = $('#copy-attach');
    if (copy) {
      copy.addEventListener('click', async function () {
        var command = $('#attach-command');
        try {
          await navigator.clipboard.writeText(command.textContent);
          toast('连接命令已复制');
        } catch (_) {
          var range = document.createRange();
          range.selectNodeContents(command);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          toast('命令已选中，请手动复制');
        }
      });
    }
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
    var slides = (progress && progress.slides) || [];
    var exports = (progress && progress.exports) || [];
    return progress.status === 'done' || exports.length || slides.length ||
      outline.status === 'confirmed' || SLIDE_EXEC_STAGES[runtime.stage] ? 'slides' : 'outline';
  }

  function unlockedJourneySteps(progress, natural) {
    return {outline: true, slides: natural === 'slides'};
  }

  function completedJourneySteps(progress, natural) {
    return {outline: natural === 'slides', slides: progress.status === 'done'};
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
    closeOutlineBubble();
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
          sub = outline.slide_count + ' 页大纲' + ({ready: '已就绪', confirmed: '已定稿', revising: '修订中'}[outline.status] || '');
        } else if (key === 'slides' && (progress.slides || []).length > 0) {
          sub = slideCountLabel(progress);
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
      (isRevising ? ' disabled' : '') + '>确认大纲，开始制作</button>' +
      '<p class="ol-side-foot">定稿后按所选示例制作，可逐页查看进度。</p>' +
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
      refreshRail();
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
      refreshRail();
      paintOutlineDom(slot, task, session);
      toast('大纲已确认，开始制作');
      activeStepState.step = 'slides';
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
        '<span>大纲已确认，可查看幻灯片制作进度。</span></div>' +
        '<button type="button" class="btn btn-small btn-primary" id="ol-goto-progress-btn">查看制作进度 →</button></div>';
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

    var gotoProgress = slot.querySelector('#ol-goto-progress-btn');
    if (gotoProgress) {
      gotoProgress.addEventListener('click', function () {
        switchJourneyStep(task, 'slides');
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
        slot.innerHTML = '<div class="card ol-waiting-card">' +
          '<h2>正在整理内容大纲</h2><p class="card-hint">可以先离开此页，大纲就绪后，左侧任务会标出「待你确认大纲」。</p>' +
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
      paintOutlineDom(slot, task, outlineSession);
    }).catch(function (error) {
      slot.innerHTML = '<div class="card"><h2>大纲读取失败</h2><p class="hint">' +
        esc(error.message) + '</p></div>';
    });
  }

  // ---------- proposal: Stage 1 inline confirmation ----------

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

  function loadViewScript(name) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = '/static/' + name + '.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function mountFocusHost(slug, kind, hashPrefix, backHref, query, taskId) {
    var host = document.getElementById('focus-native-host');
    if (!host) return;
    if (kind === 'preview') {
      if (workspace) workspace.classList.add('is-focus');
      if (!query || query.get('mode') !== 'edit') {
        activeFocusCtrl = mountPowerPointPreview(host, slug, hashPrefix, query && query.get('slide'), backHref);
        return;
      }
      if (!window.WorkbenchSlidePreview) await loadViewScript('slide_preview');
      if (!host.isConnected) return;
      var returnLink = document.createElement('a');
      returnLink.className = 'btn btn-small';
      returnLink.textContent = '返回 PowerPoint 预览';
      returnLink.href = hashPrefix + '/preview?slide=' + enc(query.get('slide') || '');
      host.previousElementSibling.appendChild(returnLink);
      activeFocusCtrl = window.WorkbenchSlidePreview.mount(host, {
        slug: slug,
        initialSlide: (query && query.get('slide')) || null,
        onSlideChange: function (name) {
          returnLink.href = hashPrefix + '/preview?slide=' + enc(name);
          var nextHash = returnLink.hash + '&mode=edit';
          if (location.hash !== nextHash && history.replaceState) {
            history.replaceState(null, '', nextHash);
          }
        }
      });
    } else if (kind === 'confirm') {
      if (!window.WorkbenchConfirmView) {
        await loadViewScript('style_slides');
        await loadViewScript('stage2_confirm');
      }
      if (!host.isConnected) return;
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
    teardownFocusView();
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
    teardownFocusView();
    stopPoll();
    refreshRail();
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
    task.example = task.example || (optionsCache && optionsCache.examples || []).find(function (e) { return e.id === task.example_id; });
    if (!task.example) {
      pane.innerHTML = '<a class="btn" href="#/new?draft=' + enc(task.task_id) + '">为这份草稿选示例</a>';
      return;
    }
    pane.innerHTML = formHtml(task);
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

  function slideTotal(progress) {
    var reported = (progress.runtime || {}).progress || {};
    var total = (progress.outline || {}).slide_count || (reported.unit === 'page' ? reported.total : 0);
    return total >= progress.slides.length ? total : 0;
  }

  function slideCountLabel(progress) {
    var total = slideTotal(progress);
    return '已生成 ' + progress.slides.length + (total ? ' / ' + total : '') + ' 页';
  }

  function stateLine(progress) {
    var runtime = progress.runtime || {};
    var outline = progress.outline || {};
    if (ATTENTION_LABELS[progress.attention]) return ATTENTION_LABELS[progress.attention];
    if (progress.status === 'done') return '全部页面已交付';
    if (progress.status === 'failed') return '生成失败';
    if (progress.assignment && progress.assignment.phase === 'stopped') return '后台执行已停止';
    if (progress.status === 'interrupted') return '等待后台更新进度';
    if (outline.status === 'revising') return 'AI 正在按批注修订大纲';
    if (runtime.stage === 'export') return (progress.slides.length ? progress.slides.length + ' 页已生成，' : '') + '正在导出 PPTX';
    if (runtime.stage === 'finalize') return '正在检查已生成的页面';
    if (runtime.stage === 'spec') return '正在规划每一页的版式';
    if (runtime.stage === 'spec_review') return '正在检查逐页设计方案';
    if (runtime.stage === 'lock') return '正在整理页面绘制方案';
    if (runtime.stage === 'images' || runtime.stage === 'image') {
      var images = progress.image_progress || {};
      if (images.total == null) return '正在整理配图清单';
      if (!images.total) return '本次无需配图';
      return '配图已完成 ' + images.ready.length + ' / ' + images.total + ' 张';
    }
    if (runtime.stage === 'execute' && !progress.slides.length) return '正在绘制第一页';
    if (progress.slides.length || runtime.stage === 'execute') return slideCountLabel(progress);
    if (naturalJourneyStep(progress) === 'outline') return '正在整理内容大纲';
    if (runtime.stage) return '正在进行 · ' + (STAGE_LABELS[runtime.stage] || runtime.stage);
    return '正在生成';
  }

  function progressBar(progress) {
    var runtime = progress.runtime || {};
    var status = progress.status;
    if (status !== 'processing' || progress.attention || runtime.stage !== 'execute' ||
        !progress.slides.length || (progress.assignment && progress.assignment.phase === 'stopped')) return '';
    var total = slideTotal(progress);
    if (!total) return '';
    var done = progress.slides.length;
    var percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    return '<div class="bar" role="progressbar" aria-valuenow="' + done +
      '" aria-valuemin="0" aria-valuemax="' + total + '"><span style="width:' + percent +
      '%"></span></div>';
  }

  function imageGalleryHtml(task, images) {
    if (!images || !images.ready.length) return '';
    return '<div class="image-gallery">' + images.ready.map(function (item) {
      var src = '/api/tasks/' + enc(task.task_id) + '/images/' + item.name.split('/').map(enc).join('/') +
        '?v=' + enc(item.version);
      return '<figure><img src="' + esc(src) + '" alt="' + esc(item.label) + '" loading="lazy">' +
        '<figcaption>' + esc(item.label) + '</figcaption></figure>';
    }).join('') + '</div>';
  }

  function imageActivityHtml(progress) {
    var images = progress.image_progress || {total: null, ready: [], failed: 0, manual: 0};
    var done = images.ready.length;
    var known = images.total != null;
    var notices = [];
    if (images.failed) notices.push(images.failed + ' 张生成失败');
    if (images.manual) notices.push(images.manual + ' 张待手动补图');
    var active = progress.status === 'processing' && !progress.attention &&
      !(progress.assignment && progress.assignment.phase === 'stopped');
    var html = '';
    if (active && (!known || done + images.failed + images.manual < images.total)) {
      var percent = known ? Math.floor(100 * done / images.total) : null;
      html = '<div class="image-activity" role="progressbar" aria-label="配图完成进度"' +
        (known ? ' aria-valuemin="0" aria-valuemax="' + images.total + '" aria-valuenow="' + done + '"' : '') +
        '><div class="image-dots" aria-hidden="true"></div>' +
        (known ? '<span aria-hidden="true" class="image-percent">' + percent + '%</span>' : '') + '</div>';
    } else if (!active && known && images.total) {
      notices.unshift('配图已完成 ' + done + ' / ' + images.total + ' 张');
    }
    return html + (notices.length ? '<p class="card-hint">' + esc(notices.join(' · ')) + '</p>' : '');
  }

  function pageImageUrl(slug, page, small) {
    var image = small ? page.image.replace(/\.webp$/, '-sm.webp') : page.image;
    return '/api/projects/' + enc(slug) + '/page-previews/' + image;
  }

  function mountPowerPointPreview(host, slug, hashPrefix, selected, backHref) {
    return mountSlideReader(host, {
      selected: selected, backHref: backHref,
      loadView: function () { return api('GET', '/api/projects/' + enc(slug) + '/page-previews'); },
      imageUrl: function (page, small) { return pageImageUrl(slug, page, small); },
      pageHash: function (page) { return hashPrefix + '/preview?slide=' + enc(page.name); }
    });
  }

  function mountSlideReader(host, options) {
    var selected = options.selected;
    host.classList.add('ppt-reader');
    host.innerHTML = '<aside class="ppt-filmstrip"><div class="ppt-strip-head"><span data-count>幻灯片</span>' +
      '<button type="button" class="btn btn-small ppt-icon" aria-controls="ppt-thumbnails" data-toggle>' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="3"/><path d="M8 3v14"/></svg></button></div>' +
      '<nav id="ppt-thumbnails" aria-label="幻灯片缩略图"></nav></aside>' +
      '<div class="ppt-stage"><img data-final alt="" hidden><p role="status">正在载入预览…</p></div>';
    var list = host.querySelector('nav'), image = host.querySelector('[data-final]');
    var toggle = host.querySelector('[data-toggle]'), count = host.querySelector('[data-count]');
    var status = host.querySelector('[role=status]');
    var view = {pages: []}, signature, timer, closed = false, active = -1;
    function setCollapsed(collapsed) {
      host.classList.toggle('is-collapsed', collapsed);
      toggle.title = collapsed ? '展开缩略图' : '收起缩略图';
      toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      if (!collapsed && list.children[active]) list.children[active].scrollIntoView({block:'nearest', inline:'nearest'});
    }
    setCollapsed(false);
    toggle.onclick = function () { setCollapsed(!host.classList.contains('is-collapsed')); };
    list.onclick = function (event) {
      var button = event.target.closest('[data-index]');
      if (button) {
        show(Number(button.dataset.index));
      }
    };
    image.onload = function () {
      host.style.setProperty('--slide-ratio', image.naturalWidth / image.naturalHeight);
    };
    function show(index) {
      active = index;
      var page = view.pages[index];
      if (page) {
        var previous = list.querySelector('[aria-current]');
        if (previous) previous.removeAttribute('aria-current');
        var button = list.children[index];
        button.setAttribute('aria-current', 'page');
        if (list.contains(document.activeElement)) button.focus({preventScroll:true});
        button.scrollIntoView({block:'nearest', inline:'nearest'});
        selected = page.name;
        history.replaceState(null, '', options.pageHash(page));
      }
      image.hidden = !page || !page.image;
      if (!image.hidden) {
        var src = options.imageUrl(page, false);
        if (image.getAttribute('src') !== src) image.src = src;
        image.alt = page.title || '第 ' + page.number + ' 页';
      } else {
        image.removeAttribute('src');
      }
      status.textContent = (page && page.error) || view.message ||
        (!page ? '等待生成第一页' : !page.image ? '正在用 PowerPoint 渲染本页…' : '');
      status.hidden = !status.textContent;
    }
    async function refresh() {
      try {
        var result = options.loadView ? await options.loadView() : {pages: options.pages};
        if (closed) return;
        var current = JSON.stringify(result);
        if (current !== signature) {
          view = result;
          signature = current;
          var hadFocus = list.contains(document.activeElement);
          count.textContent = '共 ' + view.pages.length + ' 页';
          list.innerHTML = view.pages.map(function (page, index) {
            var thumb = page.image ? '<img src="' + esc(options.imageUrl(page, true)) +
              '" alt="" loading="lazy">' : '<span class="ppt-pending">待渲染</span>';
            return '<button type="button" class="ppt-thumb" data-index="' + index + '" aria-label="第 ' +
              page.number + ' 页' + (page.title ? ' · ' + esc(page.title) : '') + '" title="' +
              esc(page.title || ('第 ' + page.number + ' 页')) + '"><span>' + page.number + '</span>' + thumb + '</button>';
          }).join('');
          show(Math.max(0, view.pages.findIndex(function (page) { return page.name === selected; })));
          if (hadFocus && list.children[active]) list.children[active].focus({preventScroll:true});
        }
      } catch (error) {
        if (!closed) { signature = null; status.hidden = false; status.textContent = '无法加载预览，正在重试。'; }
      } finally {
        if (!closed && options.loadView) timer = window.setTimeout(refresh, 2000);
      }
    }
    var stage = host.querySelector('.ppt-stage');
    var wheelDirection = 0, wheelDistance = 0, lastWheelAt = 0, wheelTurned = false;
    function onWheel(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !view.pages.length) return;
      var mode = event.deltaMode, delta = event.deltaY;
      if (!delta || Math.abs(delta) < Math.abs(event.deltaX)) return;
      event.preventDefault();

      var direction = Math.sign(delta);
      // Pixel-mode devices can emit a long tail of momentum events for one gesture.
      if (mode !== WheelEvent.DOM_DELTA_PIXEL || direction !== wheelDirection || event.timeStamp - lastWheelAt > 120) {
        wheelDistance = 0;
        wheelTurned = false;
      }
      wheelDirection = direction;
      lastWheelAt = event.timeStamp;
      wheelDistance += Math.abs(delta);
      if (wheelTurned || (mode === WheelEvent.DOM_DELTA_PIXEL && wheelDistance < 24)) return;
      wheelTurned = true;
      var index = active + direction;
      if (index >= 0 && index < view.pages.length) show(index);
    }
    stage.addEventListener('wheel', onWheel, {passive:false});
    function onKey(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target !== document.body && !host.contains(event.target)) return;
      if (event.key === 'Escape') { location.hash = options.backHref; return; }
      if (!view.pages.length) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') show(Math.max(0, active - 1));
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') show(Math.min(view.pages.length - 1, active + 1));
      else if (event.key === 'Home') show(0);
      else if (event.key === 'End') show(view.pages.length - 1);
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    refresh();
    return {destroy: function () {
      closed = true;
      window.clearTimeout(timer);
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    }};
  }

  function slidesLiveGridHtml(task, slug, view) {
    if (!view || (!view.pages.length && !view.message)) return '';
    return '<div class="card">' +
      '<div class="slides-card-head">' +
      '<div><h2>页面预览</h2><p class="card-hint">' +
      esc(view.message || (view.source === 'final' ? '最终 PPTX 预览' : '制作中 · PowerPoint 预览')) + '</p></div>' +
      '<div class="ppt-page-tools">' +
      '<a class="btn btn-small" href="#/task/' + enc(task.task_id) + '/preview">打开全屏预览</a></div>' +
      '</div>' +
      '<div class="slides-live-grid">' +
      view.pages.map(function (slide) {
        var label = '第 ' + slide.number + ' 页';
        var frame = slide.image ? '<img src="' + esc(pageImageUrl(slug, slide, true)) +
          '" alt="' + label + '" loading="lazy">' : '<span>' + esc(slide.error || '等待 PowerPoint 渲染') + '</span>';
        return '<a class="slide-live-item" href="#/task/' + enc(task.task_id) + '/preview?slide=' + enc(slide.name) + '" title="' + esc(slide.name) + '">' +
          '<div class="slide-live-frame">' + frame + '</div>' +
          '<span>' + esc(label) + ' · ' + esc(slide.name.replace(/\.svg$/i, '')) + '</span></a>';
      }).join('') +
      '</div></div>';
  }

  function syncJourneyView(task, progress, quiet) {
    var activeStep = currentJourneyStep(task, progress);
    renderJourneyBar(task, progress, activeStep);
    syncOutlineSlot(task, progress, activeStep === 'outline');

    var runtime = progress.runtime || {};
    var headStatus = $('.page-head .status');
    if (headStatus) {
      headStatus.className = 'status status-' + (progress.attention ? 'attention' : progress.status);
      headStatus.textContent = stateLine(progress);
    }

    var pane = $('#pane');
    if (!pane) return;

    var requests = openRequests(progress);
    var exports = progress.exports || [];
    var html = '';

    if (progress.assignment && progress.assignment.phase === 'stopped' && progress.status !== 'done') {
      html += '<div class="card">' + dispatchStoppedHtml(progress.assignment) + '</div>';
    }
    if (!task.example_id && (progress.attention === 'template' || progress.attention === 'plan')) {
      html += '<a class="btn" href="#/task/' + enc(task.task_id) + '/confirm">继续此历史任务的确认</a>';
    }
    if (requests.length) {
      html += requests.map(function (item) { return requestHtml(item.request); }).join('');
    }

    if (activeStep === 'slides') {
      var imageStage = runtime.stage === 'images' || runtime.stage === 'image';
      var gallery = imageGalleryHtml(task, progress.image_progress);
      html += '<div class="card"><div class="state-line">' + esc(stateLine(progress)) + '</div>' +
        '<p class="card-hint">' + esc(stageCaption(progress)) + '</p>' +
        (imageStage ? imageActivityHtml(progress) + gallery : '') +
        progressBar(progress) +
        (runtime.error ? '<p class="empty">' + esc(runtime.error.message || '') + '</p>' : '') +
        '</div>';

      if (exports.length) {
        html += '<div class="card"><h2>PPTX 交付文件</h2><ul class="list">' +
          exports.map(function (file) {
            return '<li><span class="grow">' + esc(file.name) + '</span>' +
              '<span class="time">' + esc(fmtSize(file.size)) + '</span>' +
              '<button type="button" class="btn btn-small" data-export-action="open" data-file="' +
              esc(file.name) + '">直接打开</button>' +
              '<button type="button" class="btn btn-small btn-primary" data-export-action="save-as" data-file="' +
              esc(file.name) + '">另存为</button></li>';
          }).join('') + '</ul></div>';
      }

      html += slidesLiveGridHtml(task, runtime.slug, progress.page_preview);
      if (!imageStage && gallery) {
        var images = progress.image_progress;
        html += '<div class="card"><h2>配图 · 已完成 ' + images.ready.length + ' / ' + images.total +
          ' 张</h2>' + gallery + '</div>';
      }

    }

    pane.hidden = !html;
    pane.innerHTML = html;
    wireDispatchRetry(task);
    if (html) wireOverview(task, quiet);
  }

  function renderOverview(task, quiet) {
    api('GET', '/api/tasks/' + enc(task.task_id) + '/progress?preview=1').then(function (progress) {
      setConn(false);
      lastProgressCache = progress;
      var signature = JSON.stringify([
        progress.status,
        progress.attention,
        progress.assignment || null,
        (progress.runtime || {}).stage,
        (progress.runtime || {}).updated_at,
        progress.outline || null,
        progress.plan || null,
        progress.image_progress || null,
        progress.page_preview || null,
        progress.slides,
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

  function stageCaption(progress) {
    var runtime = progress.runtime || {};
    if (progress.status === 'done') return '可另存为或直接打开 PPTX，也可以逐页预览。';
    if (progress.status === 'failed' || progress.status === 'interrupted' ||
        (progress.assignment && progress.assignment.phase === 'stopped')) {
      var updated = new Date(runtime.updated_at || '');
      var time = Number.isNaN(updated.getTime()) ? '' : updated.toLocaleTimeString('zh-CN', {hour12: false}) + ' ';
      var alive = progress.status === 'interrupted' && progress.assignment &&
        progress.assignment.agent_id === 'codex-local' && progress.assignment.phase === 'accepted';
      return (alive ? '后台进程仍在运行。' : '') +
        (runtime.stage ? time + '上次上报的步骤：' + (STAGE_LABELS[runtime.stage] || runtime.stage) : '');
    }
    if (progress.attention) return '';
    if (runtime.stage === 'spec') {
      var count = progress.outline && progress.outline.status === 'confirmed' && progress.outline.slide_count;
      return (count ? '根据已确认的 ' + count + ' 页大纲' : '根据大纲') +
        '安排标题、正文和视觉重点。第一页绘制完成后会自动出现预览。';
    }
    if (runtime.stage === 'images' || runtime.stage === 'image') return '配图就绪后开始绘制幻灯片。';
    if (runtime.stage === 'lock' || runtime.stage === 'spec_review') return '正在核对各页内容与版式，准备绘制。';
    if (runtime.stage === 'execute') return '每完成一页，这里就会显示该页预览。';
    if (runtime.stage) return '当前阶段：' + (STAGE_LABELS[runtime.stage] || runtime.stage);
    return '等待 AI 接管';
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

  async function saveExport(url, name) {
    if (typeof window.showSaveFilePicker === 'function') {
      var handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{description: 'PowerPoint 演示文稿', accept: {
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
          }}]
        });
      } catch (error) {
        if (error.name === 'AbortError') return false;
        if (error.name !== 'SecurityError') throw error;
      }
      if (handle) {
        var response = await fetch(url);
        if (!response.ok) throw new Error('无法读取交付文件。');
        var blob = await response.blob();
        var writer = await handle.createWritable();
        try {
          await writer.write(blob);
          await writer.close();
        } catch (error) {
          await writer.abort().catch(function () {});
          throw error;
        }
        return true;
      }
    }
    return (await api('POST', url + '/save-as', {})).saved;
  }

  function wireOverview(task, quiet) {
    document.querySelectorAll('[data-export-action]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var name = button.dataset.file;
        var url = '/api/tasks/' + enc(task.task_id) + '/exports/' + enc(name);
        button.disabled = true;
        try {
          if (button.dataset.exportAction === 'open') {
            await api('POST', url + '/open', {});
          } else if (await saveExport(url, name)) {
            toast('PPTX 已保存');
          }
        } catch (error) {
          toast(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
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

  }

  // ---------- router ----------

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var qIdx = raw.indexOf('?');
    var pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    var qsPart = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
    var query = new URLSearchParams(qsPart);
    var parts = pathPart.split('/').filter(Boolean);
    if (parts[0] === 'example' && parts[1]) return {example: parts[1], compose: parts[2] === 'make', query: query};
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
    teardownFocusView();
    stopPoll();
    closeOutlineBubble();
    var parsed = parseHash();
    if (parsed.taskId) loadTask(parsed.taskId, parsed.focus, parsed.query);
    else if (parsed.projectSlug) renderProjectFocus(parsed.projectSlug, parsed.focus, parsed.query);
    else renderExamples(parsed.example, parsed.compose, parsed.query.get('page'), parsed.query.get('draft'), parsed.query.get('resume'));
  }

  document.getElementById('new-task').addEventListener('click', function () {
    location.hash = '#/new';
  });

  var settingsDialog = $('#image-settings');
  var baseInput = $('#image-base');
  var modelInput = $('#image-model');
  var savedImageSettings;
  var channel = 'zzai';
  var channelSettings = {};
  var channelDrafts = {};
  var channelButtons = Array.from(document.querySelectorAll('[data-channel]'));
  var keyInput = $('#image-key');
  var eyeButton = $('#toggle-image-key');
  var draftKey = '';
  var storedMask = '';
  var keyVersion = 0;
  var priceSession = 0;
  var priceSnapshot = {status: 'loading', table: {}};
  var quoteModel = $('#quote-model');
  var quoteSize = $('#quote-size');
  var knownModels = ['v2-lowprice', 'v2.5-flare', 'v2.5-sunburst', 'v2.5-lowprice',
    'v2.6-flare', 'v2.6-sunburst', 'v2.6-lowprice'].map(function (id) { return 'zhenzhen-image-g-' + id; });

  function modelName(id) {
    return id.replace('zhenzhen-image-g-v', 'GPT Image ').replace('-lowprice', ' 低价版')
      .replace('-flare', ' Flare').replace('-sunburst', ' Sunburst');
  }
  function displayPrice(model, size) {
    var amount = (priceSnapshot.table[model] || {})[size];
    return amount == null ? '' : '¥' + amount;
  }
  function drawPrices() {
    var table = priceSnapshot.table;
    var ids = Object.keys(table);
    if (!ids.length) ids = knownModels.slice();
    var selected = modelInput.value || savedImageSettings.default_model;
    if (ids.indexOf(selected) < 0) ids.push(selected);
    quoteModel.replaceChildren();
    ids.forEach(function (id) { quoteModel.add(new Option(modelName(id), id)); });
    quoteModel.value = selected;
    var price = displayPrice(selected, quoteSize.value);
    $('#quote-amount').textContent = price ? '预计 ' + price + ' / 张（16:9）' : '';
    var stateLabel = {loading: '正在读取估价…', refreshing: '正在更新今日估价…',
      no_key: '保存 API Key 后，重新打开设置可查看估价。',
      failed: '今日估价更新失败。', ready: price ? '' : '该配置暂无估价。'}[priceSnapshot.status];
    var when = priceSnapshot.updated && priceSnapshot.status !== 'ready' ? '上次报价：' + priceSnapshot.updated : '';
    $('#quote-note').textContent = [stateLabel, when].filter(Boolean).join(' ');
    $('#quote-details').hidden = !Object.keys(table).length;
    $('#quote-details tbody').innerHTML = Object.keys(table).map(function (id) {
      return '<tr><th scope="row">' + esc(modelName(id)) + '</th>' +
        ['1k','2k','4k'].map(function (size) { return '<td>' + esc(displayPrice(id, size) || '暂无估价') + '</td>'; }).join('') + '</tr>';
    }).join('');
  }
  function updatePricePanel() {
    var active = channel === 'zzai';
    $('#zzai-pricing').hidden = !active;
    $('#custom-model-field').hidden = active;
    modelInput.required = !active;
    if (active) drawPrices();
  }
  async function loadPrices(session, onOpen) {
    try {
      var snapshot = await api('POST', '/api/settings/image', {action: 'prices', on_open: !!onOpen});
      if (session !== priceSession || !settingsDialog.open) return;
      priceSnapshot = snapshot;
      updatePricePanel();
      if (snapshot.status === 'refreshing') {
        window.setTimeout(function () { if (session === priceSession) loadPrices(session); }, 1400);
      }
    } catch (_) {
      if (session !== priceSession) return;
      priceSnapshot.status = 'failed';
      updatePricePanel();
    }
  }
  quoteModel.addEventListener('change', function () { modelInput.value = quoteModel.value; drawPrices(); });
  quoteSize.addEventListener('change', drawPrices);

  function maskImageKey() {
    keyVersion++;
    var edge = Math.min(4, Math.floor(draftKey.length / 3));
    var mask = draftKey.slice(0, edge) + '********' + (edge ? draftKey.slice(-edge) : '');
    keyInput.type = 'password';
    keyInput.value = '';
    keyInput.placeholder = (draftKey ? mask : storedMask) || '输入 API Key';
    eyeButton.setAttribute('aria-label', '显示 API Key');
    eyeButton.setAttribute('aria-pressed', 'false');
  }
  keyInput.addEventListener('focus', function () {
    if (keyInput.type === 'password') keyInput.value = draftKey;
  });
  keyInput.addEventListener('input', function () { keyVersion++; draftKey = keyInput.value; });
  keyInput.addEventListener('blur', function () {
    if (keyInput.type === 'password') maskImageKey();
  });
  eyeButton.addEventListener('click', async function () {
    if (keyInput.type === 'text') { maskImageKey(); return; }
    var version = ++keyVersion;
    try {
      var value = draftKey;
      if (!value && storedMask) {
        var data = await api('POST', '/api/settings/image?channel=' + channel, {base_url: savedImageSettings.base_url, action: 'reveal'});
        if (version !== keyVersion || !settingsDialog.open) return;
        value = data.api_key;
      }
      keyInput.type = 'text';
      keyInput.value = value;
      eyeButton.setAttribute('aria-label', '隐藏 API Key');
      eyeButton.setAttribute('aria-pressed', 'true');
    } catch (error) { $('#settings-status').textContent = error.message; }
  });
  settingsDialog.addEventListener('close', function () {
    priceSession++;
    channelDrafts = {};
    draftKey = storedMask = '';
    maskImageKey();
  });

  function refreshEndpointKey() {
    draftKey = '';
    storedMask = savedImageSettings && baseInput.value.trim().replace(/\/+$/, '') === savedImageSettings.base_url
      ? savedImageSettings.key_mask : '';
    maskImageKey();
  }
  baseInput.addEventListener('input', function () { refreshEndpointKey(); updatePricePanel(); });
  function showChannel(name) {
    channel = name;
    savedImageSettings = channelSettings[name];
    var draft = channelDrafts[name] || savedImageSettings;
    baseInput.value = draft.base_url;
    modelInput.value = draft.model;
    quoteSize.value = draft.resolution || '1k';
    $('.image-onboarding').hidden = name !== 'zzai';
    $('#byok-address').hidden = name !== 'openai';
    channelButtons.forEach(function (button) {
      button.checked = button.dataset.channel === name;
      button.closest('label').querySelector('small').hidden = button.dataset.channel !== savedImageSettings.active;
    });
    refreshEndpointKey();
    draftKey = draft.key || '';
    maskImageKey();
    updatePricePanel();
    $('#settings-status').textContent = '';
    var active = savedImageSettings.active;
    $('#save-settings').textContent = active === name ? '保存更改' :
      (active ? '保存并切换到' : '保存并启用') + (name === 'zzai' ? ' ZhenZhen AI' : '自定义服务');
  }
  channelButtons.forEach(function (button) {
    button.addEventListener('change', function () {
      if (channel === button.dataset.channel) return;
      channelDrafts[channel] = {base_url: baseInput.value, model: modelInput.value,
        resolution: quoteSize.value, key: draftKey};
      showChannel(button.dataset.channel);
    });
  });
  async function openImageSettings() {
    var session = ++priceSession;
    $('#zzai-pricing').hidden = true;
    priceSnapshot = {status: 'loading', table: {}};
    var controls = [baseInput, modelInput, keyInput, eyeButton, $('#save-settings')].concat(channelButtons);
    controls.forEach(function (node) { node.disabled = true; });
    channelButtons.forEach(function (node) {
      node.checked = node.dataset.channel === 'zzai';
      node.closest('label').querySelector('small').hidden = true;
    });
    $('.image-onboarding').hidden = false;
    $('#byok-address').hidden = $('#custom-model-field').hidden = true;
    $('#save-settings').textContent = '保存';
    baseInput.value = modelInput.value = '';
    $('#settings-status').textContent = '正在读取设置…';
    settingsDialog.showModal();
    try {
      var settings = await Promise.all(['zzai','openai'].map(function (name) {
        return api('GET', '/api/settings/image?channel=' + name);
      }));
      if (session !== priceSession || !settingsDialog.open) return;
      channelSettings = {zzai: settings[0], openai: settings[1]};
      showChannel('zzai');
      loadPrices(session, true);
      controls.forEach(function (node) { node.disabled = false; });
      $('#settings-status').textContent = '';
    } catch (error) { $('#settings-status').textContent = error.message; }
  }
  $('#open-settings').addEventListener('click', openImageSettings);
  $('#cancel-settings').addEventListener('click', function () { settingsDialog.close(); });
  $('#image-settings-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    $('#save-settings').disabled = true;
    try {
      var values = { base_url: baseInput.value.trim(), model: modelInput.value.trim() };
      if (!$('#zzai-pricing').hidden) {
        values.model = quoteModel.value;
        values.resolution = quoteSize.value;
      }
      if (draftKey) values.api_key = draftKey;
      channelButtons.forEach(function (button) { button.disabled = true; });
      await api('PUT', '/api/settings/image?channel=' + channel, values);
      settingsDialog.close();
      toast('配图设置已保存');
    } catch (error) { $('#settings-status').textContent = error.message; }
    finally {
      $('#save-settings').disabled = false;
      channelButtons.forEach(function (button) { button.disabled = false; });
    }
  });

  window.addEventListener('hashchange', route);
  window.setInterval(refreshRail, 5000);
  if (!location.hash) location.hash = '#/new';
  route();
  refreshRail();
})();

