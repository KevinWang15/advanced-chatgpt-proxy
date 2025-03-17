-- CreateTable
CREATE TABLE `chatgpt_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `real_account_name` VARCHAR(191) NOT NULL,
    `fake_email` VARCHAR(191) NOT NULL,
    `fake_name` VARCHAR(191) NOT NULL,
    `fake_avatar` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chatgpt_accounts_real_account_name_key`(`real_account_name`),
    UNIQUE INDEX `chatgpt_accounts_fake_email_key`(`fake_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
