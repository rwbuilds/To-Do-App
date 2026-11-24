# Syncing Jot between the Mac and the Windows PC

Status: built in 1.7.0. Settings > Data > Sync between computers. The decisions below are
recorded under "Decisions" at the end, and where the build differs from this proposal it says so.

## The problem

Each machine keeps all of Jot's data as one JSON value in the app's local storage. Today that's
about 85 KB: 79 tasks and 25 notes. The only way to move data between the Mac and the PC is to
export a backup on one and restore it on the other, and a restore replaces everything on the
second machine.

The goal is for a change on either machine to show up on the other within a few minutes, with
no server, and with no sync step that can wipe data.

## Approach: a shared cloud folder

Both machines point Jot at the same folder in a cloud drive. Each machine writes only its own
file there, reads the other machine's file, and merges it into its own data.

Other options I looked at:

- A server with sign-in. It works, but it means hosting, accounts and running costs, plus far
  more code than two machines need.
- One shared file that both machines write. When both write within the drive's upload window,
  the drive keeps one copy and renames the other as a conflict copy. Jot would have to find and
  merge those copies anyway, so it's simpler to give each machine its own file from the start.
- Git. It needs git on both machines, and recovering from a merge conflict needs someone who
  knows git.

## What Jot has to start recording

The current data can't be merged safely. The code shows three gaps:

1. Tasks don't record when they last changed. They have `createdAt` and `completedAt` only.
   Notes already have `updatedAt`.
2. Deleting leaves no trace. A delete splices the record out of the list, and Undo puts the same
   object back within 5 seconds. During a merge, a task deleted on the Mac but still present on
   the PC looks exactly like a task the PC just added, so it would come back.
3. Manual order is the position in the array, and subtasks are plain `{ text, done }` pairs
   with no IDs.

The fixes:

- Every task gets `updatedAt`, stamped in one place. `saveData` compares each record with the
  version it saved last time and stamps the ones that changed. About 50 places call `saveData`,
  and stamping inside it covers every one of them, including ones added later.
- A `deleted` list maps each removed ID to the time it was removed. The same comparison fills it
  in: an ID that was there last time and is gone now was deleted. Undo puts the ID back, which
  counts as a change, so the restored task is newer than its own deletion and wins. Entries
  older than 90 days are dropped. A machine that's been offline longer than that could bring a
  deleted item back. That's the cost of not keeping deletions forever.
- Subtasks merge as part of their task. If both machines change the subtasks of one task between
  syncs, the later change wins for the whole list. Giving subtasks IDs would fix that, but it
  touches every subtask code path, and two-machine edits to one task's subtasks should be rare.
- Order: the order from whichever machine reordered last wins. Tasks the other machine added go
  to the top, which is where new tasks go today.
