# PawBook Frontend — Updated Files

Copy all these files into your pawbook-frontend repo root, then push.

## Files Changed (14 total)
| File | What changed |
|------|-------------|
| api.js | GroupAPI feed/post/members/media methods; offset pagination |
| 02_onboarding.html | Step 2 now PATCHes /users/me (was no-op) |
| 03_groups.html | socket.js: group:new_post, group:member_joined events |
| 05_lost_pet.html | Wired to /lost-pets API |
| 08_pet_profile.html | socket.js: post:reaction, post:comment live updates |
| 16_vet_profile.html | Real data from /vets/:id, reviews, slots |
| 17_group_detail.html | socket.js added |
| 19_order_confirmation.html | Reads ?order_id= from URL, calls GET /marketplace/orders/:id |
| 22_training.html | loadTrainers() fetches /training/trainers |
| 28_reels.html | IntersectionObserver real progress bar |
| 29_user_profile.html | socket.js: user:follow follower count updates |
| 30_events.html | socket.js: event:rsvp attendee count updates |
| 34_live.html | Agora WebRTC Go Live + socket.io comments/reactions |
| 35_pawmatch.html | API wired (from earlier session) |

## Push Command
```bash
git add .
git commit -m "feat: wire 14 pages to backend APIs + Agora live + socket.io"
git push origin main
```
