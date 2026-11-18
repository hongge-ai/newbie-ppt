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

  function normalizeSample(raw, fallbackTitle) {
    var d = raw || {};
    var cBullets = (d.content_bullets && d.content_bullets.length)
      ? d.content_bullets
      : [
          '核心概念界定：厘清关键机制与底层逻辑框架',
          '典型特征拆解：归纳三项最具代表性的实证表现',
          '认知误区辨析：打破常见直觉偏差并建立科学视角'
        ];
    var dBullets = (d.data_bullets && d.data_bullets.length)
      ? d.data_bullets
      : [
          '核心占比达 56%，居关键区域首位',
          '近十年关键指标累计变化幅度显著',
          '多维对照揭示长期投入的边际效益'
        ];
    return {
      coverTitle: d.cover_title || fallbackTitle || '演示主题核心标题',
      coverSub: d.cover_sub || '围绕核心议题展开关键事实、成因拆解与行动方案',
      chapterTitle: d.chapter_title || '核心章节：关键机制与成因剖析',
      chapterSub: d.chapter_sub || '从全局背景切入核心矛盾，看懂变化背后的深层规律',
      contentTitle: d.content_title || '三大核心要点与关键事实拆解',
      contentBullets: [
        cBullets[0] || '要点一：核心定义与关键特征梳理',
        cBullets[1] || '要点二：结构组成与内在关联机制',
        cBullets[2] || '要点三：实践启示与落地发力重点'
      ],
      dataTitle: d.data_title || '关键数据对比与量化证据总览',
      dataBullets: [
        dBullets[0] || '关键指标一：核心样本占比与分布特征',
        dBullets[1] || '关键指标二：跨周期变化幅度对比',
        dBullets[2] || '关键指标三：综合成效与目标达成率'
      ]
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
        '<rect x="88" y="0" width="12" height="96" fill="' + t.accent + '"/>';
    } else if (m === 'rounded') {
      defs = '<defs><linearGradient id="' + pfx + 'rg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#F8FAFC"/><stop offset="100%" stop-color="#EEF2FF"/></linearGradient>' +
        '<filter id="' + pfx + 'sh" x="-8%" y="-8%" width="116%" height="120%">' +
        '<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1E293B" flood-opacity="0.08"/></filter></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'rg)"/>' +
        '<circle cx="1140" cy="110" r="210" fill="#E0E7FF" opacity="0.7"/>' +
        '<circle cx="140" cy="650" r="170" fill="#E0F2FE" opacity="0.65"/>';
    } else if (m === 'glass') {
      defs = '<defs><linearGradient id="' + pfx + 'gg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#090D1E"/><stop offset="52%" stop-color="#1E1B4B"/><stop offset="100%" stop-color="#3B0764"/></linearGradient>' +
        '<radialGradient id="' + pfx + 'orb1"><stop offset="0%" stop-color="#38BDF8" stop-opacity="0.55"/><stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="' + pfx + 'orb2"><stop offset="0%" stop-color="#EC4899" stop-opacity="0.45"/><stop offset="100%" stop-color="#EC4899" stop-opacity="0"/></radialGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'gg)"/>' +
        '<circle cx="260" cy="180" r="290" fill="url(#' + pfx + 'orb1)"/>' +
        '<circle cx="1040" cy="540" r="320" fill="url(#' + pfx + 'orb2)"/>';
    } else if (m === 'tech') {
      defs = '<defs><pattern id="' + pfx + 'dots" width="32" height="32" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="1.3" fill="#1E293B"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'dots)"/>' +
        '<path d="M40 72 V40 H80 M1200 40 H1240 V72 M40 648 V680 H80 M1200 680 H1240 V648" fill="none" stroke="#22D3EE" stroke-width="2" opacity="0.7"/>' +
        '<rect x="88" y="42" width="140" height="4" fill="#22D3EE"/>';
    } else if (m === 'blueprint') {
      defs = '<defs><pattern id="' + pfx + 'bp" width="40" height="40" patternUnits="userSpaceOnUse">' +
        '<path d="M40 0H0V40" fill="none" stroke="#38BDF8" stroke-width="0.7" opacity="0.22"/></pattern>' +
        '<pattern id="' + pfx + 'bpM" width="200" height="200" patternUnits="userSpaceOnUse">' +
        '<rect width="200" height="200" fill="url(#' + pfx + 'bp)"/>' +
        '<path d="M200 0H0V200" fill="none" stroke="#7DD3FC" stroke-width="1.2" opacity="0.32"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'bpM)"/>' +
        '<rect x="36" y="36" width="1208" height="648" fill="none" stroke="#BAE6FD" stroke-width="2" opacity="0.75"/>' +
        '<rect x="980" y="624" width="264" height="60" fill="#0B2545" stroke="#BAE6FD" stroke-width="1.5" opacity="0.9"/>' +
        '<text x="998" y="660" font-family="' + MONO + '" font-size="16" fill="#67E8F9">SCALE 1:1 · SHEET ' + esc(role) + '</text>';
    } else if (m === 'editorial') {
      bg += '<line x1="84" y1="84" x2="1196" y2="84" stroke="#111827" stroke-width="3"/>' +
        '<line x1="84" y1="92" x2="1196" y2="92" stroke="#111827" stroke-width="1"/>' +
        '<line x1="84" y1="656" x2="1196" y2="656" stroke="#D6D3CD" stroke-width="1.2"/>';
    } else if (m === 'photo') {
      defs = '<defs><linearGradient id="' + pfx + 'sky" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#1E3A5F"/><stop offset="48%" stop-color="#5B7C8D"/><stop offset="82%" stop-color="#D99B52"/><stop offset="100%" stop-color="#3B2F2F"/></linearGradient>' +
        '<linearGradient id="' + pfx + 'scrim" x1="0" y1="0" x2="0.85" y2="0">' +
        '<stop offset="0%" stop-color="#090D16" stop-opacity="0.86"/><stop offset="65%" stop-color="#090D16" stop-opacity="0.52"/><stop offset="100%" stop-color="#090D16" stop-opacity="0.22"/></linearGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'sky)"/>' +
        '<circle cx="980" cy="230" r="82" fill="#FDE68A" opacity="0.45"/>' +
        '<path d="M0 510 Q320 400 660 475 T1280 430 L1280 720 L0 720 Z" fill="#2A363B" opacity="0.82"/>' +
        '<path d="M0 575 Q420 495 840 555 T1280 515 L1280 720 L0 720 Z" fill="#141A1F"/>' +
        '<rect width="1280" height="720" fill="url(#' + pfx + 'scrim)"/>';
    } else if (m === 'datajournal') {
      bg += '<rect x="0" y="0" width="1280" height="12" fill="#E11D48"/>' +
        '<line x1="80" y1="92" x2="1200" y2="92" stroke="#1C1917" stroke-width="2"/>' +
        '<line x1="80" y1="664" x2="1200" y2="664" stroke="#D6D3D1" stroke-width="1.5"/>';
    } else if (m === 'brutalist') {
      bg += '<rect x="28" y="28" width="1224" height="664" fill="none" stroke="#111111" stroke-width="4"/>' +
        '<rect x="920" y="28" width="332" height="76" fill="#FACC15" stroke="#111111" stroke-width="4"/>' +
        '<text x="1086" y="76" text-anchor="middle" font-family="' + SANS + '" font-weight="900" font-size="26" fill="#111111">RAW STRUCTURE</text>';
    } else if (m === 'memphis') {
      bg += '<circle cx="1160" cy="120" r="68" fill="#FFBF69" stroke="#1E293B" stroke-width="3.5"/>' +
        '<polygon points="1060,620 1135,510 1205,635" fill="#FF6B6B" stroke="#1E293B" stroke-width="3.5"/>' +
        '<path d="M72 640 Q96 615 120 640 T168 640 T216 640" fill="none" stroke="#2EC4B6" stroke-width="6" stroke-linecap="round"/>' +
        '<rect x="980" y="68" width="44" height="44" transform="rotate(18 1002 90)" fill="#2EC4B6" stroke="#1E293B" stroke-width="3"/>';
    } else if (m === 'zine') {
      defs = '<defs><pattern id="' + pfx + 'ht" width="14" height="14" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="2.2" fill="#F72585" opacity="0.22"/></pattern></defs>';
      bg += '<rect x="860" y="0" width="420" height="720" fill="url(#' + pfx + 'ht)"/>' +
        '<rect x="74" y="54" width="210" height="44" transform="rotate(-2 179 76)" fill="#0096C7" opacity="0.85"/>' +
        '<rect x="80" y="60" width="210" height="44" transform="rotate(-2 185 82)" fill="none" stroke="#18181B" stroke-width="2.5"/>';
    } else if (m === 'vintage') {
      bg += '<rect x="34" y="34" width="1212" height="652" rx="8" fill="none" stroke="#2B3A55" stroke-width="4"/>' +
        '<path d="M980 686 A220 220 0 0 1 1246 466 L1246 686 Z" fill="#C84B31" opacity="0.88"/>' +
        '<circle cx="1110" cy="560" r="88" fill="#E0A96D" opacity="0.85"/>';
    } else if (m === 'papercut') {
      defs = '<defs><filter id="' + pfx + 'pc" x="-8%" y="-8%" width="118%" height="122%">' +
        '<feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#78350F" flood-opacity="0.18"/></filter></defs>';
      bg += '<path d="M0 540 Q320 450 680 535 T1280 470 L1280 720 L0 720 Z" fill="#FCD34D" filter="url(#' + pfx + 'pc)"/>' +
        '<path d="M0 605 Q380 535 790 600 T1280 555 L1280 720 L0 720 Z" fill="#D97706" filter="url(#' + pfx + 'pc)"/>' +
        '<path d="M920 0 Q1040 160 1280 210 L1280 0 Z" fill="#0D9488" opacity="0.85" filter="url(#' + pfx + 'pc)"/>';
    } else if (m === 'sketch') {
      defs = '<defs><pattern id="' + pfx + 'nb" width="28" height="28" patternUnits="userSpaceOnUse">' +
        '<circle cx="4" cy="4" r="1.4" fill="#CBD5E1"/></pattern></defs>';
      bg += '<rect width="1280" height="720" fill="url(#' + pfx + 'nb)"/>' +
        '<path d="M62 56 C420 48, 860 62, 1218 52 C1224 260, 1214 490, 1220 666 C840 672, 410 660, 58 668 C54 470, 66 240, 62 56 Z" fill="none" stroke="#334155" stroke-width="2.5" stroke-dasharray="10 4"/>';
    } else if (m === 'inknotes') {
      bg += '<path d="M84 96 C410 92, 820 99, 1196 94" fill="none" stroke="#0F172A" stroke-width="2.2"/>' +
        '<circle cx="1148" cy="94" r="12" fill="none" stroke="#DC2626" stroke-width="3"/>';
    } else if (m === 'chalk') {
      defs = '<defs><filter id="' + pfx + 'ck"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.08" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/></filter></defs>';
      bg = '<rect width="1280" height="720" fill="#213E38"/>' +
        '<rect x="22" y="22" width="1236" height="676" rx="8" fill="none" stroke="#8C6239" stroke-width="12"/>' +
        '<g fill="#F4F7EF" opacity="0.14"><circle cx="190" cy="620" r="3"/><circle cx="240" cy="636" r="2"/><circle cx="1040" cy="140" r="2.5"/><circle cx="880" cy="610" r="2"/></g>';
    } else if (m === 'inkwash') {
      defs = '<defs><radialGradient id="' + pfx + 'iw" cx="50%" cy="40%" r="72%">' +
        '<stop offset="0%" stop-color="#FCF9F0"/><stop offset="100%" stop-color="#EAE0C8"/></radialGradient></defs>';
      bg = '<rect width="1280" height="720" fill="url(#' + pfx + 'iw)"/>' +
        '<path d="M680 560 C790 390, 910 360, 1020 420 C980 460, 1060 490, 1180 450 L1280 510 L1280 720 L620 720 Z" fill="#1F2937" opacity="0.11"/>' +
        '<path d="M790 610 C900 470, 1020 450, 1140 500 L1280 560 L1280 720 L740 720 Z" fill="#1F2937" opacity="0.20"/>' +
        '<path d="M720 638 C880 584, 1040 612, 1210 558" fill="none" stroke="#1F2937" stroke-width="9" stroke-linecap="round" opacity="0.55"/>';
    } else if (m === 'pixel') {
      bg += '<rect x="40" y="40" width="1200" height="640" fill="none" stroke="#566C86" stroke-width="8" stroke-dasharray="16 8"/>' +
        '<rect x="48" y="48" width="1184" height="52" fill="#333C57"/>' +
        '<rect x="66" y="62" width="24" height="24" fill="#EF7D57"/>' +
        '<rect x="100" y="62" width="24" height="24" fill="#FFCD75"/>' +
        '<rect x="134" y="62" width="24" height="24" fill="#38B764"/>';
    }

    return defs + bg;
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

  function renderCover(t, s, pfx) {
    var titleLines = wrapLines(s.coverTitle, 13, 2);
    var subLines = wrapLines(s.coverSub, 24, 2);
    var m = t.mode;
    var body = buildBackdrop(t, pfx, '01');

    if (m === 'inkwash') {
      body += '<rect x="116" y="156" width="54" height="54" rx="4" fill="#B91C1C"/>' +
        '<text x="143" y="193" text-anchor="middle" font-family="' + SERIF + '" font-size="28" font-weight="700" fill="#FEF2F2">印</text>' +
        renderTextLines(titleLines, 116, 294, 68, 86, 'font-family="' + SERIF + '" font-weight="700" fill="' + t.ink + '"') +
        '<line x1="116" y1="440" x2="360" y2="440" stroke="#B91C1C" stroke-width="2.5"/>' +
        renderTextLines(subLines, 116, 492, 28, 42, 'font-family="' + SERIF + '" fill="' + t.sub + '"');
      return svgWrap(body);
    }

    if (m === 'chalk') {
      body += '<g filter="url(#' + pfx + 'ck)">' +
        '<text x="104" y="168" font-family="' + HAND + '" font-size="28" fill="#FDE68A">★ 主题课程导读</text>' +
        '<path d="M100 186 Q240 178 360 188" fill="none" stroke="#FDE68A" stroke-width="3"/></g>' +
        renderTextLines(titleLines, 104, 292, 66, 84, 'font-family="' + HAND + '" font-weight="700" fill="#F4F7EF"') +
        '<path d="M104 430 Q460 418 820 432" fill="none" stroke="#93C5FD" stroke-width="4" filter="url(#' + pfx + 'ck)"/>' +
        renderTextLines(subLines, 104, 492, 28, 42, 'font-family="' + SANS + '" fill="#CBE3D8"');
      return svgWrap(body);
    }

    var topY = m === 'pixel' ? 168 : 158;
    var badge = '';
    if (m === 'sketch') {
      badge = '<rect x="88" y="' + (topY - 30) + '" width="220" height="38" fill="#FEF08A" transform="rotate(-1.5 198 ' + (topY - 11) + ')"/>' +
        '<text x="102" y="' + topY + '" font-family="' + HAND + '" font-size="24" font-weight="700" fill="#1E293B">✎ 课程主题导览</text>';
    } else if (m === 'glass' || m === 'rounded') {
      badge = '<rect x="92" y="' + (topY - 32) + '" width="210" height="42" rx="21" fill="' + t.card + '" stroke="' + t.line + '" stroke-width="1.2"/>' +
        '<text x="197" y="' + (topY - 4) + '" text-anchor="middle" font-family="' + t.fontB + '" font-size="20" font-weight="600" fill="' + t.accent + '">' + esc(t.tag) + '</text>';
    } else {
      badge = '<text x="92" y="' + topY + '" font-family="' + t.fontH + '" font-size="22" font-weight="700" letter-spacing="3" fill="' + t.accent + '">' + esc(t.tag) + '</text>';
    }

    var panel = '';
    if (m === 'glass') {
      panel = '<rect x="64" y="100" width="1152" height="520" rx="26" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>';
    } else if (m === 'brutalist') {
      panel = '<rect x="82" y="198" width="960" height="250" fill="#111111"/>' +
        '<rect x="72" y="188" width="960" height="250" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>';
    }

    var titleColor = m === 'brutalist' ? '#111111' : t.ink;
    var titleY = titleLines.length > 1 ? 276 : 318;
    body += panel + badge +
      renderTextLines(titleLines, 92, titleY, 68, 86, 'font-family="' + t.fontH + '" font-weight="700" fill="' + titleColor + '"') +
      '<rect x="92" y="456" width="132" height="6" fill="' + t.accent + '"/>' +
      renderTextLines(subLines, 92, 512, 28, 42, 'font-family="' + t.fontB + '" fill="' + t.sub + '"');
    return svgWrap(body);
  }

  function renderChapter(t, s, pfx) {
    var chLines = wrapLines(s.chapterTitle, 14, 2);
    var subLines = wrapLines(s.chapterSub, 24, 2);
    var m = t.mode;
    var body = buildBackdrop(t, pfx, '02');

    var numColor = (m === 'swiss' || m === 'editorial' || m === 'datajournal' || m === 'inkwash' || m === 'inknotes')
      ? t.accent
      : t.accent;
    var bigNumOpacity = (m === 'glass' || m === 'dark-tech' || m === 'blueprint' || m === 'chalk') ? '0.26' : '0.18';

    body += '<text x="92" y="276" font-family="' + t.fontH + '" font-size="168" font-weight="800" fill="' + numColor + '" opacity="' + bigNumOpacity + '">01</text>';
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

  function renderContent(t, s, pfx) {
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
      body += cardRect(t, pfx, cx, cardY, cardW, cardH, i) +
        '<text x="' + (cx + 28) + '" y="' + (cardY + 68) + '" font-family="' + t.fontH + '" font-size="38" font-weight="800" fill="' + (t.mode === 'brutalist' && i === 0 ? '#111111' : t.accent) + '">' + numStr + '</text>' +
        '<line x1="' + (cx + 28) + '" y1="' + (cardY + 92) + '" x2="' + (cx + 108) + '" y2="' + (cardY + 92) + '" stroke="' + t.accent2 + '" stroke-width="3"/>' +
        renderTextLines(bLines, cx + 28, cardY + 154, 26, 42, 'font-family="' + t.fontB + '" font-weight="600" fill="' + cardInk + '"') +
        '<text x="' + (cx + 28) + '" y="' + (cardY + 376) + '" font-family="' + t.fontB + '" font-size="19" fill="' + cardSub + '">核心论据 · 第 ' + (i + 1) + ' 组</text>';
    }
    return svgWrap(body);
  }

  function renderData(t, s, pfx) {
    var headLine = clipUnits(s.dataTitle, 20);
    var body = buildBackdrop(t, pfx, '04');
    var headerY = t.mode === 'pixel' ? 156 : 142;

    body += '<rect x="84" y="' + (headerY - 38) + '" width="10" height="44" fill="' + t.accent + '"/>' +
      '<text x="110" y="' + headerY + '" font-family="' + t.fontH + '" font-size="42" font-weight="700" fill="' + t.ink + '">' + esc(headLine) + '</text>';

    body += cardRect(t, pfx, 84, 204, 520, 428, 0) +
      '<text x="120" y="302" font-family="' + t.fontH + '" font-size="86" font-weight="800" fill="' + (t.mode === 'brutalist' ? '#111111' : t.accent) + '">56%</text>' +
      renderTextLines(wrapLines(s.dataBullets[0] || '', 18, 2), 120, 366, 25, 38, 'font-family="' + t.fontB + '" font-weight="600" fill="' + (t.mode === 'brutalist' ? '#111111' : t.ink) + '"') +
      '<line x1="120" y1="454" x2="564" y2="454" stroke="' + t.line + '" stroke-width="1.5"/>' +
      renderTextLines(wrapLines(s.dataBullets[1] || '', 18, 2), 120, 508, 23, 36, 'font-family="' + t.fontB + '" fill="' + (t.mode === 'brutalist' ? '#27272A' : t.sub) + '"');

    body += cardRect(t, pfx, 636, 204, 560, 428, 1);
    var bars = [
      ['核心区 A', 360, t.accent],
      ['对比区 B', 248, t.accent2],
      ['对比区 C', 172, t.sub],
      ['基准均值', 118, t.sub]
    ];
    bars.forEach(function (b, idx) {
      var by = 268 + idx * 76;
      body += '<text x="672" y="' + (by + 24) + '" font-family="' + t.fontB + '" font-size="21" fill="' + t.ink + '">' + b[0] + '</text>' +
        '<rect x="790" y="' + by + '" width="' + b[1] + '" height="32" rx="' + Math.min(8, t.radius) + '" fill="' + b[2] + '" opacity="0.9"/>';
    });
    body += '<text x="672" y="592" font-family="' + t.fontB + '" font-size="20" fill="' + t.sub + '">' + esc(clipUnits(s.dataBullets[2] || '', 24)) + '</text>';

    return svgWrap(body);
  }

  function buildSlides(styleId, rawSample, fallbackTitle) {
    var t = THEMES[styleId] || THEMES['soft-rounded'];
    var s = normalizeSample(rawSample, fallbackTitle);
    uidSeq += 1;
    var pfx = 'vs' + uidSeq + '_';
    return [
      { role: '封面', label: '01 · 封面', svg: renderCover(t, s, pfx + '1_') },
      { role: '章节', label: '02 · 章节过渡页', svg: renderChapter(t, s, pfx + '2_') },
      { role: '正文', label: '03 · 核心要点页', svg: renderContent(t, s, pfx + '3_') },
      { role: '数据', label: '04 · 数据对比页', svg: renderData(t, s, pfx + '4_') }
    ];
  }

  function swatchOf(styleId) {
    return STYLE_SWATCH[styleId] || '#4F46E5';
  }

  window.WorkbenchStyleSlides = {
    buildSlides: buildSlides,
    swatchOf: swatchOf,
    normalizeSample: normalizeSample
  };
})();
