# 🐛 Comprehensive Bug & Flaw Audit Report

**Audit date:** 2026-11-17  
**Scope:** `Melnote/` application code, excluding `app/editor.tsx` and note-editor internals such as `components/ui/RichEditor.tsx`  
**Method:** Static source audit of database, security, backup/import/export, settings, notifications, journal, profile, People, Calendar, groups, relations, contacts, locations, avatars, graph, onboarding, and shared UI flows.  
**Deliverable status:** Audit only. No application code was changed, and this document intentionally contains no repair implementation.

## Executive Summary

The audit identified **78 distinct defects/flaws**: **9 Critical**, **39 High**, and **30 Medium**. The most serious failures undermine the app-lock security boundary and make backup restoration non-atomic. A malformed import can clear live data, a failed import can silently cancel existing notifications, and a restore can mutate avatar/media storage before the database transaction succeeds. Several journal and person updates can produce partially committed state, while destructive person deletion can leave scheduled notifications alive.

The recurring root causes are: validation performed after destructive side effects; multi-step writes that are not transactional; database constraints that do not enforce the invariants assumed by application code; asynchronous UI/database work without generation guards or awaited persistence; and local-date values derived through UTC ISO strings. These micro-level failures propagate into destructive backup behavior, stale screens, silent notification loss, orphaned files, wrong dates, incorrect ages, and false success/error messaging.

### Severity totals

| Severity | Count | Meaning |
|---|---:|---|
| Critical | 9 | Security bypass or high-likelihood destructive/data-loss failure |
| High | 39 | Major integrity, notification, data, or user-visible workflow failure |
| Medium | 30 | Reproducible correctness, consistency, lifecycle, or UX defect |
| **Total** | **78** | |

## Micro-Level Breakdown Matrix

| ID | Severity | Area | Defect | Primary evidence |
|---|---|---|---|---|
| C-001 | Critical | Security | Missing stored PIN explicitly unlocks the app | `components/AppLock.tsx:143-149` |
| C-002 | Critical | Security | No brute-force lockout or cooldown | `components/AppLock.tsx:153-174` |
| C-003 | Critical | Backup | Notifications are canceled before payload validation | `db/repositories/DataRepository.ts:85-99` |
| C-004 | Critical | Backup | Malformed payload can erase current database | `db/repositories/DataRepository.ts:95-112,160-223` |
| C-005 | Critical | Backup | Restore overwrites assets before DB success | `utils/backup.ts:511-548` |
| C-006 | Critical | Backup | Post-DB failure leaves restored state inconsistent | `utils/backup.ts:548-588` |
| C-007 | Critical | Avatars | Old avatar is deleted before person update succeeds | `db/repositories/PersonRepository.ts:39-50` |
| C-008 | Critical | Journal | Tag replacement deletes all tags before reinsertion | `db/repositories/JournalRepository.ts:68-73` |
| C-009 | Critical | Journal | Content and tags are saved in separate operations | `app/journal/[id].tsx:378-388` |
| H-001 | High | Notifications | Person deletion treats comma-separated IDs as one ID | `db/repositories/PersonRepository.ts:60-68` |
| H-002 | High | Notifications | Global Notifications toggle does not control reminders | `app/settings.tsx:389-401`; `components/calendar/AddReminderModal.tsx:273-310` |
| H-003 | High | Backup | Imported reminders are rescheduled while notifications are disabled | `db/repositories/DataRepository.ts:225-241` |
| H-004 | High | Notifications | Permission request races the first scheduling attempt | `components/calendar/AddReminderModal.tsx:273-310` |
| H-005 | High | Security | Earlier success timer can unlock a later lock | `components/AppLock.tsx:104-121` |
| H-006 | High | Journal | UTC ISO string shifts new journals to the next local day | `app/journal/[id].tsx:75,267,371` |
| H-007 | High | Profile | UTC birthdate parsing shifts displayed age | `app/person/[id].tsx:234-253` |
| H-008 | High | People | Async loads can overwrite newer state and failures are unhandled | `app/(tabs)/index.tsx:406-482` |
| H-009 | High | Journal | Detail load has no stale-response guard | `app/journal/[id].tsx:256-308` |
| H-010 | High | Journal | Journal-list load has no stale-response guard | `app/(tabs)/journal.tsx:134-158` |
| H-011 | High | Calendar | Loads have no generation guard or error handling | `app/(tabs)/calendar.tsx:103-128` |
| H-012 | High | Reminders | Update cancels old first and can orphan newly scheduled alerts | `db/repositories/ReminderRepository.ts:105-139` |
| H-013 | High | Backup | Export reads tables in parallel without a consistent snapshot | `db/repositories/DataRepository.ts:31-46,80` |
| H-014 | High | Backup | Legacy import ignores exported settings | `utils/backup.ts:497-500`; `db/repositories/DataRepository.ts:101-112` |
| H-015 | High | Backup | Settings restore is separate from and after the DB transaction | `utils/backup.ts:548-581`; `db/repositories/SettingsRepository.ts:25-31` |
| H-016 | High | Backup | Legacy restore leaks its localized temporary file | `utils/backup.ts:497-500,587-593` |
| H-017 | High | Backup | Open archive extraction directories leak on abandonment | `app/settings.tsx:173-203,563-573`; `utils/backup.ts:318-370` |
| H-018 | High | Backup | UI falsely guarantees current data is unchanged | `app/settings.tsx:216-225` |
| H-019 | High | Settings | Writes are unordered/unobserved; reset can persist only partially | `store/SettingsContext.tsx:150-175` |
| H-020 | High | Data | Clear-all table deletion is not transactional | `db/repositories/DataRepository.ts:11-28` |
| H-021 | High | Data | Wipe-all leaves media files and settings behind | `db/repositories/DataRepository.ts:11-28`; `utils/media.ts:309-321` |
| H-022 | High | People | Person deletion sequencing can partially delete data | `db/repositories/PersonRepository.ts:73-81` |
| H-023 | High | Profile | Primary profile-load rejection leaves the screen loading forever | `app/person/[id].tsx:79-99` |
| H-024 | High | Profile | Profile deletion failures are unhandled and appear successful | `app/person/[id].tsx:168-172` |
| H-025 | High | Locations | Failed location save leaves Save permanently disabled | `app/person/[id]/locations.tsx:91-104,147-156` |
| H-026 | High | Notes UI | `NewEntryModal` uses one global draft across people | `components/person/NewEntryModal.tsx:23,54-74,96-125` |
| H-027 | High | Notes UI | Pending debounce can resurrect discarded draft content | `components/person/NewEntryModal.tsx:110-132,134-139,171-183` |
| H-028 | High | Notes UI | Draft restore omits the saved category | `components/person/NewEntryModal.tsx:96-103,117-121` |
| H-029 | High | Date/Time | `DatePicker` accepts malformed dates through rollover | `components/ui/DatePicker.tsx:188-197` |
| H-030 | High | Date/Time | `DatePicker` can emit an impossible day | `components/ui/DatePicker.tsx:199-221,255-269` |
| H-031 | High | Date/Time | `TimePicker` accepts invalid hours/minutes | `components/ui/TimePicker.tsx:168-175,194-204` |
| H-032 | High | Reminders | Scheduler accepts invalid date/time components through rollover | `db/repositories/ReminderRepository.ts:162-188` |
| H-033 | High | Reminders | Earlier-time current-day reminder is saved without notification | `components/calendar/AddReminderModal.tsx:273-310,403`; `db/repositories/ReminderRepository.ts:187-188` |
| H-034 | High | Relations | Relationship duplicate check is race-prone | `db/repositories/RelationshipRepository.ts:27-41`; `db/schema.ts:40-46` |
| H-035 | High | Contacts | Contact duplicate check is race-prone | `app/contact/[id].tsx:222-251`; `db/schema.ts:101-107` |
| H-036 | High | Groups | Person-group duplicate check is race-prone | `db/repositories/GroupRepository.ts:32-47,50-68`; `db/schema.ts:94-98` |
| H-037 | High | Groups | Optimistic member roster has no rollback after persistence failure | `components/person/ManageGroupMembersModal.tsx:311-330,422-447` |
| H-038 | High | Journal | Back silently deletes an existing empty journal | `app/journal/[id].tsx:476-487` |
| H-039 | High | Journal | Missing journal renders an indefinite blank screen | `app/journal/[id].tsx:461-467` |
| M-001 | Medium | Groups | `GroupSelector` closes dialogs before persistence completes | `components/GroupSelector.tsx:15-20,64-69,88-93` |
| M-002 | Medium | Groups | `ManageGroupsModal` does not await membership writes | `components/person/ManageGroupsModal.tsx:91-96` |
| M-003 | Medium | Avatars | Repeated image selection leaks intermediate avatar files | `components/person/EditPersonModal.tsx:70-93`; `app/(tabs)/index.tsx:582-595` |
| M-004 | Medium | Graph | Fourth graph tier is placed outside the clipped canvas | `components/person/SocialWebCanvas.tsx:145,386-436,986-991` |
| M-005 | Medium | Migrations | Broad migration errors containing `icon` or `color` are ignored | `app/_layout.tsx:82-94` |
| M-006 | Medium | Notifications | Reminder icon/color are omitted from OS notification content | `db/repositories/ReminderRepository.ts:220-225`; `db/schema.ts:78-79` |
| M-007 | Medium | Discovery | Reconnect activity timestamps mix seconds and milliseconds | `db/repositories/PersonRepository.ts:140-177` |
| M-008 | Medium | Settings | Malformed persisted settings produce `NaN` or invalid enum values | `store/SettingsContext.tsx:95-140` |
| M-009 | Medium | Settings | Invalid/duplicate profile-tab order is accepted | `store/SettingsContext.tsx:130-135`; `app/settings/appearance.tsx:263-293` |
| M-010 | Medium | Profile | Active tab is not reconciled when a tab becomes hidden | `app/person/[id].tsx:57-65,637-647` |
| M-011 | Medium | Birthdays | Invalid birthday components roll into another date | `db/repositories/PersonRepository.ts:92-113` |
| M-012 | Medium | Journal | `initialDate` is inconsistently type-checked | `app/journal/[id].tsx:54,73-76,266-267,370-371` |
| M-013 | Medium | Locations | `city` has no in-app editing path | `app/person/[id]/locations.tsx:32-57,172-200`; `db/schema.ts:18` |
| M-014 | Medium | Locations | Location data does not refresh when the screen regains focus | `app/person/[id]/locations.tsx:40-58,68-81` |
| M-015 | Medium | Relations | Missing person renders a blank relations page | `app/person/[id]/relations.tsx:86-103,222` |
| M-016 | Medium | Backup | Failed avatar decode imports a stale avatar URI | `db/repositories/DataRepository.ts:129-147` |
| M-017 | Medium | Journal | Journal delete sequencing is not transactional | `db/repositories/JournalRepository.ts:106-109` |
| M-018 | Medium | Security | Enabling/reconfiguring lock grants a 20-second grace period | `components/AppLock.tsx:31-43,64-77` |
| M-019 | Medium | Security | Wrong PIN invokes biometrics even when biometric unlock is disabled | `components/AppLock.tsx:80-101,172-174` |
| M-020 | Medium | Onboarding | Completion persistence is fire-and-forget despite the synchronous claim | `store/SettingsContext.tsx:158-168` |
| M-021 | Medium | Settings | `reloadSettings` reports completion after swallowed load failure | `store/SettingsContext.tsx:87-95,143-147` |
| M-022 | Medium | Settings | Persistence side effect occurs inside a React state updater | `store/SettingsContext.tsx:150-155` |
| M-023 | Medium | Avatars | Edit modal marks an avatar saved before persistence succeeds | `components/person/EditPersonModal.tsx:57-68` |
| M-024 | Medium | Calendar | Date normalization and birthday matching accept malformed values | `app/(tabs)/calendar.tsx:174-181,231-240,277` |
| M-025 | Medium | Groups | Group names are not unique | `db/schema.ts:84-91`; `db/repositories/GroupRepository.ts:15-18` |
| M-026 | Medium | Relations | Schema/repository permit self-relationships | `db/schema.ts:40-46`; `db/repositories/RelationshipRepository.ts:27-41` |
| M-027 | Medium | Journal | `journalTags` has no uniqueness constraint | `db/schema.ts:60-64`; `db/repositories/DataRepository.ts:198-200` |
| M-028 | Medium | Avatars | Avatar migration can orphan a copied file | `db/repositories/PersonRepository.ts:288-310` |
| M-029 | Medium | Profile | Route-id array is handled for loading but not deletion | `app/person/[id].tsx:79-82,168-171` |
| M-030 | Medium | Relations | Existing-link no-op is reported as a successful link | `db/repositories/RelationshipRepository.ts:27-41`; `app/person/[id]/relations.tsx:166-170` |

