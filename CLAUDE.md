# CLAUDE.md

**[`AGENTS.md`](AGENTS.md) is the authoritative working guide for this
repository.** Read it first. This file exists so that a tool looking for
`CLAUDE.md` finds a pointer rather than a second, drifting copy of the same
instructions.

## The map

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | how to work here: the rules, the traps, what is still open |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | the layout, what the split moved, and what it cost |
| [`README.md`](README.md) | how to run it, how to enrol an administrator, how to deploy |

## The three sentences that matter most

**This is the storefront repository's administration half, moved rather than
rewritten.** Every route answers on the path it answered on before; every
browser module keeps its filename and its globals. The one rename is
`admin-dashboard.html` → `frontend/pages/index.html`, because the console is
now the whole of a site rather than one document inside one.

**This console and the storefront share a database and nothing else.** No
shared session, no shared cookie, no API call in either direction. The only
HTTP link is `GET /storefront`, which redirects a person who clicked the logo.

**Backend edits do not take effect until the process restarts.** Use
`npm --prefix backend run dev`.
