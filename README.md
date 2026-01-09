# TrackerLab Website (Project: TracerLab)

Scientific, credible, minimalist, data-driven site for research partners, weather-tech companies, government agencies, and academic collaborators.

## Structure
- `index.html`: Homepage with Mission, Capabilities, and Contact
- `styles.css`: Minimalist responsive theme

## Run locally
Open `index.html` directly in your browser, or serve the folder:

### PowerShell (Windows)
```powershell
cd website
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Deploy

### GitHub Pages (Recommended)
1. Push this repository to GitHub
2. Go to repository Settings → Pages
3. Under "Source", select the branch (usually `main` or `master`)
4. Under "Folder", select `/website`
5. Click Save
6. Your site will be live at `https://username.github.io/repository-name/`

### Other Hosting Options
- Netlify: Drag-and-drop the `website/` folder or connect your repo
- Cloudflare Pages: Set build output directory to `website/`
- Any static host (S3 + CloudFront, Firebase Hosting, etc.)

## Customization
- Update colors and typography in `styles.css`
- Add logos or hero imagery as needed (optimize for performance)
- Add analytics or additional metadata in `index.html`

