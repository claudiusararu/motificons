import AppKit

/// Dock icon visibility, driven by the "hideDockIcon" default (false = icon
/// visible, which changes the pre-toggle behavior on purpose - Info.plist
/// stays LSUIElement so a pre-UI launch never flashes a Dock icon). Applied
/// at launch and from the Settings toggle, so switching takes effect
/// instantly with no relaunch.
enum DockIconSetting {
    static let defaultsKey = "hideDockIcon"

    static var isHidden: Bool {
        UserDefaults.standard.bool(forKey: defaultsKey)
    }

    @MainActor
    static func apply() {
        NSApp.setActivationPolicy(isHidden ? .accessory : .regular)
    }
}
