import SafariServices
import SwiftUI

/// 앱 안에서 여는 웹 페이지.
///
/// 아직 네이티브 화면으로 옮기지 않은 문서(이용약관·FAQ·홍보 신청 양식 등)를
/// 사파리로 튕겨 내보내는 대신 앱 위에 얹어 보여준다. 읽고 나면 그대로
/// 목록으로 돌아오므로 흐름이 끊기지 않는다.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.preferredControlTintColor = UIColor(Theme.Palette.primary)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// 홍보 신청. 양식과 검수 규칙이 서버 쪽에 있어 웹 양식을 그대로 띄운다.
/// 신청 흐름이 앱 화면으로 옮겨지면 이 자리를 네이티브 폼으로 바꾸면 된다.
struct BannerInquiryView: View {
    var body: some View {
        SafariView(url: APIConfiguration.current.publicSiteURL.appendingPathComponent("banner-inquiry.html"))
            .ignoresSafeArea()
    }
}
