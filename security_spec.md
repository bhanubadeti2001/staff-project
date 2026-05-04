# Security Specification - Trailing Ivy Café Attendance

## 1. Data Invariants
- A staff record must have a unique ID, name, role, and shift timings.
- An attendance record must reference a valid staff ID.
- Attendance records are keyed by `YYYY-MM-DD_staffId`.
- Only admins can manage staff members.
- Only admins can delete attendance records.
- Authenticated users (viewers) can check in staff and view reports.
- User profiles are created automatically on first login.
- `bhanunani886@gmail.com` is the bootstrap admin.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing (Staff)**: A viewer tries to create a staff member.
2. **Identity Spoofing (User)**: A user tries to create a user profile for someone else.
3. **Privilege Escalation**: A viewer tries to update their own role to 'admin' in the `users` collection.
4. **Orphaned Writing**: Creating an attendance record for a non-existent staff member.
5. **ID Poisoning**: Creating an attendance record with a 2KB junk string as the document ID.
6. **Shadow Fields**: Creating a staff record with an extra hidden field `is_active: false`.
7. **Invalid Data Type**: Setting `shift_start` to a boolean instead of a string.
8. **Resource Exhaustion**: Sending a 1MB string in the `notes` field of an attendance record.
9. **Unauthorized Delete**: A viewer trying to delete a staff member.
10. **State Skipping**: Updating an attendance record without a `status` field.
11. **PII Leak**: An unauthenticated user pokušava to read the `users` collection.
12. **Metadata Tampering**: A user trying to update their own `email` in the `users` collection.

## 3. The Test Runner
See `firestore.rules.test.ts`.
