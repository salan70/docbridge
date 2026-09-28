/**
 * Pick the candidate a reader most likely meant to type, or `undefined` when
 * nothing is close enough to suggest.
 *
 * An ordered abbreviation wins outright, so `ctx` suggests `context` even
 * though its edit distance is worse than a shorter neighbour's. Otherwise the
 * nearest candidate by edit distance wins, but only within half the
 * candidate's length, which keeps an unrelated input from producing a
 * confident and wrong suggestion. Ties break by candidate order.
 *
 * @doc docs/specs/cli.md#error-guidance
 * @doc docs/specs/link-manifest.md#symbol-suggestions
 */
export function nearestMatch<Candidate extends string>(
  input: string,
  candidates: readonly Candidate[],
): Candidate | undefined {
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      distance: editDistance(input, candidate),
      index,
    }))
    .toSorted((left, right) => left.distance - right.distance || left.index - right.index);

  const abbreviation = ranked.find(({ candidate }) => isOrderedAbbreviation(input, candidate));
  if (abbreviation !== undefined) {
    return abbreviation.candidate;
  }

  const best = ranked[0];
  if (best === undefined) {
    return undefined;
  }

  const closeEnough = best.distance <= Math.max(1, Math.floor(best.candidate.length / 2));
  return closeEnough ? best.candidate : undefined;
}

/** Whether `input` spells `candidate`'s characters in order, with gaps. */
function isOrderedAbbreviation(input: string, candidate: string): boolean {
  if (input.length < 3 || input.length >= candidate.length) {
    return false;
  }

  let candidateIndex = 0;
  for (const character of input) {
    const matchIndex = candidate.indexOf(character, candidateIndex);
    if (matchIndex === -1) {
      return false;
    }
    candidateIndex = matchIndex + 1;
  }
  return true;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}
