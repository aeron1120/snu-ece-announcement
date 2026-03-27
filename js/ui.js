function renderNoticeCards(noticeArray) {
  const list = document.getElementById("notice-list");
  list.innerHTML = "";

  noticeArray.forEach(notice => {
    const card = document.createElement("article");
    card.className = "notice-card";
    card.innerHTML = `
      <h3>${notice.title}</h3>
      <p>${notice.summary}</p>
      <span>${notice.category}</span>
      <span>${notice.date}</span>
      <button data-id="${notice.id}" class="detail-btn">자세히 보기</button>
    `;
    list.appendChild(card);
  });
}

function renderNoticeDetail(notice) {
  const detailBody = document.getElementById("detail-body");
  detailBody.innerHTML = `
    <h2>${notice.title}</h2>
    <p><strong>분류:</strong> ${notice.category}</p>
    <p><strong>날짜:</strong> ${notice.date}</p>
    <p>${notice.content}</p>
  `;
}

function openModal() {
  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("detail-modal").classList.add("hidden");
}