# Local technology icons

Run the discovered client’s `context` command first. `iconsDirectory` follows the configured memory directory on every OS; `icons` lists installed names, aliases, relative asset files and verified source URLs. The application reads these local assets offline. Do not write the index or application source code directly.

For an actual language, framework, engine or tool found in the project:

1. Compare its name with catalog names and aliases, ignoring case. Reuse matches. Do not invent technology metadata merely to obtain an icon.
2. If missing, search the web and inspect the technology’s official brand page/repository or a reputable open-source icon library (for example Simple Icons or Devicon). Verify the icon matches the actual technology. Respect the asset’s published usage terms and retain its source URL.
3. Download the verified SVG or PNG to a temporary file using the agent’s available tools. Use a direct HTTPS asset address. Do not use screenshots, HTML pages, guessed URLs, executable downloads, tracking URLs, credentials or unrelated favicons.
4. Prefer a self-contained SVG with paths and shapes. No scripts, HTML, external references, event handlers or embedded remote images. If the SVG needs unsupported features, use an official PNG asset instead. Maximum 512 KB; PNG dimensions up to 4096 × 4096.
5. Register through the client, preserving a stable UUID for retries:

```sh
node "<client-file>" icon --name "Apache Flink" --aliases "Flink" --file "<temporary-logo.svg>" --source "<verified-direct-https-asset-url>" --id "<uuid>"
```

`--aliases` is optional and comma-separated. `--name` must match the metadata technology name, or the metadata name must be one of its aliases. Never rename an unrelated existing icon to make a match.

6. Check `receipts/<id>.json.status` for `accepted: true`. The client queues the asset; the running app validates it, stores a content-addressed file in `icons/`, updates `icons/index.json` and refreshes the UI. Icon registration creates no work/change event. If the app is closed, leave it queued; do not edit `state.json` or the index as a fallback.

If no trustworthy icon is available or downloading fails, preserve the technology’s text label and report the missing icon. A missing logo must not block project registration. A later scan can retry. The app’s staged icon lookup mode returns only verified URLs; the app itself performs downloading and registration.
