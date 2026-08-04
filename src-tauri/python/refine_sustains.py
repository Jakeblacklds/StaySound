"""Refine sung-vowel offsets using the separated vocal signal.

The forced aligner remains authoritative for phoneme/word onsets.  This pass is
deliberately asymmetric: it may extend the final syllable of a word when pitch
and vocal energy prove that the singer is still sustaining it, but it never
moves a trusted onset and never guesses through an acoustic gap.
"""

import bisect
import json
import math
import sys

import librosa
import numpy as np
from scipy.signal import medfilt


TARGET_SR = 8_000
HOP_LENGTH = 80  # 10 ms
FRAME_LENGTH = 512  # 64 ms: stable enough for low sung fundamentals
MAX_EXTENSION_MS = 3_500
MAX_UNVOICED_GAP_FRAMES = 14  # bridge vibrato/aspiration, not a real breath
MIN_EXTENSION_MS = 120
MIN_SUSTAIN_MS = 850
MIN_NOTE_MS = 80


def ms_to_frame(milliseconds, frame_count):
    return max(0, min(frame_count - 1, round(milliseconds * TARGET_SR / 1000 / HOP_LENGTH)))


def frame_to_ms(frame):
    return round(frame * HOP_LENGTH * 1000 / TARGET_SR)


def clamp(value, low, high):
    return max(low, min(high, value))


def connected_voiced_end(active, seed, limit):
    """Walk forward while activity is continuous, tolerating tiny pitch gaps."""
    last_active = seed
    gap = 0
    for frame in range(seed + 1, limit + 1):
        if active[frame]:
            last_active = frame
            gap = 0
        else:
            gap += 1
            if gap > MAX_UNVOICED_GAP_FRAMES:
                break
    return last_active


def merge_short_note_runs(runs):
    if len(runs) < 2:
        return runs
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for index, run in enumerate(runs):
            if frame_to_ms(run[1] - run[0] + 1) >= MIN_NOTE_MS:
                continue
            if index == 0:
                target = 1
            elif index == len(runs) - 1:
                target = index - 1
            else:
                left_distance = abs(run[2] - runs[index - 1][2])
                right_distance = abs(run[2] - runs[index + 1][2])
                target = index - 1 if left_distance <= right_distance else index + 1
            if target < index:
                runs[target][1] = run[1]
            else:
                runs[target][0] = run[0]
            runs.pop(index)
            changed = True
            break
    return runs


def note_events(start_frame, end_frame, active, midi, voiced_probability, syllable_start, syllable_end):
    pitched = np.isfinite(midi) & active
    indices = np.flatnonzero(pitched[start_frame : end_frame + 1]) + start_frame
    if not len(indices):
        return []

    finite_indices = np.flatnonzero(np.isfinite(midi))
    if not len(finite_indices):
        return []
    interpolated = np.interp(np.arange(len(midi)), finite_indices, midi[finite_indices])
    smoothed = medfilt(interpolated, kernel_size=7)
    runs = []
    run_start = int(indices[0])
    previous = int(indices[0])
    pitches = [float(smoothed[previous])]
    for raw_index in indices[1:]:
        frame = int(raw_index)
        pitch = float(smoothed[frame])
        current_pitch = float(np.median(pitches[-9:]))
        has_gap = frame - previous > MAX_UNVOICED_GAP_FRAMES
        has_stable_change = abs(pitch - current_pitch) >= 0.8
        if has_gap or has_stable_change:
            runs.append([run_start, previous, float(np.median(pitches))])
            run_start = frame
            pitches = []
        pitches.append(pitch)
        previous = frame
    runs.append([run_start, previous, float(np.median(pitches))])
    runs = merge_short_note_runs(runs)

    notes = []
    for first, last, pitch in runs:
        begin = max(syllable_start, frame_to_ms(first))
        end = min(syllable_end, frame_to_ms(last + 1))
        if end - begin < MIN_NOTE_MS:
            continue
        probability = float(np.median(voiced_probability[first : last + 1]))
        notes.append(
            {
                "startMs": begin,
                "endMs": end,
                "pitchMidi": round(pitch, 2),
                "confidence": round(clamp(probability, 0.0, 1.0), 3),
            }
        )
    return notes


def next_onset_after(sorted_onsets, baseline_end):
    position = bisect.bisect_right(sorted_onsets, baseline_end + 40)
    return sorted_onsets[position] if position < len(sorted_onsets) else None


