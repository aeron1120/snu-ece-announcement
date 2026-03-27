function filterNotices(notices, keyword, category) {
  return notices.filter(notice => {
    const matchesKeyword =
      notice.title.includes(keyword) ||
      notice.summary.includes(keyword) ||
      notice.content.includes(keyword);

    const matchesCategory =
      category === "all" || notice.category === category;

    return matchesKeyword && matchesCategory;
  });
}