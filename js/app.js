 
// 애플리케이션의 초기화 로직을 담당

function initializeApp() {
  const allNotices = getAllNotices();
  renderNoticeCards(allNotices);

  const searchInput = document.getElementById("search-input");
  const categoryFilter = document.getElementById("category-filter");

  function applyFilters() {
    const keyword = searchInput.value.trim();
    const category = categoryFilter.value;
    const filtered = filterNotices(allNotices, keyword, category);
    renderNoticeCards(filtered);
  }

  searchInput.addEventListener("input", applyFilters);
  categoryFilter.addEventListener("change", applyFilters);

  document.getElementById("notice-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("detail-btn")) {
      const id = e.target.dataset.id;
      const notice = getNoticeById(id);
      renderNoticeDetail(notice);
      openModal();
    }
  });

  document.getElementById("close-detail").addEventListener("click", closeModal);
}

initializeApp();