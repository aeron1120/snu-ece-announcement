import SwiftUI

/// 상세 필터를 여닫는 바. 켜 둔 조건은 이 줄에 칩으로 남아 한눈에 보인다.
struct FilterToggleBar: View {
    let isExpanded: Bool
    let chips: [FilterChip]
    let onToggle: () -> Void
    let onRemoveChip: (FilterChip.Kind) -> Void

    private var hasActive: Bool { !chips.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onToggle) {
                HStack(spacing: 7) {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.system(size: 12, weight: .heavy))
                    Text("상세 필터")
                        .font(Theme.Typography.sans(13, .bold))
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .heavy))
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .foregroundStyle(hasActive ? Theme.Palette.primary : Theme.Palette.textSub)
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if hasActive {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(chips) { chip in
                        ActiveFilterChip(chip: chip) { onRemoveChip(chip.kind) }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(hasActive ? Theme.Palette.primaryLight : Color.white)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(hasActive ? Theme.Palette.primary : Theme.Palette.border, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
    }
}

/// 걸어 둔 조건 하나. x를 누르면 그 조건만 풀린다.
/// 폰에서는 x가 빗나가면 뒤의 바가 눌리므로 누르는 자리를 넉넉히 잡았다.
struct ActiveFilterChip: View {
    let chip: FilterChip
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Text(chip.label)
                .font(Theme.Typography.sans(11.5, .bold))
                .lineLimit(1)
                .truncationMode(.tail)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .accessibilityLabel("\(chip.label) 조건 지우기")
        }
        .padding(.leading, 10)
        .padding(.vertical, -4)
        .foregroundStyle(Theme.Palette.primary)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.Palette.primary.opacity(0.35), lineWidth: 1)
                )
        )
    }
}

/// 자주 쓰는 조건 네 칸. 여러 개를 함께 켜면 모두 만족하는 공지만 남는다.
struct QuickFiltersRow: View {
    let isOn: (QuickFilter) -> Bool
    let onToggle: (QuickFilter) -> Void

