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
          throw new Error(message);
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
    if (task.profile) meta.push(optionLabel(optionsCache && optionsCache.profiles, task.profile));
    if (task.created_at) meta.push(task.created_at);
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
      '<label class="field"><span>生成方式</span><select id="create-profile"></select></label>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary">创建并配置</button>' +
      '</form>' +
      '</section>' +
      '<section class="panel">' +
      '<h2>任务列表</h2>' +
      '<div id="task-list" class="task-list"><div class="empty">加载中…</div></div>' +
      '</section>'
    );

    loadOptions().then(function (options) {
      var select = $('#create-profile');
      if (!select) return;
      select.innerHTML = (options.profiles || []).map(function (item) {
        return '<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>';
      }).join('');
      refreshTaskList();
    });

    $('#create-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var topic = $('#create-topic').value.trim();
      if (!topic) { notify('请填写主题', true); return; }
      api('POST', '/api/tasks', {
        topic: topic,
        display_title: $('#create-title').value.trim() || null,
        params: { profile: $('#create-profile').value }
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
      '<label class="field"><span>生成方式</span>' +
      '<select id="f-profile">' + selectOptions(options.profiles, p.profile) + '</select></label>' +
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
      '<h3>模板</h3>' +
      '<div id="template-summary" class="template-summary"></div>' +
      '<a class="btn" href="#/task/' + encodeURIComponent(task.task_id) + '/market">浏览模板市场选择模板(可预览)</a>' +
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
        profile: $('#f-profile').value,
        canvas: $('#f-canvas').value || null,
        page_count: pageCountRaw === 'null' || pageCountRaw === '' ? null : parseInt(pageCountRaw, 10),
        primary_language: $('#f-language').value,
        speaker_notes: $('#f-notes').checked,
        image_policy: $('#f-image-policy').value
      }
    };
  }

  function templateSummaryHtml(task) {
    var sel = task.template_selection || {};
    if (sel.mode !== 'templates' || !sel.selections || !sel.selections.length) {
      return '<span class="hint">当前:自由设计(未选模板)</span>';
    }
    var parts = sel.selections.map(function (item) {
      return esc(item.kind) + ' · ' + esc(item.id);
    });
    return '<div>已选择:' + parts.join(' + ') + '</div>';
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
      ['生成方式', optionLabel(optionsCache && optionsCache.profiles, p.profile)],
      ['画幅', optionLabel(optionsCache && optionsCache.canvas, p.canvas)],
      ['页数', p.page_count == null ? '由 AI 决定' : String(p.page_count)],
      ['语言', optionLabel(optionsCache && optionsCache.languages, p.primary_language)],
      ['配图策略', optionLabel(optionsCache && optionsCache.image_policies, p.image_policy)],
      ['讲者备注', p.speaker_notes ? '开启' : '关闭'],
      ['面向受众', r.audience || '—'],
      ['语气风格', r.tone || '—'],
      ['附加要求', r.extra || '—']
    ];
    if (task.error) rows.push(['错误信息', task.error]);
    if (task.project_dir) rows.push(['项目目录', task.project_dir]);
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
        $('#template-summary').innerHTML = templateSummaryHtml(task);
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

  // ---------- template market view ----------

  var KIND_LABELS = { brand: '品牌', style: '风格', layout: '版式', deck: '成品' };
  var KIND_ORDER = ['deck', 'layout', 'brand', 'style'];

  function tokenSample(name, topic) {
    var samples = {
      TITLE: (topic || '演示标题').slice(0, 24),
      SUBTITLE: '副标题示例',
      AUTHOR: '作者名称',
      DATE: new Date().toISOString().slice(0, 10),
      PAGE_NUM: '1',
      TOTAL_PAGES: 'N',
      SECTION_TITLE: '章节标题',
      SECTION_SUBTITLE: '章节副标题',
      CONTENT_TITLE: '内容标题',
      TOPIC: (topic || '主题').slice(0, 24),
      KICKER: '引导语示例',
      SOURCE: '资料来源示例',
      FOOTER: '页脚示例'
    };
    if (samples[name] != null) return samples[name];
    var pretty = name.toLowerCase().replace(/_/g, ' ');
    return pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }

  function svgPreviewText(svgText, imagesPrefix, topic) {
    var text = svgText.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (all, name) {
      return tokenSample(name, topic);
    });
    if (imagesPrefix) {
      text = text.replace(/\.\.\/images\//g, imagesPrefix + '/images/');
    }
    return text;
  }

  function templateCardMeta(card) {
    var bits = [];
    if (card.primary_color) {
      bits.push('<i class="color-dot" style="background:' + esc(card.primary_color) + '"></i>' +
        '<code>' + esc(card.primary_color) + '</code>');
    }
    if (card.canvas_format) bits.push(esc(card.canvas_format));
    if (card.page_count) bits.push(esc(card.page_count) + ' 页');
    return bits.join(' · ');
  }

  function templateCard(card, selected) {
    var keywords = (card.keywords || []).slice(0, 4).map(function (kw) {
      return '<span class="kw">' + esc(kw) + '</span>';
    }).join('');
    return (
      '<div class="tpl-card' + (selected ? ' tpl-selected' : '') + '" data-kind="' + esc(card.kind) + '" data-id="' + esc(card.id) + '">' +
      '<div class="tpl-card-head"><span class="tpl-name">' + esc(card.id) + '</span>' +
      (selected ? '<span class="badge badge-done">已选</span>' : '') + '</div>' +
      '<div class="tpl-kind">' + esc(KIND_LABELS[card.kind] || card.kind) + '</div>' +
      '<div class="tpl-summary">' + esc(card.summary || '') + '</div>' +
      '<div class="tpl-meta">' + templateCardMeta(card) + '</div>' +
      (keywords ? '<div class="tpl-kws">' + keywords + '</div>' : '') +
      '<div class="tpl-actions">' +
      '<button class="btn btn-small" data-preview="' + esc(card.kind) + '/' + encodeURIComponent(card.id) + '">预览</button>' +
      (selected
        ? '<button class="btn btn-small btn-danger" data-unselect="' + esc(card.kind) + '">取消选择</button>'
        : '<button class="btn btn-small btn-primary" data-select="' + esc(card.kind) + '/' + encodeURIComponent(card.id) + '">选用</button>') +
      '</div>' +
      '</div>'
    );
  }

  function marketHtml(task, catalog, tab, selections) {
    var kinds = tab === 'all' ? KIND_ORDER : [tab];
    var cards = [];
    kinds.forEach(function (kind) {
      (catalog[kind] || []).forEach(function (card) {
        cards.push(templateCard(card, selections[kind] === card.id));
      });
    });
    var tabs = ['all'].concat(KIND_ORDER).map(function (key) {
      var label = key === 'all' ? '全部' : KIND_LABELS[key];
      return '<button class="tab' + (tab === key ? ' tab-active' : '') + '" data-tab="' + key + '">' + label + '</button>';
    }).join('');
    var chosen = KIND_ORDER.filter(function (kind) { return selections[kind]; })
      .map(function (kind) {
        return '<span class="chosen-chip">' + KIND_LABELS[kind] + ':' + esc(selections[kind]) +
          ' <a href="#" data-clear-kind="' + kind + '">✕</a></span>';
      }).join('');
    var readonly = task.status !== 'draft';
    return (
      '<section class="panel">' +
      '<div class="task-head">' +
      '<div><h2>模板市场</h2>' +
      '<div class="task-sub">任务 ' + esc(task.task_id) + (readonly ? ' · 已提交,以下为只读' : '') + '</div></div>' +
      '<a class="btn" href="#/task/' + encodeURIComponent(task.task_id) + '">← 返回配置</a>' +
      '</div>' +
      '<p class="hint">版式/成品模板按严格模式生成:模板的母版/版式层是冻结契约,可改的只有槽内容(文字/图片/图表数据)。</p>' +
      (readonly ? '' :
        '<div class="market-bar">' +
        '<label class="field-check"><input id="m-free" type="checkbox"' +
        (Object.keys(selections).length ? '' : ' checked') + '><span>自由设计(不使用模板)</span></label>' +
        '<div class="chosen">' + (chosen || '<span class="hint">尚未选择模板</span>') + '</div>' +
        '<button id="m-save" class="btn btn-primary">保存模板选择</button>' +
        '</div>') +
      '<div class="tabs">' + tabs + '</div>' +
      '<div class="tpl-grid">' + (cards.length ? cards.join('') :
        '<div class="empty">该分类暂无模板</div>') + '</div>' +
      '</section>' +
      '<div id="preview-modal" class="modal-backdrop" hidden><div class="modal">' +
      '<header class="modal-head"><strong id="modal-title"></strong>' +
      '<button class="btn btn-small" id="modal-close">关闭</button></header>' +
      '<div id="modal-body" class="modal-body"></div>' +
      '</div></div>'
    );
  }

  function renderPreviewModal(payload, topic, selected, onChoose) {
    var modal = $('#preview-modal');
    $('#modal-title').textContent = payload.id + '(' + (KIND_LABELS[payload.kind] || payload.kind) + ')';
    var body = $('#modal-body');
    var fmRows = Object.keys(payload.frontmatter || {}).map(function (key) {
      var value = payload.frontmatter[key];
      var swatch = /^#[0-9A-Fa-f]{3,8}$/.test(value)
        ? ' <i class="color-dot" style="background:' + esc(value) + '"></i>'
        : '';
      return '<tr><th>' + esc(key) + '</th><td>' + esc(value) + swatch + '</td></tr>';
    }).join('');

    var html = '';
    if (payload.summary) html += '<p class="tpl-summary">' + esc(payload.summary) + '</p>';
    if (fmRows) html += '<table class="kv-table">' + fmRows + '</table>';
    if (payload.roster && payload.roster.length) {
      html += '<p class="hint">共 ' + payload.roster.length + ' 页模板,占位符已替换为示例内容。' +
        (payload.kind === 'layout' || payload.kind === 'deck'
          ? ' 选用后按严格模式生成:母版/版式层为冻结契约,可改的只有槽内容(文字/图片/图表数据)。'
          : '') + '</p>' +
        '<div class="roster-grid" id="roster-grid">' +
        payload.roster.map(function (item) {
          return '<figure class="roster-item"><figcaption>' + esc(item.name) + '</figcaption>' +
            '<div class="roster-svg" data-svg-url="' + esc(item.svg_url) + '">加载中…</div></figure>';
        }).join('') + '</div>';
    } else if (payload.kind === 'brand' || payload.kind === 'style') {
      html += '<p class="hint">该类型无页面原型,以设计规范(色彩/字体/语气)参与生成。</p>';
    }
    if (payload.primary_color) {
      html += '<div class="tpl-meta">主色 <i class="color-dot" style="background:' +
        esc(payload.primary_color) + '"></i><code>' + esc(payload.primary_color) + '</code></div>';
    }
    if (onChoose) {
      html += '<div class="modal-actions"><button id="modal-choose" class="btn btn-primary">' +
        (selected ? '重新选用' : '选用此模板') + '</button></div>';
    }
    body.innerHTML = html;
    modal.hidden = false;

    Array.prototype.forEach.call(body.querySelectorAll('[data-svg-url]'), function (holder) {
      fetch(holder.getAttribute('data-svg-url'))
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.text();
        })
        .then(function (text) {
          holder.innerHTML = svgPreviewText(text, payload.images_url_prefix, topic);
        })
        .catch(function (err) {
          holder.innerHTML = '<div class="empty">SVG 加载失败:' + esc(err.message) + '</div>';
        });
    });

    $('#modal-close').addEventListener('click', function () { modal.hidden = true; });
    modal.addEventListener('click', function (event) {
      if (event.target === modal) modal.hidden = true;
    });
    var chooseBtn = $('#modal-choose');
    if (chooseBtn) chooseBtn.addEventListener('click', onChoose);
  }

  function showMarket(taskId, tab, selectionsArg) {
    Promise.all([
      api('GET', '/api/tasks/' + encodeURIComponent(taskId)),
      api('GET', '/api/templates')
    ]).then(function (results) {
      var task = results[0];
      var catalog = results[1];
      setConnState(false);
      var selections = selectionsArg || {};
      if (!Object.keys(selections).length) {
        var sel = task.template_selection || {};
        (sel.selections || []).forEach(function (item) { selections[item.kind] = item.id; });
      }
      tab = tab || 'all';
      render(marketHtml(task, catalog, tab, selections));

      var market = $('.panel');

      market.addEventListener('click', function (event) {
        var el;
        if ((el = event.target.closest('[data-tab]'))) {
          showMarket(taskId, el.getAttribute('data-tab'), selections);
          return;
        }
        if ((el = event.target.closest('[data-preview]'))) {
          var parts = el.getAttribute('data-preview').split('/');
          var kind = parts.shift();
          var id = decodeURIComponent(parts.join('/'));
          api('GET', '/api/templates/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id) + '/preview')
            .then(function (payload) {
              renderPreviewModal(payload, task.topic, selections[kind] === id, function () {
                selections[kind] = id;
                $('#preview-modal').hidden = true;
                showMarket(taskId, tab, selections);
              });
            })
            .catch(function (err) { notify('预览加载失败:' + err.message, true); });
          return;
        }
        if ((el = event.target.closest('[data-select]'))) {
          var selectParts = el.getAttribute('data-select').split('/');
          var selectKind = selectParts.shift();
          selections[selectKind] = decodeURIComponent(selectParts.join('/'));
          showMarket(taskId, tab, selections);
          return;
        }
        if ((el = event.target.closest('[data-unselect]'))) {
          delete selections[el.getAttribute('data-unselect')];
          showMarket(taskId, tab, selections);
          return;
        }
        if ((el = event.target.closest('[data-clear-kind]'))) {
          event.preventDefault();
          delete selections[el.getAttribute('data-clear-kind')];
          showMarket(taskId, tab, selections);
          return;
        }
      });

      var saveBtn = $('#m-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var freeChecked = $('#m-free').checked;
          var selectionPayload = {
            mode: freeChecked && !Object.keys(selections).length ? 'free_design' : 'templates',
            selections: KIND_ORDER.filter(function (kind) { return selections[kind]; })
              .map(function (kind) { return { kind: kind, id: selections[kind] }; })
          };
          if (selectionPayload.mode === 'templates' && !selectionPayload.selections.length) {
            notify('请至少选择一个模板,或勾选自由设计', true);
            return;
          }
          api('PATCH', '/api/tasks/' + encodeURIComponent(taskId), { template_selection: selectionPayload })
            .then(function () {
              notify('模板选择已保存');
              location.hash = '#/task/' + encodeURIComponent(taskId);
            })
            .catch(function (err) { notify('保存失败:' + err.message, true); });
        });
      }
    }).catch(function (err) {
      setConnState(true);
      render('<section class="panel"><h2>模板市场加载失败</h2><p>' + esc(err.message) + '</p></section>');
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

  function timelineHtml(progress) {
    var items = (progress.agent_log || []).map(function (entry) {
      return '<li><span class="tl-time">' + esc(entry.at || '') + '</span>' +
        '<span class="tl-event">' + esc(entry.event || '') + '</span></li>';
    }).join('');
    var bits = [];
    if (progress.confirm && progress.confirm.status) {
      bits.push('确认面板:' + esc(progress.confirm.status) +
        (progress.confirm.current_stage ? '(' + esc(progress.confirm.current_stage) + ')' : ''));
    }
    if (progress.quality) {
      bits.push(progress.quality.report_exists
        ? '质检报告已生成'
        : '质检报告未生成');
    }
    if (progress.slide_count) bits.push('已产出 ' + progress.slide_count + ' 页');
    if (progress.error) bits.push('<span class="err-text">' + esc(progress.error) + '</span>');
    return (
      '<div class="progress-state">' + (bits.join(' · ') || '等待 AI 处理…') + '</div>' +
      (items ? '<ol class="timeline">' + items + '</ol>' : '')
    );
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
          (progress.project_dir ? ' · ' + esc(progress.project_dir) : '') + '</div></div>' +
          '<a class="btn" href="#/task/' + encodeURIComponent(taskId) + '">任务详情</a>' +
          '</div>' +
          timelineHtml(progress) +
          '</section>' +
          '<section class="panel"><h3>页面预览(' + progress.slide_count + ')</h3>' + slidesHtml + '</section>' +
          '<section class="panel"><h3>导出文件</h3>' + exportsHtml(taskId, progress.exports) + '</section>' +
          (closed ? '' : '<section class="panel"><p class="hint">本页每 2 秒自动刷新。</p></section>')
        );
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
    var match = location.hash.match(/^#\/task\/([^/]+)\/market\/?$/);
    if (match) {
      showMarket(decodeURIComponent(match[1]));
      return;
    }
    match = location.hash.match(/^#\/task\/([^/]+)\/progress\/?$/);
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
