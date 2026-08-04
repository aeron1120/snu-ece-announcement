import SwiftUI

@main
struct SNUECENoticeApp: App {
    @StateObject private var board = BoardViewModel()
    @StateObject private var notifications = NotificationPreferencesStore()
    @StateObject private var analytics = BetaAnalytics()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(board)
                .environmentObject(notifications)
                .environmentObject(analytics)
                .tint(Theme.Palette.primary)
                // 화면은 흰 바탕 하나로 짜여 있다. 다크 모드 팔레트를 따로
                // 만들지 않았으므로 시스템 설정과 무관하게 라이트로 고정한다.
                .preferredColorScheme(.light)
                .environment(\.locale, DateFormatting.koreanLocale)
        }
    }
}
