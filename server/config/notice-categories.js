export const CANONICAL_NOTICE_CATEGORIES = Object.freeze([
    Object.freeze({
        name: '신청',
        slug: 'application',
        definition: '사용자가 링크나 양식을 눌러 직접 제출해야 하며 명시적인 마감이 있는 공지'
    }),
    Object.freeze({
        name: '학사',
        slug: 'academics',
        definition: '학점·졸업·수강에 영향을 주고 다른 일반 채널로 대체하기 어려운 필수 학사 공지'
    }),
    Object.freeze({
        name: '혜택/제휴',
        slug: 'benefits-partnerships',
        definition: '돈·물품·할인·지원 등 경제적 혜택이 있지만 놓쳐도 학사상 불이익은 없는 공지'
    }),
    Object.freeze({
        name: '캠퍼스',
        slug: 'campus',
        definition: '특정 날짜에 출입·시설·교통·정전 등 캠퍼스 상태가 평소와 달라지는 공지'
    }),
    Object.freeze({
        name: '자치',
        slug: 'governance',
        definition: '주 수신 대상이 일반 학부생이 아니라 대의원·학생회 집행부 등 자치기구 구성원인 공지'
    })
]);
