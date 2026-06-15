---
name: Session Protection Rules
description: Hard rules applied to prevent accounts from losing sessions and requiring re-login involuntarily
---

# Session Protection Rules

## The 5 Root Causes Fixed

### 1. clientPool.ts — importSession failure → NEVER connect fresh
**Rule:** If `importSession(sessionString)` throws, throw an error immediately. Never fall through to `client.connect()` with empty MemoryStorage.
**Why:** Empty MemoryStorage creates a new auth key → Telegram sees duplicate → AUTH_KEY_DUPLICATED → old session wiped.
**How to apply:** Any code path in clientPool that has a stored sessionString must protect it. Only create a fresh connection when sessionString is null/undefined.

### 2. clientPool.ts — Refresh session in DB after every connect
**Rule:** After successful `client.connect()` with an imported session, export the session and save it back to MongoDB accounts collection.
**Why:** The session string can change slightly after reconnect (key rotation). Keeping DB in sync prevents future importSession failures.
**How to apply:** After `pool.set(...)`, always do `exportSession()` → update accounts collection.

### 3. telegramErrors.ts — AUTH_KEY_DUPLICATED is its own action type
**Rule:** `AUTH_KEY_DUPLICATED` → `"auth_key_duplicated"` action (NOT `"auth_revoked"`).
**Why:** AUTH_KEY_DUPLICATED means two connections existed simultaneously — the session is STILL VALID. Treating it as auth_revoked caused the engine to wipe sessionString from DB.
**How to apply:** In classifyTelegramError, check AUTH_KEY_DUPLICATED BEFORE the auth_revoked list.

### 4. telegramEngine.ts — auth_key_duplicated case: remove client, keep session
**Rule:** On `auth_key_duplicated`: call `removeClient(phone)` only. Never set `sessionString: null`. Never set `status: "needs_auth"`.
**Why:** The session is valid. Just closing the duplicate connection fixes it. Next tick will reconnect using the stored session.
**How to apply:** `case "auth_key_duplicated"`: removeClient + log. No DB session update.

### 5. accounts.ts ping route — NEVER wipe sessionString on ping failure
**Rule:** Ping failure (getMe throws) → only update `status: "needs_auth"` if `AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED`. Never set `sessionString: null`.
**Why:** Pings can fail from network blips, Telegram server issues, or race conditions. The session in DB is the source of truth and must never be erased based on a transient error.
**How to apply:** Remove `sessionString: null` from all ping error handlers. Keep the string for recovery.

## What DOES wipe sessionString
- `account_banned` action (PHONE_NUMBER_BANNED) — account is permanently banned, session is useless
- Manual delete of account via DELETE /accounts/:id

## What NEVER wipes sessionString
- AUTH_KEY_DUPLICATED
- Ping failures (any kind)
- FLOOD_WAIT, PEER_FLOOD, CHANNELS_TOO_MUCH
- Network errors, timeouts
- auth_revoked (we keep it for recovery, just set status)
