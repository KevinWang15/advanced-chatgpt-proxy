-- CreateTable
CREATE TABLE `degradation_check_results` (
    `id` VARCHAR(191) NOT NULL,
    `account_name` VARCHAR(191) NOT NULL,
    `knowledge_cutoff_date_string` VARCHAR(191) NOT NULL,
    `knowledge_cutoff_timestamp` INTEGER NOT NULL,
    `degradation` INTEGER NOT NULL,
    `check_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `degradation_check_results_account_name_check_time_idx`(`account_name`, `check_time` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
