# WB manager and competitor import — 2026-09-09

Production: https://gribnikhelper.ru

## Preserve the live baseline

The live source had newer Yandex buyer-price and refresh-job changes that are not in this local branch. This deployment preserved the entire live release `/opt/skladno/releases/20260908-yandex-buyer-layout-v2` and applied only the WB access changes to its `lib/admin-auth.ts`, `app/page.tsx`, `app/api/marketplaces/route.ts`, and `app/api/target-prices/route.ts`.

Current release after deployment: `/opt/skladno/releases/20260909-wb-manager`.

Do not replace production with an archive of this branch without first reconciling those newer live Yandex changes. Read the current symlink before every deployment; it may have changed again.

## Access

`WB_MANAGER_LOGIN` and `WB_MANAGER_PASSWORD` are configured in the existing persistent production environment. Credentials are not stored in this repository. Role `wb-manager` has only cabinet `metanutrix`, can manage its price-target competitors, cannot switch to Yandex/Ozon, access media, or use owner-only settings. Existing owner, media, guest, and Yandex credentials were not changed.

## Import

Source: https://docs.google.com/spreadsheets/d/1taLWpS63CKg681nHdVc0REJqc2PGeyGhS2e2yQbpsic/edit#gid=1392218806 — tab `WB`.

Read the explicit competitor columns I, M, Q, U. Did not import automatic-replacement candidates, old prices, or any Ozon tab content. Matched all 30 populated products by exact WB nmId. Added 96 new product/competitor associations, preserving all pre-existing competitor objects. Repeated source entries were skipped. A read-only repeat import proposed zero additions. The source sheet was not changed.

The database backup `/opt/skladno/backups/wb-before-competitors-20260909.sqlite` and environment backup `/opt/skladno/backups/env-before-wb-manager-20260909` were created before changes. Persistent state was not replaced.

Production login, cabinet isolation, media denial, owner-only write denial, competitor edit authorization, and all imported IDs were checked through live APIs. The deployed source build passed.
