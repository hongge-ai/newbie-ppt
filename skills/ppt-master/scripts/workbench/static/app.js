/* Workbench single-page app: action-first task page, tools open in focus mode. */
(function () {
  'use strict';

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

  // ---------- new task ----------

  function renderNewTask() {
    refreshRail('');
    workspace.innerHTML =
      '<div class="page-head"><div><h1>新建任务</h1>' +
      '<div class="page-sub">写清主题或需求，创建后配置参数并提交。模板在确认页的 Stage 1 里选。</div></div></div>' +
      '<div class="card"><form id="create-form">' +
      '<label class="field"><span>主题 / 需求描述</span>' +
      '<textarea id="create-topic" rows="5" placeholder="例如：根据这份季度报告做一份 10 页的汇报 PPT" required></textarea></label>' +
      '<div class="field-row"><label class="field"><span>任务标题（可选）</span>' +
      '<input id="create-title" type="text" maxlength="200" placeholder="显示在左侧任务列表"></label></div>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">创建并配置</button></div>' +
      '</form></div>';

    $('#create-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var topic = $('#create-topic').value.trim();
      if (!topic) { toast('请填写主题', true); return; }
      api('POST', '/api/tasks', {
        topic: topic,
        display_title: $('#create-title').value.trim() || null
      }).then(function (data) {
        location.hash = '#/task/' + enc(data.task_id);
      }).catch(function (error) { toast('创建失败：' + error.message, true); });
    });
    poll(5, function () { refreshRail(''); });
  }

  // ---------- task page ----------

  function loadTask(taskId, focus) {
    lastSignature = '';
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
    workspace.innerHTML = headerHtml(task) + '<div id="pane"><div class="loading">加载中…</div></div>';
    renderOverview(task);
    poll(2, function () { renderOverview(task, true); });
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
    var p = task.params || {};
    var r = task.requirements || {};
    var opts = optionsCache || {};
    pane.innerHTML =
      '<div class="card"><h2>参数</h2>' +
      '<p class="card-hint">画幅、页数、语言、配图与受众会影响整条生成链路。</p>' +
      '<div class="field-row">' +
      '<label class="field"><span>画幅</span><select id="f-canvas">' +
      '<option value="">由 AI 决定</option>' + options(opts.canvas, p.canvas) + '</select></label>' +
      '<label class="field"><span>页数</span><input id="f-pages" type="number" min="1" max="60" ' +
      'value="' + esc(p.page_count == null ? '' : p.page_count) + '" placeholder="留空由 AI 决定"></label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label class="field"><span>语言</span><select id="f-lang">' +
      options(opts.languages, p.primary_language) + '</select></label>' +
      '<label class="field"><span>配图策略</span><select id="f-image">' +
      options(opts.image_policies, p.image_policy) + '</select></label>' +
      '</div>' +
      '<label class="field"><span>面向受众</span>' +
      '<input id="f-audience" type="text" value="' + esc(r.audience) + '" placeholder="谁会看这份演示"></label>' +
      '<div class="field-row">' +
      '<label class="field"><span>语气风格</span>' +
      '<input id="f-tone" type="text" value="' + esc(r.tone) + '" placeholder="例如：教程 / 正式 / 轻松"></label>' +
      '<label class="field"><span>附加要求</span>' +
      '<input id="f-extra" type="text" value="' + esc(r.extra) + '" placeholder="可选"></label>' +
      '</div>' +
      '<label class="field-check"><input id="f-notes" type="checkbox"' +
      (p.speaker_notes ? ' checked' : '') + '> 生成讲者备注</label>' +
      '<div class="actions"><button class="btn" id="save-btn" type="button">保存修改</button>' +
      '<button class="btn btn-primary" id="submit-btn" type="button">提交生成</button></div>' +
      '</div>' +
      '<div class="card"><h2>参考材料</h2>' +
      '<p class="card-hint">可选。提交时会一起交给 AI。</p>' +
      '<ul class="list" id="upload-list">' + uploadRows(task.uploads_present || []) + '</ul>' +
      '<label class="btn" for="f-files">上传文件</label>' +
      '<input id="f-files" type="file" multiple hidden></div>';

    $('#save-btn').addEventListener('click', function () { saveTask(task.task_id, false); });
    $('#submit-btn').addEventListener('click', function () { saveTask(task.task_id, true); });
    $('#f-files').addEventListener('change', function (event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      if (!files.length) return;
      var form = new FormData();
      files.forEach(function (file) { form.append('files', file); });
      fetch('/api/tasks/' + enc(task.task_id) + '/uploads', { method: 'POST', body: form })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          toast('已上传 ' + files.length + ' 个文件');
          loadTask(task.task_id);
        })
        .catch(function (error) { toast('上传失败：' + error.message, true); });
    });
    Array.prototype.forEach.call(pane.querySelectorAll('[data-del-upload]'), function (button) {
      button.addEventListener('click', function () {
        api('DELETE', '/api/tasks/' + enc(task.task_id) + '/uploads/' +
          enc(button.getAttribute('data-del-upload')))
          .then(function () { loadTask(task.task_id); })
          .catch(function (error) { toast('删除失败：' + error.message, true); });
      });
    });
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

  function formPayload() {
    var pages = $('#f-pages').value.trim();
    var payload = {
      params: {
        canvas: $('#f-canvas').value || null,
        page_count: pages ? parseInt(pages, 10) : null,
        primary_language: $('#f-lang').value,
        speaker_notes: $('#f-notes').checked,
        image_policy: $('#f-image').value
      },
      requirements: {
        audience: $('#f-audience').value.trim(),
        tone: $('#f-tone').value.trim(),
        extra: $('#f-extra').value.trim()
      }
    };
    if (!payload.params.canvas) delete payload.params.canvas;
    return payload;
  }

  function saveTask(taskId, submit) {
    api('PATCH', '/api/tasks/' + enc(taskId), formPayload())
      .then(function () {
        if (!submit) { toast('已保存'); return null; }
        return api('POST', '/api/tasks/' + enc(taskId) + '/submit');
      })
      .then(function () {
        if (submit) toast('已提交，交给 AI 处理');
        loadTask(taskId);
      })
      .catch(function (error) { toast('保存失败：' + error.message, true); });
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
    if (runtime.progress && runtime.progress.total) {
      return '正在生成 · ' + runtime.progress.done + '/' + runtime.progress.total + ' 页';
    }
    if (runtime.stage_label) return '正在生成 · ' + runtime.stage_label;
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

  function nextAction(task, progress) {
    var runtime = progress.runtime || {};
    if (openRequests(progress).length) return null;
    if (runtime.stage === 'confirm_stage1' || runtime.stage === 'template_install') {
      return '<a class="btn btn-primary" href="#/task/' + enc(task.task_id) +
        '/confirm">去完成阶段确认</a>';
    }
    return '';
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
        '<div class="next-actions">' + nextAction(task, progress) + '</div></div>';

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
      ['面向受众', r.audience || '—'],
      ['语气风格', r.tone || '—'],
      ['附加要求', r.extra || '—']
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