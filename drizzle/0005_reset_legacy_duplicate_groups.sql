-- Legacy groups were built from album-wide dHash connected components, so a single weak match
-- could pull unrelated, already-resolved photos back into duplicate resolution. Their original
-- upload-request boundaries were not stored, making a trustworthy automatic regroup impossible.
-- Release unresolved members to the ordinary swipe deck and let future uploads use the stricter
-- batch-local classifier. Decisions already made for resolved members are preserved.
UPDATE `photos`
SET `duplicate_group_id` = NULL, `duplicate_resolved` = 1
WHERE `duplicate_group_id` IS NOT NULL OR `duplicate_resolved` = 0;
