#!/usr/bin/env bash
# Builds a Release .app and packages it into a distributable, compressed DMG.
#
# Usage: desktop/scripts/make-dmg.sh [--notarize]
#
#   (no flag)   Build + sign + package. Release signing identity comes from
#               project.yml's Release config ("Developer ID Application").
#               If that identity isn't in the keychain yet, this script warns
#               up front and xcodebuild will fail to sign - see project.yml.
#   --notarize  After building the DMG, submit it to Apple notarization
#               (xcrun notarytool, keychain profile "motificons-notary"),
#               staple the ticket, and verify with spctl/Gatekeeper. Requires
#               a "Developer ID Application" identity in the keychain.
#
# Output: desktop/dist/Motificons-<version>.dmg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_YML="$DESKTOP_DIR/project.yml"
DIST_DIR="$DESKTOP_DIR/dist"
NOTARY_PROFILE="motificons-notary"

# --- Parse arguments ---------------------------------------------------------
NOTARIZE=0
for arg in "$@"; do
  case "$arg" in
    --notarize)
      NOTARIZE=1
      ;;
    -h|--help)
      # Print only the leading comment block (the usage header above),
      # not every "# ---" section banner further down the file.
      awk '/^#!/{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      echo "usage: $(basename "$0") [--notarize]" >&2
      exit 1
      ;;
  esac
done

cd "$DESKTOP_DIR"

# --- Read MARKETING_VERSION from project.yml (no hardcoded version) --------
VERSION="$(grep -E '^[[:space:]]*MARKETING_VERSION:' "$PROJECT_YML" | head -1 | sed -E 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/')"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read MARKETING_VERSION from $PROJECT_YML" >&2
  exit 1
fi
echo "==> Packaging Motificons $VERSION"

# --- Check for a Developer ID signing identity ------------------------------
HAS_DEVELOPER_ID=0
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
  HAS_DEVELOPER_ID=1
fi

if [[ "$HAS_DEVELOPER_ID" -eq 1 ]]; then
  echo "    \"Developer ID Application\" identity found - Release build will be Developer ID signed"
else
  echo "warning: no \"Developer ID Application\" identity in this keychain." >&2
  echo "warning: the Release build will fail to code-sign until one is installed." >&2
  echo "warning: once installed, project.yml picks it up automatically - no script changes needed." >&2
fi

if [[ "$NOTARIZE" -eq 1 && "$HAS_DEVELOPER_ID" -eq 0 ]]; then
  echo "error: --notarize requires a \"Developer ID Application\" identity in the keychain" >&2
  exit 1
fi

# --- Generate + build Release ----------------------------------------------
echo "==> xcodegen generate"
xcodegen generate

echo "==> xcodebuild (Release)"
xcodebuild -project Motificons.xcodeproj \
  -scheme Motificons \
  -configuration Release \
  -derivedDataPath build \
  build

APP_PATH="$DESKTOP_DIR/build/Build/Products/Release/Motificons.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "error: build did not produce $APP_PATH" >&2
  exit 1
fi

# --- Verify bundled resources -----------------------------------------------
echo "==> Verifying bundled resources"
for resource in "pack.sqlite" "AppIcon.icns"; do
  if [[ ! -f "$APP_PATH/Contents/Resources/$resource" ]]; then
    echo "error: $APP_PATH/Contents/Resources/$resource is missing" >&2
    exit 1
  fi
done
echo "    Resources/pack.sqlite  present"
echo "    Resources/AppIcon.icns present"

# --- Verify code signature ---------------------------------------------------
echo "==> codesign --verify --deep --strict"
codesign --verify --deep --strict "$APP_PATH"
echo "    signature OK"

if [[ "$HAS_DEVELOPER_ID" -eq 1 ]]; then
  SIGN_AUTHORITY="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E '^Authority=' | head -1)"
  echo "    ${SIGN_AUTHORITY:-Authority=<unknown>}"
