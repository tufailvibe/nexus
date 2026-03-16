# Publish `nexus` to GitHub

## Recommended path

Use **GitHub Desktop** because Git is not installed on this machine right now.

## Steps

1. Open GitHub Desktop.
2. Choose **Add an Existing Repository from your hard drive**.
3. Select `C:\Users\mohdt\Desktop\nexus`.
4. If GitHub Desktop asks to create a repository, confirm it.
5. Review the changed files and create the first commit, for example: `Initial public-safe source snapshot`.
6. Click **Publish repository**.
7. Keep the repository **Public** if recruiters should be able to see it.

## Update an existing GitHub repo

If the repository is already published and you only want to send the latest cleaned version:

1. Open GitHub Desktop with `nexus` selected.
2. Go to the **Changes** tab.
3. In **Summary**, type: `Final public-safe cleanup`
4. Click **Commit to main**.
5. Click **Push origin** at the top.
6. Open **View on GitHub** and refresh the page.

## Before publishing

- Confirm `node_modules`, `dist`, `release`, and `NEXUS DELIVERY` are not present.
- Confirm no customer PDFs or private database files were added.
- Confirm the screenshots in `docs/screenshots/` are okay for public viewing.
- Confirm the author name in `package.json` and `LICENSE` matches the public name you want to show.

## After publishing

- Put the GitHub repo link on your CV and LinkedIn.
- Pin the repository on your GitHub profile.
- Optionally add a GitHub Release later if you want recruiters to download an installer.
