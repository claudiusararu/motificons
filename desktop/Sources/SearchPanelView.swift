import SwiftUI

/// The summon panel. Three modes: collections home (empty query), an open
/// collection's grid, and search results (typing or active filters).
struct SearchPanelView: View {
    @ObservedObject var model: PanelViewModel
    @ObservedObject var account: AccountStore = .shared
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if account.isActive {
                HStack(spacing: 10) {
                    searchField
                    filterButton
                    settingsButton
                }
                .padding(16)

                if model.filtersOpen {
                    PanelFilterBar(model: model)
                }

                Rectangle()
                    .fill(Theme.canvas)
                    .frame(height: 2)

                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                footer
            } else {
                ActivationView(account: account)
            }
        }
        .frame(width: 680, height: 440)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.ink, lineWidth: 2)
        )
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                // Light green = added, light red = removed (text stays ink on
                // light accents, shadow is the same hue's canonical deep value).
                let fill = toast.kind == .added ? Theme.teal : Theme.red
                let shadow = toast.kind == .added ? Theme.tealDeep : Theme.redDeep
                Text(toast.message)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(fill)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Theme.ink, lineWidth: 2)
                    )
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(shadow)
                            .offset(y: 3)
                    )
                    .padding(.bottom, 54)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: model.toast)
        .onAppear { searchFocused = true }
        .onChange(of: model.focusRequest) { _, _ in searchFocused = true }
        .onExitCommand {
            if !model.handleEscape() {
                model.onDismiss()
            }
        }
    }

    // MARK: - Header

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.inkMuted)
            TextField("Search icons...", text: $model.query)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundStyle(Theme.ink)
                .focused($searchFocused)
            if !model.query.isEmpty {
                Button {
                    model.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.inkMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(Capsule(style: .continuous).fill(Theme.surface))
        .overlay(Capsule(style: .continuous).strokeBorder(Theme.ink, lineWidth: 2))
    }

    private var filterButton: some View {
        Button {
            model.filtersOpen.toggle()
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 46, height: 46)
                .background(Circle().fill(model.hasActiveFilters ? Theme.primary : Theme.surface))
                .overlay(Circle().strokeBorder(Theme.ink, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Filters")
        .help("Filter by set or category")
    }

    private var settingsButton: some View {
        Button {
            model.onDismiss()
            SettingsOpener.open()
        } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.inkMuted)
                .frame(width: 46, height: 46)
                .background(Circle().fill(Theme.surface))
                .overlay(Circle().strokeBorder(Theme.ink, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .help("Settings")
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if model.pack == nil {
            emptyState(
                symbol: "exclamationmark.triangle",
                text: "Icon pack not found. Reinstall Motificons to restore it."
            )
        } else if model.loadingCollection {
            ProgressView()
                .controlSize(.small)
        } else {
            switch model.mode {
            case .home:
                homeView
            case .collection:
                collectionView
            case .set:
                setView
            case .search:
                if model.hits.isEmpty {
                    emptyState(symbol: "magnifyingglass", text: noResultsText)
                } else {
                    resultsGrid
                }
            }
        }
    }

    private var noResultsText: String {
        if model.query.isEmpty {
            return "No icons match these filters"
        }
        return "No icons match \"\(model.query)\""
    }

    private var formattedCount: String {
        model.pack.map { $0.iconCount.formatted() } ?? ""
    }

    // MARK: - Home (collections + sets)

    /// ONE ForEach with unique Int identity per row - two parallel ForEach
    /// blocks (or .id() modifiers) inside a LazyVStack alias rows across
    /// sections; scrollTo targets the ForEach identity directly.
    private var homeView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if model.collections.isEmpty, let error = model.collectionsError {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.inkMuted)
                            .padding(.leading, 4)
                    }
                    ForEach(Array(0..<model.homeRowCount), id: \.self) { rowIndex in
                        homeRow(rowIndex)
                    }
                }
                .padding(16)
            }
            .onChange(of: model.selectedIndex) { _, index in
                withAnimation(.easeOut(duration: 0.12)) {
                    proxy.scrollTo(index, anchor: .center)
                }
            }
        }
    }

    @ViewBuilder
    private func homeRow(_ rowIndex: Int) -> some View {
        let collectionCount = model.collections.count
        VStack(alignment: .leading, spacing: 8) {
            if rowIndex == 0, collectionCount > 0 {
                sectionCaption("YOUR COLLECTIONS")
            }
            if rowIndex == collectionCount {
                sectionCaption("ICON SETS")
                    .padding(.top, collectionCount > 0 ? 8 : 0)
            }
            if rowIndex < collectionCount {
                let collection = model.collections[rowIndex]
                collectionRow(collection, selected: rowIndex == model.selectedIndex)
                    .onTapGesture { model.openCollection(collection) }
            } else if model.allSets.indices.contains(rowIndex - collectionCount) {
                let set = model.allSets[rowIndex - collectionCount]
                setRow(set, selected: rowIndex == model.selectedIndex)
                    .onTapGesture { model.openSet(set) }
            }
        }
    }

    private func sectionCaption(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Theme.inkMuted)
            .padding(.leading, 4)
    }

    /// Compact row (dense desktop list, 36px + 8px spacing - see AGENTS.md) -
    /// deliberately NOT the web's big colored set cards.
    private func setRow(_ set: PackStore.SetInfo, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 12))
                .foregroundStyle(Theme.ink)
            Text(set.name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
            Spacer()
            SetSampleGlyphs(set: set, pack: model.pack)
            Text("\(set.count.formatted()) icons")
                .font(.system(size: 11))
                .foregroundStyle(Theme.inkMuted)
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.inkMuted)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(selected ? Theme.primary : Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(selected ? Theme.ink : Theme.cardShadow, lineWidth: selected ? 2 : 1)
        )
        .contentShape(Rectangle())
    }

    // MARK: - Open set

    private var setView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    model.closeSet()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .bold))
                        Text("Sets")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Theme.canvas))
                }
                .buttonStyle(.plain)
                Text(model.openSetName ?? "")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(model.query.isEmpty ? "browsing" : "searching in this set")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.inkMuted)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            if model.hits.isEmpty {
                emptyState(symbol: "magnifyingglass", text: "No icons match \"\(model.query)\" in this set.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                resultsGrid
            }
        }
    }

    private func collectionRow(_ collection: ApiClient.CollectionSummary, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "folder.fill")
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink)
            Text(collection.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
            Spacer()
            Text("\(collection.iconCount) icons")
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.inkMuted)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(selected ? Theme.primary : Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(selected ? Theme.ink : Theme.cardShadow, lineWidth: selected ? 2 : 1)
        )
        .contentShape(Rectangle())
    }

    // MARK: - Open collection

    private var collectionView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    model.closeCollection()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .bold))
                        Text("Collections")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Theme.canvas))
                }
                .buttonStyle(.plain)
                Text(model.openCollectionName ?? "")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("\(model.hits.count) icons")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.inkMuted)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            if model.hits.isEmpty {
                emptyState(symbol: "folder", text: "This collection has no icons yet - add some on the web.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                resultsGrid
            }
        }
    }

    // MARK: - Grid

    private var resultsGrid: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.fixed(64), spacing: 10),
                        count: model.columns
                    ),
                    spacing: 10
                ) {
                    // Positional identity: the highlight is a property of the
                    // SLOT, so a new results array can never leave a stale
                    // yellow tile behind while the footer moves on.
                    ForEach(Array(model.hits.enumerated()), id: \.offset) { index, hit in
                        IconTile(
                            hit: hit,
                            pack: model.pack,
                            selected: index == model.selectedIndex,
                            saved: model.savedIcons.contains("\(hit.prefix):\(hit.name)")
                        )
                        .onTapGesture {
                            model.selectedIndex = index
                            model.copySelected(pngOnly: false)
                        }
                        .onAppear { model.loadMoreIfNeeded(index: index) }
                    }
                }
                .padding(16)
            }
            .onChange(of: model.selectedIndex) { _, index in
                withAnimation(.easeOut(duration: 0.12)) {
                    proxy.scrollTo(index, anchor: .center)
                }
            }
            // Reset scroll only on a FRESH result set - appended pages
            // (lazy loading) must not yank the user back to the top.
            .onChange(of: model.searchGeneration) { _, _ in
                proxy.scrollTo(0, anchor: .top)
            }
        }
    }

    private func emptyState(symbol: String, text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 28))
                .foregroundStyle(Theme.inkMuted)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Theme.inkMuted)
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: 16) {
            if model.justCopied {
                Text("Copied")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Theme.teal))
            } else if let copyError = model.copyError {
                Text(copyError)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
                    .lineLimit(1)
            } else if let hit = model.selectedHit {
                Text(hit.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(hit.prefix)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.inkMuted)
                    .lineLimit(1)
            }
            Spacer()
            switch model.mode {
            case .home:
                keyHint("↩", "Open")
                keyHint("esc", "Close")
            case .collection, .set:
                keyHint("↩", "Copy")
                keyHint("⌘↩", "PNG")
                keyHint("⌥↩", PreferredFormat.stored.short)
                keyHint("⌘D", "Save")
                keyHint("esc", "Back")
            case .search:
                keyHint("↩", "Copy")
                keyHint("⌘↩", "PNG")
                keyHint("⌥↩", PreferredFormat.stored.short)
                keyHint("⌘D", "Save")
                keyHint("esc", "Close")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Theme.canvas)
        .clipShape(
            .rect(bottomLeadingRadius: 10, bottomTrailingRadius: 10)
        )
    }

    private func keyHint(_ key: String, _ label: String) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Theme.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(Theme.cardShadow, lineWidth: 1)
                )
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkMuted)
        }
    }
}