fi

# --- Stage + mount dirs, cleaned up on exit ----------------------------------
STAGING_DIR=""
MOUNT_DIR=""
cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
    rm -rf "$MOUNT_DIR"
  fi
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
}
trap cleanup EXIT

# --- Stage DMG contents -------------------------------------------------------
STAGING_DIR="$(mktemp -d /tmp/motificons-dmg.XXXXXX)"
echo "==> Staging DMG contents in $STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/Motificons.app"
# A symlink named "Applications" inside the staging dir - hdiutil turns this
# into the standard drag-to-install affordance. Creating the symlink only
# writes a file in $STAGING_DIR; it does not touch /Applications itself.
ln -s /Applications "$STAGING_DIR/Applications"

# Window background art (multi-DPI TIFF, regenerated from DMG/dmg-background.svg
# via DMG/render-dmg-background.swift + tiffutil). The dot-folder keeps it out
# of the visible window.
DMG_BACKGROUND="$DESKTOP_DIR/DMG/dmg-background.tiff"
if [[ ! -f "$DMG_BACKGROUND" ]]; then
  echo "error: $DMG_BACKGROUND is missing - run: swift desktop/DMG/render-dmg-background.swift && tiffutil -cathidpicheck dmg-background.png dmg-background@2x.png -out dmg-background.tiff" >&2
  exit 1
fi
mkdir "$STAGING_DIR/.background"
cp "$DMG_BACKGROUND" "$STAGING_DIR/.background/dmg-background.tiff"

# --- Build the DMG -------------------------------------------------------------
mkdir -p "$DIST_DIR"
OUT_DMG="$DIST_DIR/Motificons-$VERSION.dmg"
rm -f "$OUT_DMG"

# hdiutil's own -srcfolder auto-sizing has been observed to fail with
# "No space left on device" while copying into the freshly created image,
# even with tens of GB free on the host volume - its size estimate can be
# too tight. Pass an explicit -size instead: staged content size + 50%
# headroom + a fixed 32MB floor, comfortably covering filesystem/journal
# overhead.
STAGING_SIZE_MB="$(du -sm "$STAGING_DIR" | cut -f1)"
IMAGE_SIZE_MB=$(( STAGING_SIZE_MB + STAGING_SIZE_MB / 2 + 32 ))

# Two-step build: a read-write image first so Finder can lay out the window
# (background picture, icon positions, view options - stored in the volume's
# .DS_Store), then convert to the compressed read-only UDZO users download.
RW_DMG="$DIST_DIR/Motificons-$VERSION.rw.dmg"
rm -f "$RW_DMG"

echo "==> hdiutil create (read-write, for Finder layout)"
hdiutil create -volname "Motificons" \
  -srcfolder "$STAGING_DIR" \
  -size "${IMAGE_SIZE_MB}m" \
  -ov -format UDRW \
  "$RW_DMG"

echo "==> Finder window layout"
# Detach any stale volume with our name first - "tell disk Motificons" would
# otherwise script the wrong mount.
if [[ -d "/Volumes/Motificons" ]]; then
  hdiutil detach "/Volumes/Motificons" -quiet 2>/dev/null || true
fi
# No -mountpoint: Finder scripting addresses the disk by volume name, and the
# volume must be Finder-visible (no -nobrowse) for "tell disk" to see it.
hdiutil attach "$RW_DMG" -noautoopen -quiet
FINDER_LAYOUT_OK=1
osascript <<'APPLESCRIPT' || FINDER_LAYOUT_OK=0
tell application "Finder"
  tell disk "Motificons"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    -- 655x400 content area; the extra 28pt
    -- on the bottom edge absorbs the title bar included in window bounds.
    set the bounds of container window to {400, 120, 1055, 548}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 13
    set background picture of viewOptions to file ".background:dmg-background.tiff"
    set position of item "Motificons.app" of container window to {180, 200}
    set position of item "Applications" of container window to {480, 200}
    -- Reopen once so Finder flushes the view options into .DS_Store, and
    -- set the bounds AGAIN after the reopen: on first open Finder can
    -- restore its default window size over the bounds set above (observed
    -- 2026-08-11 - the shipped window opened far wider than the background).
    close
    open
    set the bounds of container window to {400, 120, 1055, 548}
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
sync
hdiutil detach "/Volumes/Motificons" -quiet 2>/dev/null || hdiutil detach "/Volumes/Motificons" -force -quiet

