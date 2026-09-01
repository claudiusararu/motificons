import AppKit
import ServiceManagement
import SwiftUI

/// "#RRGGBB" <-> Color, sRGB - used by the Icon color picker (Settings > General).
private extension Color {
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255,
            opacity: 1
        )
    }

    /// nil if the color can't be resolved in sRGB (e.g. a pattern color).
    var hexString: String? {
        guard let rgb = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        return String(
            format: "#%02X%02X%02X",
            Int((rgb.redComponent * 255).rounded()),
            Int((rgb.greenComponent * 255).rounded()),
            Int((rgb.blueComponent * 255).rounded())
        )
    }
}

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem { Label("General", systemImage: "gearshape") }
            AccountSettingsView()
                .tabItem { Label("Account", systemImage: "key") }
            AboutSettingsView()
                .tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 460)
        .background(Theme.canvas)
    }
}

struct AccountSettingsView: View {
    @ObservedObject var account: AccountStore = .shared
    @State private var keyInput = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("API key")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Text("Paste the API key from your Motificons dashboard. The same key powers your coding agent and this app.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            if account.isActive, let key = account.apiKey {
                HStack(spacing: 8) {
                    Text("Active - \(String(key.prefix(11)))...")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.teal))
                    Button("Remove key") {
                        account.deactivate()
                    }
                    .foregroundStyle(Theme.danger)
                }
            } else {
                HStack(spacing: 8) {
                    SecureField("mk_...", text: $keyInput)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Theme.surface)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(Theme.ink, lineWidth: 2)
                        )
                        .onSubmit(activate)
                    Button(account.status == .validating ? "Checking..." : "Activate", action: activate)
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                        .foregroundStyle(Theme.ink)
                        .disabled(account.status == .validating || keyInput.isEmpty)
                }
                if case .invalid(let message) = account.status {
                    Text(message)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
    }

    private func activate() {
        guard !keyInput.isEmpty else { return }
        account.activate(key: keyInput)
        keyInput = ""
    }
}

struct GeneralSettingsView: View {
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var launchError: String? = nil
    @State private var hideDockIcon = DockIconSetting.isHidden
    @State private var preferredFormat = PreferredFormat.stored
    @State private var collections: [ApiClient.CollectionSummary] = []
    @State private var defaultCollectionId =
        UserDefaults.standard.string(forKey: PanelViewModel.defaultCollectionKey) ?? ""
    @State private var iconColorHex =
        UserDefaults.standard.string(forKey: ClipboardWriter.iconColorHexKey) ?? ""

    /// Automatic shows the ink as the picker's swatch, but only an explicit
    /// pick (the `set` below) writes a hex to storage.
    private var iconColorBinding: Binding<Color> {
        Binding(
            get: { Color(hex: iconColorHex) ?? Theme.ink },
            set: { newColor in
                guard let hex = newColor.hexString else { return }
                iconColorHex = hex
                UserDefaults.standard.set(hex, forKey: ClipboardWriter.iconColorHexKey)
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Preferred code format")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Picker("", selection: $preferredFormat) {
                    ForEach(PreferredFormat.allCases) { format in
                        Text(format.label).tag(format)
                    }
                }
                .labelsHidden()
                .frame(width: 150)
                .onChange(of: preferredFormat) { _, format in
                    PreferredFormat.stored = format
                }
            }
            Text("In the search panel, Option+Enter copies the selected icon in this format. Enter always copies SVG, Cmd+Enter a PNG.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            HStack(spacing: 8) {
                Text("Default collection")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Picker("", selection: $defaultCollectionId) {
                    Text("Automatic").tag("")
                    ForEach(collections) { collection in
                        Text(collection.name).tag(collection.id)
                    }
                }
                .labelsHidden()
                .frame(width: 180)
                .onChange(of: defaultCollectionId) { _, id in
                    if id.isEmpty {
                        UserDefaults.standard.removeObject(forKey: PanelViewModel.defaultCollectionKey)
                    } else {
                        UserDefaults.standard.set(id, forKey: PanelViewModel.defaultCollectionKey)
                    }
                }
            }
            Text("Cmd+D in the search panel saves the selected icon to this collection - press it again to remove the icon. \"Automatic\" uses your only collection when you have just one.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            HStack(spacing: 8) {
                Text("Icon color")
                    .foregroundStyle(Theme.ink)
                Spacer()
                if !iconColorHex.isEmpty {
                    Button("Automatic") {
                        iconColorHex = ""
                        UserDefaults.standard.removeObject(forKey: ClipboardWriter.iconColorHexKey)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .underline()
                }
                ColorPicker("", selection: iconColorBinding, supportsOpacity: false)
                    .labelsHidden()
            }
            Text("Applies to copied PNGs and to the SVG you paste into design tools. \"Automatic\" keeps SVG code inheriting the surrounding color (currentColor) and renders PNGs in the default dark ink.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            HStack(spacing: 8) {
                Text("Launch Motificons at login")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Toggle("", isOn: $launchAtLogin)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .tint(Theme.ink)
                    .onChange(of: launchAtLogin) { _, enabled in
                        setLaunchAtLogin(enabled)
                    }
            }
            if let launchError {
                Text(launchError)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
            }

            HStack(spacing: 8) {
                Text("Hide icon from Dock")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Toggle("", isOn: $hideDockIcon)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .tint(Theme.ink)
                    .onChange(of: hideDockIcon) { _, hidden in
                        UserDefaults.standard.set(hidden, forKey: DockIconSetting.defaultsKey)
                        DockIconSetting.apply()
                    }
            }
            Text("The app always lives in the menu bar. Hiding the Dock icon keeps it menu-bar only.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            HStack(spacing: 8) {
                Text("Summon shortcut")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text("⌃ ⌥ Space")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Theme.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(Theme.cardShadow, lineWidth: 1)
                    )
            }
            Text("Custom shortcut recording is coming in a later build.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
            Spacer(minLength: 0)
        }
        .padding(20)
        .task {
            guard AccountStore.shared.isActive, let key = AccountStore.shared.apiKey else { return }
            do {
                collections = try await ApiClient.collections(key: key)
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
            } catch {
                // Network trouble: leave the picker showing whatever it had.
            }
        }
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            launchError = nil
        } catch {
            launchAtLogin = SMAppService.mainApp.status == .enabled
            launchError = "Could not update the login item: \(error.localizedDescription)"
        }
    }
}

struct AboutSettingsView: View {
    private var versionString: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "-"
        let build = info?["CFBundleVersion"] as? String ?? "-"
        return "Version \(version) (\(build))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Motificons")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.ink)
            Text(versionString)
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)

            Text("Instant icon search from the menu bar - copy as SVG, PNG or code, with collections synced across your devices. Free with your Motificons account.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            Text("License")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Text("Motificons is free, open-source software under the MIT license - github.com/claudiusararu/motificons.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text("The icon library aggregates open-source icon sets; each set keeps its own license. Full per-set licenses:")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button("motificons.app/licenses") {
                NSWorkspace.shared.open(URL(string: "https://motificons.app/licenses")!)
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .underline()

            Spacer(minLength: 0)
        }
        .padding(20)
    }
}
