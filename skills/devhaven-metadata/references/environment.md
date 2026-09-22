# Environment preparation: available capabilities and boundary

DevHaven's application can prepare its managed mise engine, detect system tools, list supported tool versions, install/uninstall managed versions, switch defaults, import/export an environment manifest and open an environment terminal. Installation is asynchronous; the application task must finish successfully and the installed version must be present before claiming readiness. A queued request is not a completed install.

The external `devhaven-memory.cjs` client currently exposes **`context`, `search`, `search-status`, `mcp`, `record`, and `icon`**. It does not return an environment snapshot and has no `install`, `prepare`, `exec`, `env`, `set-default` or environment-task query command. `DesktopAPI` environment methods in source code are renderer/Electron interfaces, not a public API for Codex or Claude. Do not instantiate the application service from another process, edit its state/config, or invoke a guessed managed mise path to simulate an API.

## What an external coding agent can do today

1. Inspect the actual project's manifests, lockfiles, scripts and declared runtime constraints to determine the required tool and version. `metadata.languages` describes technologies, not runtime versions. `metadata.launch` describes a command and preview URL, not an environment installer.
2. Check the available tool version in the agent's current shell when needed. Do not assume that the application's default version is active in this already-running process.
3. If a runtime is missing or incompatible, tell the user the concrete requirement and the available **环境 → 安装工具** entry point. Default-version selection and **设置 → 全局终端环境** are application operations. There is no external environment request to queue through this Skill yet. An independently authorized shell installation is a separate workflow; do not label it DevHaven-managed setup.
4. Once the required runtime is available, run the project's own verified dependency/bootstrap commands in its directory as part of the coding task, respecting the task's authorization. DevHaven does not automatically install project dependencies, databases, containers, credentials or external services.
5. Record actual project changes and verified validation through the central client. If launch scripts/arguments/cwd/preview URL changed, preserve and update the full launch metadata. No platform record is needed merely for discovering a preexisting environment.

## Default-version scope

Without global terminal integration, managed defaults apply to DevHaven's built-in terminal. When enabled in settings, the application configures the current user's supported terminal environment using platform-aware shell configuration on macOS/Linux or user environment variables on Windows. Project mise configuration can override global defaults. Existing terminals and IDE/agent processes may need to be restarted to inherit changes. Finder-launched GUI application environments are not automatically rewritten.

Never prescribe a personal shell file, username, drive, PATH separator or installation directory. Do not assume zsh on every OS. Use the application's detected platform/Shell status for supported integration; an unsupported Shell does not gain integration because the Skill mentions it.

## Missing external integration

Fully agent-driven preparation still requires a public request/status interface for environment discovery, version resolution, installation, scoped execution and default changes. It must expose task IDs, results/logs and the environment to apply to the intended process. Until that interface exists and is documented, this Skill supports metadata/change management but cannot make DevHaven prepare an environment solely through its client.
