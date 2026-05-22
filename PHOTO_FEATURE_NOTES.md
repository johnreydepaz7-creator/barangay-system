# Resident Profile Photo Feature

Install command used/needed:

```bash
npm install multer
```

Changed files:

- `package.json`
- `package-lock.json`
- `server.js`
- `middleware/upload.js`
- `models/member.js`
- `routes/members.js`
- `Dashboard/residents.html`

What was added:

- Resident photos are uploaded with Multer to `uploads/residents/`.
- Uploaded files are limited to 3MB.
- Only JPG, PNG, and WEBP files are accepted.
- Uploaded photos are served publicly through `/uploads`.
- Each resident document now has a `photo` field.
- New endpoints:
  - `POST /api/members/:id/photo`
  - `DELETE /api/members/:id/photo`
- Resident list now shows 36×36 circular thumbnails.
- Household detail modal now shows an 80×80 profile photo control with upload/remove buttons.
- Upload errors use `window.BrgyMessageBox.alert(message, 'error')`.
- Photo UI supports `body.dark` mode.
