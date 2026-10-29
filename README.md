# Ambient Light for Videos

A Chrome (MV3) extension that adds a soft, colour-matched glow around any playing video, like
YouTube's ambient mode, on every site. The glow hides itself in fullscreen.

## Install (load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `ambient-light` folder.
3. Pin the icon and play a video. Click the icon for settings.

After you edit the code, press the reload arrow on the extension's card and refresh open tabs.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Permissions: `storage`, `activeTab`, plus the content script on all sites |
| `settings.js` | Defaults and validation, shared by the popup and the content script |
| `content.js` | Picks the main playing video and draws the glow layer |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup (master switch, per-site switch, sliders, style) |
| `icons/` | 16, 32, 48 and 128 px icons |
| `test/` | `page.html` test page and `run.mjs`, an end-to-end check in headless Edge |

## How it works

- One fixed `<div>` (with a closed shadow root) is added to `<html>` the first time a video plays.
  It ignores the pointer and is hidden from screen readers.
- About 15 times a second the video frame is drawn into a tiny canvas (48 px wide). CSS stretches
  and blurs it. A `clip-path` hole leaves the picture itself untouched, and a soft mask fades the
  outer edge.
- **Main video:** the largest visible video that is playing and at least 160 × 90 px. Muted videos
  inside a link are skipped, which filters out hover previews such as YouTube's thumbnails.
- **Letterboxing:** the glow fits the actual picture, not the black bars.
- **Fullscreen:** the glow hides when the page goes fullscreen or the video fills at least 97% of
  the window.
- **Idle:** the loop stops after 3 seconds with no playing video and starts again on the next
  `play` event.
- **Settings:** saved in `chrome.storage.sync`, so they apply to open tabs without a reload. While
  you drag a slider, the current tab gets live preview messages. The value is saved when you let go,
  because sync storage allows only about two writes a second.

## Known limits

- **DRM streams** (Netflix, Prime Video, Hotstar): Chrome hands out black frames, so the glow is
  dark. Turn the site off if you like.
- **Glow style on white pages:** there is nothing to lighten, so the glow can't be seen. Use Solid
  instead.
- **Videos inside iframes:** not covered in v1.
- **Closed shadow DOM:** videos inside one are found only through their `play` events.
- **Overlap:** the glow sits above the page, so it can tint a sticky header next to the player.
  It never blocks clicks.

## Test

```bash
node test/run.mjs
```

The script loads the extension into headless Edge (Chrome ignores `--load-extension`), plays the
test page's videos and runs 23 checks.
