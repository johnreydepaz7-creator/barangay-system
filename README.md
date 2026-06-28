# Barangay Management System - User Guide
## AgentGuard!!

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