## Critical Dossiers

### C-001 — Missing stored PIN explicitly unlocks the app
- **Evidence:** `components/AppLock.tsx:143-149`; `validatePin()` reads `melnote_app_pin`, and when `!storedPin` it logs `stored PIN is missing, unlocking` and calls `handleSuccess()`.
- **Root cause:** Absence of the credential is treated as successful authentication rather than as an unrecoverable security configuration state.
- **Failure mechanism:** SecureStore loses/clears the PIN, or a setting is enabled while the PIN write failed → the lock screen accepts any input → `handleSuccess()` clears `isLocked` → protected content is exposed.
- **Downstream impact:** Complete app-lock bypass on any device where the PIN key is absent; this also amplifies the unsafe disable sequence in `app/settings/privacy.tsx:68-75`, where the PIN is deleted before the settings write is confirmed.

### C-002 — No brute-force lockout or cooldown
- **Evidence:** `components/AppLock.tsx:153-174`; `failedAttempts` is incremented, but it never blocks attempts, never delays input, and never invokes a lockout action.
- **Root cause:** `failedAttempts` is bookkeeping only. The only behavioral branch at `nextFailed >= 3` starts biometric authentication and otherwise permits another guess.
- **Failure mechanism:** Attacker repeatedly submits four-digit candidates → every wrong PIN is cleared and accepted for another attempt → there is no attempt ceiling or time-based penalty.
- **Downstream impact:** A four-digit PIN has only 10,000 possibilities, and the absence of throttling makes online/shoulder-surfed guessing practical. The lock therefore does not provide a meaningful brute-force boundary.

### C-003 — Notifications are canceled before payload validation
- **Evidence:** `db/repositories/DataRepository.ts:85-99`; `cancelAllScheduledNotificationsAsync()` executes before the imported object is checked.
- **Root cause:** A destructive external side effect precedes all structural validation and precedes the database transaction.
- **Failure mechanism:** User selects an invalid file → all current OS notifications are canceled → payload validation then throws → the import exits without recreating the current reminders.
- **Downstream impact:** A failed/no-op import silently removes every existing scheduled alert while the original database remains in place, creating a database/OS state divergence.

### C-004 — Malformed payload can erase the current database
- **Evidence:** `db/repositories/DataRepository.ts:95-112,160-223`; only the top-level object is validated, while each table array is optional. The transaction unconditionally deletes all current tables at lines 163-172 and inserts only arrays that are truthy/long enough.
- **Root cause:** Missing arrays are interpreted as empty datasets rather than invalid input, and schema-level validation occurs only after current data has been deleted inside the transaction.
- **Failure mechanism:** Payload such as `{ data: { people: [...] } }` passes the top-level check → transaction deletes every table → omitted tables are not reinserted → transaction commits a mostly empty database.
- **Downstream impact:** A syntactically valid but incomplete backup can erase people, entries, journals, groups, contacts, reminders, and relationships. A later foreign-key/insert error rolls back to the old DB, but a payload with valid arrays for only some tables commits the destructive partial replacement.

