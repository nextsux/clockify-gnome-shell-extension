# Clockify Time Tracker — GNOME Shell Extension

> **Vibe-coded experiment.** This extension was built entirely with [Claude Code](https://claude.ai/code) as a personal experiment. It covers my own needs. You're welcome to use it or fork it, but **no support is provided and nothing is guaranteed.** I fix things when they bother me personally.

A GNOME Shell panel extension for [Clockify](https://clockify.me) that deliberately mimics the UX of the [Hamster time tracker](https://github.com/projecthamster/hamster-shell-extension): dropdown menu, inline typeahead autocomplete, today's activity list with one-click continue, and a global keybinding.

## Features

- **Panel indicator** — shows the running task name and elapsed time, or *No activity*
- **Global keybinding** — `Super+t` (configurable) opens the dropdown from anywhere
- **Typeahead autocomplete** — start typing and the entry completes inline from your recent tasks; keep typing to refine
- **`@project` syntax** — type `task @projectname` to assign or auto-create a project
- **Today's activity list** — every entry for today shown chronologically with time range and duration
- **Continue (▶)** — one click restarts any past task as a new Clockify entry
- **Stop Tracking** — stops the current running timer
- **Preferences** — API key, workspace selector, panel appearance (label / icon / both), keybinding
- **Translations** — cs, de, fr, es, it, pl, pt_BR, ru, nl, tr, ja, zh_CN

## Requirements

- GNOME Shell 45–50
- A [Clockify](https://clockify.me) account (free tier works)

## Installation

```bash
git clone https://github.com/nextsux/clockify-gnome-shell-extension.git
cd clockify-gnome-shell-extension
make install-user
gnome-extensions enable clockify-tracker@smoula.net
```

Then log out and back in (Wayland) or press `Alt+F2` → `r` (X11) to reload GNOME Shell.

## Configuration

Open **Extension Settings** from the dropdown or via the GNOME Extensions app:

1. **API Key** — copy from [clockify.me](https://clockify.me) → avatar → *Profile Settings* → *API* → *Generate*
2. **Workspace** — select from the dropdown (populated automatically once the API key is set)

## Usage

| Action | How |
|---|---|
| Open / close dropdown | `Super+t` or click the panel indicator |
| Start a new timer | Type description → `Enter` |
| Assign / create a project | Include `@projectname` in the description |
| Autocomplete | Start typing — entry completes inline; keep typing to refine |
| Continue a past task | Click ▶ on any row in today's list |
| Stop current timer | Click **Stop Tracking** |
| Open settings | Click **Extension Settings** |

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
make install-user  # install to ~/.local/share/gnome-shell/extensions/
make run           # install + launch a nested GNOME Shell session (no logout needed)
make logs          # stream Clockify-related log lines from journalctl
make mo            # compile all PO translation files to MO binaries
make dist          # build distributable zip → dist/clockify-tracker@smoula.net.zip
make clean         # remove build artefacts
```

### Iterating without restarting your session

`make run` installs the extension and opens a **nested GNOME Shell** window inside your current session. No logout required.

**Workflow:**
1. Edit source files
2. `make run` — opens a fresh nested shell with your changes loaded
3. Test inside the nested window
4. Close the window, edit, repeat

Watch logs in a separate terminal:
```bash
make logs
```

### Linting

```bash
npm install
npx eslint extension.js prefs.js
```

## CI/CD

Both GitHub Actions (`.github/workflows/ci.yml`) and GitLab CI (`.gitlab-ci.yml`) run on every push:

| Stage | Job | What it does |
|---|---|---|
| lint | ESLint | ESLint on `extension.js` and `prefs.js` |
| build | Build package | `make dist` → zip artifact (kept forever) |
| publish | Publish to e.g.o | Upload to extensions.gnome.org *(on `vN` tags)* |

To publish a release:
```bash
git tag v3
git push origin v3        # GitLab: then trigger publish:ego manually
git push upstream v3      # GitHub: publish job runs automatically on tag push
```

Requires `EGO_USERNAME` and `EGO_PASSWORD` secrets/variables set in both GitLab CI and GitHub Actions (environment: `extensions.gnome.org`).
