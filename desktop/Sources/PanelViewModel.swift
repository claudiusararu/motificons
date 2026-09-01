import AppKit
import Combine
import SwiftUI

@MainActor
final class PanelViewModel: ObservableObject {
    @Published var query = "" {
        didSet { scheduleSearch() }
    }
    @Published private(set) var hits: [IconHit] = []
    @Published var selectedIndex = 0
    @Published private(set) var justCopied = false
    /// Incremented by the controller on every show - the view re-focuses the field.
    @Published var focusRequest = 0

    // Collections home (empty query) - the user's curated collections, one
    // hotkey away. Icons render from the local pack; only ids come from the API.
    @Published private(set) var collections: [ApiClient.CollectionSummary] = []
    @Published private(set) var collectionsError: String? = nil
    @Published private(set) var openCollectionName: String? = nil
    @Published private(set) var loadingCollection = false
    private var openCollectionId: String? = nil
    private var collectionHits: [IconHit] = []

    // Open set (home navigation): browsing a set scopes SEARCH to that set
    // too - typing inside a set searches the set, not the whole library.
    @Published private(set) var openSetName: String? = nil
    private(set) var openSetPrefix: String? = nil

    /// All sets, for the home list (loaded once from the pack).
    lazy var allSets: [PackStore.SetInfo] = pack?.allSets() ?? []

    // Filters (web /search facet parity: sets multi-select, category single).
    @Published var filtersOpen = false
    @Published var filterSets: Set<String> = [] {
        didSet { scheduleSearch() }
    }
    @Published var filterCategory: String? = nil {
        didSet { scheduleSearch() }
    }

    let pack: PackStore?
    var onDismiss: () -> Void = {}

    private var searchTask: Task<Void, Never>?
    private var copiedResetTask: Task<Void, Never>?

    var columns = 8

    // Lazy loading: pages of `pageSize`, appended as the user nears the end.
    /// Bumped on every FRESH result set (not on appends) - the view resets
    /// scroll only when this changes.
    @Published private(set) var searchGeneration = 0
    private let pageSize = 96
    private var hasMore = false
    private var loadingMore = false
    private var lastTerm = ""
    private var lastSets: Set<String> = []
    private var lastCategory: String? = nil
    private var hasAppliedSearch = false

    init(pack: PackStore? = PackStore.locate()) {
        self.pack = pack
    }

    enum Mode {
        case home, collection, set, search
    }

    var mode: Mode {
        if openSetName != nil { return .set }
        if !query.isEmpty || hasActiveFilters { return .search }
        if openCollectionName != nil { return .collection }
        return .home
    }

    var hasActiveFilters: Bool {
        !filterSets.isEmpty || filterCategory != nil
    }

    var selectedHit: IconHit? {
        guard mode != .home else { return nil }
        return hits.indices.contains(selectedIndex) ? hits[selectedIndex] : nil
    }

    // MARK: - Collections

    func refreshCollections() {
        guard AccountStore.shared.isActive, let key = AccountStore.shared.apiKey else { return }
        Task {
            do {
                let fetched = try await ApiClient.collections(key: key)
                collections = fetched
                collectionsError = nil
                if mode == .home {
                    selectedIndex = min(selectedIndex, max(homeRowCount - 1, 0))
                }
                refreshSavedIcons()
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
            } catch {
                collectionsError = "Could not load your collections right now."
            }
        }
    }

    func openCollection(_ summary: ApiClient.CollectionSummary) {
        guard let pack, let key = AccountStore.shared.apiKey else { return }
        loadingCollection = true
        Task {
            defer { loadingCollection = false }
            do {
                let detail = try await ApiClient.icons(inCollection: summary.id, key: key)
                let resolved = await Task.detached(priority: .userInitiated) {
                    pack.icons(byIds: detail.icons)
                }.value
                openCollectionId = summary.id
                openCollectionName = summary.name
                collectionHits = resolved
                hits = resolved
                selectedIndex = 0
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
            } catch {
                collectionsError = "Could not open \"\(summary.name)\" right now."
            }
        }
    }

    func closeCollection() {
        openCollectionId = nil
        openCollectionName = nil
        collectionHits = []
        if query.isEmpty && !hasActiveFilters {
            hits = []
            selectedIndex = 0
        }
    }

    // MARK: - Sets

    func openSet(_ set: PackStore.SetInfo) {
        openSetPrefix = set.prefix
        openSetName = set.name
        selectedIndex = 0
        // query's didSet schedules the browse; assigning "" again would
        // double-schedule and the late task resets selection over the
        // user's first arrow presses.
        if query.isEmpty {
            scheduleSearch()
        } else {
            query = ""
        }
    }

    func closeSet() {
        openSetPrefix = nil
        openSetName = nil
        query = ""
        hits = collectionHits
        selectedIndex = 0
    }

    // MARK: - Search

