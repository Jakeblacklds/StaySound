"""Bounded Qwen word alignment and conservative SOFA English phonemes.

Input is the validated MFA baseline. Failed words keep their baseline intact.
The JSON report records decisions, not invented alignment confidence scores.
"""
import copy
import gc
import json
import math
import pathlib
import re
import sys
import time
import unicodedata

from phoneme_timing import fill_gaps, widen_short_words

SOFA_REV = "9549c6a86d16019c817eefe4bb8183405da524cc"


def token(text):
    return re.sub(r"[^\w']", "", unicodedata.normalize("NFKC", text).lower().replace("’", "'"))


def matched_intervals(words, items, offset, lower, upper, partial=False):
    """Merge tokenizer fragments, requiring exact coverage of the supplied text."""
    spans, cursor = [], 0
    for word in words:
        expected, actual, first, last = token(word["text"]), "", None, None
        invalid = False
        if not expected:
            raise ValueError("empty token")
        while cursor < len(items) and actual != expected:
            item = items[cursor]
            cursor += 1
            part = token(item.text)
            if not part:
                continue
            actual += part
            if not expected.startswith(actual):
                raise ValueError("text mismatch")
            start, end = float(item.start_time), float(item.end_time)
            if not math.isfinite(start + end) or end <= start or start < 0:
                invalid = True
            first = start if first is None else first
            if last is not None and start < last - 0.02:
                invalid = True
            last = end
        if actual != expected:
            raise ValueError("missing token")
        if invalid:
            if not partial:
                raise ValueError("invalid model interval")
            spans.append(None)
            continue
        begin, end = round((offset + first) * 1000), round((offset + last) * 1000)
        if (begin < lower or end > upper or end - begin < 40 or end - begin > 8000
                or (not partial and spans and begin < spans[-1][1])
                or abs(begin - word["startMs"]) > 1500
                or abs(end - word["endMs"]) > 2000):
            if not partial:
                raise ValueError("interval outside phrase or excessive drift")
            spans.append(None)
            continue
        spans.append((begin, end))
    if any(token(item.text) for item in items[cursor:]):
        raise ValueError("extra token")
    return spans


AGREEMENT_MS = 150
MAX_VOTE_SHIFT_MS = 1500


def vote_word(draft_start, measured, phrase, context):
    """Pick one word interval from independent acoustic witnesses.

    Each aligner alone fails differently: MFA jumps to a repeated word, Qwen
    drifts when its window is wrong. Two witnesses agreeing on the onset are
    trusted; otherwise the acoustic witness nearest the draft clock (Whisper or
    the provider cue) wins, since a lone outlier is usually far from it.
    Measured against Apple word timings this halves the Spanish error tail.
    """
    witnesses = (("phrase", phrase), ("context", context), ("mfa", measured))
    for (name, first), (_, second) in ((witnesses[0], witnesses[2]), (witnesses[0], witnesses[1]),
                                       (witnesses[1], witnesses[2])):
        if first and second and abs(first[0] - second[0]) <= AGREEMENT_MS:
            return first, name
    present = [(name, span) for name, span in witnesses if span]
    if not present:
        return None, "baseline"
    name, span = min(present, key=lambda item: abs(item[1][0] - draft_start))
    return (span, name) if abs(span[0] - draft_start) <= MAX_VOTE_SHIFT_MS else (None, "baseline")


def resolve_line(words, voted, lower, upper):
    """Make a line monotonic, letting voted words anchor unvoted ones.

    Keep the longest in-order run of voted intervals, then fit every other
    word into the gap between its anchors: unchanged when its old intervals
    already fit, squeezed with their rhythm intact when not. A word no aligner
    agreed on must never veto one they did. Returns (intervals, kinds) where
    kind is "voted", "kept" or "spread".
    """
    anchors = [i for i, span in enumerate(voted) if span and lower <= span[0] < span[1] <= upper]
    # Longest chain of anchors whose starts increase (O(n^2) is fine per line).
    best = {}
    for position, i in enumerate(anchors):
        chain = [i]
        for j in anchors[:position]:
            if voted[j][0] < voted[i][0] and len(best[j]) + 1 > len(chain):
                chain = best[j] + [i]
        best[i] = chain
    keep = set(max(best.values(), key=len)) if best else set()
    intervals = [list(voted[i]) if i in keep else None for i in range(len(words))]
    kinds = ["voted" if i in keep else "kept" for i in range(len(words))]
    ordered = sorted(keep)
    for a, b in zip(ordered, ordered[1:]):
        # Trim small overlaps between consecutive anchors at the later onset.
        intervals[a][1] = min(intervals[a][1], intervals[b][0])
    for index, kind in fill_gaps(intervals, words).items():
        kinds[index] = kind
    widen_short_words(intervals)
    return [tuple(span) for span in intervals], kinds


