-- Auth hardening
--  * emails become globally unique and lowercase (they are the login identifier)
--  * account lockout timestamp
--  * refresh tokens are bound to a session
--  * reset / verification tokens are stored as SHA-256 hashes

-- 1. Abort with an explicit message if two accounts share an email
--    (case-insensitive). They must be merged or renamed manually first.
DO $$
DECLARE
  duplicates TEXT;
BEGIN
  SELECT string_agg(e, ', ') INTO duplicates
  FROM (SELECT lower("email") AS e FROM "User" GROUP BY lower("email") HAVING count(*) > 1) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot make User.email unique, duplicated emails: %', duplicates;
  END IF;
END $$;

UPDATE "User" SET "email" = lower("email") WHERE "email" <> lower("email");

DROP INDEX "User_email_idx";
DROP INDEX "User_organizationId_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- 2. Pending reset / verification tokens were stored in plaintext: drop
--    them (users simply request a new link) and store hashes from now on.
DELETE FROM "PasswordResetToken";
DELETE FROM "EmailVerificationToken";

DROP INDEX "PasswordResetToken_token_key";
ALTER TABLE "PasswordResetToken" DROP COLUMN "token", ADD COLUMN "tokenHash" TEXT NOT NULL;
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

DROP INDEX "EmailVerificationToken_token_key";
ALTER TABLE "EmailVerificationToken" DROP COLUMN "token", ADD COLUMN "tokenHash" TEXT NOT NULL;
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- 3. Bind refresh tokens to their session. Existing tokens predate the
--    binding and were never rotated safely: revoke them (users log in again).
ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" TEXT;
UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
