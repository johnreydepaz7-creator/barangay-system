# Account duplicate prevention update

This update hardens account creation and phone changes so duplicate accounts cannot be created accidentally.

## Included safeguards

- Account phone numbers are normalized before saving, so `09123456789` and `9123456789` are treated as the same account.
- MongoDB has a unique account index on `phone` to block duplicate saves even during double-clicks or simultaneous requests.
- Registration and Admin Add now return a duplicate warning instead of creating another account.
- Only one Punong Barangay account is allowed. The system no longer silently deletes/replaces the old Punong Barangay account when another one is registered.
- Profile phone-number changes now check duplicates against both `9...` and legacy `09...` stored records.

## Optional existing-data check

To check whether the current database already contains duplicates, run:

```bash
npm run check-duplicate-accounts
```

To normalize old `09...` phone values where it is safe and does not collide with another account, run:

```bash
node scripts/check-duplicate-accounts.js --fix-legacy-phone-format
```

If the script reports duplicate groups, review them manually before deleting or merging accounts.
