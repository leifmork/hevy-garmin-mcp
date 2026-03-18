# Features

## Built
- `get_recent_activities` — fetch recent Garmin runs, rides, walks, hikes
- `get_activity_detail` — deep dive into a single activity with per-lap splits
- `get_planned_workout` — read Garmin Coach planned intervals for a date
- `get_planned_vs_actual` — compare planned targets vs actual performance
- `get_week_summary` — full Monday–Sunday training load overview
- `get_daily_recovery` — sleep stages, HRV, body battery, resting HR
- `get_weight_trend` — recent body weight from Garmin
- `get_heart_rate_zones` — HR zone boundaries, VO2 max, lactate threshold
- `get_lifting_sessions` — recent Hevy strength sessions with sets/reps/weight/RPE
- `get_exercise_progress` — progress over time for a specific exercise
- `get_exercise_templates` — search Hevy exercise library by name or muscle group
- `get_lifting_routines` — saved Hevy workout routines and programs
- `get_lifting_volume` — total volume per exercise across recent sessions
- Capability URL auth (`?token=`) for ChatGPT integration
- Vercel Blob for secure Garmin session persistence

## In progress
(none)

## Explicitly out of scope
- Multi-tenant / multi-user support — this is a single-user personal tool
- A user-facing UI or dashboard
- Any data source beyond Garmin Connect and Hevy (for now)
