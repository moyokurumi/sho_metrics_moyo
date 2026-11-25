# Vendor HID Battery Sources

This directory contains direct HID battery readers for vendor-specific receivers
and peripherals. Treat every new HID route as hardware-facing protocol work, not
as a local ShoMetrics convention.

The `vendor-hid-battery-*` files in this directory own the runtime source
client, route registry, and HID operation coordination for those vendor readers.

## Adding Devices To An Existing Vendor

- A new VID/PID/interface/usage route must have a credible source:
  - a referenced open-source implementation, or
  - hardware tested on a real device.
- Record enough source context in code comments or nearby documentation for a
  later reviewer to answer why the route is believed to be safe and what device
  was validated.
- Do not infer model names or receiver behavior from a vendor list alone. A
  route may be added from real hardware evidence, but the evidence should be
  stated.

## Adding A New Vendor

Do not hand-write a new vendor HID protocol from guesswork. A new vendor reader
must be based on one of these sources:

- a credible Node.js implementation that can be used without requiring users to
  install an extra third-party executable; or
- a license-compatible, byte-for-byte protocol port from another language.

If a source project requires an external helper executable, do not wire that
helper into ShoMetrics as the first implementation. The current boundary is the
Hub plugin using bundled Node dependencies. Expanding ShoMetrics helper support
for another vendor is a separate architecture decision, not a battery-HID route
addition.

When porting from another language, keep protocol facts traceable: report
layout, feature IDs, command bytes, payload offsets, enum decoding, and timeout
semantics should all point back to the source implementation.

## Razer Naga V3 Pro (Windows)

The initial Razer route is experimental and limited to the original Naga V3
Pro HyperSpeed USB receiver (1532:00e8). The wired PID, Mouse Dock, shared
receivers, and other Razer models are not part of this route. Razer Synapse
is not required; Bluetooth continues to use the existing OS battery path.

Windows on the target device exposed the control collection as MI_03, usage
page 0x0001, usage 0x0003. This matches the USB index in
[OpenRazer PR #2904](https://github.com/openrazer/openrazer/pull/2904).
[MacRazer issue #33](https://github.com/SorcRR/MacRazer/issues/33) documents a
successful battery query on this receiver; its device table uses transaction
0x1f. The [razer-battery protocol reference](https://github.com/andrzej-zuralovic/razer-battery/blob/main/src/protocol.rs)
documents the request, checksum, and byte-scale battery field. On Windows, an awake mouse returned 92% through MI_03 with Synapse running. A response delay of 100 ms consistently picked up unrelated Synapse traffic, so the reader uses a small number of short attempts and validates the echoed command and CRC. An offline receiver is never published as 0%.