    var body: some View {
        FlowLayout(spacing: 5, lineSpacing: 5) {
            ForEach(QuickFilter.allCases) { quick in
                let active = isOn(quick)
                Button {
                    onToggle(quick)
                } label: {
                    HStack(spacing: 4) {
                        if active {
                            Image(systemName: "checkmark")
                                .font(.system(size: 9, weight: .black))
                        }
                        Text(quick.label)
                            .font(Theme.Typography.sans(11.5, .bold))
                            .lineLimit(1)
                    }
                    .foregroundStyle(active ? .white : Theme.Palette.textSub)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(
                        Capsule()
                            .fill(active ? Theme.Palette.primary : Color.white)
                            .overlay(
                                Capsule().stroke(active ? Theme.Palette.primary : Theme.Palette.border, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(PressableStyle())
                .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
            }
        }
        .animation(.easeOut(duration: 0.15), value: QuickFilter.allCases.map(isOn))
    }
}

/// 펼쳐지는 상세 필터 패널. 웹의 `.filter-panel` 한 벌을 세로 한 줄로 편다.
struct FilterPanel: View {
    let filters: NoticeFilters
    let hosts: [String]
    let onApply: (NoticeFilters) -> Void
    let onReset: () -> Void
    let onClose: () -> Void

    /// 패널 안에서 만지는 동안은 이 사본을 고치고, 바뀐 즉시 위로 올려 보낸다.
    @State private var draft: NoticeFilters
    @State private var useDateRange = false

    init(filters: NoticeFilters, hosts: [String],
         onApply: @escaping (NoticeFilters) -> Void,
         onReset: @escaping () -> Void,
         onClose: @escaping () -> Void) {
        self.filters = filters
        self.hosts = hosts
        self.onApply = onApply
        self.onReset = onReset
        self.onClose = onClose
        _draft = State(initialValue: filters)
        _useDateRange = State(initialValue: filters.dateFrom != nil || filters.dateTo != nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            group("대상 학번") {
                Picker("대상 학번", selection: $draft.target) {
                    ForEach(NoticeFilters.targetOptions, id: \.self) { option in
                        Text(option == "전체" ? "전체 학번" : option).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.Palette.textMain)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(fieldBackground)
            }

            group("마감 상태") {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(NoticeFilters.DeadlineStatus.allCases) { status in
                        segmentButton(status.label, isActive: draft.deadlineStatus == status) {
                            draft.deadlineStatus = status
                        }
                    }
                }
            }

            group("주관 기관") {
                Picker("주관 기관", selection: $draft.host) {
                    Text("전체 기관").tag("전체")
                    ForEach(hosts, id: \.self) { host in
                        Text(host).tag(host)
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.Palette.textMain)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(fieldBackground)
            }

            group("관련 공지") {
                Toggle(isOn: $draft.includeRelated) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("학부 홈페이지에서 모아 온 공지 포함")
                            .font(Theme.Typography.sans(13.5, .semibold))
                            .foregroundStyle(Theme.Palette.textMain)
                        Text("끄면 직접 등록한 공지만 남습니다.")
                            .font(Theme.Typography.sans(11.5))
                            .foregroundStyle(Theme.Palette.textSub)
                    }
                }
                .tint(Theme.Palette.primary)
            }

            group("조회수") {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(NoticeFilters.ViewRange.allCases) { range in
                        segmentButton(range.label, isActive: draft.viewRange == range) {
                            draft.viewRange = range
                        }
                    }
                }
            }

            group("마감일 범위 직접 지정") {
                VStack(alignment: .leading, spacing: 10) {
                    Toggle("기간으로 좁히기", isOn: $useDateRange)
                        .font(Theme.Typography.sans(13.5, .semibold))
                        .foregroundStyle(Theme.Palette.textMain)
                        .tint(Theme.Palette.primary)

                    if useDateRange {
                        DatePicker("시작", selection: dateBinding(\.dateFrom), displayedComponents: .date)
                        DatePicker("종료", selection: dateBinding(\.dateTo), displayedComponents: .date)
                    }
                }
                .font(Theme.Typography.sans(13))
                .foregroundStyle(Theme.Palette.textMain)
            }

            HStack(spacing: 8) {
                Button("필터 전체 초기화") {
                    draft = NoticeFilters()
                    draft.searchText = filters.searchText
                    draft.selectedCategoryIds = filters.selectedCategoryIds
                    draft.sort = filters.sort
                    useDateRange = false
                    onReset()
                }
                .buttonStyle(OutlineButtonStyle(small: true))

                Button {
                    onClose()
                } label: {
                    HStack(spacing: 6) {
                        Text("필터 닫기")
                        Image(systemName: "chevron.up")
                            .font(.system(size: 12, weight: .heavy))
                    }
                }
                .buttonStyle(OutlineButtonStyle(small: true))
            }
            .padding(.top, 2)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.Metrics.sheetRadius, style: .continuous)
                .fill(Color.white)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Metrics.sheetRadius, style: .continuous)
                        .stroke(Theme.Palette.border, lineWidth: 1)
                )
        )
        .onChange(of: draft) { _, updated in onApply(updated) }
        .onChange(of: useDateRange) { _, enabled in
            if !enabled {
                draft.dateFrom = nil
                draft.dateTo = nil
            }
        }
        .onChange(of: filters) { _, updated in
            // 바깥에서 조건이 지워지면(칩 x, 초기화) 패널도 따라 맞춘다.
            if updated != draft {
                draft = updated
                useDateRange = updated.dateFrom != nil || updated.dateTo != nil
            }
        }
    }

    private var fieldBackground: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color(hex: 0xFAFAFA))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Theme.Palette.border, lineWidth: 1)
            )
    }

    private func dateBinding(_ keyPath: WritableKeyPath<NoticeFilters, Date?>) -> Binding<Date> {
        Binding(
            get: { draft[keyPath: keyPath] ?? Date() },
            set: { draft[keyPath: keyPath] = $0 }
        )
    }

    @ViewBuilder
    private func group(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(Theme.Typography.sans(12, .bold))
                .tracking(0.3)
                .foregroundStyle(Theme.Palette.textSub)
            content()
        }
    }

    private func segmentButton(_ label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.Typography.sans(12.5, .semibold))
                .foregroundStyle(isActive ? .white : Theme.Palette.textMain)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Metrics.controlRadius, style: .continuous)
                        .fill(isActive ? Theme.Palette.primary : Color.white)
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Metrics.controlRadius, style: .continuous)
                                .stroke(isActive ? Theme.Palette.primary : Theme.Palette.border, lineWidth: 1)
                        )
                )
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}
