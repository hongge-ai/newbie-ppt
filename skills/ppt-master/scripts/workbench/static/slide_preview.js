/* Workbench native light-theme Slide Preview & Annotation Editor. */
(function () {
  'use strict';

  var MESSAGES = {
    zh: {
      panel_slides: '幻灯片',
      panel_edit_annotate: '编辑 / 标注',
      placeholder_select_slide: '在左侧选择一张幻灯片开始',
      label_selected_element: '已选元素',
      empty_selected_element: '点击幻灯片中的元素进行选择',
      btn_select_group: '选择父级组合',
      label_batch_edit: '批量编辑',
      label_group_edit: '组合编辑',
      section_geometry: '位置与大小',
      section_style: '样式',
      section_text_style: '文本',
      section_raw_attrs: '原始属性',
      label_edit_instruction: '修改说明',
      pending_none: '没有待应用修改',
      pending_summary: '{edits} 条直接修改、{annotations} 个页面有 AI 标注待应用',
      pending_pages: '页面：{pages}',
      quick_align: '对齐 / 移动',
      quick_resize: '调整大小',
      quick_replace_image: '换图',
      quick_copy: '改文案',
      quick_relayout: '重排此区域',
      placeholder_annotation: '描述希望 AI 如何修改该元素……',
      placeholder_annotation_multi: '描述希望如何修改所选 {count} 个元素……',
      btn_add_annotation: '添加标注',
      label_annotations_on_slide: '本页标注',
      btn_submit_annotations: '应用修改',
      modal_submit: '提交',
      modal_cancel: '取消',
      modal_close: '关闭',
      empty_waiting_slides: '正在等待生成幻灯片……',
      empty_no_slides: '未找到幻灯片',
      placeholder_live_ready: '实时预览已就绪，生成的幻灯片会在这里出现。',
      placeholder_slide_writing: '幻灯片仍在写入，等待下次刷新……',
      empty_annotations: '暂无标注',
      tooltip_remove_annotation: '删除标注',
      multi_selected: '已选 {count} 个元素',
      multi_mixed: '混合',
      err_load_slides: '加载幻灯片列表失败：',
      err_load_slide: '加载幻灯片失败：',
      err_add_annotation: '添加标注失败：',
      err_remove_annotation: '删除标注失败：',
      err_save: '保存失败：',
      err_edit: '编辑失败：',
      label_direct_edit: '对象属性（点击“应用修改”后写入）',
      prop_multiline_hint: '多行文本——选中单行（tspan）后编辑文字',
      edit_saved_hint: '修改已暂存。点击“应用修改”后写入 svg_output。',
      btn_undo: '撤销',
      undo_done: '已撤销上一条暂存修改',
      undo_empty: '没有可撤销的暂存修改',
      overlap_caption: '此处重叠元素——点击选择',
      err_empty_svg: '幻灯片已加载但画布为空。SVG 可能损坏或缺少根 <svg> 元素。',
      warn_icon_inline: '{count} 个图标渲染失败：{names}',
      warn_matrix_transform: '本次位置/大小修改会以 transform matrix 保存。预览准确，导出 PPTX 时请使用当前导出器。',
      modal_matrix_transform_note: '\n\n提示：至少有一条暂存的位置/大小修改使用了 transform matrix。保存后请重新导出 PPTX 以应用变换。',
      slide_error_tooltip: '该幻灯片解析失败：',
      reload_banner: '当前页已在磁盘上更新，点此重新加载。',
      modal_confirm_submit: '确认将暂存的直接修改和 AI 标注写入 svg_output？',
      modal_success_submit: '修改已保存到 svg_output。',
      modal_success_direct_only: '修改已保存到 svg_output。\n\n直接修改已经写入 SVG 源文件；需要更新 PPTX 时，请让 AI 重新导出。',
      modal_success_annotations_only: '标注已保存到 svg_output。\n\n需要 AI 理解并执行这些标注时，请回到对话要求应用标注。',
      modal_success_mixed: '直接修改和标注已保存到 svg_output。\n\n请回到对话先让 AI 处理标注，确认后再重新导出 PPTX。',
      nav_first: '第一页 (Home)',
      nav_prev: '上一页 (←)',
      nav_next: '下一页 (→)',
      nav_last: '末页 (End)',
      nav_counter: '{current} / {total}',
      nav_empty: '— / —'
    }
  };

  function t(key, params) {
    var msg = MESSAGES.zh[key];
    if (msg === undefined) return key;
    if (params) {
      Object.keys(params).forEach(function (p) {
        msg = msg.replace('{' + p + '}', params[p]);
      });
    }
    return msg;
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str == null ? '' : String(str)));
    return d.innerHTML;
  }

  function cssAttr(value) {
    return String(value).replace(/"/g, '\\"');
  }

  function localName(el) {
    return el && el.tagName ? el.tagName.toLowerCase() : '';
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_ALLOWED_ELEMENTS = new Set([
    'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
    'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath', 'image',
    'clippath', 'mask', 'pattern', 'marker', 'lineargradient', 'radialgradient',
    'stop', 'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer',
    'fecomposite', 'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
    'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg',
    'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
    'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting',
    'fespotlight', 'fetile', 'feturbulence', 'style', 'title', 'desc', 'metadata',
    'a', 'switch', 'view', 'animate', 'animatecolor', 'animatetransform',
    'animatemotion', 'set', 'mpath'
  ]);

  var SKIP_TAGS = ['defs', 'style', 'title', 'desc'];

  var INLINE_GEOMETRY_STYLE_PROPERTIES = {
    rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
    circle: new Set(['cx', 'cy', 'r']),
    ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
    image: new Set(['x', 'y', 'width', 'height']),
    svg: new Set(['x', 'y', 'width', 'height']),
    use: new Set(['x', 'y', 'width', 'height'])
  };

  var SVG_UNIT_OPTIONAL_LENGTH_ATTRS = new Set([
    'x', 'y', 'x1', 'x2', 'y1', 'y2',
    'cx', 'cy', 'r', 'rx', 'ry',
    'dx', 'dy', 'width', 'height',
    'font-size', 'stroke-width', 'stroke-dashoffset',
    'letter-spacing', 'word-spacing'
  ]);

  function normalizeSvgLengthValue(key, value) {
    var s = String(value || '');
    if (!SVG_UNIT_OPTIONAL_LENGTH_ATTRS.has(String(key).toLowerCase())) return s;
    s = s.trim();
    var m = s.match(/^(-?\d+(?:\.\d+)?)px$/i);
    return m ? m[1] : s;
  }

  function normalizeEditableAttrValue(key, value) {
    return normalizeSvgLengthValue(key, String(value || '').trim());
  }

  function isSafeColor(val) {
    return val.length < 100 && !/[;:@\\]|url\s*\(/i.test(val);
  }

  function normalizeHexForPicker(val) {
    var s = String(val).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return '#000000';
  }

  function splitNumberUnit(value) {
    var m = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)([A-Za-z%]*)$/);
    if (!m) return null;
    return { num: parseFloat(m[1]), unit: m[2] || '' };
  }

  function firstNumber(value) {
    var m = String(value || '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function formatCoord(value) {
    return String(Math.round(value * 1000) / 1000);
  }

  function isFormElement(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }

  function rewriteImageHref(rawValue, imagesBase) {
    if (!imagesBase || typeof rawValue !== 'string') return rawValue;
    var trimmed = rawValue.trim();
    if (!trimmed || /^(?:https?:|data:|blob:|\/)/i.test(trimmed)) return rawValue;
    var match = trimmed.match(/^(?:\.\.?\/)*images\/(.+)$/);
    if (!match) return rawValue;
    var base = imagesBase.replace(/\/+$/, '');
    return base + '/' + match[1];
  }

  function sanitizeSvg(svgString, imagesBase) {
    var doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length ||
        !doc.documentElement || doc.documentElement.localName.toLowerCase() !== 'svg' ||
        doc.documentElement.namespaceURI !== SVG_NS) {
      throw new Error(t('err_empty_svg'));
    }
    doc.querySelectorAll('*').forEach(function (el) {
      var tag = el.localName.toLowerCase();
      if (!SVG_ALLOWED_ELEMENTS.has(tag) || el.namespaceURI !== SVG_NS) {
        el.remove();
        return;
      }
      Array.from(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var local = attr.localName.toLowerCase();
        if (local.indexOf('on') === 0 || name.indexOf('on') === 0) {
          el.removeAttributeNode(attr);
          return;
        }
        var value = attr.value.replace(/[\t\r\n]/g, '').replace(/^[\x00-\x20]+/, '');
        if (local === 'href') {
          if (/^\s*javascript\s*:/i.test(value) ||
              /^\s*vbscript\s*:/i.test(value) ||
              /^\s*data\s*:/i.test(value)) {
            el.removeAttributeNode(attr);
            return;
          }
          var rewritten = rewriteImageHref(value, imagesBase);
          if (rewritten !== attr.value) {
            attr.value = rewritten;
          }
        }
      });
    });
    return new XMLSerializer().serializeToString(doc.documentElement);
  }

  function jsonOrThrow(res) {
    return res.json().then(function (data) {
      if (!res.ok || data.error) {
        throw new Error(data.error || ('Request failed with status ' + res.status));
      }
      return data;
    });
  }

  function mount(container, opts) {
    opts = opts || {};
    var slug = opts.slug || '';
    var apiBase = (opts.apiBase || ('/p/' + encodeURIComponent(slug) + '/preview')).replace(/\/+$/, '');
    var imagesBase = (opts.imagesBase || ('/p/' + encodeURIComponent(slug) + '/images')).replace(/\/+$/, '');
    var initialSlide = opts.initialSlide || null;
    var onSlideChange = typeof opts.onSlideChange === 'function' ? opts.onSlideChange : null;
    var destroyed = false;

    container.innerHTML =
      '<div class="sp-shell">' +
      '  <div class="sp-left">' +
      '    <div class="sp-panel-head">' + escapeHtml(t('panel_slides')) + '</div>' +
      '    <div class="sp-slide-list" data-role="slide-list"></div>' +
      '  </div>' +
      '  <div class="sp-center">' +
      '    <div class="sp-slide-nav">' +
      '      <button type="button" class="sp-nav-btn" data-role="nav-first" title="' + escapeHtml(t('nav_first')) + '">&laquo;</button>' +
      '      <button type="button" class="sp-nav-btn" data-role="nav-prev" title="' + escapeHtml(t('nav_prev')) + '">&lsaquo;</button>' +
      '      <div class="sp-nav-label"><span data-role="nav-counter">' + escapeHtml(t('nav_empty')) + '</span><span data-role="nav-name"></span></div>' +
      '      <button type="button" class="sp-nav-btn" data-role="nav-next" title="' + escapeHtml(t('nav_next')) + '">&rsaquo;</button>' +
      '      <button type="button" class="sp-nav-btn" data-role="nav-last" title="' + escapeHtml(t('nav_last')) + '">&raquo;</button>' +
      '    </div>' +
      '    <div class="sp-banners" data-role="banners"></div>' +
      '    <div class="sp-stage" data-role="svg-container">' +
      '      <div class="sp-rubber-overlay" data-role="rubber-band-overlay"></div>' +
      '      <div class="sp-placeholder" data-role="svg-placeholder">' + escapeHtml(t('placeholder_select_slide')) + '</div>' +
      '      <div class="sp-svg-content" data-role="svg-content" style="display:none;"></div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="sp-right">' +
      '    <div class="sp-panel-head">' + escapeHtml(t('panel_edit_annotate')) + '</div>' +
      '    <div class="sp-pending-status empty" data-role="pending-status"></div>' +
      '    <div class="sp-selection-info">' +
      '      <div class="sp-section-label">' + escapeHtml(t('label_selected_element')) + '</div>' +
      '      <div class="sp-selected-element empty" data-role="selected-element">' + escapeHtml(t('empty_selected_element')) + '</div>' +
      '      <div class="sp-element-props" data-role="element-props" style="display:none;"></div>' +
      '    </div>' +
      '    <div class="sp-annotation-input" data-role="annotation-input" style="display:none;">' +
      '      <div class="sp-section-label">' + escapeHtml(t('label_edit_instruction')) + '</div>' +
      '      <div class="sp-quick-actions" data-role="annotation-quick-actions"></div>' +
      '      <textarea class="sp-annotation-text" data-role="annotation-text" placeholder="' + escapeHtml(t('placeholder_annotation')) + '"></textarea>' +
      '      <button type="button" class="btn btn-small sp-btn-add" data-role="btn-add-annotation">' + escapeHtml(t('btn_add_annotation')) + '</button>' +
      '    </div>' +
      '    <div class="sp-annotation-list">' +
      '      <div class="sp-section-label">' + escapeHtml(t('label_annotations_on_slide')) + '</div>' +
      '      <div data-role="annotations"></div>' +
      '    </div>' +
      '    <div class="sp-actions">' +
      '      <button type="button" class="btn sp-btn-undo" data-role="btn-undo" disabled>' + escapeHtml(t('btn_undo')) + '</button>' +
      '      <button type="button" class="btn btn-primary sp-btn-save" data-role="btn-save">' + escapeHtml(t('btn_submit_annotations')) + '</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="sp-modal-overlay" data-role="modal-overlay" style="display:none;">' +
      '    <div class="sp-modal">' +
      '      <div class="sp-modal-message" data-role="modal-message"></div>' +
      '      <div class="sp-modal-buttons">' +
      '        <button type="button" class="btn" data-role="modal-cancel">' + escapeHtml(t('modal_cancel')) + '</button>' +
      '        <button type="button" class="btn btn-primary" data-role="modal-confirm">' + escapeHtml(t('modal_submit')) + '</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    function q(role) {
      return container.querySelector('[data-role="' + role + '"]');
    }

    var slideListEl = q('slide-list');
    var bannersEl = q('banners');
    var stageContainer = q('svg-container');
    var rubberBandOverlay = q('rubber-band-overlay');
    var svgPlaceholder = q('svg-placeholder');
    var svgContent = q('svg-content');
    var pendingStatusEl = q('pending-status');
    var selectedElementEl = q('selected-element');
    var elementPropsEl = q('element-props');
    var annotationInput = q('annotation-input');
    var annotationQuickActions = q('annotation-quick-actions');
    var annotationText = q('annotation-text');
    var btnAddAnnotation = q('btn-add-annotation');
    var annotationsEl = q('annotations');
    var btnUndo = q('btn-undo');
    var btnSave = q('btn-save');
    var modalOverlay = q('modal-overlay');
    var modalMessage = q('modal-message');
    var modalConfirm = q('modal-confirm');
    var modalCancel = q('modal-cancel');
    var navFirstBtn = q('nav-first');
    var navPrevBtn = q('nav-prev');
    var navNextBtn = q('nav-next');
    var navLastBtn = q('nav-last');
    var navCounterEl = q('nav-counter');
    var navNameEl = q('nav-name');

    var currentSlide = null;
    var waitingForSlide = null;
    var slideNames = [];
    var selectedElementIds = new Set();
    var slideAnnotations = {};
    var liveMode = false;
    var slidePollTimer = null;
    var slideMtimes = {};
    var reloadBannerEl = null;
    var editStackCount = {};
    var savedHintShown = false;
    var matrixHintShown = false;
    var matrixEditSlides = {};
    var annotationsDirty = false;
    var annotationEditSlides = {};
    var rubberBandEl = null;
    var rubberBandStart = null;
    var rubberBandUsed = false;
    var suppressNextSvgClick = false;
    var RUBBER_BAND_THRESHOLD = 5;
    var dragStart = null;
    var dragMoved = false;
    var dragEls = [];
    var dragStartAttrs = {};
    var nudgeFlight = {};
    var nudgeQueued = {};
    var nudgeLastOk = {};
    var overlapPickerEl = null;
    var inFlightEdits = new Set();
    var pendingTimers = [];
    var globalCleanups = [];
    var initialSelectionApplied = false;

    function apiUrl(path) {
      return apiBase + path;
    }

    function addGlobalListener(target, type, handler, capture) {
      target.addEventListener(type, handler, capture);
      globalCleanups.push(function () {
        target.removeEventListener(type, handler, capture);
      });
    }

    function addManagedTimer(fn, ms) {
      var id = window.setTimeout(function () {
        if (destroyed) return;
        fn();
      }, ms);
      pendingTimers.push(id);
      return id;
    }

    function showBanner(msg, kind) {
      if (destroyed || !bannersEl) return;
      var banner = document.createElement('div');
      banner.className = 'sp-banner is-' + kind;
      banner.textContent = msg;
      banner.addEventListener('click', function () { banner.remove(); });
      bannersEl.appendChild(banner);
      addManagedTimer(function () { banner.remove(); }, kind === 'error' ? 5000 : 6000);
    }

    function showError(msg) { showBanner(msg, 'error'); }
    function showWarning(msg) { showBanner(msg, 'warn'); }

    function hideReloadBanner() {
      if (reloadBannerEl) {
        reloadBannerEl.remove();
        reloadBannerEl = null;
      }
    }

    function showReloadBanner(name) {
      if (destroyed || !bannersEl) return;
      hideReloadBanner();
      var banner = document.createElement('div');
      banner.className = 'sp-banner is-info';
      banner.textContent = t('reload_banner');
      banner.addEventListener('click', function () {
        hideReloadBanner();
        var item = slideListEl.querySelector('.sp-slide-item[data-name="' + cssAttr(name) + '"]');
        selectSlide(name, item || undefined);
      });
      bannersEl.appendChild(banner);
      reloadBannerEl = banner;
    }

    function pendingDirectEditCount() {
      return Object.keys(editStackCount).reduce(function (total, name) {
        return total + Math.max(0, editStackCount[name] || 0);
      }, 0);
    }

    function pendingDirectEditSlides() {
      return Object.keys(editStackCount).filter(function (name) {
        return (editStackCount[name] || 0) > 0;
      });
    }

    function pendingAnnotationSlides() {
      return Object.keys(annotationEditSlides).filter(function (name) {
        return !!annotationEditSlides[name];
      });
    }

    function pendingAnnotationChangeCount() {
      return pendingAnnotationSlides().length;
    }

    function pendingSlideNames() {
      var seen = {};
      pendingDirectEditSlides().concat(pendingAnnotationSlides()).forEach(function (name) {
        seen[name] = true;
      });
      return Object.keys(seen).sort();
    }

    function updatePendingStatus() {
      if (!pendingStatusEl) return;
      var edits = pendingDirectEditCount();
      var annotations = pendingAnnotationChangeCount();
      if (edits === 0 && annotations === 0) {
        pendingStatusEl.className = 'sp-pending-status empty';
        pendingStatusEl.textContent = t('pending_none');
        return;
      }
      var pages = pendingSlideNames();
      pendingStatusEl.className = 'sp-pending-status active';
      pendingStatusEl.innerHTML =
        '<div>' + escapeHtml(t('pending_summary', { edits: edits, annotations: annotations })) + '</div>' +
        (pages.length ? '<div class="sp-pending-pages">' + escapeHtml(t('pending_pages', { pages: pages.join(', ') })) + '</div>' : '');
    }

    function markAnnotationChanged(slide) {
      if (!slide) return;
      annotationEditSlides[slide] = true;
      annotationsDirty = true;
      updatePendingStatus();
    }

    function initAnnotationQuickActions() {
      if (!annotationQuickActions) return;
      var actions = ['quick_align', 'quick_resize', 'quick_replace_image', 'quick_copy', 'quick_relayout'];
      annotationQuickActions.innerHTML = '';
      actions.forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp-quick-chip';
        btn.textContent = t(key);
        btn.addEventListener('click', function () {
          var label = t(key);
          var prefix = label + '：';
          if (!annotationText.value.trim()) {
            annotationText.value = prefix;
          } else if (annotationText.value.indexOf(prefix) === -1) {
            annotationText.value = prefix + annotationText.value;
          }
          annotationText.focus();
          annotationText.selectionStart = annotationText.selectionEnd = annotationText.value.length;
        });
        annotationQuickActions.appendChild(btn);
      });
    }

    function hasUnsavedWork() {
      if (annotationsDirty) return true;
      return Object.keys(editStackCount).some(function (k) {
        return editStackCount[k] > 0;
      });
    }

    addGlobalListener(window, 'beforeunload', function (e) {
      if (destroyed || !hasUnsavedWork()) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    function currentSlideIndex() {
      if (!currentSlide) return -1;
      return slideNames.indexOf(currentSlide);
    }

    function gotoSlideIndex(idx) {
      if (idx < 0 || idx >= slideNames.length) return;
      var name = slideNames[idx];
      if (name === currentSlide) return;
      var item = slideListEl.querySelector('.sp-slide-item[data-name="' + cssAttr(name) + '"]');
      selectSlide(name, item || undefined);
    }

    function updateNavLabel() {
      if (!navCounterEl) return;
      var total = slideNames.length;
      if (total === 0 || !currentSlide) {
        navCounterEl.textContent = t('nav_empty');
        if (navNameEl) navNameEl.textContent = '';
      } else {
        var idx = currentSlideIndex();
        navCounterEl.textContent = t('nav_counter', { current: idx + 1, total: total });
        if (navNameEl) navNameEl.textContent = currentSlide;
      }
      var idx2 = currentSlideIndex();
      var hasCurrent = idx2 >= 0;
      if (navFirstBtn) navFirstBtn.disabled = !hasCurrent || idx2 === 0;
      if (navPrevBtn) navPrevBtn.disabled = !hasCurrent || idx2 <= 0;
      if (navNextBtn) navNextBtn.disabled = !hasCurrent || idx2 >= total - 1;
      if (navLastBtn) navLastBtn.disabled = !hasCurrent || idx2 >= total - 1;
    }

    function setPlaceholder(key) {
      svgPlaceholder.textContent = t(key);
    }

    function loadSlides() {
      return fetch(apiUrl('/api/slides'), { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (destroyed) return;
          slideListEl.innerHTML = '';
          var slides = data.slides || [];
          slideNames = slides.map(function (s) { return s.name; });

          if (slides.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'sp-slide-empty';
            empty.textContent = liveMode ? t('empty_waiting_slides') : t('empty_no_slides');
            slideListEl.appendChild(empty);
            if (!currentSlide) {
              svgPlaceholder.style.display = 'block';
              setPlaceholder(liveMode ? 'placeholder_live_ready' : 'empty_no_slides');
              svgContent.style.display = 'none';
            }
            updateNavLabel();
            updatePendingStatus();
            return;
          }

          var currentExists = false;
          var currentReady = false;
          var currentMtimeChanged = false;
          slides.forEach(function (s) {
            if (s.name === currentSlide) {
              currentExists = true;
              currentReady = s.ok !== false;
              var lastSeen = slideMtimes[s.name];
              if (lastSeen !== undefined && s.mtime && s.mtime !== lastSeen) {
                currentMtimeChanged = true;
              }
            }
            if (s.name !== currentSlide && s.mtime !== undefined) {
              slideMtimes[s.name] = s.mtime;
            }

            var item = document.createElement('div');
            item.className = 'sp-slide-item' + (s.name === currentSlide ? ' active' : '');
            if (s.ok === false) {
              item.className += ' is-error';
              item.title = t('slide_error_tooltip') + (s.error || '');
            }
            item.setAttribute('data-name', s.name);

            var nameSpan = document.createElement('span');
            nameSpan.className = 'sp-slide-name';
            nameSpan.textContent = s.name;
            item.appendChild(nameSpan);

            if (s.annotation_count > 0) {
              var badge = document.createElement('span');
              badge.className = 'sp-badge';
              badge.textContent = s.annotation_count;
              item.appendChild(badge);
            }

            item.addEventListener('click', function () {
              selectSlide(s.name, item);
            });
            slideListEl.appendChild(item);
          });

          if (!currentSlide || !currentExists) {
            var requested = !initialSelectionApplied ? initialSlide : null;
            initialSelectionApplied = true;
            var targetSlide = requested && slideNames.indexOf(requested) !== -1
              ? requested
              : slides[0].name;
            selectSlide(targetSlide);
          } else if (waitingForSlide === currentSlide) {
            if (currentReady) selectSlide(currentSlide);
          } else if (currentMtimeChanged) {
            showReloadBanner(currentSlide);
          }
          updateNavLabel();
          updatePendingStatus();
        })
        .catch(function (err) {
          if (destroyed) return;
          showError(t('err_load_slides') + err.message);
        });
    }

    function waitForSlideRewrite(name) {
      if (!liveMode || name !== currentSlide) return;
      waitingForSlide = name;
      svgPlaceholder.style.display = 'block';
      setPlaceholder('placeholder_slide_writing');
      svgContent.style.display = 'none';
    }

    function selectSlide(name, el) {
      if (destroyed) return;
      if (!el) {
        el = slideListEl.querySelector('.sp-slide-item[data-name="' + cssAttr(name) + '"]');
      }
      container.querySelectorAll('.sp-slide-item').forEach(function (it) {
        it.classList.remove('active');
      });
      if (el) el.classList.add('active');

      currentSlide = name;
      waitingForSlide = null;
      if (onSlideChange) onSlideChange(name);
      selectedElementIds.clear();
      slideAnnotations = {};
      updateNavLabel();

      cancelRubberBand();
      clearSelection();
      hideReloadBanner();

      fetch(apiUrl('/api/slide/' + encodeURIComponent(name)), { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (destroyed || name !== currentSlide) return;
          if (data.error) {
            showError(t('err_load_slide') + data.error);
            waitForSlideRewrite(name);
            return;
          }
          var sanitizedSvg = sanitizeSvg(data.content, imagesBase);
          svgPlaceholder.style.display = 'none';
          svgContent.style.display = 'block';
          svgContent.innerHTML = sanitizedSvg;

          var rootSvg = svgContent.querySelector('svg');
          if (rootSvg) {
            var vb = (rootSvg.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
            var vbWidth = Number(vb[2]);
            var vbHeight = Number(vb[3]);
            if (vb.length === 4 && Number.isFinite(vbWidth) && Number.isFinite(vbHeight) &&
                vbWidth > 0 && vbHeight > 0) {
              rootSvg.setAttribute('width', vb[2]);
              rootSvg.setAttribute('height', vb[3]);
            }
          }
          var hasContent = false;
          if (rootSvg) {
            var children = rootSvg.querySelectorAll('*');
            for (var i = 0; i < children.length; i++) {
              var ctag = children[i].tagName.toLowerCase();
              if (ctag !== 'defs' && ctag !== 'style' && ctag !== 'title' && ctag !== 'desc') {
                hasContent = true;
                break;
              }
            }
          }
          if (!rootSvg || !hasContent) {
            showError(t('err_empty_svg'));
            svgPlaceholder.style.display = 'block';
            setPlaceholder('err_empty_svg');
            svgContent.style.display = 'none';
            return;
          }

          if (data.warnings && data.warnings.length > 0) {
            var names = data.warnings.map(function (w) { return w.icon || '(unknown)'; }).join(', ');
            showWarning(t('warn_icon_inline', { count: data.warnings.length, names: names }));
          }

          if (data.mtime !== undefined) {
            slideMtimes[name] = data.mtime;
          }

          (data.annotations || []).forEach(function (a) {
            slideAnnotations[a.element_id] = a.annotation;
          });

          editStackCount[name] = data.undo_depth || 0;
          setupSvgInteraction();
          refreshAnnotationVisuals();
          updateAnnotationList();
          updateUndoButton();
          updatePendingStatus();
        })
        .catch(function (err) {
          if (destroyed || name !== currentSlide) return;
          showError(t('err_load_slide') + err.message);
          waitForSlideRewrite(name);
        });
    }

    function setupSvgInteraction() {
      var svg = svgContent.querySelector('svg');
      if (!svg) return;

      svg.querySelectorAll('*').forEach(function (el) {
        var tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.indexOf(tag) !== -1 || el === svg) return;
        el.classList.add('svg-selectable');
      });

      svg.addEventListener('click', function (e) {
        if (suppressNextSvgClick) {
          suppressNextSvgClick = false;
          return;
        }
        var target = e.target;
        if (target === svg) {
          clearSelection();
          return;
        }
        if (target.closest && target.closest('defs, style, title, desc')) return;
        var picked = e.altKey && target.closest ? target.closest('g[id]') : null;
        picked = picked || (target.closest && target.closest('[data-icon][id]')) ||
          (target.closest && target.closest('[id]'));
        if (!picked || picked === svg) {
          clearSelection();
          return;
        }
        selectElement(picked, e.ctrlKey || e.metaKey);
      });
    }

    function markSelection() {
      svgContent.querySelectorAll('.svg-selected').forEach(function (el) {
        el.classList.remove('svg-selected');
      });
      selectedElementIds.forEach(function (id) {
        var el = svgContent.querySelector('#' + CSS.escape(id));
        if (el) el.classList.add('svg-selected');
      });
    }

    function selectElement(elem, addToSelection) {
      var eid = elem.id;
      if (!eid) return;

      if (addToSelection) {
        if (selectedElementIds.has(eid)) {
          selectedElementIds.delete(eid);
          elem.classList.remove('svg-selected');
        } else {
          selectedElementIds.add(eid);
          elem.classList.add('svg-selected');
        }
      } else {
        selectedElementIds.forEach(function (id) {
          if (id !== eid) {
            var old = svgContent.querySelector('#' + CSS.escape(id));
            if (old) old.classList.remove('svg-selected');
          }
        });
        selectedElementIds.clear();
        selectedElementIds.add(eid);
        elem.classList.add('svg-selected');
      }

      updateSelectionPanel();
    }

    function clearSelection() {
      selectedElementIds.forEach(function (id) {
        var el = svgContent.querySelector('#' + CSS.escape(id));
        if (el) el.classList.remove('svg-selected');
      });
      selectedElementIds.clear();
      updateSelectionPanel();
    }

    function updateSelectionPanel() {
      var propsEl = elementPropsEl;
      var count = selectedElementIds.size;

      if (count === 0) {
        selectedElementEl.classList.add('empty');
        selectedElementEl.textContent = t('empty_selected_element');
        annotationInput.style.display = 'none';
        annotationText.value = '';
        propsEl.style.display = 'none';
        propsEl.innerHTML = '';
        return;
      }

      selectedElementEl.classList.remove('empty');
      propsEl.style.display = 'block';

      if (count === 1) {
        var eid = selectedElementIds.values().next().value;
        var el = svgContent.querySelector('#' + CSS.escape(eid));
        if (el) {
          var tag = el.tagName.toLowerCase();
          selectedElementEl.innerHTML =
            '<span class="sp-el-tag">&lt;' + escapeHtml(tag) + '&gt;</span>' +
            '<span class="sp-el-id">' + escapeHtml(eid) + '</span>';
          propsEl.innerHTML = renderEditableProps(el);
          attachPropEditors(el);
        }
      } else {
        selectedElementEl.innerHTML =
          '<span class="sp-multi-count">' + escapeHtml(t('multi_selected', { count: count })) + '</span>';
        propsEl.innerHTML = renderMultiSelectSummary(Array.from(selectedElementIds));
        attachMultiSelectionEditors(Array.from(selectedElementIds));
      }

      annotationInput.style.display = 'block';
      annotationText.placeholder = count > 1
        ? t('placeholder_annotation_multi', { count: count })
        : t('placeholder_annotation');
      annotationText.value = count === 1
        ? (slideAnnotations[selectedElementIds.values().next().value] || '')
        : '';
    }

    function hitSelectedAncestor(target) {
      var svg = svgContent.querySelector('svg');
      var node = target;
      while (node && node !== svg && node.nodeType === 1) {
        if (node.id && selectedElementIds.has(node.id)) return node;
        node = node.parentNode;
      }
      return null;
    }

    function screenDeltaToLocal(el, dxScreen, dyScreen) {
      var sctm = el.getScreenCTM ? el.getScreenCTM() : null;
      var ctm = el.getCTM ? el.getCTM() : null;
      if (!sctm || !ctm) return { x: dxScreen, y: dyScreen };
      try {
        var n = ctm.multiply(sctm.inverse());
        var lx = n.a * dxScreen + n.c * dyScreen;
        var ly = n.b * dxScreen + n.d * dyScreen;
        if (!isFinite(lx) || !isFinite(ly)) return { x: dxScreen, y: dyScreen };
        return { x: lx, y: ly };
      } catch (err) {
        return { x: dxScreen, y: dyScreen };
      }
    }

    function beginDrag() {
      dragEls = topLevelSelectedElements(Array.from(selectedElementIds));
      dragStartAttrs = {};
      dragEls.forEach(function (el) {
        try { dragStartAttrs[el.id] = attrsForMove(el, 0, 0); }
        catch (err) { dragStartAttrs[el.id] = null; }
      });
      document.body.classList.add('svg-dragging');
    }

    function applyAttrSnapshot(el, sa) {
      if (!sa) return;
      applyElementAttrs(el, sa);
    }

    function stripEditedInlineGeometry(el, attrs) {
      var style = el.getAttribute('style');
      var supported = INLINE_GEOMETRY_STYLE_PROPERTIES[localName(el)];
      if (!style || !supported) return;
      var edited = new Set(Object.keys(attrs || {}).map(function (key) {
        return String(key).toLowerCase();
      }).filter(function (key) { return supported.has(key); }));
      if (edited.size === 0) return;

      var retained = [];
      var changed = false;
      style.split(';').forEach(function (rawDeclaration) {
        var declaration = rawDeclaration.trim();
        if (!declaration) return;
        var colon = declaration.indexOf(':');
        if (colon < 0) {
          retained.push(declaration);
          return;
        }
        var name = declaration.slice(0, colon).trim().toLowerCase();
        if (edited.has(name)) {
          changed = true;
          return;
        }
        retained.push(declaration);
      });
      if (!changed) return;
      if (retained.length > 0) el.setAttribute('style', retained.join('; '));
      else el.removeAttribute('style');
    }

    function applyElementAttrs(el, attrs) {
      stripEditedInlineGeometry(el, attrs);
      if (localName(el) === 'g' && el.hasAttribute('data-icon') &&
          attrs.x !== undefined && attrs.y !== undefined) {
        var m = ownMatrix(el);
        el.setAttribute('transform', 'matrix(' + [
          formatCoord(m.a), formatCoord(m.b), formatCoord(m.c),
          formatCoord(m.d), formatCoord(parseFloat(attrs.x)),
          formatCoord(parseFloat(attrs.y))
        ].join(',') + ')');
        el.setAttribute('data-use-x', attrs.x);
        el.setAttribute('data-use-y', attrs.y);
      }
      Object.keys(attrs).forEach(function (k) {
        if (localName(el) === 'g' && el.hasAttribute('data-icon') &&
            (k === 'x' || k === 'y' || k === 'transform')) return;
        if (attrs[k] === null || attrs[k] === undefined) el.removeAttribute(k);
        else el.setAttribute(k, attrs[k]);
      });
    }

    function markCommittedAttrs(el, attrs) {
      if (attrs && attrs.transform === null &&
          localName(el) === 'g' && el.hasAttribute('data-icon')) {
        el.removeAttribute('data-use-has-transform');
      }
    }

    function payloadForCurrentElementState(el, payload) {
      if (!payload || !payload.attrs || payload.attrs.transform !== null ||
          localName(el) !== 'g' || !el.hasAttribute('data-icon') ||
          el.hasAttribute('data-use-has-transform')) {
        return payload;
      }
      var attrs = Object.assign({}, payload.attrs);
      delete attrs.transform;
      return Object.assign({}, payload, { attrs: attrs });
    }

    function restoreDragStart(el) {
      applyAttrSnapshot(el, dragStartAttrs[el.id]);
    }

    function applyMoveLocal(el, dxScreen, dyScreen) {
      restoreDragStart(el);
      var d = screenDeltaToLocal(el, dxScreen, dyScreen);
      var attrs;
      try { attrs = attrsForMove(el, d.x, d.y); }
      catch (err) { attrs = null; }
      if (!attrs) return null;
      applyElementAttrs(el, attrs);
      return attrs;
    }

    function updateDragPreview(dxScreen, dyScreen) {
      dragEls.forEach(function (el) { applyMoveLocal(el, dxScreen, dyScreen); });
      if (dragEls.length === 1) refreshGeoInputs(dragEls[0], elementPropsEl);
    }

    function commitDrag(dxScreen, dyScreen) {
      var single = dragEls.length === 1;
      dragEls.forEach(function (el) {
        var startAttrs = dragStartAttrs[el.id];
        var attrs = applyMoveLocal(el, dxScreen, dyScreen);
        if (!attrs) return;
        var payload = payloadForMovedElement(el, attrs);
        stageEditRequest(el.id, payload).then(function () {
          if (destroyed) return;
          if (payload.attrs) markCommittedAttrs(el, payload.attrs);
          if (payload.promote_tspan) {
            var promoted = promoteTspanDom(el, payload.promote_tspan);
            if (promoted && single) refreshGeoInputs(promoted, elementPropsEl);
          }
        }).catch(function (err) {
          if (destroyed) return;
          applyAttrSnapshot(el, startAttrs);
          if (single) refreshGeoInputs(el, elementPropsEl);
          showError(t('err_edit') + err.message);
        });
      });
    }

    function endDrag() {
      dragStart = null;
      dragMoved = false;
      dragEls = [];
      dragStartAttrs = {};
      document.body.classList.remove('svg-dragging');
    }

    function nudgeKey(slide, el) { return slide + '|' + el.id; }

    function sendNudge(key, el, single, slide, payload) {
      if (!payload || destroyed) return;
      payload = payloadForCurrentElementState(el, payload);
      nudgeFlight[key] = true;
      stageEditRequest(el.id, payload, slide).then(function () {
        if (destroyed) return;
        if (payload.attrs) nudgeLastOk[key] = payload.attrs;
        if (payload.attrs) markCommittedAttrs(el, payload.attrs);
        nudgeFlight[key] = false;
        var qItem = nudgeQueued[key];
        if (qItem) { delete nudgeQueued[key]; sendNudge(key, qItem.el, qItem.single, qItem.slide, qItem.payload); }
      }).catch(function (err) {
        if (destroyed) return;
        nudgeFlight[key] = false;
        delete nudgeQueued[key];
        if (payload.promote_tspan && el.__promotionRollback) {
          var restored = el.__promotionRollback();
          if (single && restored) refreshGeoInputs(restored, elementPropsEl);
        } else if (nudgeLastOk[key] && slide === currentSlide && el.isConnected) {
          applyAttrSnapshot(el, nudgeLastOk[key]);
          if (single) refreshGeoInputs(el, elementPropsEl);
        }
        showError(t('err_edit') + err.message);
      });
    }

    function stageNudge(el, single, slide, payload) {
      var key = nudgeKey(slide, el);
      if (nudgeFlight[key]) {
        nudgeQueued[key] = { el: el, single: single, slide: slide, payload: payload };
        return;
      }
      sendNudge(key, el, single, slide, payload);
    }

    function nudgeSelection(dxScreen, dyScreen) {
      var els = topLevelSelectedElements(Array.from(selectedElementIds));
      if (els.length === 0) return;
      var slide = currentSlide;
      var single = els.length === 1;
      var lastSingleEl = null;
      els.forEach(function (el) {
        var key = nudgeKey(slide, el);
        if (!nudgeFlight[key] && !nudgeQueued[key]) {
          try { nudgeLastOk[key] = attrsForMove(el, 0, 0); }
          catch (err) { delete nudgeLastOk[key]; }
        }
        var d = screenDeltaToLocal(el, dxScreen, dyScreen);
        var attrs;
        try { attrs = attrsForMove(el, d.x, d.y); } catch (err) { attrs = null; }
        if (!attrs) return;
        applyElementAttrs(el, attrs);
        var payload = payloadForMovedElement(el, attrs);
        if (payload.promote_tspan) {
          el = promoteTspanDom(el, payload.promote_tspan) || el;
        }
        lastSingleEl = el;
        stageNudge(el, single, slide, payload);
      });
      if (single && lastSingleEl) refreshGeoInputs(lastSingleEl, elementPropsEl);
    }

    function collectSelectableAt(clientX, clientY) {
      var svg = svgContent.querySelector('svg');
      if (!svg || !document.elementsFromPoint) return [];
      var out = [];
      var seen = {};
      document.elementsFromPoint(clientX, clientY).forEach(function (node) {
        if (!svg.contains(node) || node === svg) return;
        if (node.closest && node.closest('defs, style, title, desc')) return;
        var picked = (node.closest && node.closest('[data-icon][id]')) ||
          (node.closest && node.closest('[id]'));
        if (!picked || picked === svg || !picked.id || seen[picked.id]) return;
        seen[picked.id] = true;
        out.push(picked);
      });
      return out;
    }

    function closeOverlapPicker() {
      if (!overlapPickerEl) return;
      var svg = svgContent.querySelector('svg');
      if (svg) {
        svg.querySelectorAll('.overlap-hover').forEach(function (e) {
          e.classList.remove('overlap-hover');
        });
      }
      overlapPickerEl.remove();
      overlapPickerEl = null;
    }

    function showOverlapPicker(clientX, clientY, candidates) {
      closeOverlapPicker();
      var menu = document.createElement('div');
      menu.className = 'sp-overlap-picker';
      var cap = document.createElement('div');
      cap.className = 'sp-overlap-caption';
      cap.textContent = t('overlap_caption');
      menu.appendChild(cap);
      candidates.forEach(function (el) {
        var item = document.createElement('div');
        item.className = 'sp-overlap-item';
        var tag = el.tagName.toLowerCase();
        var txt = (tag === 'text' || tag === 'tspan')
          ? (el.textContent || '').trim().slice(0, 28) : '';
        item.innerHTML = '<span class="sp-overlap-tag">&lt;' + escapeHtml(tag) +
          '&gt;</span><span class="sp-overlap-id">' + escapeHtml(el.id) + '</span>' +
          (txt ? '<span class="sp-overlap-txt">' + escapeHtml(txt) + '</span>' : '');
        item.addEventListener('mouseenter', function () { el.classList.add('overlap-hover'); });
        item.addEventListener('mouseleave', function () { el.classList.remove('overlap-hover'); });
        item.addEventListener('click', function (ev) {
          ev.stopPropagation();
          selectElement(el, ev.ctrlKey || ev.metaKey);
          closeOverlapPicker();
        });
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      var x = Math.min(clientX, window.innerWidth - menu.offsetWidth - 8);
      var y = Math.min(clientY, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = Math.max(8, x) + 'px';
      menu.style.top = Math.max(8, y) + 'px';
      overlapPickerEl = menu;
    }

    function initRubberBand() {
      stageContainer.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (hitSelectedAncestor(e.target)) {
          dragStart = { x: e.clientX, y: e.clientY };
          dragMoved = false;
          return;
        }
        rubberBandStart = { x: e.clientX, y: e.clientY };
        rubberBandUsed = false;
      });

      addGlobalListener(document, 'mousemove', function (e) {
        if (destroyed) return;
        if (dragStart) {
          var ddx = e.clientX - dragStart.x;
          var ddy = e.clientY - dragStart.y;
          if (!dragMoved && Math.sqrt(ddx * ddx + ddy * ddy) < RUBBER_BAND_THRESHOLD) {
            return;
          }
          if (!dragMoved) {
            dragMoved = true;
            beginDrag();
          }
          updateDragPreview(ddx, ddy);
          return;
        }
        if (!rubberBandStart) return;

        var dx = e.clientX - rubberBandStart.x;
        var dy = e.clientY - rubberBandStart.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < RUBBER_BAND_THRESHOLD) return;

        if (!rubberBandUsed) {
          rubberBandUsed = true;
          rubberBandOverlay.classList.add('active');
        }
        if (!rubberBandEl) {
          rubberBandEl = document.createElement('div');
          rubberBandEl.className = 'sp-rubber-band';
          document.body.appendChild(rubberBandEl);
        }

        var x = Math.min(rubberBandStart.x, e.clientX);
        var y = Math.min(rubberBandStart.y, e.clientY);
        rubberBandEl.style.left = x + 'px';
        rubberBandEl.style.top = y + 'px';
        rubberBandEl.style.width = Math.abs(dx) + 'px';
        rubberBandEl.style.height = Math.abs(dy) + 'px';
      });

      addGlobalListener(document, 'mouseup', function (e) {
        if (destroyed) return;
        if (dragStart) {
          if (dragMoved) {
            commitDrag(e.clientX - dragStart.x, e.clientY - dragStart.y);
            suppressNextSvgClick = true;
            addManagedTimer(function () { suppressNextSvgClick = false; }, 50);
          }
          endDrag();
          return;
        }
        if (!rubberBandStart) return;

        rubberBandOverlay.classList.remove('active');
        var dx = e.clientX - rubberBandStart.x;
        var dy = e.clientY - rubberBandStart.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (rubberBandEl) {
          rubberBandEl.remove();
          rubberBandEl = null;
        }

        if (dist >= RUBBER_BAND_THRESHOLD) {
          var rect = {
            left: Math.min(rubberBandStart.x, e.clientX),
            top: Math.min(rubberBandStart.y, e.clientY),
            right: Math.max(rubberBandStart.x, e.clientX),
            bottom: Math.max(rubberBandStart.y, e.clientY)
          };
          if (!e.ctrlKey && !e.metaKey) clearSelection();
          selectByRubberBand(rect);
          suppressNextSvgClick = true;
          addManagedTimer(function () { suppressNextSvgClick = false; }, 50);
        } else {
          if (!e.ctrlKey && !e.metaKey) clearSelection();
        }
        rubberBandStart = null;
      });

      stageContainer.addEventListener('contextmenu', function (e) {
        var svg = svgContent.querySelector('svg');
        if (!svg) return;
        var cands = collectSelectableAt(e.clientX, e.clientY);
        if (cands.length === 0) return;
        e.preventDefault();
        if (cands.length === 1) { selectElement(cands[0], false); return; }
        showOverlapPicker(e.clientX, e.clientY, cands);
      });

      addGlobalListener(document, 'mousedown', function (e) {
        if (overlapPickerEl && !overlapPickerEl.contains(e.target)) {
          closeOverlapPicker();
        }
      });
    }

    function cancelRubberBand() {
      rubberBandStart = null;
      if (rubberBandEl) {
        rubberBandEl.remove();
        rubberBandEl = null;
      }
      if (rubberBandOverlay) rubberBandOverlay.classList.remove('active');
      suppressNextSvgClick = false;
      endDrag();
      closeOverlapPicker();
    }

    function selectByRubberBand(screenRect) {
      var svg = svgContent.querySelector('svg');
      if (!svg) return;
      svg.querySelectorAll('.svg-selectable').forEach(function (el) {
        try {
          var bbox = el.getBBox();
          var ctm = el.getScreenCTM();
          if (!ctm) return;
          var corners = [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y },
            { x: bbox.x, y: bbox.y + bbox.height },
            { x: bbox.x + bbox.width, y: bbox.y + bbox.height }
          ];
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          corners.forEach(function (c) {
            var sx = c.x * ctm.a + c.y * ctm.c + ctm.e;
            var sy = c.x * ctm.b + c.y * ctm.d + ctm.f;
            if (sx < minX) minX = sx;
            if (sy < minY) minY = sy;
            if (sx > maxX) maxX = sx;
            if (sy > maxY) maxY = sy;
          });
          if (minX < screenRect.right && maxX > screenRect.left &&
              minY < screenRect.bottom && maxY > screenRect.top) {
            var eid = el.id;
            if (eid) {
              selectedElementIds.add(eid);
              el.classList.add('svg-selected');
            }
          }
        } catch (err) { /* ignore non-renderable element */ }
      });
      updateSelectionPanel();
    }

    function initKeyboardShortcuts() {
      addGlobalListener(document, 'keydown', function (e) {
        if (destroyed) return;
        var ae = document.activeElement;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
          if (isFormElement(ae)) return;
          e.preventDefault();
          runUndo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          if (isFormElement(ae)) return;
          e.preventDefault();
          var svg = svgContent.querySelector('svg');
          if (!svg) return;
          svg.querySelectorAll('.svg-selectable').forEach(function (el) {
            var eid = el.id;
            if (eid) {
              selectedElementIds.add(eid);
              el.classList.add('svg-selected');
            }
          });
          updateSelectionPanel();
          return;
        }
        if (e.key === 'Escape') {
          if (ae === annotationText) return;
          if (overlapPickerEl) { closeOverlapPicker(); return; }
          if (modalOverlay.style.display === 'flex') {
            modalOverlay.style.display = 'none';
            return;
          }
          clearSelection();
          return;
        }
        if (isFormElement(ae)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (selectedElementIds.size > 0 &&
            (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
             e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          var step = e.shiftKey ? 10 : 1;
          var nx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          var ny = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          nudgeSelection(nx, ny);
          return;
        }
        if (slideNames.length === 0) return;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          gotoSlideIndex(currentSlideIndex() - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          gotoSlideIndex(currentSlideIndex() + 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          gotoSlideIndex(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          gotoSlideIndex(slideNames.length - 1);
        }
      });
    }

    function initSlideNav() {
      if (navFirstBtn) navFirstBtn.addEventListener('click', function () { gotoSlideIndex(0); });
      if (navPrevBtn) navPrevBtn.addEventListener('click', function () { gotoSlideIndex(currentSlideIndex() - 1); });
      if (navNextBtn) navNextBtn.addEventListener('click', function () { gotoSlideIndex(currentSlideIndex() + 1); });
      if (navLastBtn) navLastBtn.addEventListener('click', function () { gotoSlideIndex(slideNames.length - 1); });
    }

    btnAddAnnotation.addEventListener('click', function () {
      if (!currentSlide || selectedElementIds.size === 0) return;
      var text = annotationText.value.trim();
      if (!text) return;

      var ids = Array.from(selectedElementIds);
      var promises = ids.map(function (eid) {
        return fetch(apiUrl('/api/slide/' + encodeURIComponent(currentSlide) + '/annotate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ element_id: eid, annotation: text })
        }).then(jsonOrThrow);
      });

      Promise.all(promises)
        .then(function () {
          if (destroyed) return;
          ids.forEach(function (eid) { slideAnnotations[eid] = text; });
          markAnnotationChanged(currentSlide);
          refreshAnnotationVisuals();
          updateAnnotationList();
          annotationText.value = '';
          loadSlides();
        })
        .catch(function (err) {
          if (destroyed) return;
          showError(t('err_add_annotation') + err.message);
        });
    });

    function removeAnnotation(elementId) {
      if (!currentSlide) return;
      fetch(apiUrl('/api/slide/' + encodeURIComponent(currentSlide) + '/annotate/' + encodeURIComponent(elementId)), {
        method: 'DELETE'
      })
        .then(function (res) { return res.json(); })
        .then(function () {
          if (destroyed) return;
          delete slideAnnotations[elementId];
          markAnnotationChanged(currentSlide);
          refreshAnnotationVisuals();
          updateAnnotationList();
          loadSlides();
        })
        .catch(function (err) {
          if (destroyed) return;
          showError(t('err_remove_annotation') + err.message);
        });
    }

    function refreshAnnotationVisuals() {
      svgContent.querySelectorAll('.svg-annotated').forEach(function (el) {
        el.classList.remove('svg-annotated');
      });
      Object.keys(slideAnnotations).forEach(function (eid) {
        var el = svgContent.querySelector('#' + CSS.escape(eid));
        if (el) el.classList.add('svg-annotated');
      });
    }

    function updateAnnotationList() {
      annotationsEl.innerHTML = '';
      var ids = Object.keys(slideAnnotations);
      if (ids.length === 0) {
        annotationsEl.innerHTML = '<div class="sp-annotations-empty">' + escapeHtml(t('empty_annotations')) + '</div>';
        return;
      }

      ids.forEach(function (eid) {
        var item = document.createElement('div');
        item.className = 'sp-annotation-item';

        var tag = '';
        var el = svgContent.querySelector('#' + CSS.escape(eid));
        if (el) tag = el.tagName.toLowerCase();

        var header = document.createElement('div');
        header.className = 'sp-ann-header';

        var leftSpan = document.createElement('span');
        if (tag) {
          var tagSpan = document.createElement('span');
          tagSpan.className = 'sp-ann-tag';
          tagSpan.textContent = '<' + tag + '>';
          leftSpan.appendChild(tagSpan);
        }
        var idSpan = document.createElement('span');
        idSpan.className = 'sp-ann-id';
        idSpan.textContent = eid;
        leftSpan.appendChild(idSpan);
        header.appendChild(leftSpan);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'sp-ann-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = t('tooltip_remove_annotation');
        removeBtn.addEventListener('click', function () { removeAnnotation(eid); });
        header.appendChild(removeBtn);

        item.appendChild(header);

        var textDiv = document.createElement('div');
        textDiv.className = 'sp-ann-text';
        textDiv.textContent = slideAnnotations[eid];
        item.appendChild(textDiv);

        annotationsEl.appendChild(item);
      });
    }

    btnSave.addEventListener('click', function () {
      modalMessage.textContent = t('modal_confirm_submit') +
        (hasPendingMatrixEdits() ? t('modal_matrix_transform_note') : '');
      modalConfirm.textContent = t('modal_submit');
      modalConfirm.style.display = '';
      modalCancel.textContent = t('modal_cancel');
      modalCancel.style.display = '';
      modalOverlay.style.display = 'flex';
    });

    modalConfirm.addEventListener('click', function () {
      var hadDirectEdits = pendingDirectEditCount() > 0;
      var hadAnnotationChanges = pendingAnnotationChangeCount() > 0;
      modalConfirm.style.display = 'none';
      modalCancel.style.display = 'none';

      drainDirectEdits()
        .then(function () { return fetch(apiUrl('/api/save-all'), { method: 'POST' }); })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (destroyed) return;
          if (data.error) {
            modalMessage.textContent = t('err_save') + data.error;
            modalConfirm.style.display = '';
            modalCancel.style.display = '';
            return;
          }
          if (hadDirectEdits && hadAnnotationChanges) {
            modalMessage.textContent = t('modal_success_mixed');
          } else if (hadDirectEdits) {
            modalMessage.textContent = t('modal_success_direct_only');
          } else if (hadAnnotationChanges) {
            modalMessage.textContent = t('modal_success_annotations_only');
          } else {
            modalMessage.textContent = t('modal_success_submit');
          }
          modalCancel.textContent = t('modal_close');
          modalCancel.style.display = '';
          editStackCount = {};
          matrixEditSlides = {};
          matrixHintShown = false;
          savedHintShown = false;
          annotationsDirty = false;
          annotationEditSlides = {};
          updateUndoButton();
          updatePendingStatus();
          var activeSlide = currentSlide;
          loadSlides().then(function () {
            if (!destroyed && activeSlide) {
              var item = slideListEl.querySelector('.sp-slide-item[data-name="' + cssAttr(activeSlide) + '"]');
              selectSlide(activeSlide, item || undefined);
            }
          });
        })
        .catch(function (err) {
          if (destroyed) return;
          modalMessage.textContent = t('err_save') + err;
          modalConfirm.style.display = '';
          modalCancel.style.display = '';
        });
    });

    modalCancel.addEventListener('click', function () {
      modalConfirm.textContent = t('modal_submit');
      modalOverlay.style.display = 'none';
    });

    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) {
        modalConfirm.textContent = t('modal_submit');
        modalOverlay.style.display = 'none';
      }
    });

    function loadConfig() {
      return fetch(apiUrl('/api/config'), { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          liveMode = !!(data && data.live);
        })
        .catch(function () {
          liveMode = false;
        });
    }

    function startSlidePolling() {
      if (!liveMode || slidePollTimer) return;
      slidePollTimer = window.setInterval(function () {
        if (!destroyed) loadSlides();
      }, 2000);
    }

    function updateUndoButton() {
      if (!btnUndo) return;
      var n = (currentSlide && editStackCount[currentSlide]) || 0;
      btnUndo.disabled = n === 0;
      btnUndo.textContent = n > 0 ? (t('btn_undo') + ' (' + n + ')') : t('btn_undo');
    }

    function runUndo() {
      if (!currentSlide || !editStackCount[currentSlide]) return;
      fetch(apiUrl('/api/slide/' + encodeURIComponent(currentSlide) + '/undo'), { method: 'POST' })
        .then(jsonOrThrow)
        .then(function (data) {
          if (destroyed) return;
          if (data.status === 'empty') {
            editStackCount[currentSlide] = 0;
            matrixEditSlides[currentSlide] = false;
            updateUndoButton();
            updatePendingStatus();
            showWarning(t('undo_empty'));
            return;
          }
          if (data.mtime !== undefined && data.mtime !== null) {
            slideMtimes[currentSlide] = data.mtime;
          }
          var item = slideListEl.querySelector('.sp-slide-item[data-name="' + cssAttr(currentSlide) + '"]');
          selectSlide(currentSlide, item || undefined);
          updatePendingStatus();
          showWarning(t('undo_done'));
        })
        .catch(function (err) {
          if (!destroyed) showError(t('err_edit') + err.message);
        });
    }

    function maybeShowSavedHint() {
      if (savedHintShown) return;
      savedHintShown = true;
      showWarning(t('edit_saved_hint'));
    }

    function payloadHasMatrixTransform(payload) {
      var transform = payload && payload.attrs && payload.attrs.transform;
      return typeof transform === 'string' && /^\s*matrix\s*\(/i.test(transform);
    }

    function hasPendingMatrixEdits() {
      return Object.keys(matrixEditSlides).some(function (name) {
        return !!matrixEditSlides[name];
      });
    }

    function markMatrixTransformEdit(slide) {
      matrixEditSlides[slide] = true;
      if (matrixHintShown) return;
      matrixHintShown = true;
      showWarning(t('warn_matrix_transform'));
    }

    function renderEditableProps(el) {
      var tag = localName(el);
      var isGroup = tag === 'g';
      var html = '<div class="sp-prop-caption">' +
        escapeHtml(isGroup ? t('label_group_edit') : t('label_direct_edit')) + '</div>';

      var parentGroup = nearestParentGroup(el);
      if (parentGroup && !isGroup) {
        html += '<table class="sp-prop-table"><tr><td class="sp-prop-key">group</td><td class="sp-prop-val">' +
          '<button type="button" class="sp-btn-select-group" data-group-id="' +
          escapeHtml(parentGroup.id) + '">' + escapeHtml(t('btn_select_group')) +
          '</button></td></tr></table>';
      }

      html += '<div class="sp-prop-section">' + escapeHtml(t('section_geometry')) + '</div>';
      html += '<table class="sp-prop-table">';
      try {
        var rb = computeRenderBox(el);
        html += '<tr><td class="sp-prop-key">position</td><td class="sp-prop-val sp-geo-cell">' +
          '<input type="number" class="sp-prop-edit sp-prop-edit-geo" data-geo="x" value="' + Math.round(rb.x) + '">' +
          '<input type="number" class="sp-prop-edit sp-prop-edit-geo" data-geo="y" value="' + Math.round(rb.y) + '">' +
          '</td></tr>';
        html += '<tr><td class="sp-prop-key">size</td><td class="sp-prop-val sp-geo-cell">' +
          '<input type="number" class="sp-prop-edit sp-prop-edit-geo" data-geo="w" min="1" value="' + Math.round(rb.w) + '">' +
          '<input type="number" class="sp-prop-edit sp-prop-edit-geo" data-geo="h" min="1" value="' + Math.round(rb.h) + '">' +
          '</td></tr>';
      } catch (e) { /* no geometry */ }
      html += '</table>';

      var textStyleTargets = textStyleTargetsForSelection(el);
      if (tag === 'text' || tag === 'tspan' || textStyleTargets.length > 0) {
        html += '<div class="sp-prop-section">' + escapeHtml(t('section_text_style')) + '</div>';
        html += '<table class="sp-prop-table">';
        if ((tag === 'text' || tag === 'tspan') && el.querySelector('tspan')) {
          html += '<tr><td class="sp-prop-key">content</td><td class="sp-prop-val sp-prop-note">' +
            escapeHtml(t('prop_multiline_hint')) + '</td></tr>';
        } else if (tag === 'text' || tag === 'tspan') {
          html += '<tr><td class="sp-prop-key">content</td><td class="sp-prop-val">' +
            '<textarea class="sp-prop-edit sp-prop-edit-content" rows="2">' +
            escapeHtml(el.textContent || '') + '</textarea></td></tr>';
        }
        if (textStyleTargets.length > 0) {
          textStyleSpecs(textStyleTargets).forEach(function (spec) {
            html += '<tr><td class="sp-prop-key">' + escapeHtml(spec.key) + '</td><td class="sp-prop-val">';
            html += renderTextStyleControl(spec, textStyleTargets);
            html += '</td></tr>';
          });
        }
        html += '</table>';
      }

      html += '<div class="sp-prop-section">' + escapeHtml(t('section_raw_attrs')) + '</div>';
      html += '<table class="sp-prop-table">';
      ownAttributeSpecs(el).forEach(function (spec) {
        html += '<tr><td class="sp-prop-key">' + escapeHtml(spec.key) + '</td><td class="sp-prop-val">';
        if (!spec.editable) {
          html += '<span class="sp-prop-ro">' + escapeHtml(spec.value) + '</span>';
        } else {
          html += renderAttributeControl(spec);
        }
        html += '</td></tr>';
      });
      html += '</table>';
      return html;
    }

    function nearestParentGroup(el) {
      var node = el ? el.parentElement : null;
      while (node && node !== svgContent) {
        if (node.tagName && localName(node) === 'g' && node.id) return node;
        node = node.parentElement;
      }
      return null;
    }

    function ownAttributeSpecs(el) {
      var specs = [];
      Array.from(el.attributes).forEach(function (attr) {
        var key = attr.name;
        if (key === 'class' || key === 'data-edit-target' || key === 'data-edit-annotation') return;
        specs.push({
          key: key,
          value: attr.value,
          editable: isEditableAttributeName(key)
        });
      });
      return specs;
    }

    function isEditableAttributeName(key) {
      var k = String(key).toLowerCase();
      if (k === 'id' || k === 'class' || k === 'href' || k === 'xlink:href') return false;
      if (k.indexOf('on') === 0) return false;
      return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key);
    }

    function textStyleTargetsForSelection(el) {
      if (!el) return [];
      var tag = localName(el);
      if (tag === 'tspan') return el.id ? [el] : [];
      if (tag === 'text') return textStyleLeavesForText(el);
      var targets = [];
      el.querySelectorAll('text').forEach(function (textEl) {
        targets = targets.concat(textStyleLeavesForText(textEl));
      });
      return uniqueElements(targets);
    }

    function textStyleLeavesForText(textEl) {
      var tspans = Array.from(textEl.querySelectorAll('tspan')).filter(function (tspan) {
        return !!tspan.id;
      });
      if (tspans.length > 0) return tspans;
      return textEl.id ? [textEl] : [];
    }

    function uniqueElements(elements) {
      var seen = new Set();
      return elements.filter(function (el) {
        if (!el || !el.id || seen.has(el.id)) return false;
        seen.add(el.id);
        return true;
      });
    }

    function textStyleSpecs(targets) {
      return [
        { key: 'fill', type: 'color' },
        { key: 'font-size', type: 'text' },
        { key: 'font-family', type: 'text' },
        { key: 'font-weight', type: 'select',
          options: ['', 'normal', 'bold', '300', '400', '500', '600', '700', '800'] },
        { key: 'text-anchor', type: 'select', options: ['', 'start', 'middle', 'end'] }
      ].map(function (spec) {
        var value = commonAttrValue(targets, spec.key);
        var copy = Object.assign({}, spec);
        copy.value = value === null ? '' : value;
        copy.mixed = value === null;
        return copy;
      });
    }

    function renderTextStyleControl(spec, targets) {
      var targetIds = encodeURIComponent(JSON.stringify(targets.map(function (el) { return el.id; })));
      var placeholder = spec.mixed ? t('multi_mixed') : '';
      if (spec.type === 'color') {
        return '<div class="sp-color-row">' +
          '<input type="color" class="sp-prop-edit sp-prop-edit-text-style-color" data-key="' +
          escapeHtml(spec.key) + '" data-target-ids="' + targetIds +
          '" value="' + normalizeHexForPicker(spec.value) + '">' +
          '<input type="text" class="sp-prop-edit sp-prop-edit-text-style" data-key="' +
          escapeHtml(spec.key) + '" data-target-ids="' + targetIds +
          '" placeholder="' + escapeHtml(placeholder) +
          '" value="' + escapeHtml(spec.mixed ? '' : spec.value) + '"></div>';
      }
      if (spec.type === 'select') {
        var html = '<select class="sp-prop-edit sp-prop-edit-text-style" data-key="' +
          escapeHtml(spec.key) + '" data-target-ids="' + targetIds + '">';
        var hasValue = spec.options.indexOf(spec.value) !== -1;
        if (!spec.mixed && spec.value && !hasValue) {
          html += '<option value="' + escapeHtml(spec.value) + '" selected>' +
            escapeHtml(spec.value) + '</option>';
        }
        spec.options.forEach(function (opt) {
          var label = opt || placeholder || '';
          var selected = !spec.mixed && spec.value === opt ? ' selected' : '';
          html += '<option value="' + escapeHtml(opt) + '"' + selected + '>' +
            escapeHtml(label) + '</option>';
        });
        html += '</select>';
        return html;
      }
      return '<input type="text" class="sp-prop-edit sp-prop-edit-text-style" data-key="' +
        escapeHtml(spec.key) + '" data-target-ids="' + targetIds +
        '" placeholder="' + escapeHtml(placeholder) +
        '" value="' + escapeHtml(spec.mixed ? '' : spec.value) + '">';
    }

    function isColorAttribute(key, value) {
      var k = String(key).toLowerCase();
      if (['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'].indexOf(k) !== -1) {
        return isSafeColor(value);
      }
      return false;
    }

    function renderAttributeControl(spec) {
      if (isColorAttribute(spec.key, spec.value)) {
        return '<div class="sp-color-row">' +
          '<input type="color" class="sp-prop-edit sp-prop-edit-color" data-key="' +
          escapeHtml(spec.key) + '" value="' + normalizeHexForPicker(spec.value) + '">' +
          '<input type="text" class="sp-prop-edit sp-prop-edit-color-text" data-key="' +
          escapeHtml(spec.key) + '" value="' + escapeHtml(spec.value) + '"></div>';
      }
      if (spec.value.length > 60 || spec.key === 'd' || spec.key === 'points' || spec.key === 'style') {
        return '<textarea class="sp-prop-edit sp-prop-edit-attr-area" rows="2" data-key="' +
          escapeHtml(spec.key) + '">' + escapeHtml(spec.value) + '</textarea>';
      }
      return '<input type="text" class="sp-prop-edit sp-prop-edit-attr" data-key="' +
        escapeHtml(spec.key) + '" value="' + escapeHtml(spec.value) + '">';
    }

    function computeRenderBox(el) {
      var bbox = el.getBBox();
      var ctm = el.getCTM();
      if (!ctm) return { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
      var corners = [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x, y: bbox.y + bbox.height },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height }
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      corners.forEach(function (p) {
        var sx = p.x * ctm.a + p.y * ctm.c + ctm.e;
        var sy = p.x * ctm.b + p.y * ctm.d + ctm.f;
        minX = Math.min(minX, sx); minY = Math.min(minY, sy);
        maxX = Math.max(maxX, sx); maxY = Math.max(maxY, sy);
      });
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function ownMatrix(el) {
      var tr = el.transform && el.transform.baseVal;
      if (tr && tr.numberOfItems) {
        var c = tr.consolidate();
        if (c) {
          var m = c.matrix;
          return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
        }
      }
      return new DOMMatrix();
    }

    function parentCTM(el) {
      var p = el.parentNode;
      var pm = (p && p.getCTM) ? p.getCTM() : null;
      return pm ? new DOMMatrix([pm.a, pm.b, pm.c, pm.d, pm.e, pm.f]) : new DOMMatrix();
    }

    function matrixAfterMove(el, rb, nx, ny) {
      var pm = parentCTM(el);
      var rx = nx - rb.x, ry = ny - rb.y;
      var det = pm.a * pm.d - pm.b * pm.c || 1;
      var dpx = (pm.d * rx - pm.c * ry) / det;
      var dpy = (-pm.b * rx + pm.a * ry) / det;
      return new DOMMatrix().translate(dpx, dpy).multiply(ownMatrix(el));
    }

    function matrixAfterResize(el, rb, nw, nh) {
      var pm = parentCTM(el);
      var sx = nw / rb.w, sy = nh / rb.h;
      var im = pm.inverse();
      var ax = im.a * rb.x + im.c * rb.y + im.e;
      var ay = im.b * rb.x + im.d * rb.y + im.f;
      return new DOMMatrix()
        .translate(ax, ay).scale(sx, sy).translate(-ax, -ay)
        .multiply(ownMatrix(el));
    }

    function matrixToString(m) {
      var r = function (v) { return Math.round(v * 1e6) / 1e6; };
      var values = [m.a, m.b, m.c, m.d, m.e, m.f].map(r);
      if (!values.every(function (v) { return Number.isFinite(v); })) return null;
      return 'matrix(' + values.join(',') + ')';
    }

    function refreshGeoInputs(el, panel) {
      var rb = computeRenderBox(el);
      var vals = { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.w), h: Math.round(rb.h) };
      Object.keys(vals).forEach(function (k) {
        var inp = panel.querySelector('.sp-prop-edit-geo[data-geo="' + k + '"]');
        if (inp && document.activeElement !== inp) inp.value = vals[k];
      });
    }

    function shiftedAttrValue(el, key, delta) {
      var parsed = splitNumberUnit(el.getAttribute(key));
      if (!parsed || !Number.isFinite(parsed.num)) return null;
      var next = Math.round((parsed.num + delta) * 1000) / 1000;
      return String(next) + parsed.unit;
    }

    function parentDelta(dx, dy, el) {
      var pm = parentCTM(el);
      var det = pm.a * pm.d - pm.b * pm.c;
      if (Math.abs(det) < 1e-9) return null;
      return {
        x: (pm.d * dx - pm.c * dy) / det,
        y: (-pm.b * dx + pm.a * dy) / det
      };
    }

    function tspanBaseline(tspan) {
      var text = tspan && tspan.parentElement;
      if (!text || localName(text) !== 'text') return null;
      var curX = firstNumber(text.getAttribute('x'));
      var curY = firstNumber(text.getAttribute('y'));
      var children = Array.from(text.children);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (localName(child) !== 'tspan') continue;
        var x = firstNumber(child.getAttribute('x'));
        var y = firstNumber(child.getAttribute('y'));
        var dx = firstNumber(child.getAttribute('dx'));
        var dy = firstNumber(child.getAttribute('dy'));
        if (x !== null) curX = x;
        else if (dx !== null) curX = (curX || 0) + dx;
        if (y !== null) curY = y;
        else if (dy !== null) curY = (curY || 0) + dy;
        if (child === tspan) break;
      }
      if (curX === null || curY === null) return null;
      return { x: curX, y: curY };
    }

    function tspanPromotionPayload(tspan) {
      if (localName(tspan) !== 'tspan') return null;
      var base = tspanBaseline(tspan);
      if (!base) return null;
      var own = ownMatrix(tspan);
      var close = function (a, b) { return Math.abs(a - b) < 1e-6; };
      if (!close(own.a, 1) || !close(own.b, 0) ||
          !close(own.c, 0) || !close(own.d, 1)) return null;
      return {
        x: formatCoord(base.x + own.e),
        y: formatCoord(base.y + own.f)
      };
    }

    function copyTextAttrs(src, dst, skip) {
      Array.from(src.attributes || []).forEach(function (attr) {
        if (skip[attr.name]) return;
        dst.setAttribute(attr.name, attr.value);
      });
    }

    function adjustedDyValue(oldValue, nextY, prevY) {
      var parsed = splitNumberUnit(oldValue);
      if (!parsed) return formatCoord(nextY - prevY);
      return formatCoord(nextY - prevY) + parsed.unit;
    }

    function promoteTspanDom(tspan, promoted) {
      var text = tspan && tspan.parentElement;
      if (!text || localName(tspan) !== 'tspan' || localName(text) !== 'text') return null;
      var next = tspan.nextElementSibling;
      var nextBase = next && localName(next) === 'tspan' ? tspanBaseline(next) : null;
      var prev = tspan.previousElementSibling;
      var prevBase = prev && localName(prev) === 'tspan' ? tspanBaseline(prev) : null;
      var parentBaseY = firstNumber(text.getAttribute('y')) || 0;

      var newText = document.createElementNS(tspan.namespaceURI, 'text');
      copyTextAttrs(text, newText, { id: true, x: true, y: true, dx: true, dy: true });
      copyTextAttrs(tspan, newText, {
        id: true, x: true, y: true, dx: true, dy: true, transform: true
      });
      newText.setAttribute('id', tspan.id);
      newText.setAttribute('x', promoted.x);
      newText.setAttribute('y', promoted.y);

      Array.from(tspan.childNodes || []).forEach(function (node) {
        newText.appendChild(node.cloneNode(true));
      });
      if (newText.childNodes.length === 0) {
        newText.textContent = tspan.textContent || '';
      }

      var textParent = text.parentNode;
      var textNext = text.nextSibling;
      var textClone = text.cloneNode(true);
      newText.__promotionRollback = function () {
        if (newText.parentNode) newText.parentNode.removeChild(newText);
        if (text.parentNode) text.parentNode.removeChild(text);
        if (textParent) {
          if (textNext && textNext.parentNode === textParent) {
            textParent.insertBefore(textClone, textNext);
          } else {
            textParent.appendChild(textClone);
          }
        }
        selectedElementIds.delete(newText.id);
        selectedElementIds.add(tspan.id);
        markSelection();
        return textClone.querySelector('#' + CSS.escape(tspan.id)) || textClone;
      };

      text.parentNode.insertBefore(newText, text.nextSibling);
      text.removeChild(tspan);
      if (next && nextBase && !next.hasAttribute('y') && next.hasAttribute('dy')) {
        next.setAttribute('dy', adjustedDyValue(
          next.getAttribute('dy'),
          nextBase.y,
          prevBase ? prevBase.y : parentBaseY
        ));
      }
      if (!(text.textContent || '').trim() && text.children.length === 0) {
        text.parentNode.removeChild(text);
      }
      selectedElementIds.delete(tspan.id);
      selectedElementIds.add(newText.id);
      markSelection();
      return newText;
    }

    function payloadForMovedElement(el, attrs) {
      var promoted = tspanPromotionPayload(el);
      if (promoted) return { promote_tspan: promoted };
      return { attrs: attrs };
    }

    function canUseRawGeometry(el) {
      var own = ownMatrix(el);
      var close = function (a, b) { return Math.abs(a - b) < 1e-6; };
      if (close(own.b, 0) && close(own.c, 0)) {
        if (close(own.a, 1) && close(own.d, 1)) return 'translate';
        if (localName(el) === 'use') return 'use-transform';
        if (['rect', 'image'].indexOf(localName(el)) !== -1) return 'box-transform';
      }
      return '';
    }

    function rawMoveAttrs(el, dx, dy) {
      if (localName(el) === 'g' && el.hasAttribute('data-icon') &&
          el.hasAttribute('data-use-x') && el.hasAttribute('data-use-y')) {
        var iconOwn = ownMatrix(el);
        var close = function (a, b) { return Math.abs(a - b) < 1e-6; };
        if (close(iconOwn.b, 0) && close(iconOwn.c, 0)) {
          var iconDelta = parentDelta(dx, dy, el);
          if (iconDelta) {
            var iconAttrs = {
              x: formatCoord(iconOwn.e + iconDelta.x),
              y: formatCoord(iconOwn.f + iconDelta.y)
            };
            if (el.hasAttribute('data-use-has-transform')) iconAttrs.transform = null;
            return iconAttrs;
          }
        }
      }

      var rawMode = canUseRawGeometry(el);
      if (!rawMode) return null;
      var d = parentDelta(dx, dy, el);
      if (!d) return null;
      var tag = localName(el);
      var attrs = {};
      var own = ownMatrix(el);
      var add = function (key, delta) {
        if (!el.hasAttribute(key)) return false;
        var next = shiftedAttrValue(el, key, delta);
        if (next === null) return false;
        attrs[key] = next;
        return true;
      };
      var fmt = function (value) { return String(Math.round(value * 1000) / 1000); };
      var bakeTranslate = function (xKey, yKey) {
        if (!el.hasAttribute(xKey) || !el.hasAttribute(yKey)) return false;
        if (rawMode === 'use-transform') {
          attrs[xKey] = fmt(own.e + d.x);
          attrs[yKey] = fmt(own.f + d.y);
          attrs.transform = null;
          return true;
        }
        var nx = shiftedAttrValue(el, xKey, own.e + d.x);
        var ny = shiftedAttrValue(el, yKey, own.f + d.y);
        if (nx === null || ny === null) return false;
        attrs[xKey] = nx;
        attrs[yKey] = ny;
        if (el.hasAttribute('transform')) attrs.transform = null;
        return true;
      };
      var bakeBox = function () {
        if (!el.hasAttribute('x') || !el.hasAttribute('y') ||
            !el.hasAttribute('width') || !el.hasAttribute('height')) return false;
        var x = splitNumberUnit(el.getAttribute('x'));
        var y = splitNumberUnit(el.getAttribute('y'));
        var w = splitNumberUnit(el.getAttribute('width'));
        var h = splitNumberUnit(el.getAttribute('height'));
        if (!x || !y || !w || !h || x.unit !== y.unit ||
            x.unit !== w.unit || x.unit !== h.unit) return false;
        attrs.x = fmt(own.a * x.num + own.e + d.x) + x.unit;
        attrs.y = fmt(own.d * y.num + own.f + d.y) + y.unit;
        attrs.width = fmt(Math.abs(own.a) * w.num) + w.unit;
        attrs.height = fmt(Math.abs(own.d) * h.num) + h.unit;
        attrs.transform = null;
        return true;
      };

      if (rawMode === 'box-transform') return bakeBox() ? attrs : null;
      if (['rect', 'image', 'use', 'text'].indexOf(tag) !== -1) return bakeTranslate('x', 'y') ? attrs : null;
      if (tag === 'circle' || tag === 'ellipse') return bakeTranslate('cx', 'cy') ? attrs : null;
      if (tag === 'line') {
        if (add('x1', own.e + d.x) && add('x2', own.e + d.x) &&
            add('y1', own.f + d.y) && add('y2', own.f + d.y)) {
          if (el.hasAttribute('transform')) attrs.transform = null;
          return attrs;
        }
        return null;
      }
      return null;
    }

    function attrsForMove(el, dx, dy) {
      var attrs = rawMoveAttrs(el, dx, dy);
      if (attrs) return attrs;
      var rb = computeRenderBox(el);
      var moved = matrixAfterMove(el, rb, rb.x + dx, rb.y + dy);
      var tstr = matrixToString(moved);
      return tstr ? { transform: tstr } : null;
    }

    function computeElementsBox(elements) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      elements.forEach(function (el) {
        var rb = computeRenderBox(el);
        minX = Math.min(minX, rb.x);
        minY = Math.min(minY, rb.y);
        maxX = Math.max(maxX, rb.x + rb.w);
        maxY = Math.max(maxY, rb.y + rb.h);
      });
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function topLevelSelectedElements(ids) {
      var els = ids.map(function (eid) {
        return svgContent.querySelector('#' + CSS.escape(eid));
      }).filter(Boolean);
      return els.filter(function (el) {
        return !els.some(function (other) { return other !== el && other.contains(el); });
      });
    }

    function attachPropEditors(el) {
      var eid = el.id;
      var panel = elementPropsEl;

      var groupBtn = panel.querySelector('.sp-btn-select-group');
      if (groupBtn) {
        groupBtn.addEventListener('click', function () {
          var gid = groupBtn.getAttribute('data-group-id');
          var groupEl = gid ? svgContent.querySelector('#' + CSS.escape(gid)) : null;
          if (groupEl) selectElement(groupEl, false);
        });
      }

      var contentBox = panel.querySelector('.sp-prop-edit-content');
      if (contentBox) {
        contentBox.addEventListener('change', function () {
          var newText = contentBox.value;
          stageEditRequest(eid, { text: newText })
            .then(function () { if (!destroyed) el.textContent = newText; })
            .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
        });
      }

      panel.querySelectorAll('.sp-prop-edit-color').forEach(function (picker) {
        var key = picker.getAttribute('data-key');
        var textInput = panel.querySelector('.sp-prop-edit-color-text[data-key="' + key + '"]');
        picker.addEventListener('input', function () {
          if (textInput) textInput.value = picker.value;
        });
        picker.addEventListener('change', function () {
          stageAttr(el, eid, key, picker.value);
        });
      });
      panel.querySelectorAll('.sp-prop-edit-color-text').forEach(function (textInput) {
        var key = textInput.getAttribute('data-key');
        var picker = panel.querySelector('input.sp-prop-edit-color[data-key="' + key + '"]');
        textInput.addEventListener('change', function () {
          var v = textInput.value.trim();
          if (picker) picker.value = normalizeHexForPicker(v);
          stageAttr(el, eid, key, v);
        });
      });

      panel.querySelectorAll('.sp-prop-edit-text-style-color').forEach(function (picker) {
        var key = picker.getAttribute('data-key');
        var textInput = panel.querySelector('.sp-prop-edit-text-style[data-key="' + key + '"]');
        picker.addEventListener('input', function () {
          if (textInput) textInput.value = picker.value;
        });
        picker.addEventListener('change', function () {
          if (textInput) textInput.value = picker.value;
          stageTextStyleAttr(key, picker.value, picker.getAttribute('data-target-ids'));
        });
      });
      panel.querySelectorAll('.sp-prop-edit-text-style').forEach(function (input) {
        input.addEventListener('change', function () {
          var key = input.getAttribute('data-key');
          var value = normalizeEditableAttrValue(key, input.value);
          if (!value) return;
          stageTextStyleAttr(key, value, input.getAttribute('data-target-ids'));
        });
      });

      panel.querySelectorAll('.sp-prop-edit-attr, .sp-prop-edit-attr-area').forEach(function (input) {
        var key = input.getAttribute('data-key');
        input.addEventListener('change', function () {
          stageAttr(el, eid, key, normalizeEditableAttrValue(key, input.value));
        });
      });

      if (panel.querySelector('.sp-prop-edit-geo')) {
        var readGeo = function (k) {
          var inp = panel.querySelector('.sp-prop-edit-geo[data-geo="' + k + '"]');
          return inp ? parseFloat(inp.value) : NaN;
        };
        var commitGeo = function (mode) {
          var rb;
          try { rb = computeRenderBox(el); } catch (e) { return; }
          var newM;
          var attrs = null;
          if (mode === 'move') {
            var nx = readGeo('x'), ny = readGeo('y');
            if (isNaN(nx) || isNaN(ny)) return;
            if (Math.abs(nx - rb.x) < 1e-6 && Math.abs(ny - rb.y) < 1e-6) return;
            attrs = attrsForMove(el, nx - rb.x, ny - rb.y);
            if (!attrs) newM = matrixAfterMove(el, rb, nx, ny);
          } else {
            var nw = readGeo('w'), nh = readGeo('h');
            if (isNaN(nw) || isNaN(nh) || nw <= 0 || nh <= 0 || rb.w <= 0 || rb.h <= 0) {
              showError(t('err_edit') + 'size');
              return;
            }
            if (Math.abs(nw - rb.w) < 1e-6 && Math.abs(nh - rb.h) < 1e-6) return;
            newM = matrixAfterResize(el, rb, nw, nh);
          }
          if (!attrs) {
            var tstr = matrixToString(newM);
            if (!tstr) {
              showError(t('err_edit') + 'transform');
              return;
            }
            attrs = { transform: tstr };
          }
          var payload = mode === 'move' ? payloadForMovedElement(el, attrs) : { attrs: attrs };
          stageEditRequest(eid, payload)
            .then(function () {
              if (destroyed) return;
              if (payload.promote_tspan) {
                el = promoteTspanDom(el, payload.promote_tspan) || el;
              } else {
                applyElementAttrs(el, attrs);
                markCommittedAttrs(el, attrs);
              }
              refreshGeoInputs(el, panel);
            })
            .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
        };
        panel.querySelectorAll('.sp-prop-edit-geo[data-geo="x"], .sp-prop-edit-geo[data-geo="y"]').forEach(function (inp) {
          inp.addEventListener('change', function () { commitGeo('move'); });
        });
        panel.querySelectorAll('.sp-prop-edit-geo[data-geo="w"], .sp-prop-edit-geo[data-geo="h"]').forEach(function (inp) {
          inp.addEventListener('change', function () { commitGeo('resize'); });
        });
      }
    }

    function stageTextStyleAttr(key, value, encodedTargetIds) {
      value = normalizeEditableAttrValue(key, value);
      if ((key === 'fill' || key === 'stroke') && !isSafeColor(value)) {
        showError(t('err_edit') + key);
        return;
      }
      var ids;
      try {
        ids = JSON.parse(decodeURIComponent(encodedTargetIds || '%5B%5D'));
      } catch (e) {
        ids = [];
      }
      var targets = ids.map(function (id) {
        return svgContent.querySelector('#' + CSS.escape(id));
      }).filter(function (target) {
        return target && attrOrComputedValue(target, key) !== value;
      });
      if (targets.length === 0) return;

      var attrs = {};
      attrs[key] = value;
      var jobs = targets.map(function (target) {
        return stageEditRequest(target.id, { attrs: attrs }).then(function () {
          if (!destroyed) target.setAttribute(key, value);
        });
      });
      Promise.all(jobs)
        .then(function () { if (!destroyed) updateSelectionPanel(); })
        .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
    }

    function stageAttr(el, eid, key, value) {
      value = normalizeEditableAttrValue(key, value);
      if ((key === 'fill' || key === 'stroke') && !isSafeColor(value)) {
        showError(t('err_edit') + key);
        return;
      }
      var attrs = {};
      attrs[key] = value;
      stageEditRequest(eid, { attrs: attrs })
        .then(function () { if (!destroyed) applyElementAttrs(el, attrs); })
        .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
    }

    function drainDirectEdits() {
      if (inFlightEdits.size === 0) return Promise.resolve();
      return Promise.allSettled(Array.from(inFlightEdits)).then(function (results) {
        var failed = results.find(function (r) { return r.status === 'rejected'; });
        if (failed) throw (failed.reason || new Error('direct edit failed'));
        return drainDirectEdits();
      });
    }

    function stageEditRequest(eid, payload, slideName) {
      var slide = slideName || currentSlide;
      var body = { element_id: eid };
      if (payload.text !== undefined) body.text = payload.text;
      if (payload.attrs !== undefined) body.attrs = payload.attrs;
      if (payload.promote_tspan !== undefined) body.promote_tspan = payload.promote_tspan;
      var p = fetch(apiUrl('/api/slide/' + encodeURIComponent(slide) + '/edit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(jsonOrThrow).then(function (data) {
        if (destroyed) return data;
        if (data && data.undo_depth !== undefined) {
          editStackCount[slide] = data.undo_depth;
          if (slide === currentSlide) updateUndoButton();
          updatePendingStatus();
        }
        if (payloadHasMatrixTransform(payload)) markMatrixTransformEdit(slide);
        maybeShowSavedHint();
        return data;
      });
      inFlightEdits.add(p);
      var done = function () { inFlightEdits.delete(p); };
      p.then(done, done);
      return p;
    }

    function renderMultiSelectSummary(ids) {
      var moveEls = topLevelSelectedElements(ids);
      var summary = '<div class="sp-prop-caption">' + escapeHtml(t('label_batch_edit')) + '</div>';

      if (moveEls.length > 0) {
        try {
          var rb = computeElementsBox(moveEls);
          summary += '<div class="sp-prop-section">' + escapeHtml(t('section_geometry')) + '</div>';
          summary += '<table class="sp-prop-table"><tr><td class="sp-prop-key">x / y</td>' +
            '<td class="sp-prop-val sp-geo-cell">' +
            '<input type="number" class="sp-prop-edit sp-prop-edit-multi-geo" data-geo="x" value="' + Math.round(rb.x) + '">' +
            '<input type="number" class="sp-prop-edit sp-prop-edit-multi-geo" data-geo="y" value="' + Math.round(rb.y) + '">' +
            '</td></tr></table>';
        } catch (e) { /* no multi geometry */ }
      }
      summary += '<div class="sp-prop-section">' + escapeHtml(t('section_style')) + '</div>';
      summary += '<table class="sp-prop-table">';
      batchEditSpecs(moveEls).forEach(function (spec) {
        summary += '<tr><td class="sp-prop-key">' + escapeHtml(spec.key) + '</td><td class="sp-prop-val">';
        summary += renderBatchControl(spec);
        summary += '</td></tr>';
      });
      summary += '</table>';
      return summary;
    }

    function batchEditSpecs(elements) {
      var keys = [
        { key: 'fill', type: 'color' },
        { key: 'stroke', type: 'color' },
        { key: 'opacity', type: 'number', min: '0', max: '1', step: '0.05' }
      ];
      if (elements.length > 0 && elements.every(isTextElement)) {
        keys = keys.concat([
          { key: 'font-size', type: 'text' },
          { key: 'font-family', type: 'text' },
          { key: 'font-weight', type: 'select',
            options: ['', 'normal', 'bold', '300', '400', '500', '600', '700', '800'] },
          { key: 'text-anchor', type: 'select', options: ['', 'start', 'middle', 'end'] }
        ]);
      }
      return keys.map(function (spec) {
        var value = commonAttrValue(elements, spec.key);
        var copy = Object.assign({}, spec);
        copy.value = value === null ? '' : value;
        copy.mixed = value === null;
        return copy;
      });
    }

    function isTextElement(el) {
      var tag = el.tagName.toLowerCase();
      return tag === 'text' || tag === 'tspan';
    }

    function commonAttrValue(elements, key) {
      if (elements.length === 0) return '';
      var first = attrOrComputedValue(elements[0], key);
      for (var i = 1; i < elements.length; i++) {
        if (attrOrComputedValue(elements[i], key) !== first) return null;
      }
      return first;
    }

    function attrOrComputedValue(el, key) {
      var value = el.getAttribute(key);
      if (value !== null && value !== '') return normalizeSvgLengthValue(key, value);
      var style = window.getComputedStyle(el);
      var map = {
        'fill': 'fill',
        'stroke': 'stroke',
        'opacity': 'opacity',
        'font-size': 'fontSize',
        'font-family': 'fontFamily',
        'font-weight': 'fontWeight',
        'text-anchor': 'textAnchor'
      };
      return normalizeSvgLengthValue(key, (map[key] && style[map[key]]) || '');
    }

    function renderBatchControl(spec) {
      var placeholder = spec.mixed ? t('multi_mixed') : '';
      if (spec.type === 'color') {
        return '<div class="sp-color-row">' +
          '<input type="color" class="sp-prop-edit sp-prop-edit-batch-color" data-key="' +
          escapeHtml(spec.key) + '" value="' + normalizeHexForPicker(spec.value) + '">' +
          '<input type="text" class="sp-prop-edit sp-prop-edit-batch" data-key="' +
          escapeHtml(spec.key) + '" placeholder="' + escapeHtml(placeholder) +
          '" value="' + escapeHtml(spec.mixed ? '' : spec.value) + '"></div>';
      }
      if (spec.type === 'number') {
        return '<input type="number" class="sp-prop-edit sp-prop-edit-batch" data-key="' +
          escapeHtml(spec.key) + '" min="' + escapeHtml(spec.min || '') +
          '" max="' + escapeHtml(spec.max || '') + '" step="' +
          escapeHtml(spec.step || '1') + '" placeholder="' + escapeHtml(placeholder) +
          '" value="' + escapeHtml(spec.mixed ? '' : spec.value) + '">';
      }
      if (spec.type === 'select') {
        var html = '<select class="sp-prop-edit sp-prop-edit-batch" data-key="' + escapeHtml(spec.key) + '">';
        spec.options.forEach(function (opt) {
          var label = opt || placeholder || '';
          var selected = !spec.mixed && spec.value === opt ? ' selected' : '';
          html += '<option value="' + escapeHtml(opt) + '"' + selected + '>' +
            escapeHtml(label) + '</option>';
        });
        html += '</select>';
        return html;
      }
      return '<input type="text" class="sp-prop-edit sp-prop-edit-batch" data-key="' +
        escapeHtml(spec.key) + '" placeholder="' + escapeHtml(placeholder) +
        '" value="' + escapeHtml(spec.mixed ? '' : spec.value) + '">';
    }

    function attachMultiSelectionEditors(ids) {
      var panel = elementPropsEl;
      var moveEls = topLevelSelectedElements(ids);
      if (moveEls.length === 0) return;

      var readGeo = function (k) {
        var inp = panel.querySelector('.sp-prop-edit-multi-geo[data-geo="' + k + '"]');
        return inp ? parseFloat(inp.value) : NaN;
      };
      var commitMove = function () {
        var rb;
        try { rb = computeElementsBox(moveEls); } catch (e) { return; }
        var nx = readGeo('x'), ny = readGeo('y');
        if (isNaN(nx) || isNaN(ny)) return;
        var dx = nx - rb.x, dy = ny - rb.y;
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;

        var jobs = [];
        moveEls.forEach(function (el) {
          var attrs;
          try { attrs = attrsForMove(el, dx, dy); } catch (e) { attrs = null; }
          if (!attrs) return;
          var payload = payloadForMovedElement(el, attrs);
          jobs.push(stageEditRequest(el.id, payload).then(function () {
            if (destroyed) return;
            if (payload.promote_tspan) promoteTspanDom(el, payload.promote_tspan);
            else {
              applyElementAttrs(el, attrs);
              markCommittedAttrs(el, attrs);
            }
          }));
        });

        Promise.all(jobs)
          .then(function () { if (!destroyed) updateSelectionPanel(); })
          .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
      };

      panel.querySelectorAll('.sp-prop-edit-multi-geo').forEach(function (inp) {
        inp.addEventListener('change', commitMove);
      });

      panel.querySelectorAll('.sp-prop-edit-batch-color').forEach(function (picker) {
        var key = picker.getAttribute('data-key');
        var text = panel.querySelector('.sp-prop-edit-batch[data-key="' + key + '"]');
        picker.addEventListener('input', function () {
          if (text) text.value = picker.value;
        });
        picker.addEventListener('change', function () {
          if (text) text.value = picker.value;
          commitBatchAttr(key, picker.value, moveEls);
        });
      });

      panel.querySelectorAll('.sp-prop-edit-batch').forEach(function (input) {
        input.addEventListener('change', function () {
          var key = input.getAttribute('data-key');
          var value = normalizeEditableAttrValue(key, input.value);
          if (!value) return;
          commitBatchAttr(key, value, moveEls);
        });
      });
    }

    function commitBatchAttr(key, value, elements) {
      value = normalizeEditableAttrValue(key, value);
      if ((key === 'fill' || key === 'stroke') && !isSafeColor(value)) {
        showError(t('err_edit') + key);
        return;
      }
      var jobs = elements.map(function (el) {
        var attrs = {};
        attrs[key] = value;
        return stageEditRequest(el.id, { attrs: attrs }).then(function () {
          if (!destroyed) applyElementAttrs(el, attrs);
        });
      });
      Promise.all(jobs)
        .then(function () { if (!destroyed) updateSelectionPanel(); })
        .catch(function (err) { if (!destroyed) showError(t('err_edit') + err.message); });
    }

    initAnnotationQuickActions();
    updatePendingStatus();
    initRubberBand();
    initKeyboardShortcuts();
    initSlideNav();
    if (btnUndo) btnUndo.addEventListener('click', runUndo);

    loadConfig().then(function () {
      if (destroyed) return;
      loadSlides();
      startSlidePolling();
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (slidePollTimer) {
        window.clearInterval(slidePollTimer);
        slidePollTimer = null;
      }
      pendingTimers.forEach(function (id) { window.clearTimeout(id); });
      pendingTimers = [];
      globalCleanups.forEach(function (fn) {
        try { fn(); } catch (e) { /* ignore */ }
      });
      globalCleanups = [];
      document.body.classList.remove('svg-dragging');
      if (rubberBandEl) {
        rubberBandEl.remove();
        rubberBandEl = null;
      }
      closeOverlapPicker();
      hideReloadBanner();
      container.innerHTML = '';
    }

    return {
      destroy: destroy,
      selectSlide: function (name) {
        if (!destroyed && name && slideNames.indexOf(name) !== -1) {
          selectSlide(name);
        }
      }
    };
  }

  window.WorkbenchSlidePreview = {
    mount: mount
  };
})();
