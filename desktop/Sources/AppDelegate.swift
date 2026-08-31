import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let panelController = PanelController()
    private var hotkey: HotkeyManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item
        if let button = item.button {
            button.image = MenuBarIcon.image()
            button.image?.accessibilityDescription = "Motificons"
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.target = self
        }
        hotkey = HotkeyManager { [weak self] in
            self?.panelController.toggle()
        }
        // Scripted runs must stay accessory (no Dock icon, no activation
        // flash) regardless of the stored setting - only a real launch
        // elevates the policy.
        let qaArguments = ["--snapshot", "--copy", "--live-test", "--activate", "--show-settings", "--show-panel"]
        if !CommandLine.arguments.contains(where: qaArguments.contains) {
            DockIconSetting.apply()
        }
        // Deterministic verification hooks for scripted sessions - not user paths.
        if let flagIndex = CommandLine.arguments.firstIndex(of: "--snapshot"),
           CommandLine.arguments.count > flagIndex + 1 {
            Snapshotter.write(to: CommandLine.arguments[flagIndex + 1]) {
                NSApp.terminate(nil)
            }
            return
        }
        if let flagIndex = CommandLine.arguments.firstIndex(of: "--copy"),
           CommandLine.arguments.count > flagIndex + 1 {
            let query = CommandLine.arguments[flagIndex + 1]
            let formatArg = CommandLine.arguments.firstIndex(of: "--format")
                .flatMap { CommandLine.arguments.count > $0 + 1 ? CommandLine.arguments[$0 + 1] : nil }
                .flatMap(PreferredFormat.init(rawValue:))
            let pack = PackStore.locate()
            let resolved = query.contains(":")
                ? pack?.icons(byIds: [query]).first
                : pack?.search(query, limit: 1).first
            guard let hit = resolved, let body = pack?.body(for: hit) else {
                print("copy failed for query: \(query)")
                NSApp.terminate(nil)
                return
            }
            if let formatArg {
                Task { @MainActor in
                    let code: String?
                    if formatArg == .swiftui {
                        code = try? await ApiClient.renderSwiftUi(
                            iconId: "\(hit.prefix):\(hit.name)",
                            key: AccountStore.shared.apiKey ?? ""
                        )
                    } else {
                        code = CodeFormats.code(body: body, hit: hit, format: formatArg)
                    }
                    if let code, ClipboardWriter.copyText(code) {
                        print("=== \(formatArg.label) for \(hit.prefix):\(hit.name) ===")
                        print(code)
                    } else {
                        print("format copy failed: \(formatArg.label)")
                    }
                    NSApp.terminate(nil)
                }
                return
            }
            if ClipboardWriter.copy(body: body, width: hit.width, height: hit.height) {
                print("copied \(hit.prefix):\(hit.name)")
            } else {
                print("copy failed for query: \(query)")
            }
            NSApp.terminate(nil)
            return
        }
        if let flagIndex = CommandLine.arguments.firstIndex(of: "--live-test"),
           CommandLine.arguments.count > flagIndex + 1 {
            runLiveTest(outDir: CommandLine.arguments[flagIndex + 1])
        }
        if let flagIndex = CommandLine.arguments.firstIndex(of: "--activate"),
           CommandLine.arguments.count > flagIndex + 1 {
            let key = CommandLine.arguments[flagIndex + 1]
            let store = AccountStore.shared
            store.activate(key: key)
            Task { @MainActor in
                while store.status == .validating {
                    try? await Task.sleep(for: .milliseconds(100))
                }
                print("activation result: \(store.status)")
                NSApp.terminate(nil)
            }
            return
        }
        if CommandLine.arguments.contains("--show-panel") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.panelController.show()
            }
        }
        if CommandLine.arguments.contains("--show-settings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.openSettings()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    let windows = NSApp.windows.filter(\.isVisible).map { "\($0.title.isEmpty ? "untitled" : $0.title) visible \($0.frame.size)" }
                    print("settings check: opener=\(SettingsOpener.isVisible) windows=\(windows)")
                    NSApp.terminate(nil)
                }
            }
        }
    }

    /// Dock icon click (when the icon is visible) summons the search panel
    /// instead of doing nothing - the app has no regular windows to reopen.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        panelController.show()
        return false
    }

    @objc private func statusItemClicked(_ sender: Any?) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else {
            panelController.toggle()
        }
    }

    private func showMenu() {
        guard let item = statusItem else { return }
        let menu = NSMenu()
        menu.addItem(makeItem("Search icons", action: #selector(openPanel), key: ""))
        menu.addItem(makeItem("Settings...", action: #selector(openSettingsAction), key: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Motificons", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    private func makeItem(_ title: String, action: Selector, key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc private func openPanel() {
        panelController.show()
    }

    /// Scripted QA: types + arrows through the REAL event path (sendEvent ->
    /// key monitor -> field editor), then captures the live panel to PNG.
    private func runLiveTest(outDir: String) {
        func sendKey(_ characters: String, keyCode: UInt16, flags: NSEvent.ModifierFlags = []) {
            guard let panel = panelController.debugPanel else { return }
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(
                    with: type, location: .zero, modifierFlags: flags, timestamp: 0,
                    windowNumber: panel.windowNumber, context: nil,
                    characters: characters, charactersIgnoringModifiers: characters,
                    isARepeat: false, keyCode: keyCode
                ) {
                    NSApp.sendEvent(event)
                }
            }
        }

        // Sends arrow keys one at a time with a small run-loop yield between
        // each - a real user's keystrokes each arrive on their own run-loop
        // turn, so paging (an async task hopping back to the MainActor) gets
        // a chance to land between presses. A tight synchronous loop of
        // sendEvent calls never yields, so an in-flight page load can't
        // complete until the whole loop returns - that starved the paging
        // test and made "after paging" observe stale state.
        func sendDownArrows(_ remaining: Int, completion: @escaping () -> Void) {
            guard remaining > 0 else { completion(); return }
            sendKey("\u{F701}", keyCode: 125) // down
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                sendDownArrows(remaining - 1, completion: completion)
            }
        }

        func capture(_ name: String) {
            guard let view = panelController.debugPanel?.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
            else { return }
            view.cacheDisplay(in: view.bounds, to: rep)
            if let data = rep.representation(using: .png, properties: [:]) {
                try? data.write(to: URL(fileURLWithPath: outDir).appendingPathComponent("\(name).png"))
            }
        }

        let model = panelController.model
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [self] in
            panelController.show()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
                print("home: collections=\(model.collections.count) mode=\(model.mode)")
                sendKey("\u{F701}", keyCode: 125) // down
                sendKey("\u{F701}", keyCode: 125) // down
                print("home after 2x down: sel=\(model.selectedIndex)")
                capture("live-home")
                if let first = model.collections.first {
                    model.openCollection(first)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [self] in
                    print("collection: hits=\(model.hits.count) name=\(model.openCollectionName ?? "-")")
                    capture("live-collection")
                    sendKey("\u{F702}", keyCode: 123) // left arrow home test not needed; escape back:
                    _ = model.handleEscape()
                    for char in "rocket" {
                        sendKey(String(char), keyCode: 0)
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [self] in
                        print("search: query=\(model.query) hits=\(model.hits.count)")
                        sendKey("\u{F703}", keyCode: 124) // right
                        sendKey("\u{F701}", keyCode: 125) // down
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                            print("after arrows: sel=\(model.selectedIndex) hit=\(model.selectedHit.map { "\($0.prefix):\($0.name)" } ?? "none")")
                            capture("live-search")
                            sendKey("d", keyCode: 2, flags: [.command]) // Cmd+D toggle
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) { [self] in
                                print("cmdD: toast=\(model.toast?.message ?? "nil") saved=\(model.savedIcons.count)")
                                capture("live-toast")
                                // Chain the next phase AFTER the toast capture -
                                // parallel scheduling made captures race screens.
                                model.filtersOpen = true
                                model.filterSets = ["tabler"]
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [self] in
                                print("filtered: hits=\(model.hits.count) first=\(model.hits.first.map { "\($0.prefix):\($0.name)" } ?? "none")")
                                capture("live-filtered")
                                model.clearFilters()
                                model.filtersOpen = false
                                model.query = ""
                                capture("live-home2")
                                if let tabler = model.allSets.first(where: { $0.prefix == "tabler" }) {
                                    model.openSet(tabler)
                                }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
                                    print("set browse: hits=\(model.hits.count)")
                                    sendDownArrows(13) { [self] in // crosses page 1
                                        // One more beat: the last press's page-2 append (if
                                        // any) still needs a MainActor hop to land.
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [self] in
                                            print("after paging: sel=\(model.selectedIndex) hits=\(model.hits.count)")
                                            capture("live-set-browse")
                                            for char in "arrow" {
                                                sendKey(String(char), keyCode: 0)
                                            }
                                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [self] in
                                                let prefixes = Set(model.hits.map(\.prefix))
                                                print("set search: query=\(model.query) hits=\(model.hits.count) prefixes=\(prefixes)")
                                                capture("live-set-search")
                                                NSApp.terminate(nil)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @objc private func openSettingsAction() {
        openSettings()
    }

    private func openSettings() {
        panelController.hide()
        SettingsOpener.open()
    }
}
