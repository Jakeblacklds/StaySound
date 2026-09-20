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


def trusted_word_interval(original_start, original_end, mfa_start, mfa_end,
                          lower_bound, upper_bound, confidence, phones, language):
    """Accept small, supported MFA corrections; reject gross disagreements.

    Recognition confidence alone is not timing confidence. Require agreement
    at both edges, plausible duration, a vocal nucleus, and room between the
    neighbouring words. Returned times are milliseconds; phones are seconds.
    """
    original_duration = original_end - original_start
    mfa_duration = mfa_end - mfa_start
    if (confidence <= 0.15 or original_duration < 40 or mfa_duration < 40
            or abs(mfa_start - original_start) > 180
            or abs(mfa_end - original_end) > 350
            or not 0.5 <= mfa_duration / original_duration <= 2.0
            or not any(is_vowel(p[2], language) for p in phones)):
        return None
    start = max(lower_bound, mfa_start)
    end = min(upper_bound, mfa_end)
    if end - start < 40 or abs(start - mfa_start) > 40 or abs(end - mfa_end) > 40:
        return None
    return start, end
