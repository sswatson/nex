---
title: The Algebra of Rebase and Squash
description: Snapshots as functions, diffs as formal differences, and rebase/squash as algebra on trees.
---

This lesson builds a precise mathematical model of what happens to a set of files when you rebase or squash. We'll use jj's semantics, which are unusually algebraic, but the model applies to Git and most other snapshot-based systems too.

By the end you should be able to write rebase as a one-line formula, explain exactly when conflicts arise (and why jj treats them as values rather than errors), say why squash can never conflict while rebase can, and read a conflicted file in a jj working copy as the algebraic expression it is.

## States

The basic object is a **snapshot** (a *tree*, in VCS jargon): a partial function from paths to file contents,

$$T : \mathrm{Path} \rightharpoonup \mathrm{Content}.$$

"Partial" just means not every conceivable path is in the tree; a path outside the domain is a file that doesn't exist. Adding, deleting, and editing files are all just changes to this one function.

Both jj and Git store commits as snapshots: a commit is a tree plus parent pointers plus metadata. Crucially, a commit does **not** store a patch.

The patch you see from `jj diff -r X` is *derived*, on demand, by comparing the commit's tree against its parent's tree. Write it as a formal difference:

$$\Delta = C - P$$

where $C$ is the commit's tree and $P$ is its parent's tree.

```question
type: multiple-choice
prompt: >
  A commit sits at the tip of your branch. In this model, which of the
  following is physically stored in the commit, and which is derived?
choices:
  - text: 'The snapshot $C$ is stored; the patch $\Delta = C - P$ is derived by comparison.'
    correct: true
    explanation: >
      Right. Commits are states, not transitions. The diff is a view computed
      from two states — which is why the "same" commit shows a different diff
      after its parent changes.
  - text: 'The patch $\Delta$ is stored; the snapshot is derived by replaying patches from the root.'
    explanation: >
      That's the Darcs/patch-theory design. Git and jj do the opposite:
      snapshots are primary, patches are derived views.
  - text: Both are stored, so the system can check them against each other.
    explanation: >
      Storing both would be redundant — either one determines the other given
      the parent. Snapshot-based systems store only the tree.
```

## Deltas as transformations

Although a delta is *derived* from two states, it can be *applied* to other states. Write application additively:

$$\mathrm{apply}(\Delta, S) = S + \Delta = S + (C - P).$$

Two familiar operations fall out immediately. The **empty commit** is the identity, $\Delta = 0$. And **backout** (revert) is the inverse: it creates a new commit whose delta is $-\Delta = P - C$, so applying a change and then its backout is $S + \Delta - \Delta = S$.

## Rebase

Now the main event. To rebase a commit with tree $C$ and parent $P$ onto a new destination with tree $D$, the new tree is:

$$C' = D + (C - P)$$

Read it as: *start from the new base, and add the same change I made before.* This single expression is the whole file-level content of rebase.

Concretely it's evaluated path by path, with the classic three-way merge rule. At each path $p$:

- If $C(p) = P(p)$ — you didn't touch it — take $D(p)$.
- If $D(p) = P(p)$ — the destination didn't touch it — take $C(p)$.
- If $C(p) = D(p)$ — both sides made the identical change — take it.
- Otherwise: **conflict** (more on this shortly).

A tiny worked example. Let $P = \{a{:}\,1,\ b{:}\,2\}$, $C = \{a{:}\,1,\ b{:}\,3\}$ (you changed $b$), and $D = \{a{:}\,9,\ b{:}\,2\}$ (the destination changed $a$). Then $C' = D + C - P = \{a{:}\,9,\ b{:}\,3\}$: both changes, no drama.

