# Keylab88forBitwig
Controller script for using Arturia Keylab 88 with Bitwig 2.x

On launch, Bitwig and the Arturia Keylab series seemed like perfect bed-follows, but the Keylab 88 was left out.
Modifications were made to Thomas Helzle's original repository to accomodate the Keylab 88, which appears to have later been ported to java for inclusion as an embedded extension in Bitwig 2.x.
As of Arturia's Keylab firmware v1.2.6, the Keylab 88 does not behave as expected to the Sysex message sent to it, leaving Keylab 88 users with a less-than-ideal experience. 

This script sports significantly deeper integration into Bitwig's excellent workflow, specifically:

1) Deep integration with Bitwig's browsing experience. 
   Click Param to launch the Bitwig browser, and select presets, devices, samples, multi-samples with the value encoder.
   Filter on category, creator, tags, file type, etc. using Keylab's knobs.
   Confirm or cancel browsing using the Value and Param buttons respectively. 
   The entire browsing expereince can be completed without touching your computer or mouse!

2) Remote Control Mode:    
   In Keylab's Sound Mode Bank 1, the encoder knobs map to the remote control pages of the selected device.
   You can easily move between remote control pages by using either buttons 1-10, or scroll pages using P10.

3) User Control Mode:
   In Keylab's Sound Mode Bank 2, the encoder knobs map to user controls 1-72.
   User controls are freely assignable and are not sensitive to track or device selection.
   The controls are organized into 9 pages of 8 knobs - mappable to anything you assign them to.
   Additionally, button 10 puts Keylab into MIDI CC mode, where a different CC is sent for inc/dec knob turns, enabling midi-mapping within VST plugins.

4) Multi Mode:
   When Keylab in in Multi-mode, you can easily switch between Bitwig's Arrange, Mix and Edit layouts using buttons 2,3 and 4 respectively.
   In each layout, the remaining buttons are mapped according to what is available in each respective layout (see the contoller help for details).
   Each button also supports a long-hold operation.
    
5) Tempo Tap:
   When the transport is stopped, the STOP transport button can be used to tempo tap.

6) Consistent Track and Device navigation:
   Except when in browse mode, the Param and Value knobs will always navigate tracks and devices respectively.
   In sound mode, the clicking value knob button will show/hide the selected VST plugin window.





Potential niggles that you should know about:

1) Faders are hard-coded to controlling the volume for the first 9 tracks. 
   This might be a deal-breaker for some folks, but non-motorized faders have been a pet-peave of mine since the dawn of midi.

2) ARTURIA MODE no longer exists. This mode seemed like an awkward nod to the Analog Lab software, at the expense of a great overall Bitwig experience.
   In future versions of this script I might add in something to support Analog Lab, but frankly this isn't a high priority given the plugins I prefer to use.



If you would like to contribute, please contact me on maranite at gmail.
