import Foundation

/// 화면이 쓰는 서버 호출을 한곳에 모은다. 웹 `createNoticeRepository()`와
/// 흩어져 있던 `apiRequest` 호출들을 합친 자리다.
protocol NoticeServing: Sendable {
    var configuration: APIConfiguration { get }

    func loadNotices(page: Int, limit: Int, filters: NoticeFilters) async throws -> NoticeListResponse
    func loadDetail(id: Int) async throws -> Notice
    func incrementView(id: Int) async throws -> Int?
    func loadCategories() async throws -> [NoticeCategory]
    func loadBannerSlides() async throws -> [BannerSlide]
    func loadSyncStatus() async throws -> SyncStatus
    func submitFeedback(message: String, screenshots: [Data]) async throws
    func attachmentURL(noticeId: Int, index: Int) -> URL?
    func thumbnailURL(for notice: Notice) -> URL?
}

struct NoticeService: NoticeServing {
    /// 웹 목록과 같은 한 쪽 분량.
    static let pageSize = 16

    let client: APIClient

    var configuration: APIConfiguration { client.configuration }

    init(client: APIClient = APIClient()) {
        self.client = client
    }

    func loadNotices(page: Int, limit: Int = NoticeService.pageSize, filters: NoticeFilters) async throws -> NoticeListResponse {
        try await client.get(
            NoticeListResponse.self,
            path: "/api/notices",
            queryItems: filters.queryItems(page: page, limit: limit)
        )
    }

    func loadDetail(id: Int) async throws -> Notice {
        try await client.get(NoticeDetailResponse.self, path: "/api/notices/\(id)").notice
    }

    /// 조회수 올리기. 실패해도 화면을 막지 않으므로 호출 쪽에서 조용히 삼킨다.
    func incrementView(id: Int) async throws -> Int? {
        try await client.post(NoticeViewResponse.self, path: "/api/notices/\(id)/view").notice?.views
    }

    func loadCategories() async throws -> [NoticeCategory] {
        try await client.get(CategoryListResponse.self, path: "/api/categories").categories
    }

    func loadBannerSlides() async throws -> [BannerSlide] {
        try await client.get(BannerSlideListResponse.self, path: "/api/banner-slides").slides
    }

    func loadSyncStatus() async throws -> SyncStatus {
        try await client.get(SyncStatus.self, path: "/api/sync-status")
    }

    /// 익명 피드백. 서버는 JPEG data URL만 받으므로 여기서 그 형식으로 감싼다.
    func submitFeedback(message: String, screenshots: [Data]) async throws {
        struct Payload: Encodable {
            let message: String
            let screenshots: [String]
        }
        let encoded = screenshots.map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
        _ = try await client.post(
            EmptyResponse.self,
            path: "/api/feedback",
            body: Payload(message: message, screenshots: encoded)
        )
    }

    /// 첨부는 서버를 거쳐 받는다. ECE 홈페이지가 Referer를 보고 막기 때문에
    /// 원문 주소를 그대로 열면 전부 404가 난다.
    func attachmentURL(noticeId: Int, index: Int) -> URL? {
        configuration.resolve(path: "/api/notices/\(noticeId)/attachments/\(index)")
    }

    func thumbnailURL(for notice: Notice) -> URL? {
        guard let path = notice.thumbnailPath?.trimmed, !path.isEmpty else { return nil }
        return configuration.resolve(path: path)
    }
}
