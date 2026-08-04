import XCTest
@testable import SNUECENotice

/// 베타 평가를 묻는 시점은 웹 `recordBetaNoticeOpen()`과 같아야 한다 —
/// 3번째와 13번째 열람에서 한 번씩, 같은 지점에서는 다시 묻지 않는다.
@MainActor
final class BetaAnalyticsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var analytics: BetaAnalytics!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "beta-analytics-tests")!
        defaults.removePersistentDomain(forName: "beta-analytics-tests")
        // 실제 서버로 이벤트가 나가지 않도록 닿지 않는 주소를 물린다.
        let configuration = APIConfiguration(
            baseURL: URL(string: "http://127.0.0.1:1")!,
            publicSiteURL: URL(string: "http://127.0.0.1:1")!
        )
        analytics = BetaAnalytics(defaults: defaults, client: APIClient(configuration: configuration))
        analytics.promptDelay = .zero
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: "beta-analytics-tests")
        super.tearDown()
    }

    private func waitForPrompt() async {
        // promptDelay가 0이어도 Task 한 바퀴는 돌아야 한다.
        for _ in 0..<50 where analytics.pendingPrompt == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    func testSessionIdIsStableAndServerAcceptable() {
        let first = analytics.sessionId
        let second = analytics.sessionId
        XCTAssertEqual(first, second, "식별자는 한 번 만들면 유지된다")
        // 서버 검증 규칙: /^[A-Za-z0-9_-]{24,128}$/
        XCTAssertNotNil(first.range(of: "^[A-Za-z0-9_-]{24,128}$", options: .regularExpression))
    }

    func testPromptAppearsAtThirdOpen() async {
        analytics.noticeOpened()
        analytics.noticeOpened()
        XCTAssertNil(analytics.pendingPrompt)

        analytics.noticeOpened()
        await waitForPrompt()
        XCTAssertEqual(analytics.pendingPrompt?.milestone, 3)
    }

    func testPromptIsNotRepeatedAtTheSameMilestone() async {
        for _ in 0..<3 { analytics.noticeOpened() }
        await waitForPrompt()
        analytics.dismissPrompt()

        // 같은 이정표를 이미 물었으므로 4번째 열람에서는 조용하다.
        analytics.noticeOpened()
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertNil(analytics.pendingPrompt)
    }

    func testSecondMilestoneAtThirteenthOpen() async {
        for _ in 0..<3 { analytics.noticeOpened() }
        await waitForPrompt()
        analytics.submitRating(4)

        for _ in 4...12 { analytics.noticeOpened() }
        XCTAssertNil(analytics.pendingPrompt)

        analytics.noticeOpened() // 13번째
        await waitForPrompt()
        XCTAssertEqual(analytics.pendingPrompt?.milestone, 13)
    }

    func testHelpTextMatchesMilestone() {
        XCTAssertTrue(BetaAnalytics.RatingPrompt(milestone: 3).helpText.contains("공지 3개"))
        XCTAssertTrue(BetaAnalytics.RatingPrompt(milestone: 13).helpText.contains("13회"))
    }

    func testSubmitRatingClosesPrompt() async {
        for _ in 0..<3 { analytics.noticeOpened() }
        await waitForPrompt()
        analytics.submitRating(5)
        XCTAssertNil(analytics.pendingPrompt)
    }
}
