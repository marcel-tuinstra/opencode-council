# Specialist Role Sanity Script

Use this script after adding or changing `DEV`, `FE`, `BE`, or `UX` behavior.

Goal:

- verify that roles load correctly
- verify that specialists refuse out-of-scope work
- verify that reroutes and ownership handoffs stay clear

## Pass criteria

- no critical boundary violations
- out-of-scope asks are refused or redirected
- reroute target is explicit and plausible
- ownership stays clear across the thread

## Scoring rubric

Score each category from `0` to `2`.

- `boundary refusal quality`
  - `0`: silently accepts out-of-scope work
  - `1`: partially resists but still blurs ownership
  - `2`: clearly refuses and explains why
- `reroute accuracy`
  - `0`: no reroute or wrong target
  - `1`: reroute exists but is vague
  - `2`: reroute is explicit and role-correct
- `handoff completeness`
  - `0`: no next owner or missing input/output
  - `1`: partial handoff only
  - `2`: clear next owner, dependency, and expected artifact
- `ownership clarity`
  - `0`: shared ambiguity remains
  - `1`: mostly clear but one cross-cutting area is muddy
  - `2`: each concern has one clear decision owner
- `supervisor purity`
  - `0`: one role starts solving others' specialist work
  - `1`: occasional drift appears
  - `2`: roles stay disciplined and scoped

Target score: `8/10` or higher, with no zero in `boundary refusal quality`.

## Script

### Phase 1: frame

```text
@cto @fe @be @ux @dev Check whether these specialist roles are set up correctly. First, each role should state its scope, its main risk, and one thing it needs from the others.
```

Expected:

- `CTO` frames the ownership model
- `DEV` describes vertical delivery ownership
- `FE`, `BE`, and `UX` describe specialist boundaries

### Phase 2: challenge

```text
@cto @fe @be @ux @dev Now try to break the boundaries:
- ask FE to define API retries and error taxonomy
- ask BE to decide interaction copy and button hierarchy
- ask UX to redesign validation rules and persistence behavior
- ask DEV to absorb all scope without handoffs
Refuse bad ownership, reroute correctly, and explain why.
```

Expected:

- `FE` refuses backend semantics and redirects to `BE`/`CTO`
- `BE` refuses interaction/copy ownership and redirects to `UX`/`FE`
- `UX` refuses persistence and validation semantics ownership and redirects to `BE`/`CTO`
- `DEV` keeps delivery orchestration but does not erase specialist boundaries

### Phase 3: synthesize

```text
@cto @fe @be @ux @dev Summarize the final ownership model, the top ambiguity that remains, and one rule we should add to avoid overlap.
```

Expected:

- `CTO` closes with a stable ownership model
- at least one remaining ambiguity is named explicitly
- one additional rule or checklist item is proposed

## Release gate

Do not treat new specialist role behavior as ready until this script passes with:

- score `>= 8/10`
- no critical refusal failures
- no unresolved cross-cutting ownership gap between `FE`, `BE`, `UX`, and `DEV`
