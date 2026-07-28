export const CANONICAL_NOTICE_CATEGORIES = Object.freeze([
    Object.freeze({
        key: 'ACADEMIC',
        name: '학사',
        slug: 'academic',
        definition: '수강·학점·졸업·성적·전공진입처럼 학사 상태에 직접 영향을 주는 공지'
    }),
    Object.freeze({
        key: 'OPPORTUNITY',
        name: '기회',
        slug: 'opportunity',
        definition: '인턴·연구실·모집·공모전·대회·장학·교환처럼 참여 기회를 제공하는 공지'
    }),
    Object.freeze({
        key: 'BENEFIT',
        name: '혜택',
        slug: 'benefit',
        definition: '할인·지원·물품·제휴처럼 놓쳐도 학사상 불이익은 없는 경제적 혜택 공지'
    }),
    Object.freeze({
        key: 'COMMUNITY',
        name: '자치·행사',
        slug: 'community',
        definition: '학생 자치, 학내 행사, 시설·출입·교통 등 공동체와 캠퍼스 생활에 관한 공지'
    })
]);

export const NOTICE_CATEGORY_KEYS = Object.freeze(
    CANONICAL_NOTICE_CATEGORIES.map(category => category.key)
);
