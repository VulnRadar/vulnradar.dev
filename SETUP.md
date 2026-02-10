# VulnRadar Setup Checklist

Use this checklist to set up VulnRadar from scratch. Check off items as you complete them.

## Prerequisites

- [ ] Node.js 18.17+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Git installed

## Initial Setup

- [ ] Clone repository: `git clone https://github.com/your-username/vulnradar.git`
- [ ] Navigate to directory: `cd vulnradar`
- [ ] Install dependencies: `npm install`

## Database Setup (Choose One)

### Option A: Local PostgreSQL
- [ ] PostgreSQL installed and running
- [ ] Database created: `createdb vulnradar`
- [ ] Connection string: `postgresql://vulnradar:password@localhost:5432/vulnradar`

### Option B: Docker
- [ ] Docker installed and running
- [ ] Container started: `docker run -d --name vulnradar-db -e POSTGRES_USER=vulnradar -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=vulnradar -p 5432:5432 postgres:16`
- [ ] Connection string: `postgresql://vulnradar:yourpassword@localhost:5432/vulnradar`

### Option C: Hosted Database (Recommended)
- [ ] Account created at [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app)
- [ ] Database created
- [ ] Connection string copied
- [ ] Remember to set `DATABASE_SSL=true` in `.env.local`

## Email Setup (Choose One)

### Option A: SendGrid (Recommended)
- [ ] Account created at [SendGrid](https://sendgrid.com)
- [ ] API key generated (Settings → API Keys)
- [ ] SMTP relay enabled
- [ ] Credentials:
  - Host: `smtp.sendgrid.net`
  - Port: `587`
  - User: `apikey`
  - Pass: Your API key

### Option B: Gmail
- [ ] 2-Step Verification enabled on Google Account
- [ ] App password generated at [App Passwords](https://myaccount.google.com/apppasswords)
- [ ] Credentials:
  - Host: `smtp.gmail.com`
  - Port: `587`
  - User: Your Gmail address
  - Pass: Your 16-character app password

### Option C: ProtonMail
- [ ] ProtonMail account with paid plan
- [ ] ProtonMail Bridge installed and running (or app password generated)
- [ ] Credentials:
  - Host: `smtp.protonmail.ch` (or `127.0.0.1:1025` for Bridge)
  - Port: `587`
  - User: Your ProtonMail address
  - Pass: Your Bridge password or app password

### Option D: Mailgun
- [ ] Account created at [Mailgun](https://mailgun.com)
- [ ] Domain verified
- [ ] SMTP credentials from Sending → Domain Settings → SMTP credentials
- [ ] Credentials:
  - Host: `smtp.mailgun.org`
  - Port: `587`
  - User: From dashboard
  - Pass: From dashboard

## Cloudflare Turnstile Setup

- [ ] Account created at [Cloudflare](https://cloudflare.com)
- [ ] Navigate to [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
- [ ] Click "Add Site"
- [ ] Enter site name (e.g., "VulnRadar")
- [ ] Choose "Managed" challenge mode
- [ ] Add domains:
  - [ ] `localhost` (for testing)
  - [ ] Your production domain (e.g., `vulnradar.dev`)
- [ ] Copy Site Key (public)
- [ ] Copy Secret Key (private)

## Environment Variables

- [ ] Copy example file: `cp .env.example .env.local`
- [ ] Edit `.env.local` with your values:

### Database
- [ ] `DATABASE_URL` = Your PostgreSQL connection string
- [ ] `DATABASE_SSL` = `true` if using hosted database, `false` if local

### SMTP
- [ ] `SMTP_HOST` = Your SMTP server hostname
- [ ] `SMTP_PORT` = `587` (or your provider's port)
- [ ] `SMTP_USER` = Your SMTP username/email
- [ ] `SMTP_PASS` = Your SMTP password/app password
- [ ] `SMTP_FROM` = Email address to send from (e.g., `noreply@yourdomain.com`)

### Contact Form
- [ ] `CONTACT_EMAIL` = Where contact submissions go (e.g., `support@yourdomain.com`)

### Turnstile
- [ ] `TURNSTILE_SITE_KEY` = Your site key (public)
- [ ] `TURNSTILE_SECRET_KEY` = Your secret key (private)

## Start Development Server

- [ ] Run: `npm run dev`
- [ ] Open browser to [http://localhost:3000](http://localhost:3000)
- [ ] Verify homepage loads

## Create Your Account

- [ ] Navigate to `/signup`
- [ ] Fill out signup form
- [ ] Submit and verify email works
- [ ] Log in at `/login`

## Grant Admin Access

- [ ] Connect to your database
- [ ] Run SQL: `UPDATE users SET is_admin = true WHERE email = 'your@email.com';`
- [ ] Log out and log back in
- [ ] Navigate to `/admin` to verify admin access

## Test Features

- [ ] Run a scan from homepage
- [ ] View scan results
- [ ] Test `/demo` self-scan
- [ ] Test contact form at `/contact`
- [ ] Create a team at `/teams`
- [ ] Generate API key at `/profile`
- [ ] Export scan as PDF
- [ ] Share a scan result

## Production Deployment (Optional)

### Vercel (Recommended)
- [ ] Push code to GitHub
- [ ] Import repository on [Vercel](https://vercel.com)
- [ ] Add environment variables in dashboard
- [ ] Deploy
- [ ] Update Turnstile domain settings with production URL

### Self-Hosted
- [ ] Build: `npm run build`
- [ ] Start: `npm start` or `PORT=8080 npm start`
- [ ] Configure reverse proxy (nginx, Apache)
- [ ] Set up SSL certificate (Let's Encrypt)
- [ ] Update Turnstile domain settings

## Troubleshooting

If you encounter issues, refer to the [Troubleshooting section](README.md#troubleshooting) in the README.

Common issues:
- [ ] Database connection fails → Check `DATABASE_URL` and `DATABASE_SSL`
- [ ] Emails not sending → Verify SMTP credentials and port
- [ ] Turnstile not showing → Check site key and domain settings
- [ ] Admin access denied → Run SQL command to grant admin

## Done! 🎉

You've successfully set up VulnRadar! Start scanning websites for vulnerabilities at [http://localhost:3000](http://localhost:3000)

---

**Estimated setup time:** 15-20 minutes
**Cost:** $0 (using free tiers)
**Support:** Check README.md or open an issue on GitHub

