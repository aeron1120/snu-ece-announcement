import SwiftUI

/// 학내 홍보 배너.
///
/// 데스크톱에서는 오른쪽 레일에 세로로 붙지만, 폰에서는 목록 아래로 내려와
/// 16:9 가로 배너가 된다. 여섯 초 반마다 저절로 넘어가고 손으로도 넘길 수 있다.
/// 걸 배너가 하나도 없으면 홍보 신청 안내가 대신 선다.
struct BannerCarouselView: View {
    let slides: [BannerSlide]

    @EnvironmentObject private var router: AppRouter
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var index = 0
    @State private var autoAdvance: Task<Void, Never>?

    /// 웹 `BANNER_ROTATION_DELAY`와 같은 간격.
    private static let rotationDelay = Duration.milliseconds(6500)

    var body: some View {
        Group {
            if slides.isEmpty {
                inquiryFallback
            } else {
                carousel
            }
        }
        .padding(.top, 20)
        .padding(.bottom, 24)
    }

    private var carousel: some View {
        VStack(spacing: 8) {
            TabView(selection: $index) {
                ForEach(Array(slides.enumerated()), id: \.element.id) { position, slide in
                    slideView(slide)
                        .tag(position)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .aspectRatio(16 / 9, contentMode: .fit)

            if slides.count > 1 {
                dots
            }
        }
        .onAppear { startAutoAdvance() }
        .onDisappear { autoAdvance?.cancel() }
        // 손으로 넘긴 뒤에는 자동 넘김을 처음부터 다시 센다.
        .onChange(of: index) { _, _ in startAutoAdvance() }
    }

    private func slideView(_ slide: BannerSlide) -> some View {
        Button {
            guard let link = slide.link else { return }
            openURL(link)
        } label: {
            BannerImage(slide: slide)
        }
        .buttonStyle(.plain)
        .disabled(slide.link == nil)
        .accessibilityLabel(slide.accessibilityLabel)
        .accessibilityAddTraits(slide.link == nil ? [] : .isLink)
    }

    private var dots: some View {
        HStack(spacing: 7) {
            ForEach(Array(slides.enumerated()), id: \.element.id) { position, _ in
                Capsule()
                    .fill(position == index ? Theme.Palette.primary : Theme.Palette.border)
                    .frame(width: position == index ? 22 : 9, height: 9)
                    .onTapGesture { withAnimation { index = position } }
                    .accessibilityLabel("\(position + 1)번째 배너 보기")
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .animation(.easeOut(duration: 0.2), value: index)
    }

    /// 걸 배너가 없을 때. 자리를 비워 두는 대신 신청 입구로 쓴다.
    private var inquiryFallback: some View {
        Button("홍보 신청하기") {
            router.present(.bannerInquiry)
        }
        .buttonStyle(OutlineButtonStyle(small: true))
    }

    private func startAutoAdvance() {
        autoAdvance?.cancel()
        guard slides.count > 1, !reduceMotion else { return }
        autoAdvance = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.rotationDelay)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    withAnimation(.easeInOut(duration: 0.46)) {
                        index = (index + 1) % slides.count
                    }
                }
            }
        }
    }
}

/// 배너 그림 한 장.
///
/// 임시 배너는 `/icons/...svg`를 가리키는데 iOS는 SVG를 내려받아 바로 그리지
/// 못한다. 그래서 앱에 함께 넣어 둔 같은 이름의 자산을 먼저 찾고, 없을 때만
/// 서버에서 받아 온다. 둘 다 실패하면 문구만으로 배너를 세운다.
struct BannerImage: View {
    let slide: BannerSlide

    /// 앱 자산으로 들고 있는 기본 배너. 파일 이름이 열쇠다.
    private static let bundled: [String: ImageResource] = [
        "banner-campus-mobile": .bannerCampusMobile,
        "banner-campus": .bannerCampus,
        "banner-recruit-mobile": .bannerRecruitMobile,
        "banner-recruit": .bannerRecruit,
        "banner-partnership-mobile": .bannerPartnershipMobile,
        "banner-partnership": .bannerPartnership
    ]

    private var bundledResource: ImageResource? {
        guard let source = slide.displaySource else { return nil }
        let name = (source as NSString).lastPathComponent
            .replacingOccurrences(of: ".svg", with: "")
            .replacingOccurrences(of: ".png", with: "")
        return Self.bundled[name]
    }

    private var remoteURL: URL? {
        guard bundledResource == nil, let source = slide.displaySource else { return nil }
        return APIConfiguration.current.resolve(path: source)
    }

    var body: some View {
        Group {
            if let bundledResource {
                Image(bundledResource)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                RemoteImage(url: remoteURL, contentMode: .fill, alignment: .center) {
                    AnyView(textFallback)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipped()
    }

    private var textFallback: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !slide.owner.isEmpty {
                Text(slide.owner)
                    .font(Theme.Typography.sans(11.5, .bold))
                    .foregroundStyle(Theme.Palette.railTextDim)
            }
            Text(slide.text.nilIfEmpty ?? slide.name)
                .font(Theme.Typography.sans(17, .bold))
                .foregroundStyle(Theme.Palette.railText)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.Palette.railBackground)
    }
}
