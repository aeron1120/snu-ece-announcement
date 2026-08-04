import Foundation

/// 푸터의 "마지막 동기화" 배지가 쓰는 값. `/api/sync-status` 응답.
struct SyncStatus: Decodable, Equatable {
    var lastSyncedAt: Date?
    var noticeCount: Int

    private enum CodingKeys: String, CodingKey { case lastSyncedAt, noticeCount }

    init(lastSyncedAt: Date?, noticeCount: Int) {
        self.lastSyncedAt = lastSyncedAt
        self.noticeCount = noticeCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let stamp = try? container.decodeIfPresent(String.self, forKey: .lastSyncedAt)
        lastSyncedAt = stamp.flatMap(DateFormatting.parseTimestamp)
        noticeCount = (try? container.decode(Int.self, forKey: .noticeCount)) ?? 0
    }
}

/// 배지가 띠는 세 상태. 색만이 아니라 문구와 아이콘도 함께 바뀐다.
enum SyncState: Equatable {
    case loading
    case ok(label: String, detail: String)
    case stale(label: String, detail: String)
    case failed(label: String, detail: String)

    /// 마지막 수집이 이 시간을 넘기면 "동기화 지연"으로 본다.
    static let staleHours: Double = 6

    var label: String {
        switch self {
        case .loading: "동기화 상태 확인 중"
        case .ok(let label, _), .stale(let label, _), .failed(let label, _): label
        }
    }

    var detail: String {
        switch self {
        case .loading: ""
        case .ok(_, let detail), .stale(_, let detail), .failed(_, let detail): detail
        }
    }

    static func from(_ status: SyncStatus, now: Date = Date()) -> SyncState {
        guard let stamp = status.lastSyncedAt else {
            return .failed(label: "동기화 실패", detail: "최근 수집 기록을 찾지 못했습니다")
        }
        let hoursSince = now.timeIntervalSince(stamp) / 3600
        let detail = "\(DateFormatting.syncTimestamp(stamp)) 동기화"
        return hoursSince > staleHours
            ? .stale(label: "동기화 지연", detail: detail)
            : .ok(label: "최신 상태", detail: detail)
    }

    static let loadFailed = SyncState.failed(label: "동기화 실패", detail: "수집 상태를 불러오지 못했습니다")
}
