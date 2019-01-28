loadAPI(2);
load ("KeyLab.js");
DRUMPADS = true;
                                                                                              
host.defineController("Arturia", "KeyLab-88 (by Mark)", "1.0", "aff1aae0-b398-11e4-ab27-0800200c9aff");
host.defineMidiPorts(1, 1); 
host.addDeviceNameBasedDiscoveryPair(["KeyLab 88"], ["KeyLab 88"]); 
host.defineSysexIdentityReply("F0 7E 00 06 02 00 20 6B ?? ?? 05 48 ?? ?? ?? ?? F7");