import AppKit

/// One copy, several representations at once: SVG text (code editors, Figma),
/// public.svg-image data, and a rendered PNG (Photoshop and friends take this -
/// they do not accept SVG text). Receivers pick the flavor they understand.
enum ClipboardWriter {
    static let pngPixelSizeKey = "pngPixelSize"
    static let iconColorHexKey = "iconColorHex"

    static var pngPixelSize: Int {
        let stored = UserDefaults.standard.integer(forKey: pngPixelSizeKey)
        return stored > 0 ? stored : 512
    }

    /// The user's chosen export color (Settings > General > Icon color).
    /// nil when Automatic - absent or empty stored value.
    static var iconColorHex: String? {
        guard let stored = UserDefaults.standard.string(forKey: iconColorHexKey), !stored.isEmpty else {
            return nil
        }
        return stored
    }

    /// Plain text copy (generated component code, data URIs).
    @discardableResult
    static func copyText(_ text: String) -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    @discardableResult
    static func copy(body: String, width: Int, height: Int, pngOnly: Bool = false) -> Bool {
        // SVG: Automatic leaves currentColor untouched (inherits the
        // surrounding color); a chosen color is baked into both SVG flavors.
        let svg = GlyphRenderer.svgDocument(body: body, width: width, height: height, colorHex: iconColorHex)
        // PNG can't inherit anything, so Automatic falls back to the ink.
        let png = GlyphRenderer.png(
            body: body, width: width, height: height, pixelSize: pngPixelSize,
            colorHex: iconColorHex ?? GlyphRenderer.inkHex
        )

        let item = NSPasteboardItem()
        if pngOnly {
            guard let png else { return false }
            item.setData(png, forType: .png)
        } else {
            item.setString(svg, forType: .string)
            item.setData(Data(svg.utf8), forType: NSPasteboard.PasteboardType("public.svg-image"))
            if let png {
                item.setData(png, forType: .png)
            }
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.writeObjects([item])
    }
}
