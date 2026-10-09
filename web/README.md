# StaySound Web

Local-first web MVP for StaySound. It runs as a separate Vite app inside this repo and deliberately avoids importing Expo, TrackPlayer, Android modules, or native file-system services.

## Player visuals

- `web/src/audio/spectrumEngine.ts` taps the shared `<audio>` element with a Web Audio `AnalyserNode` and publishes smoothed bass / mid / treble energies — the web counterpart of the Android `KaraokePcmSpectrumBridge`.
- `web/src/components/AtmosphereCanvas.tsx` renders an OriginKit-inspired Dot Matrix from the album palette. Bass gently breathes the cell radius, mids steer a high-inertia flow field, and treble adds restrained luminance; it also writes `--atmo-bass/mid/treble` CSS vars per frame so the surrounding player chrome stays synchronized.
- `web/src/library/dynamicColors.ts` extracts a hue-bucketed palette from the artwork and builds a multi-stop background gradient (`--fp-gradient`) plus accent colors used across the full player and the mini player bar.

## Commands

- `npm run web:dev` starts the web app at `http://localhost:5173/`.
- `npm run web:build` builds the Vite app.
- `npm run web:preview` serves the production build.
- `npm run expo:web` keeps the original Expo web entrypoint available.

## Local Music

Desktop Chromium browsers can import a folder with the File System Access picker. Mobile browsers and Safari fall back to selecting multiple audio files. Track metadata is saved in localStorage so the library can be reconstructed after reload, but object URLs cannot be reused across sessions; tracks marked as needing relink must be imported again before playback.

## Downloads

`web/src/downloads/downloadProvider.ts` implements the browser download contract:

- Monochrome/HiFi search uses the live uptime catalog from `https://tidal-uptime.geeked.wtf`, caches it for 15 minutes, separates API/streaming/Qobuz instances, and retries across mirrors with the same random multi-attempt strategy used upstream.
- Monochrome streaming/downloads resolve audio the same way upstream does: Qobuz first, then Amazon Music (`https://amz.geeked.wtf`), then Deezer by ISRC, and finally Tidal DASH/HLS manifests as a last fallback. Amazon can use a Turnstile site key or bypass token saved from the Downloads tab; without one, protected Amazon responses are skipped cleanly.
- Desktop Chromium browsers can choose and remember a destination folder with the File System Access API. Other browsers fall back to an in-session `File` object.
- Downloaded Monochrome tracks are imported back into the web library so they can be played immediately.
- Soulseek runs through the local StaySound companion bridge because browsers cannot connect to the Soulseek P2P network directly. The StaySound desktop app starts and stops this companion automatically. When developing the plain browser version, start it with:

```bash
npm run web:soulseek
```

The bridge listens at `http://localhost:4317` by default and is detected automatically. Put the Soulseek username and password in the Downloads tab, just like Android. The UI sends those credentials to the local bridge for search/download, fetches the finished file back into the library, and saves it into the selected destination folder when the browser exposes the File System Access API.
