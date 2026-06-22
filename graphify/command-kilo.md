---
description: Build or query a graphify knowledge graph
---

Invoke the `graphify` skill immediately.

Pass the full `/kb-graph` argument string through unchanged.
If no arguments were supplied, treat the target path as `.`.

Examples:
- `/kb-graph`
- `/kb-graph src --update`
- `/kb-graph query "what connects auth to billing?"`

Do not answer from raw files before handing off to the `graphify` skill.