def main(vocals_path, lyrics_path):
    with open(lyrics_path, encoding="utf-8") as handle:
        lyrics = json.load(handle)
    bilingual = "bilingual" in str(lyrics.get("alignment", ""))
    phoneme_alignment = "mfa-bilingual-phoneme-v1" if bilingual else "mfa-phoneme-v1"
    acoustic_alignment = (
        "mfa-bilingual-phoneme+acoustic-v2" if bilingual else "mfa-phoneme+acoustic-v2"
    )

    audio, _ = librosa.load(vocals_path, sr=TARGET_SR, mono=True)
    if not len(audio):
        raise RuntimeError("the separated vocal track is empty")
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-6:
        lyrics["alignment"] = phoneme_alignment
        with open(lyrics_path, "w", encoding="utf-8") as handle:
            json.dump(lyrics, handle, ensure_ascii=False)
        return

    rms = librosa.feature.rms(
        y=audio,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
        center=True,
    )[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    f0, voiced, voiced_probability = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=TARGET_SR,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
        fill_na=np.nan,
    )
    frame_count = min(len(rms_db), len(f0), len(voiced_probability))
    rms_db = rms_db[:frame_count]
    f0 = f0[:frame_count]
    voiced = np.asarray(voiced[:frame_count], dtype=bool)
    voiced_probability = np.nan_to_num(voiced_probability[:frame_count], nan=0.0)
    midi = np.full(frame_count, np.nan)
    finite_pitch = np.isfinite(f0) & (f0 > 0)
    midi[finite_pitch] = librosa.hz_to_midi(f0[finite_pitch])

    words = [
        word
        for line in lyrics.get("lines", [])
        for word in line.get("words", [])
        if word.get("endMs", 0) > word.get("startMs", 0)
    ]
    all_onsets = sorted(int(word["startMs"]) for word in words)
    audio_end_ms = frame_to_ms(frame_count - 1)

    for line in lyrics.get("lines", []):
        line_words = line.get("words") or []
        for word_index, word in enumerate(line_words):
            syllables = word.get("syllables") or []
            if not syllables:
                continue
            syllable = syllables[-1]
            syllable_start = int(syllable.get("startMs", word.get("startMs", 0)))
            baseline_end = int(word.get("endMs", syllable.get("endMs", syllable_start + 1)))
            if baseline_end <= syllable_start:
                continue

            if word_index + 1 < len(line_words):
                hard_limit = int(line_words[word_index + 1].get("startMs", baseline_end)) - 30
            else:
                following_onset = next_onset_after(all_onsets, baseline_end)
                search_limit = min(audio_end_ms, baseline_end + MAX_EXTENSION_MS)
                hard_limit = min(search_limit, following_onset - 30) if following_onset else search_limit
            hard_limit = max(baseline_end, hard_limit)

            start_frame = ms_to_frame(syllable_start, frame_count)
            baseline_frame = ms_to_frame(baseline_end, frame_count)
            limit_frame = ms_to_frame(hard_limit, frame_count)
            anchor_first = max(start_frame, baseline_frame - 80)  # inspect up to 800 ms back
            anchor_slice = slice(anchor_first, min(frame_count, baseline_frame + 11))
            anchor_voiced = voiced_probability[anchor_slice] >= 0.30
            anchor_energy = rms_db[anchor_slice]
            if np.any(anchor_voiced):
                reference_db = float(np.median(anchor_energy[anchor_voiced]))
            else:
                reference_db = float(np.percentile(anchor_energy, 70)) if len(anchor_energy) else -80.0
            energy_threshold = max(-52.0, reference_db - 20.0)
            active = (
                (voiced_probability >= 0.30)
                & (rms_db >= energy_threshold)
                & (finite_pitch | voiced)
            )

            seed_candidates = np.flatnonzero(active[anchor_first : baseline_frame + 1]) + anchor_first
            if len(seed_candidates) < 3:
                syllable["sustained"] = False
                syllable["timingConfidence"] = 0.0
                syllable["notes"] = []
                continue
            seed = int(seed_candidates[-1])
            acoustic_end_frame = connected_voiced_end(active, seed, limit_frame)
            acoustic_end = min(hard_limit, frame_to_ms(acoustic_end_frame + 1) + 35)
            region_start = max(start_frame, seed_candidates[0])
            region = slice(region_start, acoustic_end_frame + 1)
            active_region = active[region]
            active_ratio = float(np.mean(active_region)) if len(active_region) else 0.0
            active_probabilities = voiced_probability[region][active_region]
            median_probability = float(np.median(active_probabilities)) if len(active_probabilities) else 0.0
            duration_score = min(1.0, max(0.0, (acoustic_end - syllable_start) / 1_500))
            confidence = clamp(
                0.50 * median_probability + 0.32 * active_ratio + 0.18 * duration_score,
                0.0,
                1.0,
            )
            extension = acoustic_end - baseline_end
            refined_end = baseline_end
            if extension >= MIN_EXTENSION_MS and confidence >= 0.52:
                refined_end = acoustic_end
                word["endMs"] = refined_end
                syllable["endMs"] = refined_end
                line["endMs"] = max(int(line.get("endMs", refined_end)), refined_end)

            total_duration = refined_end - syllable_start
            syllable["sustained"] = total_duration >= MIN_SUSTAIN_MS and confidence >= 0.45
            syllable["timingConfidence"] = round(confidence, 3)
            has_useful_note_evidence = syllable["sustained"] or refined_end > baseline_end
            syllable["notes"] = (
                note_events(
                    start_frame,
                    ms_to_frame(refined_end, frame_count),
                    active,
                    midi,
                    voiced_probability,
                    syllable_start,
                    refined_end,
                )
                if has_useful_note_evidence
                else []
            )

    lyrics["alignment"] = acoustic_alignment
    lyrics["acousticModel"] = "librosa-pyin-v1"
    with open(lyrics_path, "w", encoding="utf-8") as handle:
        json.dump(lyrics, handle, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
