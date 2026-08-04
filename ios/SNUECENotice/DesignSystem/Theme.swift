import SwiftUI

/// 웹 `core.css`의 `:root` 토큰을 그대로 옮긴 자리.
///
/// 원칙도 같이 가져온다 — 모서리 0, 네이비 단색, 흰 바탕, 1px 테두리.
/// 색을 새로 쓰고 싶으면 여기에만 더한다. 화면 파일에 리터럴 색을 두지 않는다.
enum Theme {
    enum Palette {
        static let primary = Color(hex: 0x1F3F8F)
        static let primaryDeep = Color(hex: 0x1F3F8F)
        static let primaryHover = Color(hex: 0x17337A)
        static let primaryLight = Color(hex: 0xEAF0FB)

        static let railBackground = Color(hex: 0x1F3F8F)
        static let railText = Color.white
        static let railTextDim = Color(hex: 0xC4D1EA)

        static let background = Color.white
        static let cardBackground = Color.white
        static let textMain = Color(hex: 0x1A1D21)
        static let textSub = Color(hex: 0x6B7280)
        static let textMuted = Color(hex: 0x5B6270)

        static let border = Color(hex: 0xE3E5E9)
        static let borderSoft = Color(hex: 0xEEF0F3)
        /// 모바일 카드 테두리. 데스크톱보다 한 단계 진하다.
        static let cardBorder = Color(hex: 0xDFE4ED)

        static let danger = Color(hex: 0xC0392B)
        static let dangerBackground = Color(hex: 0xFDF2F0)
        static let ok = Color(hex: 0x2F6B48)
        static let okBackground = Color(hex: 0xEEF5F0)
        static let warning = Color(hex: 0x8A6D1F)
        static let warningBackground = Color(hex: 0xFDF8E9)

        static let tagBackground = Color(hex: 0xF3F4F6)
        static let tagText = Color(hex: 0x5B6270)
        static let tagExpiredBackground = Color(hex: 0xE8EAEE)
        static let tagExpiredText = Color(hex: 0x59616D)
        static let tagPinnedBackground = Color(hex: 0xFFF3CC)
        static let tagPinnedText = Color(hex: 0x5B3B00)

        static let rewardBackground = Color(hex: 0xFDF4E0)
        static let rewardText = Color(hex: 0x8A5A00)

        /// 사진 없는 공지의 포스터 바탕. 배경 사진이 얹히기 전의 밑색이다.
        static let posterBackground = Color(hex: 0x24365E)
        static let posterPlaceholder = Color(hex: 0xF4F5F7)

        static let expiredCardBackground = Color(hex: 0xF7F8FA)
        static let footerText = Color(hex: 0x8A919D)
        static let footerLink = Color(hex: 0x6F7885)
        static let disabledBackground = Color(hex: 0xF4F5F7)
        static let disabledText = Color(hex: 0xA1A7B1)
    }

    enum Metrics {
        /// 모바일 본문 좌우 여백. `mobile.css`의 `.page-main { padding: 12px }`.
        static let pagePadding: CGFloat = 12
        /// 카드 두 열 사이 간격.
        static let gridSpacing: CGFloat = 10
        /// 손가락으로 누르는 자리의 최소 크기.
        static let tapTarget: CGFloat = 44
        /// 왼쪽 서랍 폭. `min(280px, 82vw)`.
        static let drawerWidth: CGFloat = 280
        static let drawerMaxWidthRatio: CGFloat = 0.82
        /// 컨트롤 모서리. 모바일에서는 버튼·입력칸이 둥글다.
        static let controlRadius: CGFloat = 14
        static let sheetRadius: CGFloat = 18
        static let searchRadius: CGFloat = 24
    }

    enum Typography {
        /// 학교 이름·브랜드 워드마크에 쓰는 명조. 기기에 없으면 시스템 명조로 떨어진다.
        static func serif(size: CGFloat, weight: Font.Weight = .heavy) -> Font {
            .system(size: size, weight: weight, design: .serif)
        }

        static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
