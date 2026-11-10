# Moving to production: checklist

Last updated 2026-11-10. Everything today runs on **staging**, the test setup: `staging.caltracker.app` plus the staging database. Production is a separate, clean copy that Luis's real clients will use. It has its own database, its own keys, and the address `caltracker.app`.

How to read this list:
- **Who:** **You** = only the product owner can do it (it's your account or a payment). **Claude** = code or checks I do. **Both** = you click, then I verify.
- Never paste a key, password or token into the chat. Copy it straight to where it's needed, then tell Claude "done".
- The detailed plan behind this list is the 2026-11-06 go-live plan (`docs/superpowers/plans/2026-11-06-go-live.md` on branch `docs/coach-home-spec`). Some of it is already done. This file is the live copy.

## Already done ✅
- [x] Apple Developer account active; app "CalTracker Coaching" in App Store Connect; TestFlight builds working
- [x] Push notifications (Apple key, sending function, phone permission)
- [x] iPad-friendly coach website
- [x] Resend email domain `caltracker.app` verified (staging invites send from it)
- [x] Usage tracking (PostHog) on staging

## 1. Decisions needed from you first
- [x] **Privacy policy names "CalTracker" only** (no personal name), contact support@caltracker.app. Decided 2026-11-10.
- [ ] **Optional: register a business** if you want your name off Apple's App Store "Seller" line. Form an LLC or similar (~$50–300), get a free D-U-N-S number (1–2 weeks), then ask Apple to convert the developer account to Organization.
- [ ] **Production database region.** Staging is East US. Same, or closer to where Luis's clients live?
- [ ] **Who gets the daily error email?** For example, just you, or you and Luis.
- [ ] **Client deletes their account:** should Luis get an email telling him?
- [ ] **Coach closes their workspace:** what happens to their clients? (Suggested: clients get an email and lose access.)
- [ ] **Luis's exercise library:** copy everything from staging to production, including YouTube links and his notes?
- [ ] **Keep a separate staging app on your phone?** It would be a second icon, "CalTracker Test", next to the real app. Yes/no.
- [ ] **`www.caltracker.app`:** redirect to `caltracker.app`? (Suggested: yes.)
- [ ] **Email limit:** Resend's free plan allows 100 emails a day. Is that enough at launch, or upgrade (~$20/month)?
- [ ] **Which tracking project for production:** a new PostHog project "CalTracker Prod", or the same one with a label?

## 2. Code to build (Claude)
- [ ] **Delete my account** in the phone Settings (Apple requires this). It erases the client's workouts, meals, photos, messages and stickers. Coaches close accounts by email.
- [ ] **Privacy policy and terms pages** at `caltracker.app/privacy` and `/terms`, linked from sign-in on web and phone. You review the wording before launch.
- [ ] **Help & feedback** button on the phone and the website, which opens an email to `support@caltracker.app`.
- [ ] **Error alerts:** errors from the phone, the website and the server get saved, and you get one email a day when something broke, plus an alert if errors spike.
- [ ] **Production deploy pipeline:** the same deploy as staging, pointed at production, which can only be started by hand from `main`.
- [ ] **Phone app built for production:** the TestFlight build points at the production database.
- [ ] **Library copy tool:** copies Luis's exercises and programs from staging to production. It runs as a dry run first, then applies after your OK.
- [ ] **Admin dashboard on production** at `admin.caltracker.app`: it runs on the staging database until go-live; switch it as in `docs/runbooks/admin.md` ("Switching to production").

## 3. Accounts and settings (you, with Claude's step-by-step help)
- [ ] **Supabase:** create project `caltracker-prod` on the **Pro** plan (~$25/month, includes daily backups).
  - Then copy its keys into GitHub secrets.
  - Set: site URL `https://caltracker.app`, minimum password 8, email (SMTP) settings and email templates the same as staging, two-step sign-in (TOTP) on for the admin site.
- [ ] **Resend:** make a new production API key and put it in GitHub plus Supabase email settings.
- [ ] **Cloudflare:**
  - check nothing already uses the bare `caltracker.app` address;
  - add the DMARC email record;
  - turn on Email Routing so `support@caltracker.app` forwards to your inbox.
- [ ] **GitHub secrets:** the `PROD_…` list in the go-live plan (database URL, keys, project ref, password, Resend key, function secret, error email recipients).
- [ ] **Push on production:**
  - Claude sets the same Apple push key on the production database;
  - Claude creates the two push secrets in production Vault, which you OK first.
- [ ] **PostHog:** a production project key, if you chose a new project in step 1.
- [ ] **App Store Connect:**
  - fill in App Privacy (the answers are in the go-live plan);
  - Privacy Policy URL;
  - Support URL.

## 4. First production launch (both)
- [ ] Run **Deploy production**. Then Claude checks:
  - `caltracker.app` shows the sign-in page;
  - staging is unchanged;
  - the scheduled jobs exist;
  - about 870 exercises are loaded;
  - new accounts default to lb.
- [ ] Create a smoke-test coach. "Forgot password" email arrives from `caltracker.app` and the link works.
- [ ] Send a test error and receive the error email once.
- [ ] Test account deletion on production with a test client. Claude confirms no data is left.
- [ ] Copy Luis's library (dry run, then your OK, then apply). Luis checks it.
- [ ] Create Luis's real production coach account, with your OK.
- [ ] Make you the owner on the production admin dashboard and set up two-step sign-in.

## 5. Getting the app to clients
- [ ] Upload a production TestFlight build.
- [ ] Create a TestFlight **External** group, "Clients", with "What to test" text.
- [ ] Give Apple a **review sign-in**: a test client with one workout. Claude creates it, and you type the password into App Store Connect.
- [ ] Submit for Beta App Review (about a day). Once approved, turn on the **public link** and share it only with clients.
- [ ] Add Vaishali (vaishali.kohli@gmail.com) as a tester. Her activity counts.

## 6. Dry run, then launch
- [ ] **One week of dry run:** you, Luis and 2–3 friendly clients use production. Fix what they find.
- [ ] Remove the "draft" note from the privacy and terms pages after you've read them.
- [ ] Look at the monthly costs: two Supabase Pro projects, and whether to pause staging between test sessions.
- [ ] **Launch:** Luis invites his clients. 🎉

## Before a second coach joins (not needed for Luis)
- [ ] Decide how a client chooses when two coaches invite the same email (open question 10 in the main spec).
- [ ] Coach billing ($29 / $39 / $49 tiers on the website) and coach self sign-up.
