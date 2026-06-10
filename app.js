const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const PAGE_SIZE = 30;
const COMMENT_BATCH = 18;
const IMAGE_ENRICH_LIMIT = 5;

const feedLabels = {
  topstories: "Top stories",
  newstories: "New stories",
  beststories: "Best stories",
  askstories: "Ask HN",
  showstories: "Show HN"
};

const state = {
  feed: "topstories",
  ids: [],
  stories: [],
  visibleStories: [],
  metadata: new Map(),
  itemCache: new Map(),
  search: "",
  sort: "rank",
  selectedStory: null
};

const els = {
  tabs: document.querySelectorAll(".tab-button"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  sortSelect: document.querySelector("#sortSelect"),
  storyCount: document.querySelector("#storyCount"),
  commentCount: document.querySelector("#commentCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  feedTitle: document.querySelector("#feedTitle"),
  spotlightGrid: document.querySelector("#spotlightGrid"),
  storyList: document.querySelector("#storyList"),
  discussionList: document.querySelector("#discussionList"),
  drawer: document.querySelector("#commentDrawer"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerMeta: document.querySelector("#drawerMeta"),
  drawerActions: document.querySelector("#drawerActions"),
  commentsRoot: document.querySelector("#commentsRoot"),
  closeDrawer: document.querySelector("#closeDrawer"),
  skeletonTemplate: document.querySelector("#skeletonTemplate")
};

function endpoint(path) {
  return `${HN_BASE}/${path}.json`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchItem(id) {
  if (state.itemCache.has(id)) {
    return state.itemCache.get(id);
  }
  const item = await fetchJson(endpoint(`item/${id}`));
  state.itemCache.set(id, item);
  return item;
}

function plural(value, label) {
  return `${value.toLocaleString()} ${label}${value === 1 ? "" : "s"}`;
}

function timeAgo(unixTime) {
  if (!unixTime) return "unknown time";
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - unixTime));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  for (const [unit, size] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

function getDomain(url) {
  if (!url) return "news.ycombinator.com";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "external link";
  }
}

function articleUrl(story) {
  return story.url || `https://news.ycombinator.com/item?id=${story.id}`;
}

function hnUrl(story) {
  return `https://news.ycombinator.com/item?id=${story.id}`;
}

function initials(title = "HN") {
  return title
    .replace(/[^a-z0-9 ]/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "HN";
}

function sanitizeHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["A", "P", "I", "EM", "B", "STRONG", "CODE", "PRE", "BR"]);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    for (const attr of [...node.attributes]) {
      if (node.tagName === "A" && attr.name === "href") continue;
      node.removeAttribute(attr.name);
    }
    if (node.tagName === "A") {
      node.target = "_blank";
      node.rel = "noreferrer";
    }
  }
  return template.innerHTML;
}

function imageFromDirectUrl(url) {
  if (!url) return null;
  return /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url) ? url : null;
}