### C-005 — Restore overwrites assets before database success
- **Evidence:** `utils/backup.ts:511-548`; avatars are copied at lines 514-532 and media at lines 536-546 before `DataRepository.importData(payload)` at line 548. The catch block at lines 584-587 only deletes newly created avatar paths.
- **Root cause:** Asset mutation is performed outside the database transaction and without preserving prior destination contents.
- **Failure mechanism:** Restore copies archive assets over live paths → the database import fails → existing overwritten avatar/media bytes are not restored and newly copied files may be deleted selectively → live filesystem and live database no longer agree.
- **Downstream impact:** Failed restores can destroy current images, replace current avatars, and leave media referenced by the unchanged database pointing at different content.

### C-006 — Post-DB failure leaves restored state inconsistent
- **Evidence:** `utils/backup.ts:548-588`; after the database import succeeds, stale-media/avatar sweeping occurs at lines 550-568 and settings replacement at lines 570-581. Any later failure enters the same catch.
- **Root cause:** The operation has multiple post-commit phases, but the catch treats them as if the database transaction had rolled back.
- **Failure mechanism:** DB import succeeds → media/avatar cleanup or settings replacement fails → catch deletes `createdAvatars` → the restored DB still references those avatar paths → the UI reports failure even though the DB was replaced.
- **Downstream impact:** Users receive a false failure after data has already changed; restored avatars can be deleted while still referenced; stale assets may remain; settings may remain from the old dataset; and the app’s “unchanged” guarantee is false.

### C-007 — Old avatar is deleted before person update succeeds
- **Evidence:** `db/repositories/PersonRepository.ts:39-50`; the previous avatar is deleted at lines 43-45 before `db.update(people)` at lines 47-50.
- **Root cause:** Filesystem compensation is ordered before, and independently of, the database commit.
- **Failure mechanism:** Update payload contains a new avatar → old owned file is deleted → DB update fails or is interrupted → the person row still references the now-deleted old file.
- **Downstream impact:** A failed profile edit corrupts the current avatar. The person loses the valid image even though the database update did not occur.

### C-008 — Journal tag replacement deletes all tags before reinsertion
- **Evidence:** `db/repositories/JournalRepository.ts:68-73`; `setTaggedPeople()` calls `removeAllTags()` first and then inserts each person one-by-one.
- **Root cause:** Replacement is implemented as delete-then-insert with no transaction and no rollback.
- **Failure mechanism:** Existing tags are deleted → one tag insert fails because of a race/constraint/DB error → function rejects → journal content remains, but old tags are gone and only a prefix of new tags may exist.
- **Downstream impact:** Mention graph, person-to-journal links, filters, and tagged-person counts become incomplete or incorrect after a nominally failed save.

### C-009 — Journal content and tags are saved as separate operations
- **Evidence:** `app/journal/[id].tsx:378-388`; create/update occurs first, then `JournalRepository.setTaggedPeople(savedId, mentionedIds)`.
- **Root cause:** The screen treats a journal as one logical aggregate but persists content and tags in independent commits.
- **Failure mechanism:** Journal content saves → tag replacement fails → the catch reports “Failed to save journal entry” even though the content/title/date were already committed.
- **Downstream impact:** User-visible save failure does not mean “not saved”; retrying can create another new journal, and content can be committed with old, partial, or missing tags.

## High-Severity Dossiers

### H-001 — Deleting person does not split comma-separated notification IDs
- **Evidence:** `db/repositories/PersonRepository.ts:60-68` passes `r.notificationId` directly to `cancelScheduledNotificationAsync`. By contrast, `db/repositories/ReminderRepository.ts:64-71` correctly splits the comma-separated format.
- **Root cause:** The schema explicitly stores multiple notification IDs as a comma-separated string (`db/schema.ts:74`), but the person-deletion path treats it as one opaque ID.
- **Failure mechanism:** Reminder has on-time and nudge IDs `id1,id2` → person deletion calls cancel with literal `id1,id2` → the OS rejects that identifier → the actual scheduled notifications remain active.
- **Downstream impact:** Deleting a person can continue to produce private reminders after the person and database reminder row have been removed.

### H-002 — Global Notifications toggle does not control reminders
- **Evidence:** `app/settings.tsx:389-401` only persists `settings.enableReminders`. `components/calendar/AddReminderModal.tsx:273-310` creates/updates reminders without reading that setting, and no toggle handler cancels existing OS schedules.
- **Root cause:** The preference is disconnected from both scheduling and live notification state.
- **Failure mechanism:** User disables Notifications → new reminders are still scheduled and previously scheduled reminders remain active → the UI says notifications are off while the OS continues alerting.
- **Downstream impact:** Privacy/control expectations are violated; disabled notifications still expose reminder content on the lock screen and can interrupt users.

### H-003 — Imported reminders are rescheduled while notifications are disabled
- **Evidence:** `db/repositories/DataRepository.ts:225-241` reschedules every active imported reminder without reading `enableReminders`.
- **Root cause:** Import scheduling assumes notifications are always enabled, unlike user-facing settings semantics.
- **Failure mechanism:** Notifications are disabled → restore/import succeeds → every active reminder is scheduled and its `notificationId` stored.
- **Downstream impact:** A disabled notification state is silently reversed by importing data; users can receive unexpected alerts after a restore.

### H-004 — Permission request races the first scheduling attempt
- **Evidence:** `components/calendar/AddReminderModal.tsx:278-310` starts `getPermissionsAsync()`/`requestPermissionsAsync()` in an unawaited promise chain while immediately awaiting repository create/update.
- **Root cause:** Authorization and scheduling are concurrent, with no ordering guarantee.
- **Failure mechanism:** First reminder is created → repository calls `scheduleNotificationAsync()` before permission is granted → scheduling rejects and is swallowed at `ReminderRepository.ts:97-99,231-233` → permission later succeeds but the already-created reminder is never rescheduled.
- **Downstream impact:** The first reminder can appear in-app with no OS alert and no visible error; users believe reminders were set correctly.

### H-005 — Earlier success timer can unlock a later lock
- **Evidence:** `components/AppLock.tsx:104-121`; `handleSuccess()` schedules an unconditional 1.5-second timer that later calls `setIsLocked(false)`.
- **Root cause:** The timer is not associated with the lock generation that authorized it and is not canceled on a subsequent lock.
- **Failure mechanism:** User authenticates → before 1.5 seconds elapses the app backgrounds/relocks or a new lock cycle begins → the old timer fires → it clears `isLocked` for the new cycle.
- **Downstream impact:** A later lock can be bypassed without a new PIN or biometric check; lifecycle timing determines whether the lock holds.

### H-006 — UTC ISO string shifts new journals to the next local day
- **Evidence:** `app/journal/[id].tsx:75,267,371` derives the local date through `new Date().toISOString().split('T')[0]`.
- **Root cause:** `toISOString()` is UTC, while journal dates are local calendar dates.
- **Failure mechanism:** User creates a journal after local midnight in a negative UTC-offset timezone → UTC date is still the prior day → journal is stored under yesterday’s date.
- **Downstream impact:** New journals appear on the wrong calendar/list date, are missed by day filters, and can create misleading duplicate-day behavior around midnight.

### H-007 — UTC birthdate parsing shifts displayed age
- **Evidence:** `app/person/[id].tsx:234-253`; `parseFlexibleDate()` first uses `new Date(dateStr)`. For `YYYY-MM-DD`, JavaScript parses that as UTC, then `getFullYear/getMonth/getDate` read local calendar fields.
- **Root cause:** A date-only value is parsed as an instant and then compared with local components.
- **Failure mechanism:** Person’s birthday is `YYYY-MM-DD` → parsed at UTC midnight → viewed in a negative-offset timezone it becomes the prior local day/year → `getAge()` compares against the shifted local date.
- **Downstream impact:** Profiles can show an age one year too low around the birthday and can be off by one day at other times.