    private func scheduleSearch() {
        searchTask?.cancel()
        let term = query
        // Hard gate: no valid API key, no search - local pack included.
        guard AccountStore.shared.isActive, let pack else { return }
        // An open set scopes everything to it; otherwise the filter chips rule.
        let sets = openSetPrefix.map { Set([$0]) } ?? filterSets
        let category = filterCategory
        // The focused TextField re-assigns query with the SAME value on
        // re-renders (didSet fires anyway) - a late duplicate search then
        // resets hits/selection mid-navigation. Identical params = no-op.
        if hasAppliedSearch, term == lastTerm, sets == lastSets, category == lastCategory {
            return
        }
        guard !term.isEmpty || !sets.isEmpty || category != nil else {
            hits = collectionHits
            selectedIndex = 0
            hasMore = false
            hasAppliedSearch = true
            lastTerm = term
            lastSets = sets
            lastCategory = category
            searchGeneration += 1
            return
        }
        let pageSize = pageSize
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled else { return }
            let results = await Task.detached(priority: .userInitiated) {
                pack.search(term, sets: sets, category: category, limit: pageSize)
            }.value
            guard !Task.isCancelled, let self else { return }
            self.hits = results
            self.selectedIndex = 0
            self.hasMore = results.count == pageSize
            self.loadingMore = false
            self.hasAppliedSearch = true
            self.lastTerm = term
            self.lastSets = sets
            self.lastCategory = category
            self.searchGeneration += 1
        }
    }

    /// Called as grid tiles appear and as the keyboard selection moves -
    /// appends the next page when the user nears the end of the loaded hits.
    func loadMoreIfNeeded(index: Int) {
        guard mode == .search || mode == .set,
              hasMore, !loadingMore,
              index >= hits.count - columns * 3,
              let pack
        else { return }
        loadingMore = true
        let term = lastTerm
        let sets = lastSets
        let category = lastCategory
        let offset = hits.count
        let pageSize = pageSize
        let generation = searchGeneration
        Task { [weak self] in
            let results = await Task.detached(priority: .userInitiated) {
                pack.search(term, sets: sets, category: category, limit: pageSize, offset: offset)
            }.value
            guard let self, self.searchGeneration == generation else { return }
            self.hits.append(contentsOf: results)
            self.hasMore = results.count == pageSize
            self.loadingMore = false
        }
    }

    func clearFilters() {
        filterSets = []
        filterCategory = nil
    }

    // MARK: - Selection + copy

    /// Home is one keyboard space: collections first, then sets.
    var homeRowCount: Int { collections.count + allSets.count }

    func moveSelection(dx: Int, dy: Int) {
        if mode == .home {
            guard homeRowCount > 0 else { return }
            let proposed = selectedIndex + dx + dy
            selectedIndex = min(max(proposed, 0), homeRowCount - 1)
            return
        }
        guard !hits.isEmpty else { return }
        let proposed = selectedIndex + dx + dy * columns
        selectedIndex = min(max(proposed, 0), hits.count - 1)
        loadMoreIfNeeded(index: selectedIndex)
    }

    func openHomeRow(at index: Int) {
        if index < collections.count {
            openCollection(collections[index])
        } else {
            let setIndex = index - collections.count
            if allSets.indices.contains(setIndex) {
                openSet(allSets[setIndex])
            }
        }
    }

    func copySelected(pngOnly: Bool) {
        guard AccountStore.shared.isActive, let hit = selectedHit, let pack else { return }
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let body = pack.body(for: hit) else { return }
            let ok = await MainActor.run {
                ClipboardWriter.copy(body: body, width: hit.width, height: hit.height, pngOnly: pngOnly)
            }
            guard ok, let self else { return }
            await self.flashCopiedAndDismiss()
        }
    }

    /// Opt+Enter: copy in the Settings-chosen format. SwiftUI renders on the
    /// server (the web's real path translator); the rest generate locally.
    func copyPreferred() {
        guard AccountStore.shared.isActive, let hit = selectedHit, let pack else { return }
        let format = PreferredFormat.stored
        if format == .swiftui {
            guard let key = AccountStore.shared.apiKey else { return }
            Task { [weak self] in
                do {
                    let code = try await ApiClient.renderSwiftUi(iconId: "\(hit.prefix):\(hit.name)", key: key)
                    guard ClipboardWriter.copyText(code) else { return }
                    await self?.flashCopiedAndDismiss()
                } catch ApiClient.ApiError.unauthorized {
                    AccountStore.shared.handleUnauthorized()
                } catch {
                    self?.copyError = "SwiftUI copy needs a connection - could not reach the server."
                }
            }
            return
        }
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let body = pack.body(for: hit),
                  let code = CodeFormats.code(body: body, hit: hit, format: format),
                  await MainActor.run(body: { ClipboardWriter.copyText(code) })
            else { return }
            await self?.flashCopiedAndDismiss()
        }
    }

    @Published var copyError: String? = nil

    // MARK: - Cmd+D: toggle in the default collection

    /// Icon ids saved in the DEFAULT collection - drives the star badge on tiles.
    @Published private(set) var savedIcons: Set<String> = []

    struct Toast: Equatable {
        enum Kind { case added, removed }
        let message: String
        let kind: Kind
    }

    @Published private(set) var toast: Toast? = nil
    private var toastTask: Task<Void, Never>?
    static let defaultCollectionKey = "defaultCollectionId"

    /// The Cmd+D target: the Settings choice, or the only collection when
    /// there is exactly one.
    var defaultCollection: ApiClient.CollectionSummary? {
        let chosen = UserDefaults.standard.string(forKey: Self.defaultCollectionKey)
        if let chosen, let match = collections.first(where: { $0.id == chosen }) {
            return match
        }
        return collections.count == 1 ? collections.first : nil
    }

    func refreshSavedIcons() {
        guard let target = defaultCollection, let key = AccountStore.shared.apiKey else {
            savedIcons = []
            return
        }
        Task { [weak self] in
            do {
                let detail = try await ApiClient.icons(inCollection: target.id, key: key)
                self?.savedIcons = Set(detail.icons)
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
            } catch {
                // Network trouble: leave savedIcons as-is, stay usable offline.
            }
        }
    }

    /// Cmd+D: bookmark-style toggle in the default collection.
    func toggleSelectedInDefault() {
        guard let hit = selectedHit else { return }
        guard !collections.isEmpty else {
            copyError = "Create a collection in your dashboard first."
            return
        }
        guard let target = defaultCollection else {
            copyError = "Choose a default collection in Settings first."
            return
        }
        guard let key = AccountStore.shared.apiKey else { return }
        let iconId = "\(hit.prefix):\(hit.name)"
        let removing = savedIcons.contains(iconId)
        Task { [weak self] in
            do {
                if removing {
                    _ = try await ApiClient.removeIcon(iconId, fromCollection: target.id, key: key)
                    self?.savedIcons.remove(iconId)
                    self?.showToast("The icon was removed from the \(target.name) collection.", kind: .removed)
                } else {
                    _ = try await ApiClient.addIcon(iconId, toCollection: target.id, key: key)
                    self?.savedIcons.insert(iconId)
                    self?.showToast("Icon was added to the \(target.name) collection.", kind: .added)
                }
                self?.refreshCollections()
                self?.refreshOpenCollectionIfNeeded(target.id)
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
            } catch {
                self?.copyError = "Could not update \"\(target.name)\" - check your connection."
            }
        }
    }

    private func refreshOpenCollectionIfNeeded(_ changedId: String) {
        guard openCollectionId == changedId, let pack,
              let key = AccountStore.shared.apiKey, let id = openCollectionId
        else { return }
        Task { [weak self] in
            let detail: ApiClient.CollectionIcons
            do {
                detail = try await ApiClient.icons(inCollection: id, key: key)
            } catch ApiClient.ApiError.unauthorized {
                AccountStore.shared.handleUnauthorized()
                return
            } catch {
                return
            }
            let resolved = await Task.detached(priority: .userInitiated) {
                pack.icons(byIds: detail.icons)
            }.value
            guard let self, self.openCollectionId == id else { return }
            self.collectionHits = resolved
            if self.mode == .collection {
                self.hits = resolved
                self.selectedIndex = min(self.selectedIndex, max(resolved.count - 1, 0))
            }
        }
    }

    private func showToast(_ message: String, kind: Toast.Kind) {
        copyError = nil
        toast = Toast(message: message, kind: kind)
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(2000))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    private func flashCopiedAndDismiss() async {
        copyError = nil
        justCopied = true
        copiedResetTask?.cancel()
        try? await Task.sleep(for: .milliseconds(450))
        justCopied = false
        onDismiss()
    }

    // MARK: - Keys

    /// Esc, layered: filter bar -> leave set/collection -> (caller closes panel).
    func handleEscape() -> Bool {
        if filtersOpen {
            filtersOpen = false
            return true
        }
        if mode == .set {
            closeSet()
            return true
        }
        if mode == .collection {
            closeCollection()
            return true
        }
        return false
    }

    /// Routes panel-level keys from the AppKit event monitor.
    /// Returns true when the event was handled (swallow it).
    func handleKey(_ event: NSEvent) -> Bool {
        guard AccountStore.shared.isActive else { return false }
        if event.keyCode == 2, event.modifierFlags.contains(.command) { // D
            toggleSelectedInDefault()
            return true
        }
        switch event.keyCode {
        case 123: moveSelection(dx: -1, dy: 0); return true // left
        case 124: moveSelection(dx: 1, dy: 0); return true  // right
        case 125: moveSelection(dx: 0, dy: 1); return true  // down
        case 126: moveSelection(dx: 0, dy: -1); return true // up
        case 36: // return
            if mode == .home {
                openHomeRow(at: selectedIndex)
            } else if event.modifierFlags.contains(.option) {
                copyPreferred()
            } else {
                copySelected(pngOnly: event.modifierFlags.contains(.command))
            }
            return true
        default:
            return false
        }
    }
}
