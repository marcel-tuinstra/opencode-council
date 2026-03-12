# Supervisor Work Units

This repository still does not ship a full Supervisor runtime. This document is the reviewable v1 contract for intake normalization so future Supervisor execution can accept both ticketed and non-ticketed work without splitting the planning model.

## Canonical shape

Every intake should normalize into a `WorkUnit` with the same minimum planning fields:

- `objective`: the primary outcome the Supervisor is trying to achieve
- `constraints`: guardrails, policy limits, or execution boundaries
- `acceptanceCriteria`: the minimum checks that define done
- `dependencies`: upstream work, documents, people, or systems that can block execution
- `riskTags`: lightweight routing or caution labels like `workflow`, `reliability`, or `security`
- `evidenceLinks`: links the Supervisor or reviewer can use to verify context or outputs
- `source`: preserved origin metadata for Shortcut-backed and ad-hoc work alike

The typed contract lives in `plugins/orchestration-workflows/work-unit.ts`.

## Supported intake modes

### Shortcut-backed

Shortcut stories, epics, and objectives normalize into the same shape. The source block should preserve any available metadata that helps trace the original planning record, such as:

- Shortcut id
- app URL
- workflow state id
- owner ids
- label names
- parent epic or objective ids

Shortcut-specific metadata is useful when present, but the canonical planning fields should stay usable even if only a subset of metadata is available.

### Ad-hoc

Prompt-defined work, document-defined tasks, and manually entered requests also normalize into `WorkUnit` records.

Ad-hoc work must not require a ticket id. Instead, its source block can carry lightweight provenance such as:

- prompt/session reference
- document path or URL
- human-provided title
- captured-by or requested-by metadata

## Normalization rules

- The canonical planning fields are identical for Shortcut and ad-hoc intake.
- Missing ticket metadata must not block normalization if the work already has the required planning fields.
- When a Shortcut intake does not provide an explicit objective, normalization may fall back to the source title.
- Source metadata should be preserved as raw key-value data rather than forcing a ticket-system dependency into the core `WorkUnit` shape.

## Current implementation boundary

This story adds the typed `WorkUnit` contract and a minimal `normalizeWorkUnit` helper so future Supervisor wiring can reuse one canonical model. It does not introduce a full Supervisor runtime or automatic intake ingestion yet.
