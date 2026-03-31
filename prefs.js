/* prefs.js
 *
 * Clockify Time Tracker — Extension Preferences
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { ExtensionPreferences, gettext as _ }
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The prefs process doesn't auto-promisify Soup like the Shell process does.
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const CLOCKIFY_API_URL = 'https://api.clockify.me/api/v1';

// ─── HotkeyRow ────────────────────────────────────────────────────────────────
// Adw.EntryRow subclass for editing a keybinding stored as a GSettings strv.
// Requires explicit Apply (checkmark) so an incomplete shortcut is never saved.

class HotkeyRow extends Adw.EntryRow {
    static { GObject.registerClass(this); }

    constructor({ title, settings, key }) {
        super({ title, show_apply_button: true });
        this._settings = settings;
        this._key      = key;
        this._current  = settings.get_strv(key);
        this.set_text(this._current.join(', '));

        this.connect('apply', () => {
            const shortcuts = this.get_text().split(',').map(s => {
                const [ok, keyval, mods] = Gtk.accelerator_parse(s.trim());
                return ok && Gtk.accelerator_valid(keyval, mods)
                    ? Gtk.accelerator_name(keyval, mods)
                    : null;
            });
            if (shortcuts.every(s => !!s)) {
                this._current = shortcuts;
                this._settings.set_strv(this._key, this._current);
            } else {
                // Restore previous valid value
                this.set_text(this._current.join(', '));
            }
        });

        // Reflect external changes (e.g. dconf-editor)
        this._handlerId = settings.connect(`changed::${key}`, () => {
            this._current = settings.get_strv(key);
            this.set_text(this._current.join(', '));
        });
    }

    destroy() {
        if (this._handlerId) {
            this._settings.disconnect(this._handlerId);
            this._handlerId = null;
        }
        super.destroy?.();
    }
}

// ─── ClockifyPrefs ────────────────────────────────────────────────────────────

export default class ClockifyPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings     = this.getSettings();
        const session      = new Soup.Session();
        const cancellable  = new Gio.Cancellable();
        const page         = new Adw.PreferencesPage();

        // Track signal handler IDs so we can disconnect them when the window closes.
        const handlerIds = [];

        // ── Clockify Credentials ──────────────────────────────────────────────
        const credGroup = new Adw.PreferencesGroup({ title: _('Clockify Credentials') });
        page.add(credGroup);

        // API key — explicit load + manual save to avoid the bidirectional bind race
        // where the widget's initial empty notify::text fires before GSettings pushes
        // its stored value, silently overwriting the saved key with an empty string.
        const apiKeyRow = new Adw.PasswordEntryRow({ title: _('API Key') });
        apiKeyRow.set_text(settings.get_string('api-key'));
        apiKeyRow.connect('notify::text', () => {
            const v = apiKeyRow.get_text();
            if (v !== settings.get_string('api-key'))
                settings.set_string('api-key', v);
        });
        credGroup.add(apiKeyRow);

        // ── Workspace ─────────────────────────────────────────────────────────
        // Populated from the API; falls back gracefully when offline / no key yet.

        const workspaceModel = new Gtk.StringList();
        const workspaceRow   = new Adw.ComboRow({
            title:     _('Workspace'),
            subtitle:  _('Enter an API key first'),
            model:     workspaceModel,
            sensitive: false,
        });
        credGroup.add(workspaceRow);

        const spinner = new Gtk.Spinner();
        workspaceRow.add_suffix(spinner);

        let workspaces            = [];
        let blockSelectionHandler = false;

        const populateWorkspaces = ws => {
            workspaces = ws;
            blockSelectionHandler = true;

            while (workspaceModel.get_n_items() > 0)
                workspaceModel.remove(0);
            ws.forEach(w => workspaceModel.append(w.name));

            const currentId = settings.get_string('workspace-id');
            const idx = ws.findIndex(w => w.id === currentId);
            workspaceRow.set_selected(idx >= 0 ? idx : 0);

            // Auto-save first workspace if none was configured yet
            if (idx < 0 && ws.length > 0)
                settings.set_string('workspace-id', ws[0].id);

            blockSelectionHandler  = false;
            workspaceRow.subtitle  = '';
            workspaceRow.sensitive = true;
        };

        workspaceRow.connect('notify::selected', () => {
            if (blockSelectionHandler) return;
            const ws = workspaces[workspaceRow.get_selected()];
            if (ws) settings.set_string('workspace-id', ws.id);
        });

        const fetchWorkspaces = async () => {
            if (cancellable.is_cancelled()) return;

            const apiKey = settings.get_string('api-key');
            if (!apiKey) {
                workspaceRow.subtitle  = _('Enter an API key first');
                workspaceRow.sensitive = false;
                return;
            }

            spinner.start();
            workspaceRow.subtitle  = _('Loading\u2026');
            workspaceRow.sensitive = false;

            try {
                const msg = Soup.Message.new('GET', `${CLOCKIFY_API_URL}/workspaces`);
                msg.request_headers.append('X-Api-Key', apiKey);
                const bytes  = await session.send_and_read_async(
                    msg, GLib.PRIORITY_DEFAULT, cancellable);
                const status = msg.get_status();
                if (status >= 200 && status < 300) {
                    try {
                        const list = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                        populateWorkspaces(list.map(w => ({ id: w.id, name: w.name })));
                    } catch {
                        workspaceRow.subtitle  = _('Unexpected response from server');
                        workspaceRow.sensitive = false;
                    }
                } else {
                    workspaceRow.subtitle  = _('Invalid API key (HTTP %s)').replace('%s', status);
                    workspaceRow.sensitive = false;
                }
            } catch {
                if (cancellable.is_cancelled()) return;
                workspaceRow.subtitle  = _('Network error \u2014 check your connection');
                workspaceRow.sensitive = false;
            } finally {
                if (!cancellable.is_cancelled()) spinner.stop();
            }
        };

        // Debounce: wait 500 ms after the last api-key change before fetching,
        // so a user typing their key doesn't fire one request per character.
        let debounceId = null;
        const scheduleFetch = () => {
            if (debounceId) {
                GLib.source_remove(debounceId);
                debounceId = null;
            }
            debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                debounceId = null;
                fetchWorkspaces();
                return GLib.SOURCE_REMOVE;
            });
        };

        // Fetch immediately on open (no debounce needed — user isn't typing yet)
        fetchWorkspaces();
        handlerIds.push(settings.connect('changed::api-key', scheduleFetch));

        // ── Panel Appearance ──────────────────────────────────────────────────
        const appearGroup = new Adw.PreferencesGroup({ title: _('Panel Appearance') });
        page.add(appearGroup);

        const appearanceModel = new Gtk.StringList();
        [
            _('Label only (activity name + elapsed time)'),
            _('Icon only'),
            _('Icon and label'),
        ].forEach(s => appearanceModel.append(s));

        const comboRow = new Adw.ComboRow({
            title:    _('Panel style'),
            model:    appearanceModel,
            selected: settings.get_int('panel-appearance'),
        });
        comboRow.connect('notify::selected', () =>
            settings.set_int('panel-appearance', comboRow.get_selected()));
        handlerIds.push(settings.connect('changed::panel-appearance', () =>
            comboRow.set_selected(settings.get_int('panel-appearance'))));
        appearGroup.add(comboRow);

        // ── Keyboard Shortcut ─────────────────────────────────────────────────
        const kbGroup = new Adw.PreferencesGroup({ title: _('Keyboard Shortcut') });
        page.add(kbGroup);
        kbGroup.add(new HotkeyRow({
            title:    _('Toggle dropdown'),
            settings,
            key:      'show-clockify-dropdown',
        }));

        // ── Cleanup on close ──────────────────────────────────────────────────
        // Disconnect signal handlers and cancel in-flight HTTP requests when the
        // window is destroyed, so nothing touches freed widgets afterwards.
        window.connect('destroy', () => {
            cancellable.cancel();
            for (const id of handlerIds)
                settings.disconnect(id);
            handlerIds.length = 0;
            if (debounceId) {
                GLib.source_remove(debounceId);
                debounceId = null;
            }
        });

        window.add(page);
    }
}
