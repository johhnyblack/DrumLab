# DrumLab

**中文** | [English](README.en.md)

本地电子鼓练习工具：导入鼓谱、编辑律动、处理录音，再按自己的速度分段练习。当前为 MVP，应用界面为中文。

![DrumLab 功能鼓谱编辑与循环练习](screenshot.png)

[快速启动](#启动) · [示例体验](#试用路径) · [功能边界](#同步策略与限制) · [验证记录](VALIDATION.md)

一个可在本机运行的电子鼓练习工作室。React + TypeScript 前端、FastAPI + NumPy/SciPy 音频后端，支持功能鼓谱编辑、录音处理、分段循环和同一音频时钟同步播放。

## MVP 范围

- MusicXML / MXL：解析 percussion 声部、GM 鼓件映射、和弦、backup/forward、多声部、原始有理数时值、三连音、拍号与弱起。原始非网格拍点保留，列表可以精确修改。未知映射必须人工确认。
- PDF：导入并预览原文；优先提取内嵌 MusicXML；可接本地 Audiveris 自动识谱；失败时建立明确标注的空白校正谱。可逐小节补谱、修改拍号、增加/删除音符、映射鼓件、填写手脚与段落提示、确认校对。**未安装 Audiveris 时，普通 PDF 不会自动转为音符。**
- 真实录音：文件导入或浏览器设备录音；去直流、25 Hz 零相位高通、保守频谱降噪、可选 −1 dBFS 峰值归一化与硬限制；原音/处理后互斥试听；保留 WAV / FLAC / OGG 原文件，浏览器录音转 32-bit 浮点 WAV；修复后导出 24-bit WAV。
- 练习：可调 BPM、A/B 小节区间、循环、预备拍、独立开关节拍器/合成鼓/录音。所有练习声音使用同一个 AudioContext 时钟。录音需手动校准原始 BPM 与首拍偏移。
- 保存：鼓谱自动保存在当前浏览器 localStorage；JSON 项目导入/导出包含功能谱、警告与原始 PDF（若仍载入）。**录音只在内存中，刷新前请单独下载；自动保存不包括 PDF。**

## 启动

需要 Python 3.12+（已测 3.12）、Node.js 22.12+（已测 24），首次安装需要联网。运行后无需云端账户或 API Key。

Windows：解压后双击 `Start-DrumLab.bat`，或在项目目录运行：

```powershell
py run.py --setup --open
```

macOS / Linux：

```bash
python3 run.py --setup --open
```

安装完成后的快速启动：`python run.py --open`（Windows 也可用 `py`，Linux 用 `python3`）。浏览器访问 **http://localhost:8765**。端口冲突时增加 `--port 8766`。停止服务按 Ctrl+C。

从 GitHub 获取源码后，先进入项目目录再执行上述命令。首次启动必须使用 `--setup`；它会安装依赖并生成前端构建。

前端已经构建在 `dist/`，FastAPI 同时提供页面与 API，不需要同时打开两个服务。`run.py --setup` 会重新安装并构建，便于首次启动和源码更新。

开发模式：

```bash
# 先完成上述 setup，再开两个终端
.venv/bin/python -m uvicorn backend.main:app --port 8765 --reload
npm run dev
```

Windows 的 Python 路径换成 `.venv\Scripts\python.exe`。Vite 将 `/api` 转发到本机 8765 端口。

## 试用路径

1. 默认示例是 8 小节 96 BPM 的 Funk 律动。点击空格加音符，点击已有音符再到下方删除或修改；选三连音网格可输入三连音。
2. 导入 `samples/Tuplet-Pocket.musicxml` 或 `.mxl`，检查同拍底鼓/踩镲、多声部与三连音。切换三连音网格或从音符列表检查非网格拍点。
3. 导入 `samples/Manual-reference.pdf`：没有 Audiveris 时应显示“空白校正谱”，左侧显示原稿。手动录入后点击确认，不会把默认示例误当识别结果。
4. 到录音工作台导入 `samples/Pocket-96.wav`。这是为测试生成的真实 PCM 合成音频，含底噪与直流。原 BPM 96、首拍偏移 0.20 秒，可处理、试听并下载。
5. 返回默认示例（清除浏览器项目存储或打开 `samples/Pocket-project.json`），开启“同步播放录音”，选择小节 1–4，以 72 或 96 BPM 循环。切换 BPM 会停止当前播放，需要重新开始。
6. 导出 JSON，刷新后打开项目验证恢复。录音不嵌入 JSON，需重新载入。

## PDF 识谱与准确率边界

MVP 没有声称某个百分比准确率：未提供真实鼓谱标注数据集，合成测试通过不能代表出版社或扫描谱的准确率。解析 MusicXML 与光学识别 PDF 是两件事。

已测试 MusicXML 的黄金样例含 5 个音符事件，预期鼓件与时值逐项断言；PDF 测试确认失败结果为 0 个识别音符而非编造数据。光学结果统一标记需要人工核对，不生成未经校准的“置信度”。

可选安装 Java 与 [Audiveris](https://github.com/Audiveris/audiveris)，将 `AUDIVERIS_BIN` 设置为本机可执行文件/启动脚本的绝对路径，再重启服务。后端执行 `-batch -export -output <临时目录> -- <PDF>`，120 秒超时，读取输出 MXL。此环境未安装 Audiveris，**真实 OMR 识别路径尚未端到端验证**；手工兜底及内嵌 XML 路径已测试。识别失败后可先在 Audiveris GUI 校正并导出 MXL 再导入。

人工核对建议：逐页比对小节数、拍号、休止、同拍组合、三连音、弱起、鼓件位置；不确定的鼓件保留未知映射。未经映射的音符会阻止练习播放。可将通鼓类音符重新映射为其他鼓件；本版 GM 高/中通鼓统一归类为“通鼓”，原 instrument ID 保存在每个导入音符的 originalInstrument 字段。

## 同步策略与限制

- 25 ms 调度任务只负责向 AudioContext 安排未来 180 ms 内的事件；声音起点使用绝对时间，不以 UI 定时器触发。界面通过 requestAnimationFrame 读取同一时钟。
- 鼓声与节拍器同拍使用相同时间；录音用 AudioBufferSourceNode 的原生 loopStart/loopEnd 循环，按 `练习 BPM / 录音原 BPM` 设置 playbackRate。起点为 `首拍偏移 + 区间前四分音符数 × 60 / 原 BPM`。
- 后台/系统休眠导致调度落后时，停止并提示重新播放，避免悄悄错拍。浏览器仍可能受硬件延迟影响，未在真实电子鼓硬件上测量延迟。
- 变速会同时改变音高；未实现保音高拉伸、自动 BPM 检测、自动对齐、音源分离或真实鼓采样库。鼓声示范为合成声音。
- 原谱速度变化被记录在 `tempos`，练习使用固定 BPM；反复、D.C./D.S. 不展开。装饰音提示核对；连音起点由 duration 保留。力度当前默认 90，不完整还原 MusicXML 表情记号。
- 非网格音符仍被播放并显示在音符列表，但网格仅显示与当前细分对齐的音符。不要仅凭网格推断导入音符数量。
- 降噪可能影响镲片尾音；先用低强度对比。峰值限制无法修复已经丢失的削波信息；后端处理的采样率、声道数、采样帧数保持一致。WAV / FLAC / OGG 直接提交原始文件处理，避免浏览器播放解码重采样影响导出文件；其他格式与浏览器录音按浏览器解码采样率转为浮点 WAV。播放解码采样率与源文件处理采样率分别标示。高通滤波改变波形但不引入整体时间位移。
- 设备录音由浏览器权限控制，使用 localhost 或 HTTPS。请在系统/浏览器选择电子鼓 USB 声卡输入。未验证用户实际硬件。
- 单文件最大 32 MB，音频最长 10 分钟，单/双声道，1–192 kHz；PDF 最多 40 页；MusicXML 最大 20 MB，MXL 解压总计最大 40 MB。

## 测试

```bash
npm test
.venv/bin/python -m pytest -q
npm run build
# 浏览器端到端（先启动 8765 服务）
npx playwright install chromium
npx playwright test
```

测试说明与结果见 `VALIDATION.md`。生产依赖和开发依赖已执行 npm audit。音频后端只接收本机浏览器发来的文件，不调用云服务；第三方浏览器字体请求也已移除。当前应用没有鉴权，默认启动只绑定 127.0.0.1，请作为本地单用户工具运行。

结构：`src/model.ts` 数据与 WAV 编码、`src/engine.ts` 同步音频引擎、`src/main.tsx` 编辑/录音工作台、`backend/score.py` 安全解析、`backend/audio.py` DSP、`backend/main.py` API 与页面服务、`tests/` 后端及浏览器测试。

实现参考：[MusicXML 时值](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/)、[Web Audio 播放调度](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)、[Audiveris CLI](https://github.com/Audiveris/audiveris/wiki/CLI-Arguments)。

离线字体：随包提供 Noto Sans CJK SC 的应用字符子集，内部名称为 DrumLab SC，依 SIL OFL 1.1 发布；许可证见 `public/fonts/LICENSE.txt`。字体为已生成资源，运行项目不需要安装字体工具。

## 常见问题

- **提示缺少 Python 环境或页面构建**：在项目根目录执行 `py run.py --setup --open`（macOS/Linux 使用 `python3`）。
- **端口被占用**：使用 `--port 8766`；开发模式也需同步修改 `vite.config.ts` 中的 API 代理地址。
- **PDF 导入后没有音符**：没有配置或未能成功运行 Audiveris 时属于预期行为。对照原稿手动补谱，或导入校正后的 MusicXML/MXL。
- **录音无法同步或播放区间超出长度**：填写录音原始 BPM 和首拍偏移，并缩短循环区间。非 WAV/FLAC/OGG 格式还取决于浏览器解码支持。
- **刷新后录音消失**：录音不自动保存，也不随项目 JSON 导出。刷新前单独下载原音和处理结果。
- **设备录音失败**：在 localhost 或 HTTPS 下打开，检查浏览器麦克风权限及系统输入设备。

## 项目目录

```text
src/                 React 页面、数据模型、Web Audio 引擎及单元测试
backend/             FastAPI、MusicXML/MXL 解析和音频处理
samples/             可直接体验的示例鼓谱、PDF、音频及项目
tests/              Python 后端测试和 Playwright 浏览器测试
public/fonts/        离线字体许可证
run.py               跨平台安装和启动入口
VALIDATION.md        已记录的测试结果与未验证范围
```

## 开发与贡献

修改前请先用 `samples/` 复现相关流程；修改后执行与变更相关的测试。报告问题时请附操作系统、Python/Node.js 版本、复现步骤与报错信息；鼓谱或录音样本请仅提交有权分享的内容。

仓库不包含 Python 虚拟环境、Node.js 依赖、测试缓存和个人录音。前端构建可通过 `npm run build` 重新生成。测试结果是 [验证记录](VALIDATION.md) 中所述环境的记录，不代表所有设备均已验证。

## 许可证

本项目目前尚未指定源代码许可证。随附字体使用 SIL Open Font License 1.1，详见 [字体许可证](public/fonts/LICENSE.txt)；第三方依赖遵循各自许可证。
