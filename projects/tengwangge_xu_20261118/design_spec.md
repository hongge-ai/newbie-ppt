<!-- ppt-master-schema: design-spec/v1 -->
# 落霞孤鹜 · 青云不坠：《滕王阁序》深度导读与千古风骨 - Design Spec

## I. Project Information

| Item | Value |
| --- | --- |
| Project Name | 落霞孤鹜 · 青云不坠：《滕王阁序》深度导读与千古风骨 |
| Canvas Format | PPT 16:9 (1280×720) |
| Page Count | 12 |
| Primary Language | zh-CN |
| Target Audience | 高中及以上古诗文学习者、文学经典导读听众与传统文化爱好者（熟悉“落霞与孤鹜齐飞”等名句，希望进一步贯通创作本事、全篇章法、典故深意与骈文声色美学） |
| Communication Intent | 先以知人论世厘清王勃上元二年省父作序的历史真相，再循“述事—绘景—抒情—言志”四层章法精读原文与典故，最终阐明四六骈文声色造诣及“穷且益坚、不坠青云之志”的精神力量 |
| Desired Audience Outcome | 听众能够准确复述《滕王阁序》紧扣五重题眼的四层行文逻辑，辨析核心典故的正反化用与重要传本异文，并深刻理解王勃如何将齐梁浮靡骈文升华为唐代刚健风骨 |
| Core Message / Ask / Action | 《滕王阁序》不仅以“落霞孤鹜、水天一色”铸就中国骈文声色与空间美学的巅峰，更在“兴尽悲来、时运不齐”的人生低谷中挺立起“穷且益坚，不坠青云之志”的不屈人格，成就“阁以文传”的千年绝唱 |
| Delivery Context | 主要为有主讲人引导的 30–45 分钟文学导读课堂或专题讲座投影演示；次要支持课后自主精读复习与教研留存 |
| Artifact Afterlife | 作为古诗文经典导读课件、自主复习讲义与文学鉴赏参考档案长期留存复用 |
| Reading Mode | balanced |
| Content Strategy | balanced default — 完整保留考据核实的原典引文、纪年考辨与 12 页确认大纲脉络，按编辑式导读节奏组织分层论证与对照 |
| Design Style | 落霞画刊 · 人文摄影特辑 (custom: photo-editorial + editorial) |
| AI Image Acquisition Path | auto |
| Generation Mode | continuous |
| Spec Refinement | disabled |
| Speaker Notes | enabled — final Stage-2 proactive policy |
| Custom Animations | disabled — final Stage-2 proactive policy |
| Narration Audio | disabled — final Stage-2 proactive policy |
| Created Date | 2026-11-18 |

## II. Canvas Specification

| Property | Value |
| --- | --- |
| Format | PPT 16:9 |
| Dimensions | 1280 × 720 |
| viewBox | `0 0 1280 720` |
| Margins | 60px horizontal, 48px vertical |
| Content Area | 1160 × 624 (x: 60–1220, y: 48–672) |

## III. Visual Theme

### Theme Style

- **Mode**: custom
- **Mode References**: narrative, instructional
- **Mode Behavior**: 由 narrative 负责从二十六岁除名省父到即席挥毫、从兴尽悲来到青云不坠的戏剧转折与情感张力，由 instructional 负责“述事—绘景—抒情—言志”四层文本拆解、典故溯源与四六声律的循序导读；章节与转折页用叙事推进标题，细读与对照页用清晰教学标题。
- **Visual style**: custom
- **Visual Style References**: photo-editorial, editorial
- **Visual Style Behavior**: 以用户选定的 photo-editorial 为主导骨架，封面、章节与写景高潮页采用全出血或大画幅摄影区配留白旁注、跨图边界大标题与半透明遮罩；无实景图支撑的分析与校勘页按 photo-editorial 规范切换为 editorial 杂志分栏、细分割线、眉题编号与引文拔高结构，全程零装饰性阴影。
- **Theme**: 落霞丹青 · 暖白人文摄影画刊；以朱红竖向书签标尺与双栏期刊眉题作为跨页连续性视觉母题，在全幅影像页化作前景锚定细线，在分栏精读页化作原典引文侧边标尺。
- **Tone**: 苍茫隽永、清朗刚健、考据谨严

### Color Scheme

