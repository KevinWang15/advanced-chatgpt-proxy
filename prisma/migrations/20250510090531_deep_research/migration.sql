-- CreateTable
CREATE TABLE `deep_research_tracker` (
    `async_task_id` VARCHAR(191) NOT NULL,
    `user_access_token` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `version` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `deep_research_tracker_user_access_token_idx`(`user_access_token`),
    INDEX `deep_research_tracker_conversation_id_idx`(`conversation_id`),
    INDEX `deep_research_tracker_status_idx`(`status`),
    PRIMARY KEY (`async_task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
