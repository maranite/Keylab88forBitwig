# Keylab88forBitwig
Controller script for using Arturia Keylab 88 with Bitwig 2.x

Arturia's Keylab 88 has somewhat buggy firmware, and somewhere around firmware version 1.2.6 the Bitwig scripts stopped working because (from what I could tell) Arturia cocked-up the sysex identifiers for some of the controls, which caused Thomas Hezle's original script to address the controls incorrectly. When Bitwig released v2.0, the Keylab controller code got integrated into Bitwig as a Java extension, which made matters worse - Bitwig insisted on addressing the Keylab 88 controller with incorrect sysex messages.

This project aims to address these issues, as well as provide a far deeper integration between the Keylab and Bitwig. 

Noteworthy characteristics & features:

1) Utilizes the v2 controller API (this means that tt only works with Bitwig 2.x), because...

2) Deep integration with Bitwig's browsing experience. 
   You can launch and complete your browsing from the Keylab, without touching the mouse or computer keyboard.

3) No more "BITWIG MODE" and "ARTURIA MODE". 
   These modes where a somewhat awkward nod to the Analogue Lab software, at the expense of a great overall Bitwig experience.
   They are replaced with 5 modes:
   * Arranger Mode			- Buttons and Knobs mapped to functions relevant to the arranger layout.
   * Mix Mode				- Buttons and Knobs mapped to functions relevant to the mixer layout.
   * Edit Mode				- Buttons and Knobs mapped to functions relevant to the note edit layout.
   * Remote Control Mode    - 80 controls (10 pages x 8 knobs) map to the remote control pages of the selected device.
   * User Control Mode      - 72 controls (9 pages x 8 knobs) mappable to anything you assign them to. 
							  1 page x 10 knobs send different MIDI CC for inc/dec knob turns, for VST midi-mapping.
    
4) Stop button = Tempo tap (when transport is stopped).

5) Faders are hard-coded to the first 9 banks. 
   This might be a deal-breaker for some folks, but it's what I prefer.


If you would like to contribute, please contact me on maranite at gmail.
