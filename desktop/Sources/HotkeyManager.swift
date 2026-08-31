import AppKit
import Carbon.HIToolbox

/// Registers the global summon shortcut via Carbon RegisterEventHotKey -
/// no accessibility permission needed. Default: Control+Option+Space.
/// Configurable shortcut recording is not implemented yet.
final class HotkeyManager {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private let onPress: () -> Void

    init(onPress: @escaping () -> Void) {
        self.onPress = onPress
        register()
    }

    private func register() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { manager.onPress() }
            return noErr
        }, 1, &eventType, selfPtr, &eventHandler)

        let hotKeyID = EventHotKeyID(signature: OSType(0x4D_54_49_43), id: 1) // 'MTIC'
        RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(controlKey | optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    deinit {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}
