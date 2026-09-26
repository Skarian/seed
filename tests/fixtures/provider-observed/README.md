# Recorded provider responses

These are allowlisted, anonymized responses from the actual 23 September 2026
Seed acquisition campaign. Each JSON fixture identifies its capture time and
redactions. No credentials or original SSH keys are retained.

`scripts/provider-replay.mjs` serves these through local HTTP to the production
provider clients. Its allocation bookkeeping, unique launch labels, current
timestamps, list envelopes, empty delete acknowledgement, and deliberate held
responses are **test construction**, not recorded marketplace behavior. The
recorded resource and absence bodies exercise the parsers. Request assertions
check the actual production create request, including image pins and SSH env.

The replay service survives abrupt termination of the application process. It
retains its rental and HTTP audit so recovery cannot pass by silently replacing
the provider client or forgetting an accepted purchase. Worker inference in
the process recovery harness remains a CPU fixture.

These tests establish application recovery behavior for the specified faults.
They do not measure provider availability, scheduling, image pull throughput,
hardware compatibility or successful model execution.