async function fetchMetadata(story) {
  const url = story.url;
  if (!url || state.metadata.has(story.id)) return state.metadata.get(story.id);

  const directImage = imageFromDirectUrl(url);
  if (directImage) {
    const metadata = { image: directImage, source: "direct" };
    state.metadata.set(story.id, metadata);
    return metadata;
  }

  try {
    const api = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=false&audio=false&video=false`;
    const data = await fetchJson(api);
    const image = data?.data?.image?.url || data?.data?.logo?.url || null;
    const metadata = {
      image,
      description: data?.data?.description || "",
      publisher: data?.data?.publisher || getDomain(url),
      source: "metadata"
    };
    state.metadata.set(story.id, metadata);
    return metadata;
  } catch {
    const metadata = { image: null, source: "fallback" };
    state.metadata.set(story.id, metadata);
    return metadata;
  }
}

function setLoading() {
  els.spotlightGrid.innerHTML = "";
  els.storyList.innerHTML = "";
  for (let index = 0; index < 5; index += 1) {
    const card = document.createElement("article");
    card.className = "spotlight-card";
    card.innerHTML = `<div class="spotlight-fallback">HN</div>`;
    els.spotlightGrid.append(card);
  }
  for (let index = 0; index < 8; index += 1) {
    els.storyList.append(els.skeletonTemplate.content.cloneNode(true));
  }
  els.discussionList.innerHTML = '<div class="loading-state">Loading discussions...</div>';
}

async function loadFeed(feed = state.feed) {
  state.feed = feed;
  state.stories = [];
  state.visibleStories = [];
  els.feedTitle.textContent = feedLabels[feed] || "Stories";
  setLoading();

  try {
    state.ids = await fetchJson(endpoint(feed));
    const storyIds = state.ids.slice(0, PAGE_SIZE);
    const stories = (await Promise.all(storyIds.map(fetchItem))).filter(Boolean);
    state.stories = stories.map((story, index) => ({ ...story, rank: index + 1 }));
    applyFilters();
    updateStats();
    enrichSpotlightImages();
  } catch (error) {
    els.storyList.innerHTML = `<div class="empty-state">HN could not be reached. Try refreshing in a moment.</div>`;
    els.spotlightGrid.innerHTML = "";
    els.discussionList.innerHTML = "";
    console.error(error);
  }
}

function applyFilters() {
  const query = state.search.trim().toLowerCase();
  let stories = [...state.stories];
  if (query) {
    stories = stories.filter((story) => {
      return [story.title, story.by, getDomain(story.url)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }

  stories.sort((a, b) => {
    if (state.sort === "score") return (b.score || 0) - (a.score || 0);
    if (state.sort === "comments") return (b.descendants || 0) - (a.descendants || 0);
    if (state.sort === "time") return (b.time || 0) - (a.time || 0);
    return a.rank - b.rank;
  });

  state.visibleStories = stories;
  renderAll();
}

function updateStats() {
  const comments = state.stories.reduce((sum, story) => sum + (story.descendants || 0), 0);
  els.storyCount.textContent = state.stories.length.toLocaleString();
  els.commentCount.textContent = comments.toLocaleString();
  els.lastUpdated.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function renderAll() {
  renderSpotlight();
  renderStories();
  renderDiscussionList();
}

function renderSpotlight() {
  const stories = state.visibleStories.slice(0, IMAGE_ENRICH_LIMIT);
  els.spotlightGrid.innerHTML = "";
  if (!stories.length) {
    els.spotlightGrid.innerHTML = `<div class="empty-state">No stories match this filter.</div>`;
    return;
  }

  for (const story of stories) {
    const metadata = state.metadata.get(story.id);
    const card = document.createElement("article");
    card.className = "spotlight-card";
    const imageHtml = metadata?.image
      ? `<img src="${metadata.image}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="spotlight-fallback">${initials(story.title)}</div>`;
    card.innerHTML = `
      ${imageHtml}
      <div class="spotlight-content">
        <h3><a href="${articleUrl(story)}" target="_blank" rel="noreferrer">${story.title}</a></h3>
        <div class="meta-row">
          <span class="pill">${story.score || 0} pts</span>
          <span>${plural(story.descendants || 0, "comment")}</span>
          <span>${getDomain(story.url)}</span>
        </div>
      </div>
    `;
    card.querySelector("a").addEventListener("click", (event) => event.stopPropagation());
    card.addEventListener("click", () => openComments(story.id));
    els.spotlightGrid.append(card);
  }
}

function renderStories() {
  els.storyList.innerHTML = "";
  if (!state.visibleStories.length) {
    els.storyList.innerHTML = `<div class="empty-state">No stories match this filter.</div>`;
    return;
  }

  for (const story of state.visibleStories) {
    const card = document.createElement("article");
    card.className = "story-card";
    card.innerHTML = `
      <div class="rank-box">${story.rank}</div>
      <div>
        <h3 class="story-title">
          <a href="${articleUrl(story)}" target="_blank" rel="noreferrer">${story.title}</a>
        </h3>
        <div class="story-meta">
          <span class="pill">${story.score || 0} pts</span>
          <span>by ${story.by || "unknown"}</span>
          <span>${timeAgo(story.time)}</span>
          <span>${getDomain(story.url)}</span>
        </div>
      </div>
      <div class="story-actions">
        <button class="text-button" type="button" data-comments="${story.id}">${story.descendants || 0} comments</button>
      </div>
    `;
    card.querySelector("[data-comments]").addEventListener("click", () => openComments(story.id));
    els.storyList.append(card);
  }
}

function renderDiscussionList() {
  const stories = [...state.stories]
    .sort((a, b) => (b.descendants || 0) - (a.descendants || 0))
    .slice(0, 6);
  els.discussionList.innerHTML = "";
  for (const story of stories) {
    const button = document.createElement("button");
    button.className = "discussion-item";
    button.type = "button";
    button.innerHTML = `
      <strong>${story.title}</strong>
      <span class="meta-row">
        <span class="pill">${story.descendants || 0}</span>
        <span>${story.score || 0} pts</span>
        <span>${timeAgo(story.time)}</span>
      </span>
    `;
    button.addEventListener("click", () => openComments(story.id));
    els.discussionList.append(button);
  }
}

