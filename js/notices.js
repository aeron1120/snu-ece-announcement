const notices = [
  {
    id: 1,
    title: "2026학년도 전기정보공학부 세미나 안내",
    category: "세미나",
    date: "2026-03-27",
    summary: "반도체 및 AI 융합 세미나 안내",
    content: "세미나 상세 내용...",
    images: []
  },
  {
    id: 2,
    title: "장학금 신청 공지",
    category: "장학",
    date: "2026-03-26",
    summary: "장학금 신청 기간 및 방법 안내",
    content: "장학금 공지 상세...",
    images: []
  }
];

function getAllNotices() {
  return notices;
}

function getNoticeById(id) {
  return notices.find(notice => notice.id === Number(id));
}