# Expense Reports app

A free app for Android and iPhone. Snap a receipt and the app reads it and fills in the expense form. On Friday, tap **Send week** to email yourself the Excel report with every receipt photo attached.

- **Costs nothing.** No subscriptions, no AI fees, no server.
- **Private.** Receipts stay on your phone until you send them. The website only hosts the app's files and never sees anyone's data.
- **Works offline** after the first time you open it.
- **Files use the WE naming**, for example `WE 11-28-26 Jane Smith.xlsx` and `WE 11-28-26 Receipt 01.jpg`. The email subject reads `Expense Report WE 11/28/26 – Jane Smith`. File names can't contain "/", so they use dashes.

---

## 1. Put the app online (one time, about 10 minutes, free)

You need a free GitHub account. GitHub Pages hosts the app for free.

1. Go to <https://github.com> and create a free account.
2. Click **+ → New repository**. Name it `expenses`, choose **Public**, and click **Create repository**.
   - Public only means the app's *code* can be seen. Nobody's expenses are ever uploaded.
3. Click **uploading an existing file**. Drag in **everything inside this `expense-app` folder**: `index.html`, `styles.css`, `sw.js`, `manifest.json` and the `js`, `vendor` and `icons` folders. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, pick **main** and **/(root)**, then click **Save**.
5. After a minute or two the page shows your link, for example `https://YOUR-NAME.github.io/expenses/`.

Text or email that link to everyone at the company.

## 2. Install it on each phone

**Android (Chrome)**
1. Open the link in Chrome.
2. Tap **⋮ → Add to Home screen** (or **Install app**).

**iPhone (Safari: it must be Safari)**
1. Open the link in Safari.
2. Tap the **Share** button (□↑), then **Add to Home Screen**.
3. Always open the app from the home screen icon. iPhone can clear data from websites opened in a normal Safari tab, but not from installed home-screen apps.

On first open, enter your **name** and **work email** in Settings. Defaults: the week ends **Saturday** (that is the WE date) and the report is sent **Friday**. Both can be changed in Settings.

## 3. Weekly use

1. **Every receipt:** tap **📷 Add Receipt** and take the photo. The app fills in the total, date, merchant and category. Check them, add a purpose (for example "Fuel – truck 12") and tap **Save**.
   - Lay the receipt flat in good light for the best reading.
   - If the numbers don't add up, a yellow warning appears so you can double-check.
   - **No receipt?** Use **✏️ No receipt** to enter one by hand.
2. **Friday:** tap **📧 Send week**, then **Share to email**, and pick **Outlook**. The Excel file and photos are already attached. Send it to your work email.
3. Come back and tap **✅ Mark as sent**. That week moves to **History**, where you can share it again any time, and a new week starts.

Set a weekly Friday alarm on your phone as a reminder. The app also shows a banner on Fridays.

## What's in the Excel file

- **Sheet 1, Expense Report:**
  - name, email and the WE date
  - one row per receipt: Receipt #, date, merchant, category, purpose, paid with, subtotal, tax, tip, total and notes
  - grand total and totals by category
  - **amount to reimburse** (anything paid with a personal card or cash)
  - signature and approval lines
- **Sheet 2, Receipts:** a picture of every receipt, labelled to match the Receipt #.

## Backups

Expenses live only on the phone. Use **Settings → Download backup** before you switch phones, and **Restore from backup** on the new phone.

## Updating the app later

Change the files, bump `VERSION` in `sw.js` (for example `'v2'`), and upload again to GitHub. Phones pick up the update the next time the app is opened twice.

---

### For whoever maintains it

- This is plain HTML and JavaScript with no build step. The libraries are bundled in `vendor/`, so the app needs no outside services:
  - Tesseract.js 5.1.1 (Apache-2.0) for on-device receipt reading, with English data in `vendor/lang`
  - ExcelJS 4.4.0 (MIT) for building the spreadsheet
- `js/parse.js` holds the rules that pull the total, date, merchant, tax, tip and category out of the scanned text. Add store names to `CATEGORY_RULES` to improve automatic categories.
- Tests: `npm test`. These are plain Node tests with no install needed.
- To try it locally, run `python3 -m http.server` in this folder and open `http://localhost:8000`.
