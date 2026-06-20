import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Adds server-owned per-thread UI state to projection_threads:
 *  - `bookmarked` (0/1, default 0 — unbookmarked)
 *  - `pull_request_number` / `pull_request_remote` (PR-review identity, both NULL
 *    by default so threads are "Development" unless tagged)
 *
 * Existing threads are migrated to Dev by default; the PR-review identity is
 * backfilled from the "Review PR #N" / "Review PR #N (M)" naming scheme used when
 * those threads were created, defaulting the remote to "origin".
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pull_request_number INTEGER
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pull_request_remote TEXT
  `.pipe(Effect.catch(() => Effect.void));

  // Backfill PR-review identity from the title. "Review PR #" is 11 chars, so the
  // number starts at position 12; take the leading run up to the first space
  // (handles the " (N)" dedupe suffix) and keep it only when it is all digits.
  yield* sql`
    UPDATE projection_threads
    SET
      pull_request_remote = 'origin',
      pull_request_number = CAST(
        CASE
          WHEN instr(substr(title, 12), ' ') > 0
            THEN substr(substr(title, 12), 1, instr(substr(title, 12), ' ') - 1)
          ELSE substr(title, 12)
        END AS INTEGER
      )
    WHERE pull_request_number IS NULL
      AND title LIKE 'Review PR #%'
      AND (
        CASE
          WHEN instr(substr(title, 12), ' ') > 0
            THEN substr(substr(title, 12), 1, instr(substr(title, 12), ' ') - 1)
          ELSE substr(title, 12)
        END
      ) <> ''
      AND (
        CASE
          WHEN instr(substr(title, 12), ' ') > 0
            THEN substr(substr(title, 12), 1, instr(substr(title, 12), ' ') - 1)
          ELSE substr(title, 12)
        END
      ) NOT GLOB '*[^0-9]*'
  `;
});
