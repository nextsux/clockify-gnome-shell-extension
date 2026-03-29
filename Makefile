UUID      = clockify-tracker@smoula.net
DOMAIN    = clockify-tracker
DIST_DIR  = dist
ZIP_NAME  = $(UUID).zip

# Files that go into the packaged extension
SOURCES = extension.js prefs.js stylesheet.css metadata.json
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

# Launch a nested GNOME Shell for development.
# Each run is a fresh GJS process — no ES-module cache, no stale code.
# console.log output appears directly in this terminal, not in the journal.
# On GNOME 44+, --nested was removed; gnome-shell auto-nests when
# WAYLAND_DISPLAY is already set (Mutter opens a window in the parent compositor).
run: install-user
	@echo "Starting nested GNOME Shell — close its window to exit."
	dbus-run-session -- gnome-shell --wayland

# Quick in-session reload (GNOME 45+ / Wayland).
# Faster than 'make run' but GJS may serve cached modules — use 'make run'
# if you suspect stale code.
reload: install-user
	@gnome-extensions disable $(UUID) 2>/dev/null; sleep 0.5
	@gnome-extensions enable $(UUID)
	@echo "Reloaded. Logs: make logs"

# Stream extension log lines from the user journal (for 'make reload' workflow)
logs:
	journalctl --user -f -o cat | grep -i clockify

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
