# Barangay Management System - User Guide

This is the single guide file for the Barangay Management System project.

## Quick Start

After extracting the ZIP file:

1. Open the extracted project folder.
2. Double-click `RUN_SYSTEM.bat`.
3. Wait for it to install dependencies on first run.
4. The system will automatically open in your default browser at:

```text
http://localhost:3000/
```

You may also double-click `START_SYSTEM.bat` if you prefer a shorter launcher name.

## Important Requirements

Before running the system, make sure the computer has:

- Node.js installed
- npm installed
- Internet connection during the first run for `npm install`
- MongoDB connection string configured in `.env`

## Environment Setup

Open or create the `.env` file in the main project folder.

Use this format:

```env
MONGODB_URI=your-mongodb-uri
PORT=3000
```

The File Manager uses MongoDB GridFS, so no Google Drive or Cloudinary account is needed.

## Portable Running

The project can run from any extracted location, such as:

- Desktop
- Documents
- Downloads
- USB drive
- Another local drive

Important: keep `RUN_SYSTEM.bat` inside the same folder as `server.js` and `package.json`.

## Launcher Behavior

When `RUN_SYSTEM.bat` is double-clicked, it will:

1. Check if Node.js and npm are installed.
2. Check if the system is already running.
3. Install dependencies automatically if `node_modules` is missing.
4. Start the server.
5. Open the system in the default browser.

If dependencies are already installed, the launcher skips `npm install` and starts the system faster.

## Manual Run Commands

If you want to run manually using Command Prompt:

```bash
cd "path-to-project-folder"
npm install
npm start
```

If the dependencies are already installed, use only:

```bash
npm start
```

## Session Management

The system session timeout is set to 10 minutes of inactivity.

Behavior:

- Warning appears after 9 minutes of inactivity.
- User has 1 minute to click Keep Session Active.
- Forced logout happens after 10 minutes of real inactivity.
- Moving between modules counts as activity.
- Clicking, typing, scrolling, and opening modules refresh the session.

## Activity Logs

Activity Logs display only important user activity:

- Login
- Logout
- Create actions
- Read/View actions related to data
- Update/Edit actions
- Delete/Reject actions

Page navigation logs and unnecessary noise logs are not shown.

## Backup and Recovery

Backups are saved in two places:

1. PC/server backup folder
2. MongoDB GridFS backup copy

Default Windows backup location:

```text
C:\Users\<your-user>\Documents\Barangay Management System\Backups
```

The system keeps only the latest 10 backups.

When backup count becomes more than 10:

- The oldest PC/server backup is deleted.
- The oldest MongoDB backup copy is deleted.
- The latest 10 backups remain.

## Backup Contents

The backup includes:

- Households
- Members
- Accounts
- Activity logs

## Recent Backups Display

Recent Backups will still display a backup if at least one copy exists.

Possible status:

- PC/server + Database
- PC/server only
- Database only

If the PC/server copy is missing but the database copy exists, the backup still appears.
If the database copy is missing but the PC/server copy exists, the backup still appears.

## Import Backup File and Restore

If both system backup copies are missing, but you still have your own backup file copy, use:

```text
Import Backup File & Restore
```

This allows you to select a `.tar.gz` backup file from your PC and restore it.

After restore, the imported backup is saved again to:

- PC/server backup folder
- MongoDB GridFS backup copy, if available

## File Manager Storage

The File Manager uses MongoDB GridFS as online storage.

This means:

- Uploaded files are stored in MongoDB.
- Folders and files are managed inside the system.
- No Google Drive setup is required.
- No Cloudinary setup is required.

## File Manager Video Upload Restriction

Video uploads are temporarily disabled to save MongoDB storage.

Blocked examples:

- `.mp4`
- `.mov`
- `.avi`
- `.mkv`
- `.webm`
- `.wmv`
- `.flv`
- `.3gp`
- `.mpeg`
- `.mpg`
- `.ts`

The system blocks videos on both:

- Frontend/browser upload
- Backend/server validation

Even if a user bypasses the browser, the server still rejects video files.

## MongoDB GridFS Storage Limit Reminder

If you are using MongoDB Atlas Free Tier, storage is limited.

Typical free tier storage is about:

```text
512 MB / 0.5 GB total
```

This total can include:

- Database collections
- File Manager files
- Backup copies stored in GridFS
- Indexes and metadata

For this reason, avoid uploading large files and videos.

## Designed Message Boxes

The system uses designed modal message boxes instead of plain browser alerts.

Included message box types:

- Success
- Error
- Warning
- Confirmation
- Prompt/input
- Logout confirmation
- Delete confirmation
- Backup and restore confirmation

