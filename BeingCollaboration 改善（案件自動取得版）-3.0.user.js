// ==UserScript==
// @name         BeingCollaboration 操作改善
// @namespace    local.be-collabo-helper
// @version      3.5
// @description  BeingCollaboration の操作性を改善する補助スクリプト
// @match        https://www.be-collabo.jp/*
// @match        https://be-collabo.jp/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'bc_genba_list';
  const DEBUG_FLAG_KEY = 'bc_debug_scrape';
  const TOPPAGE_PATH = '/akjssys/genbatoppage/g_toppage.php';
  const PARAM_NAME_MAP = {
    gid: ['gid', 'gID', 'genbaID', 'genba_id'],
    gkid: ['gkid', 'gkID', 'genbaKID', 'genba_kid']
  };
  const INVALID_GENBA_NAMES = new Set([
    'このページのトップへ',
    'ページトップへ',
    'トップページ',
    'トップへ',
    'TOP',
    'BeingCollaboration'
  ]);
  const DEBUG_SCRAPE = localStorage.getItem(DEBUG_FLAG_KEY) === '1';
  const PREFETCH_CONCURRENCY = 3;
  const AUTO_PREFETCH_DELAY_MS = 1200;

  function debugLog(...args) {
    if (!DEBUG_SCRAPE) {
      return;
    }
    console.log('[BC_DEBUG]', ...args);
  }

  function loadGenbaList() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list)
        ? list.map(normalizeGenba).filter(item => item.gid)
        : [];
    } catch {
      return [];
    }
  }

  function normalizeGenba(item) {
    const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
    return {
      name: isValidGenbaName(rawName) ? rawName : `案件 ${item?.gid || ''}`.trim(),
      gid: String(item?.gid || item?.id || '').trim(),
      gkid: String(item?.gkid || '').trim(),
      lastUsedAt: Number(item?.lastUsedAt || 0)
    };
  }

  function saveGenbaList(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(normalizeGenba)));
  }

  function getGenbaKey(item) {
    return `${item.gkid}:${item.gid}`;
  }

  function sortGenbaList(list) {
    return [...list].sort((a, b) => {
      if (a.lastUsedAt !== b.lastUsedAt) {
        return b.lastUsedAt - a.lastUsedAt;
      }
      return a.name.localeCompare(b.name, 'ja');
    });
  }

  function getParamValue(searchParams, keys) {
    for (const key of keys) {
      const value = searchParams.get(key);
      if (value) {
        return value.trim();
      }
    }
    return '';
  }

  function isValidGenbaName(name) {
    if (typeof name !== 'string') {
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return false;
    }
    return !INVALID_GENBA_NAMES.has(trimmed);
  }

  function parseGenbaFromHref(href, fallbackName) {
    try {
      const url = new URL(href, location.href);
      const path = (url.pathname || '').toLowerCase();
      const hash = (url.hash || '').toLowerCase();
      const rawHref = String(href || '').trim().toLowerCase();

      if (!rawHref || rawHref.startsWith('javascript:')) {
        return null;
      }
      if (rawHref.startsWith('#') || hash === '#pagetop' || rawHref.includes('#pagetop')) {
        return null;
      }
      if (path.includes('/logout') || path.includes('/login')) {
        return null;
      }
      if (!path.includes('/genbatoppage/g_toppage.php')) {
        return null;
      }

      const gid = getParamValue(url.searchParams, PARAM_NAME_MAP.gid);
      const gkid = getParamValue(url.searchParams, PARAM_NAME_MAP.gkid);

      if (!gid || !gkid) {
        return null;
      }

      return normalizeGenba({
        name: isValidGenbaName(fallbackName) ? fallbackName : '',
        gid,
        gkid
      });
    } catch {
      return null;
    }
  }

  function mergeGenbaList(current, incomingList) {
    const map = new Map();

    current.forEach(item => {
      map.set(getGenbaKey(item), normalizeGenba(item));
    });

    incomingList.forEach(item => {
      const normalized = normalizeGenba(item);
      const key = getGenbaKey(normalized);
      const existing = map.get(key);

      if (!existing) {
        map.set(key, normalized);
        return;
      }

      map.set(key, {
        ...existing,
        name: isValidGenbaName(normalized.name) ? normalized.name : existing.name,
        gid: normalized.gid || existing.gid,
        gkid: normalized.gkid || existing.gkid,
        lastUsedAt: Math.max(existing.lastUsedAt || 0, normalized.lastUsedAt || 0)
      });
    });

    return sortGenbaList([...map.values()]);
  }

  function collectGenbaFromPage() {
    const current = loadGenbaList();
    const found = [];
    const debugCandidates = [];

    document.querySelectorAll('a[href]').forEach(anchor => {
      const href = anchor.getAttribute('href') || '';
      const name = (anchor.textContent || '').trim();
      const item = parseGenbaFromHref(href, name);
      const isCandidate = Boolean(item);
      const isNameValid = isValidGenbaName(name);

      if (DEBUG_SCRAPE && (isCandidate || !isNameValid)) {
        debugCandidates.push({
          text: name,
          href,
          gid: item?.gid || '',
          gkid: item?.gkid || '',
          isCandidate,
          isNameValid
        });
      }

      if (!item) {
        return;
      }

      found.push(item);
    });

    const list = mergeGenbaList(current, found);
    saveGenbaList(list);
    debugLog('collectGenbaFromPage', {
      page: location.href,
      foundCount: found.length,
      storedCount: list.length,
      debugCandidates
    });
    return list;
  }

  function getCurrentGenbaFromLocation() {
    // location 由来の名前は汎用タイトルを拾いやすいため、名前での上書きをしない
    return parseGenbaFromHref(location.href, '');
  }

  function updateLastUsedAt(gid, gkid) {
    if (!gid) {
      return loadGenbaList();
    }

    const targetKey = `${String(gkid || '').trim()}:${String(gid).trim()}`;
    const current = loadGenbaList();
    const next = current.map(item => {
      if (getGenbaKey(item) !== targetKey) {
        return item;
      }
      return {
        ...item,
        lastUsedAt: Date.now()
      };
    });
    const sorted = sortGenbaList(next);
    saveGenbaList(sorted);
    return sorted;
  }

  function updateCurrentGenbaUsage() {
    const currentGenba = getCurrentGenbaFromLocation();
    if (!currentGenba || !currentGenba.gkid) {
      return loadGenbaList();
    }

    const list = mergeGenbaList(loadGenbaList(), [currentGenba]);
    saveGenbaList(list);
    return updateLastUsedAt(currentGenba.gid, currentGenba.gkid);
  }

  function createButton(label, onClick, styleText) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = styleText || `
      padding: 6px 12px;
      border: 0;
      border-radius: 6px;
      background: #fff;
      color: #222;
      cursor: pointer;
      font-weight: bold;
    `;
    button.addEventListener('click', onClick);
    return button;
  }

  function buildGenbaTopUrl(gid, gkid) {
    return `${TOPPAGE_PATH}?gkid=${encodeURIComponent(gkid)}&gid=${encodeURIComponent(gid)}`;
  }

  async function prefetchGenbaPages(list, onProgress, shouldStop) {
    const queue = sortGenbaList(list)
      .filter(item => item.gid && item.gkid)
      .map(item => ({
        key: getGenbaKey(item),
        name: item.name,
        url: buildGenbaTopUrl(item.gid, item.gkid)
      }));

    let done = 0;
    let ok = 0;
    let ng = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        if (shouldStop()) {
          return;
        }
        const idx = cursor++;
        const target = queue[idx];
        try {
          await fetch(target.url, {
            method: 'GET',
            credentials: 'include',
            cache: 'force-cache'
          });
          ok += 1;
        } catch {
          ng += 1;
        } finally {
          done += 1;
          onProgress({ done, total: queue.length, ok, ng, current: target.name });
        }
      }
    }

    const workers = [];
    const workerCount = Math.min(PREFETCH_CONCURRENCY, Math.max(queue.length, 1));
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return { total: queue.length, done, ok, ng };
  }

  function refreshSelectOptions(select, list) {
    const previousValue = select.value;
    select.innerHTML = '';

    const first = document.createElement('option');
    first.value = '';
    first.textContent = list.length ? '案件選択' : '案件未取得';
    select.appendChild(first);

    sortGenbaList(list).forEach(item => {
      const option = document.createElement('option');
      option.value = getGenbaKey(item);
      option.textContent = item.name;
      option.dataset.gid = item.gid;
      option.dataset.gkid = item.gkid;
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 300);
      return;
    }

    if (document.getElementById('bc-fixed-toolbar')) {
      return;
    }

    document.body.style.fontSize = '13px';

    document.querySelectorAll('.func-tbl td, .func-tbl th').forEach(el => {
      el.style.padding = '4px';
    });

    const cnt = document.querySelector('[name="infoPageCnt"]');
    if (cnt && cnt.value !== '100') {
      cnt.value = '100';
      cnt.dispatchEvent(new Event('change'));
    }

    updateCurrentGenbaUsage();
    let genbaList = collectGenbaFromPage();
    debugLog('init', {
      page: location.href,
      title: document.title,
      genbaListCount: genbaList.length,
      debugEnabled: DEBUG_SCRAPE
    });

    const bar = document.createElement('div');
    bar.id = 'bc-fixed-toolbar';
    bar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      background: #222;
      color: #fff;
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
      font-size: 14px;
      flex-wrap: wrap;
    `;

    bar.appendChild(createButton('トップ', () => {
      location.href = '/akjssys/main.php?log=on';
    }));
    bar.appendChild(createButton('処理一覧', () => {
      location.href = '/akjssys/workflow/wftop.php?actioncode=2001';
    }));
    bar.appendChild(createButton('新規起案', () => {
      location.href = '/akjssys/circular/circularTop.php?actioncode=3001';
    }));
    bar.appendChild(createButton('帳票状況', () => {
      location.href = '/akjssys/circular/circularTop.php?actioncode=3200&kannimenu=2';
    }));
    bar.appendChild(createButton('検索', () => {
      location.href = '/akjssys/circular/circularTop.php?resetFlg=1&actioncode=3400';
    }));

    const select = document.createElement('select');
    select.style.cssText = `
      padding: 6px;
      border-radius: 6px;
      font-weight: bold;
      max-width: 260px;
    `;
    refreshSelectOptions(select, genbaList);
    let stopPrefetch = false;

    const prefetchStatus = document.createElement('span');
    prefetchStatus.style.cssText = 'font-size:12px;color:#ddd;min-width:180px;';
    prefetchStatus.textContent = '先読み: 未実行';

    function setPrefetchStatus(text) {
      prefetchStatus.textContent = `先読み: ${text}`;
    }

    function moveToSelectedGenba() {
      const option = select.selectedOptions[0];
      if (!option || !option.dataset.gid) {
        alert('案件を選択してください。');
        return false;
      }

      const gid = option.dataset.gid;
      const gkid = option.dataset.gkid || '';

      if (!gkid) {
        alert('gkid がない案件のため遷移できません。');
        select.value = '';
        return false;
      }

      genbaList = updateLastUsedAt(gid, gkid);
      location.href = buildGenbaTopUrl(gid, gkid);
      return true;
    }

    select.addEventListener('change', () => {
      // 選択時点では遷移しない（誤操作によるリロード抑制）
    });
    bar.appendChild(select);

    bar.appendChild(createButton('移動', () => {
      moveToSelectedGenba();
    }));

    async function runPrefetch() {
      stopPrefetch = false;
      setPrefetchStatus('開始中...');
      const result = await prefetchGenbaPages(
        genbaList,
        progress => {
          setPrefetchStatus(`${progress.done}/${progress.total} (${progress.ok}成功/${progress.ng}失敗)`);
        },
        () => stopPrefetch
      );
      if (stopPrefetch) {
        setPrefetchStatus(`停止 (${result.done}/${result.total})`);
        return false;
      }
      setPrefetchStatus(`完了 (${result.ok}成功/${result.ng}失敗)`);
      return true;
    }

    bar.appendChild(createButton('先読み開始', async () => {
      await runPrefetch();
    }, `
      padding: 6px 10px;
      border: 0;
      border-radius: 6px;
      background: #2f7d32;
      color: #fff;
      cursor: pointer;
      font-weight: bold;
    `));

    bar.appendChild(createButton('先読み停止', () => {
      stopPrefetch = true;
      setPrefetchStatus('停止要求');
    }, `
      padding: 6px 10px;
      border: 0;
      border-radius: 6px;
      background: #8a1f1f;
      color: #fff;
      cursor: pointer;
      font-weight: bold;
    `));

    bar.appendChild(prefetchStatus);

    const clearButton = createButton('案件リセット', () => {
      localStorage.removeItem(STORAGE_KEY);
      alert('保存した案件リストをリセットしました。ページ再読込後に再取得されます。');
      location.reload();
    }, `
      padding: 6px 10px;
      border: 0;
      border-radius: 6px;
      background: #666;
      color: #fff;
      cursor: pointer;
      font-weight: bold;
    `);
    bar.appendChild(clearButton);

    bar.appendChild(createButton('印刷', () => {
      window.print();
    }));

    document.body.prepend(bar);
    document.body.style.paddingTop = '56px';

    const badge = document.createElement('div');
    badge.textContent = `改善ON / 案件${genbaList.length}件`;
    badge.style.cssText = `
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 99999;
      background: #0a84ff;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
    `;
    document.body.appendChild(badge);

    // 毎回ボタンを押さずに済むよう、表示直後に自動先読みする
    setTimeout(() => {
      runPrefetch();
    }, AUTO_PREFETCH_DELAY_MS);
  }

  init();
})();
