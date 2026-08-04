import SwiftUI

/// 내려받은 사진을 메모리에 잠시 붙잡아 둔다.
///
/// 목록을 오르내릴 때마다 같은 썸네일을 다시 받으면 데이터도 배터리도 쓴다.
/// URLCache가 디스크를 맡고, 이 캐시는 디코딩까지 끝난 UIImage를 들고 있어
/// 스크롤 중 다시 그릴 때 지연이 없다.
actor ImageCache {
    static let shared = ImageCache()

    private let memory: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 120
        return cache
    }()

    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    func image(for url: URL) async -> UIImage? {
        if let cached = memory.object(forKey: url as NSURL) { return cached }
        // 같은 사진을 여러 카드가 동시에 부르면 요청은 한 번만 나간다.
        if let running = inFlight[url] { return await running.value }

        let task = Task<UIImage?, Never> {
            // 공지 사진은 파일 모드 저장소에서 data URL로 실려 온다. 그 경우
            // 네트워크를 타지 않고 바로 풀어 쓴다.
            if url.scheme == "data" {
                guard let data = Data(dataURL: url) else { return nil }
                return UIImage(data: data)
            }
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = 20
            guard let (data, response) = try? await URLSession.shared.data(for: request) else { return nil }
            // http(s)가 아닌 응답에는 상태 코드가 없다. 있을 때만 따진다.
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
            return UIImage(data: data)
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }
}

extension Data {
    /// `data:image/jpeg;base64,...` 주소에서 알맹이만 꺼낸다.
    /// URLSession도 data URL을 받아 주지만 HTTP 응답이 아니어서 다루기가
    /// 번거롭고, 무엇보다 네트워크 스택을 돌 이유가 없다.
    init?(dataURL: URL) {
        let text = dataURL.absoluteString
        guard text.hasPrefix("data:"), let separator = text.range(of: ",") else { return nil }
        let meta = text[text.startIndex..<separator.lowerBound]
        let payload = String(text[separator.upperBound...])
        if meta.contains(";base64") {
            self.init(base64Encoded: payload)
        } else {
            guard let decoded = payload.removingPercentEncoding else { return nil }
            self.init(decoded.utf8)
        }
    }
}

/// 주소 하나를 받아 사진을 그리는 자리. 실패하면 `fallback`이 대신 선다.
struct RemoteImage<Fallback: View>: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    /// 포스터 썸네일은 위쪽이 중요하다. `object-position: top center`와 같은 뜻.
    var alignment: Alignment = .top
    @ViewBuilder var fallback: () -> Fallback

    @State private var image: UIImage?
    @State private var didFail = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(width: proxy.size.width, height: proxy.size.height, alignment: alignment)
                        .clipped()
                } else if didFail || url == nil {
                    fallback()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                } else {
                    Theme.Palette.posterPlaceholder
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .overlay(ProgressView().tint(Theme.Palette.textSub).scaleEffect(0.7))
                }
            }
        }
        .task(id: url) {
            guard let url else {
                didFail = true
                return
            }
            image = nil
            didFail = false
            let loaded = await ImageCache.shared.image(for: url)
            if loaded == nil { didFail = true }
            image = loaded
        }
    }
}

extension RemoteImage where Fallback == AnyView {
    /// 실패하면 회색 자리만 남긴다.
    init(url: URL?, contentMode: ContentMode = .fill, alignment: Alignment = .top) {
        self.init(url: url, contentMode: contentMode, alignment: alignment) {
            AnyView(Theme.Palette.posterPlaceholder)
        }
    }
}
