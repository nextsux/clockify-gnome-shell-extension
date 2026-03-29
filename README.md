# Clockify Time Tracker — GNOME Shell Extension

A GNOME Shell panel extension for [Clockify](https://clockify.me) that deliberately mimics the UX of the [Hamster time tracker](https://github.com/projecthamster/hamster-shell-extension): dropdown menu, inline typeahead autocomplete, today's activity list with one-click restart, and a global keybinding.

## Features

- **Panel indicator** — shows the running task name and elapsed time (`HH:MM`) or *No activity*
- **Global keybinding** — `Super+t` (configurable) opens the dropdown from anywhere
- **Typeahead autocomplete** — start typing and the entry completes inline from your last 7 days of tasks; keep typing to refine
- **Today's activity list** — every entry for today shown chronologically with time range and duration
- **Continue button (▶)** — one click restarts any past task as a new Clockify entry
- **Stop Tracking** — stops the current running timer
- **Preferences** — API key, workspace ID, panel appearance (label / icon / both), keybinding

## Requirements

- GNOME Shell 45–49
- A [Clockify](https://clockify.me) account (free tier works)

## Installation

### From source

```bash
git clone https://gitlab.smoula.net/nexus/clockify-gnome-shell-extension.git
cd clockify-gnome-shell-extension
make install-user
gnome-extensions enable clockify-tracker@smoula.net
```

Then either log out and back in (Wayland) or press `Alt+F2` → `r` (X11) to reload GNOME Shell.

### From extensions.gnome.org

*(Not yet published — see CI/CD section below)*

## Configuration

Open **Extension Settings** from the dropdown menu (or via GNOME Extensions app):

1. **API Key** — copy from [clockify.me](https://clockify.me) → top-right avatar → *Profile Settings* → *API* → *Generate*
2. **Workspace ID** — visible in the URL when you're on your workspace: `app.clockify.me/tracker` → the ID in the URL, or use the Clockify API: `curl -H "X-Api-Key: <key>" https://api.clockify.me/api/v1/workspaces`

## Usage

| Action | How |
|---|---|
| Open / close dropdown | `Super+t` (or click panel indicator) |
| Start a new timer | Type description → `Enter` |
| Autocomplete | Start typing — entry completes inline; keep typing to refine |
| Continue a past task | Click ▶ on any row in today's list |
| Stop current timer | Click **Stop Tracking** in the dropdown |
| Open settings | Click **Extension Settings** in the dropdown |

## Development

### Prerequisites

```bash
# Arch / Manjaro
sudo pacman -S glib2 zip

# Fedora
sudo dnf install glib2-devel zip

# Ubuntu / Debian
sudo apt install libglib2.0-bin zip
```

### Makefile targets

```bash
make compile       # compile GSettings schema (required after schema changes)
make install-user  # install extension to ~/.local/share/gnome-shell/extensions/
make run           # install + enable + launch nested GNOME Shell (no logout needed)
make logs          # stream Clockify-related log lines from journalctl
make dist          # build distributable zip → dist/clockify-tracker@smoula.net.zip
make clean         # remove build artefacts
```

### Iterating without restarting your session

```bash
make run
```

This installs the extension, enables it in your gsettings, then opens a **nested GNOME Shell** window inside your current session (`dbus-run-session -- gnome-shell --nested --wayland`). No logout required on either X11 or Wayland.

**Workflow:**
1. Edit source files
2. `make run` — opens a fresh nested shell with your changes loaded
3. Test inside the nested window
4. Close the window, edit, repeat

Watch logs in a separate terminal while testing:
```bash
make logs
```

### Linting

```bash
npm install
npx eslint extension.js prefs.js
```

## CI/CD

The GitLab pipeline (`.gitlab-ci.yml`) runs on every push:

| Stage | Job | What it does |
|---|---|---|
| lint | `lint:eslint` | ESLint on `extension.js` and `prefs.js` |
| build | `build:package` | `make dist` → zip artifact |
| publish | `publish:ego` | Upload to extensions.gnome.org *(manual, on `vN` tags)* |

To publish a new version, tag the commit with an integer version tag:
```bash
git tag v2
git push origin v2
```
Then trigger the `publish:ego` job manually in GitLab CI. Requires `EGO_USERNAME` and `EGO_PASSWORD` CI variables set in the project settings.
