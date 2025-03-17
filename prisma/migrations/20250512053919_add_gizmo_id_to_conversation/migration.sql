-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `gizmo_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `conversations_gizmo_id_idx` ON `conversations`(`gizmo_id`);
