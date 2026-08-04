import SwiftUI

/// 화면 사이를 오가는 상태. 서랍, 시트, 상세 스택을 한곳에서 다룬다.
///
/// 푸터·서랍·검색줄이 서로 다른 깊이에 있으면서 같은 시트를 열어야 해서,
/// 클로저를 층층이 넘기는 대신 이 객체를 환경에 얹어 공유한다.
@MainActor
final class AppRouter: ObservableObject {
    enum Sheet: Identifiable {
        case feedback
        case notificationPreferences
        case userGuide
        case bannerInquiry
        /// 아직 네이티브로 옮기지 않은 문서 페이지를 앱 안에서 연다.
        case webPage(URL)

        var id: String {
            switch self {
            case .feedback: "feedback"
            case .notificationPreferences: "notifications"
            case .userGuide: "guide"
            case .bannerInquiry: "banner-inquiry"
            case .webPage(let url): "web:\(url.absoluteString)"
            }
        }
    }

    @Published var path: [Int] = []
    @Published var sheet: Sheet?
    @Published var isDrawerOpen = false
    /// 목록 맨 위(검색창)로 되돌리라는 신호. 값이 바뀔 때마다 스크롤한다.
    @Published var scrollToSearchToken = 0

    func openNotice(id: Int) {
        isDrawerOpen = false
        if path.last != id { path.append(id) }
    }

    func openDrawer() {
        withAnimation(.easeOut(duration: 0.25)) { isDrawerOpen = true }
    }

    func closeDrawer() {
        withAnimation(.easeOut(duration: 0.25)) { isDrawerOpen = false }
    }

    func present(_ sheet: Sheet) {
        closeDrawer()
        self.sheet = sheet
    }

    func jumpToSearch() {
        scrollToSearchToken += 1
    }

    /// `snu-ece://notice/123`로 들어온 링크를 상세로 연결한다.
    func handle(url: URL) {
        guard url.scheme == "snu-ece" else { return }
        let components = url.pathComponents.filter { $0 != "/" }
        if url.host == "notice", let id = components.first.flatMap(Int.init) {
            openNotice(id: id)
        } else if let id = Int(url.host ?? "") {
            openNotice(id: id)
        }
    }
}
