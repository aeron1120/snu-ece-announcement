import Foundation
import SwiftUI

/// 베타 테스트 측정. 웹 `initializeBetaAnalytics()`·`recordBetaNoticeOpen()`을 옮겼다.
///
/// 기기 난수 식별자만 보내며 서버에는 그 해시만 저장된다. 이름·연락처는 없다.
/// 공지를 3번째, 13번째 열었을 때 한 번씩 1~5점 평가를 묻고, 같은 지점에서는
/// 다시 묻지 않는다.
@MainActor
final class BetaAnalytics: ObservableObject {
    enum EventType: String {
        case pageView = "page_view"
        case returnVisit = "return_visit"
        case rating
    }

    /// 평가를 묻는 열람 횟수. 웹 `BETA_RATING_MILESTONES`와 같다.
    static let ratingMilestones = [3, 13]

    /// 지금 띄울 평가창. nil이 아니면 화면이 모달을 올린다.
    @Published var pendingPrompt: RatingPrompt?

    struct RatingPrompt: Identifiable, Equatable {
        let milestone: Int
        var id: Int { milestone }

        var helpText: String {
            milestone == 3
                ? "공지 3개를 열어본 시점의 평가를 남겨주세요. 익명으로 집계됩니다."
                : "공지를 13회 열어본 후의 평가를 남겨주세요. 이후에는 다시 묻지 않습니다."
        }
    }

    private let defaults: UserDefaults
    private let client: APIClient
    /// 평가창을 띄우기 전의 뜸. 상세가 먼저 눈에 들어오게 한다. 테스트에서는 0으로 줄인다.
    var promptDelay: Duration = .milliseconds(450)

    /// 저장 열쇠. 웹 localStorage의 키와 같은 이름을 써 의미가 이어지게 한다.
    private static let sessionKey = "eceBetaAnalyticsId"
    private static let visitedKey = "eceBetaAnalyticsVisited"
    private static let openCountKey = "eceBetaNoticeOpenCount"
    private static let promptedKey = "eceBetaRatingPrompts"

    init(defaults: UserDefaults = .standard, client: APIClient = APIClient()) {
        self.defaults = defaults
        self.client = client
    }

    /// 세션 식별자. 서버가 `[A-Za-z0-9_-]{24,128}`만 받으므로 UUID에서 붙임표를 뺀다.
    var sessionId: String {
        if let existing = defaults.string(forKey: Self.sessionKey), !existing.isEmpty {
            return existing
        }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        defaults.set(id, forKey: Self.sessionKey)
        return id
    }

    /// 앱을 열 때 한 번. 첫 방문이면 page_view만, 재방문이면 return_visit도 보낸다.
    func appLaunched() {
        let hasVisited = defaults.bool(forKey: Self.visitedKey)
        track(.pageView)
        if hasVisited { track(.returnVisit) }
        defaults.set(true, forKey: Self.visitedKey)
    }

    /// 공지 상세를 열 때마다. 이정표에 닿으면 평가창을 예약한다.
    /// 웹처럼 살짝(450ms) 뜸을 들여 상세가 먼저 눈에 들어오게 한다.
    func noticeOpened() {
        let count = defaults.integer(forKey: Self.openCountKey) + 1
        defaults.set(count, forKey: Self.openCountKey)
        guard Self.ratingMilestones.contains(count) else { return }

        var prompted = defaults.array(forKey: Self.promptedKey) as? [Int] ?? []
        guard !prompted.contains(count) else { return }
        prompted.append(count)
        defaults.set(prompted, forKey: Self.promptedKey)

        Task { [weak self, promptDelay] in
            try? await Task.sleep(for: promptDelay)
            self?.pendingPrompt = RatingPrompt(milestone: count)
        }
    }

    func submitRating(_ score: Int) {
        if (1...5).contains(score) { track(.rating, rating: score) }
        pendingPrompt = nil
    }

    func dismissPrompt() {
        pendingPrompt = nil
    }

    /// 전송 실패는 조용히 삼킨다. 측정이 안 됐다고 화면을 막을 일이 아니다.
    func track(_ type: EventType, rating: Int? = nil) {
        struct Payload: Encodable {
            let type: String
            let rating: Int?
            let sessionId: String
            let pagePath: String
        }
        let payload = Payload(type: type.rawValue, rating: rating, sessionId: sessionId, pagePath: "/")
        let client = client
        Task.detached(priority: .utility) {
            _ = try? await client.post(EmptyResponse.self, path: "/api/analytics/events", body: payload)
        }
    }
}

/// 베타 평가창. 웹 `#beta-rating-modal`과 같은 구성 — 머리말, 제목, 안내,
/// 1~5점 버튼, "지금은 넘기기".
struct BetaRatingPromptView: View {
    let prompt: BetaAnalytics.RatingPrompt
    let onRate: (Int) -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(spacing: 0) {
                Text("베타 테스팅")
                    .font(Theme.Typography.sans(11, .heavy))
                    .tracking(1.3)
                    .foregroundStyle(Theme.Palette.primary)

                Text("공지방 사용은 어떠셨나요?")
                    .font(Theme.Typography.sans(21, .bold))
                    .foregroundStyle(Theme.Palette.textMain)
                    .padding(.top, 7)

                Text(prompt.helpText)
                    .font(Theme.Typography.sans(13))
                    .lineSpacing(4)
                    .foregroundStyle(Theme.Palette.textSub)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)

                HStack(spacing: 8) {
                    ForEach(1...5, id: \.self) { score in
                        Button {
                            onRate(score)
                        } label: {
                            Text("\(score)")
                                .font(Theme.Typography.sans(15, .heavy))
                                .foregroundStyle(Theme.Palette.textMain)
                                .frame(width: 44, height: 42)
                                .background(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(Color.white)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                                .stroke(Theme.Palette.border, lineWidth: 1)
                                        )
                                )
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("\(score)점")
                    }
                }
                .padding(.top, 18)

                Button("지금은 넘기기", action: onDismiss)
                    .font(Theme.Typography.sans(12))
                    .foregroundStyle(Theme.Palette.textSub)
                    .padding(.top, 14)
            }
            .padding(24)
            .frame(maxWidth: 420)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color.white)
            )
            .padding(.horizontal, 24)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
    }
}
