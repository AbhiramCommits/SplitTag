#!/bin/sh
# Playwright's bundled Firefox cannot start on macOS 27 from a direct exec:
# its app-data directory resolves to the TCC-protected real Firefox folder.
# Starting it with `-app` and a renamed application identity sidesteps that;
# the content sandbox is disabled for the same OS-version workaround. This
# wrapper is only used by the Playwright config on macOS, and Linux CI launches
# Firefox normally.
#
# The -app ini must live inside the app bundle so Firefox resolves its own
# resources; a copy in /tmp makes it fail to load browser modules.
set -e

CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
BASE="$(ls -d "$CACHE"/firefox-*/firefox/Nightly.app 2>/dev/null | sort -V | tail -1)"
if [ -z "$BASE" ]; then
  echo "SplitTag: Playwright Firefox bundle not found under $CACHE" >&2
  exit 1
fi

BIN="$BASE/Contents/MacOS/firefox"
INI_DIR="$BASE/Contents/Resources/browser"
INI_SRC="$BASE/Contents/Resources/application.ini"
INI="$INI_DIR/application.ini"

mkdir -p "$INI_DIR"
sed \
  -e 's/^Vendor=Mozilla$/Vendor=PlaywrightFirefox/' \
  -e 's/^Name=Firefox$/Name=PlaywrightFirefox/' \
  "$INI_SRC" > "$INI"

exec "$BIN" -app "$INI" "$@"
