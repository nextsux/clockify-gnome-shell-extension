# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GNOME Shell extension that integrates with the Clockify time tracking REST API, deliberately mimicking the UX of the Hamster time tracker extension (dropdown panel menu, typeahead autocomplete with `@project` syntax, today's activity list, continue buttons, global keybinding).

## Development Commands

```bash
# Compile GSettings schema (required after any schema changes)
make compile

# Install + launch a nested GNOME Shell session (no logout needed, works on Wayland)
make run

# Install for the current user only (without launching)
make install-user

# Stream extension-specific log lines
make logs

# Create distributable zip for extensions.gnome.org
make dist          # → dist/clockify-tracker@smoula.net.zip
```

### Iterating without restarting your session

`make run` installs the extension and opens a **nested GNOME Shell** window
(`dbus-run-session -- gnome-shell --nested --wayland`). The nested shell is a
fully isolated Wayland compositor running inside your current session — no
logout required. Close its window to exit.

Workflow:
1. Edit source files
2. `make run` — installs + opens nested shell
3. Test inside the nested window
4. Close the window, edit again, repeat

## Architecture

All extension logic lives in three files:

| File | Purpose |
|---|---|
| `extension.js` | Main extension — panel indicator, dropdown, API calls |
| `prefs.js` | Preferences page (API key, workspace, keybinding, appearance) |
| `stylesheet.css` | CSS for the dropdown layout |

### extension.js — class breakdown

- **`ActivityEntry`** (`St.Entry`) — two-zone inline typeahead autocomplete (mirrors Hamster's `OngoingFactEntry`). Input format: `description @project`. On key-release: if the text contains `@`, prefix-matches project names from `_projects[]`; otherwise prefix-matches full history strings from `_activities[]`. The completed suffix is selected so further typing replaces it.

- **`TodaysEntriesWidget`** (`St.ScrollView`) — scrollable `Clutter.GridLayout` grid of today's time entries. Each row: time range, `description @project`, human duration, optional ▶ continue button. Entries are displayed oldest→newest (reversed from the Clockify API's newest-first order) so the most recent entry is at the bottom — matching Hamster behaviour.

- **`ClockifyIndicator`** (`PanelMenu.Button`) — the panel widget. Contains `ActivityEntry` + `TodaysEntriesWidget` inside a `PopupBaseMenuItem`. Manages all Clockify REST API calls via an async helper `_apiRequest()` using `Soup.Session`. Caches `userId` and the full `_projects[]` list. Runs a `GLib.timeout_add_seconds(60)` to update elapsed time. Resets all cached state when `api-key` or `workspace-id` settings change.

- **`ClockifyExtension`** — `enable()` creates the indicator and registers the `show-clockify-dropdown` keybinding via `Main.wm.addKeybinding()`; `disable()` cleans both up.

### Settings (GSettings schema `org.gnome.shell.extensions.clockify-tracker`)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `api-key` | string | `''` | Clockify API key |
| `workspace-id` | string | `''` | Clockify workspace ID |
| `panel-appearance` | int | `0` | 0=label, 1=icon, 2=icon+label |
| `show-clockify-dropdown` | strv | `['<Super>t']` | Global keybinding |

### Clockify API endpoints used

- `GET /user` — fetch user ID (cached, reset on api-key change)
- `GET /workspaces/{wid}/projects?page-size=500&archived=false` — all projects (cached in memory, no expiry)
- `GET /workspaces/{wid}/user/{uid}/time-entries?in-progress=true` — current running entry
- `GET /workspaces/{wid}/user/{uid}/time-entries?start=<ISO>&page-size=50` — today's entries (display)
- `GET /workspaces/{wid}/user/{uid}/time-entries?start=<7-days-ago>&page-size=100` — recent entries (autocomplete)
- `POST /workspaces/{wid}/time-entries` — start a new timer
- `PATCH /workspaces/{wid}/user/{uid}/time-entries` — stop running timer

### GJS / GNOME Shell constraints

- Imports use `gi://` (e.g. `gi://GLib`) for GObject introspection and `resource:///org/gnome/shell/…` for GNOME Shell internals.
- HTTP via `Soup.Session.send_and_read_async` (libsoup 3). Request bodies use `GLib.Bytes(new TextEncoder().encode(JSON.stringify(body)))`.
- No Node.js modules — this runs in GJS (SpiderMonkey).
- Schema must be compiled (`glib-compile-schemas`) before the extension can load.

## CI/CD

`.gitlab-ci.yml` defines three stages:

1. **lint** — ESLint 9 (flat config in `eslint.config.js`) on `extension.js` and `prefs.js`
2. **build** — `make dist` → artifact `dist/clockify-tracker@smoula.net.zip`
3. **publish** — manual job on `v\d+` tags, uploads to extensions.gnome.org via `ego-upload`. Requires `EGO_USERNAME` / `EGO_PASSWORD` CI variables.
