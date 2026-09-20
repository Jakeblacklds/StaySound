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


def select_intervals(words, spans, lower, upper):
    """Keep valid proposals only if they fit alongside unchanged fallback words.

    Reject conflicting proposals, never stretch a zero-duration word or move a
    fallback to make room. Recheck after each rejection because its old interval
    may conflict with another proposal.
    """
    selected = [span if span and lower <= span[0] < span[1] <= upper else None
                for span in spans]
    while True:
        resolved = [span or (word["startMs"], word["endMs"])
                    for word, span in zip(words, selected)]
        rejected = set()
        for index in range(1, len(resolved)):
            if resolved[index - 1][1] > resolved[index][0]:
                for neighbour in (index - 1, index):
                    if selected[neighbour] is not None:
                        rejected.add(neighbour)
        if not rejected:
            return selected
        for index in rejected:
            selected[index] = None


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


def run(vocals, input_path, output_path, assets, defer_refinement=""):
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
            try:
                result = model.generate(audio=str(clip), text=" ".join(w["text"] for w in line["words"]),
                                        language="English" if lang == "en" else "Spanish")
                spans = matched_intervals(line["words"], list(result), lower / 1000, lower, upper, partial=True)
                spans = select_intervals(line["words"], spans, lower, upper)
            except Exception as error:
                spans = [None] * len(line["words"])
                decision["primaryReason"] = str(error)[:300]
            sources = ["phrase" if span else "baseline" for span in spans]
            if any(span is None for span in spans):
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
                    context_spans = context_cache[key]
                    if context_spans is None:
                        raise ValueError("context alignment failed")
                    start = sum(len(l["words"]) for l in baseline["lines"][first:index])
                    retry = context_spans[start:start + len(spans)]
                    for word_index, span in enumerate(retry):
                        if spans[word_index] is None and span is not None:
                            # A retry cannot displace an already accepted word.
                            if any(other is not None and (
                                (other_index < word_index and other[1] > span[0]) or
                                (other_index > word_index and span[1] > other[0]))
                                for other_index, other in enumerate(spans)):
                                continue
                            spans[word_index] = span
                            sources[word_index] = "context"
                    spans = select_intervals(line["words"], spans, lower, upper)
                except Exception as error:
                    decision["contextReason"] = str(error)[:300]
            for word_index, (word, span) in enumerate(zip(line["words"], spans)):
                if span is not None:
                    begin, end = span
                    if (begin, end) != (word["startMs"], word["endMs"]):
                        word.update(startMs=begin, endMs=end, syllables=[])
                else:
                    sources[word_index] = "baseline"
            count = sum(span is not None for span in spans)
            decision.update(words="qwen3" if count == len(spans) else "mixed" if count else "baseline",
                            acceptedWords=count, totalWords=len(spans), wordSources=sources,
                            contextWords=sources.count("context"))
            if count:
                line.update(startMs=min(w["startMs"] for w in line["words"]),
                            endMs=max(w["endMs"] for w in line["words"]))
                accepted.append((index, clip, lower / 1000, lang))
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
    lyrics["alignment"] = "qwen3-sofa-experimental-v2" if accepted or sofa_words else baseline.get("alignment")
    lyrics["acousticModel"] = None if accepted or sofa_words else baseline.get("acousticModel")
    word_count = sum(len(l["words"]) for l in lyrics["lines"])
    accepted_words = sum(d.get("acceptedWords", 0) for d in report)
    context_words = sum(d.get("contextWords", 0) for d in report)
    lyrics["alignmentNotes"] = [f"Qwen: {accepted_words}/{word_count} palabras; {context_words} recuperadas con contexto; respaldo: {word_count - accepted_words}.",
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
    run(*sys.argv[1:6])
