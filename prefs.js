/* prefs.js
 *
 * Clockify Time Tracker — Extension Preferences
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import { ExtensionPreferences, gettext as _ }
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        // ── Clockify Credentials ──────────────────────────────────────────────
        const credGroup = new Adw.PreferencesGroup({ title: _('Clockify Credentials') });
        page.add(credGroup);

        // API key — bound directly: saved on every change, no Apply button needed
        const apiKeyRow = new Adw.PasswordEntryRow({ title: _('API Key') });
        settings.bind('api-key', apiKeyRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        credGroup.add(apiKeyRow);

        const workspaceRow = new Adw.EntryRow({ title: _('Workspace ID') });
        settings.bind('workspace-id', workspaceRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        credGroup.add(workspaceRow);

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
            title: _('Panel style'),
            model: appearanceModel,
            selected: settings.get_int('panel-appearance'),
        });
        comboRow.connect('notify::selected', () =>
            settings.set_int('panel-appearance', comboRow.get_selected()));
        // Reflect external changes
        settings.connect('changed::panel-appearance', () =>
            comboRow.set_selected(settings.get_int('panel-appearance')));
        appearGroup.add(comboRow);

        // ── Keyboard Shortcut ─────────────────────────────────────────────────
        const kbGroup = new Adw.PreferencesGroup({ title: _('Keyboard Shortcut') });
        page.add(kbGroup);
        kbGroup.add(new HotkeyRow({
            title:    _('Toggle dropdown'),
            settings,
            key:      'show-clockify-dropdown',
        }));

        window.add(page);
    }
}
