# Product Brief — Cascade Cache

Frozen exam input. Do not edit without re-recording every baseline.

## What it is

Cascade Cache is a read-through cache for teams that run the same expensive
queries across several services. It sits between the application and the
database, keeps the hot working set in memory, and invalidates entries from the
write path rather than by time-to-live.

## Who it is for

Backend and platform engineers at companies between 50 and 500 engineers, where
a single internal query can cost 200 ms and run thousands of times an hour.

## The problem it replaces

Teams either tolerate repeated slow queries or hand-roll a cache in each
service. Hand-rolled caches drift: each one invents its own key format, its own
invalidation rule, and its own idea of what a stale entry costs. When the
schema changes, four services break in four different ways.

## Three claims

1. **One key format.** Keys are derived from the query plan, so two services
   issuing the same query share one entry without agreeing on a naming scheme.
2. **Invalidation follows the write.** A write identifies the entries it can
   affect and drops them; nothing expires because a clock moved.
3. **Bounded staleness is a dial, not a surprise.** A team that can tolerate a
   two-second window turns it on; a team that cannot leaves it at zero.

## Numbers

- p99 read latency for a cached query: 3 ms
- Cold miss cost on the reference workload: 210 ms
- Memory per million cached rows: 640 MB
- Services in the reference deployment: 6
- Rollout time from one service to all six: 11 days

## Objections to answer

- "We already have Redis." — Redis is a store; Cascade sits above it and decides
  what belongs there. The comparison is deployment discipline, not raw speed.
- "Invalidation will be wrong somewhere." — The dial exists because that is
  true; the question is whether the failure is bounded and measurable.
- "Our queries are not repetitive." — The reference workload says 71% of read
  queries repeat within five minutes; a team that cannot measure its own ratio
  should measure before adopting.

## Tone

Direct and technical. No marketing superlatives. The audience will discount a
deck that oversells, and one concrete number does more work than an adjective.
