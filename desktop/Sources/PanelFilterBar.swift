import SwiftUI

/// The filter row under the search field (web /search facet parity):
/// SETS multi-select + CATEGORY single-select, each in a searchable popover.
struct PanelFilterBar: View {
    @ObservedObject var model: PanelViewModel
    @State private var sets: [PackStore.SetInfo] = []
    @State private var categories: [PackStore.CategoryInfo] = []
    @State private var showSets = false
    @State private var showCategory = false

    var body: some View {
        HStack(spacing: 8) {
            chip(label: setsLabel, active: !model.filterSets.isEmpty) {
                showSets.toggle()
            }
            .popover(isPresented: $showSets, arrowEdge: .bottom) {
                SetPickerView(model: model, sets: sets)
            }

            chip(label: categoryLabel, active: model.filterCategory != nil) {
                showCategory.toggle()
            }
            .popover(isPresented: $showCategory, arrowEdge: .bottom) {
                CategoryPickerView(model: model, categories: categories)
            }

            if model.hasActiveFilters {
                Button {
                    model.clearFilters()
                } label: {
                    Text("Clear filters")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .underline()
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .onAppear {
            if sets.isEmpty { sets = model.pack?.allSets() ?? [] }
            if categories.isEmpty { categories = model.pack?.allCategories() ?? [] }
        }
    }

    private var setsLabel: String {
        switch model.filterSets.count {
        case 0: return "All sets"
        case 1:
            let prefix = model.filterSets.first ?? ""
            return sets.first(where: { $0.prefix == prefix })?.name ?? prefix
        default: return "\(model.filterSets.count) sets"
        }
    }

    private var categoryLabel: String {
        guard let slug = model.filterCategory else { return "All categories" }
        return categories.first(where: { $0.slug == slug })?.name ?? slug
    }

    private func chip(label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(active ? Theme.primary : Theme.surface)
            )
            .overlay(
                Capsule().strokeBorder(active ? Theme.ink : Theme.cardShadow, lineWidth: active ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

/// Multi-select set picker with type-to-filter (mirrors the web SET rail).
private struct SetPickerView: View {
    @ObservedObject var model: PanelViewModel
    let sets: [PackStore.SetInfo]
    @State private var filter = ""

    var body: some View {
        PickerShell(filter: $filter, placeholder: "Filter sets...") {
            ForEach(visible) { set in
                PickerRow(
                    title: set.name,
                    detail: set.count.formatted(),
                    selected: model.filterSets.contains(set.prefix)
                ) {
                    if model.filterSets.contains(set.prefix) {
                        model.filterSets.remove(set.prefix)
                    } else {
                        model.filterSets.insert(set.prefix)
                    }
                }
            }
        }
    }

    private var visible: [PackStore.SetInfo] {
        guard !filter.isEmpty else { return sets }
        return sets.filter { $0.name.localizedCaseInsensitiveContains(filter) || $0.prefix.localizedCaseInsensitiveContains(filter) }
    }
}

/// Single-select category picker with type-to-filter (mirrors the web CATEGORY rail).
private struct CategoryPickerView: View {
    @ObservedObject var model: PanelViewModel
    let categories: [PackStore.CategoryInfo]
    @State private var filter = ""

    var body: some View {
        PickerShell(filter: $filter, placeholder: "Filter categories...") {
            ForEach(visible) { category in
                PickerRow(
                    title: category.name,
                    detail: category.count.formatted(),
                    selected: model.filterCategory == category.slug
                ) {
                    model.filterCategory = model.filterCategory == category.slug ? nil : category.slug
                }
            }
        }
    }

    private var visible: [PackStore.CategoryInfo] {
        guard !filter.isEmpty else { return categories }
        return categories.filter { $0.name.localizedCaseInsensitiveContains(filter) }
    }
}

private struct PickerShell<Content: View>: View {
    @Binding var filter: String
    let placeholder: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            TextField(placeholder, text: $filter)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .padding(10)
            Rectangle().fill(Theme.canvas).frame(height: 1)
            ScrollView {
                LazyVStack(spacing: 2) {
                    content
                }
                .padding(6)
            }
        }
        .frame(width: 280, height: 320)
        .background(Theme.surface)
    }
}

private struct PickerRow: View {
    let title: String
    let detail: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 13))
                    .foregroundStyle(selected ? Theme.ink : Theme.inkMuted)
                Text(title)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Spacer()
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.inkMuted)
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(selected ? Theme.canvas : Color.clear)
        )
    }
}
