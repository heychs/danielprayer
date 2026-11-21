#!/usr/bin/env node
// sermons.txt 에 적힌 다글로 공유 링크를 읽어 사이트 데이터를 만듭니다.
//   node scripts/build.mjs            새로 추가된 회차만 가져옵니다
//   node scripts/build.mjs --refresh  모든 회차를 다시 가져옵니다
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'cache');
const SITE = join(ROOT, 'site');
const REFRESH = process.argv.includes('--refresh');
const UA = 'Mozilla/5.0 (compatible; sermon-notes-build)';

const exists = (p) => access(p).then(() => true, () => false);
const pad = (n) => String(n).padStart(2, '0');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 다글로가 잠깐 거절하는 경우가 있어 몇 번 다시 시도합니다.
async function get(url, headers = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await wait(2000 * i);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
      if (res.ok) return res;
      last = new Error(`${res.status} ${url}`);
      if (res.status === 404) break;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function shareId(url) {
  const m = /daglo\.ai\/share\/([A-Za-z0-9_-]+)/.exec(url || '');
  if (!m) throw new Error(`다글로 공유 링크가 아닙니다: ${url}`);
  return m[1];
}

function youtubeId(url) {
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/live\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(url || '');
  return m ? m[1] : null;
}

// 다글로 공유 페이지 한 개에서 제목·키워드·스크립트·요약을 가져옵니다.
async function fetchBoard(id) {
  const html = await (await get(`https://daglo.ai/share/${id}`)).text();
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`다글로 페이지 형식이 바뀌었습니다 (${id})`);
  const props = JSON.parse(m[1]).props.pageProps;
  if (!props.boardInfo?.name) throw new Error('보드 내용이 비어 있습니다. 공유가 켜져 있는지, 링크가 맞는지 확인해 주세요.');

  const script = [];
  for (const item of props.script?.items ?? []) {
    for (const para of item.editorState?.root?.children ?? []) {
      const head = para.children?.find((c) => c.type === 'speaker-block');
      const text = (para.children ?? []).filter((c) => typeof c.text === 'string').map((c) => c.text).join('').trim();
      if (text) script.push({ speaker: head?.speaker ?? '', time: Math.floor(head?.time ?? 0), text });
    }
  }
  if ((props.script?.meta?.totalPages ?? 1) > 1) {
    console.warn(`  ! 스크립트가 여러 쪽입니다. 첫 쪽만 가져왔습니다 (${id})`);
  }

  // 요약은 페이지에 들어 있지 않고 별도 주소에서 내려옵니다.
  let summary = null;
  try {
    const res = await get(`https://backend.daglo.ai/shared-board/${id}/template-result?language=KO`, {
      origin: 'https://daglo.ai', referer: 'https://daglo.ai/',
    });
    const body = await res.json();
    if (typeof body.content === 'string' && body.content.trim()) summary = body.content;
  } catch (e) {
    console.warn(`  ! 요약을 가져오지 못했습니다 (${id}): ${e.message}`);
  }

  return {
    id,
    title: props.boardInfo?.name ?? '',
    youtube: props.script?.meta?.onlineMediaUrl ?? null,
    keywords: (props.keyword ?? []).map((k) => k.keyword),
    script,
    summary,
    fetchedAt: new Date().toISOString(),
  };
}

// "[2026 다니엘기도회 1일차 말씀] 김은호 목사 | 2026-11-01" → 연도, 일차, 강사, 날짜
function parseTitle(title) {
  const m = /\[\s*(\d{4})\s*다니엘기도회\s*(\d+)\s*일차[^\]]*\]\s*(.*?)\s*(?:\|\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(title);
  return m ? { year: Number(m[1]), day: Number(m[2]), speaker: m[3], date: m[4] ?? null } : {};
}

async function saveThumb(ytId) {
  const file = join(SITE, 'thumbs', `${ytId}.jpg`);
  if (await exists(file)) return;
  for (const size of ['maxresdefault', 'hqdefault']) {
    try {
      const res = await get(`https://i.ytimg.com/vi/${ytId}/${size}.jpg`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch { /* 다음 크기로 */ }
  }
  console.warn(`  ! 썸네일을 받지 못했습니다 (${ytId})`);
}

// sermons.txt 는 형식이 자유롭습니다. 다글로 공유 링크가 들어 있는 줄만 읽고 나머지는 무시합니다.
// 같은 줄에 유튜브 링크가 함께 있으면 다글로에 저장된 주소 대신 그것을 씁니다.
function readEntries(text) {
  const seen = new Set();
  const list = [];
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = /https?:\/\/daglo\.ai\/share\/[A-Za-z0-9_-]+/.exec(line);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    const yt = /https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com)\/\S+/.exec(line);
    list.push({ daglo: m[0], ...(yt ? { youtube: yt[0] } : {}) });
  }
  return list;
}

