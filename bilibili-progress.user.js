// ==UserScript==
// @name         Bilibili Multi-part Progress
// @namespace    arisu.bilibili.progress
// @version      1.0.0
// @description  Show progress and remaining time for multi-part BV videos.
// @match        https://www.bilibili.com/video/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    // All time calculations use seconds.
    function formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '—';

        seconds = Math.max(0, Math.round(seconds));

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        const rest = seconds % 60;

        return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    }

    const host = document.createElement('div');
    host.id = 'arisu-bilibili-progress';

    const root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `
        <style>
            :host {
                position: fixed;
                right: 18px;
                bottom: 24px;
                z-index: 2147483647;
            }

            .panel {
                width: 280px;
                box-sizing: border-box;
                padding: 15px;
                background: #fff;
                color: #263348;
                border: 1px solid #dee5ef;
                border-radius: 14px;
                box-shadow: 0 6px 26px #15243b26;
                font: 13px/1.6 Arial, sans-serif;
            }

            header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-weight: bold;
            }

            button {
                border: 1px solid #dce3ed;
                border-radius: 6px;
                background: #f5f7fb;
                color: #263348;
                cursor: pointer;
                padding: 2px 8px;
                font: inherit;
            }

            #part {
                margin: 8px 0;
                overflow-wrap: anywhere;
            }

            .row {
                display: flex;
                justify-content: space-between;
                gap: 10px;
            }

            .row b {
                font-variant-numeric: tabular-nums;
            }

            progress {
                width: 100%;
                height: 9px;
                accent-color: #fb7299;
                margin-top: 10px;
            }

            small {
                display: block;
                color: #66758b;
                margin-top: 8px;
                font-size: 11px;
            }

            #status {
                overflow-wrap: anywhere;
            }

            #retry {
                margin-top: 8px;
            }
        </style>

        <section class="panel">
            <header>
                <span>观看进度 · Watch progress</span>
                <button id="toggle" title="Collapse / expand">−</button>
            </header>

            <div id="body">
                <div id="part">Loading…</div>

                <div class="row">
                    <span>已看 · Watched</span>
                    <b id="watched">—</b>
                </div>

                <div class="row">
                    <span>总长 · Total</span>
                    <b id="total">—</b>
                </div>

                <div class="row">
                    <span>剩余 · Remaining</span>
                    <b id="remaining">—</b>
                </div>

                <div class="row">
    <span>
        按当前倍速
        <input
            id="rate-input"
            type="number"
            min="0.5"
            max="5"
            step="0.01"
            value="1.00"
            title="0.50–5.00×，最多两位小数"
            style="width:58px;"
        >
        <button id="rate-apply">设置</button>
    </span>
    <b id="speed">—</b>
</div>

<small id="rate-hint" hidden></small>

                <progress id="bar" max="100" value="0"></progress>

                <div class="row">
                    <span>进度 · Progress</span>
                    <b id="percent">—</b>
                </div>

                <small id="status"></small>
                <small>
                    按顺序观看：默认此前各 P 已完成。
                    仅统计本 BV 的分 P，不包含跨 BV 合集。
                </small>

                <button id="retry">重新读取 · Retry</button>
            </div>
        </section>
    `;

    document.documentElement.appendChild(host);

    const ui = id => root.getElementById(id);

    ui('toggle').onclick = () => {
        const collapsed = ui('body').hidden = !ui('body').hidden;
        ui('toggle').textContent = collapsed ? '+' : '−';
    };

    const cache = new Map();

    let route = '';
    let generation = 0;
    let pages = [];
    let readyAt = 0;
    let status = '';

    function locationInfo() {
        const url = new URL(location.href);
        const bvid = url.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/)?.[1];
        const value = Number(url.searchParams.get('p') || 1);

        return {
            bvid,
            part: Number.isInteger(value) && value > 0 ? value : 1
        };
    }

    function getPages(bvid) {
            // Read the durations already loaded on the video page.
    try {
        const data = unsafeWindow.__INITIAL_STATE__?.videoData;

        if (
            data?.bvid === bvid &&
            Array.isArray(data.pages) &&
            data.pages.length &&
            data.pages.every(p =>
                Number.isFinite(p.duration) && p.duration > 0
            )
        ) {
            return Promise.resolve(data.pages);
        }
    } catch (_) {
        // If page data is unavailable, use the existing request.
    }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
                anonymous: false,
                timeout: 15000,

                onload(response) {
                    try {
                        if (response.status !== 200) {
                            throw new Error(`HTTP ${response.status}`);
                        }

                        const result = JSON.parse(response.responseText);

                        if (result.code !== 0) {
                            throw new Error(
                                `Bilibili: ${result.code} ${result.message || ''}`
                            );
                        }

                        const list = result.data?.pages;

                        if (
                            !Array.isArray(list) ||
                            !list.length ||
                            list.some(p =>
                                !Number.isFinite(p.duration) ||
                                p.duration <= 0
                            )
                        ) {
                            throw new Error('No valid part durations');
                        }

                        resolve(list);
                    } catch (error) {
                        reject(error);
                    }
                },

                onerror: () => reject(
                    new Error('Network request failed')
                ),

                ontimeout: () => reject(
                    new Error('Request timed out')
                )
            });
        });
    }

    async function load(force = false) {
        const { bvid, part } = locationInfo();
        const key = `${bvid || ''}:${part}`;

        if (!force && route === key) return;

        route = key;
        const token = ++generation;

        readyAt = Date.now() + 1500;
        pages = [];
        status = '正在读取分 P 时长 · Loading durations…';

        render();

        if (!bvid) {
            status = '请打开 BV 视频页面 · Open a BV video page';
            render();
            return;
        }

        try {
            const list = !force && cache.has(bvid)
                ? cache.get(bvid)
                : await getPages(bvid);

            // Ignore responses from a previous video.
            if (token !== generation) return;

            cache.set(bvid, list);
            pages = list;
            status = '';
        } catch (error) {
            if (token !== generation) return;

            status = `读取失败，请点 Retry · ${error.message}`;
        }

        render();
    }

    function findVideo() {
        // Find the player again because switching parts may replace it.
        const videos = [...document.querySelectorAll('video')];

        return videos.find(v => v.getClientRects().length && !v.paused) ||
            videos.find(v => v.getClientRects().length) ||
            null;
    }

    function render() {
        function isPlayerFullscreen(video) {
    if (document.fullscreenElement) return true;
    if (!video) return false;

    // Check whether the player fills the browser's webpage area.
    for (
        let element = video;
        element &&
        element !== document.body &&
        element !== document.documentElement;
        element = element.parentElement
    ) {
        if (getComputedStyle(element).position !== 'fixed') {
            continue;
        }

        const rect = element.getBoundingClientRect();

        if (
            Math.abs(rect.left) <= 4 &&
            Math.abs(rect.top) <= 4 &&
            rect.right >= window.innerWidth - 4 &&
            rect.bottom >= window.innerHeight - 4
        ) {
            return true;
        }
    }

    return false;
}
        const { part } = locationInfo();
        const current = pages[part - 1];
        const video = findVideo();
        if (
    video &&
    root.activeElement !== ui('rate-input') &&
    Number.isFinite(video.playbackRate)
) {
    ui('rate-input').value = video.playbackRate.toFixed(2);
}
        host.style.display = isPlayerFullscreen(video) ? 'none' : '';

        ui('status').textContent = status;

        if (!current) {
            ui('part').textContent = pages.length
                ? '分 P 编号无效 · Invalid part number'
                : 'Waiting for durations…';

            for (const id of [
                'watched', 'total', 'remaining', 'speed', 'percent'
            ]) {
                ui(id).textContent = '—';
            }

            ui('bar').value = 0;
            return;
        }

        ui('part').textContent =
            `P${part} / ${pages.length} · ${current.part || ''}`;

        const total = pages.reduce(
            (sum, p) => sum + p.duration, 0
        );

        ui('total').textContent = formatTime(total);

        if (
            !video ||
            video.readyState === 0 ||
            Date.now() < readyAt ||
            !Number.isFinite(video.currentTime)
        ) {
            for (const id of [
                'watched', 'remaining', 'speed', 'percent'
            ]) {
                ui(id).textContent = '—';
            }

            ui('bar').value = 0;
            ui('status').textContent =
                '等待播放器加载 · Waiting for the player…';

            return;
        }

        // Avoid using the previous part's playback position.
        if (
            Number.isFinite(video.duration) &&
            Math.abs(video.duration - current.duration) > 3
        ) {
            for (const id of [
                'watched', 'remaining', 'speed', 'percent'
            ]) {
                ui(id).textContent = '—';
            }

            ui('bar').value = 0;
            ui('status').textContent =
                '播放器时长与分 P 不一致，等待切换完成；若持续出现请刷新页面。';

            return;
        }

        const before = pages.slice(0, part - 1).reduce(
            (sum, p) => sum + p.duration, 0
        );

        const watched = before + Math.min(
            current.duration,
            Math.max(0, video.currentTime)
        );

        const remaining = Math.max(0, total - watched);
        const percent = watched / total * 100;
        const rate = video.playbackRate > 0
            ? video.playbackRate
            : 1;

        ui('watched').textContent = formatTime(watched);
        ui('remaining').textContent = formatTime(remaining);
        ui('speed').textContent =
            `${formatTime(remaining / rate)} (${rate}×)`;
        ui('percent').textContent = `${percent.toFixed(1)}%`;
        ui('bar').value = percent;
    }
function applyRate() {
    const input = ui('rate-input');
    const rate = Number(input.value);
    const hint = ui('rate-hint');

    hint.hidden = false;

    if (
        !input.value.trim() ||
        !Number.isFinite(rate) ||
        rate < 0.5 ||
        rate > 5 ||
        Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-8
    ) {
        hint.textContent = '请输入 0.50–5.00，最多两位小数。';
        return;
    }

    const video = findVideo();

    if (!video) {
        hint.textContent = '请先等待视频播放器加载。';
        return;
    }

    try {
        video.playbackRate = rate;
        input.value = video.playbackRate.toFixed(2);

        if (Math.abs(video.playbackRate - rate) > 0.001) {
            hint.textContent = '播放器未接受该倍速，请查看实际倍速。';
        } else {
            hint.textContent = '';
            hint.hidden = true;
        }

        render();
    } catch (_) {
        hint.textContent = '当前播放器不支持这个倍速。';
    }
}

ui('rate-apply').onclick = applyRate;

ui('rate-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        applyRate();
    }
});
    ui('retry').onclick = () => load(true);

    // Check for part changes and update the panel every half-second.
    setInterval(() => {
        load();
        render();
    }, 500);

    load();
})();