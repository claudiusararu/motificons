import AppKit
import SwiftUI

/// The in-panel Pro gate: paste the dashboard mk_ key, validate, unlock.
struct ActivationView: View {
    @ObservedObject var account: AccountStore
    @State private var keyInput = ""
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Unlock Motificons")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Theme.ink)
            Text("Motificons is included with Pro. Paste the API key from your dashboard - the same key your coding agent uses.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                SecureField("mk_...", text: $keyInput)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.ink)
                    .focused($fieldFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Theme.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Theme.ink, lineWidth: 2)
                    )
                    .onSubmit(activate)

                Button(action: activate) {
                    Text(account.status == .validating ? "Checking..." : "Activate")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            ZStack {
                                // Hard shadow = an offset ink shape BEHIND the
                                // chip (the button spec), never .shadow() on
                                // the whole button - that ghosts the text.
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Theme.ink)
                                    .offset(y: 3)
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Theme.primary)
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Theme.ink, lineWidth: 2)
                            }
                        )
                }
                .buttonStyle(.plain)
                .disabled(account.status == .validating || keyInput.isEmpty)
                .opacity(account.status == .validating || keyInput.isEmpty ? 0.55 : 1)
            }

            if case .invalid(let message) = account.status {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                NSWorkspace.shared.open(URL(string: "https://motificons.app/dashboard")!)
            } label: {
                Text("Get your key at motificons.app/dashboard")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink)
                    .underline()
            }
            .buttonStyle(.plain)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { fieldFocused = true }
    }

    private func activate() {
        guard !keyInput.isEmpty else { return }
        account.activate(key: keyInput)
    }
}