### H-008 — People loads can overwrite newer state and failures are unhandled
- **Evidence:** `app/(tabs)/index.tsx:406-482`; each focus/group transition starts `loadData()`, but there is no generation token or request identity. The function has `try/finally` but no `catch`.
- **Root cause:** Multiple async loads share the same `setPeople`, `setGroups`, and `setAllPeople` destinations without determining which result is newest.
- **Failure mechanism:** Group A load starts → user switches to Group B → B resolves first and paints → A resolves later and overwrites the list with Group A → failed queries reject as unhandled promises while `finally` merely hides the spinner.
- **Downstream impact:** The People screen can display the wrong group, stale people, or an empty list while reporting no actionable error.

### H-009 — Journal-detail load has no stale-response guard
- **Evidence:** `app/journal/[id].tsx:256-308`; the effect starts `loadData()` on route `id` change, but responses are applied without comparing their originating id/generation.
- **Root cause:** Route changes do not invalidate the previous request.
- **Failure mechanism:** Journal A load starts → route changes to Journal B → B resolves → A resolves later and writes A’s title/content/tags into B’s screen.
- **Downstream impact:** The user can view or edit the wrong journal; a subsequent save can write B’s displayed content into B’s row or produce mismatched tags.

### H-010 — Journal-list load has no stale-response guard
- **Evidence:** `app/(tabs)/journal.tsx:134-158`; `useFocusEffect` starts `loadData()` on every focus, but no generation or mounted check protects `setJournals/setPeople`.
- **Root cause:** Focus-driven requests can overlap and race.
- **Failure mechanism:** First focus request is slow → screen loses/re-gains focus and a newer request completes → older response overwrites the newer journal list.
- **Downstream impact:** Recently added/deleted journals can disappear from the list until another refresh, with no error indication.

### H-011 — Calendar loads have no generation guard or error handling
- **Evidence:** `app/(tabs)/calendar.tsx:103-128`; focus and `refreshCalendar` both call `loadData()`, while the promise has neither generation protection nor `catch`.
- **Root cause:** The screen assumes every overlapping calendar query resolves in order and succeeds.
- **Failure mechanism:** Focus load starts → reminder event triggers a refresh load → older load resolves last and overwrites newer people/journals/reminders → a DB failure rejects without user feedback.
- **Downstream impact:** Calendar markers and reminder details can be stale or inconsistent, and failures leave the previous calendar state in place with no explanation.

### H-012 — Reminder update cancels old first and can orphan newly scheduled alerts
- **Evidence:** `db/repositories/ReminderRepository.ts:105-139`; old notifications are canceled at lines 109-111, new ones are scheduled at lines 124-132, and the database is updated only at lines 136-139.
- **Root cause:** External notification state and database state are updated in a non-atomic sequence with the destructive step first.
- **Failure mechanism:** Update cancels old → new scheduling succeeds → DB update fails → the new OS alerts are live but no row stores their IDs; alternatively scheduling fails after cancellation → both old and new notifications are absent.
- **Downstream impact:** Users receive untracked alerts, or edited reminders silently lose all alerts. Orphan notifications cannot be canceled through the app.

### H-013 — Backup export reads tables without a consistent snapshot
- **Evidence:** `db/repositories/DataRepository.ts:31-46,80`; ten table reads are issued through `Promise.all`, and settings are read afterward outside that group.
- **Root cause:** No read transaction spans the export.
- **Failure mechanism:** A person is created/deleted while export runs → parallel selects observe different database states → people may reference tags/relationships that were read before or after the mutation → settings may represent yet another point in time.
- **Downstream impact:** The backup can be internally inconsistent and fail foreign-key restoration or restore a combination of records that never coexisted.

### H-014 — Legacy import ignores exported settings
- **Evidence:** `utils/backup.ts:497-500` sends legacy payloads only to `DataRepository.importData()`. `DataRepository.ts:101-112` destructures only tables and never reads `settings`.
- **Root cause:** Legacy and archive paths have different setting-handling behavior.
- **Failure mechanism:** A legacy JSON backup contains `data.settings` → import replaces tables → settings are ignored → the app continues with current local settings rather than the exported values.
- **Downstream impact:** Restoring a legacy backup silently fails to restore preferences; users receive a success message despite incomplete restoration.

### H-015 — Archive settings restore is outside the DB transaction
- **Evidence:** `utils/backup.ts:548-581` performs the table import first, then calls `SettingsRepository.replaceAll()` at line 580. `SettingsRepository.ts:25-31` deletes all settings and reinserts them one-by-one without a transaction.
- **Root cause:** Settings are treated as a side task after the main import rather than part of the same atomic restore.
- **Failure mechanism:** Table transaction commits → settings delete succeeds → one insert fails → restore throws with new tables but empty/partial settings.
- **Downstream impact:** A reported failure can coexist with fully restored data and corrupted preferences; app lock/theme/tab behavior can shift to defaults or invalid partial state.

### H-016 — Legacy restore leaks its localized temporary file
- **Evidence:** `utils/backup.ts:497-500` returns immediately for `session.kind === 'legacy'`, before the archive `finally` block at lines 589-593 can delete `session.tempFile`.
- **Root cause:** Cleanup is scoped only to the archive branch.
- **Failure mechanism:** A `content://` legacy file is localized into the cache → restore returns through the early branch → temporary copy is never deleted.
- **Downstream impact:** Repeated legacy imports accumulate private backup copies in cache, consume storage, and extend the lifetime of sensitive data outside the intended restore path.

### H-017 — Open archive extraction directories leak on abandonment
- **Evidence:** `utils/backup.ts:318-370` creates `melnote-restore-<timestamp>/` and returns it in the session. `app/settings.tsx:186-188` stores that session, while explicit cleanup occurs only on modal cancel at lines 570-573 or restore `finally`.
- **Root cause:** No unmount cleanup owns an open session when the user navigates away, closes the screen, or the app is killed before restore/cancel.
- **Failure mechanism:** User opens an archive → leaves Settings without confirming/canceling → the extraction directory and localized file remain in cache.
- **Downstream impact:** Cache grows with extracted private data; later opens may collide by timestamp; sensitive backup contents persist longer than necessary.

### H-018 — UI falsely guarantees current data is unchanged
- **Evidence:** `app/settings.tsx:216-225` tells the user “Your current data is unchanged” for an out-of-space restore error.
- **Root cause:** The message assumes every thrown restore error happens before destructive work.
- **Failure mechanism:** Asset copy or DB import succeeds → post-DB cleanup/settings replacement throws an out-of-space error → the catch selects the “unchanged” message → the database has already been replaced.
- **Downstream impact:** Users may avoid reporting a serious partial restore or assume their old data remains when it does not.

### H-019 — Settings writes are unordered/unobserved; reset can persist only partially
- **Evidence:** `store/SettingsContext.tsx:150-175`; `updateSetting()` starts `SettingsRepository.set()` without awaiting or catching it. `resetSettings()` launches one independent write per key and returns immediately.
- **Root cause:** Durable state is updated optimistically in memory while writes have no serialization, rollback, or completion contract.
- **Failure mechanism:** Rapid updates to the same key complete out of order → the older value wins; reset writes multiple keys → one write fails or the app exits → state and durable settings diverge.
- **Downstream impact:** Toggles can revert after restart, resets can be half-applied, and failures are invisible to the user.

### H-020 — Clear-all table deletion is not transactional
- **Evidence:** `db/repositories/DataRepository.ts:11-28`; notifications are canceled first and each table is deleted through separate statements.
- **Root cause:** “Delete all” is implemented as a sequence of independent commits rather than one transaction.
- **Failure mechanism:** Several tables are deleted → one later delete fails → the method throws → the database remains partially wiped, while notifications have already been canceled.
- **Downstream impact:** The wipe action can leave an unpredictable mixture of old and deleted data and still produce destructive side effects before failure is known.

