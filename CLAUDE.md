# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GNOME Shell extension that integrates with the Clockify time tracking REST API, deliberately mimicking the UX of the Hamster time tracker extension (dropdown panel menu, typeahead autocomplete, today's activity list, continue buttons, global keybinding).

The `hamster-shell-extension/` directory is a local reference copy of the upstream Hamster project — it is **not** part of the extension and is git-ignored.

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

- **`ActivityEntry`** (`St.Entry`) — inline typeahead autocomplete. On key-release it prefix-matches the typed text against `_activities[]` (list of description strings) and selects the completed suffix so further typing replaces it. Identical mechanism to Hamster's `OngoingFactEntry`.

- **`TodaysEntriesWidget`** (`St.ScrollView`) — scrollable `Clutter.GridLayout` grid of today's time entries. Each row: time range, description, human duration, optional ▶ continue button. Entries are displayed oldest→newest (reversed from the Clockify API's newest-first order) so the most recent entry is at the bottom — matching Hamster behaviour.

- **`ClockifyIndicator`** (`PanelMenu.Button`) — the panel widget. Contains `ActivityEntry` + `TodaysEntriesWidget` inside a `PopupBaseMenuItem`. Manages all Clockify REST API calls via an async helper `_apiRequest()` using `Soup.Session`. Caches the `userId` to avoid repeated `/user` fetches. Runs a `GLib.timeout_add_seconds(60)` to update elapsed time.

- **`ClockifyExtension`** — `enable()` creates the indicator and registers the `show-clockify-dropdown` keybinding via `Main.wm.addKeybinding()`; `disable()` cleans both up.

### Settings (GSettings schema `org.gnome.shell.extensions.clockify-tracker`)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `api-key` | string | `''` | Clockify API key |
| `workspace-id` | string | `''` | Clockify workspace ID |
| `panel-appearance` | int | `0` | 0=label, 1=icon, 2=icon+label |
| `show-clockify-dropdown` | strv | `['<Super>t']` | Global keybinding |

### Clockify API endpoints used

- `GET /user` — fetch user ID (cached)
- `GET /workspaces/{wid}/user/{uid}/time-entries?in-progress=true` — current running entry
- `GET /workspaces/{wid}/user/{uid}/time-entries?start=<ISO>&page-size=50` — today's entries
- `POST /workspaces/{wid}/time-entries` — start a new timer
- `PATCH /workspaces/{wid}/user/{uid}/time-entries` — stop running timer

### GJS / GNOME Shell constraints

- Imports use `gi://` (e.g. `gi://GLib`) for GObject introspection and `resource:///org/gnome/shell/…` for GNOME Shell internals.
- HTTP via `Soup.Session.send_and_read_async` (libsoup 3). Request bodies use `GLib.Bytes(new TextEncoder().encode(JSON.stringify(body)))`.
- No Node.js modules — this runs in GJS (SpiderMonkey).
- Schema must be compiled (`glib-compile-schemas`) before the extension can load.

## CI/CD

`.gitlab-ci.yml` defines three stages:

1. **lint** — ESLint on `extension.js` and `prefs.js` (advisory, `allow_failure: true`)
2. **build** — `make dist` → artifact `dist/clockify-tracker@smoula.net.zip`
3. **publish** — manual job on `v*` tags, uploads to extensions.gnome.org via `ego-upload`. Requires `EGO_USERNAME` / `EGO_PASSWORD` CI variables.
