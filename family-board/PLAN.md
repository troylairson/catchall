# Family Board: technical plan

A family calendar for a wall display (an old tablet or monitor) with a phone fallback.
Design mockup: https://claude.ai/artifact/44cvC56gkovtPh7z83CsJg (private to the owner).

## Goals and non-goals

**Version 1 goals**
1. Answer "does a kid have something today?" reliably, including irregular schedules
   ("2nd & 4th Thursday", "Tue & Thu except early-release days", "ends Dec 17").
2. Show Google and iCloud calendars together without anyone changing how they add events.
3. Show clearly when a parent is traveling (city, time zone, countdown until they're home).
4. Run unattended on an old tablet or monitor, with little upkeep.
5. Make each person's color and avatar customizable.

**Out of scope for version 1:** lists, meal planning, chores and rewards, and writing
events back to Google or iCloud. Events from those calendars are read-only in the app;
edit them in the usual calendar apps.

## Architecture

```
 ┌───────────────┐  ┌──────────────┐
 │ Wall display  │  │ Phones (PWA) │
 │ (kiosk browser)│  │              │
 └──────┬────────┘  └──────┬───────┘
        │ HTTPS + Server-Sent Events (live updates)
 ┌──────▼──────────────────▼───────┐
 │ family-board server (one        │
 │ container)                      │
 │  • serves the React app         │
 │  • JSON API                     │
 │  • sync jobs every 5–10 min ────┼──► Google Calendar API
 │  • SQLite database              │──► iCloud CalDAV
 └──────────────┬──────────────────┘──► School calendar (ICS)
                │                   ──► Open-Meteo (weather)
                ▼
        nightly backup (Litestream → object storage)
```

One container runs everything: the web app, the API and the sync jobs. That means one
process to deploy, one log to read and one database file to back up. It leaves plenty
of room to tinker without a set of services that can drift out of step.

A static site on GitHub Pages, like the guitar coach, can't do this job. Calendar sync
needs stored credentials, a server-side scheduler, and requests to iCloud, which a
browser can't make directly (CORS).

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript throughout | Same as `guitar-coach/`; types shared between client and server |
| Frontend | React + Vite, installable PWA | Matches the existing repo; one codebase for the display and phones |
| Server | Node 22 + [Hono](https://hono.dev) | Small, fast, easy to read |
| Database | SQLite + Drizzle ORM | A single file, no database server, typed queries and migrations |
| Live updates | Server-Sent Events | Simpler than WebSockets; the display reconnects automatically |
| Recurrence | `rrule` (RFC 5545) | The same rule format calendars already use; handles "2nd & 4th Thu", UNTIL and EXDATE |
| Dates and time zones | `date-fns` + `date-fns-tz` | Needed for showing Alexia's events in both time zones |
| Google | `googleapis`, Calendar API v3 | Incremental sync with `syncToken` |
| iCloud | `tsdav` (CalDAV) | Works with an Apple app-specific password |
| ICS feeds | `node-ical` | School calendar and team schedules |
| Weather | Open-Meteo | Free, no API key |
| Tests | Vitest | Same as `guitar-coach/`; the recurrence rules need thorough tests |

**Browser support:** old tablets can run old browsers. The build will use
`@vitejs/plugin-legacy` and avoid newer CSS such as `color-mix()`. Color tints are
computed in JavaScript from each person's base color instead. Before building the
display shell, we need the tablet's exact model and OS version.

## Data model

```
person        id, name, color (hex), avatar (emoji or photo), role (parent|kid), sort_order
calendar      id, source (google|icloud|ics), external_id, name, default_person_id,
              enabled, last_synced_at, last_error
event         id, calendar_id, external_uid, title, start, end, all_day, tz,
              location, notes, person_ids[] (resolved), is_travel
activity      id, person_id, name, icon, rrule, start_time, end_time, location,
              notes, skip_on (["no_school","early_release"]), starts_on, ends_on
activity_exception
              id, activity_id, date, kind (cancel|move|note), new_start, new_end,
              new_location, reason
school_day    date, kind (no_school|early_release|half_day), label, source
trip          id, person_id, city, tz, starts_at, ends_at, return_note,
              source (detected|manual)
device        id, name, kind (display|phone), token_hash, last_seen_at
setting       key, value   (location for weather, night-dim hours, default view, etc.)
```

**Activities vs. events.** Kid activities live in the app as rules (`activity` +
`activity_exception` + `school_day`), not as copies in Google or iCloud. This is
what lets the Kids view answer yes or no and give a reason ("No, early release").
For a single date, the occurrence logic is:

1. Expand the activity's `rrule` between `starts_on` and `ends_on`.
2. Drop dates whose `school_day.kind` is in `skip_on`, and record the reason.
3. Apply exceptions: cancel, move (to a new date or time) or note (such as "wear white jersey").

This is a pure function, `occurrencesFor(activity, range, schoolDays, exceptions)`,
with a test for every tricky case.

**Assigning events to people.** Each synced calendar has a default person. That can be
overridden per event by:

- an attendee email matching a person
- a name or emoji in the title ("Lincoln dentist", "🏀")

Unmatched events go to a "Family" lane.

**Travel detection.** An event is marked as travel when:

- it spans several days on a parent's calendar and has a location outside the home metro, or
- its title contains ✈ or "trip", or the word "flight" with a destination.

Detected travel creates a `trip`. A trip can also be added or edited by hand from the
phone, in case detection misses one. Its time zone comes from the event or the location.

## Calendar sync

| Source | How | Notes |
|---|---|---|
| Google | OAuth (read-only `calendar.readonly` scope), per-calendar `syncToken` incremental sync every 5 min | Each of you connects your own account once. **Gotcha:** an OAuth app left in "Testing" mode has refresh tokens that expire after 7 days. Set the Google Cloud app to "In production" (unverified is fine for family use) so tokens don't expire. |
| iCloud | CalDAV via `tsdav` with an app-specific password (appleid.apple.com), polled every 10 min using ctag/etag to skip unchanged calendars | The password stays valid until revoked or the Apple ID password changes. Stored encrypted at rest. |
| School / teams | ICS URL polled hourly | If the school only publishes a PDF, we import it once into `school_day` (I can extract the dates). Team apps such as TeamSnap and GameChanger usually offer an ICS feed. |

**Health checks.** Each calendar records `last_synced_at` and `last_error`. If any source
is stale for more than an hour, the display shows a small "Calendar sync paused"
note and the parents get an email or push notification. This is the main upkeep risk,
so it should never fail silently.

## Display and devices

- **Old tablet:** on iPad, Safari with Add to Home Screen plus Guided Access to lock it to
  the app. On Android, Fully Kiosk Browser (it also handles screen-on schedules and
  motion wake).
- **Old monitor:** a Raspberry Pi 4 or 5 (or any mini PC) running Chromium with `--kiosk`
  and starting on boot. A touch overlay is optional, since phones can do the editing.
- **Pairing:** the display shows a QR code; scan it with a parent's phone to approve it.
  The display then gets a long-lived device token, so it never needs to log in.
- **Phones:** sign in with a magic link or passkey. The family size is fixed, so
  accounts are just the four people records.
- **Always-on behavior:** screen wake lock, an idle screen after 3 minutes, dimming
  between 9 PM and 6:30 AM (configurable), and a reload once a night to clear memory
  leaks on old browsers.

## Customization

A settings page on the phone covers each person's name, color (color picker plus
suggested swatches), avatar (emoji or photo) and order. Colors are stored as a single
hex value. The app works out light and dark tints and checks text contrast against
them, so any color a kid picks stays readable. The weather location, dimming hours and
default view per time of day are also settings.

## Hosting

| Option | Cost | Upkeep | Notes |
|---|---|---|---|
| **Fly.io (recommended)** | about $3–5/month | Lowest | The same Docker image runs anywhere. HTTPS, a persistent volume for SQLite, and automatic restarts. |
| Home server or the Raspberry Pi itself | $0 | Medium | Good for tinkering, but you look after the power, updates and remote access (Tailscale) yourself. |

The app is a Docker image either way, so moving between them takes minutes.
Backups: Litestream streams the SQLite file to Cloudflare R2 or S3 continuously, which
costs pennies. Deploys run from GitHub Actions on push to `main`, mirroring the
existing Pages workflow.

## Repository layout

```
family-board/
  PLAN.md
  package.json            # npm workspaces
  shared/                 # types, recurrence engine (occurrencesFor), color utils
  server/                 # Hono API, sync jobs, Drizzle schema + migrations
  web/                    # React + Vite PWA (display + phone layouts)
  Dockerfile
  fly.toml
```

## Build phases

Each phase ends with something usable on the actual wall.

1. **Skeleton and display shell.** Repo setup, server, SQLite, people with editable
   colors, and the Today, Week and Idle layouts filled with seed data. Deploy to Fly
   and run it on the tablet in kiosk mode to confirm the old browser copes.
2. **Kid activities.** This solves the biggest pain first, without any external
   calendars. Includes the activity editor on the phone (presets such as "Every Tue &
   Thu", "2nd & 4th Thu" and "Custom"), exceptions, school calendar import with
   automatic skips, and the Kids view with yes or no answers and the next date.
3. **Calendar sync.** Google OAuth and iCloud CalDAV, event-to-person rules, merging
   into Today and Week, travel detection, away mode, and sync health alerts.
4. **Polish.** Weather, night dimming, QR pairing, the phone agenda and filters, and
   backups.
5. **Later, optional.** Plain-English quick add (an LLM call that turns a sentence into
   an activity change for you to confirm), writing back to Google, then Lists and Meals.

## Open questions

1. **The tablet's model and OS version**, or what would drive the monitor. This
   decides browser support and kiosk setup.
2. **Fly.io or a home server?** The recommendation is Fly.io for the least upkeep.
3. **Which calendars belong to whom?** For example, Troy's Google calendar, Alexia's
   iCloud calendar, and a shared family calendar.
4. **Where does Alexia's work travel show up?** Her personal calendar, or only a work
   (Outlook) calendar? An Outlook ICS share link would work as a read-only feed.
5. **Do Lincoln's or Everly's teams use an app** (TeamSnap, GameChanger, etc.) that
   offers a calendar feed?
6. **The school calendar link or PDF.** Troy is finding this.