```question
type: free-response
prompt: |
  Compute the rebase result $C' = D + (C - P)$ for:

  - $P = \{f{:}\,\mathtt{x},\ g{:}\,\mathtt{1},\ h{:}\,\mathtt{old}\}$
  - $C = \{f{:}\,\mathtt{y},\ g{:}\,\mathtt{2},\ h{:}\,\mathtt{old}\}$
  - $D = \{f{:}\,\mathtt{y},\ g{:}\,\mathtt{1}\}$  (note: $h$ was deleted)

  Give the contents of $C'$ at each of $f$, $g$, $h$.
criteria: >
  The answer must give f: y (both sides changed x to y identically, so no
  conflict — take y), g: 2 (only the source changed it), and h: absent/deleted
  (only the destination changed it, by deleting it; the source left it alone,
  so the deletion wins). Accept any notation. If they flag h or f as a
  conflict, that's incorrect: f is the same-change-on-both-sides case, and h
  is an untouched-by-source case where deletion is just another value change.
sample_answer: >
  f = y (both sides made the same edit), g = 2 (source's change carries over),
  and h is gone — the destination deleted it and the source didn't touch it,
  so the deletion stands. C' = {f: y, g: 2}.
```

Here's a pleasant surprise hiding in the formula: the **merge** of two heads $A$ and $B$ with common ancestor $P$ is computed as $A + B - P$ — the *same expression*, and symmetric in $A$ and $B$. At the level of trees, rebase and merge are one operation; they differ only in which commits you keep afterward.

```question
type: multiple-choice
prompt: 'Using the formula, what does rebasing a commit onto its own parent do? That is, what is $C''$ when $D = P$?'
choices:
  - text: '$C'' = C$ — it''s the identity; nothing changes.'
    correct: true
    explanation: >
      Substitute: C' = P + (C - P) = C. The terms cancel. This is why jj can
      freely "rebase" descendants that don't actually need to move — the
      operation is a no-op by cancellation.
  - text: 'It applies the change twice: $C'' = C + \Delta$.'
    explanation: >
      The formula adds the delta to the destination, not to the commit itself.
      With D = P, you get P + (C - P) = C, applied exactly once.
  - text: It's undefined — rebasing onto the current parent is an error.
    explanation: >
      jj happily accepts it and the algebra says why it's safe: the expression
      simplifies to C. It's the identity, not an error.
```

## Conflicts are values, not errors

When none of the three-way rules applies at a path — both sides changed it, differently — the expression $D(p) + C(p) - P(p)$ simply **doesn't simplify**. Git reacts by refusing to proceed: it stops mid-operation and makes you resolve before anything is committed.

jj does something more interesting: it stores the unsimplified formal sum $\{+C(p),\ -P(p),\ +D(p)\}$ *as the file's value*. A conflicted tree is a first-class state, and the rebase always completes. The conflict markers you see in the file are just a rendering of those terms — we'll learn to read that rendering, character by character, shortly.

Because conflicts are algebraic expressions, they obey algebra. jj simplifies term lists automatically — $A - B + B$ cancels to $A$. One consequence: rebase is lossless. Rebase $C$ from $P$ onto $D$, getting $C' = D + C - P$; now rebase that back onto $P$: $P + (C' - D) = P + (D + C - P) - D = C$. The round trip is exact, even if the intermediate state was conflicted.

```question
type: multiple-choice
prompt: You rebase a commit onto a new destination. In which scenario does the result contain a conflict?
choices:
  - text: The commit edits a line in `config.py`; the destination edited the same line to something different.
    correct: true
    explanation: >
      Both deltas changed the same content differently — no three-way rule
      applies, so the sum stays unsimplified. That's precisely a conflict.
  - text: The commit edits `config.py`; the destination edits `main.py`.
    explanation: >
      Disjoint paths. At each path only one side differs from the base, so
      the rules resolve everything.
  - text: Both the commit and the destination made the identical edit to the same line.
    explanation: >
      The C(p) = D(p) rule handles this: both sides agree, take the shared
      value. (The change appears "already done" after rebase.)
  - text: The destination deleted a file the commit never touched.
    explanation: >
      The commit's side equals the base there, so the destination's deletion
      wins cleanly. Deletion is just another value.
```

## Inside a file: the same algebra, one level down

So far the model treats file contents as atoms — values compared only for equality, with any disagreement conflicting the entire file. Real tools do better: they merge *within* the file and mark only the regions that actually disagree. This is hunk-level merging, and it's the same expression evaluated one level down.

To compute $D(p) + C(p) - P(p)$ for a text file, split all three versions into lines and diff each side against the base. Lines that *neither* side touched are **stable regions**: anchors that align the three versions with one another.

