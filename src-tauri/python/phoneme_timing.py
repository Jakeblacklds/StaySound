"""Conservative word and syllable timing for MFA's IPA and ARPAbet output.

This source is embedded before the alignment job by Tauri, so the packaged
application does not depend on a Python import path inside the source checkout.
"""

import re
import unicodedata

import pyphen


HYPHENATORS = {"en": pyphen.Pyphen(lang="en_US"), "es": pyphen.Pyphen(lang="es")}
ARPABET_VOWELS = {
    "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY",
    "OW", "OY", "UH", "UW", "AX",
}
IPA_VOWELS = set("aeiouyɑɐɒæəɚɛɜɝɞɘɤɨɪɵøœɶɔʉʊʌɯɶ")
SILENCE = {"sil", "sp", "spn", "<eps>", ""}


def is_vowel(label, word_language):
    if label in SILENCE:
        return False
    # Check ARPAbet only in its uppercase notation: lower-case `ay`, for
    # example, is an IPA diphthong, not an invitation to match any prefix.
    if word_language == "en" and re.sub(r"[012]$", "", label) in ARPABET_VOWELS:
        return True
    normalized = unicodedata.normalize("NFD", label).lstrip("ˈˌ")
    # MFA may emit syllabic consonants such as n̩ and ɫ̩ as a nucleus.
    return bool(normalized) and (normalized[0] in IPA_VOWELS or "\u0329" in normalized)


def make_syllables(text, begin, end, phones, word_language):
    """Only split text when acoustic nuclei support every proposed piece.

    Hyphenation supplies spelling boundaries, never a clock. When it disagrees
    with the pronunciation (e.g. a reduced `powerless`), keep one word unit.
    """
    phones = [p for p in phones if p[2] not in SILENCE and p[1] > p[0]]
    match = re.match(r"^(\W*)(.*?)(\W*)$", text, flags=re.UNICODE)
    prefix, core, suffix = match.groups() if match else ("", text, "")
    pieces = HYPHENATORS[word_language].inserted(core).split("-")
    nuclei = [p for p in phones if is_vowel(p[2], word_language)]
    boundaries = [begin, end]
    if len(pieces) > 1 and all(pieces) and "".join(pieces) == core and len(pieces) == len(nuclei):
        proposed = [begin] + [(left[1] + right[0]) / 2 for left, right in zip(nuclei, nuclei[1:])] + [end]
        # Never create flashes or inverted syllables from a collapsed alignment.
        if all(right - left >= 0.04 for left, right in zip(proposed, proposed[1:])):
            boundaries = proposed
    if len(boundaries) != len(pieces) + 1:
        pieces = [text]
    else:
        pieces[0] = prefix + pieces[0]
        pieces[-1] += suffix
    result = []
    for index, piece in enumerate(pieces):
        start, finish = boundaries[index:index + 2]
        labels = [label for first, last, label in phones
                  if start <= (first + last) / 2 < finish]
        result.append({
            "text": piece,
            "startMs": round(start * 1000),
            "endMs": max(round(start * 1000) + 1, round(finish * 1000)),
            "phones": labels,
        })
    return result


MAX_MFA_SHIFT_MS = 1500
MIN_MFA_WORD_MS = 50
# MFA's floor is three 10 ms frames per phone. A word whose phones average
# close to that floor was squeezed in because the aligner found no room.
MIN_MEAN_PHONE_MS = 35


