# Talk for Me trust testing

This folder is the regression harness for Ana's highest-risk feature: speaking on the owner's behalf.

## What is tested automatically

`npm run test:trust` runs adversarial completion-gate scenarios with Node's built-in test runner. No external service or API key is required.

The suite currently covers:

- incomplete ticket-price breakdowns
- ambiguous money such as 18 vs 80
- exact vs uncertain appointment times
- pending owner approval for purchases/commitments
- optional details that must not create pointless blockers
- unavailable information with and without evidence
- blank "confirmed" values
- contradictory prices
- background-speech candidates
- incomplete addresses
- dynamically discovered requirements such as ID rules
- uncertain quantities
- reference numbers
- tasks with no critical facts

The key invariant is simple: **Ana may not complete a task while a required material fact is merely missing or observed/uncertain, or while an owner decision is still pending.**

## Adding a regression

When a real or simulated conversation reveals a failure, add a small scenario to `talkTrust.scenarios.js` before fixing the product. The scenario should describe the verification state at the point where Ana tried to finish and whether completion must be accepted or refused.

This creates a permanent regression test so the same trust failure cannot silently return later.

## CI

`.github/workflows/trust-tests.yml` runs the trust suite and a production Vite build on every push to `main` and every pull request.

## What this does not prove

These deterministic tests protect the application's completion gate. They do **not** prove that microphones, transcription, semantic VAD, model reasoning, pronunciation, latency, or real human behavior are reliable. Those need live-device stress tests as a separate layer.

The next QA layer should replay messy real conversations through Talk for Me and record: transcription, tool calls, owner escalations, critical-fact state, completion decision, and debrief accuracy.
