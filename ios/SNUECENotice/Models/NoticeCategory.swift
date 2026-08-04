import Foundation

/// 공지 카테고리. 서버 `/api/categories` 응답 한 줄.
struct NoticeCategory: Identifiable, Equatable, Decodable {
    let id: Int
    var name: String
    var slug: String

    private enum CodingKeys: String, CodingKey { case id, name, slug }

    init(id: Int, name: String, slug: String) {
        self.id = id
        self.name = name
        self.slug = slug
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let numeric = try? container.decode(Int.self, forKey: .id) {
            id = numeric
        } else {
            id = Int(try container.decode(String.self, forKey: .id)) ?? 0
        }
        name = (try? container.decode(String.self, forKey: .name)) ?? ""
        slug = (try? container.decode(String.self, forKey: .slug)) ?? ""
    }
}

struct CategoryListResponse: Decodable {
    var categories: [NoticeCategory]
}

enum NoticeCategoryCatalog {
    /// 탭에 세우는 차례. 웹 `core.js`의 `NOTICE_CATEGORY_ORDER`와 같아야 한다.
    /// 여기에 없는 slug는 탭에 오르지 않는다 — 주제 축이 아닌 카테고리를
    /// 탭에 섞지 않으려는 웹 쪽 판단을 그대로 가져왔다.
    static let order = ["academic", "opportunity", "survey", "community"]

    /// 옛 주소·저장값에서 넘어오는 slug를 지금 쓰는 slug로 옮긴다.
    static let legacyRedirects: [String: String] = [
        "application": "opportunity",
        "academics": "academic",
        "benefits-partnerships": "community",
        "campus": "community",
        "governance": "community",
        "benefit": "community",
        "expired": "all"
    ]

    /// 마감이 있어야 뜻이 있는 칸만 마감임박순으로 연다.
    static let deadlineFirstSlugs: Set<String> = ["opportunity", "survey"]

    static func ordered(_ categories: [NoticeCategory]) -> [NoticeCategory] {
        let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($0.element, $0.offset) })
        return categories
            .filter { rank[$0.slug] != nil }
            .sorted { (rank[$0.slug] ?? 0) < (rank[$1.slug] ?? 0) }
    }

    static func resolve(slug: String, in categories: [NoticeCategory]) -> NoticeCategory? {
        let normalized = legacyRedirects[slug] ?? slug
        guard normalized != "all" else { return nil }
        return categories.first { $0.slug == normalized }
    }
}
