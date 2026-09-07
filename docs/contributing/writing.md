# Writing Guidelines

Write each artifact so its reader can find the result, evidence, and next action
without meeting the same claim twice. Completeness means preserving decisions and
safety constraints, not filling every possible section.

## Artifact ownership

| Artifact              | Owns                                                            | Leaves elsewhere                                      |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Issue                 | Problem, desired outcome, boundaries, and acceptance criteria   | Implementation sequence and delivered result          |
| Implementation plan   | Decisions and order needed to implement an accepted issue       | Repeated problem statements and later delivery status |
| Pull request          | Delivered result, deviations, verification, and review guidance | Issue background and copied acceptance criteria       |
| Current documentation | Current user tasks, contributor policy, and normative contracts | Delivery history and superseded behavior              |
| Changelog             | Concise user-visible effect grouped by release                  | Implementation detail and verification logs           |

Link to the artifact that owns a fact instead of copying it. Include enough
context for the reader to decide whether to follow the link.

Keep one authoritative explanation per concept within each language. Required
Japanese and English counterparts remain separate and must stay synchronized.

An implementation plan is optional. Write one only when the accepted issue does
not determine significant implementation choices or sequencing. Archive a
completed plan as historical context; do not turn it into current guidance.

## Drafting rules

- Lead with the result or decision the reader needs.
- Give each paragraph one idea. Use lists only for genuinely parallel or
  sequential information.
- Name the actor and action. Prefer concrete verbs, observed behavior, commands,
  and measurements over abstract claims.
- Define one term for each concept and use it consistently.
- Make pronoun references clear. Replace an ambiguous "this" with the relevant
  noun, and state prerequisites or conditions before the action they qualify.
- Distinguish requirements (`must`), recommendations (`should`), capability
  (`can`), and possibility (`might`). Prefer active voice when it clarifies the
  actor; passive voice is useful when the actor is irrelevant.
- Keep safety, compatibility, failure behavior, and verification detail when it
  can change a decision or prevent harm.
- Delete an optional section when it has no new information. Do not paraphrase an
  earlier section to make a template look complete.
- Remove generic openings, narration about the document, repeated conclusions,
  and lists of unchanged behavior unless an exclusion prevents likely scope
  drift.

Do not judge prose by an AI-associated word list or an authorship detector. Do
not rewrite toward a uniform voice. Review whether the text is supported,
specific, necessary, and owned by the right artifact.

## English readability

Write for contributors who use English as an additional language. These are
editing targets, not acceptance criteria:

| Unit                  | Target                                          | Advisory warning                   |
| --------------------- | ----------------------------------------------- | ---------------------------------- |
| Sentence              | One main idea, usually 15–20 words              | More than 25 words                 |
| Paragraph             | One topic, usually 2–4 sentences                | More than 5 sentences or 120 words |
| Issue body            | Enough detail to decide scope                   | More than 800 words                |
| Pull request body     | Enough detail to review the change              | More than 500 words                |
| Implementation plan   | Enough detail to resolve implementation choices | More than 1,500 words              |
| Current documentation | Enough detail for the reader's task             | No total word limit                |

Prefer familiar general vocabulary, roughly CEFR A2–B1 where practical. Use B2
words when they express the meaning more clearly. Review advanced general words
for simpler alternatives; preserve exact technical terms, API names, and
identifiers. Explain unfamiliar terms and abbreviations on first use when the
audience needs it. CEFR describes language proficiency, not a universal word
grading system; vocabulary level is a manual review aid, not an automated gate.

Avoid cultural idioms and obscure phrasal verbs. Familiar technical expressions
such as "log in" and "set up" are fine. Prefer at most two nouns modifying another
noun; unpack longer noun sequences unless they are established technical names.
Do not impose quotas for nouns, verbs, adjectives, or other parts of speech.
Their counts do not establish whether a sentence is clear.

Use descriptive link text and preserve the local context needed to act. A short
explanation can be better than making readers follow a link. Keep qualifications
and safety constraints even when they make a sentence longer.

The sentence threshold follows [GOV.UK's 25-word guidance][govuk-sentences].
[Google's guidance for a global audience][google-global] informs vocabulary and
noun sequences. Its [pronoun guidance][google-pronouns] and [cross-reference guidance][google-links]
support clear references and sufficient context. See [Oxford's CEFR explanation][oxford-cefr]
for the limits of vocabulary labels. Paragraph and artifact thresholds are local,
provisional defaults; reassess false alarms after reviewing 20–30 real artifacts.

[govuk-sentences]: https://insidegovuk.blog.gov.uk/2014/08/04/sentence-length-why-25-words-is-our-limit/
[google-global]: https://developers.google.com/style/translation
[google-pronouns]: https://developers.google.com/style/pronouns
[google-links]: https://developers.google.com/style/cross-references
[oxford-cefr]: https://www.oxfordlearnersdictionaries.com/about/wordlists/cefr

## Workflow

1. Name the artifact, its reader, and the decision or action it supports.
2. Inspect the source of truth: behavior, code, issue, plan, diff, or test result.
3. Assign each intended claim to the artifact that owns it. Replace claims owned
   elsewhere with links and minimal routing context.
4. Draft the result first, followed by only the evidence and detail the reader
   needs.
5. Run the deletion pass below.
6. Check required template fields, factual support, links, commands, and safety
   constraints.

Before publishing an issue or pull request body from a file, run:

```sh
just prose-report issue <body-file>
just prose-report pull-request <body-file>
```

Use `document` or `plan` for those artifact types. Pass `-` to read standard
input. The report applies the advisory thresholds above and reports normalized
exact duplicate paragraphs of at least 20 words.

Markdown structure determines prose boundaries, including code inside quotes and
lists. YAML frontmatter, HTML comments, raw HTML blocks, code blocks, and link
destinations are excluded. Headings and table cells count toward the total, but
are not checked as paragraphs. Inline code counts as one word; its exact content
is retained for duplicate detection. Bare URLs and autolinks also count as one
word; reference definitions do not count. Normal line wrapping does not end a
paragraph.

Word and sentence counts are English-oriented estimates. Sentence endings use
punctuation, with exceptions for common abbreviations and inline code. Unusual
abbreviations and other languages may produce inaccurate counts. Sentence
warnings identify the paragraph's starting source line and the sentence number
within it. Vocabulary, grammar, factual accuracy, and clarity require human review.

Warnings are editing prompts and always exit successfully. They do not require a
suppression or justification and must not become CI gates. Never remove necessary
information or disguise prose as code merely to reduce a metric.

## Deletion pass

For each paragraph or list item, ask:

- Does it change the reader's decision, action, or understanding?
- Is the same claim already present here or owned by another artifact?
- Does it state evidence, or only announce that evidence or detail exists?
- Can a precise verb, command, measurement, or link replace the explanation?
- Would deleting it remove a required constraint, risk, or verification result?

Delete or link the text when the first four questions expose no new value. Keep
it when the last question is true.
