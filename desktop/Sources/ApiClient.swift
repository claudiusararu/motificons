import Foundation

/// Talks to the /v1 REST surface on the mcp worker (one mk_ key, two
/// consumers - agents speak MCP, this app speaks REST). Base URL is
/// overridable for dev: `defaults write app.motificons.desktop apiBaseURL
/// http://127.0.0.1:8788`.
enum ApiClient {
    struct CollectionSummary: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let iconCount: Int
    }

    struct CollectionIcons: Decodable, Equatable {
        let id: String
        let name: String
        let icons: [String]
    }

    enum ApiError: Error {
        case unauthorized(String)
        case server(String)
        case network(Error)
    }

    static var baseURL: URL {
        if let override = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: override) {
            return url
        }
        return URL(string: "https://mcp.motificons.app")!
    }

    static func validate(key: String) async throws -> Bool {
        let (_, response) = try await send("GET", path: "/v1/validate", key: key)
        return response.statusCode == 200
    }

    static func collections(key: String) async throws -> [CollectionSummary] {
        let (data, _) = try await send("GET", path: "/v1/collections", key: key, expect: 200)
        struct Payload: Decodable { let collections: [CollectionSummary] }
        return try JSONDecoder().decode(Payload.self, from: data).collections
    }

    static func icons(inCollection id: String, key: String) async throws -> CollectionIcons {
        let (data, _) = try await send("GET", path: "/v1/collections/\(id)/icons", key: key, expect: 200)
        return try JSONDecoder().decode(CollectionIcons.self, from: data)
    }

    /// Server-side SwiftUI render (the web's real path translator).
    static func renderSwiftUi(iconId: String, key: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["icon": iconId, "format": "swiftui"])
        let (data, _) = try await send("POST", path: "/v1/render", key: key, body: body, expect: 200)
        struct Payload: Decodable { let code: String }
        return try JSONDecoder().decode(Payload.self, from: data).code
    }

    @discardableResult
    static func addIcon(_ iconId: String, toCollection id: String, key: String) async throws -> Int {
        let body = try JSONSerialization.data(withJSONObject: ["icon": iconId])
        let (data, _) = try await send("POST", path: "/v1/collections/\(id)/icons", key: key, body: body, expect: 200)
        struct Payload: Decodable { let iconCount: Int }
        return try JSONDecoder().decode(Payload.self, from: data).iconCount
    }

    @discardableResult
    static func removeIcon(_ iconId: String, fromCollection id: String, key: String) async throws -> Int {
        let escaped = iconId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? iconId
        let (data, _) = try await send("DELETE", path: "/v1/collections/\(id)/icons?icon=\(escaped)", key: key, expect: 200)
        struct Payload: Decodable { let iconCount: Int }
        return try JSONDecoder().decode(Payload.self, from: data).iconCount
    }

    private static func send(
        _ method: String,
        path: String,
        key: String,
        body: Data? = nil,
        expect: Int? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        // NOT appendingPathComponent: that percent-encodes "?" so query
        // strings become part of the path and the route 404s.
        guard let url = URL(string: baseURL.absoluteString + path) else {
            throw ApiError.server("Bad request URL.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError.network(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw ApiError.server("Unexpected response.")
        }
        if http.statusCode == 401 {
            throw ApiError.unauthorized(serverMessage(data) ?? "This key was not accepted.")
        }
        if let expect, http.statusCode != expect {
            throw ApiError.server(serverMessage(data) ?? "The server answered with status \(http.statusCode).")
        }
        return (data, http)
    }

    private static func serverMessage(_ data: Data) -> String? {
        struct Payload: Decodable { let error: String }
        return (try? JSONDecoder().decode(Payload.self, from: data))?.error
    }
}
