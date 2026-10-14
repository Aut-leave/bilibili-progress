# Bilibili Multi-part Progress

A Tampermonkey userscript that shows your progress through a multi-part Bilibili video, its total duration, and how much time remains.

## Features

- Show the current part number and title.
- Display watched duration, total duration, remaining duration, and progress percentage.
- Estimate remaining time at the current playback speed.
- Set playback speed from **0.50× to 5.00×**, with up to two decimal places.
- Collapse or expand the progress panel.
- Automatically hide the panel in webpage fullscreen and player fullscreen.

## Installation

You need a desktop browser and [Tampermonkey](https://www.tampermonkey.net/). No Python or Node.js setup is required.

1. Install Tampermonkey and enable any userscript permissions it requests.
2. Open [bilibili-progress.user.js](./bilibili-progress.user.js) in this repository and copy the complete code.
3. Open Tampermonkey and select **Create a new script**.
4. Replace the default code with the copied code and save.
5. Open or refresh a Bilibili BV video page.

## Usage

The panel appears in the bottom-right corner of the page. Times use the `hours:minutes:seconds` format.

To change speed, enter a value such as `2.37` beside **按当前倍速**, then click **设置** or press **Enter**. The remaining-time estimate assumes you continue at that speed without pauses.

## How progress is calculated

The script assumes you watch the parts in order:

```text
Watched = duration of all earlier parts + current playback position
Total = duration of all parts
Remaining = Total - Watched
Estimated time remaining = Remaining / playback speed
```

For example, opening P14 counts P1–P13 as complete. This measures your position in the video series, rather than recording which sections you actually watched.

## Scope and troubleshooting

- Supports parts under a single BV number. Collections containing multiple BV videos are not included.
- Playback speed is not saved across reloads; the player may reset it when switching parts.
- If duration loading fails, click **Retry** or refresh the page. Bilibili may reject the fallback API request, including with HTTP 412.
- If the panel does not appear, check that Tampermonkey and the script are enabled.
- Bilibili player changes may require script updates. Webpage fullscreen detection depends on the player's layout.

## Data handling

The script first uses duration data already loaded on the page. If unavailable, it requests video metadata from `api.bilibili.com`; that request may include browser cookies. It does not upload viewing progress or store viewing history.
