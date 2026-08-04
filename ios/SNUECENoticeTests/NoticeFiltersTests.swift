import XCTest
@testable import SNUECENotice

/// 목록을 거르는 일은 전부 서버가 한다. 앱이 틀리면 질의 문자열에서 틀린다.
/// 웹 `getNoticeListFilters()`가 보내는 것과 짝이 맞는지 여기서 붙잡는다.
final class NoticeFiltersTests: XCTestCase {
    private func query(_ filters: NoticeFilters, page: Int = 1) -> [String: String] {
        Dictionary(
            uniqueKeysWithValues: filters.queryItems(page: page, limit: 16)
                .map { ($0.name, $0.value ?? "") }
        )
    }

    func testDefaultFiltersSendServerDefaults() {
        let items = query(NoticeFilters())
        XCTAssertEqual(items["page"], "1")
        XCTAssertEqual(items["limit"], "16")
        XCTAssertEqual(items["target"], "전체")
        XCTAssertEqual(items["deadlineStatus"], "전체")
        XCTAssertEqual(items["host"], "전체")
        XCTAssertEqual(items["views"], "전체")
        XCTAssertEqual(items["sort"], "최신순")
        // 관련 공지는 평소에 켜져 있으므로 출처를 가리지 않는다.
        XCTAssertEqual(items["source"], "전체")
        // 빈 값은 아예 보내지 않는다.
        XCTAssertNil(items["search"])
        XCTAssertNil(items["category"])
        XCTAssertNil(items["dateFrom"])
        // 빠른 필터는 켠 것만 보낸다.
        XCTAssertNil(items["urgent"])
        XCTAssertNil(items["past"])
    }

    func testCategoryIdsAreSentAsSortedCommaList() {
        var filters = NoticeFilters()
        filters.selectedCategoryIds = [3, 1]
        XCTAssertEqual(query(filters)["category"], "1,3")
    }

    func testSearchTextIsTrimmed() {
        var filters = NoticeFilters()
        filters.searchText = "  전공진입  "
        XCTAssertEqual(query(filters)["search"], "전공진입")
    }

    func testQuickFiltersAreSentOnlyWhenOn() {
        var filters = NoticeFilters()
        filters.toggle(.urgent)
        filters.toggle(.reward)
        let items = query(filters)
        XCTAssertEqual(items["urgent"], "true")
        XCTAssertEqual(items["reward"], "true")
        XCTAssertNil(items["action"])
        XCTAssertNil(items["past"])
    }

    /// 관련 공지 스위치를 끄면 손으로 올린 공지만 남는다.
    func testTurningOffRelatedNoticesNarrowsSourceToManual() {
        var filters = NoticeFilters()
        filters.includeRelated = false
        XCTAssertEqual(query(filters)["source"], "manual")
    }

    func testDateRangeIsSentAsIsoDays() {
        var filters = NoticeFilters()
        filters.dateFrom = DateFormatting.parseDay("2026-08-01")
        filters.dateTo = DateFormatting.parseDay("2026-08-31")
        let items = query(filters)
        XCTAssertEqual(items["dateFrom"], "2026-08-01")
        XCTAssertEqual(items["dateTo"], "2026-08-31")
    }

    // MARK: - 조건이 걸려 있는지

    func testDefaultFiltersAreNotConsideredActive() {
        XCTAssertFalse(NoticeFilters().hasActiveQuery)
        XCTAssertFalse(NoticeFilters().hasDetailedFilters)
    }

    func testAnyChangedConditionCountsAsActive() {
        var filters = NoticeFilters()
        filters.target = "24학번"
        XCTAssertTrue(filters.hasDetailedFilters)
        XCTAssertTrue(filters.hasActiveQuery)

        var searchOnly = NoticeFilters()
        searchOnly.searchText = "장학"
        // 검색어만으로는 '상세 필터'가 걸린 것은 아니다.
        XCTAssertFalse(searchOnly.hasDetailedFilters)
        XCTAssertTrue(searchOnly.hasActiveQuery)
    }

    /// 정렬은 조건이 아니다. 정렬만 바꿨다고 "결과 N건"이 나오면 안 된다.
    func testSortAloneIsNotAnActiveQuery() {
        var filters = NoticeFilters()
        filters.sort = .views
        XCTAssertFalse(filters.hasActiveQuery)
    }

    // MARK: - 칩

    func testActiveChipsListEveryAppliedCondition() {
        var filters = NoticeFilters()
        filters.target = "23학번"
        filters.deadlineStatus = .imminent
        filters.host = "학사과"
        filters.includeRelated = false
        filters.toggle(.reward)

        let kinds = filters.activeChips.map(\.kind)
        XCTAssertEqual(kinds, [.target, .deadlineStatus, .host, .related, .reward])
    }

    func testClearingAChipResetsOnlyThatCondition() {
        var filters = NoticeFilters()
        filters.target = "23학번"
        filters.host = "학사과"
        filters.clear(.host)
        XCTAssertEqual(filters.host, "전체")
        XCTAssertEqual(filters.target, "23학번")
    }

    /// '필터 전체 초기화'는 검색어와 카테고리 탭은 건드리지 않는다.
    func testResetDetailedKeepsSearchAndCategory() {
        var filters = NoticeFilters()
        filters.searchText = "장학"
        filters.selectedCategoryIds = [2]
        filters.sort = .deadline
        filters.target = "23학번"
        filters.toggle(.past)

        filters.resetDetailed()

        XCTAssertEqual(filters.searchText, "장학")
        XCTAssertEqual(filters.selectedCategoryIds, [2])
        XCTAssertEqual(filters.sort, .deadline)
        XCTAssertEqual(filters.target, "전체")
        XCTAssertFalse(filters.includePast)
    }
}
