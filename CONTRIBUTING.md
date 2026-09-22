# 参与开发

需要 Node.js 22+、npm 和 Git。使用 `npm ci` 安装锁定依赖，`npm run dev:desktop` 启动桌面应用。

提交前执行 `npm test`、`npm run build` 和 `npm run release:source`。最后一个命令会检查对外源码并生成 `release/source/`，不上传或发布。修改 Next.js 时先阅读本地 `node_modules/next/dist/docs/` 中对应指南。

项目使用 Electron 原生终端模块，请在目标操作系统和 CPU 架构上安装依赖与打包；不复用其他平台的 node_modules。Linux 如缺少原生预构建，需要 Python、make 和 C++ 编译器；Windows 本地编译需要 Python 与 Visual Studio C++ Build Tools。跨平台 CI 检查不等于桌面实机验收。

Issue 与 PR 请描述具体行为、复现步骤、系统与架构、已执行验证。截图、日志与环境清单应先移除个人路径、项目内容、内部域名和凭据。不要提交真实记忆数据、扫描输入、Agent 会话或个人报告。

DevHaven 用户可以使用项目 Skill 记录开发改动。未安装 DevHaven 的贡献者正常提交代码与 PR 即可，不需要额外创建本地记忆文件。

## 品牌资源

`public/logo.png` 是透明背景的品牌主图。`npm run build:web` 会通过 `scripts/generate-icons.mjs` 生成界面及网页使用的 `public/icon.png`、macOS/Linux 打包使用的 `build/icon.png` 和 Windows 的 `build/icon.ico`。界面侧栏与启动页共用 `BrandLogo`，README 引用品牌主图；更新品牌时修改主图并重新构建。
