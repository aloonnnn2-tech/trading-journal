// Types for `import img from "...png"` (static image imports).
//
// Normally they come from next-env.d.ts, which Next generates locally and
// which is gitignored -- so a fresh checkout (GitHub's CI, which runs
// `tsc --noEmit` before any build) doesn't have it, and every static image
// import failed to type-check there (2026-10-20). This file is checked in, so
// the types are there without a build.
/// <reference types="next/image-types/global" />
