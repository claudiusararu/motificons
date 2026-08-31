import Compression
import Foundation
import SQLite3

struct IconHit: Identifiable, Equatable {
    let id: Int
    let prefix: String
    let name: String
    let width: Int
    let height: Int
    let chunk: Int
    let pos: Int
}

/// Read-only access to the offline pack (pipeline's build-desktop-pack output).
/// Lookup order: Application Support (updated pack) -> app bundle (seed).
final class PackStore {
    private let db: OpaquePointer
    private let queue = DispatchQueue(label: "app.motificons.pack")
    private let chunkCache = NSCache<NSNumber, NSArray>()

    let iconCount: Int
    let setCount: Int

    static func locate() -> PackStore? {
        var candidates: [URL] = []
        if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            candidates.append(support.appendingPathComponent("Motificons/pack.sqlite"))
        }
        if let bundled = Bundle.main.url(forResource: "pack", withExtension: "sqlite") {
            candidates.append(bundled)
        }
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            if let store = PackStore(path: url.path) { return store }
        }
        return nil
    }

    init?(path: String) {
        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let handle else {
            sqlite3_close(handle)
            return nil
        }
        db = handle
        chunkCache.countLimit = 64
        iconCount = Self.scalarInt(db, "SELECT value FROM meta WHERE key = 'icons'") ?? 0
        setCount = Self.scalarInt(db, "SELECT value FROM meta WHERE key = 'sets'") ?? 0
        guard iconCount > 0 else {
            sqlite3_close(handle)
            return nil
        }
    }

    deinit {
        sqlite3_close(db)
    }

    struct SetInfo: Identifiable, Equatable {
        let prefix: String
        let name: String
        let count: Int
        /// Representative icon names precomputed by the pipeline (sets.json).
        let samples: [String]
        var id: String { prefix }
    }

    struct CategoryInfo: Identifiable, Equatable {
        let slug: String
        let name: String
        let count: Int
        var id: String { slug }
    }

    /// All sets, largest first - the filter picker's data (counts are pack data).
    func allSets() -> [SetInfo] {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = "SELECT prefix, name, icon_count, samples FROM sets ORDER BY icon_count DESC"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            var rows: [SetInfo] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                let samplesJson = sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "[]"
                let samples = (try? JSONDecoder().decode([String].self, from: Data(samplesJson.utf8))) ?? []
                rows.append(SetInfo(
                    prefix: String(cString: sqlite3_column_text(stmt, 0)),
                    name: String(cString: sqlite3_column_text(stmt, 1)),
                    count: Int(sqlite3_column_int(stmt, 2)),
                    samples: samples
                ))
            }
            return rows
        }
    }

    /// All categories, largest first.
    func allCategories() -> [CategoryInfo] {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = "SELECT slug, name, icon_count FROM categories ORDER BY icon_count DESC"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            var rows: [CategoryInfo] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                rows.append(CategoryInfo(
                    slug: String(cString: sqlite3_column_text(stmt, 0)),
                    name: String(cString: sqlite3_column_text(stmt, 1)),
                    count: Int(sqlite3_column_int(stmt, 2))
                ))
            }
            return rows
        }
    }

    /// Prefix-match FTS query with optional set/category filters, bm25-ranked.
    /// Empty query + active filters = browse (web /search parity).
    func search(
        _ rawQuery: String,
        sets: Set<String> = [],
        category: String? = nil,
        limit: Int = 96,
        offset: Int = 0
    ) -> [IconHit] {
        let tokens = rawQuery.lowercased()
            .split(whereSeparator: { !($0.isLetter || $0.isNumber) })
            .map(String.init)
            .filter { !$0.isEmpty }
        guard !tokens.isEmpty || !sets.isEmpty || category != nil else { return [] }

        let setList = sets.sorted()
        var predicates: [String] = []
        if !setList.isEmpty {
            let placeholders = Array(repeating: "?", count: setList.count).joined(separator: ",")
            predicates.append("i.prefix IN (\(placeholders))")
        }
        if category != nil {
            predicates.append("i.id IN (SELECT icon_id FROM icon_category WHERE slug = ?)")
        }
        let filterSql = predicates.isEmpty ? "" : " AND " + predicates.joined(separator: " AND ")

        let sql: String
        if tokens.isEmpty {
            sql = """
                SELECT i.id, i.prefix, i.name, i.width, i.height, i.chunk, i.pos
                FROM icons i
                WHERE 1 = 1\(filterSql)
                ORDER BY i.id LIMIT ? OFFSET ?
                """
        } else {
            // Exact name first ("fire" -> fire), then names that START with the
            // query ("fire" -> fire-alt), then bm25, shortest name breaking ties -
            // otherwise prefix matching lets "firebase" outrank "fire" itself.
            sql = """
                SELECT i.id, i.prefix, i.name, i.width, i.height, i.chunk, i.pos
                FROM icon_fts f JOIN icons i ON i.id = f.rowid
                WHERE icon_fts MATCH ?\(filterSql)
                ORDER BY (i.name = ?) DESC,
                         (i.name LIKE ? || '%') DESC,
                         rank,
                         length(i.name)
                LIMIT ? OFFSET ?
                """
        }

        return queue.sync {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            var index: Int32 = 1
            if !tokens.isEmpty {
                let match = tokens.map { "\"\($0)\" *" }.joined(separator: " ")
                sqlite3_bind_text(stmt, index, match, -1, transient)
                index += 1
            }
            for prefix in setList {
                sqlite3_bind_text(stmt, index, prefix, -1, transient)
                index += 1
            }
            if let category {
                sqlite3_bind_text(stmt, index, category, -1, transient)
                index += 1
            }
            if !tokens.isEmpty {
                let joined = tokens.joined(separator: "-")
                sqlite3_bind_text(stmt, index, joined, -1, transient)
                index += 1
                sqlite3_bind_text(stmt, index, joined, -1, transient)
                index += 1
            }
            sqlite3_bind_int(stmt, index, Int32(limit))
            sqlite3_bind_int(stmt, index + 1, Int32(offset))

            var hits: [IconHit] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                hits.append(readHit(stmt))
            }
            return hits
        }
    }

    /// Resolves "prefix:name" ids (a collection's saved icons) against the
    /// pack, preserving input order; ids the pack lacks are skipped.
    func icons(byIds ids: [String]) -> [IconHit] {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = """
                SELECT id, prefix, name, width, height, chunk, pos
                FROM icons WHERE prefix = ? AND name = ? LIMIT 1
                """
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            var hits: [IconHit] = []
            for id in ids {
                let parts = id.split(separator: ":", maxSplits: 1)
                guard parts.count == 2 else { continue }
                sqlite3_reset(stmt)
                sqlite3_bind_text(stmt, 1, String(parts[0]), -1, transient)
                sqlite3_bind_text(stmt, 2, String(parts[1]), -1, transient)
                if sqlite3_step(stmt) == SQLITE_ROW {
                    hits.append(readHit(stmt))
                }
            }
            return hits
        }
    }

    private func readHit(_ stmt: OpaquePointer?) -> IconHit {
        IconHit(
            id: Int(sqlite3_column_int64(stmt, 0)),
            prefix: String(cString: sqlite3_column_text(stmt, 1)),
            name: String(cString: sqlite3_column_text(stmt, 2)),
            width: Int(sqlite3_column_int(stmt, 3)),
            height: Int(sqlite3_column_int(stmt, 4)),
            chunk: Int(sqlite3_column_int(stmt, 5)),
            pos: Int(sqlite3_column_int(stmt, 6))
        )
    }

    /// Inner SVG body for a hit. Inflates the hit's chunk on first access.
    func body(for hit: IconHit) -> String? {
        if let cached = chunkCache.object(forKey: NSNumber(value: hit.chunk)) as? [String] {
            return hit.pos < cached.count ? cached[hit.pos] : nil
        }
        return queue.sync {
            if let cached = chunkCache.object(forKey: NSNumber(value: hit.chunk)) as? [String] {
                return hit.pos < cached.count ? cached[hit.pos] : nil
            }
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT data FROM chunks WHERE id = ?", -1, &stmt, nil) == SQLITE_OK else {
                return nil
            }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_int(stmt, 1, Int32(hit.chunk))
            guard sqlite3_step(stmt) == SQLITE_ROW,
                  let blob = sqlite3_column_blob(stmt, 0)
            else { return nil }
            let size = Int(sqlite3_column_bytes(stmt, 0))
            let data = Data(bytes: blob, count: size)
            guard let inflated = Self.inflate(data),
                  let bodies = try? JSONDecoder().decode([String].self, from: inflated)
            else { return nil }
            chunkCache.setObject(bodies as NSArray, forKey: NSNumber(value: hit.chunk))
            return hit.pos < bodies.count ? bodies[hit.pos] : nil
        }
    }

    private static func inflate(_ data: Data) -> Data? {
        // Raw DEFLATE (pipeline uses deflateRawSync); COMPRESSION_ZLIB is raw deflate.
        var output = Data()
        let bufferSize = 512 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var stream = compression_stream(dst_ptr: buffer, dst_size: bufferSize, src_ptr: buffer, src_size: 0, state: nil)
        guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            return nil
        }
        defer { compression_stream_destroy(&stream) }

        return data.withUnsafeBytes { (input: UnsafeRawBufferPointer) -> Data? in
            guard let base = input.baseAddress else { return nil }
            stream.src_ptr = base.assumingMemoryBound(to: UInt8.self)
            stream.src_size = input.count
            while true {
                stream.dst_ptr = buffer
                stream.dst_size = bufferSize
                let status = compression_stream_process(&stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                output.append(buffer, count: bufferSize - stream.dst_size)
                switch status {
                case COMPRESSION_STATUS_OK:
                    continue
                case COMPRESSION_STATUS_END:
                    return output
                default:
                    return nil
                }
            }
        }
    }

    private static func scalarInt(_ db: OpaquePointer, _ sql: String) -> Int? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return Int(sqlite3_column_int64(stmt, 0))
    }
}
