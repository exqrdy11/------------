ALTER TABLE `ff_warehouses` ADD `wb_warehouse_id` integer;--> statement-breakpoint
ALTER TABLE `ff_warehouses` ADD `wb_warehouse_name` text;--> statement-breakpoint
UPDATE `ff_warehouses`
SET `wb_warehouse_id` = 1987385, `wb_warehouse_name` = 'Волгоград Upakovka'
WHERE `cabinet_id` = 'trusthome'
  AND lower(`city`) = 'волгоград'
  AND lower(`name`) = 'upakovagvlg'
  AND `wb_warehouse_id` IS NULL;
