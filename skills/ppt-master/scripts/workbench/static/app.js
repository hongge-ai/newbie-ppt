/* Workbench frontend application (IIFE, no build chain). */
(function () {
  'use strict';

  // ---------- tiny helpers ----------

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function api(method, path, body) {
    var init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) {
          var message = data && data.error ? data.error : ('HTTP ' + resp.status);
          var error = new Error(message);
          error.status = resp.status;
          error.body = data;
          throw error;
        }
        return data;
      });
    });
  }

  function setConnState(broken) {
    var badge = $('#conn-state');
    if (badge) badge.hidden = !broken;
  }

  // ---------- option labels ----------

  var optionsCache = null;

  function loadOptions(force) {
    if (optionsCache && !force) return Promise.resolve(optionsCache);
    return api('GET', '/api/options').then(function (data) {
      optionsCache = data;
      return data;
    });
  }

  function optionLabel(list, value) {
    if (!list) return value == null ? '' : String(value);
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].value) === String(value)) return list[i].label;
    }
    return value == null ? '' : String(value);
  }

  // ---------- task status vocabulary ----------

  var STATUS_LABELS = {
    draft: '草稿',
    submitted: '待处理',
    processing: '生成中',
    interrupted: '已中断',
    done: '已完成',
    failed: '失败',
    error: '损坏'
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '未知';
  }

  // ---------- polling ----------

  var pollTimer = null;

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function pollEvery(seconds, fn) {
    stopPolling();
    pollTimer = setInterval(fn, seconds * 1000);
  }

  // ---------- view shell ----------

  var viewEl = null;

  function render(html) {
    viewEl.innerHTML = html;
  }

  function notify(message, isError) {
    var bar = $('#notify');
    if (!bar) return;
    bar.textContent = message;
    bar.className = 'notify' + (isError ? ' notify-error' : ' notify-ok');
    bar.hidden = false;
    window.setTimeout(function () { bar.hidden = true; }, isError ? 6000 : 3000);
  }

  // ---------- tasks list view ----------

  function taskCard(task) {
    var title = task.display_title || task.topic || task.task_id;
    var meta = [];
    if (task.created_at) meta.push(task.created_at);
    var runtime = task.runtime || {};
    if (runtime.stage_label) meta.push(runtime.stage_label);
    if (runtime.blocking) meta.push('待你回答');
    return (
      '<a class="task-card" href="#/task/' + encodeURIComponent(task.task_id) + '">' +
      '<div class="task-card-head">' +
      '<span class="task-title">' + esc(title) + '</span>' +
      '<span class="badge badge-' + esc(task.status) + '">' + esc(statusLabel(task.status)) + '</span>' +
      '</div>' +
      '<div class="task-card-meta">' + meta.map(esc).join(' · ') + '</div>' +
      '<div class="task-card-topic">' + esc(task.topic) + '</div>' +
      '</a>'
    );
  }

  function refreshTaskList() {
    return api('GET', '/api/tasks').then(function (data) {
      setConnState(false);
      var list = $('#task-list');
      if (!list) return;
      if (!data.tasks.length) {
        list.innerHTML = '<div class="empty">还没有任务。在上方创建第一个。</div>';
        return;
      }
      list.innerHTML = data.tasks.map(taskCard).join('');
    }).catch(function (err) {
      setConnState(true);
      var list = $('#task-list');
      if (list) list.innerHTML = '<div class="empty">加载失败:' + esc(err.message) + '</div>';
    });
  }

  function showTasks() {
    render(
      '<section class="panel">' +
      '<h2>新建任务</h2>' +
      '<form id="create-form">' +
      '<label class="field"><span>主题 / 需求描述 *</span>' +
      '<textarea id="create-topic" rows="3" placeholder="例如:基于这份季度报告做一份 10 页的汇报 PPT" required></textarea></label>' +
      '<div class="field-row">' +
      '<label class="field"><span>任务标题(可选)</span>' +
      '<input id="create-title" type="text" maxlength="200" placeholder="展示在任务列表里"></label>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary">创建并配置</button>' +
      '</form>' +
      '</section>' +
      '<section class="panel">' +
      '<h2>任务列表</h2>' +
      '<div id="task-list" class="task-list"><div class="empty">加载中…</div></div>' +
      '</section>'
    );

    loadOptions().then(function () {
      refreshTaskList();
    });

    $('#create-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var topic = $('#create-topic').value.trim();
      if (!topic) { notify('请填写主题', true); return; }
      api('POST', '/api/tasks', {
        topic: topic,
        display_title: $('#create-title').value.trim() || null
      }).then(function (data) {
        location.hash = '#/task/' + encodeURIComponent(data.task_id);
      }).catch(function (err) { notify('创建失败:' + err.message, true); });
    });

    pollEvery(5, refreshTaskList);
    refreshTaskList();
  }

  // ---------- task detail view ----------

  function selectOptions(list, value) {
    return (list || []).map(function (item) {
      var selected = String(item.value) === String(value) ? ' selected' : '';
      return '<option value="' + esc(item.value) + '"' + selected + '>' + esc(item.label) + '</option>';
    }).join('');
  }

  function uploadRow(item, editable) {
    return (
      '<li class="upload-row"><span class="upload-name" title="' + esc(item.name) + '">' +
      esc(item.name) + '</span><span class="upload-size">' + esc(fmtSize(item.size)) + '</span>' +
      (editable
        ? '<button class="btn btn-danger btn-small" data-del-upload="' + esc(item.name) + '">删除</button>'
        : '') +
      '</li>'
    );
  }

  function renderTaskForm(task, options, uploads) {
    var p = task.params || {};
    var r = task.requirements || {};
    return (
      '<section class="panel">' +
      '<div class="task-head">' +
      '<div><h2>' + esc(task.display_title || task.topic) + '</h2>' +
      '<div class="task-sub">' + esc(task.task_id) + ' · ' + esc(statusLabel(task.status)) + '</div></div>' +
      '<a class="btn" href="#/tasks">← 返回列表</a>' +
      '</div>' +
      '</section>' +

      '<section class="panel">' +
      '<h3>基本信息</h3>' +
      '<label class="field"><span>任务标题</span>' +
      '<input id="f-title" type="text" maxlength="200" value="' + esc(task.display_title || '') + '"></label>' +
      '<label class="field"><span>主题 / 需求描述 *</span>' +
      '<textarea id="f-topic" rows="3">' + esc(task.topic) + '</textarea></label>' +
      '<div class="field-row">' +
      '<label class="field"><span>面向受众</span>' +
      '<input id="f-audience" type="text" placeholder="例如:公司管理层" value="' + esc(r.audience || '') + '"></label>' +
      '<label class="field"><span>语气风格</span>' +
      '<input id="f-tone" type="text" placeholder="例如:正式、简洁" value="' + esc(r.tone || '') + '"></label>' +
      '</div>' +
      '<label class="field"><span>附加要求</span>' +
      '<textarea id="f-extra" rows="2" placeholder="其他希望满足的要求">' + esc(r.extra || '') + '</textarea></label>' +
      '</section>' +

      '<section class="panel">' +
      '<h3>生成参数</h3>' +
      '<div class="field-row">' +
      '<label class="field"><span>画幅</span>' +
      '<select id="f-canvas">' + selectOptions(options.canvas, p.canvas) + '</select></label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label class="field"><span>页数</span>' +
      '<select id="f-page-count">' + selectOptions(options.page_counts, p.page_count == null ? 'null' : p.page_count) + '</select></label>' +
      '<label class="field"><span>语言</span>' +
      '<select id="f-language">' + selectOptions(options.languages, p.primary_language) + '</select></label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label class="field"><span>配图策略</span>' +
      '<select id="f-image-policy">' + selectOptions(options.image_policies, p.image_policy) + '</select></label>' +
      '<label class="field field-check"><input id="f-notes" type="checkbox"' +
      (p.speaker_notes ? ' checked' : '') + '><span>生成讲者备注</span></label>' +
      '</div>' +
      '</section>' +

      '<section class="panel">' +
      '<h3>参考材料</h3>' +
      '<p class="hint">可上传 PDF / Word / PPT / 图片等源材料;生成时由 AI 读取。仅草稿状态可修改。</p>' +
      '<ul id="upload-list" class="upload-list">' +
      (uploads.length ? uploads.map(function (item) { return uploadRow(item, true); }).join('')
        : '<li class="empty">尚未上传材料(可选)</li>') +
      '</ul>' +
      '<label class="btn upload-btn">上传材料<input id="f-files" type="file" multiple hidden></label>' +
      '</section>' +

      '<section class="panel">' +
      '<h3>模板 / 品牌 / 风格</h3>' +
      '<p class="hint">这里不选模板。提交之后，在「阶段确认」页的 Stage 1 里选择模板工作区，或改用自由设计。</p>' +
      '</section>' +

      '<section class="panel actions">' +
      '<button id="save-btn" class="btn">保存修改</button>' +
      '<button id="submit-btn" class="btn btn-primary">提交生成</button>' +
      '</section>'
    );
  }

  function readFormTask() {
    var pageCountRaw = $('#f-page-count').value;
    return {
      display_title: $('#f-title').value.trim() || null,
      topic: $('#f-topic').value.trim(),
      requirements: {
        audience: $('#f-audience').value.trim(),
        tone: $('#f-tone').value.trim(),
        extra: $('#f-extra').value.trim()
      },
      params: {
        canvas: $('#f-canvas').value || null,
        page_count: pageCountRaw === 'null' || pageCountRaw === '' ? null : parseInt(pageCountRaw, 10),
        primary_language: $('#f-language').value,
        speaker_notes: $('#f-notes').checked,
        image_policy: $('#f-image-policy').value
      }
    };
  }

  function wireTaskForm(task) {
    function currentUploadNames() {
      return Array.prototype.slice.call($('#upload-list').querySelectorAll('[data-del-upload]'))
        .map(function (btn) { return btn.getAttribute('data-del-upload'); });
    }

    $('#f-files').addEventListener('change', function (event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      if (!files.length) return;
      var form = new FormData();
      files.forEach(function (file) { form.append('files', file, file.name); });
      fetch('/api/tasks/' + encodeURIComponent(task.task_id) + '/uploads', { method: 'POST', body: form })
        .then(function (resp) { return resp.json(); })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          notify('已上传 ' + (data.uploads || []).length + ' 个文件');
          showTask(task.task_id);
        })
        .catch(function (err) { notify('上传失败:' + err.message, true); });
    });

    $('#upload-list').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-del-upload]');
      if (!btn) return;
      api('DELETE', '/api/tasks/' + encodeURIComponent(task.task_id) + '/uploads/' + encodeURIComponent(btn.getAttribute('data-del-upload')))
        .then(function () { showTask(task.task_id); })
        .catch(function (err) { notify('删除失败:' + err.message, true); });
    });

    $('#save-btn').addEventListener('click', function () {
      var payload = readFormTask();
      if (!payload.topic) { notify('主题不能为空', true); return; }
      api('PATCH', '/api/tasks/' + encodeURIComponent(task.task_id), payload)
        .then(function () { notify('已保存'); })
        .catch(function (err) { notify('保存失败:' + err.message, true); });
    });

    $('#submit-btn').addEventListener('click', function () {
      var payload = readFormTask();
      if (!payload.topic) { notify('主题不能为空', true); return; }
      api('PATCH', '/api/tasks/' + encodeURIComponent(task.task_id), payload)
        .then(function () {
          return api('POST', '/api/tasks/' + encodeURIComponent(task.task_id) + '/submit');
        })
        .then(function (data) {
          render(
            '<section class="panel">' +
            '<h2>任务已提交 ✓</h2>' +
            '<p>接下来,把下面这句话复制到 AI 对话窗口触发生成:</p>' +
            '<pre class="agent-hint">' + esc(data.agent_hint) + '</pre>' +
            '<button id="copy-hint" class="btn btn-primary">复制触发语</button>' +
            '<a class="btn" href="#/task/' + encodeURIComponent(task.task_id) + '">查看任务</a>' +
            '<a class="btn" href="#/tasks">返回列表</a>' +
            '</section>'
          );
          $('#copy-hint').addEventListener('click', function () {
            var text = data.agent_hint;
            if (navigator.clipboard) navigator.clipboard.writeText(text);
            notify('已复制,去粘贴到 AI 对话窗口');
          });
        })
        .catch(function (err) { notify('提交失败:' + err.message, true); });
    });
  }

  function renderTaskReadonly(task) {
    var p = task.params || {};
    var r = task.requirements || {};
    var rows = [
      ['状态', statusLabel(task.status)],
      ['画幅', optionLabel(optionsCache && optionsCache.canvas, p.canvas)],
      ['页数', p.page_count == null ? '由 AI 决定' : String(p.page_count)],
      ['语言', optionLabel(optionsCache && optionsCache.languages, p.primary_language)],
      ['配图策略', optionLabel(optionsCache && optionsCache.image_policies, p.image_policy)],
      ['讲者备注', p.speaker_notes ? '开启' : '关闭'],
      ['面向受众', r.audience || '—'],
      ['语气风格', r.tone || '—'],
      ['附加要求', r.extra || '—']
    ];
    var runtime = task.runtime || {};
    if (runtime.error) rows.push(['错误信息', runtime.error.message || '']);
    if (runtime.project_dir) rows.push(['项目目录', runtime.project_dir]);
    if (runtime.stage_label) rows.push(['当前阶段', runtime.stage_label]);
    return (
      '<section class="panel">' +
      '<div class="task-head">' +
      '<div><h2>' + esc(task.display_title || task.topic) + '</h2>' +
      '<div class="task-sub">' + esc(task.task_id) + ' · ' + esc(statusLabel(task.status)) + '</div></div>' +
      '<a class="btn" href="#/tasks">← 返回列表</a>' +
      '</div>' +
      '<p class="task-topic-full">' + esc(task.topic) + '</p>' +
      '<table class="kv-table">' +
      rows.map(function (row) {
        return '<tr><th>' + esc(row[0]) + '</th><td>' + esc(row[1]) + '</td></tr>';
      }).join('') +
      '</table>' +
      '<div class="actions"><a class="btn btn-primary" href="#/task/' +
      encodeURIComponent(task.task_id) + '/progress">查看生成进度 →</a></div>' +
      '</section>'
    );
  }

  function showTask(taskId) {
    Promise.all([
      api('GET', '/api/tasks/' + encodeURIComponent(taskId)),
      loadOptions()
    ]).then(function (results) {
      var task = results[0];
      setConnState(false);
      if (task.status === 'draft') {
        render(renderTaskForm(task, optionsCache, task.uploads_present || []));
        wireTaskForm(task);
      } else {
        render(renderTaskReadonly(task));
        pollEvery(5, function () { showTask(taskId); });
      }
    }).catch(function (err) {
      setConnState(true);
      render('<section class="panel"><h2>加载失败</h2><p>' + esc(err.message) + '</p>' +
        '<a class="btn" href="#/tasks">← 返回列表</a></section>');
    });
  }

  // ---------- progress view ----------

  var progressMtimes = {};

  function slideThumb(taskId, slide) {
    return (
      '<figure class="roster-item"><figcaption>' + esc(slide.name) + '</figcaption>' +
      '<div class="roster-svg" data-slide="' + esc(slide.name) + '" data-mtime="' +
      slide.mtime + '">…</div></figure>'
    );
  }

  function renderSlideBody(taskId, holder) {
    var name = holder.getAttribute('data-slide');
    fetch('/api/tasks/' + encodeURIComponent(taskId) + '/slides/' + encodeURIComponent(name))
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      })
      .then(function (text) {
        var prefix = '/api/tasks/' + encodeURIComponent(taskId);
        text = text.replace(/\.\.\/images\//g, prefix + '/images/');
        text = text.replace(/(["'])images\//g, '$1' + prefix + '/images/');
        holder.innerHTML = text;
      })
      .catch(function (err) {
        holder.innerHTML = '<div class="empty">加载失败:' + esc(err.message) + '</div>';
      });
  }

  function shortTime(value) {
    if (!value) return '';
    var match = String(value).match(/T(\d{2}:\d{2}:\d{2})/);
    return match ? match[1] : String(value);
  }

  function eventLine(event) {
    var d = event.data || {};
    switch (event.type) {
      case 'run/start': return d.resume ? '恢复运行' : '开始运行';
      case 'run/end': return '运行结束:' + (d.outcome || 'done');
      case 'stage/enter': return '进入阶段 ' + (d.label || d.stage || '');
      case 'progress': return '进度 ' + d.done + (d.total ? '/' + d.total : '') + ' ' + (d.unit || '');
      case 'ask/open': return '等待回答:' + (d.prompt || '');
      case 'ask/answered': return '已回答:' + ((d.choice || []).join(',') || d.status || '');
      case 'ask/superseded': return '请求已被接管作废';
      case 'takeover': return '接管运行(' + (d.reason || '') + ')';
      case 'say': return d.text || '';
      case 'error': return '错误:' + (d.message || '');
      default: return event.type;
    }
  }

  function stageSummary(progress) {
    var runtime = progress.runtime || {};
    var bits = [];
    if (runtime.stage_label) bits.push('<strong>' + esc(runtime.stage_label) + '</strong>');
    if (runtime.progress && runtime.progress.total) {
      bits.push('进度 ' + runtime.progress.done + '/' + runtime.progress.total);
    } else if (runtime.progress) {
      bits.push('已产出 ' + runtime.progress.done + ' 页');
    }
    if (progress.quality && progress.quality.report_exists) bits.push('质检报告已生成');
    if (runtime.state === 'interrupted') bits.push('AI 已停止,等待接续');
    if (runtime.error) bits.push('<span class="err-text">' + esc(runtime.error.message || '') + '</span>');
    return bits.join(' · ') || '等待 AI 处理…';
  }

  function timelineHtml(progress) {
    var items = (progress.events || []).slice(-12).reverse().map(function (event) {
      return '<li><span class="tl-time">' + esc(shortTime(event.at)) + '</span>' +
        '<span class="tl-event">' + esc(eventLine(event)) + '</span></li>';
    }).join('');
    return '<div class="progress-state">' + stageSummary(progress) + '</div>' +
      (items ? '<ol class="timeline">' + items + '</ol>' : '');
  }

  function askHtml(item) {
    var request = item.request || {};
    var response = item.response;
    var options = (request.options || []).map(function (option) {
      return '<button type="button" class="ask-option" data-choice="' + esc(option.id) + '">' +
        esc(option.label || option.id) +
        (option.detail ? '<span class="ask-option-detail">' + esc(option.detail) + '</span>' : '') +
        '</button>';
    }).join('');
    var answerLine = '';
    if (response) {
      var picked = (response.choice || []).join(', ');
      answerLine = '<div class="ask-answer' + (response.status === 'superseded' ? ' is-stale' : '') + '">' +
        '你的回答:' + esc(picked || response.status || '') +
        (response.text ? '(' + esc(response.text) + ')' : '') + '</div>';
    }
    return '<div class="ask-card" data-request="' + esc(request.id) + '"' +
      ' data-multi="' + (request.multi ? '1' : '') + '">' +
      '<div class="ask-head"><span class="badge badge-processing">待回答</span>' +
      '<span class="ask-title">' + esc(request.title || '需要你的决定') + '</span></div>' +
      (request.body ? '<div class="ask-body">' + esc(request.body) + '</div>' : '') +
      (options ? '<div class="ask-options">' + options + '</div>' : '') +
      (request.allow_text === false ? '' :
        '<label class="field"><span>补充说明(可选)</span>' +
        '<textarea class="ask-text" rows="2"></textarea></label>') +
      '<button type="button" class="btn btn-primary ask-submit">提交回答</button>' +
      answerLine +
      '</div>';
  }

  function inboxHtml(progress) {
    var items = progress.requests || [];
    if (!items.length) return '';
    var open = items.filter(function (item) { return !item.response; });
    var answered = items.filter(function (item) { return item.response; }).slice(-3).reverse();
    var body = open.map(askHtml).join('') ||
      '<div class="hint">没有待回答的问题。</div>';
    var history = answered.length
      ? '<h4>已回答</h4>' + answered.map(function (item) {
          var request = item.request || {};
          var response = item.response || {};
          return '<div class="ask-card" data-request="' + esc(request.id) + '">' +
            '<div class="ask-head"><span class="badge badge-done">已回复</span>' +
            '<span class="ask-title">' + esc(request.title || '') + '</span></div>' +
            '<div class="ask-answer">' + esc((response.choice || []).join(', ') || response.status || '') +
            (response.text ? '(' + esc(response.text) + ')' : '') + '</div></div>';
        }).join('')
      : '';
    return '<section class="panel"><h3>需要你回答</h3>' + body + history + '</section>';
  }

  // ---------- mounted project surfaces ----------

  // The three per-project pages live on this same port under /p/<slug>/<kind>/.
  // They render into a container outside #view so the 2 s progress poll never
  // reloads an open surface.
  var SURFACES = [
    ['preview', '页面预览'],
    ['confirm', '阶段确认'],
    ['spec', '规格评审']
  ];

  var surfaceHost = null;
  var surfaceSlug = null;
  var surfaceKind = 'preview';
  var surfaceOpen = false;

  function surfaceUrl(slug, kind) {
    return '/p/' + encodeURIComponent(slug) + '/' + kind + '/';
  }

  function syncSurfaces(progress) {
    if (!surfaceHost) surfaceHost = $('#surface-panel');
    if (!surfaceHost) return;
    var slug = (progress.runtime || {}).slug || null;
    if (!slug) {
      hideSurfaces();
      return;
    }
    if (slug === surfaceSlug) return;
    surfaceSlug = slug;
    surfaceHost.hidden = false;
    surfaceHost.innerHTML =
      '<div class="surface-head"><h3>项目页面</h3><div class="surface-tabs">' +
      SURFACES.map(function (item) {
        return '<button type="button" class="surface-tab' +
          (item[0] === surfaceKind ? ' is-active' : '') + '" data-kind="' + item[0] + '">' +
          item[1] + '</button>';
      }).join('') + '</div></div>' +
      '<iframe class="surface-frame" title="项目页面" hidden></iframe>';
    var frame = surfaceHost.querySelector('.surface-frame');
    function open(kind) {
      surfaceKind = kind;
      frame.hidden = false;
      frame.src = surfaceUrl(slug, surfaceKind);
    }
    if (surfaceOpen) open(surfaceKind);
    Array.prototype.forEach.call(surfaceHost.querySelectorAll('.surface-tab'), function (button) {
      button.addEventListener('click', function () {
        surfaceOpen = true;
        Array.prototype.forEach.call(surfaceHost.querySelectorAll('.surface-tab'), function (other) {
          other.classList.toggle('is-active', other === button);
        });
        open(button.getAttribute('data-kind'));
      });
    });
  }

  function hideSurfaces() {
    if (!surfaceHost) surfaceHost = $('#surface-panel');
    if (surfaceHost) {
      surfaceHost.hidden = true;
      surfaceHost.innerHTML = '';
    }
    surfaceSlug = null;
    surfaceOpen = false;
  }

  function wireInbox(taskId) {    Array.prototype.forEach.call(document.querySelectorAll('.ask-card'), function (card) {
      var requestId = card.getAttribute('data-request');
      var multi = card.getAttribute('data-multi') === '1';
      var submit = card.querySelector('.ask-submit');
      var picked = [];
      Array.prototype.forEach.call(card.querySelectorAll('.ask-option'), function (button) {
        button.addEventListener('click', function () {
          var id = button.getAttribute('data-choice');
          if (multi) {
            var at = picked.indexOf(id);
            if (at >= 0) { picked.splice(at, 1); button.classList.remove('is-picked'); }
            else { picked.push(id); button.classList.add('is-picked'); }
          } else {
            picked = [id];
            Array.prototype.forEach.call(card.querySelectorAll('.ask-option'), function (other) {
              other.classList.remove('is-picked');
            });
            button.classList.add('is-picked');
          }
        });
      });
      if (!submit) return;
      submit.addEventListener('click', function () {
        var textBox = card.querySelector('.ask-text');
        submit.disabled = true;
        api('POST', '/api/tasks/' + encodeURIComponent(taskId) + '/requests/' +
          encodeURIComponent(requestId), {
          status: 'answered',
          choice: picked,
          text: textBox ? textBox.value.trim() : null
        }).then(function () {
          notify('回答已提交');
          showProgress(taskId);
        }).catch(function (err) {
          submit.disabled = false;
          notify('提交失败:' + err.message, true);
        });
      });
    });
  }

  function exportsHtml(taskId, exports) {
    if (!exports.length) return '<div class="empty">尚未导出文件</div>';
    return exports.map(function (file) {
      return (
        '<a class="export-card" href="/api/tasks/' + encodeURIComponent(taskId) +
        '/exports/' + encodeURIComponent(file.name) + '" download>' +
        '<span class="export-name">📦 ' + esc(file.name) + '</span>' +
        '<span class="upload-size">' + esc(fmtSize(file.size)) + '</span></a>'
      );
    }).join('');
  }

  function feedbackHtml(feedback) {
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button class="star' + (feedback && feedback.rating >= i ? ' star-on' : '') +
        '" data-star="' + i + '" title="' + i + ' 星">★</button>';
    }
    return (
      '<section class="panel" id="feedback-panel">' +
      '<h3>反馈</h3>' +
      '<div class="stars">' + stars + '</div>' +
      '<label class="field"><span>评语(可选)</span>' +
      '<textarea id="fb-comment" rows="2">' + esc(feedback && feedback.comment || '') + '</textarea></label>' +
      '<label class="field-check"><input id="fb-revision" type="checkbox"' +
      (feedback && feedback.wants_revision ? ' checked' : '') +
      '><span>希望进一步修订</span></label>' +
      '<button id="fb-submit" class="btn">提交反馈</button>' +
      '</section>'
    );
  }

  function wireFeedback(taskId) {
    var panel = $('#feedback-panel');
    if (!panel) return;
    var rating = null;
    panel.addEventListener('click', function (event) {
      var star = event.target.closest('[data-star]');
      if (star) {
        rating = parseInt(star.getAttribute('data-star'), 10);
        Array.prototype.forEach.call(panel.querySelectorAll('.star'), function (el) {
          el.classList.toggle('star-on', parseInt(el.getAttribute('data-star'), 10) <= rating);
        });
      }
    });
    $('#fb-submit').addEventListener('click', function () {
      api('POST', '/api/tasks/' + encodeURIComponent(taskId) + '/feedback', {
        rating: rating,
        comment: $('#fb-comment').value.trim(),
        wants_revision: $('#fb-revision').checked
      }).then(function () { notify('反馈已提交'); })
        .catch(function (err) { notify('提交失败:' + err.message, true); });
    });
  }

  function showProgress(taskId) {
    api('GET', '/api/tasks/' + encodeURIComponent(taskId) + '/progress')
      .then(function (progress) {
        setConnState(false);
        var closed = progress.status === 'done' || progress.status === 'failed';
        var runtime = progress.runtime || {};
        var slidesHtml = progress.slides.length
          ? '<div class="roster-grid">' + progress.slides.map(function (slide) {
              return slideThumb(taskId, slide);
            }).join('') + '</div>'
          : '<div class="empty">还没有页面产出。AI 开始生成后,这里会实时显示每一页。</div>';
        render(
          '<section class="panel">' +
          '<div class="task-head">' +
          '<div><h2>生成进度 <span class="badge badge-' + esc(progress.status) + '">' +
          esc(statusLabel(progress.status)) + '</span></h2>' +
          '<div class="task-sub">' + esc(taskId) +
          (runtime.project_dir ? ' · ' + esc(runtime.project_dir) : '') + '</div></div>' +
          '<a class="btn" href="#/task/' + encodeURIComponent(taskId) + '">任务详情</a>' +
          '</div>' +
          timelineHtml(progress) +
          '</section>' +
          inboxHtml(progress) +
          '<section class="panel"><h3>页面预览(' + progress.slide_count + ')</h3>' + slidesHtml + '</section>' +
          '<section class="panel"><h3>导出文件</h3>' + exportsHtml(taskId, progress.exports) + '</section>' +
          (closed ? '' : '<section class="panel"><p class="hint">本页每 2 秒自动刷新。</p></section>')
        );
        wireInbox(taskId);
        syncSurfaces(progress);
        Array.prototype.forEach.call(document.querySelectorAll('[data-slide]'), function (holder) {
          var name = holder.getAttribute('data-slide');
          var mtime = holder.getAttribute('data-mtime');
          if (progressMtimes[name] === mtime && holder.innerHTML !== '…') return;
          progressMtimes[name] = mtime;
          renderSlideBody(taskId, holder);
        });
        if (closed) {
          api('GET', '/api/tasks/' + encodeURIComponent(taskId) + '/feedback')
            .then(function (feedback) {
              viewEl.insertAdjacentHTML('beforeend', feedbackHtml(feedback.exists === false ? null : feedback));
              wireFeedback(taskId);
            });
        } else {
          pollEvery(2, function () { showProgress(taskId); });
        }
      })
      .catch(function (err) {
        setConnState(true);
        render('<section class="panel"><h2>进度加载失败</h2><p>' + esc(err.message) + '</p>' +
          '<a class="btn" href="#/tasks">← 返回列表</a></section>');
      });
  }

  // ---------- router ----------

  function route() {
    if (!viewEl) viewEl = $('#view');
    stopPolling();
    hideSurfaces();
    var match = location.hash.match(/^#\/task\/([^/]+)\/progress\/?$/);
    if (match) {
      showProgress(decodeURIComponent(match[1]));
      return;
    }
    match = location.hash.match(/^#\/task\/([^/]+)\/?$/);
    if (match) {
      showTask(decodeURIComponent(match[1]));
    } else {
      showTasks();
    }
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route);
})();
