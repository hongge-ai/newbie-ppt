<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- format: PPT 16:9
- viewBox: 0 0 1280 720

## communication
- primary_language: zh-CN
- audience: 高中及以上古诗文学习者、文学经典导读听众与传统文化爱好者
- objective: 先考证王勃上元二年省父作序本事，再循“述事—绘景—抒情—言志”四层章法精读名句与典故，使听众掌握五重题眼逻辑、正反用典与传本异文，并体悟唐代刚健骈文风骨
- core_message: 《滕王阁序》不仅以“落霞孤鹜、水天一色”铸就中国骈文声色与空间美学的巅峰，更在人生低谷中挺立起“穷且益坚，不坠青云之志”的不屈人格，成就“阁以文传”的千年绝唱
- consumption_mode: balanced

## mode
- mode: custom
- mode_references: narrative, instructional
- mode_behavior: 由 narrative 负责从二十六岁除名省父到即席挥毫、从兴尽悲来到青云不坠的戏剧转折与情感张力，由 instructional 负责“述事—绘景—抒情—言志”四层文本拆解、典故溯源与四六声律的循序导读；章节与转折页用叙事推进标题，细读与对照页用清晰教学标题。

## visual_style
- visual_style: custom
- visual_style_references: photo-editorial, editorial
- visual_style_behavior: 以用户选定的 photo-editorial 为主导骨架，封面、章节与写景高潮页采用全出血或大画幅摄影区配留白旁注、跨图边界大标题与半透明遮罩；无实景图支撑的分析与校勘页按 photo-editorial 规范切换为 editorial 杂志分栏、细分割线、眉题编号与引文拔高结构，全程零装饰性阴影。

## colors
- background: #FAF7F2
- secondary_bg: #F0EBE1
- primary: #1E293B
- accent: #B83B2A
- secondary_accent: #2E6B7E
- body_text: #1F242D
- secondary_text: #596273
- divider: #D8D0C3
- surface: #FFFFFF
- scrim: #111827
- image_rendering: custom
- image_rendering_references: corporate-photo, warm-scene
- image_rendering_behavior: 由 corporate-photo 负责真实物理材质、自然景深、三分法构图与杂志级纪实影调，由 warm-scene 负责秋日黄昏低角度霞光、远山薄霭与前景中景远景的大气透视层次；色调锚定暮山黛青与落霞丹红，人物仅作远景剪影，画面内绝无文字水印。

## typography
- font_family: Microsoft YaHei, Segoe UI, sans-serif
- title_family: SimSun, Georgia, serif
- body_family: Microsoft YaHei, Segoe UI, sans-serif
- cover_title_family: SimSun, Georgia, serif
- chapter_title_family: SimSun, Georgia, serif
- quote_family: SimSun, Georgia, serif
- display_family: SimSun, Georgia, serif
- cover_title: 56
- display: 64
- chapter_title: 48
- title: 42
- subtitle: 32
- lead: 28
- quote: 26
- body: 24
- annotation: 18
- footnote: 14

## icons
- library: tabler-outline
- stroke_width: 2
- inventory: tabler-outline/book, tabler-outline/feather, tabler-outline/compass, tabler-outline/mountain, tabler-outline/sparkles, tabler-outline/flame, tabler-outline/quote, tabler-outline/scale, tabler-outline/columns, tabler-outline/award, tabler-outline/ripple, tabler-outline/map-pin

## images
- p01: images/tengwang_pavilion_cover.jpg | source=ai | crop=adaptive
- p04: images/tengwang_pavilion_banquet.jpg | source=ai | crop=adaptive
- p05: images/autumn_hills_chapter.jpg | source=ai | crop=adaptive
- p07: images/sunset_lone_wild_duck_hero.jpg | source=ai | crop=adaptive
- p12: images/yangtze_eternal_flow.jpg | source=ai | crop=adaptive

## page_visualizations
- P10: table/comparison_matrix

## page_rhythm
- P01: anchor
- P02: anchor
- P03: dense
- P04: dense
- P05: anchor
- P06: dense
- P07: breathing
- P08: dense
- P09: dense
- P10: dense
- P11: dense
- P12: anchor

## pptx_structure
- mode: flat

## forbidden
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
