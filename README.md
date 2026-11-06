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

- `client/`、`server/`、`shared/`：Paseo 插件及已生成的运行模块。
- `editor/`：编辑器源码快照，不含演示文稿、截图或字体文件。
- `scripts/`：嵌入适配和构建；所有输入均在仓库中。
- `tests/`：备份、冲突、资源读取、路径边界及进程清理检查。

npm 包只包含运行模块、插件清单和使用说明；Git 仓库保留构建源码及锁文件。无需运行时 npm 依赖，Paseo 提供宿主模块。验证范围见 [docs/verification.md](docs/verification.md)。

仅支持符合 HTML PPT 结构的文稿，不导入 PPTX，也不回写 Markdown 或生成脚本。可视化修改直接保存 HTML，重新运行文稿构建程序可能覆盖这些修改。原稿显式引用的外部网络资源仍按原地址加载。