### H-021 — Wipe-all leaves media files and settings behind
- **Evidence:** `db/repositories/DataRepository.ts:11-28` clears database tables and avatars only. `utils/media.ts:309-321` shows media is a separate directory store; no media cleanup or settings reset occurs.
- **Root cause:** The wipe operation covers relational tables and avatars but omits other persisted application state.
- **Failure mechanism:** User chooses Wipe All Data → DB rows and avatars disappear → `media/` files and settings remain → subsequent backups can still enumerate the media directory and a restored/new database can encounter old files.
- **Downstream impact:** “Wipe all” does not erase all private content, storage is not reclaimed, and stale media can be reintroduced into backups or later reference paths.

### H-022 — Person deletion sequencing can partially delete data
- **Evidence:** `db/repositories/PersonRepository.ts:73-81` deletes entries, journal tags, group memberships, contacts, reminders, relationships, and the person through separate statements.
- **Root cause:** A logical aggregate delete is not enclosed in a transaction, and OS notification cancellation occurs before it.
- **Failure mechanism:** Some child deletes succeed → a later delete fails → the person or a subset of dependent data remains, while already-removed links are gone and notifications may have been canceled.
- **Downstream impact:** A failed delete leaves a corrupted person graph, incomplete journals, and database state that does not match what the user was told was deleted.

### H-023 — Primary profile-load rejection leaves the screen loading forever
- **Evidence:** `app/person/[id].tsx:79-99`; the first `await PersonRepository.getById(personId)` is outside the later `try/catch`, which begins at line 101.
- **Root cause:** Only secondary tab queries are guarded; the primary query has no error path that clears `isLoading`.
- **Failure mechanism:** DB read rejects → the async callback exits before `setIsLoading(false)` → `isLoading` remains true → the screen renders the blank loading branch at lines 287-289 indefinitely.
- **Downstream impact:** Users see an infinite blank/loading profile with no retry or error message; navigation or DB recovery is unclear.

### H-024 — Profile deletion failures are unhandled and appear successful
- **Evidence:** `app/person/[id].tsx:168-172`; `confirmDeletePerson()` closes the modal, awaits deletion, then navigates back with no `try/catch`.
- **Root cause:** The UI assumes person deletion cannot fail and treats navigation as proof of deletion.
- **Failure mechanism:** `PersonRepository.delete()` rejects → the promise rejects without feedback → depending on the caller’s handling, the screen may remain or navigation may occur while the row still exists.
- **Downstream impact:** The user receives no actionable deletion error, can be led to believe deletion succeeded, and may retry into partially deleted dependent data.

### H-025 — Failed location save leaves Save permanently disabled
- **Evidence:** `app/person/[id]/locations.tsx:91-104`; `setIsSaving(false)` is reached only after a successful awaited update. The Save control is disabled by `isSaving` at lines 147-149.
- **Root cause:** There is no `try/finally` around the write.
- **Failure mechanism:** Save is pressed → `isSaving` becomes true → `PersonRepository.update()` rejects → execution skips the reset and navigation → the button remains disabled with no error alert.
- **Downstream impact:** The screen is effectively bricked for saving until remounted, and the user receives no explanation of why the write failed.

### H-026 — `NewEntryModal` uses one global draft across people
- **Evidence:** `components/person/NewEntryModal.tsx:23` defines one module-level `DRAFT_FILE`; `visible/personId` initialization at lines 54-74 always loads that same file.
- **Root cause:** Draft storage is not scoped by the person or note context.
- **Failure mechanism:** Person A starts a note → modal closes → Person B opens the modal → `checkDraft()` loads A’s text into B’s composer.
- **Downstream impact:** Private content can be attached to the wrong person, unrelated notes are duplicated, and users cannot maintain separate drafts per contact.

### H-027 — Pending debounce can resurrect discarded draft content
- **Evidence:** `components/person/NewEntryModal.tsx:110-132` schedules a write; `clearDraft()` at lines 134-139 deletes the file, but neither discard nor save cancels `saveTimeout.current`.
- **Root cause:** Draft deletion and the pending debounced write are not coordinated.
- **Failure mechanism:** User edits → 500 ms debounce is pending → user discards → file is deleted → pending callback runs and writes the old content back → the next modal opens with supposedly discarded text.
- **Downstream impact:** Discard is not durable, sensitive text reappears later, and the UI repeatedly violates the user’s explicit discard action.

### H-028 — Draft restore omits the saved category
- **Evidence:** `components/person/NewEntryModal.tsx:117-121` writes `category`, `customCategory`, and `content`, but `checkDraft()` at lines 96-103 restores only `content`.
- **Root cause:** The serialization and restoration schemas diverge.
- **Failure mechanism:** User selects “Gift Idea” or a custom category and writes a draft → reopen → content returns but category resets to “Note” → saving creates a note with the wrong type.
- **Downstream impact:** Draft continuation silently changes note taxonomy, producing incorrect entry types and misleading filtering.

### H-029 — `DatePicker` accepts malformed dates through rollover
- **Evidence:** `components/ui/DatePicker.tsx:188-197`; components are parsed with `parseInt` and passed to `new Date(y,m,d)` without checking that the resulting year/month/day equal the inputs.
- **Root cause:** JavaScript `Date` normalization is used as validation.
- **Failure mechanism:** Value such as `2025-02-31` becomes March 3; malformed month/day strings can similarly become another valid date or be silently replaced by today.
- **Downstream impact:** The displayed date differs from the stored input, birthday/first-met data is silently altered, and invalid values can propagate into age, calendar, and reminder logic.

### H-030 — `DatePicker` can emit an impossible day
- **Evidence:** `components/ui/DatePicker.tsx:199-221,255-269`; changing the month rebuilds the day list, but `handleSave()` writes `tempDay` directly without clamping it to that month’s length.
- **Root cause:** The wheel’s visual/safe index is not used to synchronize the actual `tempDay` state.
- **Failure mechanism:** January 31 is selected → user changes month to February → day choices contain only 1-28, but state remains 31 → Save emits `YYYY-02-31`.
- **Downstream impact:** Impossible ISO dates enter birthdays, first-met dates, journals, and reminders, where different parsers may interpret them differently.

### H-031 — `TimePicker` accepts invalid hours/minutes
- **Evidence:** `components/ui/TimePicker.tsx:168-175,194-204`; parsing only replaces `NaN`, while `handleSave()` emits `tempHour`/`tempMinute` without range validation.
- **Root cause:** The picker assumes externally supplied values are valid and normalizes some malformed inputs rather than rejecting them.
- **Failure mechanism:** `25:00` becomes a 1 PM display and can be saved as `13:00`; `12:99` is saved with minute 99; negative or excessive values are similarly accepted.
- **Downstream impact:** Reminder times become unrelated to user input, can be normalized by the OS scheduler, and may silently point to a different day/hour.

### H-032 — Reminder scheduler accepts invalid date/time components through rollover
- **Evidence:** `db/repositories/ReminderRepository.ts:162-188`; it rejects only non-numeric parts, then constructs `new Date(year, month - 1, day, hours, minutes)`.
- **Root cause:** Component ranges and calendar validity are not checked before `Date` normalization.
- **Failure mechanism:** Month 13, day 32, hour 25, or minute 70 is accepted → `Date` rolls it into another date/time → a notification is scheduled for a time the user never selected.
- **Downstream impact:** Malformed imported or programmatic reminders trigger at unrelated times; invalid values are concealed instead of surfaced as validation errors.

### H-033 — Earlier-time current-day reminder is saved without notification
- **Evidence:** `components/calendar/AddReminderModal.tsx:403` uses `minDate={new Date()}` (date granularity), while `db/repositories/ReminderRepository.ts:187-188` rejects a trigger earlier than `Date.now()`.
- **Root cause:** Date-level minimum validation does not account for the selected time on the current day.
- **Failure mechanism:** User selects today with a time already past → repository still inserts the reminder → scheduler returns `null` → no OS notification is created, but the UI reports “Reminder set.”
- **Downstream impact:** A visible reminder appears to be armed while having no alert; users can miss it with no error explaining why.

