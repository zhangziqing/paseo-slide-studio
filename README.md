# Slide Studio for Paseo

在 Paseo 工作区标签页或 HTML 文件标签页中直接编辑 HTML 幻灯片。支持文字和图示编辑、撤销重做、布局检查、保存备份及版本冲突提示。文件、相对图片、字体和 CSS 使用当前 Paseo 连接传输，远程工作区无需为编辑器另设端口转发。

需要 Paseo daemon 与客户端 0.15.0+，主机上安装 Python 3.10+。编辑画布面向桌面版和网页版；原生 iOS/Android 客户端暂不支持。已在 Paseo 网页客户端验证，Electron 二进制与实体手机尚未实测。

## 安装

在主机上解压源码压缩包，或克隆仓库，进入包含 `paseo-plugin.json` 的目录后运行：

```bash
paseo plugin install .
paseo plugin ls slide-studio
```

仓库提交了完整运行模块，安装时不需要 npm 构建或其他项目的源码。使用分发的 npm 安装包时，先解压并安装其中的 `package` 目录：

```bash
mkdir slide-studio-package
tar -xzf slide-studio-0.2.0.tgz -C slide-studio-package
paseo plugin install ./slide-studio-package/package
```

Paseo 插件总开关需已开启。更新本地源码后运行 `paseo plugin reload slide-studio`。

## 使用

在工作区命令面板选择“打开幻灯片编辑器”，或提交 `/slides`，然后浏览并选择 HTML PPT 或 `.html-ppt.json`。也可先打开 HTML 文件，再右键文件标签页，选择 **Open with… → 幻灯片编辑器**。

在画布中点选对象、双击编辑文字，按 Ctrl / ⌘ S 保存。文稿须包含 `.slide` 页面，例如 `talk/presentation.html`。保存前会在工作区 `.ppt-backups/` 中备份原文件；遇到外部修改时拒绝覆盖，可先下载当前项目保留编辑内容。

Settings → Plugins → Slide Studio 可配置主机上的 Python 可执行文件，默认为 `python3`。Python 文件进程使用标准输入输出，不监听 HTTP 端口。客户端 IndexedDB 保存草稿，重新打开同一文件可恢复；未保存的标签页有关闭确认。

## 生成 HTML PPT 的 skill

仓库另附 [html-from-layouts](skills/html-from-layouts/SKILL.md)，支持 Markdown 大纲、标记空缺补全、单文件离线 HTML 生成，以及浏览器布局检查、截图和 PDF 导出。生成的 HTML 可直接在 Slide Studio 中编辑。

skill 不随 Paseo 插件自动安装。使用 Codex 时，可在仓库根目录将它复制到自己的 skills 目录；已有同名 skill 时应先比较内容，避免覆盖：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R -i skills/html-from-layouts "${CODEX_HOME:-$HOME/.codex}/skills/"
```

在 agent 中调用 `$html-from-layouts`。Python 依赖见 skill 的 `requirements.txt`；浏览器检查需要 Chrome/Chromium。skill 不包含 PPT 模板、背景图、Logo、字体文件或个人字体路径，生成时必须通过 `--theme` 指定使用者的主题，并配置字体。可从自己的 PPTX/POTX 提取主题，步骤见 [模板与字体配置](skills/html-from-layouts/references/template-fidelity.md)。

编辑器保存的 HTML 修改不会回写到大纲；重新生成可能覆盖这些修改。该 skill 使用自己的 HTML 结构约定，不代表任意网页 PPT 都能兼容。

## 开发与打包

开发环境使用 Node.js 24+ 和 Python 3.10+：

```bash
npm ci
npm run prepare:editor
npm run check
mkdir -p dist
npm pack --pack-destination dist
```

`npm run check` 检查生成文件、TypeScript 类型，并运行真实 Python 文件读写集成测试。测试在系统临时目录中生成文稿，无需开放端口。

安装 skill 的 Python 依赖后，可单独运行生成流程测试；测试会创建临时主题，不需要自带 PPT 模板：

```bash
python3 -m unittest discover -s skills/html-from-layouts/scripts -p 'test_*.py'
```

- `client/`、`server/`、`shared/`：Paseo 插件及已生成的运行模块。
- `editor/`：编辑器源码快照，不含演示文稿、截图或字体文件。
- `scripts/`：嵌入适配和构建；所有输入均在仓库中。
- `tests/`：备份、冲突、资源读取、路径边界及进程清理检查。
- `skills/html-from-layouts/`：独立的 HTML PPT 生成 skill，不含演示模板。

npm 包只包含运行模块、插件清单和使用说明；Git 仓库保留构建源码及锁文件。无需运行时 npm 依赖，Paseo 提供宿主模块。验证范围见 [docs/verification.md](docs/verification.md)。

仅支持符合 HTML PPT 结构的文稿，不导入 PPTX，也不回写 Markdown 或生成脚本。可视化修改直接保存 HTML，重新运行文稿构建程序可能覆盖这些修改。原稿显式引用的外部网络资源仍按原地址加载。
