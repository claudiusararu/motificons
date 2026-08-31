import AppKit

// Rasterizes AppIcon/appicon.svg into every size macOS's iconset format
// expects, then leaves AppIcon.iconset/ ready for `iconutil -c icns`.
// Run with: swift desktop/AppIcon/render-appicon.swift
//
// Uses the same AppKit-native SVG-to-bitmap approach as GlyphRenderer.png -
// NSImage(data:) for decoding, an offscreen NSBitmapImageRep for rasterizing
// at an exact pixel size.

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let svgURL = scriptDir.appendingPathComponent("appicon.svg")
let iconsetDir = scriptDir.appendingPathComponent("AppIcon.iconset")

guard let svgData = try? Data(contentsOf: svgURL) else {
    fatalError("Could not read \(svgURL.path)")
}

try? FileManager.default.createDirectory(at: iconsetDir, withIntermediateDirectories: true)

let sizes: [(name: String, pixels: Int)] = [
    ("icon_16x16", 16),
    ("icon_16x16@2x", 32),
    ("icon_32x32", 32),
    ("icon_32x32@2x", 64),
    ("icon_128x128", 128),
    ("icon_128x128@2x", 256),
    ("icon_256x256", 256),
    ("icon_256x256@2x", 512),
    ("icon_512x512", 512),
    ("icon_512x512@2x", 1024),
]

for (name, pixels) in sizes {
    guard let image = NSImage(data: svgData) else {
        fatalError("Could not decode \(svgURL.path) as an SVG image")
    }
    let size = NSSize(width: pixels, height: pixels)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        fatalError("Could not create bitmap rep for \(name)")
    }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode PNG for \(name)")
    }
    let outURL = iconsetDir.appendingPathComponent("\(name).png")
    try? png.write(to: outURL)
    print("wrote \(outURL.lastPathComponent) (\(pixels)x\(pixels))")
}

print("done: \(iconsetDir.path)")