### H-034 — Relationship duplicate check is race-prone
- **Evidence:** `db/repositories/RelationshipRepository.ts:27-41` performs a select-then-insert, while `db/schema.ts:40-46` has no unique constraint on the relationship pair.
- **Root cause:** Uniqueness exists only as application logic and is not atomic at the database layer.
- **Failure mechanism:** Two concurrent link requests both observe no relationship → both insert → duplicate edges appear between the same people.
- **Downstream impact:** The graph contains duplicate nodes/edges, relationship counts are inflated, and deleting one duplicate leaves the relationship visually present.

### H-035 — Contact duplicate check is race-prone
- **Evidence:** `app/contact/[id].tsx:222-251` reads all contacts and checks for a duplicate before `ContactRepository.addContact()`. `db/schema.ts:101-107` has no unique constraint on `(personId, platform, value)`.
- **Root cause:** The check and insert are separate operations with no database invariant.
- **Failure mechanism:** Two save operations for the same person/platform/value overlap → both checks pass → both rows are inserted.
- **Downstream impact:** The contact screen shows duplicate phone/email/social entries; edits/deletes become ambiguous and downstream sharing can use stale duplicates.

### H-036 — Person-group duplicate check is race-prone
- **Evidence:** `db/repositories/GroupRepository.ts:32-47,50-68` checks existing junction rows and then inserts. `db/schema.ts:94-98` does not enforce uniqueness of `(personId, groupId)`.
- **Root cause:** Junction-table identity is not represented by a unique constraint or composite primary key.
- **Failure mechanism:** Concurrent assignments or bulk adds observe the same missing membership → duplicate junction rows are inserted.
- **Downstream impact:** Membership counts and remove operations are inconsistent; one toggle may leave the person still assigned through the duplicate row.

### H-037 — Optimistic member roster has no rollback after persistence failure
- **Evidence:** `components/person/ManageGroupMembersModal.tsx:311-330` removes a person from local `roster` before an unawaited `onRemoveMembers`; lines 422-447 optimistically add people before an unawaited `onAddMembers`.
- **Root cause:** UI state is committed before the persistence result and no failure handler restores the previous roster.
- **Failure mechanism:** User removes/adds a member → local roster changes immediately → DB write fails → the member still appears removed/added in the modal and the undo action issues a compensating write against the wrong assumed state.
- **Downstream impact:** The roster diverges from persisted membership, user trust is lost, and undo can turn a failed add into an unintended removal.

### H-038 — Back silently deletes an existing empty journal
- **Evidence:** `app/journal/[id].tsx:476-487`; in reader mode, an empty existing journal calls `handleDelete(true)` instead of merely navigating back.
- **Root cause:** “Empty” is interpreted as “should not exist,” and the destructive operation is silent via `silent=true`.
- **Failure mechanism:** User opens an existing title/content-empty journal and presses Back → the row is deleted without a confirmation or visible message → navigation returns to the list.
- **Downstream impact:** Data is lost from an ordinary navigation gesture, especially surprising for journals intentionally used as placeholders.

### H-039 — Missing journal renders an indefinite blank screen
- **Evidence:** `app/journal/[id].tsx:287-308` only sets state when a journal is found; lines 461-467 return an empty `ThemedView` whenever `journal` remains null.
- **Root cause:** Not-found, still-loading, and route-error states are collapsed into one indistinguishable null state.
- **Failure mechanism:** Journal id is missing/deleted or lookup fails → no explicit error/empty state is set → the screen remains a blank surface indefinitely.
- **Downstream impact:** Users receive no “not found” explanation, retry path, or back affordance and may believe the app is frozen.

## Medium-Severity Dossiers

### M-001 — `GroupSelector` closes dialogs before persistence completes
- **Evidence:** `components/GroupSelector.tsx:15-20` types `onCreateGroup` as returning `void`; lines 64-69 invoke it and immediately clear/close. Lines 88-93 do the same for updates.
- **Root cause:** The child UI has no completion promise and treats callback invocation as successful persistence.
- **Failure mechanism:** User confirms a group → dialog closes → parent repository call later fails → the entered values are lost and the screen gives no failure state for that dialog.
- **Downstream impact:** Create/edit operations appear successful before they are durable; retries can create duplicates.

### M-002 — `ManageGroupsModal` does not await membership writes
- **Evidence:** `components/person/ManageGroupsModal.tsx:91-96`; `onToggleGroup(g.id)` is called inside a press handler without `await`, pending-state tracking, or a catch handler.
- **Root cause:** The modal treats a Promise-returning mutation as fire-and-forget.
- **Failure mechanism:** User taps two group rows quickly → both membership reads/writes overlap → later completions determine state, and a failed write leaves the checkmark/UI disconnected from the database.
- **Downstream impact:** Group membership can be toggled inconsistently or appear changed when persistence failed.

### M-003 — Repeated image selection leaks intermediate avatar files
- **Evidence:** `components/person/EditPersonModal.tsx:79-93` copies every newly picked image to app storage and replaces `avatarUri`; cleanup at lines 70-74 deletes only the final unsaved URI. The new-person flow has the same pattern at `app/(tabs)/index.tsx:582-595`.
- **Root cause:** When a new selection replaces an unsaved selection, the previous owned file is not deleted.
- **Failure mechanism:** User picks image A → picks image B → state points to B → close deletes B → file A remains permanently in `avatars/`.
- **Downstream impact:** Repeated edits accumulate private orphan files, waste storage, and enlarge subsequent archive cleanup/sweep workloads.

### M-004 — Fourth graph tier is placed outside the clipped canvas
- **Evidence:** `components/person/SocialWebCanvas.tsx:145` initializes a 500-pixel-high canvas; lines 386-436 place tier-four nodes at radius `r4 = 310`; lines 986-991 set `overflow: 'hidden'` on the container.
- **Root cause:** Node geometry is not bounded to the actual clipped viewport.
- **Failure mechanism:** Graph has 31+ relationships → outer-tier coordinates extend beyond the top/bottom of the 500-pixel container → clipped nodes/edges disappear or become unselectable.
- **Downstream impact:** Large social graphs silently hide relationships and appear corrupt even though the records exist.

### M-005 — Broad migration errors containing `icon` or `color` are ignored
- **Evidence:** `app/_layout.tsx:82-94`; `isIgnorableMigrationError` treats any message containing `icon` or `color` as ignorable, then `hasMigrationFinished` is forced true.
- **Root cause:** Error classification is based on two broad substrings rather than a known migration/error identity.
- **Failure mechanism:** A migration fails for an unrelated reason whose text contains `icon` or `color` (for example, a malformed value or constraint error) → the app treats migration as finished → startup continues against an incomplete schema.
- **Downstream impact:** Missing columns/tables or invalid migrated values surface later as runtime failures, silent data loss, or unexplained screen errors.

### M-006 — Reminder icon/color are omitted from OS notification content
- **Evidence:** `db/schema.ts:78-79` and `components/calendar/AddReminderModal.tsx:294-295,307-308` persist/display `icon` and `color`, but `db/repositories/ReminderRepository.ts:220-225` sends only title, body, and sound to the OS.
- **Root cause:** Notification styling is treated as in-app metadata only and is not propagated to the platform payload.
- **Failure mechanism:** User chooses a visual reminder style → row stores it → OS payload omits it → lock-screen notification cannot reflect the chosen identity/color.
- **Downstream impact:** The feature’s selected style appears to work in the app but has no effect in the actual system notification, weakening visual differentiation and accessibility.

### M-007 — Reconnect activity timestamps mix seconds and milliseconds
- **Evidence:** `db/repositories/PersonRepository.ts:140-150` obtains `max(createdAt)` from Drizzle timestamp-mode columns; lines 159-177 treat the numeric result as milliseconds in `now - lastActivity`.
- **Root cause:** SQLite timestamp mode stores epoch seconds, while `Date.now()` and the subtraction use milliseconds.
- **Failure mechanism:** Last activity is about `1.7e9` seconds → subtracting it from `1.7e12` milliseconds yields an enormous age → every active person appears inactive for thousands of days.
- **Downstream impact:** “Cooling off” suggestions trigger for essentially everyone with activity; recent users are misclassified and the discovery feature becomes unreliable.

