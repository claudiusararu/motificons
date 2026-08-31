import AppKit
import SwiftUI

/// Debug-only visual verification: hosts the real SwiftUI views in offscreen
/// windows and captures them via cacheDisplay (renders AppKit-backed controls
/// too, unlike ImageRenderer, and needs no Screen Recording permission).
/// Not a user path - reached only via `--snapshot <dir>`.
@MainActor
enum Snapshotter {
    static func write(to directory: String, completion: @escaping () -> Void) {
        let dir = URL(fileURLWithPath: directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let panelModel = PanelViewModel()
        panelModel.query = "arrow right"
        let panelWindow = host(SearchPanelView(model: panelModel), size: NSSize(width: 680, height: 440))
        let settingsWindow = host(SettingsView(), size: NSSize(width: 460, height: 380))
        // About tab content alone (no TabView chrome) - QA-only view of the
        // one tab TabView's own selection state can't be forced into here.
        // AboutSettingsView has no frame of its own (the real TabView
        // supplies one); constrain it here so the offscreen host doesn't
        // let its Spacer balloon to an unbounded ideal height.
        let aboutWindow = host(
            AboutSettingsView().frame(width: 460, height: 320),
            size: NSSize(width: 460, height: 320)
        )

        // Status icon proof: draw the template glyph dark-on-light at 2x.
        if let icon = MenuBarIcon.image() {
            let size = NSSize(width: 36, height: 36)
            guard let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: 72, pixelsHigh: 72, bitsPerSample: 8,
                samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ) else { return }
            rep.size = size
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSColor.white.setFill()
            NSRect(origin: .zero, size: size).fill()
            icon.draw(in: NSRect(x: 9, y: 9, width: 18, height: 18))
            NSGraphicsContext.restoreGraphicsState()
            if let data = rep.representation(using: .png, properties: [:]) {
                try? data.write(to: dir.appendingPathComponent("statusicon.png"))
            }
        }

        // Give SwiftUI a runloop beat to lay out (and the search to run) before capturing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            capture(panelWindow, name: "panel", in: dir)
            capture(settingsWindow, name: "settings", in: dir)
            capture(aboutWindow, name: "about", in: dir)
            panelWindow.orderOut(nil)
            settingsWindow.orderOut(nil)
            aboutWindow.orderOut(nil)
            completion()
        }
    }

    private static func host(_ view: some View, size: NSSize) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.contentView = NSHostingView(rootView: view)
        // Off the visible desktop but still windowserver-real so layout runs.
        window.setFrameOrigin(NSPoint(x: -10_000, y: -10_000))
        window.orderFrontRegardless()
        return window
    }

    private static func capture(_ window: NSWindow, name: String, in dir: URL) {
        guard let view = window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let data = rep.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: dir.appendingPathComponent("\(name).png"))
    }
}
