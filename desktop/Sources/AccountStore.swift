import Foundation
import SwiftUI

/// The activation gate: nothing works - local search included -
/// until a dashboard mk_ key validates against /v1/validate. Once active,
/// the state is remembered and re-checked in the background at launch; a
/// 401 (revoked/regenerated key) drops the app back to the gate.
@MainActor
final class AccountStore: ObservableObject {
    static let shared = AccountStore()

    enum Status: Equatable {
        case noKey
        case validating
        case active
        case invalid(String)
    }

    @Published private(set) var status: Status

    private static let activatedKey = "activated"
    private static let apiKeyKey = "apiKey"

    private var periodicRevalidationTask: Task<Void, Never>?
    private static let qaArguments: Set<String> = [
        "--snapshot", "--copy", "--live-test", "--activate", "--show-settings", "--show-panel"
    ]
    /// Scripted/QA runs must stay deterministic - no background timer
    /// ticking mid-assertion. Mirrors the qaArguments gate in AppDelegate.
    private static var isQARun: Bool {
        CommandLine.arguments.contains { qaArguments.contains($0) }
    }

    var isActive: Bool { status == .active }

    // Stored in UserDefaults, NOT Keychain: the key only
    // reaches icon collections and is revocable in seconds from the dashboard,
    // while Keychain access dialogs scare users of a freshly installed app.
    var apiKey: String? {
        UserDefaults.standard.string(forKey: Self.apiKeyKey)
    }

    init() {
        // One-time cleanup of the pre-decision Keychain item; deleting never
        // reads the secret, so it can never trigger the access dialog.
        Keychain.delete(account: "apiKey")
        if UserDefaults.standard.bool(forKey: Self.activatedKey),
           UserDefaults.standard.string(forKey: Self.apiKeyKey) != nil {
            status = .active
            revalidateInBackground()
            startPeriodicRevalidation()
        } else {
            status = .noKey
        }
    }

    func activate(key rawKey: String) {
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.hasPrefix("mk_"), key.count > 10 else {
            status = .invalid("That does not look like a Motificons key - it starts with mk_.")
            return
        }
        status = .validating
        Task {
            do {
                _ = try await ApiClient.validate(key: key)
                UserDefaults.standard.set(key, forKey: Self.apiKeyKey)
                UserDefaults.standard.set(true, forKey: Self.activatedKey)
                status = .active
                startPeriodicRevalidation()
            } catch let ApiClient.ApiError.unauthorized(message) {
                status = .invalid(message)
            } catch {
                status = .invalid("Could not reach Motificons - check your connection and try again.")
            }
        }
    }

    func deactivate() {
        UserDefaults.standard.removeObject(forKey: Self.apiKeyKey)
        UserDefaults.standard.set(false, forKey: Self.activatedKey)
        status = .noKey
        stopPeriodicRevalidation()
    }

    /// Any ApiError.unauthorized from ANY server call means the key is dead
    /// NOW - drop straight to the activation gate, don't wait for the next
    /// launch's revalidation. Every ApiClient call site (PanelViewModel,
    /// SettingsView, and this class's own launch-time and periodic rechecks)
    /// routes 401s through here so the state and message are identical
    /// everywhere.
    func handleUnauthorized() {
        UserDefaults.standard.removeObject(forKey: Self.apiKeyKey)
        UserDefaults.standard.set(false, forKey: Self.activatedKey)
        status = .invalid("This key was revoked - paste the new one from your dashboard.")
        stopPeriodicRevalidation()
    }

    /// Launch-time re-check: silent on success or network trouble (offline
    /// stays usable), hard gate only on a definitive 401.
    private func revalidateInBackground() {
        guard let key = apiKey else { return }
        Task { await self.revalidateOnce(key: key) }
    }

    /// Shared 401-check body for the launch-time recheck and the periodic
    /// timer - one code path, one message, wherever it fires from.
    private func revalidateOnce(key: String) async {
        do {
            _ = try await ApiClient.validate(key: key)
        } catch ApiClient.ApiError.unauthorized {
            handleUnauthorized()
        } catch {
            // Offline or server trouble: keep the app usable.
        }
    }

    /// While the app stays active for a long session, a key revoked mid-
    /// session should drop the gate without waiting for the next launch -
    /// re-checks every 10 minutes with the same silent-on-network-trouble
    /// semantics as revalidateInBackground. Skipped entirely for scripted
    /// QA runs so they stay deterministic. Started wherever status becomes
    /// .active (init, activate success); stopped in deactivate() and
    /// handleUnauthorized().
    private func startPeriodicRevalidation() {
        guard !Self.isQARun else { return }
        periodicRevalidationTask?.cancel()
        periodicRevalidationTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(600))
                guard !Task.isCancelled, let self, let key = self.apiKey else { return }
                await self.revalidateOnce(key: key)
            }
        }
    }

    private func stopPeriodicRevalidation() {
        periodicRevalidationTask?.cancel()
        periodicRevalidationTask = nil
    }
}
