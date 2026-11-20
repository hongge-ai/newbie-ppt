/* Workbench native light-theme Stage 1 / Stage 2 Confirmation view. */
(function () {
  'use strict';

  var PALETTE_ROLES = [
    ['background', '背景色'],
    ['secondary_bg', '次级背景'],
    ['primary', '主色'],
    ['accent', '强调色'],
    ['secondary_accent', '辅强调色'],
    ['body_text', '正文色']
  ];

  var SIZE_ROLES = [
    ['title', '主标题', 1.75],
    ['subtitle', '副标题', 1.35],
    ['annotation', '注释字号', 0.78]
  ];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normHex(value) {
    var s = String(value || '').trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase();
    if (/^[0-9A-Fa-f]{6}$/.test(s)) return '#' + s.toUpperCase();
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
    }
    return '';
  }

  function hexForPicker(value) {
    return normHex(value) || '#1E293B';
  }

  function localized(obj, key) {
    if (!obj || typeof obj !== 'object') return '';
    return String(obj[key + '_zh'] || obj[key] || obj[key + '_en'] || '').trim();
  }

  function optLabel(opt) {
    if (!opt || typeof opt !== 'object') return String(opt || '');
    return localized(opt, 'label') || String(opt.id || '');
  }

  function optDesc(opt) {
    if (!opt || typeof opt !== 'object') return '';
    return localized(opt, 'desc') || String(opt.use_zh || opt.use || opt.purpose || '');
  }

  function recRaw(rec, key) {
    if (!rec) return null;
    var val = rec[key];
    if (val && typeof val === 'object' && 'value' in val && !Array.isArray(val)) {
      return val.value;
    }
    return val;
  }

  function recId(rec, key) {
    if (rec && rec.recommend && rec.recommend[key] != null) {
      return rec.recommend[key];
    }
    var raw = recRaw(rec, key);
    if (raw && typeof raw === 'object' && raw.id) return raw.id;
    return typeof raw === 'string' ? raw : '';
  }

  function recBool(rec, key, fallback) {
    var raw = recRaw(rec, key);
    if (typeof raw === 'boolean') return raw;
    if (rec && rec.recommend && typeof rec.recommend[key] === 'boolean') {
      return rec.recommend[key];
    }
    return fallback;
  }

  function recLang(rec) {
    var raw = rec && (rec.primary_language || rec.content_language || rec.language);
    if (raw && typeof raw === 'object') raw = raw.value || raw.id || raw.code || '';
    return String(raw || 'zh-CN').trim().replace(/_/g, '-');
  }

  function isEnglishLang(lang) {
    return /^en(?:-|$)/i.test(String(lang || ''));
  }

  function isPptCanvas(canvas) {
    var id = String(canvas || '').toLowerCase();
    return id === 'ppt169' || id === 'ppt43';
  }

  function defaultBodyPx(purpose) {
    if (purpose === 'text') return 20;
    if (purpose === 'presentation') return 32;
    return 24;
  }

  function roundSize(value) {
    return Math.round(value * 100) / 100;
  }

  function deriveRoleSize(ratio, bodyVal, canvas) {
    var raw = (Number(bodyVal) || 24) * ratio;
    return isPptCanvas(canvas) ? Math.round(raw / 2) * 2 : Math.round(raw);
  }

  function normPalette(src) {
    src = src || {};
    var p = (src.palette && typeof src.palette === 'object') ? src.palette : src;
    return {
      background: p.background || p.bg || '',
      secondary_bg: p.secondary_bg || p.secondary_background || p.card_bg || p.card_background || '',
      primary: p.primary || '',
      accent: p.accent || '',
      secondary_accent: p.secondary_accent || p.secondary || '',
      body_text: p.body_text || p.text || ''
    };
  }

  function normTypography(src, englishPrimary, canvas, purpose, fontsCatalog) {
    src = src || {};
    var bodySizeRaw = src.body_size || src.body_baseline || src.body_px ||
      (src.sizes && src.sizes.body) || '';
    var bodySize = parseFloat(String(bodySizeRaw).replace(/px$/i, ''));
    if (!isFinite(bodySize) || bodySize <= 0) bodySize = defaultBodyPx(purpose);

    function findFontCss(id) {
      var list = Array.isArray(fontsCatalog) ? fontsCatalog : [];
      var needle = String(id || '').trim().toLowerCase();
      for (var i = 0; i < list.length; i += 1) {
        if (String(list[i].id || '').trim().toLowerCase() === needle && list[i].css) {
          return String(list[i].css);
        }
      }
      return 'sans-serif';
    }

    function normRole(roleObj, legacyPrimary, legacyEnglish, legacyCss) {
      var slot = (roleObj && typeof roleObj === 'object') ? Object.assign({}, roleObj) : {};
      var primary = slot.primary || (englishPrimary ? (slot.latin || slot.cjk || legacyPrimary) : (slot.cjk || legacyPrimary)) || '';
      var english = englishPrimary ? '' : (slot.english || slot.latin || legacyEnglish || '');
      var css = String(slot.css || legacyCss || findFontCss(primary)).trim() || 'sans-serif';
      var out = {
        primary: String(primary),
        css: css,
        sample_primary: String(slot.sample_primary || ''),
        sample_english: String(slot.sample_english || '')
      };
      if (!englishPrimary) out.english = String(english);
      else delete out.sample_english;
      return out;
    }

    var heading = normRole(src.heading, src.heading_latin || src.heading, src.heading_latin, src.heading_css);
    var body = normRole(src.body, src.body_latin || src.body, src.body_latin, src.body_css);
    var rawSizes = (src.sizes && typeof src.sizes === 'object') ? src.sizes : {};
    var sizes = {};
    SIZE_ROLES.forEach(function (pair) {
      var r = pair[0], ratio = pair[2];
      var parsed = parseFloat(rawSizes[r]);
      sizes[r] = (isFinite(parsed) && parsed > 0) ? roundSize(parsed) : deriveRoleSize(ratio, bodySize, canvas);
    });
    return {
      name: localized(src, 'name') || src.name || '',
      heading: heading,
      body: body,
      body_size: roundSize(bodySize),
      body_size_unit: 'px',
      sizes: sizes,
      note: localized(src, 'note') || src.note || ''
    };
  }

  function normImageStrategy(src) {
    src = src || {};
    var out = {
      name: localized(src, 'name') || src.name || '',
      rendering: String(src.rendering || ''),
      visual: localized(src, 'visual') || String(src.visual || ''),
      mood: localized(src, 'mood') || String(src.mood || '')
    };
    var behavior = localized(src, 'behavior') || src.behavior || src.custom || '';
    if (behavior) out.behavior = String(behavior);
    return out;
  }

  function flattenVisualStyles(catalogs) {
    var list = [];
    (catalogs && catalogs.visual_styles || []).forEach(function (g) {
      var groupName = localized(g, 'group') || g.group || '';
      (g.items || []).forEach(function (item) {
        if (!item || !item.id) return;
        list.push({
          id: String(item.id),
          label: optLabel(item),
          desc: optDesc(item),
          group: groupName
        });
      });
    });
    return list;
  }

  function findById(list, id) {
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i += 1) {
      if (arr[i].items) {
        var found = findById(arr[i].items, id);
        if (found) return found;
      } else if (arr[i] && arr[i].id === id) {
        return arr[i];
      }
    }
    return null;
  }

  function fetchJson(url, opts) {
    return fetch(url, Object.assign({ cache: 'no-store' }, opts || {})).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          throw new Error((data && data.error) || ('HTTP ' + res.status));
        }
        return data || {};
      });
    });
  }

  function groupExplicitByWorkspace(explicit) {
    var groups = [];
    var byRoot = {};
    (Array.isArray(explicit) ? explicit : []).forEach(function (item) {
      if (!item || !item.key) return;
      var root = item.workspace_root ? ('root:' + item.workspace_root) : ('key:' + item.key);
      var g = byRoot[root];
      if (!g) {
        g = {
          workspace_root: item.workspace_root || '',
          keys: [],
          kinds: [],
          items: []
        };
        byRoot[root] = g;
        groups.push(g);
      }
      g.items.push(item);
      if (g.keys.indexOf(item.key) < 0) g.keys.push(item.key);
      if (item.kind && g.kinds.indexOf(item.kind) < 0) g.kinds.push(item.kind);
    });
    return groups;
  }

  function validateTemplateSelection(mode, selectedKeys, candidates) {
    if (mode !== 'templates') return { valid: true };
    var keys = Array.isArray(selectedKeys) ? selectedKeys.filter(Boolean) : [];
    if (!keys.length) {
      return { valid: false, error: '请至少选择一个模板，或切回「AI 自由设计」' };
    }
    var byKey = {};
    (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
      if (c && c.key) byKey[c.key] = c;
    });
    var seenKinds = [];
    for (var i = 0; i < keys.length; i += 1) {
      var item = byKey[keys[i]];
      if (!item || !item.kind) continue;
      if (seenKinds.indexOf(item.kind) >= 0) {
        return {
          valid: false,
          error: '同一模板类型（' + item.kind + '）不能重复选择，请仅保留一个'
        };
      }
      seenKinds.push(item.kind);
    }
    if (seenKinds.indexOf('deck') >= 0 && seenKinds.length > 1) {
      return {
        valid: false,
        error: '整套模板（deck）不能与 brand / style / layout 同时混选'
      };
    }
    return { valid: true };
  }

  function mount(container, opts) {
    opts = opts || {};
    var slug = opts.slug || '';
    var apiBase = (opts.apiBase || ('/p/' + encodeURIComponent(slug) + '/confirm')).replace(/\/+$/, '');
    var mode = opts.mode === 'inline' ? 'inline' : 'standalone';
    var onConfirmed = typeof opts.onConfirmed === 'function' ? opts.onConfirmed : null;
    var onBackToOutline = typeof opts.onBackToOutline === 'function' ? opts.onBackToOutline : null;

    var destroyed = false;
    var pollTimer = null;
    var modalEl = null;
    var keyCleanup = null;

    var SESSION = null;
    var REC = null;
    var CAT = null;
    var ICON_PREVIEWS = {};
    var AI_COMPARE = {};
    var STAGE = 0;
    var STATE = {};
    var ACTIVE_DIR_IDX = 0;
    var DIR_BASELINES = [];
    var SIZE_PINNED = { body: false, title: false, subtitle: false, annotation: false };
    var STAGE1_TEMPLATE_MODE = 'free_design';
    var STAGE1_SELECTED_KEYS = [];

    function api(path, fetchOpts) {
      return fetchJson(apiBase + path, fetchOpts);
    }

    function stopPolling() {
      if (pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function closeModal() {
      if (modalEl) {
        modalEl.remove();
        modalEl = null;
      }
      if (keyCleanup) {
        keyCleanup();
        keyCleanup = null;
      }
    }

    function openStyleModal(styleItem) {
      closeModal();
      var renderer = window.WorkbenchStyleSlides;
      if (!renderer || !styleItem) return;
      var sampleCopy = (REC && REC.outline_preview) || null;
      var fallbackTitle = (REC && REC.display_title) || slug || '演示文稿预览';
      var slides = renderer.buildSlides(styleItem.id, sampleCopy, fallbackTitle);
      var swatch = renderer.swatchOf(styleItem.id);

      var ov = document.createElement('div');
      ov.className = 'tpl-modal-backdrop';
      ov.innerHTML =
        '<div class="tpl-modal" role="dialog" aria-modal="true">' +
        '  <div class="tpl-modal-head">' +
        '    <div class="tpl-modal-title">' +
        '      <i class="tpl-dot" style="background:' + esc(swatch) + '"></i>' +
        '      <strong>' + esc(styleItem.label) + '</strong>' +
        '      <span class="tpl-modal-sub">' + esc(styleItem.group || '') + ' · 4 类核心版面</span>' +
        '    </div>' +
        '    <button type="button" class="btn btn-small" data-modal-close>关闭</button>' +
        '  </div>' +
        '  <div class="tpl-modal-body">' +
        '    <div class="tpl-modal-grid is-style-4">' +
        slides.map(function (sl) {
          return '<div class="tpl-modal-slide">' +
            '<div class="tpl-modal-frame">' + sl.svg + '</div>' +
            '<span class="tpl-modal-cap">' + esc(sl.label) + '</span></div>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '</div>';
      ov.querySelector('[data-modal-close]').addEventListener('click', closeModal);
      ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
      var onKey = function (e) { if (e.key === 'Escape') closeModal(); };
      document.addEventListener('keydown', onKey);
      keyCleanup = function () { document.removeEventListener('keydown', onKey); };
      document.body.appendChild(ov);
      modalEl = ov;
    }

    function directionBaselineSnapshot(cand) {
      cand = cand || {};
      var lang = recLang(REC);
      var englishPrimary = isEnglishLang(lang);
      var canvas = STATE.canvas || recId(REC, 'canvas') || 'ppt169';
      var purpose = STATE.delivery_purpose || 'balanced';
      var typ = normTypography(cand.typography || {}, englishPrimary, canvas, purpose, (CAT && CAT.fonts) || []);
      return JSON.stringify({
        mode: cand.mode || '',
        mode_behavior: cand.mode === 'custom' ? (cand.mode_behavior || '') : '',
        visual_style: cand.visual_style || '',
        visual_style_behavior: cand.visual_style === 'custom' ? (cand.visual_style_behavior || '') : '',
        color: { name: (cand.color && cand.color.name) || '', palette: normPalette(cand.color || {}) },
        icons: cand.icons || '',
        typography: { heading: typ.heading, body: typ.body, body_size: typ.body_size, sizes: typ.sizes },
        image_strategy: normImageStrategy(cand.image_strategy || {})
      });
    }

    function currentDirectionSnapshot(cand) {
      cand = cand || {};
      return JSON.stringify({
        mode: STATE.mode || '',
        mode_behavior: STATE.mode === 'custom' ? (STATE.mode_behavior || '') : '',
        visual_style: STATE.visual_style || '',
        visual_style_behavior: STATE.visual_style === 'custom' ? (STATE.visual_style_behavior || '') : '',
        color: {
          name: (STATE.color && STATE.color.name) || '',
          palette: normPalette(STATE.color || {})
        },
        icons: STATE.icons || '',
        typography: STATE.typography ? {
          heading: STATE.typography.heading,
          body: STATE.typography.body,
          body_size: roundSize(parseFloat(STATE.typography.body_size) || 24),
          sizes: STATE.typography.sizes
        } : {},
        image_strategy: normImageStrategy(STATE.image_strategy || {})
      });
    }

    function applyDirection(idx) {
      var directions = (REC.design_directions && REC.design_directions.candidates) || [];
      var cand = directions[idx];
      if (!cand) return;
      ACTIVE_DIR_IDX = idx;
      var lang = STATE.primary_language || recLang(REC);
      var englishPrimary = isEnglishLang(lang);
      if (cand.mode) {
        STATE.mode = cand.mode;
        STATE.mode_behavior = cand.mode === 'custom' ? String(cand.mode_behavior || '') : '';
      }
      if (cand.visual_style) {
        STATE.visual_style = cand.visual_style;
        STATE.visual_style_behavior = cand.visual_style === 'custom' ? String(cand.visual_style_behavior || '') : '';
      }
      if (cand.color) {
        STATE.color = {
          name: localized(cand.color, 'name') || cand.color.name || '',
          palette: normPalette(cand.color)
        };
      }
      if (cand.icons) STATE.icons = String(cand.icons);
      if (cand.typography) {
        SIZE_PINNED = { body: false, title: false, subtitle: false, annotation: false };
        STATE.typography = normTypography(
          cand.typography, englishPrimary, STATE.canvas, STATE.delivery_purpose, (CAT && CAT.fonts) || []
        );
      }
      if (cand.image_strategy) {
        STATE.image_strategy = normImageStrategy(cand.image_strategy);
      }
    }

    function initStage1State() {
      var lang = recLang(REC);
      var optsObj = REC.template_options || {};
      var canvasId = recId(REC, 'canvas') || ((CAT.canvas && CAT.canvas[0] && CAT.canvas[0].id) || 'ppt169');
      STATE = {
        primary_language: lang,
        canvas: canvasId,
        audience: String(recRaw(REC, 'audience') || ''),
        communication_intent: String(recRaw(REC, 'communication_intent') || ''),
        audience_outcome: String(recRaw(REC, 'audience_outcome') || ''),
        core_message: String(recRaw(REC, 'core_message') || ''),
        delivery_context: String(recRaw(REC, 'delivery_context') || ''),
        artifact_afterlife: String(recRaw(REC, 'artifact_afterlife') || ''),
        content_divergence: String(recRaw(REC, 'content_divergence') || '')
      };
      STAGE1_TEMPLATE_MODE = optsObj.default_mode === 'templates' ? 'templates' : 'free_design';
      STAGE1_SELECTED_KEYS = Array.isArray(optsObj.preselected_keys)
        ? optsObj.preselected_keys.filter(Boolean)
        : [];
    }

    function initStage2State() {
      var lang = recLang(REC);
      var englishPrimary = isEnglishLang(lang);
      var canvas = recId(REC, 'canvas') || 'ppt169';
      var directions = (REC.design_directions && REC.design_directions.candidates) || [];
      var selectedIdx = Number(REC.design_directions && REC.design_directions.selected);
      if (!isFinite(selectedIdx) || selectedIdx < 0 || selectedIdx >= directions.length) selectedIdx = 0;

      var rawUsage = recRaw(REC, 'image_usage');
      var validUsageIds = (CAT.image_usage || []).map(function (item) { return item.id; });
      var usageArr = Array.isArray(rawUsage)
        ? rawUsage.filter(function (id) { return validUsageIds.indexOf(id) >= 0; })
        : (typeof rawUsage === 'string' && validUsageIds.indexOf(rawUsage) >= 0 ? [rawUsage] : []);
      if (!usageArr.length && validUsageIds.length) usageArr = [validUsageIds[0]];

      var genMode = recId(REC, 'generation_mode') || ((CAT.generation_mode && CAT.generation_mode[0] && CAT.generation_mode[0].id) || 'continuous');
      var refineSpec = recBool(REC, 'refine_spec', false);
      var specDepth = recRaw(REC, 'design_spec_depth') === 'complete' ? 'complete' : 'brief';
      if (genMode === 'split' || refineSpec) specDepth = 'complete';

      STATE = {
        primary_language: lang,
        canvas: canvas,
        audience: String(recRaw(REC, 'audience') || ''),
        communication_intent: String(recRaw(REC, 'communication_intent') || ''),
        audience_outcome: String(recRaw(REC, 'audience_outcome') || ''),
        core_message: String(recRaw(REC, 'core_message') || ''),
        delivery_context: String(recRaw(REC, 'delivery_context') || ''),
        artifact_afterlife: String(recRaw(REC, 'artifact_afterlife') || ''),
        content_divergence: String(recRaw(REC, 'content_divergence') || ''),
        delivery_purpose: recId(REC, 'delivery_purpose') || 'balanced',
        page_count: String(recRaw(REC, 'page_count') || ''),
        mode: recId(REC, 'mode') || ((CAT.modes && CAT.modes[0] && CAT.modes[0].id) || 'pyramid'),
        mode_behavior: '',
        visual_style: recId(REC, 'visual_style') || 'soft-rounded',
        visual_style_behavior: '',
        color: { name: '', palette: {} },
        icons: recId(REC, 'icons') || ((CAT.icons && CAT.icons[0] && CAT.icons[0].id) || 'tabler-outline'),
        typography: normTypography({}, englishPrimary, canvas, recId(REC, 'delivery_purpose') || 'balanced', CAT.fonts),
        image_usage: usageArr,
        image_notes: String(recRaw(REC, 'image_notes') || ''),
        image_ai_path: recId(REC, 'image_ai_path') || ((CAT.image_ai_path && CAT.image_ai_path[0] && CAT.image_ai_path[0].id) || 'auto'),
        image_strategy: { name: '', rendering: 'corporate-photo', visual: '', mood: '' },
        generation_mode: genMode,
        refine_spec: refineSpec,
        design_spec_depth: specDepth,
        proactive_speaker_notes: recBool(REC, 'proactive_speaker_notes', true),
        proactive_custom_animations: recBool(REC, 'proactive_custom_animations', false),
        proactive_narration_audio: recBool(REC, 'proactive_narration_audio', false)
      };

      if (REC.template_application != null) {
        var tplApp = recRaw(REC, 'template_application');
        if (tplApp != null) STATE.template_application = String(tplApp);
      }

      SIZE_PINNED = { body: false, title: false, subtitle: false, annotation: false };
      DIR_BASELINES = directions.map(directionBaselineSnapshot);
      if (directions.length) {
        applyDirection(selectedIdx);
      } else {
        if (REC.color) {
          STATE.color = {
            name: localized(REC.color, 'name') || REC.color.name || '',
            palette: normPalette(REC.color)
          };
          if (REC.color.name === 'custom' && REC.color.custom) {
            STATE.color.custom = String(REC.color.custom);
          }
        }
        if (REC.typography) {
          STATE.typography = normTypography(
            REC.typography, englishPrimary, canvas, STATE.delivery_purpose, (CAT && CAT.fonts) || []
          );
        }
        if (REC.image_strategy) {
          STATE.image_strategy = normImageStrategy(REC.image_strategy);
        }
      }
    }

    function renderWaiting(title, hint, autoPoll) {
      container.innerHTML =
        '<div class="card">' +
        '  <h2>' + esc(title) + '</h2>' +
        '  <p class="card-hint">' + esc(hint) + '</p>' +
        '  <div class="loading">等待中…</div>' +
        '</div>';
      if (autoPoll) {
        stopPolling();
        pollTimer = window.setTimeout(boot, 1500);
      }
    }

    function renderDoneCard() {
      var backHref = opts.taskId ? ('#/task/' + encodeURIComponent(opts.taskId)) : ('#/project/' + encodeURIComponent(slug) + '/preview');
      var previewHref = opts.taskId ? ('#/task/' + encodeURIComponent(opts.taskId) + '/preview') : ('#/project/' + encodeURIComponent(slug) + '/preview');
      container.innerHTML =
        '<div class="card">' +
        '  <h2>设计方案已确认</h2>' +
        '  <p class="card-hint">最终设计规格与配色方案已写入 confirm_ui/result.json。</p>' +
        '  <div class="actions">' +
        '    <a class="btn btn-primary" href="' + esc(backHref) + '">返回任务页</a>' +
        '    <a class="btn" href="' + esc(previewHref) + '">查看页面预览</a>' +
        '  </div>' +
        '</div>';
    }

    function renderErrorCard(msg) {
      container.innerHTML =
        '<div class="card">' +
        '  <h2>方案数据加载失败</h2>' +
        '  <p class="hint">' + esc(msg) + '</p>' +
        '  <div class="actions"><button type="button" class="btn" data-retry>重试</button></div>' +
        '</div>';
      var btn = container.querySelector('[data-retry]');
      if (btn) btn.addEventListener('click', boot);
    }

    function renderStage1() {
      var tplOpts = REC.template_options || {};
      var library = tplOpts.library || {};
      var explicit = tplOpts.explicit || [];
      var explicitGroups = groupExplicitByWorkspace(explicit);
      var explicitKeySet = {};
      explicit.forEach(function (item) {
        if (item && item.key) explicitKeySet[item.key] = true;
      });
      var allVisual = [];
      ['deck', 'layout', 'brand', 'style'].forEach(function (kind) {
        (library[kind] || []).forEach(function (item) {
          allVisual.push(item);
        });
      });
      var allCandidates = explicit.concat(allVisual);

      var commFields = [
        ['audience', '目标受众', 2],
        ['communication_intent', '沟通目的', 2],
        ['audience_outcome', '预期听众收获', 2],
        ['core_message', '核心主旨', 2],
        ['delivery_context', '演讲场景', 2],
        ['artifact_afterlife', '后续复用定位', 2],
        ['content_divergence', '补充差异约束（可选）', 2]
      ];

      var explicitHtml = explicitGroups.map(function (grp, gIdx) {
        var allPicked = grp.keys.length > 0 && grp.keys.every(function (k) {
          return STAGE1_SELECTED_KEYS.indexOf(k) >= 0;
        });
        var label = (grp.items[0] && (grp.items[0].label || grp.items[0].id)) || grp.workspace_root || grp.keys.join('+');
        var kindNote = grp.kinds.length ? (' · ' + grp.kinds.join('/')) : '';
        return '<button type="button" class="s2-chip' + (allPicked ? ' is-selected' : '') +
          '" data-s1-tpl-group="' + gIdx + '">' + esc(label + kindNote) + '</button>';
      }).join('');

      var libHtml = allVisual.filter(function (item) {
        return item && item.key && !explicitKeySet[item.key];
      }).map(function (item) {
        var key = item.key || '';
        var active = STAGE1_SELECTED_KEYS.indexOf(key) >= 0 ? ' is-selected' : '';
        return '<button type="button" class="s2-chip' + active + '" data-s1-tpl="' + esc(key) + '">' +
          esc(item.label || item.id || key) + '</button>';
      }).join('');

      container.innerHTML =
        '<div class="card s2-card">' +
        '  <div class="proposal-outline-bar">' +
        '    <div class="proposal-outline-info">' +
        '      <span class="proposal-outline-ok">Stage 1 · 沟通契约与模板基础</span>' +
        '      <strong>' + esc(REC.display_title || slug) + '</strong>' +
        '    </div>' +
        '  </div>' +
        '  <div class="s2-section">' +
        '    <div class="s2-sec-head"><h3>沟通契约</h3><span>将作为后续设计规格与每页绘制的依据</span></div>' +
        '    <div class="s2-grid-2">' +
        commFields.map(function (pair) {
          return '<label class="field"><span>' + esc(pair[1]) + '</span>' +
            '<textarea data-s1-field="' + esc(pair[0]) + '" rows="' + pair[2] + '">' +
            esc(STATE[pair[0]] || '') + '</textarea></label>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '  <div class="s2-section">' +
        '    <div class="s2-sec-head"><h3>画幅</h3></div>' +
        '    <div class="s2-chip-row">' +
        (CAT.canvas || []).map(function (c) {
          var active = STATE.canvas === c.id ? ' is-selected' : '';
          return '<button type="button" class="s2-chip' + active + '" data-s1-canvas="' + esc(c.id) + '">' +
            esc(optLabel(c)) + (c.dim ? ' · ' + esc(c.dim) : '') + '</button>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '  <div class="s2-section">' +
        '    <div class="s2-sec-head"><h3>设计方式</h3></div>' +
        '    <div class="s2-chip-row">' +
        '      <button type="button" class="s2-chip' + (STAGE1_TEMPLATE_MODE === 'free_design' ? ' is-selected' : '') + '" data-s1-mode="free_design">AI 自由设计</button>' +
        '      <button type="button" class="s2-chip' + (STAGE1_TEMPLATE_MODE === 'templates' ? ' is-selected' : '') + '" data-s1-mode="templates">使用模板库</button>' +
        '    </div>' +
        '    <div id="s1-tpl-list" class="s2-tpl-list" ' + (STAGE1_TEMPLATE_MODE === 'templates' ? '' : 'hidden') + '>' +
        explicitHtml + libHtml +
        '    </div>' +
        '  </div>' +
        '  <div class="s2-submit-bar">' +
        '    <span class="s2-status-msg" data-s1-status></span>' +
        '    <button type="button" class="btn btn-primary" data-s1-submit>确认契约并进入 Stage 2 →</button>' +
        '  </div>' +
        '</div>';

      container.querySelectorAll('[data-s1-field]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          STATE[inp.getAttribute('data-s1-field')] = inp.value;
        });
      });
      container.querySelectorAll('[data-s1-canvas]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          STATE.canvas = btn.getAttribute('data-s1-canvas');
          renderStage1();
        });
      });
      container.querySelectorAll('[data-s1-mode]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          STAGE1_TEMPLATE_MODE = btn.getAttribute('data-s1-mode');
          renderStage1();
        });
      });
      container.querySelectorAll('[data-s1-tpl-group]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var gIdx = parseInt(btn.getAttribute('data-s1-tpl-group'), 10);
          var grp = explicitGroups[gIdx];
          if (!grp) return;
          var allPicked = grp.keys.length > 0 && grp.keys.every(function (k) {
            return STAGE1_SELECTED_KEYS.indexOf(k) >= 0;
          });
          if (allPicked) {
            STAGE1_SELECTED_KEYS = STAGE1_SELECTED_KEYS.filter(function (k) {
              return grp.keys.indexOf(k) < 0;
            });
          } else {
            grp.keys.forEach(function (k) {
              if (STAGE1_SELECTED_KEYS.indexOf(k) < 0) STAGE1_SELECTED_KEYS.push(k);
            });
          }
          renderStage1();
        });
      });
      container.querySelectorAll('[data-s1-tpl]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-s1-tpl');
          var idx = STAGE1_SELECTED_KEYS.indexOf(key);
          if (idx >= 0) STAGE1_SELECTED_KEYS.splice(idx, 1);
          else STAGE1_SELECTED_KEYS.push(key);
          renderStage1();
        });
      });
      container.querySelector('[data-s1-submit]').addEventListener('click', function () {
        var statusEl = container.querySelector('[data-s1-status]');
        var check = validateTemplateSelection(STAGE1_TEMPLATE_MODE, STAGE1_SELECTED_KEYS, allCandidates);
        if (!check.valid) {
          statusEl.textContent = check.error;
          return;
        }
        var submitBtn = container.querySelector('[data-s1-submit]');
        submitBtn.disabled = true;
        statusEl.textContent = '提交中…';
        var payload = {
          stage: 'stage1',
          primary_language: STATE.primary_language,
          canvas: STATE.canvas,
          audience: STATE.audience,
          communication_intent: STATE.communication_intent,
          audience_outcome: STATE.audience_outcome,
          core_message: STATE.core_message,
          delivery_context: STATE.delivery_context,
          artifact_afterlife: STATE.artifact_afterlife,
          content_divergence: STATE.content_divergence,
          options_sha256: (REC.template_options || {}).options_sha256,
          template_selection: {
            mode: STAGE1_TEMPLATE_MODE,
            selection_keys: STAGE1_TEMPLATE_MODE === 'templates' ? STAGE1_SELECTED_KEYS.slice() : []
          }
        };
        api('/api/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function () {
          if (destroyed) return;
          renderWaiting('Stage 1 已确认，AI 正在生成完整设计方案…', '正在生成配色、字体与配图推荐（Stage 2），完成后自动显示。', true);
        }).catch(function (err) {
          if (destroyed) return;
          submitBtn.disabled = false;
          statusEl.textContent = '提交失败：' + err.message;
        });
      });
    }

    function renderStylePreviewBar() {
      var pal = normPalette(STATE.color || {});
      var bg = normHex(pal.background) || '#FAF7F2';
      var secBg = normHex(pal.secondary_bg) || '#F0EBE1';
      var pri = normHex(pal.primary) || '#1E293B';
      var acc = normHex(pal.accent) || '#004EA2';
      var secAcc = normHex(pal.secondary_accent) || '#2E6B7E';
      var body = normHex(pal.body_text) || pri;
      var typ = STATE.typography || {};
      var hFont = typ.heading && typ.heading.primary ? (typ.heading.primary + ', ' + (typ.heading.css || 'sans-serif')) : 'sans-serif';
      var bFont = typ.body && typ.body.primary ? (typ.body.primary + ', ' + (typ.body.css || 'sans-serif')) : 'sans-serif';
      var bodyPx = parseFloat(typ.body_size) || 24;
      var titlePx = (typ.sizes && parseFloat(typ.sizes.title)) || deriveRoleSize(1.75, bodyPx, STATE.canvas);

      return '<div class="s2-live-banner" style="background:' + esc(bg) + ';color:' + esc(body) + ';border-color:' + esc(secBg) + '">' +
        '  <div class="s2-live-sample">' +
        '    <span class="s2-live-kicker" style="color:' + esc(acc) + '">LIVE PALETTE &amp; TYPE · ' + esc(STATE.color && STATE.color.name ? STATE.color.name : '当前配色') + '</span>' +
        '    <div class="s2-live-title" style="color:' + esc(pri) + ';font-family:' + esc(hFont) + '">标题字体示例：' + esc((typ.heading && typ.heading.primary) || '默认') + '（' + esc(titlePx) + 'px）</div>' +
        '    <div class="s2-live-body" style="color:' + esc(body) + ';font-family:' + esc(bFont) + '">正文字体示例：' + esc((typ.body && typ.body.primary) || '默认') + '（' + esc(bodyPx) + 'px） · 主强调 ' + esc(acc) + ' / 辅强调 ' + esc(secAcc) + '</div>' +
        '  </div>' +
        '  <div class="s2-live-dots">' +
        PALETTE_ROLES.map(function (pair) {
          var hex = normHex(pal[pair[0]]) || 'transparent';
          return '<span class="s2-live-dot" title="' + esc(pair[1] + ': ' + hex) + '" style="background:' + esc(hex) + '"></span>';
        }).join('') +
        '  </div>' +
        '</div>';
    }

    function renderStage2() {
      var directions = (REC.design_directions && REC.design_directions.candidates) || [];
      var recommendedDirIdx = Number(REC.design_directions && REC.design_directions.selected);
      if (!isFinite(recommendedDirIdx) || recommendedDirIdx < 0) recommendedDirIdx = 0;

      var lang = STATE.primary_language || recLang(REC);
      var englishPrimary = isEnglishLang(lang);
      var allVisualStyles = flattenVisualStyles(CAT);
      var renderer = window.WorkbenchStyleSlides;
      var sampleCopy = (REC && REC.outline_preview) || null;
      var fallbackTitle = (REC && REC.display_title) || slug || '演示文稿';
      var showAi = (STATE.image_usage || []).indexOf('ai') >= 0;
      var aiRenderings = (AI_COMPARE && Array.isArray(AI_COMPARE.rendering)) ? AI_COMPARE.rendering : [];
      var fontsList = (CAT && Array.isArray(CAT.fonts)) ? CAT.fonts : [];
      var activeDir = directions[ACTIVE_DIR_IDX] || {};
      var hasDirectionAdjusted = directions.length > 0 && currentDirectionSnapshot(activeDir) !== DIR_BASELINES[ACTIVE_DIR_IDX];
      var depthLocked = STATE.generation_mode === 'split' || STATE.refine_spec;

      var headerBar = mode === 'inline'
        ? '<div class="proposal-outline-bar">' +
          '  <div class="proposal-outline-info">' +
          '    <span class="proposal-outline-ok">微调配色与字体</span>' +
          '    <strong>AI 已按大纲与所选风格配好设计方案，可直接微调后开始绘制</strong>' +
          '  </div>' +
          (onBackToOutline ? '<button type="button" class="btn btn-small" data-s2-back>← 查看大纲</button>' : '') +
          '</div>'
        : '<div class="proposal-outline-bar">' +
          '  <div class="proposal-outline-info">' +
          '    <span class="proposal-outline-ok">Stage 2 · 最终设计方案确认</span>' +
          '    <strong>' + esc(REC.display_title || slug) + '</strong>' +
          '  </div>' +
          '</div>';

      var directionsHtml = '';
      if (directions.length) {
        directionsHtml =
          '<div class="s2-section">' +
          '  <div class="s2-sec-head"><h3>整体设计方向</h3><span>选择一套完整方案作为起点，下方可对色板、字体、图标和配图单项微调</span></div>' +
          '  <div class="s2-dir-grid">' +
          directions.map(function (cand, idx) {
            var isActive = idx === ACTIVE_DIR_IDX;
            var adjusted = isActive && hasDirectionAdjusted;
            var pal = normPalette(cand.color || {});
            var hName = cand.typography && cand.typography.heading && cand.typography.heading.primary;
            var bName = cand.typography && cand.typography.body && cand.typography.body.primary;
            var cls = 's2-dir-card' + (isActive ? (adjusted ? ' is-adjusted' : ' is-selected') : '');
            return '<div class="' + cls + '" data-dir-idx="' + idx + '" role="button" tabindex="0">' +
              '  <div class="s2-dir-head">' +
              '    <strong>' + esc(localized(cand, 'name') || ('方案 ' + (idx + 1))) + '</strong>' +
              (idx === recommendedDirIdx ? '<span class="tpl-badge is-free">★ AI 推荐</span>' : '') +
              (isActive ? '<span class="tpl-badge ' + (adjusted ? 'is-canvas' : 'is-deck') + '">' + (adjusted ? '已微调' : '当前') + '</span>' : '') +
              '  </div>' +
              '  <div class="s2-dir-swatches">' +
              PALETTE_ROLES.map(function (pair) {
                var hex = normHex(pal[pair[0]]);
                return hex ? '<span class="s2-swatch" style="background:' + esc(hex) + '" title="' + esc(pair[1] + ': ' + hex) + '"></span>' : '';
              }).join('') +
              '  </div>' +
              '  <div class="s2-dir-meta">' + esc([hName && bName ? (hName + ' + ' + bName) : '', cand.icons || ''].filter(Boolean).join(' · ')) + '</div>' +
              (localized(cand, 'note') ? '<p class="s2-dir-note">' + esc(localized(cand, 'note')) + '</p>' : '') +
              (adjusted ? '<button type="button" class="btn btn-small s2-dir-reset" data-dir-reset="' + idx + '">恢复该方案默认</button>' : '') +
              '</div>';
          }).join('') +
          '  </div>' +
          '</div>';
      }

      var pal = normPalette(STATE.color || {});
      var isCustomColor = STATE.color && STATE.color.name === 'custom';
      var colorHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>色板微调</h3><span>支持直接拾色或输入 HEX 色值</span>' +
        '    <label class="s2-inline-check"><input type="checkbox" data-s2-color-custom' + (isCustomColor ? ' checked' : '') + '> 仅写自然语言配色描述</label>' +
        '  </div>' +
        (isCustomColor
          ? '<textarea class="s2-textarea" rows="2" data-s2-color-custom-text placeholder="描述想要的整体配色方案……">' + esc((STATE.color && STATE.color.custom) || '') + '</textarea>'
          : '<div class="s2-palette-grid">' +
            PALETTE_ROLES.map(function (pair) {
              var role = pair[0], label = pair[1];
              var val = pal[role] || '';
              return '<div class="s2-pal-cell">' +
                '  <span class="s2-pal-label">' + esc(label) + '</span>' +
                '  <div class="s2-pal-inputs">' +
                '    <input type="color" data-pal-picker="' + esc(role) + '" value="' + esc(hexForPicker(val)) + '">' +
                '    <input type="text" data-pal-hex="' + esc(role) + '" value="' + esc(val) + '" placeholder="#000000">' +
                '  </div>' +
                '</div>';
            }).join('') +
            '</div>') +
        '</div>';

      var typ = STATE.typography || {};
      var typHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>字体与字号</h3><span>支持选择常用字体或直接输入已安装字体名称（单位 px）</span></div>' +
        '  <datalist id="s2-fonts-datalist">' +
        fontsList.map(function (f) {
          return '<option value="' + esc(f.id) + '">' + esc(optLabel(f)) + '</option>';
        }).join('') +
        '  </datalist>' +
        '  <div class="s2-type-grid">' +
        ['heading', 'body'].map(function (role) {
          var roleLabel = role === 'heading' ? '标题字体' : '正文字体';
          var slot = typ[role] || {};
          return '<div class="s2-type-card">' +
            '  <div class="s2-type-title">' + esc(roleLabel) + '</div>' +
            '  <label class="field"><span>主语言字体（primary）</span>' +
            '    <input type="text" list="s2-fonts-datalist" data-typ-role="' + role + '" data-typ-field="primary" value="' + esc(slot.primary || '') + '">' +
            '  </label>' +
            (englishPrimary ? '' :
              '<label class="field"><span>西文配对字体（english）</span>' +
              '  <input type="text" list="s2-fonts-datalist" data-typ-role="' + role + '" data-typ-field="english" value="' + esc(slot.english || '') + '">' +
              '</label>') +
            '  <label class="field"><span>CSS 回退族</span>' +
            '    <select data-typ-role="' + role + '" data-typ-field="css">' +
            ['sans-serif', 'serif', 'monospace'].map(function (cssOpt) {
              return '<option value="' + cssOpt + '"' + (slot.css === cssOpt ? ' selected' : '') + '>' + cssOpt + '</option>';
            }).join('') +
            '    </select>' +
            '  </label>' +
            '</div>';
        }).join('') +
        '  </div>' +
        '  <div class="s2-sizes-row">' +
        '    <label class="field"><span>正文字号（body_size, px）</span>' +
        '      <input type="number" min="8" max="256" step="1" data-typ-body-size value="' + esc(typ.body_size || 24) + '">' +
        '    </label>' +
        SIZE_ROLES.map(function (pair) {
          var role = pair[0], label = pair[1];
          var val = (typ.sizes && typ.sizes[role]) || '';
          return '<label class="field"><span>' + esc(label) + '（' + esc(role) + ', px）</span>' +
            '<input type="number" min="8" max="256" step="1" data-typ-size-role="' + esc(role) + '" value="' + esc(val) + '">' +
            '</label>';
        }).join('') +
        '  </div>' +
        '</div>';

      var isCustomStyle = STATE.visual_style === 'custom';
      var isCustomMode = STATE.mode === 'custom';
      var customStyleText = STATE.visual_style_behavior || (activeDir.visual_style === 'custom' ? activeDir.visual_style_behavior : '') || '';
      var customModeText = STATE.mode_behavior || (activeDir.mode === 'custom' ? activeDir.mode_behavior : '') || '';

      var styleModeHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>视觉风格与叙事模式</h3><span>可保留 AI 定制融合策略，或切换为固定预设风格</span></div>' +
        '  <div class="s2-subblock">' +
        '    <div class="s2-sub-label">视觉风格（visual_style）</div>' +
        '    <div class="s2-chip-row">' +
        (customStyleText ? '<button type="button" class="s2-chip' + (isCustomStyle ? ' is-selected' : '') + '" data-s2-vs="custom">★ AI 定制风格</button>' : '') +
        allVisualStyles.map(function (st) {
          var active = !isCustomStyle && STATE.visual_style === st.id ? ' is-selected' : '';
          var thumb = renderer ? renderer.renderThumbnail(st.id, sampleCopy, fallbackTitle) : '';
          return '<div class="s2-vs-chip' + active + '" data-s2-vs="' + esc(st.id) + '" role="button" tabindex="0">' +
            (thumb ? '<div class="s2-vs-thumb">' + thumb + '</div>' : '') +
            '<div class="s2-vs-info"><span>' + esc(st.label) + '</span>' +
            '<button type="button" class="tpl-zoom-btn" data-s2-vs-zoom="' + esc(st.id) + '">放大</button></div></div>';
        }).join('') +
        '    </div>' +
        (isCustomStyle
          ? '<label class="field s2-mt"><span>视觉风格执行说明（visual_style_behavior）</span>' +
            '<textarea rows="3" data-s2-vs-behavior>' + esc(STATE.visual_style_behavior || '') + '</textarea></label>'
          : '') +
        '  </div>' +
        '  <div class="s2-subblock">' +
        '    <div class="s2-sub-label">叙事模式（mode）</div>' +
        '    <div class="s2-chip-row">' +
        (customModeText ? '<button type="button" class="s2-chip' + (isCustomMode ? ' is-selected' : '') + '" data-s2-mode="custom">★ AI 定制叙事</button>' : '') +
        (CAT.modes || []).map(function (m) {
          var active = !isCustomMode && STATE.mode === m.id ? ' is-selected' : '';
          return '<button type="button" class="s2-chip' + active + '" data-s2-mode="' + esc(m.id) + '" title="' + esc(optDesc(m)) + '">' +
            esc(optLabel(m)) + '</button>';
        }).join('') +
        '    </div>' +
        (isCustomMode
          ? '<label class="field s2-mt"><span>叙事模式执行说明（mode_behavior）</span>' +
            '<textarea rows="2" data-s2-mode-behavior>' + esc(STATE.mode_behavior || '') + '</textarea></label>'
          : '') +
        '  </div>' +
        '</div>';

      var iconsHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>图标风格（icons）</h3></div>' +
        '  <div class="s2-icon-grid">' +
        (CAT.icons || []).map(function (ic) {
          var active = STATE.icons === ic.id ? ' is-selected' : '';
          var samples = (ICON_PREVIEWS && ICON_PREVIEWS[ic.id]) || [];
          var sampleHtml = samples.slice(0, 4).map(function (s) { return '<span class="s2-icon-svg">' + (s.svg || '') + '</span>'; }).join('');
          return '<button type="button" class="s2-icon-card' + active + '" data-s2-icon="' + esc(ic.id) + '">' +
            (sampleHtml ? '<div class="s2-icon-samples">' + sampleHtml + '</div>' : '') +
            '<div class="s2-icon-name">' + esc(optLabel(ic)) + '</div>' +
            '<div class="s2-icon-desc">' + esc(optDesc(ic)) + '</div>' +
            '</button>';
        }).join('') +
        '  </div>' +
        '</div>';

      var imgUsage = STATE.image_usage || [];
      var curRendering = (STATE.image_strategy && STATE.image_strategy.rendering) || '';
      var customImgText = (STATE.image_strategy && STATE.image_strategy.behavior) ||
        (activeDir.image_strategy && activeDir.image_strategy.behavior) || '';
      var imagesHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>配图来源与 AI 绘风</h3><span>可多选允许的配图来源；选择 AI 生图时可调画风与生成路径</span></div>' +
        '  <div class="s2-chip-row">' +
        (CAT.image_usage || []).map(function (u) {
          var active = imgUsage.indexOf(u.id) >= 0 ? ' is-selected' : '';
          return '<button type="button" class="s2-chip' + active + '" data-s2-usage="' + esc(u.id) + '">' +
            esc(optLabel(u)) + '</button>';
        }).join('') +
        '  </div>' +
        '  <label class="field s2-mt"><span>配图分布与取图策略说明（image_notes）</span>' +
        '    <textarea rows="2" data-s2-image-notes>' + esc(STATE.image_notes || '') + '</textarea>' +
        '  </label>' +
        (showAi
          ? '<div class="s2-ai-box">' +
            '  <div class="s2-grid-2">' +
            '    <label class="field"><span>AI 生图路径（image_ai_path）</span>' +
            '      <select data-s2-ai-path>' +
            (CAT.image_ai_path || []).map(function (p) {
              return '<option value="' + esc(p.id) + '"' + (STATE.image_ai_path === p.id ? ' selected' : '') + '>' +
                esc(optLabel(p)) + '</option>';
            }).join('') +
            '      </select>' +
            '    </label>' +
            '    <label class="field"><span>AI 视觉风格预设（rendering）</span>' +
            '      <select data-s2-ai-rendering>' +
            (customImgText ? '<option value="custom"' + (curRendering === 'custom' ? ' selected' : '') + '>★ AI 定制绘风 (custom)</option>' : '') +
            aiRenderings.map(function (r) {
              return '<option value="' + esc(r.id) + '"' + (curRendering === r.id ? ' selected' : '') + '>' +
                esc(optLabel(r) || r.id) + '</option>';
            }).join('') +
            '      </select>' +
            '    </label>' +
            '  </div>' +
            (curRendering === 'custom'
              ? '<label class="field s2-mt"><span>AI 定制绘风行为说明（image_strategy.behavior）</span>' +
                '<textarea rows="3" data-s2-img-behavior>' + esc((STATE.image_strategy && STATE.image_strategy.behavior) || '') + '</textarea></label>'
              : '<div class="s2-ai-preview-row">' +
                '<img src="' + esc(apiBase + '/ai-image-comparison/rendering/' + encodeURIComponent(curRendering) + '.webp') + '" alt="' + esc(curRendering) + '" onerror="this.style.display=\'none\'">' +
                '<div class="s2-ai-preview-meta"><strong>' + esc((findById(aiRenderings, curRendering) && optLabel(findById(aiRenderings, curRendering))) || curRendering) + '</strong>' +
                '<p>' + esc((findById(aiRenderings, curRendering) && optDesc(findById(aiRenderings, curRendering))) || '') + '</p></div></div>') +
            '</div>'
          : '') +
        '</div>';

      var paramsHtml =
        '<div class="s2-section">' +
        '  <div class="s2-sec-head"><h3>页数、阅读模式与模板规则</h3></div>' +
        '  <div class="s2-grid-2">' +
        '    <label class="field"><span>目标页数（page_count）</span>' +
        '      <input type="text" data-s2-page-count value="' + esc(STATE.page_count || '') + '" placeholder="如 12">' +
        '    </label>' +
        (isPptCanvas(STATE.canvas)
          ? '<label class="field"><span>阅读模式（delivery_purpose）</span>' +
            '  <select data-s2-purpose>' +
            (CAT.delivery_purpose || []).map(function (dp) {
              return '<option value="' + esc(dp.id) + '"' + (STATE.delivery_purpose === dp.id ? ' selected' : '') + '>' +
                esc(optLabel(dp)) + '</option>';
            }).join('') +
            '  </select>' +
            '</label>'
          : '') +
        '  </div>' +
        (STATE.template_application != null
          ? '<label class="field s2-mt"><span>模板应用策略（template_application）</span>' +
            '<textarea rows="2" data-s2-tpl-app>' + esc(STATE.template_application) + '</textarea></label>'
          : '') +
        '</div>';

      var advancedHtml =
        '<details class="s2-advanced">' +
        '  <summary>高级生成与交付选项（生成方式 / 讲者备注 / 动画 / 旁白音频）</summary>' +
        '  <div class="s2-adv-body">' +
        '    <div class="s2-grid-2">' +
        '      <label class="field"><span>生成方式（generation_mode）</span>' +
        '        <select data-s2-gen-mode>' +
        (CAT.generation_mode || []).map(function (gm) {
          return '<option value="' + esc(gm.id) + '"' + (STATE.generation_mode === gm.id ? ' selected' : '') + '>' +
            esc(optLabel(gm)) + '</option>';
        }).join('') +
        '        </select>' +
        '      </label>' +
        '      <label class="field"><span>Design Spec 深度' + (depthLocked ? '（分段/评审模式已自动锁定完整）' : '') + '</span>' +
        '        <select data-s2-spec-depth' + (depthLocked ? ' disabled' : '') + '>' +
        (CAT.design_spec_depth || []).map(function (sd) {
          return '<option value="' + esc(sd.id) + '"' + (STATE.design_spec_depth === sd.id ? ' selected' : '') + '>' +
            esc(optLabel(sd)) + '</option>';
        }).join('') +
        '        </select>' +
        '      </label>' +
        '    </div>' +
        '    <div class="s2-check-list">' +
        '      <label class="s2-check-item"><input type="checkbox" data-s2-bool="proactive_speaker_notes"' + (STATE.proactive_speaker_notes ? ' checked' : '') + '> 主动生成讲者备注（Speaker Notes）</label>' +
        '      <label class="s2-check-item"><input type="checkbox" data-s2-bool="proactive_custom_animations"' + (STATE.proactive_custom_animations ? ' checked' : '') + '> 主动配置自定义动画（Custom Animations）</label>' +
        '      <label class="s2-check-item"><input type="checkbox" data-s2-bool="proactive_narration_audio"' + (STATE.proactive_narration_audio ? ' checked' : '') + '> 主动生成配音旁白（Narration Audio）</label>' +
        '      <label class="s2-check-item"><input type="checkbox" data-s2-refine' + (STATE.refine_spec ? ' checked' : '') + '> 生成前暂停以人工精修 Design Spec（refine_spec）</label>' +
        '    </div>' +
        '  </div>' +
        '</details>';

      container.innerHTML =
        '<div class="card s2-card">' +
        headerBar +
        '<div data-s2-preview-host>' + renderStylePreviewBar() + '</div>' +
        directionsHtml +
        colorHtml +
        typHtml +
        styleModeHtml +
        iconsHtml +
        imagesHtml +
        paramsHtml +
        advancedHtml +
        '<div class="s2-submit-bar">' +
        '  <span class="s2-status-msg" data-s2-status></span>' +
        '  <button type="button" class="btn btn-primary" data-s2-submit>确认最终方案并开始生成 →</button>' +
        '</div>' +
        '</div>';

      wireStage2Events(directions, allVisualStyles, aiRenderings, englishPrimary);
    }

    function updatePreviewBanner() {
      var host = container.querySelector('[data-s2-preview-host]');
      if (host) host.innerHTML = renderStylePreviewBar();
    }

    function wireStage2Events(directions, allVisualStyles, aiRenderings, englishPrimary) {
      var backBtn = container.querySelector('[data-s2-back]');
      if (backBtn && onBackToOutline) {
        backBtn.addEventListener('click', onBackToOutline);
      }

      container.querySelectorAll('[data-dir-idx]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target && e.target.closest && e.target.closest('[data-dir-reset]')) return;
          var idx = parseInt(card.getAttribute('data-dir-idx'), 10);
          if (idx === ACTIVE_DIR_IDX) return;
          applyDirection(idx);
          renderStage2();
        });
      });

      container.querySelectorAll('[data-dir-reset]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-dir-reset'), 10);
          applyDirection(idx);
          renderStage2();
        });
      });

      var colorCustomCb = container.querySelector('[data-s2-color-custom]');
      if (colorCustomCb) {
        colorCustomCb.addEventListener('change', function () {
          if (colorCustomCb.checked) {
            STATE.color = { name: 'custom', custom: (STATE.color && STATE.color.custom) || '', palette: {} };
          } else {
            var fallbackDir = directions[ACTIVE_DIR_IDX] || {};
            STATE.color = {
              name: (fallbackDir.color && fallbackDir.color.name) || '自定义色板',
              palette: normPalette(fallbackDir.color || {})
            };
          }
          renderStage2();
        });
      }
      var colorCustomText = container.querySelector('[data-s2-color-custom-text]');
      if (colorCustomText) {
        colorCustomText.addEventListener('input', function () {
          STATE.color = { name: 'custom', custom: colorCustomText.value, palette: {} };
        });
      }

      container.querySelectorAll('[data-pal-picker]').forEach(function (picker) {
        var role = picker.getAttribute('data-pal-picker');
        var hexInp = container.querySelector('[data-pal-hex="' + role + '"]');
        picker.addEventListener('input', function () {
          if (!STATE.color) STATE.color = { name: 'custom', palette: {} };
          if (!STATE.color.palette) STATE.color.palette = {};
          STATE.color.palette[role] = picker.value.toUpperCase();
          if (hexInp) hexInp.value = picker.value.toUpperCase();
          updatePreviewBanner();
        });
      });
      container.querySelectorAll('[data-pal-hex]').forEach(function (hexInp) {
        var role = hexInp.getAttribute('data-pal-hex');
        var picker = container.querySelector('[data-pal-picker="' + role + '"]');
        hexInp.addEventListener('input', function () {
          if (!STATE.color) STATE.color = { name: 'custom', palette: {} };
          if (!STATE.color.palette) STATE.color.palette = {};
          STATE.color.palette[role] = hexInp.value.trim();
          var valid = normHex(hexInp.value);
          if (valid && picker) picker.value = valid;
          updatePreviewBanner();
        });
      });

      container.querySelectorAll('[data-typ-role]').forEach(function (inp) {
        var role = inp.getAttribute('data-typ-role');
        var field = inp.getAttribute('data-typ-field');
        inp.addEventListener('input', function () {
          if (!STATE.typography[role]) STATE.typography[role] = {};
          STATE.typography[role][field] = inp.value;
          updatePreviewBanner();
        });
        inp.addEventListener('change', function () {
          if (!STATE.typography[role]) STATE.typography[role] = {};
          STATE.typography[role][field] = inp.value;
          updatePreviewBanner();
        });
      });

      var bodySizeInp = container.querySelector('[data-typ-body-size]');
      if (bodySizeInp) {
        bodySizeInp.addEventListener('input', function () {
          var v = parseFloat(bodySizeInp.value);
          STATE.typography.body_size = bodySizeInp.value;
          SIZE_PINNED.body = bodySizeInp.value !== '';
          if (isFinite(v) && v > 0) {
            SIZE_ROLES.forEach(function (pair) {
              var role = pair[0], ratio = pair[2];
              if (!SIZE_PINNED[role]) {
                var derived = deriveRoleSize(ratio, v, STATE.canvas);
                STATE.typography.sizes[role] = derived;
                var el = container.querySelector('[data-typ-size-role="' + role + '"]');
                if (el) el.value = derived;
              }
            });
          }
          updatePreviewBanner();
        });
      }
      container.querySelectorAll('[data-typ-size-role]').forEach(function (inp) {
        var role = inp.getAttribute('data-typ-size-role');
        inp.addEventListener('input', function () {
          SIZE_PINNED[role] = inp.value !== '';
          STATE.typography.sizes[role] = inp.value;
          updatePreviewBanner();
        });
      });

      container.querySelectorAll('[data-s2-vs]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target && e.target.closest && e.target.closest('[data-s2-vs-zoom]')) return;
          STATE.visual_style = card.getAttribute('data-s2-vs');
          if (STATE.visual_style === 'custom' && !STATE.visual_style_behavior) {
            var d = directions[ACTIVE_DIR_IDX] || {};
            STATE.visual_style_behavior = d.visual_style_behavior || '';
          }
          renderStage2();
        });
      });
      container.querySelectorAll('[data-s2-vs-zoom]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-s2-vs-zoom');
          var item = allVisualStyles.filter(function (x) { return x.id === id; })[0];
          openStyleModal(item);
        });
      });
      var vsBeh = container.querySelector('[data-s2-vs-behavior]');
      if (vsBeh) vsBeh.addEventListener('input', function () { STATE.visual_style_behavior = vsBeh.value; });

      container.querySelectorAll('[data-s2-mode]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          STATE.mode = btn.getAttribute('data-s2-mode');
          if (STATE.mode === 'custom' && !STATE.mode_behavior) {
            var d = directions[ACTIVE_DIR_IDX] || {};
            STATE.mode_behavior = d.mode_behavior || '';
          }
          renderStage2();
        });
      });
      var modeBeh = container.querySelector('[data-s2-mode-behavior]');
      if (modeBeh) modeBeh.addEventListener('input', function () { STATE.mode_behavior = modeBeh.value; });

      container.querySelectorAll('[data-s2-icon]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          STATE.icons = btn.getAttribute('data-s2-icon');
          renderStage2();
        });
      });

      container.querySelectorAll('[data-s2-usage]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-s2-usage');
          var cur = (STATE.image_usage || []).slice();
          if (id === 'none') {
            cur = cur.indexOf('none') >= 0 ? [] : ['none'];
          } else {
            cur = cur.filter(function (x) { return x !== 'none'; });
            var idx = cur.indexOf(id);
            if (idx >= 0) cur.splice(idx, 1);
            else cur.push(id);
          }
          STATE.image_usage = cur;
          renderStage2();
        });
      });

      var imgNotes = container.querySelector('[data-s2-image-notes]');
      if (imgNotes) imgNotes.addEventListener('input', function () { STATE.image_notes = imgNotes.value; });

      var aiPath = container.querySelector('[data-s2-ai-path]');
      if (aiPath) aiPath.addEventListener('change', function () { STATE.image_ai_path = aiPath.value; });

      var aiRendering = container.querySelector('[data-s2-ai-rendering]');
      if (aiRendering) {
        aiRendering.addEventListener('change', function () {
          var val = aiRendering.value;
          var d = directions[ACTIVE_DIR_IDX] || {};
          if (val === 'custom' && d.image_strategy && d.image_strategy.rendering === 'custom') {
            STATE.image_strategy = normImageStrategy(d.image_strategy);
          } else {
            var preset = findById(aiRenderings, val);
            STATE.image_strategy = {
              name: preset ? optLabel(preset) : val,
              rendering: val,
              visual: (STATE.image_strategy && STATE.image_strategy.visual) || '',
              mood: (STATE.image_strategy && STATE.image_strategy.mood) || ''
            };
          }
          renderStage2();
        });
      }

      var imgBeh = container.querySelector('[data-s2-img-behavior]');
      if (imgBeh) {
        imgBeh.addEventListener('input', function () {
          if (!STATE.image_strategy) STATE.image_strategy = { rendering: 'custom' };
          STATE.image_strategy.behavior = imgBeh.value;
        });
      }

      var pageCnt = container.querySelector('[data-s2-page-count]');
      if (pageCnt) pageCnt.addEventListener('input', function () { STATE.page_count = pageCnt.value; });

      var purposeSel = container.querySelector('[data-s2-purpose]');
      if (purposeSel) {
        purposeSel.addEventListener('change', function () {
          STATE.delivery_purpose = purposeSel.value;
          if (!SIZE_PINNED.body) {
            var def = defaultBodyPx(STATE.delivery_purpose);
            STATE.typography.body_size = def;
            SIZE_ROLES.forEach(function (pair) {
              if (!SIZE_PINNED[pair[0]]) {
                STATE.typography.sizes[pair[0]] = deriveRoleSize(pair[2], def, STATE.canvas);
              }
            });
            renderStage2();
          }
        });
      }

      var tplApp = container.querySelector('[data-s2-tpl-app]');
      if (tplApp) tplApp.addEventListener('input', function () { STATE.template_application = tplApp.value; });

      var genModeSel = container.querySelector('[data-s2-gen-mode]');
      if (genModeSel) {
        genModeSel.addEventListener('change', function () {
          STATE.generation_mode = genModeSel.value;
          if (STATE.generation_mode === 'split' || STATE.refine_spec) {
            STATE.design_spec_depth = 'complete';
          }
          renderStage2();
        });
      }

      var specDepthSel = container.querySelector('[data-s2-spec-depth]');
      if (specDepthSel) {
        specDepthSel.addEventListener('change', function () {
          STATE.design_spec_depth = specDepthSel.value;
        });
      }

      var refineCb = container.querySelector('[data-s2-refine]');
      if (refineCb) {
        refineCb.addEventListener('change', function () {
          STATE.refine_spec = refineCb.checked;
          if (STATE.generation_mode === 'split' || STATE.refine_spec) {
            STATE.design_spec_depth = 'complete';
          }
          renderStage2();
        });
      }

      container.querySelectorAll('[data-s2-bool]').forEach(function (cb) {
        var key = cb.getAttribute('data-s2-bool');
        cb.addEventListener('change', function () {
          STATE[key] = cb.checked;
        });
      });

      var submitBtn = container.querySelector('[data-s2-submit]');
      var statusEl = container.querySelector('[data-s2-status]');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          submitStage2(submitBtn, statusEl, englishPrimary);
        });
      }
    }

    function submitStage2(submitBtn, statusEl, englishPrimary) {
      var payload = JSON.parse(JSON.stringify(STATE));
      payload.stage = 'final';
      if (!Array.isArray(payload.image_usage) || payload.image_usage.length === 0) {
        statusEl.textContent = '请至少选择一种配图来源';
        return;
      }
      if (payload.image_usage.indexOf('none') >= 0 && payload.image_usage.length > 1) {
        statusEl.textContent = '「无图片」与其他配图来源互斥';
        return;
      }
      if (!String(payload.image_notes || '').trim()) delete payload.image_notes;

      if (payload.image_usage.indexOf('ai') < 0) {
        delete payload.image_ai_path;
        delete payload.image_strategy;
      } else {
        var st = normImageStrategy(payload.image_strategy || {});
        if (!st.rendering) {
          statusEl.textContent = '包含 AI 配图时，请选择 AI 视觉风格';
          return;
        }
        if (st.rendering === 'custom' && !String(st.behavior || '').trim()) {
          statusEl.textContent = 'AI 定制绘风需要填写行为说明';
          return;
        }
        if (st.rendering !== 'custom') delete st.behavior;
        payload.image_strategy = st;
      }

      if (payload.mode !== 'custom') delete payload.mode_behavior;
      else if (!String(payload.mode_behavior || '').trim()) {
        statusEl.textContent = '定制叙事模式需要填写行为说明';
        return;
      }
      if (payload.visual_style !== 'custom') delete payload.visual_style_behavior;
      else if (!String(payload.visual_style_behavior || '').trim()) {
        statusEl.textContent = '定制视觉风格需要填写行为说明';
        return;
      }

      var isCustomColor = payload.color && payload.color.name === 'custom';
      if (isCustomColor) {
        if (!String(payload.color.custom || '').trim()) {
          statusEl.textContent = '请填写自然语言配色描述';
          return;
        }
      } else {
        var pal = normPalette(payload.color || {});
        for (var i = 0; i < PALETTE_ROLES.length; i += 1) {
          var roleKey = PALETTE_ROLES[i][0];
          var hex = normHex(pal[roleKey]);
          if (!hex) {
            statusEl.textContent = '色板角色「' + PALETTE_ROLES[i][1] + '」需要有效的 HEX 色值';
            return;
          }
          pal[roleKey] = hex;
        }
        payload.color = {
          name: (payload.color && payload.color.name) || '自定义色板',
          palette: pal
        };
      }

      var typ = normTypography(
        payload.typography || {}, englishPrimary, payload.canvas, payload.delivery_purpose, (CAT && CAT.fonts) || []
      );
      if (!String(typ.heading.primary || '').trim() || !String(typ.body.primary || '').trim() ||
          (!englishPrimary && (!String(typ.heading.english || '').trim() || !String(typ.body.english || '').trim()))) {
        statusEl.textContent = '请完整填写标题与正文字体名称';
        return;
      }
      var bodyNum = parseFloat(payload.typography && payload.typography.body_size);
      if (!isFinite(bodyNum) || bodyNum <= 0) {
        statusEl.textContent = '正文字号必须为大于 0 的数字';
        return;
      }
      typ.body_size = roundSize(bodyNum);
      for (var s = 0; s < SIZE_ROLES.length; s += 1) {
        var sRole = SIZE_ROLES[s][0];
        var sVal = parseFloat(payload.typography && payload.typography.sizes && payload.typography.sizes[sRole]);
        if (!isFinite(sVal) || sVal <= 0) {
          statusEl.textContent = '字号「' + SIZE_ROLES[s][1] + '」必须为大于 0 的数字';
          return;
        }
        typ.sizes[sRole] = roundSize(sVal);
      }
      payload.typography = typ;

      if (!isPptCanvas(payload.canvas)) delete payload.delivery_purpose;
      if (payload.generation_mode === 'split' || payload.refine_spec) {
        payload.design_spec_depth = 'complete';
      }

      submitBtn.disabled = true;
      statusEl.textContent = '正在保存方案…';
      api('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function () {
        if (destroyed) return;
        if (onConfirmed) onConfirmed();
        else renderDoneCard();
      }).catch(function (err) {
        if (destroyed) return;
        submitBtn.disabled = false;
        statusEl.textContent = '提交失败：' + err.message;
      });
    }

    function boot() {
      if (destroyed) return;
      stopPolling();
      container.innerHTML = '<div class="card"><div class="loading">正在加载设计方案…</div></div>';
      Promise.all([
        api('/api/session'),
        api('/api/catalogs'),
        api('/api/icon-previews').catch(function () { return {}; }),
        api('/api/ai-image-comparison').catch(function () { return {}; })
      ]).then(function (res) {
        if (destroyed) return;
        SESSION = res[0];
        CAT = res[1];
        ICON_PREVIEWS = res[2] || {};
        AI_COMPARE = res[3] || {};

        if (SESSION.result_stage === 'final' || SESSION.status === 'done') {
          renderDoneCard();
          return null;
        }
        if (SESSION.status === 'waiting_agent') {
          var waitingTitle = SESSION.result_stage === 'stage1'
            ? 'AI 正在生成完整设计方案…'
            : '正在等待 AI 准备初始推荐…';
          var waitingHint = SESSION.template_error || '完成后本页面会自动进入下一步确认。';
          renderWaiting(waitingTitle, waitingHint, true);
          return null;
        }
        return api('/api/recommendations').then(function (recData) {
          if (destroyed) return;
          REC = recData;
          var rawStage = String(REC.stage || '').toLowerCase();
          STAGE = rawStage === 'stage2' ? 2 : (rawStage === 'stage1' ? 1 : 0);
          if (STAGE === 1) {
            initStage1State();
            renderStage1();
          } else if (STAGE === 2) {
            initStage2State();
            renderStage2();
          } else {
            renderErrorCard('无法识别当前推荐阶段：' + (REC.stage || 'unknown'));
          }
        });
      }).catch(function (err) {
        if (destroyed) return;
        renderErrorCard(err.message);
      });
    }

    boot();

    return {
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        stopPolling();
        closeModal();
        container.innerHTML = '';
      }
    };
  }

  window.WorkbenchConfirmView = {
    mount: mount,
    _stage1Helpers: {
      groupExplicitByWorkspace: groupExplicitByWorkspace,
      validateTemplateSelection: validateTemplateSelection
    }
  };
})();