### M-008 — Malformed persisted settings produce `NaN` or invalid enum values
- **Evidence:** `store/SettingsContext.tsx:95-140`; string enums are cast directly (`as ThemeMode`, `as any`, `as 'default' | 'discovery'`) and numeric settings use unchecked `parseInt`.
- **Root cause:** The settings table is treated as trusted typed data at runtime.
- **Failure mechanism:** Corrupt/imported value `journalFontSize='abc'` becomes `NaN`; `theme='sepia'` is accepted as a `ThemeMode`; unknown sort/list modes reach conditional rendering.
- **Downstream impact:** Typography can collapse or become invalid, theme logic takes undefined branches, controls show no selected state, and malformed data propagates through the entire app.

### M-009 — Invalid/duplicate profile-tab order is accepted
- **Evidence:** `store/SettingsContext.tsx:130-135` only appends missing defaults; it does not reject unknown identifiers or duplicates. `app/settings/appearance.tsx:263-293` renders each stored string directly and uses `tab` as the React key.
- **Root cause:** The order is persisted as an unconstrained string list and reconstructed permissively.
- **Failure mechanism:** Stored order contains `['info','info','bogus']` → duplicates render twice and unknown tabs are treated as valid IDs → active-tab lookup can fail and profile content can be blank.
- **Downstream impact:** Duplicate tabs, broken keys/layout, missing profile sections, and a navigation indicator that points at no visible active tab.

### M-010 — Active tab is not reconciled when a tab becomes hidden
- **Evidence:** `app/person/[id].tsx:57-65` computes `orderedTabs` but initializes `activeTab` only once. Lines 637-647 fall back visually to index 0 when the active tab is absent, without changing `activeTab`.
- **Root cause:** State initialization is not reconciled with later filtering of `profileTabsOrder`/`showJournalTab`.
- **Failure mechanism:** User is on “Journal Memories” → Journal tab visibility is disabled → the button disappears → `activeTab` remains `journals` → indicator targets index 0 while content logic may still target the hidden tab.
- **Downstream impact:** Profile navigation shows the wrong selected state and can show hidden-tab content or an inconsistent empty area until the screen is remounted.

### M-011 — Invalid birthday components roll into another date
- **Evidence:** `db/repositories/PersonRepository.ts:92-113` parses numeric components but does not verify the constructed date retains the same month/day.
- **Root cause:** `Date` rollover is accepted as a valid birthday.
- **Failure mechanism:** `2000-02-31` becomes March 2 (or March 3 in leap-year rules) → upcoming-birthday calculations use the normalized date → the person is scheduled/shown on a birthday they never entered.
- **Downstream impact:** Birthday cards and calendar events occur on incorrect dates, with no indication that the source value was invalid.

### M-012 — `initialDate` is inconsistently type-checked
- **Evidence:** `app/journal/[id].tsx:54` obtains `initialDate` from route params. Line 75 checks `typeof initialDate === 'string'`, but lines 267 and 371 cast/use it without the same check.
- **Root cause:** Route parameters are assumed to have one stable runtime type across the component.
- **Failure mechanism:** Expo Router supplies an array/object-like parameter → initialization uses a safe fallback while load/save uses the raw value → `journal.date` and the persisted date can differ or become a non-string value.
- **Downstream impact:** New journals can land on the wrong date or fail later when calendar/list code expects `YYYY-MM-DD`.

### M-013 — `city` has no in-app editing path
- **Evidence:** `db/schema.ts:18` stores `people.city`; `app/person/[id]/locations.tsx:32-57,172-200` loads and edits only home, work, and other locations.
- **Root cause:** The database field is exposed to discovery logic but omitted from the location editor.
- **Failure mechanism:** User expects the Places screen to edit city → no control exists → `city` remains stale or empty while the People/suggestion logic continues to treat it as missing profile data.
- **Downstream impact:** Incomplete location profiles, inaccurate “missing details” suggestions, and data that can only be changed through legacy/import paths.

### M-014 — Location data does not refresh when the screen regains focus
- **Evidence:** `app/person/[id]/locations.tsx:40-58` loads only when `id` changes. The focus effect at lines 68-81 only installs a BackHandler and does not reload.
- **Root cause:** Data freshness is tied to initial route identity rather than screen focus.
- **Failure mechanism:** Location is changed elsewhere → user returns to this already-mounted screen → the old fields and `originalData` remain → the UI shows stale values and may prompt for or overwrite changes incorrectly.
- **Downstream impact:** Save/discard decisions are based on obsolete state; users can overwrite newer location data.

### M-015 — Missing person renders a blank relations page
- **Evidence:** `app/person/[id]/relations.tsx:86-103` returns without state when the person is not found; line 222 renders only an empty `ThemedView` for null `person`.
- **Root cause:** Missing-person and still-loading states have no explicit UI.
- **Failure mechanism:** Route id is invalid/deleted → `person` remains null → the screen renders a blank surface with no explanation or recovery action.
- **Downstream impact:** Users cannot distinguish a missing profile from a loading/frozen screen and have no in-screen path back.

### M-016 — Failed avatar decode imports a stale avatar URI
- **Evidence:** `db/repositories/DataRepository.ts:129-147`; when `_avatarBase64` decoding/writing fails, the catch logs the error, then line 146 deletes `_avatarBase64` without clearing `newPerson.avatarUri`.
- **Root cause:** Decode failure does not normalize the row to a known avatar state.
- **Failure mechanism:** Legacy backup contains embedded avatar data and an old absolute URI → decode fails → `_avatarBase64` is removed → imported row retains the old URI → the new device references a file that does not exist there.
- **Downstream impact:** Restored profiles show broken images and accumulate dangling avatar references instead of cleanly falling back to initials.

### M-017 — Journal delete sequencing is not transactional
- **Evidence:** `db/repositories/JournalRepository.ts:106-109`; tags are deleted first and the journal row second in independent operations.
- **Root cause:** The parent/child aggregate is not deleted atomically.
- **Failure mechanism:** Tag deletion succeeds → journal deletion fails → the journal remains but has lost all people tags and may no longer appear in linked person profiles.
- **Downstream impact:** A failed delete corrupts journal relationships and produces a partial record instead of preserving or removing the aggregate.

### M-018 — Enabling/reconfiguring lock grants a 20-second grace period
- **Evidence:** `components/AppLock.tsx:31-43`; any `lastSecurityEvent` or transition to enabled sets `lockBypassUntil.current = Date.now() + 20000`, and lines 64-77 honor that grace on active/background transitions.
- **Root cause:** Security configuration changes deliberately bypass the lock for a fixed interval.
- **Failure mechanism:** Lock is enabled or a security event fires → app backgrounds and returns within 20 seconds → the active-state handler skips locking → protected content remains accessible without authentication.
- **Downstream impact:** The effective security guarantee is weaker than the “Require passcode to open Melnote” wording and leaves a predictable post-change window.

### M-019 — Wrong PIN invokes biometrics even when biometric unlock is disabled
- **Evidence:** `components/AppLock.tsx:80-101` normally respects `settings.biometricEnabled`, but `validatePin()` calls `handleBiometricAuth(true)` at lines 172-174 after three failures. The `true` argument bypasses the setting.
- **Root cause:** The brute-force mitigation path ignores the user’s explicit biometric preference.
- **Failure mechanism:** User disabled biometrics but enabled passcode → three wrong entries cause a biometric system prompt → the prompt appears despite the setting and may expose a different authentication route.
- **Downstream impact:** Preference violations, unexpected system UI, and inconsistent security behavior exactly when the user is struggling to authenticate.