def context_window(lines, index, language, duration_ms, default_language=None):
    """Add neighbouring text AND audio; never pass untranscribed adjacent vocals."""
    first = last = index
    for neighbour in (index - 1, index + 1):
        if not 0 <= neighbour < len(lines):
            continue
        line = lines[neighbour]
        if not line["words"] or (line.get("language") or default_language or language) != language:
            continue
        proposed_first, proposed_last = min(first, neighbour), max(last, neighbour)
        if lines[proposed_last]["endMs"] - lines[proposed_first]["startMs"] + 1000 <= 28000:
            first, last = proposed_first, proposed_last
    lower = max(0, lines[first]["startMs"] - 500,
                lines[first - 1]["endMs"] if first else 0)
    upper = min(duration_ms, lines[last]["endMs"] + 500,
                lines[last + 1]["startMs"] if last + 1 < len(lines) else duration_ms)
    return first, last, lower, upper


def run(vocals, input_path, output_path, assets, defer_refinement="", draft_path=""):
    import numpy as np
    import soundfile as sf
    from mlx_audio.stt import load
    import mlx.core as mx
    from phoneme_timing import make_syllables

    started = time.monotonic()
    assets = pathlib.Path(assets)
    job = pathlib.Path(output_path).parent
    lyrics = json.loads(pathlib.Path(input_path).read_text())
    baseline = copy.deepcopy(lyrics)
    # The pre-MFA draft keeps the Whisper/provider clock that breaks ties.
    draft_lines = None
    if draft_path and pathlib.Path(draft_path).is_file():
        draft = json.loads(pathlib.Path(draft_path).read_text())
        if [len(l["words"]) for l in draft["lines"]] == [len(l["words"]) for l in lyrics["lines"]]:
            draft_lines = [l["words"] for l in draft["lines"]]
    audio, sr = sf.read(vocals, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    duration = len(audio) / sr
    model = load(str(assets / "qwen3-aligner"))
    accepted, candidates, report = [], [], []
    context_cache = {}
    for index, line in enumerate(lyrics["lines"]):
        lang = line.get("language") or lyrics["language"]
        decision = {"line": index, "language": lang, "words": "baseline", "phones": "baseline"}
        report.append(decision)
        try:
            if lang not in ("en", "es") or not line["words"]:
                raise ValueError("unsupported or ambiguous phrase language")
            # Never allow a chunk to reach the neighbouring phrase's words.
            previous = baseline["lines"][index - 1] if index else None
            following = baseline["lines"][index + 1] if index + 1 < len(lyrics["lines"]) else None
            lower = max(0, line["startMs"] - 500, previous["endMs"] if previous else 0)
            upper = min(round(duration * 1000), line["endMs"] + 500,
                        following["startMs"] if following else round(duration * 1000))
            if not 200 <= upper - lower <= 28000:
                raise ValueError("phrase outside 0.2–28 seconds")
            clip = job / f"phrase-{index:04d}.wav"
            sf.write(clip, audio[round(lower * sr / 1000):round(upper * sr / 1000)], sr)
            candidates.append((index, clip, lower / 1000, lang))
            words = line["words"]
            try:
                result = model.generate(audio=str(clip), text=" ".join(w["text"] for w in words),
                                        language="English" if lang == "en" else "Spanish")
                phrase = matched_intervals(words, list(result), lower / 1000, lower, upper, partial=True)
            except Exception as error:
                phrase = [None] * len(words)
                decision["primaryReason"] = str(error)[:300]
            context = [None] * len(words)
            try:
                first, last, context_lower, context_upper = context_window(
                    baseline["lines"], index, lang, round(duration * 1000), baseline["language"])
                if first == last or not 200 <= context_upper - context_lower <= 28000:
                    raise ValueError("no additional bounded context")
                key = (first, last, lang)
                if key not in context_cache:
                    surrounding = [w for l in baseline["lines"][first:last + 1] for w in l["words"]]
                    context_clip = job / f"context-{first:04d}-{last:04d}.wav"
                    sf.write(context_clip, audio[round(context_lower * sr / 1000):round(context_upper * sr / 1000)], sr)
                    # Cache failures too: neighbouring phrases must not repeat a failed job.
                    context_cache[key] = None
                    result = model.generate(audio=str(context_clip), text=" ".join(w["text"] for w in surrounding),
                                            language="English" if lang == "en" else "Spanish")
                    context_cache[key] = matched_intervals(surrounding, list(result), context_lower / 1000,
                                                            context_lower, context_upper, partial=True)
                if context_cache[key] is None:
                    raise ValueError("context alignment failed")
                start = sum(len(l["words"]) for l in baseline["lines"][first:index])
                context = context_cache[key][start:start + len(words)]
            except Exception as error:
                decision["contextReason"] = str(error)[:300]
            # MFA's measured words carry phones; its fallbacks do not.
            measured = [(w["startMs"], w["endMs"]) if any(p.get("phones") for p in w.get("syllables") or []) else None
                        for w in words]
            draft_words = draft_lines[index] if draft_lines else words
            votes = [vote_word(clock["startMs"], mfa, primary, retry)
                     for clock, mfa, primary, retry in zip(draft_words, measured, phrase, context)]
            decision["witnesses"] = [{"draft": clock["startMs"], "mfa": mfa and mfa[0],
                                      "phrase": primary and primary[0], "context": retry and retry[0]}
                                     for clock, mfa, primary, retry in zip(draft_words, measured, phrase, context)]
            spans, kinds = resolve_line(words, [span for span, _ in votes], lower, upper)
            sources = [name if kind == "voted" else "baseline" if kind == "kept" else kind
                       for kind, (_, name) in zip(kinds, votes)]
            for word, (begin, end) in zip(words, spans):
                if (begin, end) != (word["startMs"], word["endMs"]):
                    word.update(startMs=begin, endMs=end, syllables=[])
            count = sum(kind == "voted" for kind in kinds)
            decision.update(words="voted" if count == len(spans) else "mixed" if count else "baseline",
                            acceptedWords=count, totalWords=len(spans), wordSources=sources,
                            contextWords=sources.count("context"))
            if count:
                line.update(startMs=min(w["startMs"] for w in line["words"]),
                            endMs=max(w["endMs"] for w in line["words"]))
                accepted.append((index, clip, lower / 1000, lang))
            else:
                # Unvoted words may still have been widened out of a flash.
                line.update(startMs=min(line["startMs"], words[0]["startMs"]),
                            endMs=max(line["endMs"], words[-1]["endMs"]))
        except Exception as error:
            decision["reason"] = str(error)[:300]
        print(json.dumps({"progress": 0.45 + 0.25 * (index + 1) / len(lyrics["lines"]),
                          "detail": f"Qwen: frase {index + 1}/{len(lyrics['lines'])}"}), flush=True)
    del model
    gc.collect()
    mx.clear_cache()

    # SOFA runs on CPU; releasing Qwen first bounds unified-memory usage.
    english = [entry for entry in candidates if entry[3] == "en"]
    sofa_words = 0
    if english:
        try:
            sys.path.insert(0, str(assets / f"SOFA-{SOFA_REV}"))
            import torch
            from modules.task.forced_alignment import LitForcedAlignmentTask
            from modules.g2p.dictionary_g2p import DictionaryG2P
            torch.set_num_threads(4)
            sofa = LitForcedAlignmentTask.load_from_checkpoint(str(assets / "tgm_en_v100.ckpt"), map_location="cpu")
            sofa.eval()
            sofa.set_inference_mode("force")
            sofa.on_predict_start()
            g2p = DictionaryG2P(dictionary=str(assets / "tgm_sofa_dict.txt"))
            for ordinal, (index, clip, offset, _) in enumerate(english):
                try:
                    line = lyrics["lines"][index]
                    tokens = [token(w["text"]) for w in line["words"]]
                    if any(t not in g2p.dictionary for t in tokens):
                        raise ValueError("SOFA dictionary lacks a word; keep Qwen word timings")
                    batch = (clip, *g2p(" ".join(tokens)))
                    with torch.inference_mode():
                        _, _, confidence, phones, phone_times, names, word_times = sofa.predict_step(batch, ordinal)
                    kept = [(name, times) for name, times in zip(names, word_times) if name not in ("SP", "AP")]
                    if [name for name, _ in kept] != tokens or not math.isfinite(float(confidence)):
                        raise ValueError("SOFA text coverage mismatch")
                    count = 0
                    for word, (_, interval) in zip(line["words"], kept):
                        begin, end = (float(t) + offset for t in interval)
                        if (float(confidence) < 0.5 or abs(begin * 1000 - word["startMs"]) > 180
                                or abs(end * 1000 - word["endMs"]) > 350):
                            continue
                        # Keep Qwen word edges; accept acoustic phones only inside them.
                        left, right = word["startMs"] / 1000, word["endMs"] / 1000
                        evidence = [(max(left, float(a) + offset), min(right, float(b) + offset), str(p).upper())
                                    for p, (a, b) in zip(phones, phone_times)
                                    if p not in ("SP", "AP") and float(a) + offset >= begin - 0.02
                                    and float(b) + offset <= end + 0.02
                                    and min(right, float(b) + offset) > max(left, float(a) + offset)]
                        if evidence:
                            word["syllables"] = make_syllables(word["text"], left, right, evidence, "en")
                            count += 1
                    sofa_words += count
                    report[index]["phones"] = f"sofa:{count}/{len(tokens)}"
                except Exception as error:
                    report[index]["phoneReason"] = str(error)[:300]
                print(json.dumps({"progress": 0.7 + 0.25 * (ordinal + 1) / len(english),
                                  "detail": f"SOFA: frase {ordinal + 1}/{len(english)}"}), flush=True)
        except Exception as error:
            for index, *_ in english:
                report[index]["phoneReason"] = str(error)[:300]
    # Spanish keeps MFA phones only when its word edges agree with Qwen.
    for index, _, _, lang in accepted:
        if lang == "es":
            for word, original in zip(lyrics["lines"][index]["words"], baseline["lines"][index]["words"]):
                if word["startMs"] == original["startMs"] and word["endMs"] == original["endMs"]:
                    word["syllables"] = original.get("syllables", [])
            report[index]["phones"] = "mfa-exact-edges-only"
    lyrics["alignment"] = "qwen3-sofa-experimental-v3" if accepted or sofa_words else baseline.get("alignment")
    lyrics["acousticModel"] = None if accepted or sofa_words else baseline.get("acousticModel")
    word_count = sum(len(l["words"]) for l in lyrics["lines"])
    sources = [source for d in report for source in d.get("wordSources", [])]
    qwen_words = sources.count("phrase") + sources.count("context")
    lyrics["alignmentNotes"] = [f"Palabras: {qwen_words} con Qwen, {sources.count('mfa')} con MFA "
                                f"y {word_count - qwen_words - sources.count('mfa')} con el tiempo base.",
                                f"SOFA: fonemas aceptados en {sofa_words} palabras en inglés."]
    pathlib.Path(output_path).write_text(json.dumps(lyrics, ensure_ascii=False))
    if (accepted or sofa_words) and defer_refinement != "defer-refinement":
        print(json.dumps({"progress": 0.96, "detail": "Midiendo vocales sostenidas…"}), flush=True)
        # Existing pYIN refiner, applied after the final accepted word edges.
        from refine_sustains import main as refine
        refine(vocals, output_path)
    (job / "alignment-report.json").write_text(json.dumps({"seconds": time.monotonic() - started,
                                                          "phrases": report}, indent=2))


if __name__ == "__main__":
    run(*sys.argv[1:7])
