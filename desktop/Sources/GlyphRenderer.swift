import AppKit

/// Renders an icon's inner SVG body to NSImage via AppKit's native SVG support.
enum GlyphRenderer {
    static let inkHex = "#183153"

    static func svgDocument(body: String, width: Int, height: Int, colorHex: String?) -> String {
        var content = body
        if let colorHex {
            content = content.replacingOccurrences(of: "currentColor", with: colorHex)
        }
        return """
        <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)">\(content)</svg>
        """
    }

    static func image(body: String, width: Int, height: Int, colorHex: String? = inkHex) -> NSImage? {
        let document = svgDocument(body: body, width: width, height: height, colorHex: colorHex)
        return NSImage(data: Data(document.utf8))
    }

    /// Rasterizes the SVG at a given pixel size (aspect-fit) for PNG export.
    /// PNGs have no way to inherit a surrounding color, so `colorHex` defaults
    /// to the ink - callers pass the user's chosen export color instead.
    static func png(body: String, width: Int, height: Int, pixelSize: Int, colorHex: String? = inkHex) -> Data? {
        guard let image = image(body: body, width: width, height: height, colorHex: colorHex) else { return nil }
        let scale = CGFloat(pixelSize) / CGFloat(max(width, height))
        let target = NSSize(width: CGFloat(width) * scale, height: CGFloat(height) * scale)
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(target.width.rounded()),
            pixelsHigh: Int(target.height.rounded()),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else { return nil }
        rep.size = target
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: target))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
