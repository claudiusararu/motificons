import AppKit
import SwiftUI

/// Owns the floating search panel: borderless, key-capable, Spotlight-style
/// placement in the upper third of the screen, toggled by hotkey or menu bar click.
@MainActor
final class PanelController {
    let model = PanelViewModel()
    private var panel: NSPanel?
    private var keyMonitor: Any?

    init() {
        model.onDismiss = { [weak self] in self?.hide() }
    }

    func toggle() {
        if let panel, panel.isVisible {
            hide()
        } else {
            show()
        }
    }

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        model.refreshCollections()
        position(panel)
        // Spotlight model: the nonactivating panel becomes key WITHOUT app
        // activation - shows on first hotkey press and the app the user came
        // from stays active, so Cmd+V after copy needs no app switch.
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        installKeyMonitor()
        DispatchQueue.main.async { [weak self] in
            guard let self, let panel = self.panel, panel.isVisible else { return }
            panel.makeKey()
            self.model.focusRequest += 1
        }
    }

    var debugPanel: NSPanel? { panel }

    func hide() {
        removeKeyMonitor()
        panel?.orderOut(nil)
    }

    /// Arrows/Enter belong to the grid even while the search field has focus.
    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let panel = self.panel, panel.isVisible,
                  event.window === panel || panel.isKeyWindow
            else { return event }
            return self.model.handleKey(event) ? nil : event
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor {
            NSEvent.removeMonitor(keyMonitor)
            self.keyMonitor = nil
        }
    }

    private func makePanel() -> NSPanel {
        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 440),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        // Esc is layered: filters -> collection -> close (model decides).
        panel.onEscape = { [weak self] in
            self?.model.handleEscape() ?? false
        }
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.contentView = NSHostingView(rootView: SearchPanelView(model: model))
        // Clicking anywhere outside the panel dismisses it.
        NotificationCenter.default.addObserver(
            forName: NSWindow.didResignKeyNotification,
            object: panel,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.hide() }
        }
        return panel
    }

    private func position(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        let size = panel.frame.size
        let x = frame.midX - size.width / 2
        let y = frame.minY + frame.height * 0.70 - size.height / 2
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}

private final class KeyablePanel: NSPanel {
    var onEscape: (() -> Bool)?

    override var canBecomeKey: Bool { true }

    // Esc anywhere in the panel: consumed by the model's layered handling
    // (close filters, leave collection) before it closes the panel.
    override func cancelOperation(_ sender: Any?) {
        if onEscape?() != true {
            orderOut(nil)
        }
    }
}