Between the anchors lie **unstable regions**, and each one is resolved independently by exactly the rules you already know. Only one side changed the region: take that side. Both made the identical change: take it. Both changed it differently: that region becomes a **conflict hunk**.

The consequence is that conflicts happen per region, not per file. Nine edited regions can merge cleanly while a tenth gets markers — and the value at that path is still a formal sum, just with hunks as the terms instead of whole file contents.

This is also the exact point where the model turns heuristic. "Stable" is a textual, line-by-line judgment, and the partition depends on the diff algorithm: two independent edits on *adjacent* lines share one unstable region and conflict spuriously, while text that happens to align can merge cleanly into something semantically wrong. The tree level is exact; the line level is a good bet.

```question
type: multiple-choice
prompt: Two sides of a merge both edit the same 50-line file. Which pair of edits merges cleanly, with no conflict hunk?
choices:
  - text: Side 1 edits line 10; side 2 edits line 40.
    correct: true
    explanation: >
      Thirty untouched lines separate the edits, so each edit sits in its own
      unstable region with stable anchors between them. Each region was
      changed by only one side and resolves cleanly.
  - text: Both sides append a different new function at the end of the file.
    explanation: >
      Both additions land in the same unstable region — the end of the file,
      with no stable line after it — and they differ. This is the classic
      "both added code in the same place" conflict.
  - text: Side 1 edits line 20; side 2 edits line 21.
    explanation: >
      No stable line separates the edits, so they fall into a single unstable
      region that both sides changed differently — a conflict, even though no
      individual line was edited by both. Spurious, but that's the
      line-alignment heuristic.
```

## Reading a jj conflict

When a conflicted tree reaches your working copy, jj must render the term list into a single plain-text file so ordinary editors can open it. This is **materialization**, and the default format is designed so you can read the terms right back out of it.

Here's a conflict to materialize. One region of a Python file disagrees:

```
base    (P):    print("Hello, " + name)
side #1 (C):    print(f"Hello, {name}")
side #2 (D):    print("Howdy, " + name)
```

jj writes the file as:

```
def greet(name):
<<<<<<< Conflict 1 of 1
%%%%%%% Changes from base to side #1
-    print("Hello, " + name)
+    print(f"Hello, {name}")
+++++++ Contents of side #2
    print("Howdy, " + name)
>>>>>>> Conflict 1 of 1 ends
```

How to read it: `<<<<<<<` and `>>>>>>>` bracket one conflicted region — the stable `def greet(name):` line sits outside, already merged. The `%%%%%%%` section is a small unified diff: `-` lines are the base's text, `+` lines are side #1's replacement, and space-prefixed lines are unchanged context. The `+++++++` section is a plain snapshot of side #2.

Notice this is our algebra, verbatim. The region's value is the sum $+C - P + D$, and jj prints it grouped as $D + (C - P)$: one term as a snapshot, the other two as a diff. A materialized conflict is a resolution recipe — "take side #2, and apply by hand the change that turned the base into side #1."

To resolve, replace the whole marked region, markers included, with the text you want. And if you *don't* — if the working copy gets snapshotted with markers still in place — jj parses them back into the structured term list, so the conflict survives round trips through your editor intact.

```question
type: multiple-choice
prompt: In a materialized jj conflict, what do the lines beginning with `-` inside a `%%%%%%%` section represent?
choices:
  - text: 'The base''s text — the negative term $-P$ in the sum.'
    correct: true
    explanation: >
      The %%%%%%% section is a diff from the base to one side, so its minus
      lines are exactly the subtracted base term, and its plus lines are that
      side's added term.
  - text: Lines jj recommends deleting from your resolution.
    explanation: >
      jj makes no recommendation — the markers are a neutral encoding of the
      conflict's terms. The minus lines show what the base contained, which
      one side then changed.
  - text: The destination's text from before the rebase.
    explanation: >
      Not quite — they're the conflict's *base* (the old parent $P$ in a
      simple rebase), the state both sides diverged from. The destination
      shows up as one of the sides, not as the minus lines.
```

