# Mediavine Journey Sellers Tracker

A static, serverless, zero-maintenance tracker for every website listed in Mediavine Journey's public `sellers.json` feed.

Mediavine Journey publishes an ads.txt-standard feed at [https://sellers.journeymv.com/sellers.json](https://sellers.journeymv.com/sellers.json). Because the raw feed contains no "date added" field and publisher domains may change or churn, this repository tracks domain additions, churn, and reactivations over time.

---

## 📁 Repository Structure

```text
├── .github/workflows/
│   └── update-sellers.yml      # Daily cron job (07:00 UTC) with git commit & push
├── scripts/
│   ├── update_sellers.py       # Daily fetch & diff engine (Python 3 stdlib only)
│   └── seed_from_historical.py # One-time bootstrap importer for historical dates
├── data/
│   ├── sellers.csv             # Master dataset (Source of Truth)
│   ├── historical_seed.csv     # Historical domain addition dates
│   └── last_run.json           # Daily metrics, run timestamp & diff stats
├── docs/
│   ├── index.html              # GitHub Pages live dark-mode data viewer
│   └── sellers.csv             # Copy served directly to GitHub Pages
└── README.md
```

---

## 📊 Dataset Schema (`sellers.csv`)

| Column | Type | Description |
| :--- | :--- | :--- |
| `seller_id` | `string` | Unique seller identifier from Mediavine feed (or `legacy:<domain>`). |
| `domain` | `string` | Normalized website domain (e.g. `example.com`). |
| `name` | `string` | Registered publisher or company name. |
| `seller_type` | `string` | `PUBLISHER`, `INTERMEDIARY`, or `BOTH`. |
| `first_seen` | `YYYY-MM-DD` | Date when the domain was first observed or imported. |
| `last_seen` | `YYYY-MM-DD` | Date when the domain was most recently confirmed in live feed. |
| `removed_on` | `YYYY-MM-DD` | Date domain disappeared from feed (`""` if active, `"pre-tracking"` if churned prior to tracking). |
| `date_source` | `string` | `historical_import`, `tracker`, or `tracker_seed`. |

### Date Sources Explained
- **`historical_import`**: Date taken from verified historical dataset records.
- **`tracker`**: Date automatically discovered when the daily GitHub Actions cron detected the new seller ID.
- **`tracker_seed`**: Baseline seed date assigned to sellers present when the tracker was initialized.

---

## 🚀 Setup & Deployment Instructions

### Step 1: Push Repository to GitHub
Create a new GitHub repository and push this codebase:
```bash
git init
git add .
git commit -m "feat: initial journey sellers tracker"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
git push -u origin main
```

---

### Step 2: Configure GitHub Actions Workflow Permissions
To allow the daily workflow to commit updated CSV files back to your repository:
1. On GitHub, navigate to **Settings** → **Actions** → **General**.
2. Scroll to **Workflow permissions**.
3. Select **Read and write permissions**.
4. Check **Allow GitHub Actions to create and approve pull requests**.
5. Click **Save**.

---

### Step 3: Enable GitHub Pages
To host the live interactive browser UI:
1. Navigate to **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select **Deploy from a branch**.
3. Set Branch to **`main`** and folder to **`/docs`**.
4. Click **Save**.
5. Your viewer will be live at `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`.

---

### Step 4: Run Initial Seed (One-Time Bootstrap)
If you haven't already run the bootstrap seed locally, you can run:
```bash
python3 scripts/seed_from_historical.py
git add data/ docs/
git commit -m "chore: bootstrap dataset with historical seed"
git push
```
*Note: `seed_from_historical.py` is protected and will refuse to overwrite real tracking data once records exist (unless `--force` is supplied).*

---

### Step 5: Manual Trigger (Optional)
You can test the daily workflow anytime:
1. Go to the **Actions** tab on GitHub.
2. Click **Update Journey Sellers Feed** on the left.
3. Click **Run workflow** → **Run workflow**.

---

## ⚡ Daily Cron Automation
The GitHub Action runs automatically every day at **07:00 UTC**.
- If no new or removed sellers are detected, no commit is generated.
- If changes occur, the bot commits with a concise summary:
  `Sync sellers.json: 2450 total (2380 active), +3 new, -1 removed, ~0 reactivated`
