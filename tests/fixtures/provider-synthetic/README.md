# Synthetic provider responses

These fixtures are synthetic, allowlisted examples of the provider response
shapes Seed supports. Identifiers, addresses, timestamps, locations, pricing,
and lifecycle values are test data and do not describe a real account or rental.

`scripts/provider-replay.mjs` serves these through local HTTP to the production
provider clients. Request assertions check the production create request,
including image pins and SSH environment handling, without contacting a provider.

The replay service survives abrupt termination of the application process. It
retains its rental and HTTP audit so recovery cannot pass by silently replacing
the provider client or forgetting an accepted purchase. Worker inference in
the process recovery harness remains a CPU fixture.

These tests establish parser and recovery behavior for the represented response
shapes. They do not measure provider availability, scheduling, throughput,
hardware compatibility, or successful model execution.