if [[ "$FINDER_LAYOUT_OK" -eq 0 ]]; then
  echo "error: Finder layout failed (osascript needs Automation permission for Finder)" >&2
  rm -f "$RW_DMG"
  exit 1
fi

echo "==> hdiutil convert (UDZO)"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -ov -o "$OUT_DMG"
rm -f "$RW_DMG"

# --- Sign the DMG container itself -------------------------------------------
# Signing the .app inside is not enough: Gatekeeper's "primary signature"
# assessment for a downloaded disk image (spctl -t open --context
# context:primary-signature) checks the DMG container's own signature, which
# hdiutil create never adds. Verified empirically - without this, notarization
# still succeeds and staples fine, but that specific spctl check reports
# "rejected / source=no usable signature" even though the stapled ticket and
# the app inside are both valid. Sign before submitting for notarization.
if [[ "$HAS_DEVELOPER_ID" -eq 1 ]]; then
  echo "==> codesign the DMG container"
  codesign --force --sign "Developer ID Application" --timestamp "$OUT_DMG"
fi

# --- Notarize (optional) ------------------------------------------------------
if [[ "$NOTARIZE" -eq 1 ]]; then
  echo "==> xcrun notarytool submit (keychain profile: $NOTARY_PROFILE)"
  xcrun notarytool submit "$OUT_DMG" --keychain-profile "$NOTARY_PROFILE" --wait

  echo "==> xcrun stapler staple"
  xcrun stapler staple "$OUT_DMG"

  echo "==> Gatekeeper verification"
  GATEKEEPER_OK=1

  echo "    spctl -a -vv -t open --context context:primary-signature (DMG)"
  if spctl -a -vv -t open --context context:primary-signature "$OUT_DMG"; then
    echo "    DMG assessment: PASS"
  else
    echo "    DMG assessment: FAIL"
    GATEKEEPER_OK=0
  fi

  echo "    Mounting DMG to verify the stapled .app"
  MOUNT_DIR="$(mktemp -d /tmp/motificons-verify.XXXXXX)"
  hdiutil attach "$OUT_DMG" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

  echo "    spctl -a -vv (mounted .app)"
  if spctl -a -vv "$MOUNT_DIR/Motificons.app"; then
    echo "    App assessment: PASS"
  else
    echo "    App assessment: FAIL"
    GATEKEEPER_OK=0
  fi

  hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
  rm -rf "$MOUNT_DIR"
  MOUNT_DIR=""

  if [[ "$GATEKEEPER_OK" -eq 1 ]]; then
    echo "==> Notarization: PASS"
  else
    echo "==> Notarization: FAIL" >&2
    exit 1
  fi
fi

# --- Summary -------------------------------------------------------------------
DMG_SIZE="$(du -h "$OUT_DMG" | cut -f1 | xargs)"
DMG_SHA256="$(shasum -a 256 "$OUT_DMG" | cut -d' ' -f1)"

echo "==> Done"
echo "path:   $OUT_DMG"
echo "size:   $DMG_SIZE"
echo "sha256: $DMG_SHA256"

if [[ "$NOTARIZE" -eq 1 ]]; then
  echo ""
  echo "==> Upload command (not run - copy/paste when ready):"
  echo "pnpm dlx wrangler r2 object put motificons-icons/desktop/Motificons-$VERSION.dmg --file=\"$OUT_DMG\""
fi
