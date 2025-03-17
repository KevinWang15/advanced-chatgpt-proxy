-- CreateTable
CREATE TABLE `tokens` (
    `token` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `webhook_url` VARCHAR(191) NULL,
    `is_managed` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_access` (
    `token` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `access_type` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`token`, `conversation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gizmo_access` (
    `token` VARCHAR(191) NOT NULL,
    `gizmo_id` VARCHAR(191) NOT NULL,
    `access_type` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`token`, `gizmo_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `conversation_access` ADD CONSTRAINT `conversation_access_token_fkey` FOREIGN KEY (`token`) REFERENCES `tokens`(`token`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gizmo_access` ADD CONSTRAINT `gizmo_access_token_fkey` FOREIGN KEY (`token`) REFERENCES `tokens`(`token`) ON DELETE CASCADE ON UPDATE CASCADE;