- Groups and sections are lists of names, and tasks point at them by name. Jot can delete a
  group or section but can't rename one, so names are stable. They merge as a union, and
  deletions go in the `deleted` list like tasks. Deleting a group already moves its tasks out
  of it (`deleteGroup` clears each task's group and section), and those task changes sync like
  any other edit.

This step is useful on its own and changes nothing you can see, so it can ship in a normal
release before any sync code exists.

## The folder

```
Jot Sync/
  jot-<device id>.json    one file per machine, written only by that machine
```

Each file holds the same data as a backup, plus a format version, the device's ID and name
("Mac" or "Windows"), when the file was written, the `deleted` list, and when the order last
changed.

Each machine makes its device ID once and keeps it in `jot-settings.json`, which holds the window
size and the widget's position and never syncs.

Writing: after a save, Jot waits about 5 seconds for more changes, then writes its file the same
way the daily backup does, to a temp file first and then renamed. It also writes when Jot quits.

Reading: when Jot starts, when its window gets focus, every 3 minutes, and when the folder reports
a change. Node's documentation says `fs.watch` isn't fully consistent across platforms, and cloud
drives add their own delays, so the timer is the part to rely on.

## Merging

For each task and note:

- If only one side has it, keep it, unless the other side's `deleted` list has it with a later
  time.
- If both sides have it, the one with the newer `updatedAt` wins. The device ID breaks a tie.

Notes get one more rule. If both machines edited the same note since they last synced, the newer
version wins and the other becomes a separate note titled "(title) (conflict from Windows)".
Losing a paragraph is worse than deleting a duplicate. Tasks are short, so the newer edit wins.

A note that's open in the editor isn't touched until you close it. Jot saves what you've typed
first (the `flushNoteSave` added in this release), and merges that note once the editor closes,
so text never changes under your cursor.

Settings don't sync in the first version. Some only make sense per machine, like widget opacity
and collapsing on click-away, and the theme is set once.

## Safety rules

- Before a merge that changes anything, Jot writes a backup to
  `backups/jot-before-sync-<time>.json` and keeps the last 10.
- Only a `deleted` entry can remove something. A record that's missing from the other file is
  never treated as deleted, so an empty, cut-off or out-of-date file can add things but can't
  remove them.
- The other machine's file goes through `migrateData`, the same checks a restore uses since this
  release's backup fix. Anything that can write to the cloud folder can write that file, so Jot
  treats it like a backup from someone else.
- A file with a newer format version than this build understands is skipped, with a message to
  update Jot. The Windows build updates itself and the Mac build is rebuilt by hand, so the two
  machines can run different versions.
- Both iCloud Drive and OneDrive can keep files online-only and download them when opened. A read
  that fails or takes too long means "try again later", never "the file is empty".
- Both macOS and Windows set the clock from the network by default, so small clock differences
  don't matter. Two edits to one task on different machines a few seconds apart could go either
  way.

## Settings screen

One Sync row: Choose folder…, Stop syncing, and a status line such as "Synced 2 min ago with
Windows" or the last error.

## Build order

1. Change tracking: `updatedAt` on tasks and the `deleted` list, with tests. Ships alone. Small.
2. The merge, as a plain function that reads no files. Tests cover adds, edits and deletes on each
   side, both machines editing one note, a task deleted on one machine and edited on the other,
   Undo after a delete, an empty or cut-off file, and a file carrying the bad values from the
   backup tests. Medium.
3. Reading and writing the folder in `main.js`, the bridge in `preload.js`, and the Settings row.
   The tests run two copies of Jot's page with separate storage against a temporary folder.
   Medium.
4. Backups before merges, conflict copies, and the status line. Small.

After that, a trial on both machines with a new, empty folder, after exporting a backup on each.

## Decisions

1. Cloud drive: any. Settings lists the drives this computer has (iCloud Drive, OneDrive personal
   and work, Google Drive, Dropbox, Box), found where each app keeps its folder, plus "Other
   folder…" for anything else. Jot makes a "Jot Sync" folder in the chosen drive. Both computers
   have to pick the same drive. The page only sends back the drive's number in that list, never a
   path. Whether work information is allowed in a given drive is still the user's call; Settings
   says so.
2. Both computers edited the same item: the newer version wins, and the conflict is flagged. A
   banner says what happened, and Settings > Data > Review conflicts lists each one with both
   versions: "Use the other version", "Keep both" (notes) or "Dismiss". An item deleted on one
   computer after it was edited on the other is flagged the same way, with "Restore it". Before
   the first sync there's no record of who changed what, so only notes are flagged then; tasks
   quietly take the newer version.
3. Settings and themes stay per computer. The sync folder, the computer's sync ID and the window
   position live in jot-settings.json, which never syncs.
4. Shipped all at once in 1.7.0, not in steps.

Other differences from the proposal: Restore and Reset aren't treated as deletes (a restore on one
computer can't wipe the other), group, section and folder names record when they were added, and a
merge waits while you're typing in a task editor or search box.