## Project Cleanup Notes

The cleaned project removed unnecessary files such as:

- `node_modules`
- duplicate test files
- unused environment files inside subfolders
- unused local storage setup notes
- old setup notes split across multiple markdown files

All markdown documentation has been consolidated into this single `README.md` file.


## Latest Update Documentation

This section compiles the update notes into one documentation file so the project no longer needs separate update note files.

### Browser Size Responsive Fix

Changes made:

1. Added stronger responsive CSS overrides for all dashboard pages.
2. The layout now adjusts properly when the browser is resized.
3. At smaller browser widths, the sidebar becomes a horizontal menu under the top bar.
4. Content cards, document cards, overview cards, forms, and file manager grids now shrink and stack properly.
5. Search bars, dropdown filters, buttons, and toolbars now wrap instead of overflowing.
6. Tables remain usable through horizontal scrolling instead of breaking the whole page layout.
7. The same responsive rules were copied to the normal dashboard and dark-mode dashboard folders.

Important notes:

- Generated documents remain in light/normal mode.
- The direct Save as PDF button remains removed. Use Print Document, then choose Save as PDF in the browser print dialog when a PDF copy is needed.

### PDF and Generated Document Fixes

Changes made:

- Generated document pages always stay in light/normal mode.
- Save as PDF behavior was replaced with the browser Print dialog to avoid broken text spacing.
- Canvas/image PDF generation was removed because it caused spacing issues.
- Print styling was updated for Clearance, Certification, Indigency, Summons, and Complaint documents.
- Certificate of Indigency spacing was fixed by using real text print styling and removing problematic text-rendering settings.
- Mobile/narrow-browser alignment was improved so page controls stack properly without overflowing.

### Barangay Logo Watermark Update

Generated document pages now include the barangay logo as a transparent background/watermark.

Updated document templates:

- `Dashboard/certification.html`
- `Dashboard/clearance.html`
- `Dashboard/indigency.html`
- `Dashboard/summons.html`
- `Dashboard/complaint.html`

The dark-mode document links redirect to the normal/light document templates, so the watermark is also used when documents are generated from dark mode. The watermark uses `images/barangay-logo.png` at low opacity so the document text remains readable when printed or saved as PDF.

### Back to Form Reset Update

Generated document Back to Form buttons now open `doc-form.html` with `reset=1`. When this reset flag is present, the document form clears:

- text inputs
- dates
- textareas
- select fields
- selected resident cards
- resident dropdown data

This reset behavior also works when the browser restores the page from the back-forward cache.

## Troubleshooting

### Cannot find module express

Run:

```bash
npm install
```

Then run:

```bash
npm start
```

### npm install fails because of wrong registry

Run:

```bash
npm config set registry https://registry.npmjs.org/
npm config delete proxy
npm config delete https-proxy
npm cache clean --force
```

Then try again:

```bash
npm install
```

### Port 3000 already in use

Close the existing server window, or run:

```bash
npm run fix-port
npm start
```

### MongoDB not connected

Check the `.env` file and make sure `MONGODB_URI` is correct.

## Current Main Features

- Role-based login/dashboard flow
- Residents/household management
- Activity logs shared across users
- CRUD/login/logout-only activity display
- Backup and recovery
- Backup limit of latest 10
- Import backup restore
- File Manager using MongoDB GridFS
- Video uploads blocked
- 10-minute inactivity timeout
- Designed message boxes
- One-click portable Windows launcher


## Latest Update — Document files replaced

The document-generation files were replaced with the edited files supplied by the user. The replacement was applied to both `Dashboard/` and `system-darkmode/` document files. Generated documents continue to read resident information from `/api/members`, so the document forms remain dependent on the Residents data.


## Update: Summons Empty Underline Fix

The Summons document now removes the long underline for empty optional fields such as the second “For” line and second “On” line. The bottom “On” field in the Officer’s Return section is also automatically filled from the hearing date and time when those values are provided.

## Update: Complaint Complainant Display Match

The Complaint document now shows the same complainant names in the `(Complainant/s)` signature area as the `Complainant/s:` section, while still pulling names from the resident records when selected from the resident database.

### Complaint empty complainant signature line fix
- Removed the underline under `(Complainant/s)` when a complainant name is not filled.
- Empty complainant signature rows now render as blank space only, while filled complainant names still display normally.


### Complaint underline length update
- Replaced `complaint.html` using the uploaded document file.
- Shortened the `To:` underline width.
- Shortened the `Complainant/s:` and `Respondent/s:` underline width in the complaint case section.
- Kept resident data lookup through `/api/members` for generated documents.
