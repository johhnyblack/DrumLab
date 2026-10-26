# Audiveris 本机安装与 PDF 导入实测

日期：2026-10-26（Asia/Shanghai）。本次验证针对一份真实印刷鼓谱，不构成识别准确率评估。

## 安装与启动

- 环境：Windows 本机 WSL2 / Ubuntu，Python 3.12，Audiveris 5.11.0。
- 官方安装包：`Audiveris-5.11.0-ubuntu24.04-x86_64.deb`，解包安装到 `.tools/audiveris/`，包含独立 Java 运行时。
- 包 SHA-256：`f20113aaa33b3149ec8d6a09b2a7963360e65fafd92d69389987a85bbc3ec7a3`，已与 GitHub Release 资产的官方 digest 比对一致。
- 本机包装脚本：`.tools/audiveris-drumlab.sh`；`run.py` 自动发现，显式 `AUDIVERIS_BIN` 优先。
- 英文 OCR 语言数据来自 Tesseract 官方 `tessdata_fast` 仓库，安装到 `.local/audiveris/config/AudiverisLtd/audiveris/tessdata/`。
- 本机安装、模型、缓存、原始第三方 PDF、识别结果及截图均排除出 Git。

Windows 双击 `Start-DrumLab-WSL.bat` 可启动本次 WSL 安装；默认 WSL 发行版必须与当前环境一致。原生 Windows MSI 安装及原生 Windows Python 路径没有在本次验证中测试。

对下述 JazzPerc 示例，在 WSL 项目目录运行：

```bash
python3 run.py --open --omr-font JazzPerc --omr-small-notes
```

其他鼓谱应按实际字体选择参数。普通印刷谱可先不传字体参数。开发模式需自行设置 `AUDIVERIS_BIN` 为包装脚本的绝对路径。

## 测试输入与参数

