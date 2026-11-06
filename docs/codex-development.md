# Codex development loops

This guide is the canonical workflow for developing text-to-cad (including Unified CAD + Vector Studio) from Codex Desktop, the Codex CLI, or a managed Codex cloud workspace.

## Two loops

### 1. Browser Viewer (hot reload)

Use the Vite source Viewer for interactive CAD + Vector Studio work. Changes under `apps/web` hot-reload.

```bash
scripts/dev/vector-studio.sh
```

This builds shared packages (`npm run build:packages`) and starts Vite with the checkout Python and a stable project directory. Open the reported URL — normally `http://127.0.0.1:5173/`.

In the UI you can switch CAD ↔ Vector Studio, import SVG or self-contained GLB, edit, undo/redo, save/load JSON, and export composed SVG while confirming the CAD document and view remain intact.

### 2. Embedded Codex plugin (snapshot)

The development plugin installed by `scripts/install/dev_install.py codex` is a **built snapshot**. It has **no hot reload**. Running MCP sessions and mounted frames cannot safely hot-swap.

When embedded plugin/app inputs change, refresh deliberately:

```bash
scripts/dev/refresh_codex_plugin.py --check   # report whether a refresh is needed
scripts/dev/refresh_codex_plugin.py           # rebuild/reinstall only when inputs changed
scripts/dev/refresh_codex_plugin.py --force   # rebuild/reinstall even if unchanged
scripts/dev/refresh_codex_plugin.py --restart # optional: restart the Codex app after install
```

The refresh command fingerprints only inputs consumed by the Codex plugin/app, stores a stamp under ignored `tmp/codex-dev`, skips unchanged builds, and delegates installation to `scripts/install/dev_install.py`. There is **no automatic watcher**: watching cannot replace running MCP processes or mounted frames and can interrupt active CAD engines.

After a Python server change, restart the engine/app as usual. After any plugin refresh that should appear in chat, **open a fresh Codex chat** — existing frames keep the code they started with.

## Managed cloud vs local browser

- **Local Codex checkout:** the Vite loopback URL can be opened directly in a normal browser (and in Codex’s built-in browser when that capability is available).
- **Managed cloud workspace:** `127.0.0.1` belongs to the remote worker. Reach it through the shared remote browser or a supported port-preview tool. Do not assume this chat always exposes `open_in_codex` / port preview.

## Vector Studio inside the embedded app

Vector Studio currently ships in `apps/web`. The embedded MCP app gains a Vector workspace only after the completion-plan Task that extracts the reusable Vector surface into `@cad/ui` and adds `VectorView` to `apps/mcp`. Until then:

- Test Vector Studio in the browser Viewer loop.
- Test CAD in both browser Viewer and the embedded Codex CAD view.

## Related commands

| Command | Purpose |
| --- | --- |
| `scripts/dev/vector-studio.sh` | Build packages + start Vite Viewer |
| `scripts/dev/refresh_codex_plugin.py` | Change-aware Codex plugin refresh |
| `scripts/install/dev_install.py codex` | Direct development plugin install |
| `scripts/install/dev_install.py codex --restart` | Install and restart the Codex app |

See also CONTRIBUTING.md (“Test In Agent Apps”, “Viewer Development In This Repo”) and `scripts/README.md`.
