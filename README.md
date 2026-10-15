# Phone Bill Splitter

Upload a Verizon bill PDF and get what each person owes.

- Lines that share a phone number (for example a watch on Number Share) are combined into one person.
- Account-wide charges (like Verizon Mobile Protect) are split evenly across the distinct phone numbers. Leftover cents go to the first numbers listed, so the shares add up to the bill exactly.
- The page checks that the line totals plus account-wide charges equal "This month's charges" on the bill and shows a warning if they don't.
- Everything runs in the browser; the PDF is never uploaded.

## Use it

Open `index.html` in a browser (or host the folder, e.g. with GitHub Pages) and choose your bill PDF. Click any person to see their line-by-line charges, and use **Copy summary** to paste the totals into a group chat.

## Hosting on GitHub Pages

`.github/workflows/pages.yml` publishes `index.html` and `billparser.js` on every push. To turn it on:

1. Make the repository public (Settings → General → Danger Zone → Change visibility), unless your GitHub plan includes Pages for private repositories. No bill data is stored in the repo; `*.pdf` is ignored.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Re-run the "Deploy to GitHub Pages" workflow from the Actions tab (or push a commit).

The site will be at `https://lsands65.github.io/verizonbill/`.

## Command line

```sh
npm install
npm run split -- path/to/MyBill.pdf
```

Prints each person's total and exits non-zero if the split doesn't match the bill's total.

## How it works

`billparser.js` reads the text of the "Charges by line details" pages with pdf.js. Each line starts with a header of the person's name and total, followed by the device and phone number; the "Account-wide charges & credits" total is read from the same section.
