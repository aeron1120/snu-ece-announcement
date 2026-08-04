import Foundation

/// 사진 없는 공지는 포스터 자리에 제목을 크게 싣는다.
///
/// featurejaewon부터 모바일 포스터 제목은 길이와 무관하게 한 가지 크기
/// (`font-size: 14.5px`)로 고정됐고, 대신 포스터가 `min-height` 위로 자라며
/// 제목을 전부 담는다. 길이별 크기 조절(`posterTitleFit`)은 데스크톱 전용으로
/// 남았으므로 모바일 화면인 이 앱에서는 쓰지 않는다.
struct PosterTitle: Equatable {
    /// 제목 앞머리의 `[주관 기관]`. 본문보다 작고 옅게 따로 세운다.
    var hostLine: String?
    var body: String

    /// 웹 `mobile.css`의 `font-size: 14.5px !important`.
    static let fontSize: CGFloat = 14.5
    /// `line-height: 1.32`.
    static let lineHeight: CGFloat = 1.32

    static func make(from title: String) -> PosterTitle {
        let normalized = title
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmed
        let source = normalized.isEmpty ? "제목 없음" : normalized

        var hostLine: String?
        var body = source
        if source.hasPrefix("["), let close = source.firstIndex(of: "]") {
            hostLine = String(source[source.startIndex...close])
            body = String(source[source.index(after: close)...]).trimmed
        }

        return PosterTitle(hostLine: hostLine, body: body.isEmpty ? source : body)
    }
}
