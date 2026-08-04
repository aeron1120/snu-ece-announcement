import SwiftUI

/// 알림 설정 화면. 웹의 `#notification-modal`과 같은 항목을 담는다.
struct NotificationPreferencesView: View {
    @EnvironmentObject private var store: NotificationPreferencesStore
    @EnvironmentObject private var board: BoardViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("선택한 학번과 카테고리에 맞는 공지의 마감을 이 기기가 알려드립니다. 알림이 켜지면 제목 옆 종이 노란색으로 바뀝니다.")
                        .font(Theme.Typography.sans(13))
                        .foregroundStyle(Theme.Palette.textSub)
                        .listRowBackground(Color.clear)
                }

                Section("대상 학번") {
                    Picker("대상 학번", selection: Binding(
                        get: { store.preferences.year ?? "" },
                        set: { store.preferences.year = $0.isEmpty ? nil : $0 }
                    )) {
                        Text("학번 제한 없음").tag("")
                        ForEach(NotificationPreferences.yearOptions, id: \.self) { year in
                            Text(year).tag(year)
                        }
                    }
                }

                Section("관심 카테고리") {
                    Toggle("모든 카테고리 알림", isOn: $store.preferences.allCategories)
                        .tint(Theme.Palette.primary)

                    if !store.preferences.allCategories {
                        if board.orderedCategories.isEmpty {
                            Text("카테고리를 불러오는 중입니다.")
                                .font(Theme.Typography.sans(13))
                                .foregroundStyle(Theme.Palette.textSub)
                        } else {
                            ForEach(board.orderedCategories) { category in
                                Toggle(category.name, isOn: binding(for: category.id))
                                    .tint(Theme.Palette.primary)
                            }
                        }
                    }
                }

                Section("마감 알림") {
                    Toggle("마감 임박 공지 포함", isOn: $store.preferences.includeUrgent)
                        .tint(Theme.Palette.primary)

                    Picker("마감 알림", selection: Binding(
                        get: { store.preferences.reminderDaysBefore ?? 0 },
                        set: { store.preferences.reminderDaysBefore = $0 == 0 ? nil : $0 }
                    )) {
                        Text("별도 마감 알림 없음").tag(0)
                        ForEach(NotificationPreferences.reminderOptions, id: \.self) { days in
                            Text("마감 \(days)일 전").tag(days)
                        }
                    }
                }

                if let message = store.statusMessage {
                    Section {
                        Text(message)
                            .font(Theme.Typography.sans(13, .semibold))
                            .foregroundStyle(Theme.Palette.textSub)
                    }
                }

                Section {
                    Button {
                        Task {
                            await store.save()
                            await store.rescheduleReminders(for: board.notices)
                        }
                    } label: {
                        Text(store.isSubscribed ? "설정 저장" : "알림 허용 및 저장")
                    }
                    .buttonStyle(FilledButtonStyle())
                    .disabled(store.isBusy)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                    if store.isSubscribed {
                        Button("알림 해지", role: .destructive) {
                            Task { await store.unsubscribe() }
                        }
                        .frame(maxWidth: .infinity)
                        .disabled(store.isBusy)
                    }
                } footer: {
                    Text("이 앱의 마감 알림은 기기 안에서 예약됩니다. 새 공지를 실시간으로 밀어 주는 서버 알림은 백엔드에 APNs 발송 경로가 추가되면 함께 켜집니다.")
                        .font(Theme.Typography.sans(11.5))
                }
            }
            .navigationTitle("공지 알림 받기")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") { dismiss() }
                }
            }
            .onDisappear { store.clearStatus() }
        }
    }

    private func binding(for categoryId: Int) -> Binding<Bool> {
        Binding(
            get: { store.preferences.categoryIds.contains(categoryId) },
            set: { isOn in
                if isOn {
                    store.preferences.categoryIds.insert(categoryId)
                } else {
                    store.preferences.categoryIds.remove(categoryId)
                }
            }
        )
    }
}
