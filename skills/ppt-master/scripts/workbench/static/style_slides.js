/* Authentic 4-slide (Cover / Chapter / Content / Data) live SVG preview renderer for all 18 visual_styles. */
(function () {
  'use strict';

  var uidSeq = 0;

  var STYLE_SWATCH = {
    'swiss-minimal': '#DC2626',
    'soft-rounded': '#4F46E5',
    'glassmorphism': '#8B5CF6',
    'dark-tech': '#06B6D4',
    'blueprint': '#1D4ED8',
    'editorial': '#B45309',
    'photo-editorial': '#0F766E',
    'data-journalism': '#E11D48',
    'brutalist': '#111111',
    'memphis': '#FF6B6B',
    'zine': '#F72585',
    'vintage-poster': '#C84B31',
    'paper-cut': '#D97706',
    'sketch-notes': '#F59E0B',
    'ink-notes': '#334155',
    'chalkboard': '#23423C',
    'ink-wash': '#991B1B',
    'pixel-art': '#7C3AED'
  };

  var FALLBACK_COPY = {
    zh: {
      coverTitle: '演示主题核心标题',
      coverSub: '围绕核心议题展开关键事实、成因拆解与行动方案',
      chapterTitle: '核心章节：关键机制与成因剖析',
      chapterSub: '从全局背景切入核心矛盾，看懂变化背后的深层规律',
      contentTitle: '三大核心要点与关键事实拆解',
      contentBullets: [
        '核心概念界定：厘清关键机制与底层逻辑框架',
        '典型特征拆解：归纳三项最具代表性的实证表现',
        '认知误区辨析：打破常见直觉偏差并建立科学视角'
      ],
      dataTitle: '关键数据对比与量化证据总览',
      dataBullets: [
        '核心占比达 56%，居关键维度首位',
        '跨阶段关键指标累计变化幅度显著',
        '多维对照揭示长期演进的核心规律'
      ],
      roles: ['封面', '章节', '正文', '数据'],
      labels: ['01 · 封面', '02 · 章节过渡页', '03 · 核心要点页', '04 · 数据对比页'],
      pointFoot: '核心论据 · 第 {n} 组',
      barLabels: ['核心项 A', '对比项 B', '对比项 C', '基准参考'],
      chalkTag: '★ 主题课程导读',
      sketchTag: '✎ 主题要点导览',
      sealChar: '印'
    },
    'zh-TW': {
      coverTitle: '簡報主題核心標題',
      coverSub: '圍繞核心議題展開關鍵事實、脈絡拆解與行動方案',
      chapterTitle: '核心章節：關鍵機制與脈絡剖析',
      chapterSub: '從全局背景切入核心問題，看懂變化背後的深層規律',
      contentTitle: '三大核心要點與關鍵事實拆解',
      contentBullets: [
        '核心概念界定：釐清關鍵機制與底層邏輯架構',
        '典型特徵拆解：歸納三項最具代表性的實證表現',
        '認知盲點辨析：打破常見直覺偏差並建立完整視角'
      ],
      dataTitle: '關鍵數據對比與量化證據總覽',
      dataBullets: [
        '核心占比達 56%，居關鍵維度首位',
        '跨階段關鍵指標累計變化幅度顯著',
        '多維對照揭示長期演進的核心規律'
      ],
      roles: ['封面', '章節', '正文', '數據'],
      labels: ['01 · 封面', '02 · 章節過渡頁', '03 · 核心要點頁', '04 · 數據對比頁'],
      pointFoot: '核心論據 · 第 {n} 組',
      barLabels: ['核心項 A', '對比項 B', '對比項 C', '基準參考'],
      chalkTag: '★ 主題課程導讀',
      sketchTag: '✎ 主題要點導覽',
      sealChar: '印'
    },
    en: {
      coverTitle: 'Presentation Core Title',
      coverSub: 'Key findings, structural breakdown, and clear next steps',
      chapterTitle: 'Chapter One: Core Context & Structure',
      chapterSub: 'Framing the main tension before zooming into key evidence',
      contentTitle: 'Three Key Takeaways & Supporting Evidence',
      contentBullets: [
        'Core thesis: establish the main logic and framing clearly',
        'Key patterns: highlight three concrete observations',
        'Practical takeaway: translate insight into clear action'
      ],
      dataTitle: 'Key Metrics & Comparative Evidence',
      dataBullets: [
        'Primary share reaches 56% across the core benchmark',
        'Steady improvement across major tracked milestones',
        'Side-by-side comparison clarifies strategic priority'
      ],
      roles: ['Cover', 'Chapter', 'Content', 'Data'],
      labels: ['01 · Cover', '02 · Chapter Divider', '03 · Key Points', '04 · Data View'],
      pointFoot: 'Key Point · 0{n}',
      barLabels: ['Primary', 'Group B', 'Group C', 'Baseline'],
      chalkTag: '★ LESSON OVERVIEW',
      sketchTag: '✎ VISUAL NOTES',
      sealChar: '雅'
    },
    ja: {
      coverTitle: 'プレゼンテーション主題タイトル',
      coverSub: '重要ファクトの整理、構造分析、次のアクションを提示',
      chapterTitle: '第1章：背景と重要構造の整理',
      chapterSub: '全体像から核心課題へ段階的に掘り下げる構成',
      contentTitle: '3つの重要ポイントと根拠の整理',
      contentBullets: [
        '核心の定義：前提条件と基本構造を明確化',
        '特徴の比較：代表的な3つの観点を対比',
        '実践への示唆：具体的な改善アクションへ接続'
      ],
      dataTitle: '主要データ比較と定量サマリー',
      dataBullets: [
        '主要区分が全体の 56% を占め最多',
        'フェーズ別の指標推移から傾向を把握',
        '多角的な比較で優先領域を可視化'
      ],
      roles: ['表紙', '章扉', '本文', 'データ'],
      labels: ['01 · 表紙', '02 · 章区切り', '03 · 要点ページ', '04 · データ比較'],
      pointFoot: '重要根拠 · 0{n}',
      barLabels: ['主要項目', '比較 B', '比較 C', '基準値'],
      chalkTag: '★ テーマ解説',
      sketchTag: '✎ 要点ノート',
      sealChar: '印'
    }
  };

  function resolveCopyPack(lang) {
    var raw = String(lang || 'zh').trim();
    if (raw === 'zh-TW' || raw === 'zh_tw' || raw === 'zh-HK') return FALLBACK_COPY['zh-TW'];
    var base = raw.split(/[-_]/)[0].toLowerCase();
    return FALLBACK_COPY[base] || FALLBACK_COPY.zh;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unitLen(ch) {
    return ch.charCodeAt(0) > 255 ? 1 : 0.56;
  }

  function clipUnits(str, maxUnits) {
    var s = String(str || '').replace(/\s+/g, ' ').trim();
    var acc = 0;
    for (var i = 0; i < s.length; i++) {
      acc += unitLen(s.charAt(i));
      if (acc > maxUnits) return s.slice(0, Math.max(1, i - 1)) + '…';
    }
    return s;
  }

  function wrapLines(str, maxUnitsPerLine, maxLines) {
    var s = String(str || '').replace(/\s+/g, ' ').trim();
    if (!s) return [''];
    var lines = [];
    var cur = '';
    var acc = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var w = unitLen(ch);
      if (acc + w > maxUnitsPerLine && cur) {
        lines.push(cur);
        if (lines.length >= maxLines) {
          var rest = s.slice(i);
          if (rest.length > 0) {
            lines[lines.length - 1] = clipUnits(lines[lines.length - 1] + rest, maxUnitsPerLine);
          }
          return lines;
        }
        cur = ch;
        acc = w;
      } else {
        cur += ch;
        acc += w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function extractHeroMetric(bullets, fallbackValue) {
    var list = Array.isArray(bullets) ? bullets : [];
    for (var i = 0; i < list.length; i++) {
      var text = String(list[i] || '');
      var m = text.match(/(\d+(?:\.\d+)?\s*(?:%|倍|页|篇|段|典|年|万|亿|x|X|\+))/);
      if (m) return m[1].replace(/\s+/g, '');
    }
    for (var j = 0; j < list.length; j++) {
      var m2 = String(list[j] || '').match(/\b(\d{1,4})\b/);
      if (m2) return m2[1];
    }
    return fallbackValue || '56%';
  }

  function normalizeSample(raw, fallbackTitle, lang) {
    var pack = resolveCopyPack(lang);
    var d = raw || {};
    var cBullets = (d.content_bullets && d.content_bullets.length)
      ? d.content_bullets
      : pack.contentBullets;
    var dBullets = (d.data_bullets && d.data_bullets.length)
      ? d.data_bullets
      : pack.dataBullets;
    return {
      coverTitle: d.cover_title || fallbackTitle || pack.coverTitle,
      coverSub: d.cover_sub || pack.coverSub,
      chapterTitle: d.chapter_title || pack.chapterTitle,
      chapterSub: d.chapter_sub || pack.chapterSub,
      contentTitle: d.content_title || pack.contentTitle,
      contentBullets: [
        cBullets[0] || pack.contentBullets[0],
        cBullets[1] || pack.contentBullets[1],
        cBullets[2] || pack.contentBullets[2]
      ],
      dataTitle: d.data_title || pack.dataTitle,
      dataBullets: [
        dBullets[0] || pack.dataBullets[0],
        dBullets[1] || pack.dataBullets[1],
        dBullets[2] || pack.dataBullets[2]
      ],
      _pack: pack
    };
  }

  function svgWrap(inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" class="tpl-inline-svg">' + inner + '</svg>';
  }

  function renderTextLines(lines, x, y, size, lineGap, attrs) {
    return lines.map(function (line, idx) {
      return '<text x="' + x + '" y="' + (y + idx * lineGap) + '" font-size="' + size + '" ' + (attrs || '') + '>' + esc(line) + '</text>';
    }).join('');
  }

  var SANS = "'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif";
  var SERIF = "'STZhongsong','Songti SC','SimSun',Georgia,serif";
  var HAND = "'KaiTi','STKaiti','Segoe Print','Microsoft YaHei',sans-serif";
  var MONO = "'Cascadia Mono',Consolas,'Microsoft YaHei',monospace";

  var THEMES = {
    'swiss-minimal': {
      bg: '#FFFFFF', bg2: '#F4F4F5', ink: '#09090B', sub: '#52525B',
      accent: '#DC2626', accent2: '#18181B', card: '#FAFAFA', line: '#E4E4E7',
      fontH: SANS, fontB: SANS, radius: 0, borderW: 1.5, tag: 'GRID · 01',
      mode: 'swiss'
    },
    'soft-rounded': {
      bg: '#F4F6FB', bg2: '#EEF2FF', ink: '#0F172A', sub: '#475569',
      accent: '#4F46E5', accent2: '#0EA5E9', card: '#FFFFFF', line: '#E2E8F0',
      fontH: SANS, fontB: SANS, radius: 22, borderW: 1, tag: 'MODERN',
      mode: 'rounded'
    },
    'glassmorphism': {
      bg: '#0F172A', bg2: '#1E1B4B', ink: '#F8FAFC', sub: '#CBD5E1',
      accent: '#38BDF8', accent2: '#C084FC', card: 'rgba(255,255,255,0.13)', line: 'rgba(255,255,255,0.28)',
      fontH: SANS, fontB: SANS, radius: 20, borderW: 1.5, tag: 'GLASS UI',
      mode: 'glass'
    },
    'dark-tech': {
      bg: '#070B14', bg2: '#0F172A', ink: '#F1F5F9', sub: '#94A3B8',
      accent: '#22D3EE', accent2: '#34D399', card: '#0D1526', line: '#1E293B',
      fontH: SANS, fontB: SANS, radius: 4, borderW: 1.5, tag: 'SYS // 01',
      mode: 'tech'
    },
    'blueprint': {
      bg: '#0B2545', bg2: '#13315C', ink: '#F8FAFC', sub: '#BAE6FD',
      accent: '#67E8F9', accent2: '#FDE047', card: 'rgba(19,49,92,0.78)', line: 'rgba(186,230,253,0.35)',
      fontH: MONO, fontB: SANS, radius: 0, borderW: 1.5, tag: 'DWG-16:9',
      mode: 'blueprint'
    },
    'editorial': {
      bg: '#FBFAF7', bg2: '#F3EFE6', ink: '#111827', sub: '#57534E',
      accent: '#B45309', accent2: '#1F2937', card: '#F5F2EA', line: '#D6D3CD',
      fontH: SERIF, fontB: SANS, radius: 0, borderW: 1, tag: 'FEATURE',
      mode: 'editorial'
    },
    'photo-editorial': {
      bg: '#1C2526', bg2: '#0F172A', ink: '#FFFFFF', sub: '#E2E8F0',
      accent: '#F59E0B', accent2: '#10B981', card: 'rgba(15,23,42,0.72)', line: 'rgba(255,255,255,0.26)',
      fontH: SERIF, fontB: SANS, radius: 4, borderW: 1, tag: 'VISUAL STORY',
      mode: 'photo'
    },
    'data-journalism': {
      bg: '#FFF9F2', bg2: '#F5EBE0', ink: '#1C1917', sub: '#57534E',
      accent: '#E11D48', accent2: '#0284C7', card: '#FFFFFF', line: '#D6D3D1',
      fontH: SERIF, fontB: SANS, radius: 2, borderW: 1, tag: 'BRIEFING',
      mode: 'datajournal'
    },
    'brutalist': {
      bg: '#F4F3EE', bg2: '#FACC15', ink: '#111111', sub: '#27272A',
      accent: '#FACC15', accent2: '#FB7185', card: '#FFFFFF', line: '#111111',
      fontH: SANS, fontB: SANS, radius: 0, borderW: 3.5, tag: 'RAW // 01',
      mode: 'brutalist'
    },
    'memphis': {
      bg: '#FFFDF7', bg2: '#FEF3C7', ink: '#1E293B', sub: '#475569',
      accent: '#FF6B6B', accent2: '#2EC4B6', card: '#FFFFFF', line: '#1E293B',
      fontH: SANS, fontB: SANS, radius: 12, borderW: 3, tag: 'POP!',
      mode: 'memphis'
    },
    'zine': {
      bg: '#FAF5E8', bg2: '#FCE7F3', ink: '#18181B', sub: '#3F3F46',
      accent: '#F72585', accent2: '#0096C7', card: '#FFFDF9', line: '#18181B',
      fontH: SANS, fontB: SANS, radius: 0, borderW: 2, tag: 'ISSUE #01',
      mode: 'zine'
    },
    'vintage-poster': {
      bg: '#F2E6CF', bg2: '#E6D5B8', ink: '#2B3A55', sub: '#5C5470',
      accent: '#C84B31', accent2: '#2D6A4F', card: '#FAF3E3', line: '#2B3A55',
      fontH: SERIF, fontB: SANS, radius: 6, borderW: 2.5, tag: 'ARCHIVE',
      mode: 'vintage'
    },
    'paper-cut': {
      bg: '#FEF7EC', bg2: '#FDE6C4', ink: '#1F2937', sub: '#4B5563',
      accent: '#D97706', accent2: '#0D9488', card: '#FFFBF5', line: '#F3D5A5',
      fontH: SANS, fontB: SANS, radius: 18, borderW: 0, tag: 'CRAFT',
      mode: 'papercut'
    },
    'sketch-notes': {
      bg: '#FFFDF4', bg2: '#FEF08A', ink: '#1E293B', sub: '#475569',
      accent: '#F59E0B', accent2: '#38BDF8', card: '#FFFFFF', line: '#334155',
      fontH: HAND, fontB: SANS, radius: 8, borderW: 2.2, tag: 'NOTE #1',
      mode: 'sketch'
    },
    'ink-notes': {
      bg: '#FCFCFA', bg2: '#F1F5F9', ink: '#0F172A', sub: '#475569',
      accent: '#DC2626', accent2: '#0F172A', card: '#FFFFFF', line: '#0F172A',
      fontH: HAND, fontB: SANS, radius: 2, borderW: 2, tag: 'INK',
      mode: 'inknotes'
    },
    'chalkboard': {
      bg: '#213E38', bg2: '#19312C', ink: '#F4F7EF', sub: '#CBE3D8',
      accent: '#FDE68A', accent2: '#93C5FD', card: 'rgba(255,255,255,0.05)', line: '#E2ECE7',
      fontH: HAND, fontB: SANS, radius: 6, borderW: 2.5, tag: '课堂板书',
      mode: 'chalk'
    },
    'ink-wash': {
      bg: '#F9F5E8', bg2: '#EDE5D0', ink: '#1F2937', sub: '#57534E',
      accent: '#B91C1C', accent2: '#374151', card: 'rgba(255,253,247,0.78)', line: '#D6CEBF',
      fontH: SERIF, fontB: SERIF, radius: 4, borderW: 1, tag: '卷壹',
      mode: 'inkwash'
    },
    'pixel-art': {
      bg: '#1A1C2C', bg2: '#262B44', ink: '#F4F4F4', sub: '#94B0C2',
      accent: '#FFCD75', accent2: '#38B764', card: '#262B44', line: '#566C86',
      fontH: MONO, fontB: SANS, radius: 0, borderW: 4, tag: 'STAGE 01',
      mode: 'pixel'
    }
  };

  function buildBackdrop(t, pfx, role) {
    var m = t.mode;
    var defs = '';
    var bg = '<rect width="1280" height="720" fill="' + t.bg + '"/>';

    if (m === 'swiss') {
      bg += '<g stroke="#E4E4E7" stroke-width="1">' +
        '<line x1="88" y1="0" x2="88" y2="720"/><line x1="456" y1="0" x2="456" y2="720"/>' +
        '<line x1="824" y1="0" x2="824" y2="720"/><line x1="1192" y1="0" x2="1192" y2="720"/>' +
        '<line x1="0" y1="96" x2="1280" y2="96"/><line x1="0" y1="648" x2="1280" y2="648"/></g>' +
        '<rect x="88" y="0" width="16" height="96" fill="' + t.accent + '"/>';
    } else if (m === 'rounded') {
      defs = '<defs><linearGradient id="' + pfx + 'rg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#F8FAFC"/><stop offset="100%" stop-color="#EEF2FF"/></linearGradient>' +
        '<filter id="' + pfx + 'sh" x="-8%" y="-8%" width="116%" height="120%">' +
        '<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1E293B" flood-opacity="0.08"/></filter></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'rg)"/>' +
        '<circle cx="1140" cy="110" r="210" fill="#E0E7FF" opacity="0.72"/>' +
        '<circle cx="140" cy="650" r="170" fill="#E0F2FE" opacity="0.65"/>';
    } else if (m === 'glass') {
      defs = '<defs><linearGradient id="' + pfx + 'gg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#090D1E"/><stop offset="52%" stop-color="#1E1B4B"/><stop offset="100%" stop-color="#3B0764"/></linearGradient>' +
        '<radialGradient id="' + pfx + 'orb1"><stop offset="0%" stop-color="#38BDF8" stop-opacity="0.58"/><stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="' + pfx + 'orb2"><stop offset="0%" stop-color="#EC4899" stop-opacity="0.48"/><stop offset="100%" stop-color="#EC4899" stop-opacity="0"/></radialGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'gg)"/>' +
        '<circle cx="260" cy="180" r="290" fill="url(#' + pfx + 'orb1)"/>' +
        '<circle cx="1040" cy="540" r="320" fill="url(#' + pfx + 'orb2)"/>';
    } else if (m === 'tech') {
      defs = '<defs><pattern id="' + pfx + 'dots" width="32" height="32" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="1.4" fill="#1E293B"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'dots)"/>' +
        '<path d="M40 72 V40 H80 M1200 40 H1240 V72 M40 648 V680 H80 M1200 680 H1240 V648" fill="none" stroke="#22D3EE" stroke-width="2.5" opacity="0.75"/>' +
        '<rect x="88" y="42" width="140" height="4" fill="#22D3EE"/>';
    } else if (m === 'blueprint') {
      defs = '<defs><pattern id="' + pfx + 'bp" width="40" height="40" patternUnits="userSpaceOnUse">' +
        '<path d="M40 0H0V40" fill="none" stroke="#38BDF8" stroke-width="0.7" opacity="0.22"/></pattern>' +
        '<pattern id="' + pfx + 'bpM" width="200" height="200" patternUnits="userSpaceOnUse">' +
        '<rect width="200" height="200" fill="url(#' + pfx + 'bp)"/>' +
        '<path d="M200 0H0V200" fill="none" stroke="#7DD3FC" stroke-width="1.2" opacity="0.34"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'bpM)"/>' +
        '<rect x="36" y="36" width="1208" height="648" fill="none" stroke="#BAE6FD" stroke-width="2" opacity="0.78"/>' +
        '<rect x="980" y="624" width="264" height="60" fill="#0B2545" stroke="#BAE6FD" stroke-width="1.5" opacity="0.9"/>' +
        '<text x="998" y="660" font-family="' + MONO + '" font-size="16" fill="#67E8F9">SCALE 1:1 · SHEET ' + esc(role) + '</text>';
    } else if (m === 'editorial') {
      bg += '<line x1="84" y1="84" x2="1196" y2="84" stroke="#111827" stroke-width="3.5"/>' +
        '<line x1="84" y1="93" x2="1196" y2="93" stroke="#111827" stroke-width="1"/>' +
        '<line x1="84" y1="656" x2="1196" y2="656" stroke="#D6D3CD" stroke-width="1.5"/>';
    } else if (m === 'photo') {
      defs = '<defs><linearGradient id="' + pfx + 'sky" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#1B2A4A"/><stop offset="46%" stop-color="#6B4C69"/><stop offset="78%" stop-color="#E08A5A"/><stop offset="100%" stop-color="#3B252E"/></linearGradient>' +
        '<radialGradient id="' + pfx + 'sun" cx="76%" cy="54%" r="36%">' +
        '<stop offset="0%" stop-color="#FFE7B8" stop-opacity="0.95"/><stop offset="40%" stop-color="#FBC26B" stop-opacity="0.55"/><stop offset="100%" stop-color="#FBC26B" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="' + pfx + 'scrim" x1="0" y1="0" x2="0.85" y2="0.25">' +
        '<stop offset="0%" stop-color="#090D16" stop-opacity="0.86"/><stop offset="58%" stop-color="#090D16" stop-opacity="0.45"/><stop offset="100%" stop-color="#090D16" stop-opacity="0.12"/></linearGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'sky)"/>' +
        '<rect width="1280" height="720" fill="url(#' + pfx + 'sun)"/>' +
        '<circle cx="964" cy="368" r="68" fill="#FFF3D1" opacity="0.88"/>' +
        '<path d="M0 470 Q320 390 660 460 T1280 415 L1280 720 L0 720 Z" fill="#46385A" opacity="0.72"/>' +
        '<path d="M0 545 Q420 480 840 540 T1280 495 L1280 720 L0 720 Z" fill="#2A2238" opacity="0.88"/>' +
        '<path d="M0 612 Q480 568 920 618 T1280 582 L1280 720 L0 720 Z" fill="#14141F"/>' +
        '<rect width="1280" height="720" fill="url(#' + pfx + 'scrim)"/>' +
        '<rect x="24" y="24" width="1232" height="672" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="1.5"/>';
    } else if (m === 'datajournal') {
      bg += '<rect x="0" y="0" width="1280" height="14" fill="#E11D48"/>' +
        '<line x1="80" y1="92" x2="1200" y2="92" stroke="#1C1917" stroke-width="2.2"/>' +
        '<line x1="80" y1="664" x2="1200" y2="664" stroke="#D6D3D1" stroke-width="1.5"/>';
    } else if (m === 'brutalist') {
      bg += '<rect x="28" y="28" width="1224" height="664" fill="none" stroke="#111111" stroke-width="5"/>' +
        '<rect x="920" y="28" width="332" height="76" fill="#FACC15" stroke="#111111" stroke-width="5"/>' +
        '<text x="1086" y="76" text-anchor="middle" font-family="' + SANS + '" font-weight="900" font-size="26" fill="#111111">RAW STRUCTURE</text>';
    } else if (m === 'memphis') {
      bg += '<circle cx="1148" cy="128" r="74" fill="#FFBF69" stroke="#1E293B" stroke-width="4"/>' +
        '<polygon points="1046,626 1126,506 1206,642" fill="#FF6B6B" stroke="#1E293B" stroke-width="4"/>' +
        '<path d="M72 640 Q96 615 120 640 T168 640 T216 640" fill="none" stroke="#2EC4B6" stroke-width="7" stroke-linecap="round"/>' +
        '<rect x="968" y="68" width="48" height="48" transform="rotate(18 992 92)" fill="#2EC4B6" stroke="#1E293B" stroke-width="3.5"/>';
    } else if (m === 'zine') {
      defs = '<defs><pattern id="' + pfx + 'ht" width="14" height="14" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="2.4" fill="#F72585" opacity="0.26"/></pattern></defs>';
      bg += '<rect x="850" y="0" width="430" height="720" fill="url(#' + pfx + 'ht)"/>' +
        '<rect x="74" y="54" width="218" height="46" transform="rotate(-2 183 77)" fill="#0096C7" opacity="0.88"/>' +
        '<rect x="82" y="62" width="218" height="46" transform="rotate(-2 191 85)" fill="none" stroke="#18181B" stroke-width="3"/>';
    } else if (m === 'vintage') {
      bg += '<rect x="34" y="34" width="1212" height="652" rx="8" fill="none" stroke="#2B3A55" stroke-width="4.5"/>' +
        '<circle cx="1038" cy="240" r="108" fill="#C84B31" opacity="0.9"/>' +
        '<path d="M760 686 L965 440 L1140 590 L1246 475 L1246 686 Z" fill="#2D6A4F" opacity="0.92"/>' +
        '<path d="M890 686 L1095 495 L1246 620 L1246 686 Z" fill="#2B3A55" opacity="0.86"/>';
    } else if (m === 'papercut') {
      defs = '<defs><filter id="' + pfx + 'pc" x="-8%" y="-8%" width="118%" height="122%">' +
        '<feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#78350F" flood-opacity="0.18"/></filter></defs>';
      bg += '<circle cx="1050" cy="180" r="78" fill="#FBBF24" filter="url(#' + pfx + 'pc)"/>' +
        '<path d="M0 530 Q320 445 680 530 T1280 465 L1280 720 L0 720 Z" fill="#38BDF8" opacity="0.85" filter="url(#' + pfx + 'pc)"/>' +
        '<path d="M0 600 Q380 530 790 595 T1280 550 L1280 720 L0 720 Z" fill="#0284C7" filter="url(#' + pfx + 'pc)"/>';
    } else if (m === 'sketch') {
      defs = '<defs><pattern id="' + pfx + 'nb" width="28" height="28" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="1.5" fill="#CBD5E1"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'nb)"/>' +
        '<path d="M62 56 C420 48, 860 62, 1218 52 C1224 260, 1214 490, 1220 666 C840 672, 410 660, 58 668 C54 470, 66 240, 62 56 Z" fill="none" stroke="#334155" stroke-width="2.8" stroke-dasharray="10 4"/>';
    } else if (m === 'inknotes') {
      bg += '<path d="M84 96 C410 92, 820 99, 1196 94" fill="none" stroke="#0F172A" stroke-width="2.5"/>' +
        '<circle cx="1148" cy="94" r="13" fill="none" stroke="#DC2626" stroke-width="3.5"/>';
    } else if (m === 'chalk') {
      defs = '<defs><filter id="' + pfx + 'ck"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.08" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/></filter></defs>';
      bg = '<rect width="1280" height="720" fill="#213E38"/>' +
        '<rect x="22" y="22" width="1236" height="676" rx="8" fill="none" stroke="#8C6239" stroke-width="14"/>' +
        '<g fill="#F4F7EF" opacity="0.16"><circle cx="190" cy="620" r="3"/><circle cx="240" cy="636" r="2"/><circle cx="1040" cy="140" r="2.5"/><circle cx="880" cy="610" r="2"/></g>';
    } else if (m === 'inkwash') {
      defs = '<defs><radialGradient id="' + pfx + 'iw" cx="50%" cy="40%" r="72%">' +
        '<stop offset="0%" stop-color="#FCF9F0"/><stop offset="100%" stop-color="#EAE0C8"/></radialGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'iw)"/>' +
        '<path d="M660 560 C775 375, 905 345, 1020 412 C985 456, 1065 486, 1185 445 L1280 510 L1280 720 L600 720 Z" fill="#1F2937" opacity="0.13"/>' +
        '<path d="M775 612 C895 462, 1025 445, 1145 498 L1280 560 L1280 720 L725 720 Z" fill="#1F2937" opacity="0.24"/>' +
        '<path d="M715 638 C880 580, 1045 610, 1215 554" fill="none" stroke="#1F2937" stroke-width="10" stroke-linecap="round" opacity="0.58"/>';
    } else if (m === 'pixel') {
      bg += '<rect x="40" y="40" width="1200" height="640" fill="none" stroke="#566C86" stroke-width="8" stroke-dasharray="16 8"/>' +
        '<rect x="48" y="48" width="1184" height="54" fill="#333C57"/>' +
        '<rect x="66" y="63" width="24" height="24" fill="#EF7D57"/>' +
        '<rect x="100" y="63" width="24" height="24" fill="#FFCD75"/>' +
        '<rect x="134" y="63" width="24" height="24" fill="#38B764"/>';
    }

    return defs + bg;
  }

  function buildCoverMotif(t, pfx) {
    var m = t.mode;
    if (m === 'swiss') {
      return '<rect x="920" y="420" width="150" height="150" fill="' + t.accent + '"/>' +
        '<text x="1188" y="570" text-anchor="end" font-family="' + SANS + '" font-size="146" font-weight="900" fill="#18181B">01</text>';
    }
    if (m === 'rounded') {
      return '<rect x="860" y="168" width="320" height="390" rx="28" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" filter="url(#' + pfx + 'sh)"/>' +
        '<rect x="892" y="210" width="160" height="22" rx="11" fill="#E0E7FF"/>' +
        '<rect x="892" y="256" width="256" height="118" rx="18" fill="#EEF2FF"/>' +
        '<path d="M918 342 L974 298 L1032 322 L1112 276" fill="none" stroke="#4F46E5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="892" y="402" width="116" height="114" rx="18" fill="#4F46E5"/>' +
        '<rect x="1028" y="402" width="120" height="114" rx="18" fill="#E0F2FE"/>';
    }
    if (m === 'glass') {
      return '<rect x="872" y="182" width="300" height="352" rx="24" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.34)" stroke-width="1.5"/>' +
        '<circle cx="1022" cy="306" r="68" fill="none" stroke="#38BDF8" stroke-width="12" stroke-dasharray="310 120"/>' +
        '<rect x="916" y="418" width="212" height="16" rx="8" fill="rgba(255,255,255,0.45)"/>' +
        '<rect x="916" y="452" width="144" height="14" rx="7" fill="rgba(255,255,255,0.25)"/>';
    }
    if (m === 'tech') {
      return '<rect x="850" y="172" width="340" height="378" rx="6" fill="#0D1526" stroke="#1E293B" stroke-width="2"/>' +
        '<polyline points="884,468 948,404 1012,428 1076,332 1152,276" fill="none" stroke="#22D3EE" stroke-width="6" stroke-linejoin="round"/>' +
        '<circle cx="1152" cy="276" r="10" fill="#34D399"/>' +
        '<rect x="884" y="210" width="96" height="14" fill="#22D3EE" opacity="0.8"/>' +
        '<rect x="884" y="502" width="268" height="10" fill="#1E293B"/>' +
        '<rect x="884" y="502" width="192" height="10" fill="#34D399"/>';
    }
    if (m === 'blueprint') {
      return '<g stroke="#67E8F9" stroke-width="2.5" fill="none" opacity="0.85">' +
        '<polygon points="1030,178 1156,246 1156,386 1030,454 904,386 904,246"/>' +
        '<polyline points="904,246 1030,314 1156,246"/>' +
        '<line x1="1030" y1="314" x2="1030" y2="454"/>' +
        '<line x1="870" y1="246" x2="870" y2="386" stroke="#FDE047" stroke-dasharray="6 6"/>' +
        '</g>';
    }
    if (m === 'editorial') {
      return '<line x1="870" y1="146" x2="870" y2="612" stroke="#D6D3CD" stroke-width="1.5"/>' +
        '<text x="904" y="264" font-family="' + SERIF + '" font-size="112" font-weight="700" fill="#B45309">“</text>' +
        '<rect x="904" y="294" width="260" height="10" fill="#111827" opacity="0.75"/>' +
        '<rect x="904" y="324" width="224" height="8" fill="#57534E" opacity="0.45"/>' +
        '<rect x="904" y="350" width="248" height="8" fill="#57534E" opacity="0.45"/>' +
        '<rect x="904" y="376" width="180" height="8" fill="#57534E" opacity="0.45"/>' +
        '<rect x="904" y="446" width="260" height="140" fill="#F3EFE6" stroke="#D6D3CD" stroke-width="1.2"/>';
    }
    if (m === 'datajournal') {
      return '<rect x="854" y="162" width="346" height="444" fill="#FFFFFF" stroke="#D6D3D1" stroke-width="1.5"/>' +
        '<rect x="886" y="200" width="120" height="12" fill="#E11D48"/>' +
        '<rect x="886" y="454" width="46" height="114" fill="#CBD5E1"/>' +
        '<rect x="952" y="388" width="46" height="180" fill="#0284C7"/>' +
        '<rect x="1018" y="318" width="46" height="250" fill="#0284C7"/>' +
        '<rect x="1084" y="256" width="46" height="312" fill="#E11D48"/>' +
        '<line x1="876" y1="568" x2="1172" y2="568" stroke="#1C1917" stroke-width="2.5"/>';
    }
    if (m === 'brutalist') {
      return '<rect x="956" y="464" width="242" height="176" fill="#FB7185" stroke="#111111" stroke-width="5"/>' +
        '<rect x="920" y="140" width="278" height="288" fill="#FACC15" stroke="#111111" stroke-width="5"/>' +
        '<line x1="920" y1="236" x2="1198" y2="236" stroke="#111111" stroke-width="4"/>' +
        '<line x1="920" y1="332" x2="1198" y2="332" stroke="#111111" stroke-width="4"/>';
    }
    if (m === 'zine') {
      return '<circle cx="1050" cy="264" r="98" fill="#FBCFE8" stroke="#18181B" stroke-width="3.5"/>' +
        '<rect x="938" y="414" width="224" height="148" transform="rotate(2 1050 488)" fill="#FFFFFF" stroke="#18181B" stroke-width="3"/>' +
        '<rect x="960" y="440" width="150" height="22" fill="#F72585"/>';
    }
    if (m === 'sketch') {
      return '<rect x="866" y="182" width="308" height="206" rx="14" fill="#FFFFFF" stroke="#334155" stroke-width="3" stroke-dasharray="14 6"/>' +
        '<rect x="896" y="218" width="146" height="24" fill="#FEF08A"/>' +
        '<path d="M902 332 Q980 250 1054 306 T1146 246" fill="none" stroke="#F59E0B" stroke-width="6" stroke-linecap="round"/>' +
        '<rect x="910" y="430" width="236" height="136" rx="14" fill="#BAE6FD" opacity="0.65" stroke="#334155" stroke-width="2.5"/>';
    }
    if (m === 'inknotes') {
      return '<path d="M920 180 C1080 240, 1080 390, 950 510" fill="none" stroke="#0F172A" stroke-width="4.5" stroke-linecap="round"/>' +
        '<ellipse cx="1038" cy="348" rx="92" ry="52" fill="none" stroke="#DC2626" stroke-width="4" transform="rotate(-12 1038 348)"/>';
    }
    if (m === 'pixel') {
      return '<rect x="886" y="446" width="56" height="140" fill="#41A6F6" stroke="#1A1C2C" stroke-width="4"/>' +
        '<rect x="954" y="366" width="56" height="220" fill="#38B764" stroke="#1A1C2C" stroke-width="4"/>' +
        '<rect x="1022" y="286" width="56" height="300" fill="#FFCD75" stroke="#1A1C2C" stroke-width="4"/>' +
        '<rect x="1090" y="216" width="56" height="370" fill="#EF7D57" stroke="#1A1C2C" stroke-width="4"/>';
    }
    return '';
  }

  function renderCover(t, s, pfx, isCompact) {
    var pack = s._pack || FALLBACK_COPY.zh;
    var titleMaxUnits = isCompact ? 10 : 12;
    var titleSize = isCompact ? 76 : 68;
    var titleGap = isCompact ? 94 : 86;
    var subMaxUnits = isCompact ? 18 : 22;
    var subSize = isCompact ? 32 : 28;
    var titleLines = wrapLines(s.coverTitle, titleMaxUnits, 2);
    var subLines = wrapLines(s.coverSub, subMaxUnits, 2);
    var m = t.mode;
    var body = buildBackdrop(t, pfx, '01');

    if (m === 'inkwash') {
      body += '<rect x="108" y="136" width="60" height="60" rx="4" fill="#B91C1C"/>' +
        '<text x="138" y="177" text-anchor="middle" font-family="' + SERIF + '" font-size="32" font-weight="700" fill="#FEF2F2">' + esc(pack.sealChar) + '</text>' +
        renderTextLines(titleLines, 108, 294, titleSize, titleGap, 'font-family="' + SERIF + '" font-weight="700" fill="' + t.ink + '"') +
        '<line x1="108" y1="454" x2="380" y2="454" stroke="#B91C1C" stroke-width="3.5"/>' +
        renderTextLines(subLines, 108, 514, subSize, 44, 'font-family="' + SERIF + '" fill="' + t.sub + '"');
      return svgWrap(body);
    }

    if (m === 'chalk') {
      body += '<g filter="url(#' + pfx + 'ck)">' +
        '<text x="100" y="156" font-family="' + HAND + '" font-size="30" fill="#FDE68A">' + esc(pack.chalkTag) + '</text>' +
        '<path d="M96 176 Q250 168 380 178" fill="none" stroke="#FDE68A" stroke-width="3.5"/>' +
        '<rect x="910" y="196" width="266" height="164" rx="10" fill="none" stroke="#93C5FD" stroke-width="3.5" stroke-dasharray="10 6"/>' +
        '<path d="M948 318 L1006 264 L1068 292 L1138 232" fill="none" stroke="#FDE68A" stroke-width="5" stroke-linecap="round"/></g>' +
        renderTextLines(titleLines, 100, 294, titleSize, titleGap, 'font-family="' + HAND + '" font-weight="700" fill="#F4F7EF"') +
        '<path d="M100 448 Q460 436 820 450" fill="none" stroke="#93C5FD" stroke-width="4.5" filter="url(#' + pfx + 'ck)"/>' +
        renderTextLines(subLines, 100, 514, subSize, 44, 'font-family="' + SANS + '" fill="#CBE3D8"');
      return svgWrap(body);
    }

    if (m === 'photo') {
      body += '<rect x="84" y="408" width="10" height="196" fill="#F59E0B"/>' +
        '<text x="116" y="438" font-family="' + SANS + '" font-size="24" font-weight="700" letter-spacing="4" fill="#FCD34D">' + esc(t.tag) + '</text>' +
        renderTextLines(titleLines, 116, titleLines.length > 1 ? 512 : 540, isCompact ? 72 : 66, 82, 'font-family="' + SERIF + '" font-weight="700" fill="#FFFFFF"') +
        renderTextLines(subLines.slice(0, 1), 116, 636, isCompact ? 30 : 26, 38, 'font-family="' + SANS + '" fill="#E2E8F0"');
      return svgWrap(body);
    }

    var topY = m === 'pixel' ? 166 : 154;
    var badge = '';
    if (m === 'sketch') {
      badge = '<rect x="88" y="' + (topY - 32) + '" width="236" height="40" fill="#FEF08A" transform="rotate(-1.5 206 ' + (topY - 12) + ')"/>' +
        '<text x="102" y="' + topY + '" font-family="' + HAND + '" font-size="25" font-weight="700" fill="#1E293B">' + esc(pack.sketchTag) + '</text>';
    } else if (m === 'glass' || m === 'rounded') {
      badge = '<rect x="92" y="' + (topY - 34) + '" width="214" height="44" rx="22" fill="' + t.card + '" stroke="' + t.line + '" stroke-width="1.5"/>' +
        '<text x="199" y="' + (topY - 4) + '" text-anchor="middle" font-family="' + t.fontB + '" font-size="21" font-weight="700" fill="' + t.accent + '">' + esc(t.tag) + '</text>';
    } else {
      badge = '<text x="92" y="' + topY + '" font-family="' + t.fontH + '" font-size="24" font-weight="700" letter-spacing="3" fill="' + t.accent + '">' + esc(t.tag) + '</text>';
    }

    var panel = '';
    if (m === 'glass') {
      panel = '<rect x="64" y="96" width="1152" height="528" rx="26" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>';
    } else if (m === 'brutalist') {
      panel = '<rect x="82" y="196" width="800" height="260" fill="#111111"/>' +
        '<rect x="72" y="186" width="800" height="260" fill="#FFFFFF" stroke="#111111" stroke-width="4.5"/>';
    }

    var motif = buildCoverMotif(t, pfx);
    var titleColor = m === 'brutalist' ? '#111111' : t.ink;
    var titleY = titleLines.length > 1 ? 280 : 326;
    body += panel + motif + badge +
      renderTextLines(titleLines, 92, titleY, titleSize, titleGap, 'font-family="' + t.fontH + '" font-weight="700" fill="' + titleColor + '"') +
      '<rect x="92" y="468" width="144" height="7" fill="' + t.accent + '"/>' +
      renderTextLines(subLines, 92, 528, subSize, 44, 'font-family="' + t.fontB + '" fill="' + t.sub + '"');
    return svgWrap(body);
  }

  function renderChapter(t, s, pfx) {
    var chLines = wrapLines(s.chapterTitle, 14, 2);
    var subLines = wrapLines(s.chapterSub, 24, 2);
    var m = t.mode;
    var body = buildBackdrop(t, pfx, '02');

    var bigNumOpacity = (m === 'glass' || m === 'tech' || m === 'blueprint' || m === 'chalk') ? '0.28' : '0.18';

    body += '<text x="92" y="276" font-family="' + t.fontH + '" font-size="168" font-weight="800" fill="' + t.accent + '" opacity="' + bigNumOpacity + '">01</text>';
    if (m === 'chalk') {
      body += '<circle cx="176" cy="218" r="88" fill="none" stroke="#FDE68A" stroke-width="4" filter="url(#' + pfx + 'ck)"/>';
    } else if (m === 'inkwash') {
      body += '<circle cx="182" cy="218" r="84" fill="none" stroke="#B91C1C" stroke-width="3" stroke-dasharray="220 45"/>';
    } else if (m === 'brutalist') {
      body += '<rect x="92" y="132" width="160" height="58" fill="#FB7185" stroke="#111111" stroke-width="3.5"/>' +
        '<text x="172" y="170" text-anchor="middle" font-family="' + SANS + '" font-size="26" font-weight="800" fill="#111111">PART 01</text>';
    }

    body += renderTextLines(chLines, 96, 372, 56, 72, 'font-family="' + t.fontH + '" font-weight="700" fill="' + t.ink + '"') +
      '<line x1="96" y1="504" x2="520" y2="504" stroke="' + t.accent + '" stroke-width="4"/>' +
      renderTextLines(subLines, 96, 558, 26, 38, 'font-family="' + t.fontB + '" fill="' + t.sub + '"');
    return svgWrap(body);
  }

  function cardRect(t, pfx, x, y, w, h, idx) {
    var m = t.mode;
    if (m === 'brutalist') {
      var bFill = idx === 0 ? '#FACC15' : '#FFFFFF';
      return '<rect x="' + (x + 7) + '" y="' + (y + 7) + '" width="' + w + '" height="' + h + '" fill="#111111"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + bFill + '" stroke="#111111" stroke-width="3.5"/>';
    }
    if (m === 'memphis') {
      return '<rect x="' + (x + 5) + '" y="' + (y + 5) + '" width="' + w + '" height="' + h + '" rx="12" fill="' + (idx % 2 === 0 ? '#2EC4B6' : '#FFBF69') + '"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="#FFFFFF" stroke="#1E293B" stroke-width="3"/>';
    }
    if (m === 'zine') {
      return '<rect x="' + (x + 6) + '" y="' + (y + 5) + '" width="' + w + '" height="' + h + '" fill="' + (idx % 2 === 0 ? '#F72585' : '#0096C7') + '" opacity="0.26"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#FFFDF9" stroke="#18181B" stroke-width="2.2"/>';
    }
    if (m === 'sketch') {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="#FFFFFF" stroke="#334155" stroke-width="2.4" stroke-dasharray="14 4"/>' +
        '<rect x="' + (x + 18) + '" y="' + (y + 18) + '" width="120" height="16" fill="' + (idx === 0 ? '#FEF08A' : (idx === 1 ? '#BAE6FD' : '#FBCFE8')) + '"/>';
    }
    if (m === 'chalk') {
      var cStroke = idx === 0 ? '#FDE68A' : (idx === 1 ? '#93C5FD' : '#F9A8D4');
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8" fill="rgba(255,255,255,0.04)" stroke="' + cStroke + '" stroke-width="3" filter="url(#' + pfx + 'ck)"/>';
    }
    if (m === 'inkwash') {
      return '<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + y + '" stroke="#9CA3AF" stroke-width="1.2"/>' +
        '<rect x="' + x + '" y="' + (y + 12) + '" width="6" height="36" fill="#B91C1C"/>';
    }
    if (m === 'pixel') {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#262B44" stroke="#FFCD75" stroke-width="4"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="10" fill="' + (idx === 0 ? '#EF7D57' : (idx === 1 ? '#41A6F6' : '#38B764')) + '"/>';
    }
    var extra = '';
    if (m === 'rounded' || m === 'papercut') {
      extra = ' filter="url(#' + pfx + (m === 'rounded' ? 'sh' : 'pc') + ')"';
    }
    var strokeAttr = t.borderW > 0 ? (' stroke="' + t.line + '" stroke-width="' + t.borderW + '"') : '';
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + t.radius + '" fill="' + t.card + '"' + strokeAttr + extra + '/>';
  }

  function renderContent(t, s, pfx) {
    var pack = s._pack || FALLBACK_COPY.zh;
    var headLine = clipUnits(s.contentTitle, 20);
    var body = buildBackdrop(t, pfx, '03');
    var headerY = t.mode === 'pixel' ? 156 : 142;

    body += '<rect x="84" y="' + (headerY - 38) + '" width="10" height="44" fill="' + t.accent + '"/>' +
      '<text x="110" y="' + headerY + '" font-family="' + t.fontH + '" font-size="42" font-weight="700" fill="' + t.ink + '">' + esc(headLine) + '</text>';

    var cardW = 352;
    var gap = 28;
    var startX = 84;
    var cardY = 204;
    var cardH = 424;

    for (var i = 0; i < 3; i++) {
      var cx = startX + i * (cardW + gap);
      var bLines = wrapLines(s.contentBullets[i] || '', 12, 4);
      var numStr = '0' + (i + 1);
      var cardInk = (t.mode === 'brutalist' && i === 0) ? '#111111' : t.ink;
      var cardSub = (t.mode === 'brutalist' && i === 0) ? '#18181B' : t.sub;
      var footLabel = pack.pointFoot.replace('{n}', String(i + 1));
      body += cardRect(t, pfx, cx, cardY, cardW, cardH, i) +
        '<text x="' + (cx + 28) + '" y="' + (cardY + 68) + '" font-family="' + t.fontH + '" font-size="38" font-weight="800" fill="' + (t.mode === 'brutalist' && i === 0 ? '#111111' : t.accent) + '">' + numStr + '</text>' +
        '<line x1="' + (cx + 28) + '" y1="' + (cardY + 92) + '" x2="' + (cx + 108) + '" y2="' + (cardY + 92) + '" stroke="' + t.accent2 + '" stroke-width="3"/>' +
        renderTextLines(bLines, cx + 28, cardY + 154, 26, 42, 'font-family="' + t.fontB + '" font-weight="600" fill="' + cardInk + '"') +
        '<text x="' + (cx + 28) + '" y="' + (cardY + 376) + '" font-family="' + t.fontB + '" font-size="19" fill="' + cardSub + '">' + esc(footLabel) + '</text>';
    }
    return svgWrap(body);
  }

  function renderData(t, s, pfx) {
    var pack = s._pack || FALLBACK_COPY.zh;
    var headLine = clipUnits(s.dataTitle, 20);
    var body = buildBackdrop(t, pfx, '04');
    var headerY = t.mode === 'pixel' ? 156 : 142;
    var heroMetric = extractHeroMetric(s.dataBullets, '56%');
    var metricSize = heroMetric.length > 4 ? 68 : 86;

    body += '<rect x="84" y="' + (headerY - 38) + '" width="10" height="44" fill="' + t.accent + '"/>' +
      '<text x="110" y="' + headerY + '" font-family="' + t.fontH + '" font-size="42" font-weight="700" fill="' + t.ink + '">' + esc(headLine) + '</text>';

    body += cardRect(t, pfx, 84, 204, 520, 428, 0) +
      '<text x="120" y="302" font-family="' + t.fontH + '" font-size="' + metricSize + '" font-weight="800" fill="' + (t.mode === 'brutalist' ? '#111111' : t.accent) + '">' + esc(heroMetric) + '</text>' +
      renderTextLines(wrapLines(s.dataBullets[0] || '', 18, 2), 120, 366, 25, 38, 'font-family="' + t.fontB + '" font-weight="600" fill="' + (t.mode === 'brutalist' ? '#111111' : t.ink) + '"') +
      '<line x1="120" y1="454" x2="564" y2="454" stroke="' + t.line + '" stroke-width="1.5"/>' +
      renderTextLines(wrapLines(s.dataBullets[1] || '', 18, 2), 120, 508, 23, 36, 'font-family="' + t.fontB + '" fill="' + (t.mode === 'brutalist' ? '#27272A' : t.sub) + '"');

    body += cardRect(t, pfx, 636, 204, 560, 428, 1);
    var bars = [
      [pack.barLabels[0], 360, t.accent],
      [pack.barLabels[1], 248, t.accent2],
      [pack.barLabels[2], 172, t.sub],
      [pack.barLabels[3], 118, t.sub]
    ];
    bars.forEach(function (b, idx) {
      var by = 268 + idx * 76;
      body += '<text x="672" y="' + (by + 24) + '" font-family="' + t.fontB + '" font-size="21" fill="' + t.ink + '">' + esc(b[0]) + '</text>' +
        '<rect x="790" y="' + by + '" width="' + b[1] + '" height="32" rx="' + Math.min(8, t.radius) + '" fill="' + b[2] + '" opacity="0.9"/>';
    });
    body += '<text x="672" y="592" font-family="' + t.fontB + '" font-size="20" fill="' + t.sub + '">' + esc(clipUnits(s.dataBullets[2] || '', 24)) + '</text>';

    return svgWrap(body);
  }

  function buildSlides(styleId, rawSample, fallbackTitle, lang) {
    var t = THEMES[styleId] || THEMES['soft-rounded'];
    var s = normalizeSample(rawSample, fallbackTitle, lang);
    var pack = s._pack || FALLBACK_COPY.zh;
    uidSeq += 1;
    var pfx = 'vs' + uidSeq + '_';
    return [
      { role: pack.roles[0], label: pack.labels[0], svg: renderCover(t, s, pfx + '1_', false) },
      { role: pack.roles[1], label: pack.labels[1], svg: renderChapter(t, s, pfx + '2_') },
      { role: pack.roles[2], label: pack.labels[2], svg: renderContent(t, s, pfx + '3_') },
      { role: pack.roles[3], label: pack.labels[3], svg: renderData(t, s, pfx + '4_') }
    ];
  }

  function renderThumbnail(styleId, rawSample, fallbackTitle, lang) {
    var t = THEMES[styleId];
    if (!t) return '';
    var s = normalizeSample(rawSample, fallbackTitle, lang);
    uidSeq += 1;
    var pfx = 'vst' + uidSeq + '_';
    return renderCover(t, s, pfx, true);
  }

  function swatchOf(styleId) {
    return STYLE_SWATCH[styleId] || '#4F46E5';
  }

  function hasStyle(styleId) {
    return Object.prototype.hasOwnProperty.call(THEMES, styleId);
  }

  window.WorkbenchStyleSlides = {
    buildSlides: buildSlides,
    renderThumbnail: renderThumbnail,
    swatchOf: swatchOf,
    hasStyle: hasStyle,
    normalizeSample: normalizeSample
  };
})();