Conflicts can carry more than three terms. Rebase an already-conflicted commit and the sums nest; after simplification you can end up with $N$ sides and $N-1$ bases. Materialization generalizes: $N-1$ diff sections (`Changes from base #1 to side #1`, and so on) plus one final snapshot — and a file with several disagreeing regions labels them `Conflict 1 of 2`, `Conflict 2 of 2`.

If you'd rather see plain states than diffs, `ui.conflict-marker-style = "snapshot"` shows every term literally (`+++++++` for each side, `-------` for the base), and `"git"` gives the familiar `<<<<<<<` / `|||||||` / `=======` / `>>>>>>>` — which is just snapshot style restricted to two sides.

```question
type: free-response
prompt: |
  Your working copy contains this materialized conflict:

  ~~~
  fn main() {
  <<<<<<< Conflict 1 of 1
  %%%%%%% Changes from base to side #1
       let cfg = load_config();
  -    let port = cfg.port;
  +    let port = cfg.port + 1;
  +++++++ Contents of side #2
      let cfg = load_config()?;
      let port = cfg.port;
  >>>>>>> Conflict 1 of 1 ends
      serve(port);
  }
  ~~~

  Reconstruct the three states of the conflicted region — base, side #1, and
  side #2 — and give the natural resolution.
criteria: >
  Base region is: let cfg = load_config(); followed by let port = cfg.port;
  Side #1 is: let cfg = load_config(); followed by let port = cfg.port + 1;
  (the space-prefixed line in the diff section is unchanged context, so side
  #1 did NOT touch the load_config line). Side #2 is the snapshot: let cfg =
  load_config()?; followed by let port = cfg.port; The natural resolution
  combines both intents: let cfg = load_config()?; followed by let port =
  cfg.port + 1; Accept minor formatting variation. Getting side #1's first
  line wrong (treating context as changed) or reading the +++++++ section as
  a diff rather than a snapshot are the key errors — mark those incorrect or
  partial. Worth affirming as a bonus if mentioned: this conflict is spurious
  — the sides edited adjacent lines with no stable line between them.
sample_answer: >
  Base: cfg = load_config() without the question mark, port = cfg.port.
  Side #1 changed only the port line, to cfg.port + 1 (the load_config line
  is prefixed with a space — unchanged context). Side #2 changed only the
  load_config line, adding the question mark. Resolution: let cfg =
  load_config()?; let port = cfg.port + 1; — both changes, markers deleted.
  The edits were on adjacent lines with no stable anchor between them, which
  is the only reason this conflicted at all.
```

## Squash

Squash looks like it should be a sibling of rebase, but algebraically it's a different kind of operation entirely: **composition**, not transport.

Take a parent with tree $C_1$ (its own parent being $P$) and its child with tree $C_2$. Squashing the child into the parent composes their deltas, and the sum telescopes:

$$(C_2 - C_1) + (C_1 - P) = C_2 - P.$$

The squashed commit's tree is just $C_2$ — a tree that *already exists*. Nothing is merged, nothing is recomputed, and there is no opportunity for conflict. Squash doesn't transform any file contents at all; it re-describes the same endpoint as one step instead of two.

There's a nice cancellation for descendants, too. After the squash, a child $X$ of the old commit $C_2$ is "rebased" onto the new squashed commit — whose tree is also $C_2$. So $X' = C_2 + (X - C_2) = X$. Descendants are reparented but their trees are untouched, by pure term cancellation.

```question
type: free-response
prompt: >
  In one or two sentences: why can `jj squash` of a child into its parent
  never produce a conflict, while rebase can?
criteria: >
  The key idea: squash is composition of consecutive deltas along a single
  chain — the telescoping sum means the result tree (C2) already exists, so no
  merging of independent changes ever happens. Rebase combines two deltas made
  in parallel from a shared base (the commit's delta and the destination's
  delta), and parallel deltas can disagree about the same content. Accept any
  phrasing that contrasts sequential composition (endpoint already known)
  with parallel combination (three-way merge needed). Mere restatement like
  "squash doesn't merge" without saying why (consecutive vs parallel changes)
  is partial.
sample_answer: >
  Squash composes two consecutive changes, and the composite's endpoint is
  the child's existing tree — nothing has to be reconciled. Rebase combines
  two changes made in parallel from a common base, and those can contradict
  each other on the same lines.
```

