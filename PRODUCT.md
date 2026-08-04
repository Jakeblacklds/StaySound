# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Two audiences, both real, and the interface has to serve both at once:

- **The developer (Jake)** — expert user, knows every feature, uses the Android app daily. Wants accelerators: keyboard shortcuts, queue control, direct downloads.
- **Family (his wife and relatives)** — genuine first-time users of this kind of app. They need obvious next actions, labeled controls, plain-language errors, and no assumed knowledge.

Still non-commercial and not for sale, but "only I use it" is no longer true — design decisions that trade clarity for density hurt the second group.

## Product Purpose

A personal music player that combines official streaming (Tidal) with P2P downloads (Soulseek) and several fallback catalogs so the developer can always find and play a track, regardless of where it's officially available. It also provides synced, karaoke-style lyrics, a local-first offline library, an equalizer, and Android Auto support.

## Positioning

Not applicable. StaySound is explicitly non-commercial and not built to differentiate against competitors — the user confirmed its features and interaction patterns are deliberately borrowed from existing apps (Spotify, Apple Music, etc.) rather than an original mechanism. Design work should not invent a competitive angle or market claim.

## Operating Context

- Mobile: native iOS/Android app (Expo/React Native) for daily listening.
- Desktop: Tauri app that reuses the `web/` UI, with a bundled Soulseek sidecar and native folder import for a local music library played directly from disk.
- Supabase backend for auth and synced-lyrics ("song_alignments") data, with a local-first cache.
- Android Auto integration for in-car playback via a synced catalog.

## Capabilities and Constraints

- Streaming playback via Tidal.
- P2P search/download via Soulseek (native module + bridge script).
- Fallback metadata/streaming lookups across Deezer, Amazon Music, Saavn, Qobuz, and Spotify charts when the primary source is missing a track.
- Local library scanning, FLAC parsing, metadata and artwork extraction.
- Synced/karaoke lyrics with local cache-first lookup and Supabase fallback.
- Playlists, equalizer (including native Android equalizer), Android Auto catalog sync.
- Desktop build wraps the same `web/` UI in Tauri; it must feel like a desktop app, not a browser tab.
- Mobile web is a fallback for people who do not have the APK installed; the primary phone experience is the native Android app.
- Lyrics are effectively always present for the music being played — an empty lyrics state is an edge case, not a normal condition to design around.
- Personal use only: no monetization, no multi-user accounts, no plans for public distribution.

## Brand Commitments

Name: StaySound. No external brand guidelines — icon and existing visual assets in the repo are the only fixed identity elements.

## Evidence on Hand

- Existing codebase, app icon/assets, and `app.config.js` (name, bundle IDs, icon).
- `README.md` documents the lyrics cache + Supabase integration and desktop packaging flow.
- No testimonials, case studies, or marketing collateral exist or should be fabricated — this is not a commercial product.

## Product Principles

1. Never lose access to a track — chain streaming, P2P, and fallback sources until something plays.
2. Local-first: cached library and lyrics work offline; network calls only fill gaps.
3. One codebase, native feel per platform — mobile should feel like a native iOS/Android app, desktop should feel like a desktop app, not a wrapped website.
4. Expert and beginner on the same screen — accelerators stay available but never required, and every accelerator has a visible equivalent. Optimize for these specific people, not for growth or multi-tenant concerns.
5. Karaoke-style synced lyrics are a first-class experience, not a bolted-on overlay.
