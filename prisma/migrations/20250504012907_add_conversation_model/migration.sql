-- CreateTable
CREATE TABLE `conversations` (
    `conversation_id` VARCHAR(191) NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `user_access_token` VARCHAR(191) NULL,
    `conversation_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conversations_account_name_idx`(`account_name`),
    INDEX `conversations_user_access_token_idx`(`user_access_token`),
    PRIMARY KEY (`conversation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
