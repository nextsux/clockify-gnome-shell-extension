/* extension.js
 *
 * Clockify Time Tracker for GNOME Shell
 * A time tracking extension that integrates with Clockify API
 */

import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import Soup from "gi://Soup";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const CLOCKIFY_API_URL = "https://api.clockify.me/api/v1";

const SettingsDialog = GObject.registerClass(
  class SettingsDialog extends ModalDialog.ModalDialog {
    _init(settings) {
      super._init({ styleClass: "extension-dialog" });

      this._settings = settings;

      let content = new St.BoxLayout({
        vertical: true,
        style: "padding: 20px; spacing: 15px;",
      });

      // Title
      let title = new St.Label({
        text: "Clockify Settings",
        style: "font-weight: bold; font-size: 14pt; margin-bottom: 10px;",
      });
      content.add_child(title);

      // API Key section
      let apiKeyLabel = new St.Label({
        text: "API Key:",
        style: "font-weight: bold;",
      });
      content.add_child(apiKeyLabel);

      this._apiKeyEntry = new St.Entry({
        hint_text: "Enter your Clockify API key",
        text: settings.get_string("api-key"),
        style: "width: 400px;",
      });
      content.add_child(this._apiKeyEntry);

      let apiKeyHelp = new St.Label({
        text: "Get your API key from: Profile Settings → API",
        style: "font-size: 9pt; color: #888;",
      });
      content.add_child(apiKeyHelp);

      // Workspace ID section
      let workspaceLabel = new St.Label({
        text: "Workspace ID:",
        style: "font-weight: bold; margin-top: 10px;",
      });
      content.add_child(workspaceLabel);

      this._workspaceEntry = new St.Entry({
        hint_text: "Enter your workspace ID",
        text: settings.get_string("workspace-id"),
        style: "width: 400px;",
      });
      content.add_child(this._workspaceEntry);

      let workspaceHelp = new St.Label({
        text: 'Or click "Fetch Workspaces" after entering API key',
        style: "font-size: 9pt; color: #888;",
      });
      content.add_child(workspaceHelp);

      // Fetch workspaces button
      this._fetchButton = new St.Button({
        label: "Fetch Workspaces",
        style_class: "button",
        style: "margin-top: 5px;",
      });
      this._fetchButton.connect("clicked", () => this._fetchWorkspaces());
      content.add_child(this._fetchButton);

      // Workspace dropdown (hidden initially)
      this._workspaceBox = new St.BoxLayout({
        vertical: true,
        visible: false,
        style: "margin-top: 10px;",
      });
      content.add_child(this._workspaceBox);

      this.contentLayout.add_child(content);

      // Buttons
      this.setButtons([
        {
          label: "Cancel",
          action: () => this.close(),
          key: Clutter.KEY_Escape,
        },
        {
          label: "Save",
          action: () => this._save(),
          default: true,
        },
      ]);
    }

    async _fetchWorkspaces() {
      const apiKey = this._apiKeyEntry.get_text();

      if (!apiKey) {
        Main.notify("Clockify", "Please enter an API key first");
        return;
      }

      try {
        const session = new Soup.Session();
        const message = Soup.Message.new(
          "GET",
          `${CLOCKIFY_API_URL}/workspaces`,
        );
        message.request_headers.append("X-Api-Key", apiKey);

        const bytes = await session.send_and_read_async(
          message,
          GLib.PRIORITY_DEFAULT,
          null,
        );

        const decoder = new TextDecoder("utf-8");
        const workspaces = JSON.parse(decoder.decode(bytes.get_data()));

        this._workspaceBox.destroy_all_children();

        let label = new St.Label({
          text: "Select Workspace:",
          style: "font-weight: bold; margin-bottom: 5px;",
        });
        this._workspaceBox.add_child(label);

        workspaces.forEach((ws) => {
          let btn = new St.Button({
            label: ws.name,
            style_class: "button",
            style: "margin: 2px; text-align: left;",
          });
          btn.connect("clicked", () => {
            this._workspaceEntry.set_text(ws.id);
            this._workspaceBox.visible = false;
          });
          this._workspaceBox.add_child(btn);
        });

        this._workspaceBox.visible = true;
      } catch (e) {
        Main.notify(
          "Clockify Error",
          `Failed to fetch workspaces: ${e.message}`,
        );
      }
    }

    _save() {
      const apiKey = this._apiKeyEntry.get_text();
      const workspaceId = this._workspaceEntry.get_text();

      this._settings.set_string("api-key", apiKey);
      this._settings.set_string("workspace-id", workspaceId);

      Main.notify("Clockify", "Settings saved successfully");
      this.close();
    }
  },
);

