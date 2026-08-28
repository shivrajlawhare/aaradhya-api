---
name: review-standards
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along one axis — Standards (does the code follow this repo's documented coding standards?). Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".
---

Merged from Voyager's `fe-review` and `api-review` skills per `docs/Aaradhya_Dev_Process_and_Structure.md` §3 — the two were identical apart from name and neither contained GraphQL-specific logic, so one skill now covers this repo.

Review of the diff between `HEAD` and a fixed point the user supplies, or the unstaged working tree, or files tagged in the user's prompt:

It checks whether the code conforms to this repo's documented coding standards.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, use the working tree's unstaged changes or the files tagged in the user's prompt.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base) if the user supplied a fixed point. Also note the commit list via `git log <fixed-point>..HEAD --oneline`. If no fixed point was supplied, use `git diff HEAD --`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside a sub-agent.

### 2. Identify the standards sources

Documentation for coding standards lives in this repo's `docs/` folder — `coding-guidelines.md`, `typescript-rules.md`, `naming-conventions.md`, `git-guidelines.md`, `directory-structure.md`, `handler-patterns.md`, `api-conventions.md` — plus the nearest `CLAUDE.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads _what it is_ → _how to fix_; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 3. Run the checks for conformation

Generate a report — per file/hunk where relevant — covering (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling already enforces (ESLint, Prettier, tsc). Keep the report under 400 words.

### 4. Report

Present the report under a `## Standards` heading, verbatim or lightly cleaned.

End with a one-line summary: total findings, and the worst issue (if any).
