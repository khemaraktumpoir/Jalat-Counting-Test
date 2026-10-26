# Jalat Counting Service — Ready-to-Do List

The service and warehouse Count tab have been tested end to end on the test video. The rollout
plan says the remaining milestone is a parcel-specific model and a first real camera. Tasks below
follow the rollout plan; tasks that need a site decision are marked as blocked by that decision.

## Pilot and camera

- [ ] **Choose the pilot site and belt.** Select one warehouse and its busiest inbound belt; name
  the on-site camera owner.
- [ ] **Choose the scan point.** Record whether the belt is inbound, sorting, or outbound, and
  identify the matching parcel scan step for later reconciliation.
- [ ] **Install and connect a camera.** Mount an IP camera or spare phone above the belt, connect
  its stream to the service, and verify that the real belt appears in the warehouse app's Count
  tab.
- [ ] **Check the pilot setup.** Confirm the full belt is visible, lighting is adequate, the
  counting line is positioned correctly, and the service stays connected during a test run.

## Parcel model

- [ ] **Collect belt images.** Capture frames over 3–5 days, including busy and quiet periods and
  morning and evening conditions; target 500–1,000 frames.
- [ ] **Label the frames.** Label parcels as `parcel` and hold out at least 20% of the labelled
  frames for evaluation.
- [ ] **Train and export the parcel model.** Fine-tune YOLO26n using the labelled belt data and
  export the model to ONNX for the Counting Service.
- [ ] **Evaluate the model.** Run it on three held-out recordings and compare its counts with
  hand counts. Iterate on missed and double-counted parcels until mAP50 is at least 0.9 and
  counts are within ±2%.
- [ ] **Benchmark on pilot hardware.** Measure model speed on the pilot computer and confirm it
  can sustain the belt's required frame rate.

## Pilot run and rollout

- [ ] **Run a two-week pilot.** Use the parcel model on the selected belt; have staff report
  misses and check camera status and FPS daily.
- [ ] **Record pilot results.** Verify counting accuracy within ±2%, fewer than 1 missed or
  double-counted parcel per 100, live count delay under 2 seconds, and camera uptime of at least
  99% of working hours. Investigate any unplanned interruption over 30 minutes.
- [ ] **Build scan reconciliation.** Once the scan point and matching scan step are agreed,
  implement an hourly or daily counted-versus-scanned report with the difference explained.
- [ ] **Roll out to remaining belts and sites.** Expand first to the other belts at the pilot
  warehouse, then to other warehouses; prepare and verify a service deployment for each site.

## Decisions and follow-up

- [ ] Decide whether to count every parcel as one class or distinguish boxes, bags, and envelopes.
- [ ] Decide who will label the collected frames.
- [ ] Decide whether each site will use a local PC or a shared server.
- [ ] Decide how the AGPL-3.0 licensing requirement will be handled before commercial release.

## Optional improvements

These are listed in the README as not yet implemented, but are not prerequisites for the pilot:

- [ ] Record annotated video.
- [ ] Add tracker choices such as ByteTrack or BoT-SORT for crowded belts.
- [ ] Support multiple counting regions per camera.
- [ ] Add CSV export.
- [ ] Load-test with many cameras.
