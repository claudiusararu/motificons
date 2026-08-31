import AppKit
import SwiftUI

/// Opens the Settings window from anywhere (footer gear, menu bar menu).
/// Deliberately does NOT use the SwiftUI Settings scene: in an LSUIElement
/// (no-Dock) app on macOS 14+ its selector reports handled but the window
/// never becomes visible. We own the window instead and order it front
/// regardless of app activation, so it can never silently fail.
@MainActor
enum SettingsOpener {
    private static var window: NSWindow?

    static func open() {
        let window = self.window ?? makeWindow()
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
    }

    static var isVisible: Bool { window?.isVisible ?? false }

    private static func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 400),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Motificons Settings"
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.contentView = NSHostingView(rootView: SettingsView())
        return window
    }
}
