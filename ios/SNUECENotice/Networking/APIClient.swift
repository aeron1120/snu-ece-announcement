import Foundation

/// 서버가 돌려준 오류. 웹 `apiRequest()`가 던지던 것과 같은 정보를 담는다.
struct APIError: LocalizedError, Equatable {
    var message: String
    var statusCode: Int?
    var code: String?
    var retryAfterSeconds: Int?
    /// 사용자가 화면을 떠나거나 새로고침을 놓아 요청이 중간에 끊긴 경우.
    ///
    /// 실패가 아니라 '그만둔 것'이므로 화면에 오류로 알리지 않는다. 이것을
    /// 가려내지 않으면 당겨서 새로고침할 때마다 멀쩡한 목록이 연결 실패
    /// 안내로 덮인다.
    var isCancellation = false

    var errorDescription: String? { message }

    static let offline = APIError(message: "인터넷 연결을 확인해주세요.", statusCode: nil)

    static func transport(_ error: Error) -> APIError {
        if error is CancellationError {
            return APIError(message: "요청이 취소되었습니다.", isCancellation: true)
        }
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else {
            return APIError(message: error.localizedDescription)
        }
        switch nsError.code {
        case NSURLErrorCancelled:
            return APIError(message: "요청이 취소되었습니다.", isCancellation: true)
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost:
            return .offline
        case NSURLErrorTimedOut:
            return APIError(message: "서버 응답이 늦습니다. 잠시 후 다시 시도해주세요.")
        default:
            return APIError(message: "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.")
        }
    }
}

/// JSON API 한 겹. 웹 `apiRequest()`를 그대로 옮겨 온 자리다.
/// 응답이 `{ "error": "..." }`이면 그 문구를 그대로 사용자에게 보여준다.
struct APIClient {
    let configuration: APIConfiguration
    let session: URLSession

    init(configuration: APIConfiguration = .current, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func get<T: Decodable>(_ type: T.Type, path: String, queryItems: [URLQueryItem] = []) async throws -> T {
        try await send(type, path: path, method: "GET", queryItems: queryItems, body: nil)
    }

    @discardableResult
    func post<T: Decodable>(_ type: T.Type, path: String, body: Encodable? = nil) async throws -> T {
        let data = try body.map { try JSONEncoder().encode(AnyEncodable($0)) }
        return try await send(type, path: path, method: "POST", queryItems: [], body: data)
    }

    func send<T: Decodable>(
        _ type: T.Type,
        path: String,
        method: String,
        queryItems: [URLQueryItem],
        body: Data?
    ) async throws -> T {
        let data = try await sendRaw(path: path, method: method, queryItems: queryItems, body: body)
        if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T { return empty }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "서버 응답을 읽지 못했습니다.")
        }
    }

    func sendRaw(
        path: String,
        method: String,
        queryItems: [URLQueryItem] = [],
        body: Data? = nil
    ) async throws -> Data {
        guard var components = URLComponents(
            url: configuration.baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError(message: "잘못된 요청 주소입니다.")
        }
        if !queryItems.isEmpty { components.queryItems = queryItems }
        guard let url = components.url else { throw APIError(message: "잘못된 요청 주소입니다.") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body
        // 운영 API는 무료 Render 인스턴스라 한동안 요청이 없으면 잠든다.
        // 깨어나는 데 30초 가까이 걸리는 일이 있어 넉넉히 잡는다.
        request.timeoutInterval = 45

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: "서버 응답을 읽지 못했습니다.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw serverError(from: data, response: http)
        }
        return data
    }

    private func serverError(from data: Data, response: HTTPURLResponse) -> APIError {
        let payload = try? JSONDecoder().decode(ServerErrorPayload.self, from: data)
        let retryAfter = payload?.retryAfterSeconds
            ?? Int(response.value(forHTTPHeaderField: "retry-after") ?? "")
        return APIError(
            message: payload?.error?.trimmed.nilIfEmpty ?? "요청 실패 (\(response.statusCode))",
            statusCode: response.statusCode,
            code: payload?.code,
            retryAfterSeconds: retryAfter
        )
    }

    private struct ServerErrorPayload: Decodable {
        var error: String?
        var code: String?
        var retryAfterSeconds: Int?
    }
}

struct EmptyResponse: Decodable {}

/// `Encodable`을 값으로 담아 두기 위한 지우개 타입.
private struct AnyEncodable: Encodable {
    private let encode: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        encode = wrapped.encode(to:)
    }

    func encode(to encoder: Encoder) throws {
        try encode(encoder)
    }
}
