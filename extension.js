/* extension.js
 *
 * Clockify Time Tracker for GNOME Shell
 * Mimics the Hamster time tracker extension UX
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Translations — wired to the real gettext domain in ClockifyExtension.enable()
// so all _() calls in methods always use the correct locale.
let _ = str => str;

const CLOCKIFY_API_URL = 'https://api.clockify.me/api/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationHuman(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h === 0 && m === 0) return _('Just started');
    return `${h > 0 ? h + _('h ') : ''}${m > 0 ? m + _('min') : ''}`.trim();
}

function elapsedSeconds(isoStart) {
    return Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
}


// ─── ActivityEntry ────────────────────────────────────────────────────────────
//
// St.Entry with two-zone inline typeahead autocomplete (mirrors OngoingFactEntry
// from Hamster).  Input format:  "description @project"
//
//  • Before @ → prefix-match full history strings from _getActivities()
//  • After  @ → prefix-match project names from _getProjects(), keeping the
//               text before @ intact
//
// The completed suffix is selected so further typing replaces it.

const ActivityEntry = GObject.registerClass(
class ActivityEntry extends St.Entry {
    _init(getActivities, getProjects) {
        super._init({
            name: 'searchEntry',
            can_focus: true,
            track_hover: true,
            hint_text: _('activity @project\u2026'),
            style_class: 'search-entry',
        });
        this._getActivities = getActivities;
        this._getProjects   = getProjects;
        this._prevText      = '';
        this.clutter_text.connect('key-release-event', this._onKeyRelease.bind(this));
    }

    reset() {
        this.set_text('');
        this._prevText = '';
    }

    _complete(text, completed) {
        this.set_text(completed);
        this.get_clutter_text().set_selection(text.length, completed.length);
        this._prevText = completed.toLowerCase();
    }

    _onKeyRelease(_actor, evt) {
        const symbol = evt.get_key_symbol();
        const ignored = [
            Clutter.KEY_BackSpace, Clutter.KEY_Delete,  Clutter.KEY_Escape,
            Clutter.KEY_Return,    Clutter.KEY_KP_Enter, Clutter.KEY_Tab,
            Clutter.KEY_Up,        Clutter.KEY_Down,
        ];
        if (ignored.includes(symbol)) return;

        const text = this.get_text();
        if (!text) return;
        if (text.toLowerCase() === this._prevText) return;
        if (this.clutter_text.get_selection()) return;

        this._prevText = text.toLowerCase();

        const atIdx = text.lastIndexOf('@');

        if (atIdx !== -1) {
            // Zone 2 — after @: complete project names
            const prefix  = text.slice(0, atIdx + 1);   // everything up to and including @
            const partial  = text.slice(atIdx + 1).toLowerCase();
            for (const p of this._getProjects()) {
                if (p.name.toLowerCase().startsWith(partial)) {
                    this._complete(text, prefix + p.name);
                    return;
                }
            }
        } else {
            // Zone 1 — no @: complete full history strings
            for (const activity of this._getActivities()) {
                if (activity.toLowerCase().startsWith(text.toLowerCase())) {
                    this._complete(text, activity);
                    return;
                }
            }
        }
    }
});

// ─── TodaysEntriesWidget ──────────────────────────────────────────────────────
//
// Scrollable grid of today's time entries.  Each row shows the time range,
// description, human duration, and a ▶ continue button (omitted when the entry
// matches the currently-running one).  Mirrors TodaysFactsWidget from Hamster.

const TodaysEntriesWidget = GObject.registerClass(
class TodaysEntriesWidget extends St.ScrollView {
    _init(onContinue) {
        super._init({ style_class: 'hamster-scrollbox' });
        this._onContinue = onContinue;

        this._grid = new St.Widget({
            style_class: 'hamster-activities',
            layout_manager: new Clutter.GridLayout(),
            reactive: true,
        });
        const box = new St.BoxLayout({ vertical: true });
        box.add_child(this._grid);
        this.add_child(box);
    }

    // entries: Clockify API time-entry objects (newest-first from API)
    // currentEntry: the in-progress entry or null
    // projects: full project list [{id, name}] for name lookup
    refresh(entries, currentEntry, projects = []) {
        this._grid.remove_all_children();
        const layout = this._grid.layout_manager;

        // Reverse to chronological order (oldest → newest, newest at bottom)
        const sorted = [...entries].reverse();

        sorted.forEach((entry, row) => {
            const start = new Date(entry.timeInterval.start);
            const sh = String(start.getHours()).padStart(2, '0');
            const sm = String(start.getMinutes()).padStart(2, '0');

            let timeStr, secs;
            if (entry.timeInterval.end) {
                const end = new Date(entry.timeInterval.end);
                const eh  = String(end.getHours()).padStart(2, '0');
                const em  = String(end.getMinutes()).padStart(2, '0');
                timeStr = `${sh}:${sm} - ${eh}:${em}`;
                secs = Math.floor((end - start) / 1000);
            } else {
                timeStr = `${sh}:${sm} \u2013`;   // en-dash for running entry
                secs = Math.floor((Date.now() - start) / 1000);
            }

            const projectName = projects.find(p => p.id === entry.projectId)?.name;
            const descText = [entry.description || _('(no description)'),
                projectName ? `@${projectName}` : null]
                .filter(Boolean).join(' ');

            const timeLabel = new St.Label({ style_class: 'cell-label', text: timeStr });
            const descLabel = new St.Label({
                style_class: 'cell-label',
                text: descText,
            });
            const durLabel = new St.Label({
                style_class: 'cell-label',
                text: formatDurationHuman(secs),
            });

            layout.attach(timeLabel, 0, row, 1, 1);
            layout.attach(descLabel, 1, row, 1, 1);
            layout.attach(durLabel,  2, row, 1, 1);

            // Continue button — only when this entry differs from the current one
            const isCurrent = currentEntry &&
                currentEntry.description === entry.description &&
                (currentEntry.projectId || null) === (entry.projectId || null);

            if (!isCurrent) {
                const icon = new St.Icon({
                    icon_name: 'media-playback-start-symbolic',
                    icon_size: 16,
                });
                const btn = new St.Button({ style_class: 'cell-button' });
                btn.set_child(icon);
                btn.connect('clicked', () => this._onContinue(entry));
                layout.attach(btn, 3, row, 1, 1);
            }
        });
    }
});

// ─── ClockifyIndicator ────────────────────────────────────────────────────────

const ClockifyIndicator = GObject.registerClass(
class ClockifyIndicator extends PanelMenu.Button {
    _init(settings, openPrefs) {
        super._init(0.0, 'Clockify Time Tracker');

        this._settings     = settings;
        this._openPrefs    = openPrefs;
        this._session      = new Soup.Session();
        this._currentEntry = null;    // in-progress Clockify time entry
        this._userId       = null;    // cached user id (reset on api-key change)
        this._activities   = [];      // "description @project" strings for autocomplete
        this._projects     = [];      // all workspace projects [{id, name}]
        this._refreshTimeout = null;

        // Invalidate all cached state when the API key changes, then reload
        this._settingsApiKeyId = this._settings.connect('changed::api-key', () => {
            this._userId       = null;
            this._currentEntry = null;
            this._activities   = [];
            this._projects     = [];
            this._refreshPanelLabel();
            this._loadProjects();
            this._loadCurrentEntry();
        });

        // ── Panel label / icon ──
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._panelIcon = new St.Icon({
            icon_name: 'preferences-system-time-symbolic',
            style_class: 'system-status-icon',
        });
        this._panelLabel = new St.Label({
            text: _('No activity'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._buildMenu();
        this._refreshPanelLabel();   // set correct icon/label before first API response

        // Focus entry and refresh when menu opens
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._onMenuOpen();
            } else {
                global.stage.set_key_focus(null);
            }
        });

        // Every 60 s re-fetch the running entry so web changes are reflected.
        this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._loadCurrentEntry();
            return GLib.SOURCE_CONTINUE;
        });

        // Reload projects and clear userId cache when workspace changes
        this._settingsWsId = this._settings.connect('changed::workspace-id', () => {
            this._userId   = null;
            this._projects = [];
            this._loadProjects();
        });

        this._loadProjects();
        this._loadCurrentEntry();
    }

    // ── Menu construction ─────────────────────────────────────────────────────

    _buildMenu() {
        // FactsBox: "What are you working on?" entry + today's list
        const factBoxItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        const mainBox = new St.BoxLayout({ vertical: true, style_class: 'hamster-box' });
        factBoxItem.add_child(mainBox);

        mainBox.add_child(new St.Label({
            style_class: 'hamster-box-label',
            text: _('What are you working on?'),
        }));

        this._activityEntry = new ActivityEntry(
            () => this._activities,
            () => this._projects);
        // Use key-press-event + EVENT_STOP so the Enter key is consumed here
        // and never reaches the popup menu's key handler (which would close it
        // synchronously, before our async _onEntryActivated can show errors).
        this._activityEntry.clutter_text.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                this._onEntryActivated();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        mainBox.add_child(this._activityEntry);

        this._errorLabel = new St.Label({ style_class: 'clockify-error', text: '' });
        this._errorLabel.hide();
        mainBox.add_child(this._errorLabel);

        mainBox.add_child(new St.Label({
            style_class: 'hamster-box-label',
            text: _("Today's activities"),
        }));

        this._todaysWidget = new TodaysEntriesWidget(e => this._continueEntry(e));
        mainBox.add_child(this._todaysWidget);

        this._totalLabel = new St.Label({ style_class: 'summary-label', text: '' });
        mainBox.add_child(this._totalLabel);

        this.menu.addMenuItem(factBoxItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Stop Tracking
        this._stopItem = new PopupMenu.PopupMenuItem(_('Stop Tracking'));
        this._stopItem.connect('activate', () => this._stopTimer());
        this.menu.addMenuItem(this._stopItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings
        const settingsItem = new PopupMenu.PopupMenuItem(_('Extension Settings'));
        settingsItem.connect('activate', () => this._openPrefs());
        this.menu.addMenuItem(settingsItem);
    }

    // ── Inline error display ──────────────────────────────────────────────────

    _showError(msg) {
        this._errorLabel.set_text(msg);
        this._errorLabel.show();
        if (this._errorTimeout) {
            GLib.source_remove(this._errorTimeout);
            this._errorTimeout = null;
        }
        this._errorTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._errorLabel.hide();
            this._errorTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Menu open ─────────────────────────────────────────────────────────────

    async _onMenuOpen() {
        // Re-fetch running entry first so _currentEntry is current before
        // populating the list (catches changes made via the web app).
        await this._loadCurrentEntry();
        this._loadTodaysEntries();
        // Focus the entry after the menu finishes its opening animation
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            global.stage.set_key_focus(this._activityEntry);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Entry activation (press Enter) ────────────────────────────────────────

    async _onEntryActivated() {
        const raw = this._activityEntry.get_text().trim();
        if (!raw) return;

        const atIdx = raw.lastIndexOf('@');
        let description, projectId = null;
        if (atIdx !== -1) {
            description = raw.slice(0, atIdx).trim();
            const projectName = raw.slice(atIdx + 1).trim();
            projectId = this._projects.find(
                p => p.name.toLowerCase() === projectName.toLowerCase())?.id || null;
        } else {
            description = raw;
        }

        const ok = await this._startTimer(description, projectId);
        if (ok) {
            this._activityEntry.reset();
            this.menu.close();
        }
    }

    // ── Continue a past entry ─────────────────────────────────────────────────

    async _continueEntry(entry) {
        const ok = await this._startTimer(entry.description || '', entry.projectId || null);
        if (ok) this.menu.close();
    }

    // ── Clockify API helpers ──────────────────────────────────────────────────

    async _apiRequest(method, path, body = null) {
        const apiKey = this._settings.get_string('api-key');
        if (!apiKey) throw new Error(_('No API key \u2014 open Extension Settings to configure'));

        const msg = Soup.Message.new(method, `${CLOCKIFY_API_URL}${path}`);
        msg.request_headers.append('X-Api-Key', apiKey);

        if (body !== null) {
            const encoded = new TextEncoder().encode(JSON.stringify(body));
            msg.set_request_body_from_bytes('application/json', new GLib.Bytes(encoded));
        }

        const bytes = await this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, null);
        const status = msg.get_status();
        if (status < 200 || status >= 300)
            throw new Error(`HTTP ${status} \u2014 ${method} ${path}`);

        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _ensureUserId() {
        if (this._userId) return this._userId;
        const user = await this._apiRequest('GET', '/user');
        this._userId = user.id;
        return this._userId;
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    // Fetch all workspace projects once on startup / workspace change.
    // Projects are stable — no periodic refresh needed.
    async _loadProjects() {
        const wid = this._settings.get_string('workspace-id');
        if (!wid || !this._settings.get_string('api-key')) return;
        try {
            this._projects = await this._apiRequest('GET',
                `/workspaces/${wid}/projects?page-size=500&archived=false`) || [];
        } catch { this._projects = []; }
    }

    async _loadCurrentEntry() {
        const apiKey = this._settings.get_string('api-key');
        const wid    = this._settings.get_string('workspace-id');
        if (!apiKey || !wid) return;
        try {
            const uid     = await this._ensureUserId();
            const entries = await this._apiRequest('GET',
                `/workspaces/${wid}/user/${uid}/time-entries?in-progress=true`);
            this._currentEntry = (entries && entries.length > 0) ? entries[0] : null;
            this._refreshPanelLabel();
        } catch { /* silent on startup */ }
    }

    async _loadTodaysEntries() {
        const apiKey = this._settings.get_string('api-key');
        const wid    = this._settings.get_string('workspace-id');
        if (!apiKey || !wid) return;
        try {
            const uid = await this._ensureUserId();

            // One request covers both the display list (today) and autocomplete (7 days).
            // Clockify returns newest-first so today's entries are always in the first page
            // for any typical user.  setDate() handles month/year boundaries correctly.
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            const allEntries = await this._apiRequest('GET',
                `/workspaces/${wid}/user/${uid}/time-entries` +
                `?start=${encodeURIComponent(weekAgo.toISOString())}&page-size=200`) || [];

            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            const todayEntries = allEntries.filter(
                e => new Date(e.timeInterval.start) >= todayMidnight);

            this._todaysWidget.refresh(todayEntries, this._currentEntry, this._projects);
            // Scroll to bottom after Clutter lays out the new rows (newest entry visible)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                const adj = this._todaysWidget.vadjustment;
                if (adj) adj.value = adj.upper;
                return GLib.SOURCE_REMOVE;
            });

            // Autocomplete: unique "description @project" strings, most-recent first
            const seen = new Set();
            this._activities = [];
            for (const e of allEntries) {
                if (!e.description) continue;
                const projectName = this._projects.find(p => p.id === e.projectId)?.name;
                const key = projectName ? `${e.description} @${projectName}` : e.description;
                if (!seen.has(key)) {
                    seen.add(key);
                    this._activities.push(key);
                }
            }

            // Total tracked time for today
            let totalSecs = 0;
            for (const e of todayEntries) {
                if (e.timeInterval.end) {
                    totalSecs += Math.floor(
                        (new Date(e.timeInterval.end) - new Date(e.timeInterval.start)) / 1000);
                }
            }
            if (this._currentEntry)
                totalSecs += elapsedSeconds(this._currentEntry.timeInterval.start);
            this._totalLabel.set_text(
                totalSecs > 0 ? _('Total: %s').replace('%s', formatDuration(totalSecs)) : '');
        } catch (e) {
            this._showError(_('Failed to load entries: %s').replace('%s', e.message));
        }
    }

    // ── Timer control ─────────────────────────────────────────────────────────

    // Returns true on success, false on failure (caller gates menu close / text clear).
    async _startTimer(description, projectId) {
        const apiKey = this._settings.get_string('api-key');
        const wid    = this._settings.get_string('workspace-id');
        if (!apiKey || !wid) {
            this._showError(_('Configure API key and workspace in Extension Settings first'));
            return false;
        }
        // Stop whatever is running first (same as Hamster's AddFact replacing ongoing fact)
        if (this._currentEntry) await this._stopTimerSilent();
        try {
            const body = { start: new Date().toISOString(), description };
            if (projectId) body.projectId = projectId;
            const entry = await this._apiRequest('POST',
                `/workspaces/${wid}/time-entries`, body);
            this._currentEntry = entry;
            this._errorLabel.hide();
            this._refreshPanelLabel();
            this._loadTodaysEntries();
            return true;
        } catch (e) {
            this._showError(_('Failed to start timer: %s').replace('%s', e.message));
            return false;
        }
    }

    async _stopTimerSilent() {
        try {
            const wid = this._settings.get_string('workspace-id');
            const uid = await this._ensureUserId();
            await this._apiRequest('PATCH',
                `/workspaces/${wid}/user/${uid}/time-entries`,
                { end: new Date().toISOString() });
            this._currentEntry = null;
        } catch { /* ignore — leave currentEntry intact if stop failed */ }
    }

    async _stopTimer() {
        if (!this._currentEntry) return;
        try {
            const wid = this._settings.get_string('workspace-id');
            const uid = await this._ensureUserId();
            await this._apiRequest('PATCH',
                `/workspaces/${wid}/user/${uid}/time-entries`,
                { end: new Date().toISOString() });
            this._currentEntry = null;
            this._refreshPanelLabel();
            this._loadTodaysEntries();
        } catch (e) {
            Main.notify(_('Clockify Error'), _('Failed to stop timer: %s').replace('%s', e.message));
        }
    }

    // ── Panel label update ────────────────────────────────────────────────────

    _refreshPanelLabel() {
        // 0 = label only, 1 = icon only, 2 = icon + label
        const appearance = this._settings.get_int('panel-appearance');

        this._stopItem.visible = !!this._currentEntry;

        let text, iconName;
        if (this._currentEntry) {
            const secs = elapsedSeconds(this._currentEntry.timeInterval.start);
            text     = `${this._currentEntry.description || _('Tracking')} ${formatDuration(secs)}`;
            iconName = 'media-record-symbolic';
        } else {
            text     = _('No activity');
            iconName = 'alarm-symbolic';
        }

        this._panelIcon.icon_name  = iconName;
        this._panelIcon.visible    = appearance !== 0;   // shown in icon-only (1) and icon+label (2)
        this._panelLabel.visible   = appearance !== 1;   // shown in label-only (0) and icon+label (2)
        if (appearance !== 1) this._panelLabel.set_text(text);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
        if (this._settingsApiKeyId) {
            this._settings.disconnect(this._settingsApiKeyId);
            this._settingsApiKeyId = null;
        }
        if (this._settingsWsId) {
            this._settings.disconnect(this._settingsWsId);
            this._settingsWsId = null;
        }
        if (this._refreshTimeout) {
            GLib.source_remove(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        if (this._errorTimeout) {
            GLib.source_remove(this._errorTimeout);
            this._errorTimeout = null;
        }
        super.destroy();
    }
});

// ─── ClockifyExtension ────────────────────────────────────────────────────────

export default class ClockifyExtension extends Extension {
    enable() {
        this.initTranslations();
        _ = this.gettext.bind(this);
        this._settings  = this.getSettings('org.gnome.shell.extensions.clockify-tracker');
        this._indicator = new ClockifyIndicator(this._settings, () => this.openPreferences());
        Main.panel.addToStatusArea('clockify-indicator', this._indicator);

        // Global keybinding — default <Super>t, configurable in prefs
        Main.wm.addKeybinding(
            'show-clockify-dropdown',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._indicator.menu.toggle()
        );
    }

    disable() {
        Main.wm.removeKeybinding('show-clockify-dropdown');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
