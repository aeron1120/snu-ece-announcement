# AI Summary-Only Mode Design

## Problem

Uploading a notice always spends Gemini calls on work the administrator did not
ask for. The compose form collects the title parts, deadline, audience, body, and
photos by hand, but the save path still asks Gemini to re-derive the subject,
notice type, and deadline, then overwrites the manually entered fields with its
own answers.

The analysis output splits cleanly in two. The three-line summary, the topic
category, the reward badge, and the action flag have no input anywhere in the
compose form, so only the model can supply them. The subject, notice type, and
deadline all have fields the administrator already filled in. The summary is
also the output the administrator values most.

The existing quota control is a single "skip the second pass" checkbox. It halves
the call count but cannot narrow what the model is asked to produce, so a tight
quota still buys a full analysis the administrator will partly discard.

## Goals

- Let the administrator choose how much work Gemini does, in one visible control.
- Add a mode that asks only for the fields the compose form cannot collect: the
  summary, the category, the reward, and the action flag.
- Leave the manually entered subject, notice type, and deadline untouched in that
  mode.
- Show the three-line summary in the compose form and allow direct editing.
- Allow a notice to be uploaded with a hand-written summary and no Gemini call.
- Keep a notice from silently reaching publication without a topic category.

## Non-goals

- Changing the stored notice shape. `aiSummary` remains `string[]`.
- Touching the server, the SQL schema, or the public page.
- Unifying the browser analysis path with the crawler's server-side analyzer.
  That duplication is real but belongs to a separate change.
- Adding a manual category selector. The chosen design has the model decide the
  category in the same single call.

## Analysis Mode Selector

The `2차 검수 생략` checkbox in `.analyze-bar` is replaced by a single select,
`#ai-mode`, with three values:

| Value | Label | Gemini calls | Overwrites typed fields |
| --- | --- | --- | --- |
| `full-verified` | 전체 분석 + 2차 검수 | 2 | yes |
| `full` | 전체 분석 | 1 | yes |
| `summary` | 요약·카테고리·리워드만 | 1 | no |

`summary` and `full` cost the same single call. They differ only in whether the
model is allowed to replace the subject, type, and deadline the administrator
entered.

`full-verified` is the default for a browser that has never chosen a mode.

The choice persists in `localStorage` under `eceAiMode`. On load, a browser still
holding the previous `eceAiSkipVerification` key migrates once: `'1'` becomes
`full`, anything else becomes `full-verified`. The old key is then removed so the
migration does not run again.

## Summary-Only Prompt

`summary` mode sends a shorter prompt that requests exactly the fields the
compose form cannot collect:

```json
{"summary":["요약1","요약2","요약3"],"categorySlugs":["academic|opportunity|benefit|community 중 핵심 하나"],"hasReward":false,"rewardNote":null,"requiresAction":false}
```

The summary style rules, the four category definitions, and the reward and
action rules are reused verbatim from the existing prompt, so every mode judges
them the same way. The prompt omits only the subject, type, and deadline
instructions — the three fields the administrator types by hand.

`normalizeNoticeAnalysisResult` already coerces absent fields to `''` or `[]`, so
the shorter response passes through it unchanged. No normalizer change is
required.

In `summary` mode the analysis result must not be written into
`#title-subject`, `#title-kind`, or the deadline candidate. Only the summary
field and the category ids are populated. This is the point of the mode: the
model must not overwrite what the administrator typed.

The reward fields stay in the prompt. `hasReward`, `rewardNote`, and
`requiresAction` cost no extra request — they are three more keys in the same
single response, and the limit being avoided is requests per minute, not tokens.
Dropping them would also be unrecoverable: the compose form has no reward input,
and a manually composed notice never enters the review inbox, so a badge omitted
here could never be added later.

## Summary Field

A textarea, `#post-ai-summary`, is added to `.analysis-fields`. One line of text
is one summary line. On save the value is split on newlines, trimmed, emptied
lines dropped, and the first three kept — the same shape
`normalizeNoticeAnalysisResult` produces.

This field replaces the `composeAiSummary` variable as the single source of
truth. Analysis writes into the field; saving reads from the field. The variable
is removed.

Two consequences follow from that inversion:

- Typing three lines by hand and pressing upload stores them with no Gemini call.
- Opening an existing notice for editing loads its stored `aiSummary` into the
  field, so a saved summary can be corrected without re-running analysis.

The remaining analysis outputs that have no form field — `categoryIds`,
`surveyReward`, `hasReward`, `requiresAction` — stay as module-level variables.

## Upload Flow

`generateAIAndSave` decides whether to call Gemini in this order:

1. The summary field is non-empty → no call. Use the field and the current
   category/reward variables.
2. The field is empty and the body is new or changed → one analysis in the
   selected mode.
3. The field is empty and the body is unchanged on an edit → reuse the stored
   values.

A failed analysis still saves the notice. That behaviour was added earlier and is
retained: the quota error is reported after the save, not in place of it.

## Missing Category Guard

A notice saved with an empty `categoryIds` appears only under the 전체 tab,
because the public page filters by category id on the server. The administrator
notice list already marks a notice with no summary. It gains a second marker for
a notice with no category, so both gaps are visible in the same place instead of
being discovered on the public site.

## Error Handling

- Analysis failure of any kind, including quota exhaustion: save the notice,
  keep the typed values, and report what was not filled.
- A response that parses but yields no summary: the field stays empty and the
  notice list marker shows the gap.
- A missing `#ai-mode` element: fall back to `full-verified`, the safest mode.

## Testing

- The mode selector offers exactly the three modes and defaults to
  `full-verified`.
- A stored `eceAiSkipVerification` of `'1'` migrates to `full`.
- `summary` mode issues one request and never a verification request.
- `summary` mode does not write the subject, type, or deadline into the form.
- `summary` mode still returns the reward and action fields into the save
  payload.
- The summary textarea round-trips to the `string[]` the save payload expects.
- A non-empty summary field suppresses the Gemini call on upload.
- Editing a notice loads its stored summary into the field.
- The existing suite continues to pass.

## Success Criteria

- Choosing 요약·카테고리·리워드만 uploads a notice with one Gemini call.
- The manually entered subject, type, and deadline survive that upload unchanged.
- A notice with a reward still gets its badge in that mode.
- The three-line summary is visible and editable before upload.
- A hand-written summary uploads with no Gemini call.
- A notice with no category is visibly marked in the administrator list.
- The complete automated test suite passes.
