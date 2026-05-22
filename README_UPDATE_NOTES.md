# Update Notes: Unified Design Cleanup

Applied fixes:

1. Consolidated messagebox.js into one shared root file: `/messagebox.js`.
2. Updated messagebox info/default color to Barangay green `#2f7d4f` and added `body.dark` styles.
3. Updated Login auth tokens to use the Dashboard naming convention and DM Sans font.
4. Removed the duplicated `system-darkmode/` folder.
5. Dashboard dark mode now uses `body.dark` with shared CSS overrides and local/session storage theme state.
6. Removed the old `/system-darkmode` static route from `server.js`.