def fill_gaps(intervals, words):
    """Place every unmeasured word (None) between its measured neighbours.

    Measured intervals are lists and may be trimmed by up to their length
    minus 40 ms when a word was squeezed to nothing between them. A run
    keeps its old times when they fit, is squeezed with its rhythm intact
    when they do not, and is spread by letter count when they were not even
    ordered. At line edges the run keeps its own extent. Returns
    {index: "kept" | "spread"} for every filled word.
    """
    filled = {}
    index = 0
    while index < len(words):
        if intervals[index] is not None:
            index += 1
            continue
        gap_end = index
        while gap_end < len(words) and intervals[gap_end] is None:
            gap_end += 1
        run = range(index, gap_end)
        minimum = 40 * len(run)
        old = [(words[i]["startMs"], words[i]["endMs"]) for i in run]
        # Only measured neighbours bound a run. At a line edge the run keeps
        # its own extent: clips of overlapping lines can start after it.
        right = intervals[gap_end][0] if gap_end < len(words) else None
        left = intervals[index - 1][1] if index else None
        if left is None:
            left = min(old[0][0], (right if right is not None else old[-1][1]) - minimum)
        if right is None:
            right = max(old[-1][1], left + minimum)
        if right - left < minimum:
            # Neighbours touching around a collapsed word: borrow room from
            # them rather than leave a 1 ms flash between them.
            if index:
                left = max(intervals[index - 1][0] + 40, right - minimum)
                intervals[index - 1][1] = min(intervals[index - 1][1], left)
            if right - left < minimum and gap_end < len(words):
                right = min(intervals[gap_end][1] - 40, left + minimum)
                intervals[gap_end][0] = max(intervals[gap_end][0], right)
            right = max(right, left + len(run))
        ordered_old = all(s < e for s, e in old) and all(old[k][1] <= old[k + 1][0] for k in range(len(old) - 1))
        if ordered_old and left <= old[0][0] and old[-1][1] <= right:
            for i, span in zip(run, old):
                intervals[i] = list(span)
                filled[i] = "kept"
        elif ordered_old:
            # Squeeze the run into its gap, keeping its internal rhythm.
            source_left, source_right = old[0][0], old[-1][1]
            target_left = max(left, min(source_left, right - minimum))
            target_right = min(right, max(source_right, target_left + minimum))
            scale = (target_right - target_left) / max(1, source_right - source_left)
            for i, (s0, e0) in zip(run, old):
                begin = round(target_left + (s0 - source_left) * scale)
                intervals[i] = [begin, max(begin + 1, round(target_left + (e0 - source_left) * scale))]
                filled[i] = "spread"
        else:
            weights = [max(1, len(re.sub(r"\W", "", words[i]["text"]))) for i in run]
            cursor, total = left, sum(weights)
            for i, weight in zip(run, weights):
                end = cursor + (right - left) * weight / total
                intervals[i] = [round(cursor), max(round(cursor) + 1, round(end))]
                filled[i] = "spread"
                cursor = end
        index = gap_end
    return filled


def widen_short_words(intervals, minimum=40):
    """Give every word at least `minimum` ms so none renders as a flash.

    Room comes from the silence after the word, then before it, then from
    whichever neighbour can spare it; onsets move by at most `minimum`.
    """
    for index, span in enumerate(intervals):
        need = minimum - (span[1] - span[0])
        if need <= 0:
            continue
        following = intervals[index + 1] if index + 1 < len(intervals) else None
        previous = intervals[index - 1] if index else None
        gap_after = following[0] - span[1] if following else need
        grow = max(0, min(need, gap_after))
        span[1] += grow
        need -= grow
        gap_before = span[0] - previous[1] if previous else need
        grow = max(0, min(need, gap_before))
        span[0] -= grow
        need -= grow
        if need > 0 and following and following[1] - following[0] - need >= minimum:
            following[0] += need
            span[1] += need
        elif need > 0 and previous and previous[1] - previous[0] - need >= minimum:
            previous[1] -= need
            span[0] -= need


def trusted_word_interval(original_start, original_end, mfa_start, mfa_end,
                          lower_bound, upper_bound, phones, language):
    """Accept MFA's acoustic interval unless the aligner visibly failed.

    Whisper's word clock is the weaker witness: measured against Apple's
    human word timings it is typically ~100 ms early and misses phrase onsets
    by up to two seconds, so disagreeing with it is not evidence against MFA.
    Reject only collapsed or nucleus-free words, and multi-second jumps that
    mean MFA attached the text to the wrong vocal. Bounds are the audio clip
    MFA saw, never the stale Whisper times of the neighbouring words.
    Returned times are milliseconds; phones are seconds.
    """
    phones = [p for p in phones if p[2] not in SILENCE and p[1] > p[0]]
    mfa_duration = mfa_end - mfa_start
    mean_phone_ms = (1000 * sum(p[1] - p[0] for p in phones) / len(phones)) if phones else 0
    if (mfa_duration < MIN_MFA_WORD_MS
            or (len(phones) > 1 and mean_phone_ms < MIN_MEAN_PHONE_MS)
            or abs(mfa_start - original_start) > MAX_MFA_SHIFT_MS
            or abs(mfa_end - original_end) > MAX_MFA_SHIFT_MS + 500
            or not any(is_vowel(p[2], language) for p in phones)):
        return None
    start = max(lower_bound, mfa_start)
    end = min(upper_bound, mfa_end)
    if end - start < MIN_MFA_WORD_MS or abs(start - mfa_start) > 40 or abs(end - mfa_end) > 40:
        return None
    return start, end
