// 목록과 읽기 화면을 그립니다. 데이터는 scripts/build.mjs 가 만든 data/ 폴더에서 옵니다.
const INDEX = window.DP_INDEX || { years: {} };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yearList = Object.keys(INDEX.years).map(Number).sort((a, b) => b - a);
let year = yearList[0];

function dateOf(y, d) {
  const [yy, mm, dd] = INDEX.years[y].start.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd + d - 1));
  return `${dt.getUTCFullYear()}.${pad(dt.getUTCMonth() + 1)}.${pad(dt.getUTCDate())} (${WEEK[dt.getUTCDay()]})`;
}
const keyOf = (y, d) => `${y}-${pad(d)}`;
const hashOf = (y, d) => `#y${y}-d${pad(d)}`;
const clock = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
// 시각 표시. 누르면 페이지 안의 플레이어가 그 지점으로 이동합니다. (href 는 새 탭으로 열 때를 위한 것)
const tsLink = (yt, sec, label) =>
  `<a class="ts" href="https://youtu.be/${yt}?t=${sec}" data-t="${sec}" title="영상을 ${label}부터 재생">${label}</a>`;

// ── 페이지 안 유튜브 플레이어 ──
let currentYt = null;     // 지금 보고 있는 회차의 영상
let player = null;        // 유튜브 플레이어 (API 방식)
let playerReady = false;
let plainFrame = null;    // API 를 못 불러왔을 때 쓰는 일반 iframe
let pendingSeek = null;   // 플레이어가 준비되기 전에 누른 시각
let apiPromise = null;

function loadYtApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiPromise = null; reject(new Error('youtube api')); };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const embedUrl = (yt, sec) =>
  `https://www.youtube.com/embed/${yt}?autoplay=1&playsinline=1&rel=0&start=${sec}`;

function resetPlayer() {
  if (player && player.destroy) { try { player.destroy(); } catch (e) { /* 이미 사라짐 */ } }
  player = null; playerReady = false; plainFrame = null; pendingSeek = null;
  $('r-player').replaceChildren();
  $('r-poster').hidden = false;
  $('r-video-note').hidden = true;
  const box = $('r-video');
  box.classList.remove('playing');
  delete box.dataset.loading;
}

function playAt(sec) {
  const box = $('r-video');
  if (!currentYt) return;
  if (player && playerReady) { player.seekTo(sec, true); player.playVideo(); return; }
  if (plainFrame) { plainFrame.src = embedUrl(currentYt, sec); return; }
  pendingSeek = sec;
  if (box.dataset.loading) return; // 불러오는 중이면 마지막에 누른 시각으로 시작합니다
  box.dataset.loading = '1';
  box.classList.add('playing');
  $('r-poster').hidden = true;
  $('r-video-note').hidden = true;
  const yt = currentYt;
  const slot = document.createElement('div');
  $('r-player').replaceChildren(slot);
  loadYtApi().then(() => {
    if (yt !== currentYt || !slot.isConnected) return;
    player = new window.YT.Player(slot, {
      videoId: yt, width: '100%', height: '100%',
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, start: pendingSeek || 0 },
      events: {
        onReady: () => {
          playerReady = true;
          if (pendingSeek) player.seekTo(pendingSeek, true);
          player.playVideo();
          pendingSeek = null;
        },
        // 영상 소유자가 외부 재생을 막아 둔 경우 등
        onError: () => { resetPlayer(); $('r-video-note').hidden = false; },
      },
    });
  }).catch(() => {
    if (yt !== currentYt || !slot.isConnected) return;
    plainFrame = document.createElement('iframe');
    plainFrame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    plainFrame.allowFullscreen = true;
    plainFrame.title = '말씀 영상';
    plainFrame.src = embedUrl(yt, pendingSeek || 0);
    slot.replaceWith(plainFrame);
    pendingSeek = null;
  });
}

