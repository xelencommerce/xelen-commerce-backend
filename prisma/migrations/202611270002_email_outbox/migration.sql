-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "payloadCipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailOutbox_nextAttemptAt_leaseUntil_idx" ON "EmailOutbox"("nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailOutbox_expiresAt_idx" ON "EmailOutbox"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "EmailOutbox_userId_idx" ON "EmailOutbox"("userId");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT email_outbox_attempts_nonnegative CHECK (attempts >= 0);
GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailOutbox" TO xelen_app;
