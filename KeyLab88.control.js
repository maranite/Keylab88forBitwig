loadAPI(2);
DRUMPADS = true;
load ("KeyLab.js");                         
                                                                                                                                                                                                                            
host.defineController("Arturia", "KeyLab-88 (by Mark)", "2.0", "aff1aae0-b398-11e4-ab27-1800200c9aff");
host.defineMidiPorts(1, 1);  
host.addDeviceNameBasedDiscoveryPair(["KeyLab 88"], ["KeyLab 88"]); 
host.defineSysexIdentityReply("F0 7E 00 06 02 00 20 6B ?? ?? 05 48 ?? ?? ?? ?? F7");