UUID      = clockify-tracker@smoula.net
DIST_DIR  = dist
ZIP_NAME  = $(UUID).zip

# Files that go into the packaged extension
SOURCES = extension.js prefs.js stylesheet.css metadata.json
SCHEMA_SRC = schemas/org.gnome.shell.extensions.clockify-tracker.gschema.xml

.PHONY: all compile install install-user run logs clean dist zip

all: compile

# Compile GSettings schema (required before install / local test)
compile:
	glib-compile-schemas schemas/

# Install for the current user.
# If the extension dir is already a symlink to this repo, skip the copy (files are identical).
install-user: compile
	@DEST=~/.local/share/gnome-shell/extensions/$(UUID); \
	if [ -L "$$DEST" ] && [ "$$(readlink -f $$DEST)" = "$$(pwd)" ]; then \
	    echo "Extension already symlinked to this repo — skipping copy."; \
	else \
	    mkdir -p "$$DEST"; \
	    cp $(SOURCES) "$$DEST/"; \
	    cp -r schemas/ "$$DEST/schemas/"; \
	fi

# Install system-wide (requires root)
install: compile
	mkdir -p /usr/share/gnome-shell/extensions/$(UUID)
	cp $(SOURCES) /usr/share/gnome-shell/extensions/$(UUID)/
	cp -r schemas/ /usr/share/gnome-shell/extensions/$(UUID)/schemas/
	glib-compile-schemas /usr/share/gnome-shell/extensions/$(UUID)/schemas/

# Create distributable zip (suitable for extensions.gnome.org upload)
zip: compile
	mkdir -p $(DIST_DIR)
	zip -j $(DIST_DIR)/$(ZIP_NAME) $(SOURCES)
	zip $(DIST_DIR)/$(ZIP_NAME) schemas/$(notdir $(SCHEMA_SRC))
	zip $(DIST_DIR)/$(ZIP_NAME) schemas/gschemas.compiled

dist: zip
	@echo "Package ready: $(DIST_DIR)/$(ZIP_NAME)"

# Run a nested GNOME Shell session (no logout needed — works on both X11 and Wayland).
# Usage: make run
run: install-user
	@echo "Enabling extension in gsettings…"
	gnome-extensions enable $(UUID) 2>/dev/null || \
	  gsettings set org.gnome.shell enabled-extensions \
	    "$$(gsettings get org.gnome.shell enabled-extensions | sed "s/]/', '$(UUID)']/")"
	@echo "Starting nested GNOME Shell — close its window to exit."
	dbus-run-session -- gnome-shell --wayland

# Stream extension log lines (filter out unrelated noise)
logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep -i clockify

clean:
	rm -rf $(DIST_DIR)
	rm -f schemas/gschemas.compiled
