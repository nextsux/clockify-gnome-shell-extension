UUID      = clockify-tracker@smoula.net
DOMAIN    = clockify-tracker
DIST_DIR  = dist
ZIP_NAME  = $(UUID).zip

# Files that go into the packaged extension
SOURCES = extension.js prefs.js stylesheet.css metadata.json icon.svg
SCHEMA_SRC = schemas/org.gnome.shell.extensions.clockify-tracker.gschema.xml

.PHONY: all compile mo pot install install-user run reload logs clean dist zip

all: compile mo

# Compile GSettings schema (required before install / local test)
compile:
	glib-compile-schemas schemas/

# Compile all .po translation files to binary .mo
mo:
	@find locale -name '*.po' 2>/dev/null | while read po; do \
	    dir=$$(dirname "$$po"); \
	    echo "  MO  $$po"; \
	    msgfmt -o "$$dir/$$(basename $$po .po).mo" "$$po"; \
	done

# Extract translatable strings into a .pot template (for translators)
pot:
	mkdir -p locale
	xgettext --from-code=UTF-8 --language=JavaScript \
	    --keyword=_ --keyword=N_ \
	    --package-name="$(UUID)" \
	    -o locale/$(UUID).pot \
	    extension.js prefs.js
	@echo "Template written to locale/$(UUID).pot"

# Install for the current user.
# If the extension dir is already a symlink to this repo, skip the copy (files are identical).
install-user: compile mo
	@DEST=~/.local/share/gnome-shell/extensions/$(UUID); \
	if [ -L "$$DEST" ] && [ "$$(readlink -f $$DEST)" = "$$(pwd)" ]; then \
	    echo "Extension already symlinked to this repo — skipping copy."; \
	else \
	    mkdir -p "$$DEST"; \
	    cp $(SOURCES) "$$DEST/"; \
	    cp -r schemas/ "$$DEST/schemas/"; \
	    [ -d locale ] && cp -r locale/ "$$DEST/locale/" || true; \
	fi

# Install system-wide (requires root)
install: compile mo
	mkdir -p /usr/share/gnome-shell/extensions/$(UUID)
	cp $(SOURCES) /usr/share/gnome-shell/extensions/$(UUID)/
	cp -r schemas/ /usr/share/gnome-shell/extensions/$(UUID)/schemas/
	[ -d locale ] && cp -r locale/ /usr/share/gnome-shell/extensions/$(UUID)/locale/ || true
	glib-compile-schemas /usr/share/gnome-shell/extensions/$(UUID)/schemas/

# Launch a nested GNOME Shell for development (GNOME 44+).
# --devkit replaces the removed --nested flag; opens a window inside the
# current compositor. console.log output appears directly in this terminal.
run: install-user
	@echo "Starting nested GNOME Shell — close its window to exit."
	dbus-run-session env NO_AT_BRIDGE=1 gnome-shell --devkit --wayland

# Quick in-session reload without a nested window.
reload: install-user
	@echo "Reloading $(UUID)…"
	@gnome-extensions disable $(UUID) 2>/dev/null; sleep 0.5
	@gnome-extensions enable $(UUID)
	@echo "Done. Run 'make logs' to watch output."

# Stream extension log lines.
# GNOME 45+ tags console.log() output with GNOME_SHELL_EXTENSION_UUID in the
# user journal — this is the most reliable filter on modern systemd setups.
logs:
	@echo "Tailing logs for $(UUID) — Ctrl-C to stop."
	journalctl --user -f GNOME_SHELL_EXTENSION_UUID=$(UUID)

# Create distributable zip (suitable for extensions.gnome.org upload)
zip: compile mo
	mkdir -p $(DIST_DIR)
	zip -j $(DIST_DIR)/$(ZIP_NAME) $(SOURCES)
	zip $(DIST_DIR)/$(ZIP_NAME) schemas/$(notdir $(SCHEMA_SRC))
	zip $(DIST_DIR)/$(ZIP_NAME) schemas/gschemas.compiled
	find locale -name '*.mo' 2>/dev/null | while read f; do zip $(DIST_DIR)/$(ZIP_NAME) "$$f"; done

dist: zip
	@echo "Package ready: $(DIST_DIR)/$(ZIP_NAME)"

clean:
	rm -rf $(DIST_DIR)
	rm -f schemas/gschemas.compiled
	find locale -name '*.mo' -delete 2>/dev/null || true
