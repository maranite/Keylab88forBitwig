var kL = null;

// Ideas:
//  1. ClipLauncher mode for Pads
//  2. Use transpose buttons for Pad transpose. Will require resetting the transpose value via sysex.

// Main KeyLab Object:
function KeyLab() {
    var kL = this;

    var midiInKeys = this.midiInKeys = host.getMidiInPort(0).createNoteInput("Keys", "80????", "90????", "B001??", "B002??", "B00B??", "B040??", "C0????", "D0????", "E0????");
    this.midiInKeys.setShouldConsumeEvents(false);  // Disable the consuming of events by the NoteInputs, so they are also sent to onMidi

    if (DRUMPADS) { // Check if Drumpads are available for the model, if yes, create an Input for them
        var midiInPads = this.midiInPads = host.getMidiInPort(0).createNoteInput("Pads", "?9????");
        this.midiInPads.setShouldConsumeEvents(false);
        // Translate Poly AT to Timbre:
        this.midiInPads.assignPolyphonicAftertouchToExpression(9, NoteExpression.TIMBRE_UP, 2);
    }

    var midiOut = host.getMidiOutPort(0);
    var sendSysex = function (data) { midiOut.sendSysex(data); };

    var ccMap = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
    var mmcMap = {};
    var allControls = [];

    controls = this.controls = (function () {
        var configMap = [1, 2, 3, 4, 5, 6, 0x40, 0x41];
        var defineControl = function (id, type, name, bank, index, hasLED, config) {
            var idHex = uint7ToHex(id);
            var config = Array.prototype.slice.call(arguments, 6);
            var setValue = function (cmd, val) {
                var data = "F0 00 20 6B 7F 42 02 00 " + uint7ToHex(cmd) + idHex + uint7ToHex(val) + "F7";
                sendSysex(data);
                //println(data);
            };

            var props = {
                "id": { value: id },
                "type": { value: type },
                "name": { value: name },
                "hasLED": { value: hasLED },
                "config": { value: config },
                "configure": {
                    value: function () {
                        for (var i = 0; i < config.length; i++)
                            setValue(configMap[i], config[i]);

                        if (id === 0x6E)
                            for (var i = 0; i < config.length; i++)         // Quick hack, because Arturia are cunts.
                                setValue(0x0A, configMap[i], config[i]);

                        switch (config[0]) {
                            case 5:
                                ccMap[config[1]][config[4]] = ctrl;
                            case 1:
                            case 8:
                                ccMap[config[1]][config[2]] = ctrl;
                                break;
                            case 7:
                                mmcMap[uint7ToHex(config[2]).trim()] = ctrl;
                                break;
                        }
                    }
                }
            };
            if (typeof bank !== 'undefined') props["bank"] = { value: bank };
            if (typeof index !== 'undefined') props["index"] = { value: index };

            if (hasLED) {
                props["isLit"] = {
                    get: function () { return this._isLit || false; },
                    set: function (value) {
                        if (this._isLit === value)
                            return;
                        this._isLit = value;
                        this.activateLED();
                    }
                };
                props["activateLED"] = {
                    value: function () {
                        // println("Setting light for " + name + " to " + this._isLit);
                        var data = "F0 00 20 6B 7F 42 02 00 10 " + idHex + (this._isLit ? "01" : "00") + " F7";
                        //host.scheduleTask(sendSysex, [data], 200);
                        sendSysex(data);
                    }
                }
            }

            var ctrl = Object.create(Object.prototype, props);
            allControls.push(ctrl);
            return ctrl;
        }

        var defineTransport = function (id, name, mmcID) {
            return defineControl(id, "Transport", name, undefined, undefined, true, 7, 0, mmcID, 0, 0xF7, 1);
        };

        var defineButton = function (id, index, cc, longcc) {
            return defineControl(id, "Button", "Button " + (1 + index), undefined, index, true, 5, 0, cc, cc, longcc, 1);
        };

        var definePad = function (id, index, note) {
            return defineControl(id, "Pad", "Pad " + (1 + index), undefined, index, true, 9, 9, note, 0x20, 0x7F, 1);
        };

        var defineKnob = function (id, bank, index, cc) {
            return defineControl(id, "Knob", "B" + bank + " P" + (1 + index), bank, index, false, 1, 0, cc, 0, 0x7F, 1);
        };

        var defineFader = function (id, bank, index, cc) {
            return defineControl(id, "Fader", "B" + bank + " Fader " + index, bank, index, false, 1, 0, cc, 0, 0x7F, 1);
        };

        return {
            volume: defineControl(0x30, "Volume", "Volume", undefined, undefined, false, 1, 0, 0x07, 0, 0x7F, 1),
            param: defineControl(0x31, "Other", "Param", undefined, undefined, false, 1, 0, 0x70, 0, 0x7F, 1),
            value: defineControl(0x33, "Other", "Value", undefined, undefined, false, 1, 0, 0x72, 0, 0x7F, 1),
            paramButton: defineControl(0x32, "Other", "Param Click", undefined, undefined, false, 8, 0, 0x71, 0, 0x7F, 1),
            valueButton: defineControl(0x34, "Other", "Value Click", undefined, undefined, false, 8, 0, 0x73, 0, 0x7F, 1),
            sound: defineControl(0x1E, "Mode", "Sound", undefined, undefined, true, 8, 0, 0x76, 0, 0x7F, 1),
            multi: defineControl(0x1F, "Mode", "Multi", undefined, undefined, true, 8, 0, 0x77, 0, 0x7F, 1),
            bank1: defineControl(0x1D, "Bank", "Bank 1", 1, undefined, true, 8, 0, 0x2E, 0, 0x7F, 1),
            bank2: defineControl(0x1C, "Bank", "Bank 2", 2, undefined, true, 8, 0, 0x2F, 0, 0x7F, 1),
            play: defineTransport(0x58, "Play", 2),
            stop: defineTransport(0x59, "Stop", 1),
            record: defineTransport(0x5A, "Record", 6),
            rewind: defineTransport(0x5B, "Rewind", 5),
            forward: defineTransport(0x5C, "Forward", 4),
            loop: defineTransport(0x5D, "Loop", 7),
            buttons: [
                defineButton(0x12, 0, 0x16, 0x68),
                defineButton(0x13, 1, 0x17, 0x69),
                defineButton(0x14, 2, 0x18, 0x6A),
                defineButton(0x15, 3, 0x19, 0x6B),
                defineButton(0x16, 4, 0x1A, 0x6C),
                defineButton(0x17, 5, 0x1B, 0x6D),
                defineButton(0x18, 6, 0x1C, 0x6E),
                defineButton(0x19, 7, 0x1D, 0x6F),
                defineButton(0x1A, 8, 0x1E, 0x74),
                defineButton(0x1B, 9, 0x1F, 0x75)
            ],
            pads: [
                definePad(0x70, 0, 0x24),
                definePad(0x71, 1, 0x25),
                definePad(0x72, 2, 0x26),
                definePad(0x73, 3, 0x27),
                definePad(0x74, 4, 0x28),
                definePad(0x75, 5, 0x29),
                definePad(0x76, 6, 0x2A),
                definePad(0x77, 7, 0x2B),
                definePad(0x78, 8, 0x2C),
                definePad(0x79, 9, 0x2D),
                definePad(0x7A, 10, 0x2E),
                definePad(0x7B, 11, 0x2F),
                definePad(0x7C, 12, 0x30),
                definePad(0x7D, 13, 0x31),
                definePad(0x7E, 14, 0x32),
                definePad(0x7F, 15, 0x33)
            ],
            faders: [
                defineFader(0x0B, 1, 0, 0x49),
                defineFader(0x0C, 1, 1, 0x4B),
                defineFader(0x0D, 1, 2, 0x4F),
                defineFader(0x0E, 1, 3, 0x48),
                defineFader(0x4B, 1, 4, 0x50),
                defineFader(0x4C, 1, 5, 0x51),
                defineFader(0x4D, 1, 6, 0x52),
                defineFader(0x4E, 1, 7, 0x53),
                defineFader(0x4F, 1, 8, 0x55),
                defineFader(0x2B, 2, 0, 0x49),         // 0x43
                defineFader(0x2C, 2, 1, 0x4B),         // 0x44
                defineFader(0x2D, 2, 2, 0x4F),         // 0x45
                defineFader(0x2E, 2, 3, 0x48),         // 0x46
                defineFader(0x6B, 2, 4, 0x50),         // 0x57
                defineFader(0x6C, 2, 5, 0x51),         // 0x58
                defineFader(0x6D, 2, 6, 0x52),         // 0x59
                defineFader(0x6E, 2, 7, 0x53),         // 0x5A
                defineFader(0x6F, 2, 8, 0x55)          // 0x5C
            ],
            knobs: [
                defineKnob(0x01, 1, 0, 0x47),
                defineKnob(0x02, 1, 1, 0x46),
                defineKnob(0x03, 1, 2, 0x4C),
                defineKnob(0x04, 1, 3, 0x4D),
                defineKnob(0x09, 1, 4, 0x5D),
                defineKnob(0x05, 1, 5, 0x12),
                defineKnob(0x06, 1, 6, 0x13),
                defineKnob(0x07, 1, 7, 0x10),
                defineKnob(0x08, 1, 8, 0x11),
                defineKnob(0x6E, 1, 9, 0x5B),       // Special case knob that can also have ID 0x0A.  Arturia are cunts.
                defineKnob(0x21, 2, 0, 0x23),
                defineKnob(0x22, 2, 1, 0x24),
                defineKnob(0x23, 2, 2, 0x25),
                defineKnob(0x24, 2, 3, 0x26),
                defineKnob(0x29, 2, 4, 0x27),
                defineKnob(0x25, 2, 5, 0x28),
                defineKnob(0x26, 2, 6, 0x29),
                defineKnob(0x27, 2, 7, 0x2A),
                defineKnob(0x28, 2, 8, 0x2B),
                defineKnob(0x2A, 2, 9, 0x2C)
            ]
        };
    })();

    var setValue = function (id, cmd, val) {
        sendSysex("F0 00 20 6B 7F 42 02 00 " + uint7ToHex(cmd) + uint7ToHex(id) + uint7ToHex(val) + "F7");
    };
    var loadMemory = function (preset) {
        sendSysex("F0 00 20 6B 7F 42 05 " + uint7ToHex(preset) + "F7");
    };
    var saveMemory = function (preset) {
        sendSysex("F0 00 20 6B 7F 42 06 " + uint7ToHex(preset) + "F7");
    };
    var getValue = function (id, cmd) {
        this.sendSysex("F0 00 20 6B 7F 42 01 00 " + uint7ToHex(cmd) + uint7ToHex(id) + "F7");
    };
    var setButtonLight = function (index, from, to) {
        from = from || 0;
        to = to || 9;
        for (var i = from; i <= to; i++)
            controls.buttons[i].isLit = (index === i);
    };
    var sendTextToKeyLab = function (line1, line2) {
        sendSysex("F0 00 20 6B 7F 42 04 00 60 01 " + line1.toHex(16) + " 00 02 " + line2.toHex(16) + " 00 F7");
    }
    var moveCursor = function (cursor, inc) {
        if (cursor !== undefined)
            (inc > 0) ? cursor.selectNext() : cursor.selectPrevious();
    };

    var masterTrack = host.createMasterTrack(0);
    masterTrack.getVolume().setIndication(true);

    var tracks = host.createMainTrackBank(9, 0, 0);
    var scenes = tracks.getClipLauncherScenes();
    for (var j = 0; j < 9; j++) {
        tracks.getTrack(j).getVolume().markInterested();
        tracks.getTrack(j).getVolume().setIndication(true);
    }

    var preferences = host.getPreferences();
    var application = host.createApplication();
    //var cTrack = host.createCursorTrack(3, 0);
    //var cDevice = cTrack.createCursorDevice();
    var cTrack = host.createArrangerCursorTrack(3, 4);      // 4 scene slots
    var cDevice = host.createEditorCursorDevice(0);
    var browser = cDevice.createDeviceBrowser(1, 1);
    var cBrowser = browser.createCursorSession();
    var isPlaying = false;
    var mode = null;
    var setMode = function (value) {
        if (value !== this._mode) {
            if (mode !== null) {
                mode.active = false;
                mode.setIndication();
            }
            controls.sound.isLit = false;
            controls.multi.isLit = false;
            mode = value;
            mode.active = true;
            mode.setIndication();
            //host.showPopupNotification(value.name);
        }
    };

    var preferModeSwitchesLayout = preferences.getEnumSetting("Switch layout on Sound/Multi", "Behavior", ["Yes", "No"], "No");

    var createMode = (
        function () {
            var mode_prototype = {
                name: "Global Mode",
                onParamClick: function () { },
                onValueClick: function () { },
                onParam: function (inc) { moveCursor(cTrack, inc); },
                onValue: function (inc) { inc < 0 ? tracks.scrollTracksUp() : tracks.scrollTracksDown(); },
                onVolume: function (inc) { masterTrack.getVolume().inc(inc, 128); },
                onButton: function (ctrl) { },
                onLongButton: function (ctrl) { },
                onFader: function (ctrl, data) { tracks.getTrack(ctrl.index).getVolume().set(data, 128); },
                onEncoder: function (ctrl, inc) { },
                onPad: function (ctrl, isDown) { },
                onBank: function (bank) {
                    this.bank = bank;
                    this.setIndication();
                },
                onMode: function (isMulti) {
                    setMode(isMulti ? MULTI_MODE : SOUND_MODE);
                    if (preferModeSwitchesLayout.get() == "Yes") {
                        application.setPanelLayout(isMulti ? "MIX" : "ARRANGE");
                    }
                },
                setIndication: function () { },
                active: false,
                bank = 1
            };

            return function (ctor) {
                ctor.prototype = Object.create(mode_prototype);
                return new ctor();
            };
        })();

    var SOUND_MODE = createMode(
        function () {
            var cRemote = cDevice.createCursorRemoteControlsPage(8);
            cRemote.pageNames().markInterested();
            //cDevice.isRemoteControlsSectionVisible
            cDevice.isPlugin().markInterested();
            cDevice.isWindowOpen().markInterested();

            var userBanks = 9;

            var uControls = host.createUserControls(100);
            for (var h = 0; h < userBanks; h++)
                for (var j = 0; j < 10; j++)
                    uControls.getControl((h * 10) + j).setLabel("Group " + h + " Knob " + j);

            this.name = "Sound Mode";
            var remotePageIndex = 0;
            var userControlPageIndex = 0;
            var getUserControl = function (index) { return uControls.getControl(index + (10 * userControlPageIndex)); }

            this.onParamClick = function () {
                browser.startBrowsing();
            };

            this.onValueClick = function () {
                if (cDevice.isPlugin().get())
                    cDevice.isWindowOpen().toggle();
            };

            this.onEncoder = function (ctrl, inc) {
                var index = ctrl.index;
                if (this.bank == 1) {
                    switch (index) {
                        case 4:
                            inc > 0 ? cRemote.selectNextPage(true) : cRemote.selectPreviousPage(true);
                            return;

                        case 9: moveCursor(cDevice, inc); return;

                        default:
                            cRemote.getParameter(index - ((index > 4) ? 1 : 0)).inc(inc, 128);
                            return;
                    }
                } else {
                    if (userControlPageIndex < userBanks)
                        getUserControl(index).inc(inc, 128);
                    else {
                        var x = inc > 0 ? 1 : 0;
                        var cc = 0x40 + (2 * index) + x;
                        midiInKeys.sendRawMidiEvent(0xB0, cc, 0x7f);
                        //midiInKeys.sendRawMidiEvent(0xB0, cc, 0x00);
                    }
                }
            };

            this.setIndication = function () {
                controls.sound.isLit = this.active;
                for (var i = 0; i < 8; i++)
                    cRemote.getParameter(i).setIndication(this.active && (this.bank == 1));

                for (var h = 0; h < userBanks; h++)
                    for (var j = 0; j < 10; j++)
                        uControls.getControl((h * 10) + j).setIndication(this.active && (this.bank == 2) && h == userControlPageIndex);

                if (this.active) {
                    controls.multi.isLit = false;
                    controls.bank1.isLit = (this.bank & 1 == 1);
                    controls.bank2.isLit = (this.bank & 2 == 2);

                    switch (this.bank) {
                        case 1:
                            setButtonLight(remotePageIndex);
                            break;
                        case 2:
                            setButtonLight(userControlPageIndex);
                            if (userControlPageIndex < userBanks)
                                sendTextToKeyLab("Sound: User", "Control Page " + (1 + userControlPageIndex));
                            else
                                sendTextToKeyLab("Sound: User", "Inc/Dec as CC");
                            break;
                    }
                }
            };

            this.onButton = function (ctrl) {
                var index = ctrl.index;
                if (this.bank == 1) {
                    if (index < cRemote.pageNames().get().length)
                        cRemote.selectedPageIndex().set(index);
                } else {
                    userControlPageIndex = ctrl.index;
                    if (this.active)
                        this.setIndication();
                }
            };

            cRemote.selectedPageIndex().addValueObserver((function (value) {
                remotePageIndex = value;
                if (this.active)
                    this.setIndication();
            }).bind(this));
        });

    var BROWSE_MODE = createMode(
        function () {
            this.name = "Browse Mode";
            var tabNames = ["Devices", "Presets", "Multi-Samples", "Samples", "Music"];
            var tabIndex = -1;

            var cResult = cBrowser.getCursorResult();
            var sDevice = browser.getDeviceSession();
            var sPreset = browser.getPresetSession();
            var sMultiSample = browser.getMultiSampleSession();
            var sSample = browser.getSampleSession();
            var sMusic = browser.getMusicSession();
            var cursorMap = {
                "Devices": [
                    sDevice.getDeviceTypeFilter().createCursorItem(),
                    sDevice.getFileTypeFilter().createCursorItem(),
                    sDevice.getCategoryFilter().createCursorItem(),
                    sDevice.getTagsFilter().createCursorItem(),
                    sDevice.getCreatorFilter().createCursorItem()],
                "Presets": [
                    sPreset.getPresetTypeFilter().createCursorItem(),
                    sPreset.getFileTypeFilter().createCursorItem(),
                    sPreset.getCategoryFilter().createCursorItem(),
                    sPreset.getTagsFilter().createCursorItem(),
                    sPreset.getCreatorFilter().createCursorItem()],
                "Multi-Samples": [
                    sMultiSample.getFileTypeFilter().createCursorItem()],
                "Samples": [
                    sSample.getFileTypeFilter().createCursorItem()
                ],
                "Music": [
                    sMusic.getFileTypeFilter().createCursorItem()
                ]
            };

            this.onEncoder = function (ctrl, inc) {
                var browserTab = cBrowser.name().get();
                if (browserTab in cursorMap)
                    moveCursor(cursorMap[browserTab][ctrl.index], inc);
            };
            this.onButton = function (ctrl) {
                switch (ctrl.index) {
                    case 0: browser.getDeviceSession().activate(); break;
                    case 1: browser.getPresetSession().activate(); break;
                    case 2: browser.getMultiSampleSession().activate(); break;
                    case 3: browser.getSampleSession().activate(); break;
                    case 4: browser.getMusicSession().activate(); break;
                }
            };
            this.onParamClick = function () { browser.cancelBrowsing(); };
            this.onValueClick = function () { browser.commitSelectedResult(); };
            this.onParam = function (inc) { moveCursor(cBrowser, inc); };
            this.onValue = function (inc) { moveCursor(cResult, inc); };
            this.onMode = function (isMulti) {
                browser.cancelBrowsing();
                this.prototype.onMode(isMulti);
            };

            this.setIndication = function () {
                if (this.active) {
                    sendTextToKeyLab(this.name, "");
                    setButtonLight(tabIndex);
                }
            };

            cBrowser.name().addValueObserver((function (name) {
                if (name.length == 0) return;
                tabIndex = tabNames.indexOf(name);
                this.name = "Browse " + name;
                this.setIndication();
            }).bind(this));

            cBrowser.exists().addValueObserver((function (browsing) { setMode(browsing ? this : SOUND_MODE); }).bind(this));
        });

    // notes:
    // in Mix mode, there is no loop start/end/cyrrent time.
    // in arrange more, sends and pan arent visible.
    // Are there better uses for the knobs in these modes?

    var MULTI_MODE = createMode(
        function () {
            var padOffset = 0;
            var shiftPads = function (inc) {
                if (inc > 0 && padOffset >= 4) return;
                if (inc < 0 && padOffset <= -3) return;

                var value = padOffset * 16;
                var padTranslation = new Array(128);
                for (var i = 0; i < 128; i++) {
                    padTranslation[i] = (value < 0 || value > 127) ? -1 : value;
                    value++;
                }
                midiInPads.setKeyTranslationTable(padTranslation);
                var prefix = (padOffset >= 0) ? " +" : " ";
                host.showPopupNotification("Drum Pad Bank:" + prefix + padOffset);
                sendTextToKeyLab("Drum Pad Bank:", prefix + padOffset)
            };

            var arePadsAssignedToSlots = false;
            var togglePadsAssignedToSlots = function () {
                arePadsAssignedToSlots = !arePadsAssignedToSlots;
                for (var i = 0; i < 16; i++) {
                    var ctrl = controls.pads[i];
                    if (arePadsAssignedToSlots)
                        ctrl.config.splice(2, 6, 8, 10, 0x24 + i, 0, 0x7F, 1);
                    else
                        ctrl.config.splice(2, 6, 9, 9, 0x24 + i, 0x20, 0x7F, 1);        // Midi note mode
                    ctrl.configure();
                    if (!arePadsAssignedToSlots)
                        ctrl.isLit = false;
                    else
                        setPadLights();
                }
            };

            var padTrackBank = host.createTrackBank(4, 0, 4);       // Create a trackbank that follows the select track
            padTrackBank.followCursorTrack(cTrack);
            //	scrollTracksUp ()           -- could be assigned to P5 if padTrackBank wasn't linked to main track cursor
            //  setTrackScrollStepSize(4)   -- if not linked to cTrack
            var slotPlaybackStates = [];

            for (var i = 0; i < 4; i++) {
                var track = padTrackBank.getTrack(i);
                var launcherBank = track.clipLauncherSlotBank();
                launcherBank.addPlaybackStateObserver((function (slotIndex, playbackState, isQueued) {
                    var padIndex = (slotIndex * 4) + i;
                    slotPlaybackStates[padIndex] = { playbackState: playbackState, isQueued: isQueued };
                    if (arePadsAssignedToSlots)
                        controls.pads[padIndex].isLit = playbackState == "playing";
                }).bind(this));
            }

            var padLightsFlipFlop = 0;
            var setPadLights = function () {
                if (!arePadsAssignedToSlots) return;
                padLightsFlipFlop++;

                for (var i = 0; i < 16; i++) {
                    var isLit = false;
                    var state = slotPlaybackStates[i];
                    switch (state.playbackState) {
                        case "playing": isLit = state.isQueued ? (padLightsFlipFlop & 1) == 1 : true; break;
                        case "stopping": isLit = state.isQueued ? (padLightsFlipFlop & 3) != 3 : false; break;
                    }
                    controls.pads[padIndex].isLit = isLit;
                }
                host.scheduleTask(setPadLights, [], 250);
            }

            this.onPad = function (ctrl, isDown) {
                if (!isDown) return;
                var track = padTrackBank.getTrack(Math.abs(ctrl.index / 4));
                var launcherBank = track.clipLauncherSlotBank();
                launcherBank.select(ctrl.index % 4);
                var slot = launcherBank.getItemAt(ctrl.index % 4);

                if (slot.isPlaybackQueued().get()) {
                    launcherBank.returnToArrangement();
                } else if (slot.isPlaying().get()) {
                    //launcherBank.stop();
                    launcherBank.returnToArrangement();
                } else {
                    launcherBank.launch(ctrl.index % 4);
                }
            }

            this.name = "Mix Mode";
            var MULTI_MODE = this;

            var panelLayouts = ["ARRANGE", "MIX", "EDIT"];
            var panelLayoutName = "";
            var panelLayoutsIndex = 0;
            application.panelLayout().addValueObserver((function (value) {
                panelLayoutName = value;
                panelLayoutsIndex = panelLayouts.indexOf(value);
                if (this.active)
                    this.setIndication();
            }).bind(this));

            //arranger.isPlaybackFollowEnabled ()
            arranger.areCueMarkersVisible().markInterested();
            arranger.isIoSectionVisible().markInterested();
            arranger.areEffectTracksVisible().markInterested();
            arranger.hasDoubleRowTrackHeight().markInterested();
            arranger.isTimelineVisible().markInterested();
            arranger.isClipLauncherVisible().markInterested();

            var observable = function (fnClick, fngetIsOn) { return { onClick: fnClick, getIsOn: fngetIsOn }; };

            var action = function (fnClick, fnAddObserver) {
                var value = false;
                if (typeof fnAddObserver !== 'undefined')
                    fnAddObserver(function (_) {
                        value = _;
                        this.setIndication();
                    });
                return observable(fnClick, function () { return value; });
            };

            var adapt = function (observable) {
                var value = false;
                observable.addValueObserver(function (_) { value = _; this.setIndication(); });
                return observable(function () { return value; }, function () { observable.toggle(); });
            };

            var buttonActions = [
                /*0*/ observable(function () { application.setPanelLayout(panelLayouts[0]); }, function () { return panelLayoutIndex == 0; }),
                /*1*/ observable(function () { application.setPanelLayout(panelLayouts[1]); }, function () { return panelLayoutIndex == 1; }),
                /*2*/ observable(function () { application.setPanelLayout(panelLayouts[2]); }, function () { return panelLayoutIndex == 2; }),
                /*3*/ observable(function () { }), //!!
                /*4*/ observable(function () { }), //!!
                /*5*/ observable(function () { }), //!!
                /*6*/ adapt(arranger.isClipLauncherVisible()),
                /*7*/ adapt(arranger.isTimelineVisible()),
                /*8*/ DRUMPADS ? action(function () { arePadsAssignedToSlots ? padTrackBank.scrollScenesUp() : shiftPads(-1); }) : observable(function () { }),
                /*9*/ DRUMPADS ? action(function () { arePadsAssignedToSlots ? padTrackBank.scrollScenesDown() : shiftPads(+1); }) : observable(function () { })
            ];

            this.onLongButton = function (ctrl) {
                switch (ctrl.index) {
                    //case 0: application.toggleInspector(); return;
                    case 0: application.toggleDevices(); return;
                    case 1: application.toggleMixer(); return;
                    case 2: application.toggleNoteEditor(); return;
                    case 3: application.toggleInspector(); return;
                    case 4: break;
                    case 5: break;
                    case 6: break;
                    case 7: arranger.hasDoubleRowTrackHeight().toggle(); return;
                    case 8: break;      // Pads to drum-pad mode
                    case 9: break;      // Pads to clip-launcher mode
                }
            };

            this.onButton = function (ctrl) { buttonActions[ctrl.index].onClick(); };

            this.setIndication = function () {
                if (!this.active && arePadsAssignedToSlots)
                    togglePadsAssignedToSlots();

                cTrack.getPan().setIndication(this.active);
                cTrack.getSend(0).setIndication(this.active);
                cTrack.getSend(1).setIndication(this.active);
                cTrack.getSend(2).setIndication(this.active);
                controls.multi.isLit = this.active;

                for (var i = 0; i < 4; i++) {
                    var track = padTrackBank.getTrack(i);
                    var launcherBank = track.clipLauncherSlotBank();
                    launcherBank.setIndication(arePadsAssignedToSlots);
                }

                setPadLights();

                for (var i = 0; i < 10; i++)
                    controls.buttons[i].isLit = buttonActions[i].getIsOn();
            };

            this.onEncoder = function (ctrl, inc) {
                switch (ctrl.index) {
                    case 0: cTrack.getPan().inc(inc, 127); return;
                    case 1: cTrack.getSend(0).inc(inc, 128); return;
                    case 2: cTrack.getSend(1).inc(inc, 128); return;
                    case 3: cTrack.getSend(2).inc(inc, 128); return;
                    case 4: ///???
                        return;
                    case 5: transport.incPosition(inc, true); return;
                    case 6: transport.getInPosition().incRaw(inc); return;
                    case 7: transport.getOutPosition().incRaw(inc); return;
                    case 8: transport.increaseTempo(inc, 647); return;
                    case 9: // if pads are assigned to launcher slots...
                        inc > 0 ? padTrackBank.scrollScenesDown() : padTrackBank.scrollScenesUp();
                        return;
                }
                //this.prototype.onEncoder(ctrl, inc);
            };
        });

    host.getMidiInPort(0).setMidiCallback(
        function (status, data1, data2) {

            switch (status & 0xF0) {
                case 0xB0:
                    var ctrl = ccMap[status & 0x0F][data1];
                    if (ctrl === undefined) {
                        println("Oh oh, can't find control for midi:");
                        printMidi(status, data1, data2);
                        break;
                    }

                    switch (ctrl.type) {
                        case "Mode": if (data2 == 0) mode.onMode(ctrl.name == "Multi"); return;
                        case "Bank": if (data2 == 0) mode.onBank(this.bank); return;
                        case "Volume": mode.onVolume(data2 - 64); return;
                        case "Fader": mode.onFader(ctrl, data2); return;
                        case "Knob": mode.onEncoder(ctrl, data2 - 64); return;
                        case "Pad": mode.onPad(ctrl, data2 > 0); return;
                        case "Button":
                            if (data2 == 0) {
                                if (data1 == ctrl.config[3])
                                    mode.onButton(ctrl);
                                else
                                    mode.onLongButton(ctrl);
                            }
                            return;
                        case "Other":
                            switch (ctrl.name) {
                                case "Param": mode.onParam(data2 - 64); return;
                                case "Value": mode.onValue(data2 - 64); return;
                                case "Param Click": if (data2 == 0) mode.onParamClick(); return;
                                case "Value Click": if (data2 == 0) mode.onValueClick(); return;
                            }
                            break;
                    }
            }
        }
    );

    var transport = this.transport = host.createTransport();
    transport.isPlaying().addValueObserver(
        function (playing) {
            isPlaying = playing;
            controls.play.isLit = playing;
            controls.stop.isLit = !playing;
        });
    transport.isArrangerLoopEnabled().addValueObserver(function (isLoopOn) { controls.loop.isLit = isLoopOn; });
    transport.isArrangerRecordEnabled().addValueObserver(function (isRecordActive) { controls.record.isLit = isRecordActive; });

    host.getMidiInPort(0).setSysexCallback(
        function (data) {
            if (data.substring(0, 4) == "f07f" && data.substring(6, 8) == "06") {
                var ctrl = mmcMap[data.substring(8, 10)];
                if (ctrl !== undefined)
                    switch (ctrl.name) {
                        case "Rewind": transport.rewind(); return;
                        case "Forward": transport.fastForward(); return;
                        case "Play": transport.togglePlay(); return;
                        case "Record": transport.record(); return;
                        case "Loop": transport.toggleLoop(); return;
                        case "Stop": isPlaying ? transport.stop() : transport.tapTempo(); return;
                    }
            }
            println("Unknown sysex:" + data);
        }
    );

    sendSysex("F0 00 20 6B 7F 42 02 00 40 02 7F F7");

    for (var i = 0; i < allControls.length; i++)
        allControls[i].configure();

    for (var i = 0; i < allControls.length; i++)
        host.scheduleTask(allControls[i].configure, [], 100 * i);

    setMode(SOUND_MODE);

    sendTextToKeyLab("Connected to", "Bitwig");

    return this;
}

