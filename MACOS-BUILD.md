# macOS 构建

需要 macOS、Node.js 22 或更高版本，以及 Xcode Command Line Tools。依赖锁文件随源码提供。

```sh
npm ci
npm test
npm run dist:mac
codesign --verify --deep --strict release/mac-arm64/DevHaven.app
```

`dist:mac` 在 Apple Silicon 主机上生成 arm64 的应用、DMG 和 ZIP，采用 ad-hoc 临时签名。未配置 Developer ID 和 Apple 公证；早期 Beta 会以未公证状态发布并明确提示，稳定分发前应由发布者配置 Developer ID、公证及安装验收。

Intel Mac 请在 Intel 主机安装依赖并执行 `npm run dist -- --mac --x64`。原生终端模块与构建主机的系统和架构绑定，构建流程会拒绝不匹配的目标。不要把另一平台的 `node_modules` 或 `dist-electron` 复制过来打包。

应用目录位于 `release/mac-arm64/DevHaven.app`（Intel 为 `release/mac/DevHaven.app`），可复制到系统 Applications 目录。分发文件名包含版本与架构，以 `release/` 的实际产物为准。升级前应结束正在执行的任务并退出旧应用。

可选的桌面交互验收：

```sh
node scripts/macos-smoke.mjs --packaged
```

此命令会启动应用并测试终端，使用前请阅读脚本及其用户目录影响。它不是普通单元测试的一部分。macOS 实机通过不代表 Windows、Linux 或另一 CPU 架构已通过验收。

Electron 下载需要网络。如果使用代理或镜像，请在自己的构建环境配置，不要将个人网络地址或凭据提交到源码。
