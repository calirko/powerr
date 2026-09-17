-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PowerEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pulse',
    "holdMs" INTEGER,
    "pressed" BOOLEAN,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PowerEvent" ("createdAt", "error", "holdMs", "id", "ok", "pressed", "source") SELECT "createdAt", "error", "holdMs", "id", "ok", "pressed", "source" FROM "PowerEvent";
-- Existing rows all predate `kind`: button rows carry press/release in `pressed`,
-- everything else was a remote pulse (the column default).
UPDATE "new_PowerEvent" SET "kind" = CASE WHEN "pressed" = true THEN 'press' ELSE 'release' END WHERE "source" = 'button';
DROP TABLE "PowerEvent";
ALTER TABLE "new_PowerEvent" RENAME TO "PowerEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
