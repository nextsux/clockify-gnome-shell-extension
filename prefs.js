/* prefs.js
 *
 * Clockify Time Tracker — Extension Preferences
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ }
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ─── HotkeyRow ────────────────────────────────────────────────────────────────
// Adw.EntryRow subclass for editing a keybinding stored as a GSettings strv.
// Mirrors the HotkeyRow from the Hamster extension.

class HotkeyRow extends Adw.EntryRow {
    static { GObject.registerClass(this); }

    constructor({ title, settings, bind }) {
        super({ title });
        this.show_apply_button = true;
        this._current = settings.get_strv(bind);
        this.set_text(this._current.join(', '));

        this.connect('apply', () => {
            const mappings = this.get_text().split(',').map(x => {
                const [, key, mods] = Gtk.accelerator_parse(x.trim());
                return Gtk.accelerator_valid(key, mods) && Gtk.accelerator_name(key, mods);
            });
            if (mappings.every(x => !!x)) {
                this._current = mappings;
                settings.set_strv(bind, this._current);
            } else {
                // Restore previous valid value
                this.set_text(this._current.join(', '));
            }
        });
    }
}

// ─── ClockifyPrefsWidget ──────────────────────────────────────────────────────

class ClockifyPrefsWidget extends Adw.PreferencesPage {
    static { GObject.registerClass(this); }

    constructor(settings) {
        super();

        // ── Clockify Credentials ──────────────────────────────────────────────
        const credGroup = new Adw.PreferencesGroup({ title: _('Clockify Credentials') });
        this.add(credGroup);

        // API key hidden by default (password field)
        const apiKeyRow = new Adw.PasswordEntryRow({ title: _('API Key') });
        apiKeyRow.set_text(settings.get_string('api-key'));
        apiKeyRow.show_apply_button = true;
        apiKeyRow.connect('apply', () =>
            settings.set_string('api-key', apiKeyRow.get_text()));
        credGroup.add(apiKeyRow);

        const workspaceRow = new Adw.EntryRow({ title: _('Workspace ID') });
        workspaceRow.set_text(settings.get_string('workspace-id'));
        workspaceRow.show_apply_button = true;
        workspaceRow.connect('apply', () =>
            settings.set_string('workspace-id', workspaceRow.get_text()));
        credGroup.add(workspaceRow);

        // ── Panel Appearance ──────────────────────────────────────────────────
        const appearGroup = new Adw.PreferencesGroup({ title: _('Panel Appearance') });
        this.add(appearGroup);

        // Bind radio buttons via GActionGroup → GSettings action
        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('clockify', actionGroup);
        actionGroup.add_action(settings.create_action('panel-appearance'));

        for (const { a, title } of [
            { a: 0, title: _('Label only (activity name + elapsed time)') },
            { a: 1, title: _('Icon only') },
            { a: 2, title: _('Icon and label') },
        ]) {
            const btn = new Gtk.CheckButton({
                action_name: 'clockify.panel-appearance',
                action_target: new GLib.Variant('i', a),
            });
            const row = new Adw.ActionRow({ activatable_widget: btn, title });
            row.add_prefix(btn);
            appearGroup.add(row);
        }

        // ── Keyboard Shortcut ─────────────────────────────────────────────────
        const kbGroup = new Adw.PreferencesGroup({ title: _('Keyboard Shortcut') });
        this.add(kbGroup);
        kbGroup.add(new HotkeyRow({
            title: _('Toggle dropdown'),
            settings,
            bind: 'show-clockify-dropdown',
        }));
    }
}

// ─── ClockifyPrefs ────────────────────────────────────────────────────────────

export default class ClockifyPrefs extends ExtensionPreferences {
    getPreferencesWidget() {
        return new ClockifyPrefsWidget(this.getSettings());
    }
}
