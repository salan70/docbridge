---
name: review-response
description: Respond to pull request review comments, whether from bots like Devin or from human reviewers. Use when a PR has review feedback to triage — decide per comment whether a change is needed, act or justify, then reply to and resolve every thread.
---

# review-response

Bring every review comment on a pull request to a consistent close-out: each
thread ends with a reply and is resolved, whether or not it led to a code change.

## Principles

- Evaluate each comment on its merits. A reviewer, including a bot, can be wrong;
  do not change code only because a comment exists.
- Verify before trusting a suggested fix. Reproduce the issue and test the
  proposed change — review suggestions can be subtly incorrect.
- Close out every thread: reply in English, then resolve it.
- When no change is made, the reply states the reason (intentional design,
  incorrect suggestion, out of scope, accepted trade-off, ...).
- When a comment is a genuine judgment call (a security or maintenance
  trade-off, scope, behavior change), ask the user instead of deciding alone.
- Code changes follow the normal flow: test-first for logic changes, commit on
  the PR branch, and CI must pass (see the `git-workflow` skill).

## Procedure

1. Fetch all feedback for the PR:
   - Reviews: `gh api repos/{owner}/{repo}/pulls/{n}/reviews`
   - Inline comments: `gh api repos/{owner}/{repo}/pulls/{n}/comments`
2. Triage each comment: action needed, or not (with a concrete reason). Surface
   judgment calls to the user before acting.
3. For comments that need action, implement and verify the fix (do not trust the
   suggestion blindly), commit on the PR branch, and push.
4. Reply to every comment in English, stating what changed (reference the commit)
   or why no change was made:
   `gh api repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies -f body=...`
5. Resolve every thread with GraphQL:
   - List threads: `repository.pullRequest.reviewThreads` (id, isResolved, and
     the comment that anchors each thread).
   - Resolve: `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "..."}) { thread { isResolved } } }'`
6. Confirm CI is green after the changes.

## Notes

- Reply and resolve use different APIs: replies are REST, resolving is GraphQL.
- A comment's REST `id` is not its thread node id. Map a comment to its thread
  through the GraphQL `reviewThreads.comments` set, or match on path and line.
