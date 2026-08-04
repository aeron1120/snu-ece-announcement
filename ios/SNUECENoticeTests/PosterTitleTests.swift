import XCTest
@testable import SNUECENotice

/// 사진 없는 공지는 제목이 곧 포스터다. featurejaewon부터 모바일 포스터
/// 제목은 한 가지 크기로 고정이고, 포스터가 자라며 제목을 전부 담는다.
final class PosterTitleTests: XCTestCase {
    func testHostPrefixIsSplitIntoItsOwnLine() {
        let title = PosterTitle.make(from: "[전기정보공학부] 전공진입 신청 안내")
        XCTAssertEqual(title.hostLine, "[전기정보공학부]")
        XCTAssertEqual(title.body, "전공진입 신청 안내")
    }

    func testTitleWithoutHostPrefixKeepsWholeText() {
        let title = PosterTitle.make(from: "전공진입 신청 안내")
        XCTAssertNil(title.hostLine)
        XCTAssertEqual(title.body, "전공진입 신청 안내")
    }

    func testWhitespaceIsCollapsed() {
        let title = PosterTitle.make(from: "  전공진입   신청\n안내  ")
        XCTAssertEqual(title.body, "전공진입 신청 안내")
    }

    func testEmptyTitleFallsBackToPlaceholder() {
        XCTAssertEqual(PosterTitle.make(from: "   ").body, "제목 없음")
    }

    /// 대괄호만 있고 뒤가 비면 그 대괄호가 본문이 된다. 빈 포스터를 만들지 않는다.
    func testHostOnlyTitleStillHasBody() {
        let title = PosterTitle.make(from: "[전기정보공학부]")
        XCTAssertFalse(title.body.isEmpty)
    }

    /// 크기는 길이와 무관하게 고정이다. `mobile.css`의 14.5px과 같아야 한다.
    func testFontSizeIsFlatRegardlessOfLength() {
        XCTAssertEqual(PosterTitle.fontSize, 14.5)
        XCTAssertEqual(PosterTitle.lineHeight, 1.32)
    }
}