| Role | HEX | Purpose |
| --- | --- | --- |
| Background | #FAF7F2 | 暖象牙画刊主底色，承载杂志分栏与留白阅读区 |
| Secondary background | #F0EBE1 | 温润米灰次级色块，承载侧栏、考辨框与表头底衬 |
| Primary | #1E293B | 暮山黛青主色，用于核心标题、章节大号数字与深色锚点块 |
| Accent | #B83B2A | 飞阁流丹朱红强调色，用于眉题编号、引文标尺、关键转折与印记点睛 |
| Secondary accent | #2E6B7E | 秋水长天青蓝辅助强调色，用于空间层次、声律标注与对照维度区分 |
| Body text | #1F242D | 深炭墨正文色，保障投影与近读高对比清晰度 |
| Secondary text | #596273 | 岩灰次级文字色，用于出处注释、年代旁注与页脚眉题 |
| Divider | #D8D0C3 | 暖砂细分割线色，用于编辑式分栏线、表格横线与页眉横尺 |
| Surface | #FFFFFF | 纯白抬升面板色，用于浅底上的重点引文贴片与对比单元 |
| Scrim | #111827 | 深暮暗角遮罩基色，配合透明度叠于全出血摄影之上以衬托浅色文字 |

### AI Image Strategy

- **Image Rendering**: custom
- **Image Rendering References**: corporate-photo, warm-scene
- **Image Rendering Behavior**: 由 corporate-photo 负责真实物理材质、自然景深、三分法构图与杂志级纪实影调，由 warm-scene 负责秋日黄昏低角度霞光、远山薄霭与前景中景远景的大气透视层次；色调锚定暮山黛青与落霞丹红，人物仅作远景剪影，画面内绝无文字水印。
- **Visual**: 真实建筑江景纪实摄影质感，结合黄昏斜阳薄雾与深秋冷暖色调分级
- **Mood**: 苍茫隽永、气势恢宏，宛如《国家地理》或人文历史特刊的跨页专题影像

## IV. Typography System

### Font Plan

| Role | Character (Reference) | Primary | English if non-English | Fallback tail |
| --- | --- | --- | --- | --- |
| Title | serif / literary display | SimSun | Georgia | serif |
| Body | sans-serif / clean editorial | Microsoft YaHei | Segoe UI | sans-serif |
| Cover_title | serif / monumental | SimSun | Georgia | serif |
| Chapter_title | serif / structural | SimSun | Georgia | serif |
| Quote | serif / classical citation | SimSun | Georgia | serif |
| Display | serif / oversized numeral | SimSun | Georgia | serif |

- **Role rationale**: Cover_title、Chapter_title、Quote 与 Display 显式采用宋体与 Georgia 衬线字族，赋予标题、原典骈文名句与大号章节数码浓厚的古籍刊刻气质；Body、Lead、Subtitle、Annotation 与 Footnote 保持微软雅黑与 Segoe UI 无衬线字族，确保多栏考据解析与表格信息清晰利落。
- **Title stack**: SimSun, Georgia, serif
- **Body stack**: Microsoft YaHei, Segoe UI, sans-serif
- **Cover_title stack**: SimSun, Georgia, serif
- **Chapter_title stack**: SimSun, Georgia, serif
- **Quote stack**: SimSun, Georgia, serif
- **Display stack**: SimSun, Georgia, serif

### Font Size Hierarchy

| Purpose | Anchor Size (px) |
| --- | ---: |
| Cover_title | 56 |
| Display | 64 |
| Chapter_title | 48 |
| Title | 42 |
| Subtitle | 32 |
| Lead | 28 |
| Quote | 26 |
| Body | 24 |
| Annotation | 18 |
| Footnote | 14 |

## V. Layout Principles

### Deck-wide Direction

- **Hierarchy direction**: 图像主导页由全幅或大画幅江楼暮色先抓住视线，再经深色渐变遮罩或留白侧栏引导至衬线主标题与精炼提要；分栏精读页由顶部眉题与判断式大标题领起，顺竖向细线进入原典引文与分层拆解。
- **Composition tendency**: 非对称杂志跨页画刊（photo-editorial）与严谨多栏细线排版（editorial）交替呼吸，以直边细线、大号序列数码与原典拔高引文替代千篇一律的圆角卡片网格。
- **Cross-page continuity**: 顶部统一保留细横线与章节眉题定位，关键原典引句统一配飞阁丹红竖向标尺，全篇按“考据立基—章法总揽—四层深读—艺术升华”形成清晰视觉节律。
- **Spacing posture**: 随 `page_rhythm` 动态张弛——封面、章节与写景绝唱页大开大合留足呼吸，考辨、典故与声律页借紧凑分栏承载扎实干货。
- **Spacing anchors**: page margin 60px (horizontal) / 48px (vertical), block gap 24px, column gutter 32px, corner radius 4px, body leading 34px

## VI. Icon Usage Specification

- **Primary bundled library**: tabler-outline
- **Stroke Width**: 2

