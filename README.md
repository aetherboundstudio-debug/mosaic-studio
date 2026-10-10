# Mosaic Studio — first prototype

A friendly, phone-first creative studio prototype inspired by the idea of bringing creative tools together in one app.

## What works in this first version

- **Photo edit:** open a photo, adjust brightness, contrast and color, then download a PNG.
- **Draw:** draw with touch or a mouse, add simple shapes and text, undo, clear and download a PNG.
- **Page design:** change a poster's headline, caption and colors, then download an SVG.
- **Motion:** preview animated text and download a small animated HTML preview.
- **Video:** preview a local clip and mark a start/end section. This prototype does not render/export an edited video yet.
- **PDF:** open a local PDF in the browser's built-in viewer and save a note. Combining or editing pages is not included yet.
- **My projects:** save project names and notes in this browser's local storage.

Your photos, videos and PDFs are opened locally in your browser; this prototype does not upload them. The project list stores names/notes, not copies of your media files.

## Publish it with GitHub Pages (no command line needed)

1. Sign in at **github.com** and create a new repository named `mosaic-studio`.
2. On the new repository page, choose **Add file → Upload files**. Upload the files inside this project folder, including `index.html`, `manifest.webmanifest`, `service-worker.js`, and both `icon-*.png` files. Commit the upload to the `main` branch.
3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select branch **main** and folder **/(root)**, then press **Save**.
4. After GitHub finishes publishing, your page will be at `https://YOUR-GITHUB-USERNAME.github.io/mosaic-studio/` (replace the username with your GitHub username).
5. Open that page in **Chrome on your Android phone**, tap **⋮**, then choose **Install app** or **Add to Home screen**.

If you only have a phone and the upload steps are awkward, ask someone with a computer to help with the one-time GitHub upload. After that, the app opens from the link above.

## Important

This is an early installable web-app prototype, **not yet a Play Store APK or a finished professional editing suite**. A native Android build and deeper video, PDF, RAW-photo and layout tools can come later, step by step.
