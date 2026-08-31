import AppKit

/// The status item glyph: the favicon's star-in-rounded-square, as a template
/// image (monochrome + alpha) so macOS adapts it to light/dark menu bars.
/// Geometry mirrors app/public/favicon.svg - keep them in sync.
enum MenuBarIcon {
    static func image() -> NSImage? {
        let svg = """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="36" height="36">
          <path fill-rule="evenodd" fill="#000000"
                d="M10.5 3H21.5A7.5 7.5 0 0 1 29 10.5V21.5A7.5 7.5 0 0 1 21.5 29H10.5A7.5 7.5 0 0 1 3 21.5V10.5A7.5 7.5 0 0 1 10.5 3Z
                   M16 8.57 18.42 13.49 23.78 14.27 19.89 18.08 20.75 23.43 16 20.92 11.25 23.43 12.11 18.08 8.22 14.27 11.58 13.49Z"/>
        </svg>
        """
        guard let image = NSImage(data: Data(svg.utf8)) else { return nil }
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        return image
    }
}