const TaskDialog = GObject.registerClass(
  class TaskDialog extends ModalDialog.ModalDialog {
    _init(callback) {
      super._init({ styleClass: "extension-dialog" });

      this._callback = callback;

      let content = new St.BoxLayout({
        vertical: true,
        style: "padding: 20px; spacing: 15px;",
      });

      let title = new St.Label({
        text: "Start New Task",
        style: "font-weight: bold; font-size: 14pt; margin-bottom: 10px;",
      });
      content.add_child(title);

      let label = new St.Label({
        text: "Task Description:",
        style: "font-weight: bold;",
      });
      content.add_child(label);

      this._taskEntry = new St.Entry({
        hint_text: "What are you working on?",
        style: "width: 400px;",
      });
      content.add_child(this._taskEntry);

      this.contentLayout.add_child(content);

      this.setButtons([
        {
          label: "Cancel",
          action: () => this.close(),
          key: Clutter.KEY_Escape,
        },
        {
          label: "Start",
          action: () => this._start(),
          default: true,
        },
      ]);

      // Focus the entry
      this._taskEntry.grab_key_focus();
    }

    _start() {
      const description = this._taskEntry.get_text() || "New Task";
      this._callback(description);
      this.close();
    }
  },
);

const ClockifyIndicator = GObject.registerClass(
  class ClockifyIndicator extends PanelMenu.Button {
    _init(settings) {
      super._init(0.0, "Clockify Time Tracker");

      this._settings = settings;
      this._session = new Soup.Session();
      this._currentTimer = null;
      this._updateInterval = null;

      // Create panel button
      let box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
      this._icon = new St.Icon({
        icon_name: "media-playback-start-symbolic",
        style_class: "system-status-icon",
      });
      this._label = new St.Label({
        text: "00:00",
        y_align: Clutter.ActorAlign.CENTER,
      });

      box.add_child(this._icon);
      box.add_child(this._label);
      this.add_child(box);

      // Build menu
      this._buildMenu();

      // Load current timer
      this._loadCurrentTimer();
    }

    _buildMenu() {
      // Current task display
      this._currentTaskItem = new PopupMenu.PopupMenuItem("No active task", {
        reactive: false,
      });
      this._currentTaskItem.label.style = "font-style: italic;";
      this.menu.addMenuItem(this._currentTaskItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Start/Stop timer
      this._timerButton = new PopupMenu.PopupMenuItem("Start Timer");
      this._timerButton.connect("activate", () => this._toggleTimer());
      this.menu.addMenuItem(this._timerButton);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Recent entries section
      let recentLabel = new PopupMenu.PopupMenuItem("Recent Entries", {
        reactive: false,
      });
      recentLabel.label.style = "font-weight: bold;";
      this.menu.addMenuItem(recentLabel);

      this._recentSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._recentSection);

      // Refresh button
      let refreshItem = new PopupMenu.PopupMenuItem("↻ Refresh");
      refreshItem.connect("activate", () => this._loadRecentEntries());
      this.menu.addMenuItem(refreshItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Settings button
      let settingsItem = new PopupMenu.PopupMenuItem("⚙ Settings");
      settingsItem.connect("activate", () => this._showSettings());
      this.menu.addMenuItem(settingsItem);
    }

    _showSettings() {
      let dialog = new SettingsDialog(this._settings);
      dialog.open();
    }

    async _toggleTimer() {
      if (this._currentTimer) {
        await this._stopTimer();
      } else {
        // Show task dialog
        let dialog = new TaskDialog((description) => {
          this._startTimer(description);
        });
        dialog.open();
      }
    }

    async _startTimer(description = "New Task") {
      const apiKey = this._settings.get_string("api-key");
      const workspaceId = this._settings.get_string("workspace-id");

      if (!apiKey || !workspaceId) {
        Main.notify("Clockify", "Please configure settings first");
        this._showSettings();
        return;
      }

      try {
        const userId = await this._getUserId(apiKey);

        const message = Soup.Message.new(
          "POST",
          `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/time-entries`,
        );

        message.request_headers.append("X-Api-Key", apiKey);
        message.request_headers.append("Content-Type", "application/json");

        const body = {
          start: new Date().toISOString(),
          description: description,
        };

        message.set_request_body_from_bytes(
          "application/json",
          new GLib.Bytes(JSON.stringify(body)),
        );

        const bytes = await this._session.send_and_read_async(
          message,
          GLib.PRIORITY_DEFAULT,
          null,
        );

        const decoder = new TextDecoder("utf-8");
        const response = JSON.parse(decoder.decode(bytes.get_data()));

        this._currentTimer = response;
        this._updateTimerDisplay();
        this._startUpdateInterval();

        this._timerButton.label.text = "Stop Timer";
        this._icon.icon_name = "media-playback-stop-symbolic";
        this._currentTaskItem.label.text = `▶ ${description}`;
        this._currentTaskItem.label.style =
          "font-weight: bold; color: #4CAF50;";
      } catch (e) {
        Main.notify("Clockify Error", `Failed to start timer: ${e.message}`);
      }
    }

    async _stopTimer() {
      const apiKey = this._settings.get_string("api-key");
      const workspaceId = this._settings.get_string("workspace-id");

      if (!this._currentTimer) return;

      try {
        const userId = await this._getUserId(apiKey);

        const message = Soup.Message.new(
          "PATCH",
          `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${userId}/time-entries`,
        );

        message.request_headers.append("X-Api-Key", apiKey);
        message.request_headers.append("Content-Type", "application/json");

        const body = {
          end: new Date().toISOString(),
        };

        message.set_request_body_from_bytes(
          "application/json",
          new GLib.Bytes(JSON.stringify(body)),
        );

        await this._session.send_and_read_async(
          message,
          GLib.PRIORITY_DEFAULT,
          null,
        );

        this._currentTimer = null;
        this._stopUpdateInterval();
        this._label.text = "00:00";
        this._timerButton.label.text = "Start Timer";
        this._icon.icon_name = "media-playback-start-symbolic";
        this._currentTaskItem.label.text = "No active task";
        this._currentTaskItem.label.style = "font-style: italic;";

        this._loadRecentEntries();
      } catch (e) {
        Main.notify("Clockify Error", `Failed to stop timer: ${e.message}`);
      }
    }

    async _getUserId(apiKey) {
      const message = Soup.Message.new("GET", `${CLOCKIFY_API_URL}/user`);
      message.request_headers.append("X-Api-Key", apiKey);

      const bytes = await this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
      );

      const decoder = new TextDecoder("utf-8");
      const user = JSON.parse(decoder.decode(bytes.get_data()));

      return user.id;
    }

    async _loadCurrentTimer() {
      const apiKey = this._settings.get_string("api-key");
      const workspaceId = this._settings.get_string("workspace-id");

      if (!apiKey || !workspaceId) return;

      try {
        const userId = await this._getUserId(apiKey);

        const message = Soup.Message.new(
          "GET",
          `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${userId}/time-entries?in-progress=true`,
        );

        message.request_headers.append("X-Api-Key", apiKey);

        const bytes = await this._session.send_and_read_async(
          message,
          GLib.PRIORITY_DEFAULT,
          null,
        );

        const decoder = new TextDecoder("utf-8");
        const entries = JSON.parse(decoder.decode(bytes.get_data()));

        if (entries && entries.length > 0) {
          this._currentTimer = entries[0];
          this._updateTimerDisplay();
          this._startUpdateInterval();
          this._timerButton.label.text = "Stop Timer";
          this._icon.icon_name = "media-playback-stop-symbolic";
          this._currentTaskItem.label.text = `▶ ${this._currentTimer.description || "No description"}`;
          this._currentTaskItem.label.style =
            "font-weight: bold; color: #4CAF50;";
        }

        this._loadRecentEntries();
      } catch (e) {
        // Silently fail on startup
      }
    }

    async _loadRecentEntries() {
      const apiKey = this._settings.get_string("api-key");
      const workspaceId = this._settings.get_string("workspace-id");

      if (!apiKey || !workspaceId) return;

      try {
        const userId = await this._getUserId(apiKey);

        const message = Soup.Message.new(
          "GET",
          `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${userId}/time-entries?page-size=5`,
        );

        message.request_headers.append("X-Api-Key", apiKey);

        const bytes = await this._session.send_and_read_async(
          message,
          GLib.PRIORITY_DEFAULT,
          null,
        );

        const decoder = new TextDecoder("utf-8");
        const entries = JSON.parse(decoder.decode(bytes.get_data()));

        this._recentSection.removeAll();

        if (entries.length === 0) {
          let emptyItem = new PopupMenu.PopupMenuItem("No recent entries", {
            reactive: false,
          });
          emptyItem.label.style = "font-style: italic; color: #888;";
          this._recentSection.addMenuItem(emptyItem);
        } else {
          entries.forEach((entry) => {
            if (!entry.timeInterval.end) return; // Skip running timer

            const duration = this._formatDuration(entry.timeInterval);
            const desc = entry.description || "No description";
            const item = new PopupMenu.PopupMenuItem(`${desc} (${duration})`, {
              reactive: false,
            });
            item.label.style = "font-size: 9.5pt;";
            this._recentSection.addMenuItem(item);
          });
        }
      } catch (e) {
        Main.notify("Clockify Error", `Failed to load entries: ${e.message}`);
      }
    }

    _updateTimerDisplay() {
      if (!this._currentTimer) return;

      const start = new Date(this._currentTimer.timeInterval.start);
      const now = new Date();
      const diff = Math.floor((now - start) / 1000);

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);

      this._label.text = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }

    _formatDuration(timeInterval) {
      const start = new Date(timeInterval.start);
      const end = timeInterval.end ? new Date(timeInterval.end) : new Date();
      const diff = Math.floor((end - start) / 1000);

      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);

      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }

    _startUpdateInterval() {
      if (this._updateInterval) return;

      this._updateInterval = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        60,
        () => {
          this._updateTimerDisplay();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _stopUpdateInterval() {
      if (this._updateInterval) {
        GLib.Source.remove(this._updateInterval);
        this._updateInterval = null;
      }
    }

    destroy() {
      this._stopUpdateInterval();
      super.destroy();
    }
  },
);

export default class ClockifyExtension extends Extension {
  enable() {
    this._settings = this.getSettings(
      "org.gnome.shell.extensions.clockify-tracker",
    );
    this._indicator = new ClockifyIndicator(this._settings);
    Main.panel.addToStatusArea("clockify-indicator", this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
    this._settings = null;
  }
}