const entries = readEntries(await readFile(join(ROOT, 'sermons.txt'), 'utf8'));
await mkdir(CACHE, { recursive: true });
await mkdir(join(SITE, 'data'), { recursive: true });
await mkdir(join(SITE, 'thumbs'), { recursive: true });

const index = { years: {} };
let fetched = 0;
const failed = [];

async function addEntry(entry) {
  const id = shareId(entry.daglo);
  const cacheFile = join(CACHE, `${id}.json`);
  let board = (await exists(cacheFile)) ? JSON.parse(await readFile(cacheFile, 'utf8')) : null;
  // 요약이 아직 없던 회차는 다시 확인합니다.
  if (!board || REFRESH || !board.summary) {
    console.log(`가져오는 중: ${entry.daglo}`);
    if (fetched) await wait(700); // 다글로에 연달아 요청하지 않도록 잠깐 쉽니다
    board = await fetchBoard(id);
    await writeFile(cacheFile, JSON.stringify(board, null, 1));
    fetched++;
  }

  const meta = { ...parseTitle(board.title), ...entry };
  const ytId = youtubeId(entry.youtube) ?? youtubeId(board.youtube);
  if (!meta.year || !meta.day) {
    throw new Error(`제목에서 연도와 일차를 읽지 못했습니다: "${board.title}" (${entry.daglo})\n  다글로에서 보드 제목을 "[2026 다니엘기도회 1일차 말씀] 강사 이름 | 2026-11-01" 형식으로 고친 뒤 --refresh 로 다시 실행해 주세요.`);
  }
  if (!ytId) throw new Error(`유튜브 주소를 찾지 못했습니다: ${entry.daglo}\n  sermons.txt 에서 이 링크와 같은 줄에 유튜브 링크를 적어 주세요.`);
  await saveThumb(ytId);

  const key = `${meta.year}-${pad(meta.day)}`;
  const year = (index.years[meta.year] ??= { days: {} });
  if (year.days[meta.day]) throw new Error(`${meta.year}년 ${meta.day}일차가 두 번 들어 있습니다.`);
  year.days[meta.day] = { speaker: meta.speaker || `${meta.day}일차`, date: meta.date, youtube: ytId, daglo: entry.daglo };

  const day = { keywords: board.keywords, summary: board.summary, script: board.script };
  await writeFile(join(SITE, 'data', `${key}.js`),
    `(window.DP_DAYS = window.DP_DAYS || {})[${JSON.stringify(key)}] = ${JSON.stringify(day).replace(/</g, '\\u003c')};\n`);
  console.log(`  ${meta.year}년 ${meta.day}일차 · ${year.days[meta.day].speaker} · 요약 ${board.summary ? '있음' : '없음'} · 스크립트 ${board.script.length}단락`);
}

// 한 회차가 실패해도 나머지는 계속 만들고, 실패한 링크는 끝에 모아서 알려 줍니다.
for (const entry of entries) {
  try {
    await addEntry(entry);
  } catch (e) {
    failed.push({ url: entry.daglo, reason: e.message });
    console.log(`  ! 건너뜀: ${entry.daglo}\n    ${e.message.replace(/\n/g, '\n    ')}`);
  }
}

// 기도회 첫날: 날짜가 적힌 회차에서 거꾸로 계산합니다.
for (const [y, year] of Object.entries(index.years)) {
  const known = Object.entries(year.days).find(([, d]) => d.date);
  if (known) {
    const t = new Date(`${known[1].date}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - (Number(known[0]) - 1));
    year.start = t.toISOString().slice(0, 10);
  } else {
    year.start = `${y}-11-01`;
  }
}

await writeFile(join(SITE, 'data', 'index.js'), `window.DP_INDEX = ${JSON.stringify(index, null, 1)};\n`);
console.log(`완료: 전체 ${entries.length}회차 중 ${entries.length - failed.length}회차 반영, 이번에 새로 가져온 것 ${fetched}회차`);
if (failed.length) {
  console.log(`\n반영하지 못한 링크 ${failed.length}개:`);
  for (const f of failed) {
    console.log(`  ${f.url}\n    ${f.reason.replace(/\n/g, '\n    ')}`);
    // GitHub Actions 실행 화면에 경고로 표시됩니다.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=반영하지 못한 링크::${f.url} — ${f.reason.split('\n')[0]}`);
  }
}