/// Up to 4 sample glyphs in a set row - so the row shows what the set
/// actually looks like, not just a name and a number.
private struct SetSampleGlyphs: View {
    let set: PackStore.SetInfo
    let pack: PackStore?

    @State private var images: [NSImage] = []

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(images.enumerated()), id: \.offset) { _, image in
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 16, height: 16)
            }
        }
        .task(id: set.prefix) {
            guard let pack, !set.samples.isEmpty else { return }
            let ids = set.samples.map { "\(set.prefix):\($0)" }
            let loaded = await Task.detached(priority: .utility) { () -> [NSImage] in
                pack.icons(byIds: ids).compactMap { hit in
                    guard let body = pack.body(for: hit) else { return nil }
                    return GlyphRenderer.image(body: body, width: hit.width, height: hit.height)
                }
            }.value
            images = loaded
        }
        .accessibilityHidden(true)
    }
}

/// One grid tile: async-loads its glyph off the main thread from the pack.
/// `saved` = in the default collection - the star badge top-right.
private struct IconTile: View {
    let hit: IconHit
    let pack: PackStore?
    let selected: Bool
    var saved = false

    @State private var image: NSImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(selected ? Theme.primary : Theme.surface)
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 28, height: 28)
            }
        }
        .frame(width: 64, height: 64)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(selected ? Theme.ink : Theme.cardShadow, lineWidth: selected ? 2 : 1)
        )
        .overlay(alignment: .topTrailing) {
            if saved {
                Image(systemName: "star.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(3)
                    .background(Circle().fill(Theme.primary))
                    .overlay(Circle().strokeBorder(Theme.ink, lineWidth: 1))
                    .offset(x: 5, y: -5)
            }
        }
        .task(id: hit.id) {
            guard let pack else { return }
            let loaded = await Task.detached(priority: .utility) { () -> NSImage? in
                guard let body = pack.body(for: hit) else { return nil }
                return GlyphRenderer.image(body: body, width: hit.width, height: hit.height)
            }.value
            image = loaded
        }
        .accessibilityLabel("\(hit.name), \(hit.prefix)")
    }
}