function init() {
    kL = KeyLab();
}

function exit() {
}

/*
                    |  1 |  2 |    3 |   4 |   5 | 6 |40|41|Fad|Enc|Btn|Trnsprt|Pad|
Off				    | 00 |  - |    - |   - |   - | - |  |  | x | x | x |   x   | x |
CC Fader            | 01 | CH |   CC | MIN | MAX | 0 | 0| 1| x |   |   |       |   |
CC Encoder          | 01 | CH |   CC | MIN | MAX | 0 | 1| 5|   | x |   |       |   |
CC Relative         | 01 | CH |   CC |   0 |  7F | 1 | 1| 5|   | x |   |       |   |
CC Duration         | 05 | CH |   CC |  CC | CC2 | 0 | 0|  |   |   | x |   x   |   |
CC Toggle           | 08 | CH |   CC | OFF |  ON | 0 |  |  |   |   | x |   x   | x |
CC Gate             | 08 | CH |   CC | OFF |  ON | 1 |  |  |   |   | x |   x   | x |
Midi Note Toggle    | 09 | CH | NOTE |   0 | VEL | 0 |  |  |   |   | x |   x   | x |
Midi Note Gate      | 09 | CH | NOTE |   0 | VEL | 1 |  |  |   |   | x |   x   | x |
Keyboard Preset     | 0B |  0 |  0-9 |   0 |   0 | 0 |  |  |   |   | x |   x   | x |
MMC                 | 07 |  0 |  MMC |   0 |   0 | 0 |  |  |   |   | x |   x   |   |
NRPN                | 04 | CH |  RPN | MIN | MAX | 0 |  |  | x | x |   |       | x |
RPN                 | 04 | CH | NRPN | MIN | MAX | 1 |  |  | x | x |   |       | x |
Program Change      | 0B | CH | PROG | LSB | MSB | 1 |  |  |   |   | x |   x   |   |

Where:
        MIN, MAX, ON, OFF   :	Midi cc values from 0 - 0x7F sent by ther control.
        CC, CC1, CC2	      : Midi CC number for normal and long-press respectively.
        VEL                 : Max (or fixed) velocity for note-on events.
        CH                  :	0-0x0F = Midi Channel 1-16
                                0x41   = Part1
                                0x40   = Part2
                                0x7E   = All
                                0x7F   = Panel
BB (Control ID):    0x40		Mod Wheel
Note: Buttons get msg 06 & 40 from ctrl center!!!
Encoders get msgs 1-6 + 40=1 & 41=5  always


//IDRequest: "F07E7F0601F7",
//IDResponse: "F07E00060200206B0200054806000201F7",

            */