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
        // 선발을 거쳐 자리·자격·지원금을 얻는 것. 붙고 떨어지는 일이 있다.
        definition: '인턴·연구실·공모전·대회·장학·교환처럼 선발을 거쳐 자리나 자격을 얻는 공지'
    }),
    Object.freeze({
        key: 'SURVEY',
        name: '설문',
        slug: 'survey',
        // 선발이 없다. 조건만 맞으면 참여해 응답하는 것으로 끝난다.
        // 기프티콘 같은 사례비는 딸린 조건일 뿐 분류 기준이 아니다.
        definition: '설문·인터뷰·실험 피험자·사용자 조사처럼 선발 없이 참여해 응답하면 끝나는 모집 공지'
    }),
    Object.freeze({
        key: 'COMMUNITY',
        name: '행사',
        slug: 'community',
        definition: '학생 자치, 축제·강연·세미나 등 학내 행사, 제휴·할인에 관한 공지'
    }),
    Object.freeze({
        key: 'OTHER',
        name: '기타',
        slug: 'other',
        definition: '시설·출입 통제·교통·서비스 운영 등 일반 안내와 학사·기회·설문·행사에 해당하지 않는 공지'
    })
]);

export const NOTICE_CATEGORY_KEYS = Object.freeze(
    CANONICAL_NOTICE_CATEGORIES.map(category => category.key)
);
