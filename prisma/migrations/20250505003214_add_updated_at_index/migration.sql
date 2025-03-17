-- CreateIndex
CREATE INDEX `conversations_user_access_token_updated_at_idx` ON `conversations`(`user_access_token`, `updated_at`);
