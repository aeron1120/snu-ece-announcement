import Foundation

/// API 서버 주소.
///
/// 웹 `js/config.js`가 하던 판단을 그대로 옮겼다. 앱은 자기 출처가 없으므로
/// 기본은 언제나 운영 서버이고, 로컬 서버로 붙고 싶을 때만 실행 인자나
/// Info.plist로 바꿔 끼운다.
struct APIConfiguration {
    /// 공지·카테고리·배너를 받아 오는 API 서버.
    let baseURL: URL
    /// 링크 복사에 쓰는 공개 웹 주소. 카카오톡에 붙이면 미리보기가 뜨는 주소다.
    let publicSiteURL: URL

    static let productionAPI = URL(string: "https://snu-ece-announcement.onrender.com")!
    static let productionSite = URL(string: "https://snu-ece-announcement.pages.dev")!

    static var current: APIConfiguration {
        APIConfiguration(
            baseURL: override(for: "ECE_API_BASE_URL") ?? productionAPI,
            publicSiteURL: override(for: "ECE_PUBLIC_SITE_URL") ?? productionSite
        )
    }

    /// 실행 인자(`-ECE_API_BASE_URL http://localhost:3000`)나 환경 변수로 서버를 바꾼다.
    /// 시뮬레이터에서 로컬 서버에 붙여 볼 때 쓴다.
    private static func override(for key: String) -> URL? {
        let raw = UserDefaults.standard.string(forKey: key)
            ?? ProcessInfo.processInfo.environment[key]
        guard let raw = raw?.trimmed, !raw.isEmpty else { return nil }
        return URL(string: raw)
    }

    /// `/api/...` 같은 서버 상대 경로를 절대 주소로 바꾼다.
    /// 이미 절대 주소면 그대로 둔다 — 배너 이미지처럼 외부 주소가 섞여 온다.
    func resolve(path: String) -> URL? {
        let value = path.trimmed
        guard !value.isEmpty else { return nil }
        if let absolute = URL(string: value), absolute.scheme != nil { return absolute }
        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }

    /// 공지 공유 주소. 웹의 `?id=` 형식과 같아야 링크를 받은 사람이 웹에서 연다.
    func shareURL(noticeId: Int) -> URL? {
        var components = URLComponents(url: publicSiteURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "id", value: String(noticeId))]
        return components?.url
    }
}
