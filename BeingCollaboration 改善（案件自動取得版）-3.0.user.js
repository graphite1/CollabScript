// ==UserScript==
// @name         BeingCollaboration 操作改善
// @namespace    local.be-collabo-helper
// @version      3.3
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
    'トップへ',
    'TOP'
  ]);
  const DEBUG_SCRAPE = localStorage.getItem(DEBUG_FLAG_KEY) === '1';

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
    return {
      name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `案件 ${item?.gid || ''}`.trim(),
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
      const gid = getParamValue(url.searchParams, PARAM_NAME_MAP.gid);
      const gkid = getParamValue(url.searchParams, PARAM_NAME_MAP.gkid);

      if (!gid) {
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
    return parseGenbaFromHref(location.href, document.title.trim());
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

    select.addEventListener('change', () => {
      const option = select.selectedOptions[0];
      if (!option || !option.dataset.gid) {
        return;
      }

      const gid = option.dataset.gid;
      const gkid = option.dataset.gkid || '';

      if (!gkid) {
        alert('gkid がない案件のため遷移できません。');
        select.value = '';
        return;
      }

      genbaList = updateLastUsedAt(gid, gkid);
      location.href = `${TOPPAGE_PATH}?gkid=${encodeURIComponent(gkid)}&gid=${encodeURIComponent(gid)}`;
    });
    bar.appendChild(select);

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
  }

  init();
})();
