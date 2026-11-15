# MailChat

A starter web application with email-based account registration, sign-in, member search and private one-to-one text messaging.

## Requirements
- Node.js 20+
- PostgreSQL database

## Run locally
1. Install Node.js.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` and a long random `SESSION_SECRET`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Deploy on Render
1. Upload this project to a GitHub repository.
2. In Render, create a PostgreSQL database.
3. Create a **Web Service** from the GitHub repository.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables:
   - `DATABASE_URL`: Render PostgreSQL **Internal Database URL** (use the external URL only if required by your setup).
   - `SESSION_SECRET`: a long, random secret.
   - `NODE_ENV`: `production`
7. Deploy.

## Important notes
- User passwords are hashed with bcrypt; the application does not provide an admin page to view passwords.
- This app uses email addresses as account identifiers. It does **not** send or receive external email, and email ownership verification/password reset are not included yet.
- Messages are stored in PostgreSQL and displayed only to the two users in the conversation through the app.
- This starter uses periodic message refresh (polling), not instant WebSocket delivery.
- Before a public launch, add email verification, password reset, abuse reporting/blocking, stronger monitoring, backups and privacy/legal pages. Use HTTPS in production.
