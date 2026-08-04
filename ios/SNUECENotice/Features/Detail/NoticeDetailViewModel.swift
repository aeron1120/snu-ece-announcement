import Foundation

/// 공지 상세 한 건을 불러와 들고 있는다.
@MainActor
final class NoticeDetailViewModel: ObservableObject {
    @Published private(set) var notice: Notice?
    @Published private(set) var isLoading = false
    @Published private(set) var error: APIError?

    let noticeId: Int
    private let service: NoticeServing

    init(noticeId: Int, service: NoticeServing) {
        self.noticeId = noticeId
        self.service = service
    }

    var images: [URL] {
        (notice?.images ?? []).compactMap { service.configuration.resolve(path: $0) }
    }

    var attachments: [(index: Int, name: String, url: URL?)] {
        (notice?.attachments ?? []).enumerated().map { index, attachment in
            (index: index, name: attachment.displayName,
             url: service.attachmentURL(noticeId: noticeId, index: index))
        }
    }

    var sourceURL: URL? { Linkify.safeURL(notice?.sourceUrl) }

    var shareURL: URL? { service.configuration.shareURL(noticeId: noticeId) }

    func load(onViewCounted: @escaping (Int) -> Void) async {
        guard notice == nil else { return }
        isLoading = true
        error = nil
        do {
            var loaded = try await service.loadDetail(id: noticeId)
            // 상세를 여는 순간 조회수가 하나 오른다. 서버 응답을 기다리기 전에
            // 먼저 더해 두어야 화면에 보이는 수와 실제가 어긋나지 않는다.
            loaded.views += 1
            notice = loaded
            isLoading = false

            // 조회수 반영은 화면을 막지 않는다. 실패해도 상세는 이미 떠 있다.
            if let counted = try? await service.incrementView(id: noticeId) {
                notice?.views = counted
                onViewCounted(counted)
            } else {
                onViewCounted(loaded.views)
            }
        } catch {
            self.error = error as? APIError ?? APIError(message: error.localizedDescription)
            isLoading = false
        }
    }

    func retry(onViewCounted: @escaping (Int) -> Void) async {
        notice = nil
        await load(onViewCounted: onViewCounted)
    }
}
