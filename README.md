# Keylab88forBitwig
Controller script for using Arturia Keylab 88 with Bitwig 2.x

Arturia's Keylab 88 has somewhat buggy firmware, and somewhere around firmware version 1.2.6 the Bitwig scripts stopped working. Bitwig then release v2.x where the Keylab controller was integrated into Bitwig as a Java extension, and things got even worse.

This project aims to address those issues, as well as provide a far deeper integration between the Keylab and Bitwig. There are several noteworthy features of this script that may influence whether or not you want to use it:

1) It only works with Bitwig 2.x (or newer versions that support the level 2 controller API).
2) It does away with "BITWIG MODE" in favor of a 10 remote control pages, each page containing 8 knob assignments.
3) It does away with "ARTURIA MODE", instead offering:
    9 pages of freely assignable user controls, each page consisting of 10 knobs.
    1 page of 10 MIDI CC controls. Different CC messages are used for inc/dec knob turns.
4) The stop button can be used to tempo tab when the transport is not playing.
5) The faders are hard-coded to the first 9 banks. This might be a deal-breaker for some folks, but it's what I prefer.
6) Keylab Pads can be set to Clip Launcher mode or Drumpad mode, where the pads can be locked to a drumpad track. 

If you would like to contribute, please contact me on maranite at gmail.