| Icon Path | Suitable Scenarios |
| --- | --- |
| tabler-outline/book | |
| tabler-outline/feather | |
| tabler-outline/compass | |
| tabler-outline/mountain | |
| tabler-outline/sparkles | |
| tabler-outline/flame | |
| tabler-outline/quote | |
| tabler-outline/scale | |
| tabler-outline/columns | |
| tabler-outline/award | |
| tabler-outline/ripple | |
| tabler-outline/map-pin | |

## VII. Visualization Reference List

| Page | Family | Template | Usage |
| --- | --- | --- | --- |
| P10 | table | comparison_matrix | 对照《文苑英华》/统编教材本与《古文观止》通行本的五组高频异文及校勘成因 |

## VIII. Image Resource List

| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tengwang_pavilion_cover.jpg | 2048×1152 | 16:9 | 封面盛唐江干飞阁流丹暮色历史意境主图 | Hero Scene | 全出血铺满画布并配左侧深色渐变遮罩承托封面主副标题 (#P1-01) | adaptive | ai | Generated | Grand Tang-dynasty style multi-tiered wooden riverside pavilion with vermilion flying eaves perched high on a rocky cliff above a wide autumn river at deep twilight, glowing warm lantern light under upturned eaves contrasting against blue-purple evening sky and mist-veiled distant islands, calm darker left side reserved for editorial headline overlay | none | hero_page |
| tengwang_pavilion_banquet.jpg | 1920×1440 | 4:3 | P04 重阳胜饯与唐代高阁飞檐意境配图 | Atmospheric Scene | 右侧纵向大画幅唐风楼阁意境区与左侧本事题解分栏并置 (#P2-02) | adaptive | ai | Generated | Elevated editorial perspective of classical Tang-style vermilion timber eaves, carved brackets, and high terrace railings overlooking a misty golden-hour autumn river confluence, evoking a Double Ninth literary gathering without modern city buildings | none | local |
| autumn_hills_chapter.jpg | 2048×1152 | 16:9 | P05 章法总纲页寒潭暮山深秋意境背景图 | Atmospheric Scene | 左侧占幅深秋寒潭暮山意境画幅配右侧暖白四层章法总纲栏 (#P2-01) | adaptive | ai | Generated | Deep autumn twilight landscape inspired by clear cold river pools and misty purple-slate distant mountains along the Gan River in Jiangxi, serene water in foreground reflecting soft amber dusk haze, layered mountain ridges fading into mist on the left, calm open atmosphere on the right third, editorial landscape photography feel with golden-hour twilight grading | none | local |
| sunset_lone_wild_duck_hero.jpg | 2048×1152 | 16:9 | P07 第二层绘景“落霞与孤鹜齐飞，秋水共长天一色”全幅主视觉 | Hero Scene | 全画布出血水天落霞主视觉，底部与一侧辅以通透暗角遮罩承载名句精读 (#P1-02) | adaptive | ai | Generated | Expansive cinematic dusk river panorama capturing crimson-gold sunset clouds drifting across a vast sky while a single wild duck silhouette glides gracefully over mirror-calm autumn river water that merges seamlessly with the distant horizon in one unified teal-blue and warm-amber tone, wide negative space in upper-left and lower band for editorial typography | none | hero_page |
| yangtze_eternal_flow.jpg | 2048×1152 | 16:9 | P12 终章“槛外长江空自流”浩荡秋江与高阁凭栏收束图 | Closing Scene | 上半幅或侧翼宽银幕秋江远眺影像与下方千古定评总结区呼应 (#P2-03) | adaptive | ai | Generated | Wide elevated view looking past a dark traditional Tang-dynasty wooden pavilion balustrade toward a vast, endless autumn river flowing into distant golden-mist horizon at dusk, solitary timeless mood evoking historical passage, calm sky and water with clean composition | none | local |

## IX. Content Outline

### Part 1: 知人论世与重阳本事

#### Slide 01 - 封面：落霞孤鹜 · 青云不坠

- **Audience move**: 将《滕王阁序》仅当作背诵名篇的印象 → 进入公元 675 年重阳赣江之畔青年王勃以七百七十三字铸就千古绝唱的历史现场
- **Relationships**: 作品题旨（《秋日登洪府滕王阁饯别序》）统摄四重导读推进脉络（知人论世考本事 → 循题拆解四层章法 → 细读名句典故与骈俪声色 → 体悟青云风骨）的 `order` 递进关系
- **Cover impact**: 钩子锁定“一篇七百七十三字的临江饯别奇文，何以跨越千年成为‘千古第一骈文’与中华士人逆境精神图腾？”；构图以滕王阁赣江暮色全出血实景摄影铺底，左侧叠深暮渐变遮罩承载大号宋体主标题、上元二年纪年眉题与底部四步导读标尺
- **Composition**: 全幅江楼实景摄影配合左侧不对称杂志封面文字区与朱红竖向标尺
- **Title**: 落霞孤鹜 · 青云不坠：《滕王阁序》深度导读与千古风骨
- **Core message**: 王勃于人生低谷途经洪州写就的《滕王阁序》，融汇山川绝唱、宇宙哲思与不屈志节，铸就“千古第一骈文”
- **Content**:
  - 唐代 · 王勃《秋日登洪府滕王阁饯别序》（唐高宗上元二年 · 公元 675 年重阳）
  - 核心追问：一篇七百七十三字的临江饯别奇文，何以跨越千年成为“千古第一骈文”与中华士人逆境精神图腾？
  - 导读主线：知人论世考本事 · 循题拆解四层章法 · 细读名句典故与骈俪声色 · 体悟青云风骨
- **Images**: `tengwang_pavilion_cover.jpg` 作为全画布实景视觉基底
- **Fact IDs**: F006, F012, F013

#### Slide 02 - 导读脉络：从重阳胜饯到江河万古流

- **Audience move**: 面对全文浩繁典故与华美辞藻不知从何入手 → 建立从历史本事、整体章法、逐层细读到艺术回响的四阶段清晰认知地图
- **Relationships**: 四个导读篇章（壹·知人论世 → 贰·章法纵览 → 叁·文本细读 → 肆·艺术与回响）呈先后推进的 `order` 序列关系
- **Composition**: 编辑出版式四栏或双列大号汉字/数字目录格局，以细横线与章节号统领每章核心看点
- **Title**: 导读脉络：从重阳胜饯到江河万古流
- **Core message**: 全课循“本事考辨—四层总纲—原文深读—美学定评”四步递进，打通文史背景与文本肌理
- **Content**:
  - 壹 · 知人论世：二十六岁除名才子与洪州重阳即席挥毫本事
  - 贰 · 章法纵览：紧扣五重题眼的“述事—绘景—抒情—言志”四重奏
  - 叁 · 文本细读：雄州形胜、水天绝唱、兴尽悲来与不坠青云之志
  - 肆 · 艺术与回响：三十余典融铸、四六声色美学与韩愈杜甫千古定评
- **Fact IDs**: F003, F012, F014, F040, F042

#### Slide 03 - 知人论世：从“初唐四杰”之首到万里省父的失路书生

- **Audience move**: 误信“十四岁神童作序”的民间传闻 → 认清王勃连遭斥逐与除名重创、二十六岁南下省父途经洪州的真实生命处境
- **Relationships**: 王勃生平履历（家学早慧 → 沛府斥逐 → 虢州除名累父 → 上元二年南下省父）构成时间因果 `order` 链条，并与“十四岁说/咸亨二年说”形成文献考辨 `contrast` 对照
- **Composition**: 左侧双层人物履历与仕途跌宕轨迹，右侧独立考据专栏辨析作序年份三大文献分歧并给出学界定谳
- **Title**: 知人论世：从“初唐四杰”之首到万里省父的失路书生
- **Core message**: 《滕王阁序》并非少年顺境中的应酬炫技，而是王勃除名累父、辞世前一年在人生低谷写就的生命绝唱
- **Content**:
  - 家学门第与早慧奇才：隋末大儒“文中子”王通之孙，六岁解属文、九岁撰《汉书指瑕》，未及冠授朝散郎，居“王杨卢骆”初唐四杰之首
  - 两次仕途重创：任沛王府修撰因戏作《檄英王鸡文》遭高宗斥逐；补虢州参军因官奴曹达案遇赦除名，连累父亲王福畤左迁交趾令
  - 作序年份学界定谳：据王勃《春思赋序》自述（咸亨二年旅寓巴蜀，时年二十二）与《旧唐书》记载，作序实为上元二年（675）重阳南下省父途经洪州之时（虚岁二十六或二十七），证伪《唐摭言》“十四岁”误载与“咸亨二年”旧说
- **Fact IDs**: F001, F002, F003, F004, F005, F007, F010, F011, F012

#### Slide 04 - 重阳本事与题解：一场暗藏机锋的江南名楼雅集

- **Audience move**: 只知宴会热闹场面 → 看懂阎公试才到折服的戏剧张力，以及原题九字如何统摄全篇五大结构要素
- **Relationships**: 滕王阁沿革与重阳宴集构成背景 `link`，侍吏三报（老生常谈 → 沉吟不言 → 天才不朽）呈递进 `order`，原题五要素（洪府·秋日·登滕王阁·饯·别序）与全文结构形成总分 `parent` 统摄
- **Composition**: 右侧纵向大画幅滕王阁实景摄影展示飞阁流丹气势，左侧上下分层解析重阳受笔三折戏剧过程与九字原题五要素拆解
- **Title**: 重阳本事与题解：一场暗藏机锋的江南名楼雅集
- **Core message**: 当筵受笔成就“腹稿”千古佳话，而《秋日登洪府滕王阁饯别序》九字原题已严密埋下全篇行文总纲
- **Content**:
  - 名楼重修盛会：滕王阁始建于永徽四年（653）滕王李元婴任洪州都督时；上元二年都督阎伯屿重修落成，于九月九日重阳大宴僚属，饯别赴任的新州刺史宇文氏
  - 当筵受笔传奇：阎公本欲令女婿献宿构之序，王勃抗然受笔、“腹稿”成篇；侍吏初报“豫章故郡”阎公哂为“老生常谈”，及闻“落霞”一联矍然起叹：“此真天才，当垂不朽矣！”
  - 双重文体与题眼：原题《秋日登洪府滕王阁饯别序》，兼备临别“赠序”与领起四韵八句的“诗序”功能，全篇严密紧扣“洪府·秋日·登滕王阁·饯·别序”五大要素
- **Images**: `tengwang_pavilion_banquet.jpg` 居右侧画刊图版区呈现滕王阁飞檐楼阁实景
- **Fact IDs**: F006, F007, F008, F009, F013, F015

### Part 2: 章法纵览与四层精读

#### Slide 05 - 章法总纲：“事—景—情—志”四层跌宕的交响结构

- **Audience move**: 觉得全文辞采纷繁难以把握主干 → 掌握七自然段归入“述事—绘景—抒情—言志”四层推进与情绪起承转合的全局骨架
- **Relationships**: 四大结构层次（第一层述事 → 第二层绘景 → 第三层抒情 → 第四层言志）按行文先后与情绪起伏构成严密 `order` 递进链
- **Composition**: 左侧深秋寒潭暮山意境画幅营造章节呼吸感，右侧以四道清晰水平阶梯展开四层对应段落、紧扣题眼与情感基调曲线
- **Title**: 章法总纲：“事—景—情—志”四层跌宕的交响结构
- **Core message**: 全文七段紧扣五重题眼，循“述事轩昂—绘景寥廓—抒情悲慨而激昂—言志旷远”完成四重交响推进
- **Content**:
  - 第一层 · 述事（第 1 段）：紧扣“洪府、饯”——铺陈雄州山川形胜与东南宾主盛况，基调庄重轩昂
  - 第二层 · 绘景（第 2–3 段）：紧扣“秋日、登滕王阁”——由寒潭暮山推向水天一色、渔歌雁阵，意境澄澈寥廓
  - 第三层 · 抒情（第 4–5 段）：紧扣“饯（宴思）”——由“四美具、二难并”陡转“兴尽悲来”，旋即激昂挺立“青云之志”
  - 第四层 · 言志（第 6–7 段及附诗）：紧扣“别、序”——自陈弱冠报国怀抱与鲤庭侍父孝思，谦敬赋诗，收束于长江浩叹
- **Images**: `autumn_hills_chapter.jpg` 作为章节页左侧视觉主景
- **Fact IDs**: F013, F014

#### Slide 06 - 第一层·述事：天地坐标中的“物华天宝”与“人杰地灵”

- **Audience move**: 将首段视为常规客套寒暄 → 读懂王勃如何用星宿分野、江湖形胜与本土名典瞬间立起宏大天地人格局
- **Relationships**: 首段内部由“天文地理坐标”到“物华/人杰双峰对举”再到“满座文武宾主与谦辞入席”呈由宏入微的 `order` 推进，其中“物华天宝”与“人杰地灵”构成并列 `contrast` 对偶
- **Composition**: 顶部大幅拔高首段核心骈句引文，下方分三栏拆解“天地大开大合”“风物人文双璧”“文武俊彦入席”三重章法
- **Title**: 第一层·述事：天地坐标中的“物华天宝”与“人杰地灵”
- **Core message**: 首段以天地星宿锚定洪州枢要，借丰城剑气与陈蕃下榻双典兼赞风物与宾主，起笔即具盛唐气象
- **Content**:
  - 天地大开大合：“豫章故郡，洪都新府。星分翼轸，地接衡庐。襟三江而带五湖，控蛮荆而引瓯越”，上应二十八宿分野、下扼江南荆越枢要
  - 风物人文双峰并峙：“物华天宝，龙光射牛斗之墟”（丰城龙泉、太阿双剑精气冲霄）对举“人杰地灵，徐孺下陈蕃之榻”（东汉太守陈蕃专为南昌高士徐穉设榻），切地切人、礼赞宾主
  - 满座文武俊彦：盛赞阎公雅望与宇文懿范，以“腾蛟起凤，孟学士之词宗；紫电青霜，王将军之武库”烘托高朋满座，末以“童子何知，躬逢胜饯”谦逊入题
- **Fact IDs**: F015, F023, F024, F025

#### Slide 07 - 第二层·绘景：多镜头空间推拉与“落霞孤鹜”的千古画境

- **Audience move**: 仅停留在背诵“落霞与孤鹜齐飞”单句 → 领略王勃上下俯仰、远近推拉、视听延展的立体镜头调度与点化庾信名句的美学超越
- **Relationships**: 写景视角按“寒潭暮山近郊 → 耸翠流丹高下落差 → 水天齐飞远景焦点 → 彭蠡渔歌衡阳雁阵千里听觉”呈空间延展 `order`，并与庾信《马射赋》原句构成点化升华 `contrast`
- **Composition**: 全画布出血呈现“落霞孤鹜、水天一色”暮色江天主视觉，上方与底部局部半透明遮罩承载千古名联大字引文及三组空间与点化精析
- **Title**: 第二层·绘景：多镜头空间推拉与“落霞孤鹜”的千古画境
- **Core message**: 王勃以多维空间推拉与动静相生构筑立体秋江长卷，将宫廷春景仪仗升华为浩渺宇宙生机
- **Content**:
  - 九月底色与垂直落差：“潦水尽而寒潭清，烟光凝而暮山紫”凝练深秋清冽苍紫之气；“层峦耸翠，上出重霄；飞阁流丹，下临无地”拉出接天临渊的立体落差
  - 远近俯仰至水天绝唱：由雕甍绣闼、钟鸣鼎食、青雀黄龙推至雨霁天晴——“落霞与孤鹜齐飞，秋水共长天一色”，飞动霞鹜与静穆水天交融无间
  - 点化前贤与视听延展：脱胎庾信《马射赋》“落花与芝盖同飞，杨柳共春旗一色”，化皇家苑囿仪仗为苍茫宇宙生机；再借彭蠡渔歌、衡阳雁阵将视听推向千里之外
- **Images**: `sunset_lone_wild_duck_hero.jpg` 作为全幅出血主视觉（hero_page）统领全页画境
- **Fact IDs**: F016, F017, F026, F038, F039

#### Slide 08 - 第三层·抒情转折：从“兴尽悲来”到“不坠青云之志”的精神突围

- **Audience move**: 误以为王勃怀才不遇只剩消极感伤 → 体悟从欢宴极点到宇宙悲慨、再由命运困局陡然昂扬挺立君子人格的二次精神跃升
- **Relationships**: 情感脉络经历“四美二难之欢 → 兴尽悲来失路之叹 → 老当益壮青云立志”的两次逆转 `order`，且“君子达人自强”与“阮籍穷途恸哭”形成鲜明价值取向 `contrast`
- **Composition**: 编辑式三阶情感张力版式，左侧或上半幅呈现由欢转悲再振起的三折递进，右侧拔高核心名联“老当益壮……穷且益坚……”配朱红竖向标尺做视觉高潮
- **Title**: 第三层·抒情转折：从“兴尽悲来”到“不坠青云之志”的精神突围
- **Core message**: 全文在“兴尽悲来、时运不齐”的低谷中陡然振起，以“穷且益坚，不坠青云之志”完成超越个人遭际的精神突围
- **Content**:
  - 极乐陡转宇宙苍茫：承“睢园绿竹”“邺水朱华”“四美具，二难并”之盛筵欢娱，凭高远眺顿生“天高地迥，觉宇宙之无穷；兴尽悲来，识盈虚之有数”的生命哲思
  - 千古才士失路共悲：遥望长安日下、感伤关山难越，连举“冯唐易老，李广难封；屈贾谊于长沙，窜梁鸿于海曲”四典，痛陈圣明之世亦有才士不遇的困局
  - 逆境挺立君子风骨：以“所赖君子见机，达人知命”陡然振起，高唱“老当益壮，宁移白首之心？穷且益坚，不坠青云之志”与“东隅已逝，桑榆非晚”，反用阮籍“穷途之哭”拒绝沉沦
- **Fact IDs**: F018, F019, F027, F028, F029, F030, F031, F032

#### Slide 09 - 第四层·言志与附诗：书生报国初心与“槛外长江空自流”

- **Audience move**: 常忽略篇末自叙与五十六字附诗 → 理解青年书生家国孝思的真诚收束，以及附诗如何从百年时空高度凝练全序灵魂
- **Relationships**: 序末自叙（报国壮怀 · 鲤庭孝思 · 龙门知遇 · 谦请赋诗）与篇末《滕王阁诗》八句形成“序引诗、诗凝序”的互文 `link` 呼应
- **Composition**: 左右非对称书卷双栏布局——左栏梳理第 6–7 段自叙言志与感恩谦辞，右栏以古籍诗笺样式完整排印《滕王阁诗》八句并批注“随立随扫”与时空流水对章法
- **Title**: 第四层·言志与附诗：书生报国初心与“槛外长江空自流”
- **Core message**: 篇末融终军宗悫报国壮怀与鲤庭侍父孝思于一体，并以五十六字《滕王阁诗》将人生盛衰汇入永恒奔流的长江
- **Content**:
  - 弱冠壮怀与万里孝思：自报“勃，三尺微命，一介书生”，借终军弱冠请缨、班超投笔、宗悫乘长风破万里浪抒报国初心，以“他日趋庭，叨陪鲤对”明万里侍父之孝
  - 知音感念与谦恭收束：借李膺“登龙门”、钟子期听“高山流水”感念阎公知遇，叹兰亭、梓泽盛筵难再，恭请群公“请洒潘江，各倾陆海”
  - 《滕王阁诗》五十六字互证：首联“佩玉鸣鸾罢歌舞”随立随扫，颔颈联“画栋朝飞南浦云，珠帘暮卷西山雨”“物换星移几度秋”贯通朝暮古今，尾联“阁中帝子今何在？槛外长江空自流”将人生盛衰汇入永恒江流
- **Fact IDs**: F020, F021, F028, F033, F034, F035

### Part 3: 艺术成就与文学史回响

#### Slide 10 - 用典体系与传本异文：三十余典四维图谱与校勘对照

- **Audience move**: 面对密集典故与不同选本字句差异感到困惑 → 系统掌握三十余典的四类功能分工、正反用典技法及权威传本异文成因
- **Relationships**: 全篇三十余处典故按语境功能归入四大类别（`membership`），正用立志与反用阮籍构成修辞 `contrast`；两大传本系统（《文苑英华》/统编本 vs《古文观止》本）在五处关键异文上逐项 `contrast` 对照
- **Composition**: 上半区以编辑式四维分类条带梳理三十余典与正反用典法则，下半区以清晰校勘对照表呈现两大传本五组高频异文与避讳成因
- **Title**: 用典体系与传本异文：三十余典四维图谱与校勘对照
- **Core message**: 三十余典严密贴合地望、雅集、悲慨与立志而毫无堆砌之弊，传本异文则见证唐写本与明清选本的流传演变
- **Content**:
  - 四维用典体系（全篇 30+ 典故严密贴合语境）：地理风物（翼轸/瓯越/龙光/徐榻）· 雅集名物（腾蛟/紫电/钟鼎/睢园/邺水）· 怀才不遇（宣室贾谊/梁鸿/冯唐/李广）· 砺志知音（马援/贪泉/涸辙/桑榆/终军/宗悫/鲤庭/钟期）
  - 正用与反用辩证融合：正面化用马援豪言、吴隐之酌贪泉、光武帝勉冯异自励；反向翻出“阮籍猖狂，岂效穷途之哭”，划清旷达刚健与消极恸哭的精神界限
  - 权威传本异文对照（《文苑英华》/统编教材本 vs《古文观止》通行本）：豫章故郡/南昌故郡（避唐代宗李豫名讳）、层峦流丹/层台翔丹、云销区明/虹销云衢、君子见机/安贫，以及序末“请洒潘江，各倾陆海云尔”十字存删
- **Visualization**: `variant-collation-matrix`（`table/comparison_matrix`，5 行核心异文 × 3 列：校勘位置、《文苑英华》/统编教材本、《古文观止》本及成因释义）
- **Native-ready**: `variant-collation-matrix=yes`
- **Fact IDs**: F013, F022, F023, F024, F025, F027, F028, F029, F030, F031, F032, F033, F034, F035

#### Slide 11 - 骈文艺术巅峰：四六节奏、当句对、声律与丹青色谱

- **Audience move**: 只觉得骈文读来朗朗上口却说不清门道 → 从句式错综、句内自对、平仄交错与冷暖设色四个技术维度拆解其形式美密码
- **Relationships**: 骈文三大形式支柱（四六句式与当句对 · 节拍平仄声律 · 丹青冷暖色谱）共同支撑全篇“声色并陈”的美学高度（`link`），其中冷暖色彩词与平仄句脚各自构成对称 `contrast`
- **Composition**: 编辑出版三纵栏精密拆解版式，分别以句式节拍切分示例、句脚平仄对照标记与原典显性色彩词色卡条直观展示骈俪声色技艺
- **Title**: 骈文艺术巅峰：四六节奏、当句对、声律与丹青色谱
- **Core message**: 《滕王阁序》集四六错综、双层当句对、近体平仄声律与高饱和丹青色谱于一身，代表中国古典骈文形式美的极境
- **Content**:
  - 四六错综与高频“当句对”：以刘勰所谓“四字密而不促，六字格而非缓”为骨架，穿插一、三、五、七言跌宕流走；密集运用“物华/天宝”“人杰/地灵”“鹤汀/凫渚”“青雀/黄龙”“东隅/桑榆”等句内自对，形成双层对称张力
  - 近体声律入骈文：严守节拍点平仄相对与上下句脚平仄交错（如“上出重霄［平］/下临无地［仄］”“宁移白首之心［平］/不坠青云之志［仄］”），配以双声叠韵与虚字舒缓气韵，抑扬顿挫
  - 词炳丹青的冷暖色谱：显性铺陈暮山紫、层峦翠、飞阁丹、青雀黄龙、白云绿竹朱华等十余处高饱和色彩对撞，与落霞绯红、秋水碧青、长天苍蓝的光影交织成立体画卷
- **Fact IDs**: F001, F015, F016, F017, F019, F036, F037, F038

#### Slide 12 - 文学史回响：革除六朝浮靡，“阁以文传”的千年文化基因

- **Audience move**: 完成单篇文辞与技法赏析 → 站在中国文学史与民族精神传统的高度，理解“阁以文传”与近三十则成语沉淀的不朽生命力
- **Relationships**: 美学革新（突破六朝及上官体浮靡）引发历代名家定评（杜甫、韩愈推崇）并沉淀为现代汉语文化基因（近三十则成语）的因果延展 `order`
- **Closing impact**: 收束定论锁定“楼阁终有兴废，唯少年王勃在逆境中唱出的青云壮志与水天绝唱，随浩荡江河万古长流”；构图以高阁槛外浩荡秋江画幅与杜甫、韩愈千古定评及成语基因矩阵共同收官
- **Composition**: 上半幅宽银幕“槛外长江空自流”暮江画幅叠印收官金句，下半幅分三区呈现骈文风骨跨越、杜甫韩愈定评与经典成语积淀
- **Title**: 文学史回响：革除六朝浮靡，“阁以文传”的千年文化基因
- **Core message**: 王勃以刚健风骨重塑骈文灵魂，获杜甫“江河万古流”与韩愈“词列三王之次”推崇，化作滋养千年的汉语文化基因
- **Content**:
  - 骈文史上的美学跨越：一扫齐梁及初唐宫廷“上官体”绮错婉媚之风，将铺采摛文的骈俪体制、苍凉深挚的身世之感与刚健昂扬的生命哲理融为一体
  - 杜甫与韩愈的千古定评：杜甫《戏为六绝句》力赞“不废江河万古流”；中唐古文运动领袖韩愈作《新修滕王阁记》破例推崇“壮其文辞”，以“词列三王之次，有荣耀焉”自豪
  - 沉淀汉语文化基因：凝练出“物华天宝、人杰地灵、水天一色、渔舟唱晚、兴尽悲来、老当益壮、穷且益坚、东隅桑榆、乘风破浪、高山流水、物换星移”等近三十则成语，令少年风骨长耀古今
- **Images**: `yangtze_eternal_flow.jpg` 作为终章宽幅秋江意境图呼应“槛外长江空自流”与“不废江河万古流”
- **Fact IDs**: F015, F017, F018, F019, F020, F021, F040, F041, F042

## X. Speaker Notes Requirements

- **Generation**: enabled
- **Filename**: match each SVG filename under `notes/`
- **Content**: 紧扣每页最终可见 SVG 内容展开导读讲稿，补充原典名句诵读提示、历史典故背景细节与上下文过渡串联，不堆砌未上屏的外部生僻史料，不写入图片来源或许可证文本
- **Total duration**: 约 35–40 分钟（平均每页 3 分钟左右）
- **Notes style**: 温润儒雅而富有感染力的课堂导读与人文讲座口吻，兼具文学画面感与考据条理性
- **Presentation purpose**: 先以知人论世厘清王勃上元二年省父作序的历史真相，再循“述事—绘景—抒情—言志”四层章法精读原文与典故，最终阐明四六骈文声色造诣及“穷且益坚、不坠青云之志”的精神力量
