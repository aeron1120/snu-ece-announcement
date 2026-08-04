import XCTest
@testable import SNUECENotice

/// D-Day와 날짜 표기는 웹 `calcDDay()`·`getNoticeDatePresentation()`과 한 글자도
/// 다르면 안 된다. 같은 공지를 웹과 앱에서 나란히 놓고 보는 사람이 있기 때문이다.
final class NoticePresentationTests: XCTestCase {
    /// 계산 기준이 되는 '오늘'. 실제 오늘을 쓰면 날이 바뀔 때 테스트가 흔들린다.
    private let today = DateFormatting.parseDay("2026-08-04")!

    private func day(_ offset: Int) -> String {
        let date = DateFormatting.calendar.date(byAdding: .day, value: offset, to: today)!
        return DateFormatting.isoDay(date)
    }

    private func notice(
        id: Int = 1,
        title: String = "테스트 공지",
        deadline: String? = nil,
        startDate: String? = nil,
        createdAt: String? = nil,
        isAlwaysOpen: Bool = false,
        target: String = "전체",
        targets: [String] = []
    ) -> Notice {
        let payload: [String: Any?] = [
            "id": id, "title": title, "target": target, "targets": targets,
            "host": "전기정보공학부", "deadline": deadline, "deadlineAt": deadline,
            "startDate": startDate, "isAlwaysOpen": isAlwaysOpen,
            "createdAt": createdAt, "views": 0, "aiSummary": []
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })
        return try! JSONDecoder().decode(Notice.self, from: data)
    }

    // MARK: - D-Day

    func testDeadlineWithoutValueIsAlwaysOpen() {
        let dDay = DDay.calculate(deadline: nil, now: today)
        XCTAssertEqual(dDay.text, "상시")
        XCTAssertFalse(dDay.isUrgent)
        XCTAssertFalse(dDay.isExpired)
    }

    func testDeadlineTodayReadsAsClosingToday() {
        let dDay = DDay.calculate(deadline: day(0), now: today)
        XCTAssertEqual(dDay.text, "오늘 마감")
        XCTAssertTrue(dDay.isUrgent)
        XCTAssertFalse(dDay.isExpired)
    }

    func testDeadlineWithinThreeDaysIsUrgent() {
        for offset in 1...3 {
            let dDay = DDay.calculate(deadline: day(offset), now: today)
            XCTAssertEqual(dDay.text, "D-\(offset)")
            XCTAssertTrue(dDay.isUrgent, "D-\(offset)은 마감 임박이어야 한다")
        }
    }

    func testDeadlineBeyondThreeDaysIsNotUrgent() {
        let dDay = DDay.calculate(deadline: day(4), now: today)
        XCTAssertEqual(dDay.text, "D-4")
        XCTAssertFalse(dDay.isUrgent)
    }

    func testPastDeadlineIsExpired() {
        let dDay = DDay.calculate(deadline: day(-1), now: today)
        XCTAssertEqual(dDay.text, "마감됨")
        XCTAssertTrue(dDay.isExpired)
        XCTAssertFalse(dDay.isUrgent)
    }

    /// 하루 차이는 시각이 아니라 달력 날짜로 센다. 밤 11시에 봐도 '내일 마감'은 D-1이다.
    func testDDayCountsCalendarDaysNotElapsedHours() {
        let lateNight = DateFormatting.calendar.date(bySettingHour: 23, minute: 59, second: 0, of: today)!
        XCTAssertEqual(DDay.calculate(deadline: day(1), now: lateNight).text, "D-1")
    }

    // MARK: - 날짜 표기

    func testAlwaysOpenNoticeShowsBadgeWithoutDates() {
        let presentation = NoticeDatePresentation.make(for: notice(deadline: day(3), isAlwaysOpen: true), now: today)
        XCTAssertEqual(presentation.badgeText, "상시")
        XCTAssertEqual(presentation.dateLabel, "")
        XCTAssertEqual(presentation.badgeStyle, NoticeDatePresentation.BadgeStyle.none)
    }

    func testNoticeWithoutDeadlineShowsOnlyStartDate() {
        let presentation = NoticeDatePresentation.make(
            for: notice(deadline: nil, startDate: "2026-09-01"), now: today
        )
        XCTAssertEqual(presentation.badgeText, "")
        XCTAssertEqual(presentation.dateLabel, "2026.09.01(화)")
    }

    /// 시작일이 없으면 등록일을 시작 자리에 세운다. 공지가 올라온 날부터
    /// 열려 있었다고 보는 편이 사실에 가깝다.
    func testRangeFallsBackToRegisteredDateWhenStartMissing() {
        let presentation = NoticeDatePresentation.make(
            for: notice(deadline: day(5), createdAt: "2026-08-01T09:00:00.000Z"), now: today
        )
        XCTAssertEqual(presentation.dateLabel, "2026.08.01(토) ~ 2026.08.09(일)")
        XCTAssertEqual(presentation.badgeText, "D-5")
    }

    /// 시작이 마감보다 뒤면 잘못 들어온 값이다. 그럴 때는 마감만 적는다.
    func testInvertedRangeShowsDeadlineOnly() {
        let presentation = NoticeDatePresentation.make(
            for: notice(deadline: day(1), startDate: day(9)), now: today
        )
        XCTAssertEqual(presentation.dateLabel, "2026.08.05(수)")
    }

    /// 시작과 끝이 같은 날이면 물결표로 잇지 않는다. 기간으로 오해하게 된다.
    func testSameDayRangeIsNotJoined() {
        let sameDay = day(2)
        let presentation = NoticeDatePresentation.make(
            for: notice(deadline: sameDay, startDate: sameDay), now: today
        )
        XCTAssertEqual(presentation.dateLabel, "2026.08.06(목)")
    }

    func testUrgentDeadlineMarksBadgeStyle() {
        XCTAssertEqual(NoticeDatePresentation.make(for: notice(deadline: day(2)), now: today).badgeStyle, .urgent)
        XCTAssertEqual(NoticeDatePresentation.make(for: notice(deadline: day(-2)), now: today).badgeStyle, .expired)
        XCTAssertEqual(NoticeDatePresentation.make(for: notice(deadline: day(10)), now: today).badgeStyle,
                       NoticeDatePresentation.BadgeStyle.none)
    }

    // MARK: - 상세 윗줄

    func testDetailMetaSkipsMissingParts() {
        XCTAssertEqual(
            NoticeDatePresentation.detailMeta(dateLabel: "", views: 3, registeredOn: nil),
            "조회: 3"
        )
        XCTAssertEqual(
            NoticeDatePresentation.detailMeta(dateLabel: "2026.08.04(화)", views: 12, registeredOn: "2026-08-01"),
            "2026.08.04(화)  |  등록 2026.08.01(토)  |  조회: 12"
        )
    }

    // MARK: - 상세 날짜 상자

    /// 값이 있는 항목만, 등록일 → 시작일 → 마감일 차례로 선다.
    func testDetailDateRowsListOnlyPresentDates() {
        let full = NoticeDatePresentation.detailDateRows(for: notice(
            deadline: "2026-08-10", startDate: "2026-08-01", createdAt: "2026-07-30T02:00:00.000Z"
        ))
        XCTAssertEqual(full.map(\.label), ["등록일", "시행·접수 시작일", "마감일"])
        XCTAssertEqual(full.map(\.value), ["2026.07.30(목)", "2026.08.01(토)", "2026.08.10(월)"])

        let deadlineOnly = NoticeDatePresentation.detailDateRows(for: notice(deadline: "2026-08-10"))
        XCTAssertEqual(deadlineOnly.map(\.label), ["마감일"])

        XCTAssertTrue(NoticeDatePresentation.detailDateRows(for: notice()).isEmpty)
    }

    // MARK: - 대상 배지

    func testTargetBadgeSummarisesMultipleYears() {
        XCTAssertEqual(notice(targets: []).targetBadge, "전체")
        XCTAssertEqual(notice(targets: ["24학번"]).targetBadge, "24학번")
        XCTAssertEqual(notice(targets: ["24학번", "25학번", "26학번"]).targetBadge, "24학번 외 2")
    }
}
