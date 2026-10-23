# Product uniqueness

Prevent new inventory/catalog records sharing the same normalized name inside one organization, including inactive products. Ignore surrounding/repeated whitespace, Unicode presentation differences, case, Arabic decorative marks and invisible direction formatting; preserve meaningful sizes, model numbers and distinct letters.

Use a deterministic SHA-256 product_names reservation inside the same server transaction, plus a catalog fallback for legacy products without claims. Rename/create must conflict atomically; unchanged legacy duplicate identities may still receive ordinary metadata edits. Deleting an unlinked product releases only its own name claim. No client-controlled identity key and no permissive Rules.

Preserve existing duplicate product IDs, stock, journals and invoice links. Display groups for review rather than silently merging or deleting financial history. Restore preserves legacy records; subsequent catalog creates/renames still enforce uniqueness.

Work from main649ea3b with the reviewed USD source from PR125/128 integrated in an isolated worktree; preserve current Netlify file storage. Test the combined result. No production write/deploy/Rules/account changes. User reviews and merges.