输入为 Audiveris 官方鼓谱教程引用的 [Ophelia 鼓谱 PDF](https://www.redeyepercussion.com/music/Ophelia_TheBand_redeyepercussion.com.pdf)，1 页、36,342 字节，没有内嵌 MusicXML。本次实际经过图像识谱流程，而非读取附件 XML。

PDF SHA-256：`3a2e3fa7764e2b8bb228ad5211c43420b57cdb9c057c1da55071c483f311a715`。

依据[官方鼓谱说明](https://audiveris.github.io/audiveris/_pages/guides/specific/drums/)启用：

- `ProcessingSwitches.drumNotation=true`
- `ProcessingSwitches.oneLineStaves=true`
- `MusicFont.defaultMusicFamily=JazzPerc`
- `ProcessingSwitches.smallHeads=true`
- `ProcessingSwitches.smallBeams=true`

前两项由项目默认传入；字体和小符头参数按需启用。

## 结果

| 检查 | 结果 |
| --- | --- |
| 官方 Audiveris 程序启动及帮助 | 通过 |
| PDF → Audiveris → MXL | 通过，保存了实际 MXL 和 OMR 项目 |
| 项目健康接口 | HTTP 200，`omr: true` |
| 项目真实 `/api/import` 请求 | HTTP 200，约 19.76 秒 |
| 项目结构化结果 | 70 个小节、947 个非休止音符事件 |
| 鼓件映射 | 军鼓 204、通鼓 1、闭踩镲 438、底鼓 257、开踩镲 46、落地鼓 1；无未知鼓件 |
| 原谱保留与校对标记 | 返回原 PDF，`needsReview: true`，保留校对提示 |
| PDF 页面预览 API | HTTP 200，返回实际 PNG |
| Chromium 真实上传 | 通过，显示 70 小节，原 PDF iframe 存在，无待映射鼓件 |
| Chromium 确认及播放 | 确认后可以开始和停止练习，无页面脚本错误 |
| 后端回归测试 | 18 项通过；一条既有 Starlette/httpx 弃用提示 |

浏览器验证使用隔离测试上下文；自动点击“确认校正”仅用于检查后续播放功能，不代表音符已逐项人工核对。无头 Chromium 截图中的 PDF iframe 未显示内建 PDF 阅读器内容；实际页面内容通过独立预览 API 返回的 PNG 核验，未将 iframe 元素可见等同于原稿渲染成功。

## 实测发现及修复

1. **鼓谱开关**：项目调用补充鼓谱识别参数，避免完全依赖 Audiveris 的默认状态。
2. **字体选择**：该 PDF 使用 JazzPerc。默认参数产生 783 个音符事件；按官方示例设置后产生 947 个事件。数量差异不等于准确率提升百分比，仍需对照原谱。
3. **鼓件编号兼容**：实测 Audiveris 5.11.0 / ProxyMusic 4.0.3 输出的 `midi-unpitched` 与对应 GM 键值相同，而标准 MusicXML 采用从 1 起算的值。原解析器一律减 1，导致闭踩镲被映射成落地鼓。现仅在软件元数据为 Audiveris、至少两个已知鼓件名称提供一致证据时兼容零起算；标准编号及其他软件输出不自动平移。对应两种编号及其他软件情况均有回归测试。
4. **异常小节提示**：保留原事件，但对音符时值超出拍号的小节添加人工校正提示。
5. **配置与启动**：增加自动发现本机包装脚本、可选字体参数、小符头参数和 Windows WSL 启动入口。识谱结果保留输入 PDF 文件名作为来源。

## 尚需人工校正

- 第 15 个导入小节为 4/4，但音符时间轴达到 4.5 个四分音符，需要对照原谱校正；这是导入列表中的序号，未声称等于原稿印刷小节号。
- 存在装饰音，当前不完整转换；存在反复记号，当前按书写顺序导入，不展开反复。
- 947 个事件是程序实际返回的数量，没有逐个与人工标注比对；“无未知鼓件”不意味着每个鼓件都识别正确。
- 尚未验证用户自己的鼓谱、扫描件、手写谱、更多字体或电子鼓硬件。

## 本机证据

以下文件位于忽略目录，保留在本机供复查，不随仓库分发第三方鼓谱：

```text
.local/omr-validation/Ophelia.pdf
.local/omr-validation/direct.log
.local/omr-validation/direct/Ophelia.mxl
.local/omr-validation/jazzperc.log
.local/omr-validation/jazzperc/Ophelia.mxl
.local/omr-validation/jazzperc/Ophelia.omr
.local/omr-validation/api-summary.json
.local/omr-validation/api-result.json
.local/omr-validation/reference.png
.local/omr-validation/browser-summary.json
.local/omr-validation/browser-import.png
```

官方来源：[Audiveris Release 5.11.0](https://github.com/Audiveris/audiveris/releases/tag/5.11.0)、[鼓谱指南](https://audiveris.github.io/audiveris/_pages/guides/specific/drums/)、[Tesseract 英文语言数据](https://github.com/tesseract-ocr/tessdata_fast)。

## 后续：复位与原版 PDF 动态播放

已在同一 Ophelia 原谱上重新执行真实识别与浏览器验证：70 个导入小节均匹配到 `.omr` 原稿位置，947 个音符保留。页面显示实际 PDF 栅格图像，验证第 6 小节高亮和拍线移动，修改音符后确认复位可恢复原始数量，无页面脚本错误。

本节覆盖了前文无头 Chromium 内建 PDF 阅读器无法渲染的限制：现已使用 `/api/pdf-page` 页面图像作为播放底图，截图可见原谱及高亮，证据保存在 `.local/omr-validation/pdf-playback.png` 与 `dynamic-pdf-summary.json`。

附加自动化覆盖：复位取消、刷新后复位、已编辑 JSON 重开后复位、非均匀拍点插值、非法坐标拒绝、原稿小节数不匹配保护、双页原谱自动翻页/循环返回/停止和手动定位。
