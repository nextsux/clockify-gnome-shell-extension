UUID      = clockify-tracker@yourdomain.com
DIST_DIR  = dist
ZIP_NAME  = $(UUID).zip

# Files that go into the packaged extension
SOURCES = extension.js prefs.js stylesheet.css metadata.json
SCHEMA_SRC = schemas/org.gnome.shell.extensions.clockify-tracker.gschema.xml

.PHONY: all compile install install-user clean dist zip

all: compile

# Compile GSettings schema (required before install / local test)
compile:
	glib-compile-schemas schemas/

# Install for the current user (symlink-free, full copy)
install-user: compile
	mkdir -p ~/.local/share/gnome-shell/extensions/$(UUID)
	cp $(SOURCES) ~/.local/share/gnome-shell/extensions/$(UUID)/
	cp -r schemas/ ~/.local/share/gnome-shell/extensions/$(UUID)/schemas/

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

clean:
	rm -rf $(DIST_DIR)
	rm -f schemas/gschemas.compiled