function loadDay(key) {
  const store = (window.DP_DAYS = window.DP_DAYS || {});
  if (store[key]) return Promise.resolve(store[key]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `data/${key}.js`;
    s.onload = () => (store[key] ? resolve(store[key]) : reject(new Error('empty')));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function renderList() {
  if (!year) { $('grid').innerHTML = '<li>아직 정리된 말씀이 없습니다.</li>'; return; }
  const data = INDEX.years[year];
  const done = Object.keys(data.days).length;
  $('hero-year').textContent = year;
  const [, m, d] = data.start.split('-').map(Number);
  $('hero-when').textContent = `${m}.${d} – ${d + 20}`;
  $('year-tabs').innerHTML = yearList.map((y) =>
    `<button class="year" role="tab" id="tab-${y}" aria-selected="${y === year}" data-year="${y}">${y}</button>`
  ).join('') + `<span class="count">21일 중 <b>${done}일</b> 정리됨</span>`;
  let html = '';
  for (let n = 1; n <= 21; n++) {
    const it = data.days[n];
    if (it) {
      html += `<li><a class="card" href="${hashOf(year, n)}">
        <div class="thumb"><img src="thumbs/${esc(it.youtube)}.jpg" alt="" loading="lazy"><span class="day"><i>DAY</i> ${pad(n)}</span></div>
        <div class="meta"><h3>${esc(it.speaker)}</h3><p>${n}일차 · ${dateOf(year, n)}</p></div></a></li>`;
    } else {
      html += `<li><div class="card soon">
        <div class="thumb"><span class="big">${pad(n)}</span></div>
        <div class="meta"><h3>정리 준비 중</h3><p>${n}일차 · ${dateOf(year, n)}</p></div></div></li>`;
    }
  }
  $('grid').innerHTML = html;
}

// 다글로 요약(마크다운)을 화면용 HTML로 바꿉니다. [00:03] 같은 시각은 유튜브 해당 지점 링크가 됩니다.
function mdToHtml(md, youtube) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:,\s*(?:\d{1,2}:)?\d{1,2}:\d{2})*)\]/g, (_, list) =>
      list.split(/,\s*/).map((t) => tsLink(youtube, t.split(':').reduce((a, v) => a * 60 + Number(v), 0), t)).join(''));
  let html = '', inList = false;
  const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { close(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li${/^["“]/.test(li[1]) ? ' class="q"' : ''}>${inline(li[1])}</li>`;
      continue;
    }
    close(); html += `<p>${inline(line)}</p>`;
  }
  close();
  return html;
}

function showTab(name) {
  for (const t of ['summary', 'script']) {
    $('tab-' + t).setAttribute('aria-selected', String(t === name));
    $('pane-' + t).hidden = t !== name;
  }
}

function renderRead(y, n) {
  const it = INDEX.years[y].days[n];
  const yt = `https://youtu.be/${it.youtube}`;
  $('back-label').textContent = `${y} 전체 회차`;
  $('r-eyebrow').textContent = `${y} 다니엘기도회 · DAY ${pad(n)}`;
  $('r-title').textContent = it.speaker;
  $('r-date').textContent = `${n}일차 말씀 · ${dateOf(y, n)}`;
  $('r-thumb').src = `thumbs/${it.youtube}.jpg`;
  $('r-thumb').alt = `${n}일차 영상 썸네일`;
  resetPlayer();
  currentYt = it.youtube;
  $('r-yt').href = yt;
  $('r-daglo2').href = it.daglo;
  $('r-chips').innerHTML = '';
  $('r-summary').innerHTML = '<p>불러오는 중입니다.</p>';
  $('r-script').innerHTML = '';
  showTab('summary');

  const nums = Object.keys(INDEX.years[y].days).map(Number).sort((a, b) => a - b);
  const i = nums.indexOf(n);
  const link = (k, cls, label) => k === undefined
    ? `<span class="${cls}"><small>${label}</small><b>없음</b></span>`
    : `<a class="${cls}" href="${hashOf(y, k)}"><small>${label} · ${k}일차</small><b>${esc(INDEX.years[y].days[k].speaker)}</b></a>`;
  $('r-pager').innerHTML = link(nums[i - 1], 'prev', '← 이전') + link(nums[i + 1], 'next', '다음 →');

  const want = hashOf(y, n);
  loadDay(keyOf(y, n)).then((day) => {
    if (location.hash !== want) return;
    $('r-chips').innerHTML = day.keywords.map((k) => `<li>${esc(k)}</li>`).join('');
    $('keywords').hidden = !day.keywords.length;
    $('r-summary').innerHTML = day.summary
      ? mdToHtml(day.summary, it.youtube)
      : '<p>요약이 아직 없습니다. 스크립트 탭에서 전체 내용을 볼 수 있습니다.</p>';
    $('r-script').innerHTML = day.script.map((s) =>
      `<div class="seg"><div class="who">${tsLink(it.youtube, s.time, clock(s.time))}<span>${esc(s.speaker)}</span></div><p>${esc(s.text)}</p></div>`).join('');
  }).catch(() => {
    $('r-summary').innerHTML = '<p>내용을 불러오지 못했습니다. 잠시 뒤 새로 고쳐 주세요.</p>';
  });
}

function route() {
  const m = /^#y(\d{4})-d(\d{2})$/.exec(location.hash);
  const y = m && Number(m[1]), n = m && Number(m[2]);
  const ok = !!(m && INDEX.years[y] && INDEX.years[y].days[n]);
  if (ok) { year = y; renderRead(y, n); } else { resetPlayer(); currentYt = null; }
  renderList();
  $('view-read').hidden = !ok;
  $('view-list').hidden = ok;
  window.scrollTo(0, 0);
}

function goHome(e) {
  e.preventDefault();
  location.hash = '';
  route();
}
$('home-link').addEventListener('click', goHome);
$('back-link').addEventListener('click', goHome);
$('year-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-year]');
  if (b) { year = Number(b.dataset.year); renderList(); }
});
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});
$('r-poster').addEventListener('click', () => playAt(0));
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.ts');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // 새 탭으로 여는 동작은 그대로 둡니다
  e.preventDefault();
  playAt(Number(a.dataset.t));
});
window.addEventListener('hashchange', route);
route();
