# Demo data

```bash
npm run db:push        # applies every migration, including 005_unify.sql
npm run seed:demo      # creates the logins and projects below
npm run seed:demo -- --fresh            # rebuilds LedgerLite from scratch
npm run seed:demo -- --reset-passwords  # puts demo passwords back to Demo@1234
```

Password for every account: `Demo@1234`

| Person | Email | In LedgerLite |
|---|---|---|
| Priya Sharma | priya.owner@demo.buildify.dev | Owner |
| Arjun Mehta | arjun.admin@demo.buildify.dev | Admin, manages Website |
| Kabir Singh | kabir.worker@demo.buildify.dev | Worker, Website |
| Tara Nair | tara.worker@demo.buildify.dev | Worker, Content |
| Meera Iyer | meera.observer@demo.buildify.dev | Observer |

## LedgerLite (`PRJ-LEDGER26`, observer code `OBS-LEDGER26`)

The fully filled project. Open it with the project ID, then:

- **Priya (owner):** overview with both agents' overlap warning, 5 tasks, 3 observer requests (one waiting), central context with version history (Audience v2, Pricing rules v2), Members & roles, Settings (codes, departments). Content has no manager, so Content work comes to her review.
- **Arjun (admin):** Review has Kabir's "14-day free trial" submission waiting. Approving it merges into the live site, moves the task to done and tells Meera her request is done.
- **Kabir (worker):** his agent planned "Make the features grid stack on phones" and is waiting for him to confirm; it warned him that Tara is editing the same files. My submissions shows the trial waiting and an earlier approved one.
- **Tara (worker):** her agent finished the FAQ section; she can review the diff and submit it (it goes to Priya).
- **Meera (observer):** 3 of 7 pieces live as a brick wall, who is doing what, the project line and product map, the live site (v3), and her requests: one done, one being worked on, one waiting.

## Other projects

| Project | ID | What it shows |
|---|---|---|
| CampusEats | `PRJ-EATS2026` | Scripted team demo: 3 departments and 8 simulated people Priya can act as |
| Fieldnote | `PRJ-FIELDN26` | Owned by Arjun; Kabir has asked to join (join requests) |
| Campus Connect | `PRJ-CAMPUS26` | Owned by Kabir; others find it in Explore |
