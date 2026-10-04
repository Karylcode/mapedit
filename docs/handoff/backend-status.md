# Backend implementation status

## 目前進度

M0 complete on `backend`. M1 compiler implementation is in progress.
The repository started with design documents only. Next: file format, compiler and CLI check.

## 每個里程碑完成了什麼、怎麼驗證

- M0: strict ESM TypeScript workspace, pnpm lockfile, Vitest, ESLint, Prettier,
  Windows/Linux CI, full protocol v1 types and `mapedit dev --mock`.
  Mock serves valid box GLBs, project/scene endpoints and in-memory edits/history.
  Windows validation: 6 protocol integration tests passed; protocol/server/CLI
  typechecks and scoped ESLint passed. All 6 client messages, all 6 server message
  variants and all notice codes are exercised. MCP transport is added in M5.
- M1–M7: pending.

## 自行決定的事

- Work is split across independent package owners; milestone commits remain ordered.
- Node 24 is the CI runtime; the declared minimum is Node 22.13 for permission support.
- Tests run without `packages/web`; the real frontend is owned by Claude.

## 偏離設計

None identified yet.

## 需要人處理

None identified yet. GitHub authentication is available.

## 需要前端配合

Implement the existing protocol v1 and `/render` contract after backend review.

## 已知問題

Implementation and acceptance work are in progress; no completion claim yet.
