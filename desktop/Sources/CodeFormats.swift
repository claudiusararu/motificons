import Foundation

/// The user's preferred copy-code format (Settings), used by Opt+Enter.
/// SwiftUI is rendered by the server (/v1/render reuses the web's real
/// path translator); everything else is generated locally, with templates
/// mirroring app/src/lib/transforms verbatim so web and app outputs match.
enum PreferredFormat: String, CaseIterable, Identifiable {
    case jsx, tsx, vue, svelte, swiftui, dataUri

    var id: String { rawValue }

    var label: String {
        switch self {
        case .jsx: return "React JSX"
        case .tsx: return "React TSX"
        case .vue: return "Vue"
        case .svelte: return "Svelte"
        case .swiftui: return "SwiftUI"
        case .dataUri: return "Data URI"
        }
    }

    /// Short name for the footer key hint ("⌥↩ Copy JSX").
    var short: String {
        switch self {
        case .jsx: return "JSX"
        case .tsx: return "TSX"
        case .vue: return "Vue"
        case .svelte: return "Svelte"
        case .swiftui: return "SwiftUI"
        case .dataUri: return "Data URI"
        }
    }

    static let storageKey = "preferredFormat"

    static var stored: PreferredFormat {
        get {
            UserDefaults.standard.string(forKey: storageKey)
                .flatMap(PreferredFormat.init(rawValue:)) ?? .jsx
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: storageKey)
        }
    }
}

enum CodeFormats {
    /// Local generation; SwiftUI returns nil (server-rendered, async path).
    static func code(body: String, hit: IconHit, format: PreferredFormat) -> String? {
        switch format {
        case .jsx: return jsxComponent(body: body, hit: hit, typescript: false)
        case .tsx: return jsxComponent(body: body, hit: hit, typescript: true)
        case .vue: return vueComponent(body: body, hit: hit)
        case .svelte: return svelteComponent(body: body, hit: hit)
        case .dataUri: return dataUri(body: body, hit: hit)
        case .swiftui: return nil
        }
    }

    /// PascalCase component name, digit-led names prefixed - mirrors
    /// transforms/jsx.ts componentName().
    static func componentName(prefix: String, name: String) -> String {
        let camel = "\(prefix)-\(name)"
            .split(whereSeparator: { !($0.isLetter || $0.isNumber) })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined()
        return camel.first?.isNumber == true ? "Icon\(camel)" : camel
    }

    // Explicit table, same rationale as transforms/jsx.ts: SVG has exceptions
    // in both directions and a blanket kebab-to-camel rule silently produces
    // attributes React drops on the floor.
    private static let jsxAttributeMap: [(String, String)] = [
        ("clip-path", "clipPath"), ("clip-rule", "clipRule"),
        ("fill-opacity", "fillOpacity"), ("fill-rule", "fillRule"),
        ("stop-color", "stopColor"), ("stop-opacity", "stopOpacity"),
        ("stroke-dasharray", "strokeDasharray"), ("stroke-dashoffset", "strokeDashoffset"),
        ("stroke-linecap", "strokeLinecap"), ("stroke-linejoin", "strokeLinejoin"),
        ("stroke-miterlimit", "strokeMiterlimit"), ("stroke-opacity", "strokeOpacity"),
        ("stroke-width", "strokeWidth"), ("paint-order", "paintOrder"),
        ("vector-effect", "vectorEffect"), ("shape-rendering", "shapeRendering"),
        ("xlink:href", "xlinkHref"), ("xml:space", "xmlSpace"),
        ("class", "className"),
    ]

    static func jsxBody(_ body: String) -> String {
        var result = body
        for (kebab, camel) in jsxAttributeMap {
            result = result.replacingOccurrences(of: "\(kebab)=", with: "\(camel)=")
        }
        return result
    }

    private static func jsxComponent(body: String, hit: IconHit, typescript: Bool) -> String {
        let name = componentName(prefix: hit.prefix, name: hit.name)
        let converted = jsxBody(body)
        let signature = typescript
            ? "export function \(name)(props: SVGProps<SVGSVGElement>) {"
            : "export function \(name)(props) {"
        let importLine = typescript ? "import type { SVGProps } from \"react\";\n\n" : ""
        return """
        \(importLine)\(signature)
          return (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 \(hit.width) \(hit.height)"
              width="1em"
              height="1em"
              {...props}
            >
              \(converted)
            </svg>
          );
        }

        """
    }

    private static func vueComponent(body: String, hit: IconHit) -> String {
        """
        <script setup>
        defineProps({
          size: { type: [Number, String], default: "1em" },
          color: { type: String, default: "currentColor" },
        });
        </script>

        <template>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 \(hit.width) \(hit.height)"
            :width="size"
            :height="size"
            :color="color"
            v-bind="$attrs"
          >
        \(indent(body, 4))
          </svg>
        </template>

        """
    }

    private static func svelteComponent(body: String, hit: IconHit) -> String {
        """
        <script>
          let { size = "1em", color = "currentColor", ...rest } = $props();
        </script>

        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 \(hit.width) \(hit.height)"
          width={size}
          height={size}
          {color}
          {...rest}
        >
        \(indent(body, 2))
        </svg>

        """
    }

    private static func dataUri(body: String, hit: IconHit) -> String {
        let svg = GlyphRenderer.svgDocument(body: body, width: hit.width, height: hit.height, colorHex: nil)
        let base64 = Data(svg.utf8).base64EncodedString()
        return "data:image/svg+xml;base64,\(base64)"
    }

    private static func indent(_ text: String, _ spaces: Int) -> String {
        let pad = String(repeating: " ", count: spaces)
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { "\(pad)\($0)" }
            .joined(separator: "\n")
    }
}
