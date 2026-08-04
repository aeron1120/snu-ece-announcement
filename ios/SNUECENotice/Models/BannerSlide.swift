import Foundation

/// 학내 홍보 배너 한 장. `/api/banner-slides` 응답 한 줄.
struct BannerSlide: Identifiable, Equatable, Decodable {
    let id: Int
    var name: String
    var text: String
    var owner: String
    var placement: String
    var order: Int
    var src: String?
    var mobileSrc: String?
    var linkUrl: String?
    var altText: String?

    /// 폰에서는 16:9 모바일 판을 쓴다. 없으면 데스크톱 원본으로 떨어진다.
    var displaySource: String? {
        mobileSrc?.trimmed.nilIfEmpty ?? src?.trimmed.nilIfEmpty
    }

    var accessibilityLabel: String {
        altText?.trimmed.nilIfEmpty ?? name.trimmed.nilIfEmpty ?? "학내 홍보 이미지"
    }

    var link: URL? {
        guard let linkUrl = linkUrl?.trimmed, !linkUrl.isEmpty else { return nil }
        guard let url = URL(string: linkUrl), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return url
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, text, owner, placement, order, src, mobileSrc, linkUrl, altText
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let numeric = try? container.decode(Int.self, forKey: .id) {
            id = numeric
        } else {
            id = Int((try? container.decode(String.self, forKey: .id)) ?? "") ?? 0
        }
        name = (try? container.decode(String.self, forKey: .name)) ?? ""
        text = (try? container.decode(String.self, forKey: .text)) ?? ""
        owner = (try? container.decode(String.self, forKey: .owner)) ?? ""
        placement = (try? container.decode(String.self, forKey: .placement)) ?? ""
        order = (try? container.decode(Int.self, forKey: .order)) ?? 0
        src = try? container.decodeIfPresent(String.self, forKey: .src)
        mobileSrc = try? container.decodeIfPresent(String.self, forKey: .mobileSrc)
        linkUrl = try? container.decodeIfPresent(String.self, forKey: .linkUrl)
        altText = try? container.decodeIfPresent(String.self, forKey: .altText)
    }
}

struct BannerSlideListResponse: Decodable {
    var slides: [BannerSlide]
}

extension Array where Element == BannerSlide {
    /// 오른쪽 레일 자리에 실제로 걸 수 있는 배너만, 최대 다섯 장.
    /// 웹 `renderRightRailAd()`가 자르는 기준과 같다.
    var displayableRightRail: [BannerSlide] {
        filter { $0.placement == "right_rail" && $0.displaySource != nil }
            .sorted { $0.order < $1.order }
            .prefix(5)
            .map { $0 }
    }
}
