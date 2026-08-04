import XCTest
@testable import SNUECENotice

/// 링크 경계 규칙은 웹 `linkify()`와 같아야 한다. 같은 원문을 웹과 앱에서
/// 열었을 때 눌리는 범위가 달라지면 안 된다.
final class LinkifyTests: XCTestCase {
    func testTrailingSentencePunctuationIsTrimmed() {
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://ece.snu.ac.kr/notice/12."),
            "https://ece.snu.ac.kr/notice/12"
        )
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://ece.snu.ac.kr/notice?a=1,"),
            "https://ece.snu.ac.kr/notice?a=1"
        )
    }

    /// 한국어 조사는 URL 문자가 아니다. "…ac.kr에서"는 조사 앞까지만 링크다.
    func testHangulTerminatesTheLink() {
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://ece.snu.ac.kr에서"),
            "https://ece.snu.ac.kr"
        )
    }

    /// 괄호 안에 적힌 링크의 닫는 괄호는 문장의 것이므로 떼어낸다.
    func testUnbalancedClosingBracketIsTrimmed() {
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://ece.snu.ac.kr/notice)"),
            "https://ece.snu.ac.kr/notice"
        )
    }

    /// 주소 자체에 여닫는 괄호가 짝지어 있으면(위키 문서처럼) 남긴다.
    func testBalancedBracketsInsideURLAreKept() {
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://ko.wikipedia.org/wiki/서울(도시)"),
            // 한글에서 먼저 끊기므로 이 예시는 도메인까지만 남지만,
            // 괄호 규칙 자체는 ASCII 경로에서 살아 있어야 한다.
            "https://ko.wikipedia.org/wiki/"
        )
        XCTAssertEqual(
            Linkify.trimLinkBoundary("https://example.com/path_(v2)"),
            "https://example.com/path_(v2)"
        )
    }

    func testAttributedTextLinksOnlyTheURL() {
        let attributed = Linkify.attributed("자세한 내용은 https://ece.snu.ac.kr에서 확인하세요.")
        let links = attributed.runs.compactMap(\.link)
        XCTAssertEqual(links, [URL(string: "https://ece.snu.ac.kr")!])
    }

    func testPlainTextGetsNoLinks() {
        let attributed = Linkify.attributed("링크가 없는 평범한 공지 본문입니다.")
        XCTAssertTrue(attributed.runs.compactMap(\.link).isEmpty)
    }
}