## History as factorization

Zoom out. A linear history from root $R$ to head $H$ is a **factorization** of the total change $H - R$ into an ordered sequence of deltas. The head state is the product; the commits are the factors.

In this light: **squash** coarsens the factorization (two factors become one), **split** refines it, and both leave the head $H$ invariant. **Rebase** is the odd one out — it transports factors to a different base and genuinely changes the resulting states.

What about **reordering** two adjacent commits? Swapping $\Delta_1$ (tree $C_1$) and $\Delta_2$ (tree $C_2$) means rebasing each over the other: the second commit moves down to base $P$, giving $C_2' = P + (C_2 - C_1)$, and the first moves on top of it, giving $C_1' = C_2' + (C_1 - P)$.

Deltas on disjoint paths commute cleanly. Overlapping deltas may conflict — but only in the *intermediate* commit. Watch the head: $C_1' = P + (C_2 - C_1) + (C_1 - P) = C_2$. The terms telescope away, so the head of the reordered stack simplifies back to exactly the old head — jj's simplifier cancels the conflict terms even if you never resolve the intermediate one.

```question
type: multiple-choice
prompt: You reorder two adjacent commits that touch entirely disjoint sets of files. What does the model predict?
choices:
  - text: Both new commits are conflict-free, and the head tree is identical to before.
    correct: true
    explanation: >
      Disjoint deltas commute: every path is touched by at most one side of
      each three-way evaluation. And the head is C2 by telescoping regardless.
  - text: The head tree is preserved, but the intermediate commit is usually conflicted.
    explanation: >
      Only overlapping deltas can conflict. With disjoint paths, the
      three-way rules resolve every path in the intermediate commit too.
  - text: The commits swap cleanly but the head tree changes, since the deltas were applied in a different order.
    explanation: >
      The telescoping sum P + (C2 - C1) + (C1 - P) = C2 shows the head is
      order-independent — addition of deltas is commutative at the endpoint
      even when the intermediate states differ.
```

## The whole model on one screen

| Concept | Model |
| --- | --- |
| Snapshot (tree) | partial function $T : \mathrm{Path} \rightharpoonup \mathrm{Content}$ |
| Commit's change | derived difference $\Delta = C - P$ |
| Empty commit / backout | identity $0$ / inverse $-\Delta$ |
| Rebase onto $D$ | $C' = D + (C - P)$, evaluated by three-way rules |
| Merge of $A, B$ over $P$ | $A + B - P$ — same operation as rebase |
| Conflict | an unsimplifiable sum, stored as a value (jj) or an error (Git) |
| Hunk-level merge | the same three-way rules, recursed on line regions between stable anchors |
| Materialized conflict | the terms as text: `%%%%%%%` = diff from base to a side, `+++++++` = snapshot of a side |
| Squash | telescoping composition $(C_2 - C_1) + (C_1 - P) = C_2 - P$ |
| History | a factorization of $H - R$; squash/split re-factor, rebase transports |

And remember where exactness ends: trees, terms, and their cancellations are exact algebra, while the partition of a file into stable and unstable regions is a textual heuristic. A clean hunk-level merge is a strong bet, not a proof — nothing in the algebra checks that the combined program still means what you want.

```question
type: open-ended
prompt: >
  Where else do you think this abstraction leaks in practice? Consider
  renames, binary files, or what "the same change" means semantically.
context: >
  Good directions to affirm or probe: renames break the fixed-path-domain
  assumption — the function's domain itself gets remapped, and rename
  detection is heuristic; binary files have no line structure, so the hunk
  level disappears and conflicts revert to whole-file; identical textual
  changes can differ in intent, and a cleanly merging program can still fail
  to compile — semantics live entirely outside the algebra; generated and
  lock files make textual merging the wrong tool even when it succeeds.
  Connect back: jj's file-level term algebra is exact, and every leak sits
  either below it (line alignment) or beside it (meaning).
```

That's the lesson. The compact takeaway: a version control history is states with derived differences — rebase adds a difference to a new base, squash telescopes consecutive differences, conflicts are sums that won't simplify, and jj's trick is letting those sums be legitimate values.
