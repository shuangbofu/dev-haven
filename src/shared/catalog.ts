export const catalog = [
  { id: 'node', name: 'Node.js', mark: 'JS', color: '#5b914a', category: '运行时', backend: 'node', description: '构建你的下一个 Web 应用', detail: 'JavaScript 运行时，包含 npm。为 Yarn、pnpm 和 Electron 提供基础环境。', command: 'node', versionArgs: ['--version'], repl: ['node'], website: 'https://nodejs.org' },
  { id: 'python', name: 'Python', mark: 'Py', color: '#377ab1', category: '语言', backend: 'python', description: '从自动化脚本到人工智能', detail: '独立 Python 解释器。项目依赖建议使用 venv 与锁文件管理。', command: 'python', versionArgs: ['--version'], repl: ['python'], website: 'https://python.org' },
  { id: 'java', name: 'Java JDK', mark: 'Jv', color: '#d27d48', category: '语言', backend: 'java', description: 'Temurin JDK · 编译、调试与运行', detail: '完整 Temurin JDK，包含 java、javac 和 jar。启动环境时同步配置 JAVA_HOME。', command: 'java', versionArgs: ['-version'], repl: ['jshell'], website: 'https://adoptium.net' },
  { id: 'go', name: 'Go', mark: 'Go', color: '#2199af', category: '语言', backend: 'go', description: '简洁高效，让并发更轻松', detail: 'Go SDK。可在已配置的终端中运行 go run、go test 和 go mod。', command: 'go', versionArgs: ['version'], repl: null, website: 'https://go.dev' },
  { id: 'rust', name: 'Rust', mark: 'Rs', color: '#a0684b', category: '语言', backend: 'rust', description: '性能与可靠性，兼而得之', detail: 'Rust 工具链，包含 rustc 与 Cargo。部分项目需要系统 C/C++ 编译工具。', command: 'rustc', versionArgs: ['--version'], repl: null, website: 'https://rust-lang.org' },
  { id: 'maven', name: 'Maven', mark: 'Mv', color: '#a95480', category: '构建工具', backend: 'aqua:apache/maven', description: '让 Java 项目构建井然有序', detail: 'Apache Maven 构建工具。运行前请安装并设置默认 Java 版本。', command: 'mvn', versionArgs: ['--version'], repl: null, requires: 'java', website: 'https://maven.apache.org' },
  { id: 'yarn', name: 'Yarn', mark: 'Yn', color: '#318fb9', category: '包管理器', backend: 'npm:@yarnpkg/cli-dist', description: '现代 JavaScript 包管理', detail: 'Yarn Modern 独立 CLI。安装前请先准备受管 Node.js 环境。', command: 'yarn', versionArgs: ['--version'], repl: null, requires: 'node', website: 'https://yarnpkg.com' },
  { id: 'pnpm', name: 'pnpm', mark: 'pn', color: '#bd9028', category: '包管理器', backend: 'npm:pnpm', description: '快速、节省磁盘空间', detail: '适用于单仓库和多包项目的包管理器。需要受管 Node.js 环境。', command: 'pnpm', versionArgs: ['--version'], repl: null, requires: 'node', website: 'https://pnpm.io' },
  { id: 'electron', name: 'Electron', mark: 'El', color: '#5e8c96', category: '框架', backend: 'npm:electron', description: '用 Web 技术创造桌面体验', detail: '用于运行和测试的 Electron CLI。项目内的 Electron 依赖仍由项目锁文件管理。需要桌面系统图形库。', command: 'electron', versionArgs: ['--version'], repl: null, requires: 'node', website: 'https://electronjs.org' },
  { id: 'gradle', name: 'Gradle', mark: 'G', color: '#02303a', category: '构建工具', backend: 'aqua:gradle/gradle-distributions', description: 'Java / Kotlin 构建工具', detail: '需要默认 Java 环境。已有 gradlew 的项目可直接使用项目自带的 Gradle Wrapper。', command: 'gradle', versionArgs: ['--version'], repl: null, requires: 'java', website: 'https://gradle.org' },
  { id: 'uv', name: 'uv', mark: 'uv', color: '#de5fe9', category: '包管理器', backend: 'aqua:astral-sh/uv', description: 'Python 项目与依赖管理', detail: '独立安装的 Python 包和项目管理器。可使用 DevHaven 已安装的 Python。', command: 'uv', versionArgs: ['--version'], repl: null, website: 'https://docs.astral.sh/uv' },
] as const;
export type ToolId = typeof catalog[number]['id'];
export type Tool = typeof catalog[number];
export const toolById = (id: string): Tool => {
  const tool = catalog.find(t => t.id === id);
  if (!tool) throw new Error('不支持的工具');
  return tool;
};

export const companions: Partial<Record<ToolId, { bundled: { name: string; purpose: string; command: string }[]; optional: ToolId[]; note?: string }>> = {
  node: { bundled: [{ name: 'npm', purpose: '包管理器', command: 'npm --version' }, { name: 'npx', purpose: '运行项目工具', command: 'npx --version' }], optional: ['pnpm', 'yarn', 'electron'] },
  python: { bundled: [{ name: 'pip', purpose: '包管理器', command: 'python -m pip --version' }, { name: 'venv', purpose: '虚拟环境', command: 'python -m venv --help' }], optional: ['uv'], note: 'pip 缺失时运行 python -m ensurepip --upgrade。Poetry、PDM 等项目工具也可通过 uv tool install 安装。' },
  java: { bundled: [{ name: 'javac', purpose: 'Java 编译器', command: 'javac -version' }, { name: 'jar', purpose: '打包工具', command: 'jar --version' }, { name: 'JShell', purpose: '交互终端（JDK 9+）', command: 'jshell --version' }], optional: ['maven', 'gradle'], note: 'Maven 与 Gradle 按项目选用；已有 mvnw / gradlew 的项目可用自带 Wrapper。' },
  go: { bundled: [{ name: 'go mod', purpose: '模块与依赖管理', command: 'go help mod' }, { name: 'go build', purpose: '编译构建', command: 'go help build' }, { name: 'go test', purpose: '测试', command: 'go help test' }], optional: [] },
  rust: { bundled: [{ name: 'Cargo', purpose: '包管理与构建', command: 'cargo --version' }, { name: 'rustc', purpose: 'Rust 编译器', command: 'rustc --version' }], optional: [], note: '本机链接器需另外准备：Windows MSVC 工具链使用 Visual Studio Build Tools 的 C++ 工作负载；macOS 使用 Xcode Command Line Tools；Linux 使用发行版 C/C++ 构建工具。' },
  electron: { bundled: [], optional: ['node', 'pnpm', 'yarn'], note: '项目中的 electron、electron-builder / Forge 依赖由项目 package.json 管理。' },
};