async function enrichSpotlightImages() {
  const stories = state.stories.slice(0, IMAGE_ENRICH_LIMIT).filter((story) => story.url);
  await Promise.allSettled(stories.map(fetchMetadata));
  renderSpotlight();
}

async function openComments(storyId) {
  const story = await fetchItem(storyId);
  state.selectedStory = story;
  els.drawer.hidden = false;
  els.drawerBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  els.drawerTitle.textContent = story.title;
  els.drawerMeta.textContent = `${story.score || 0} points by ${story.by || "unknown"} - ${plural(story.descendants || 0, "comment")}`;
  els.drawerActions.innerHTML = `
    <a class="text-button primary" href="${articleUrl(story)}" target="_blank" rel="noreferrer">Open article</a>
    <a class="text-button" href="${hnUrl(story)}" target="_blank" rel="noreferrer">Open on HN</a>
  `;
  els.commentsRoot.innerHTML = '<div class="loading-state">Loading top comments...</div>';
  await renderComments(story);
}

async function renderComments(story) {
  if (!story.kids?.length) {
    els.commentsRoot.innerHTML = '<div class="empty-state">This story has no comments yet.</div>';
    return;
  }

  const root = document.createElement("div");
  const topIds = story.kids.slice(0, COMMENT_BATCH);
  const comments = (await Promise.all(topIds.map((id) => fetchCommentTree(id, 0)))).filter(Boolean);
  root.append(...comments);

  if (story.kids.length > COMMENT_BATCH) {
    const loadMore = document.createElement("button");
    loadMore.className = "text-button";
    loadMore.type = "button";
    loadMore.textContent = `Load ${Math.min(COMMENT_BATCH, story.kids.length - COMMENT_BATCH)} more comments`;
    loadMore.addEventListener("click", async () => {
      loadMore.disabled = true;
      loadMore.textContent = "Loading...";
      const start = root.querySelectorAll(":scope > .comment").length;
      const nextIds = story.kids.slice(start, start + COMMENT_BATCH);
      const nextComments = (await Promise.all(nextIds.map((id) => fetchCommentTree(id, 0)))).filter(Boolean);
      loadMore.before(...nextComments);
      const remaining = story.kids.length - start - nextIds.length;
      if (remaining > 0) {
        loadMore.disabled = false;
        loadMore.textContent = `Load ${Math.min(COMMENT_BATCH, remaining)} more comments`;
      } else {
        loadMore.remove();
      }
    });
    root.append(loadMore);
  }

  els.commentsRoot.innerHTML = "";
  els.commentsRoot.append(root);
}

async function fetchCommentTree(id, depth) {
  const comment = await fetchItem(id);
  if (!comment || comment.deleted || comment.dead) return null;

  const article = document.createElement("article");
  article.className = "comment";
  article.innerHTML = `
    <div class="comment-meta">
      <strong>${comment.by || "unknown"}</strong>
      <span>${timeAgo(comment.time)}</span>
    </div>
    <div class="comment-body">${sanitizeHtml(comment.text || "")}</div>
  `;

  if (comment.kids?.length && depth < 3) {
    const children = document.createElement("div");
    children.className = "comment-children";
    const childComments = (await Promise.all(
      comment.kids.slice(0, depth === 0 ? 5 : 3).map((childId) => fetchCommentTree(childId, depth + 1))
    )).filter(Boolean);
    children.append(...childComments);
    if (comment.kids.length > childComments.length) {
      const more = document.createElement("a");
      more.href = `https://news.ycombinator.com/item?id=${comment.id}`;
      more.target = "_blank";
      more.rel = "noreferrer";
      more.className = "text-button";
      more.textContent = `${comment.kids.length - childComments.length} more replies on HN`;
      children.append(more);
    }
    article.append(children);
  }

  return article;
}

function closeDrawer() {
  els.drawer.hidden = true;
  els.drawerBackdrop.hidden = true;
  document.body.style.overflow = "";
}

els.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    els.tabs.forEach((tab) => tab.classList.toggle("active", tab === button));
    loadFeed(button.dataset.feed);
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  applyFilters();
});

els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  applyFilters();
});

els.refreshButton.addEventListener("click", () => loadFeed(state.feed));
els.closeDrawer.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.drawer.hidden) closeDrawer();
});

loadFeed();
