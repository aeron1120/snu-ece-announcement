import Foundation

/// 공지 원문 안의 http(s) 주소를 눌러 열 수 있는 링크로 바꾼다.
///
/// 웹 `linkify()`가 하던 일이다. featurejaewon에서 규칙이 다듬어졌다 —
/// 한국어 조사는 URL 문자가 아니고, 문장 끝 문양(`.,;:!?`)과 짝 없는 닫는
/// 괄호는 링크에서 떼어낸다. 감지는 NSDataDetector가 하되, 떼어내는 규칙은
/// 웹과 같게 여기서 한 번 더 다듬는다.
enum Linkify {
    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    static func attributed(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        guard let detector else { return attributed }

        let nsText = text as NSString
        let matches = detector.matches(in: text, range: NSRange(location: 0, length: nsText.length))
        for match in matches {
            guard let url = match.url, let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else { continue }
            guard let fullRange = Range(match.range, in: text) else { continue }

            let matchedText = String(text[fullRange])
            let trimmedText = trimLinkBoundary(matchedText)
            guard !trimmedText.isEmpty, let trimmedURL = URL(string: trimmedText) else { continue }

            let linkRange = fullRange.lowerBound..<text.index(
                fullRange.lowerBound, offsetBy: trimmedText.count
            )
            guard let attributedRange = Range(linkRange, in: attributed) else { continue }
            attributed[attributedRange].link = trimmedURL
            attributed[attributedRange].underlineStyle = .single
        }
        return attributed
    }

    /// 링크 경계를 웹 규칙대로 다듬는다: 한글이 시작되는 곳에서 끊고,
    /// 문장 끝 문양과 짝 없는 닫는 괄호를 뒤에서 떼어낸다.
    static func trimLinkBoundary(_ value: String) -> String {
        var url = value

        // 한국어 조사가 붙어 온 경우("…ac.kr에서") 그 앞까지만 링크다.
        if let hangulIndex = url.firstIndex(where: isHangul) {
            url = String(url[url.startIndex..<hangulIndex])
        }

        let punctuation: Set<Character> = [".", ",", ";", ":", "!", "?"]
        let bracketPairs: [Character: Character] = [")": "(", "]": "[", "}": "{"]

        var trimming = true
        while trimming, let last = url.last {
            trimming = false
            if punctuation.contains(last) {
                url.removeLast()
                trimming = true
                continue
            }
            // 괄호 안에 적힌 링크라면 닫는 괄호는 문장의 것이다. URL 안에서
            // 여닫는 수가 맞으면(위키백과처럼 괄호가 주소의 일부인 경우) 남긴다.
            if let opening = bracketPairs[last] {
                let openCount = url.count { $0 == opening }
                let closeCount = url.count { $0 == last }
                if closeCount > openCount {
                    url.removeLast()
                    trimming = true
                }
            }
        }
        return url
    }

    private static func isHangul(_ character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first else { return false }
        return (0x3131...0x318E).contains(scalar.value) || (0xAC00...0xD7A3).contains(scalar.value)
    }

    /// 링크로 걸어도 되는 주소인지. 웹 `safeHttpUrl()`과 같은 기준으로,
    /// http(s)가 아닌 주소는 통째로 버린다.
    static func safeURL(_ value: String?) -> URL? {
        guard let value = value?.trimmed, !value.isEmpty,
              let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return url
    }
}