### M-020 — Onboarding persistence is fire-and-forget despite the synchronous claim
- **Evidence:** `store/SettingsContext.tsx:158-168`; the comment says the write is synchronous under the hood, but both `SettingsRepository.set()` calls are launched with `void` and are not awaited; completion state is set immediately.
- **Root cause:** UI completion is decoupled from durable writes and the two legacy/current keys are not atomic.
- **Failure mechanism:** User finishes onboarding → state says complete → app is killed/backgrounded before writes settle → durable marker is missing or only one key is written → onboarding may replay or migrate inconsistently.
- **Downstream impact:** The tour can reappear after a restart, and completion state can disagree between current and legacy markers.

### M-021 — `reloadSettings` reports completion after swallowed load failure
- **Evidence:** `store/SettingsContext.tsx:87-95,143-147`; `reloadSettings()` awaits `loadSettings()`, but `loadSettings()` catches every error and does not rethrow or return a failure result.
- **Root cause:** The reload API has no error contract.
- **Failure mechanism:** Restore completes → `reloadSettings()` is called → settings read/parse fails → error is only logged → the awaited promise resolves successfully → the caller reports full success while in-memory settings remain stale.
- **Downstream impact:** Restore confirmation can be false, and the UI can continue applying old settings after a supposedly successful reload.

### M-022 — Persistence side effect occurs inside a React state updater
- **Evidence:** `store/SettingsContext.tsx:150-155`; `SettingsRepository.set(key, value.toString())` is invoked inside the callback passed to `setSettings`.
- **Root cause:** A state updater is used as a command side-effect channel rather than a pure state transformation.
- **Failure mechanism:** React development Strict Mode may invoke updater functions more than once → the database write occurs more than once; concurrent renders can also make side-effect timing unrelated to the committed state.
- **Downstream impact:** Duplicate persistence, non-deterministic write counts, and harder-to-reason-about ordering under concurrent updates.

### M-023 — Edit modal marks an avatar saved before persistence succeeds
- **Evidence:** `components/person/EditPersonModal.tsx:57-68`; `savedAvatarRef.current = avatarUri` is set before `onSave()` completes, although `onSave` is Promise-returning at line 25.
- **Root cause:** “Selected for save” is conflated with “persisted successfully.”
- **Failure mechanism:** User saves a new avatar → ref is marked saved → parent update rejects → modal later closes → cleanup sees no difference from `savedAvatarRef` and does not delete the new file.
- **Downstream impact:** Failed edits leak avatar files and can leave the database pointing at the old file while disk ownership is misclassified.

### M-024 — Calendar date normalization and birthday matching accept malformed values
- **Evidence:** `app/(tabs)/calendar.tsx:174-181` pads/normalizes split strings without validating actual date components; lines 231-240 and 277 match birthdays with `endsWith(monthDay)`.
- **Root cause:** Calendar matching trusts string shape rather than parsed, validated calendar dates.
- **Failure mechanism:** A malformed birthdate such as `garbage-12-25` matches December 25 because of its suffix → the calendar creates a birthday event for the wrong/invalid source value; invalid normalized keys can point at arbitrary dates.
- **Downstream impact:** False calendar events, duplicated birthday markers, and inconsistent behavior between the calendar and birthday repository.

### M-025 — Group names are not unique
- **Evidence:** `db/schema.ts:84-91` defines no unique constraint on `groups.name`; `db/repositories/GroupRepository.ts:15-18` inserts names directly.
- **Root cause:** The UI assumes group labels are distinct but the data layer does not enforce that assumption.
- **Failure mechanism:** User creates “Friends” twice, or concurrent requests do so → duplicate groups appear → both can contain different members and the person must be assigned to both for equivalent filters to work.
- **Downstream impact:** Fragmented membership, ambiguous navigation, and duplicate counts.

### M-026 — Schema/repository permit self-relationships
- **Evidence:** `db/schema.ts:40-46` has separate source/target foreign keys but no `source != target` invariant; `db/repositories/RelationshipRepository.ts:27-41` does not reject equal ids.
- **Root cause:** Self-link validity is assumed rather than enforced.
- **Failure mechanism:** A malformed import or direct call with equal source/target inserts a self-edge → graph traversal and relationship counts treat the person as connected to themself.
- **Downstream impact:** Misleading social-web nodes, distorted counts, and ambiguous deletion/filter behavior.

### M-027 — `journalTags` has no uniqueness constraint
- **Evidence:** `db/schema.ts:60-64` gives junction rows only an autoincrement id; `db/repositories/DataRepository.ts:198-200` imports tag rows verbatim.
- **Root cause:** The logical `(journalId, personId)` identity is not represented by a unique constraint.
- **Failure mechanism:** A malformed/legacy import contains duplicate tag pairs → duplicates are inserted → people appear linked multiple times and journal tag counts diverge from distinct relationships.
- **Downstream impact:** Inflated tag counts, duplicate pills in some views, and ambiguous relationship cleanup.

### M-028 — Avatar migration can orphan a copied file
- **Evidence:** `db/repositories/PersonRepository.ts:288-310`; `persistAvatar(uri)` copies a new owned file before the row is updated at line 305.
- **Root cause:** File creation and DB pointer update are not coordinated or compensated.
- **Failure mechanism:** Copy succeeds → the subsequent `db.update(people)` fails → the catch logs the warning → the copied avatar remains on disk but no row references it.
- **Downstream impact:** Migration accumulates orphaned private files, and later avatar sweeps/backups may encounter unnecessary assets.

### M-029 — Route-id array is handled for loading but not deletion
- **Evidence:** `app/person/[id].tsx:79-82` explicitly normalizes `Array.isArray(id) ? id[0] : id` for loading, but `confirmDeletePerson()` uses `Number(id)` directly at lines 168-171.
- **Root cause:** Route parameter normalization is inconsistent across operations.
- **Failure mechanism:** Expo Router supplies an id array → profile loads the first id → delete sends `NaN` to the repository → no row is deleted → navigation still occurs as though deletion succeeded.
- **Downstream impact:** The person remains in the database while the UI reports completion, producing ghost profiles and misleading counts.

### M-030 — Existing-link no-op is reported as a successful link
- **Evidence:** `db/repositories/RelationshipRepository.ts:27-41` silently returns when an existing relationship is found. `app/person/[id]/relations.tsx:166-170` always emits `Connection linked` after the await because `add()` returns no status.
- **Root cause:** The repository’s “already exists” branch is indistinguishable from a successful insert at the call site.
- **Failure mechanism:** A duplicate-link race or stale available-person list reaches `add()` → repository does nothing → UI still announces success and closes the modal.
- **Downstream impact:** False success feedback, a relation type that may not have been changed, and confusion about why the graph does not reflect the attempted edit.

## Systemic Root-Cause Summary

The 78 findings are not 78 unrelated typos. They repeatedly originate from seven architectural weaknesses:

1. **Destructive work before validation or commit:** notification cancellation, asset replacement, avatar deletion, tag deletion, and table clearing all occur before success is known.
2. **False transaction boundaries:** a database transaction is used in some paths, but related filesystem, notification, settings, and aggregate operations fall outside it.
3. **Application-only uniqueness:** relationships, contacts, and person-group memberships rely on select-then-insert logic without database constraints.
4. **Unowned asynchronous work:** overlapping screen loads, refresh events, and focus transitions can publish stale responses over newer state.
5. **Fire-and-forget persistence:** settings, group callbacks, and roster mutations are not consistently awaited or rolled back.
6. **UTC/local calendar mixing:** date-only values pass through ISO/UTC parsing and are then compared with local components.
7. **Optimistic UI without failure states:** several screens immediately show success, close dialogs, disable controls, or clear errors before durable state is confirmed.

## Audit Completeness Notes

- Every defect in this report includes an exact source location, the responsible variable/function/phrase, a root cause, a step-by-step failure mechanism, and concrete downstream impact.
- The note editor itself and `components/ui/RichEditor.tsx` were intentionally excluded. Shared date, time, draft, avatar, group, and relationship components were included where they affect non-editor flows.
- No application source file was modified as part of this audit. The only created deliverable is this report.
- No sensitive configuration or `.env` content was read.

**End of report — 78 findings documented (9 Critical, 39 High, 30 Medium).**

