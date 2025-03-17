-- CreateTable
CREATE TABLE `account_usage` (
    `id` VARCHAR(191) NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `timestamp` BIGINT NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `load_factor` DOUBLE NOT NULL DEFAULT 1.0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_usage_account_name_idx`(`account_name`),
    INDEX `account_usage_timestamp_idx`(`timestamp`),
    UNIQUE INDEX `account_usage_account_name_model_timestamp_key`(`account_name`, `model`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
