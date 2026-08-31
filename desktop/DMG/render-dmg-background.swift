import AppKit

// Rasterizes DMG/dmg-background.svg at 1x and 2x, ready for tiffutil to
// combine into the multi-DPI dmg-background.tiff that Finder uses as the
// DMG window background (see scripts/make-dmg.sh).
// Run with: swift desktop/DMG/render-dmg-background.swift
//
// Same AppKit-native SVG-to-bitmap approach as AppIcon/render-appicon.swift.

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let svgURL = scriptDir.appendingPathComponent("dmg-background.svg")

guard let svgData = try? Data(contentsOf: svgURL) else {
    fatalError("Could not read \(svgURL.path)")
}

let variants: [(suffix: String, width: Int, height: Int)] = [
    ("", 660, 400),
    ("@2x", 1320, 800),
]

for (suffix, width, height) in variants {
    guard let image = NSImage(data: svgData) else {
        fatalError("Could not decode \(svgURL.path) as an SVG image")
    }
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        fatalError("Could not create bitmap rep for \(width)x\(height)")
    }
    rep.size = NSSize(width: 660, height: 400)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: 660, height: 400))
    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode PNG at \(width)x\(height)")
    }
    let outURL = scriptDir.appendingPathComponent("dmg-background\(suffix).png")
    try? png.write(to: outURL)
    print("wrote \(outURL.lastPathComponent) (\(width)x\(height))")
}

print("done - now combine with:")
print("tiffutil -cathidpicheck dmg-background.png dmg-background@2x.png -out dmg-background.tiff")
