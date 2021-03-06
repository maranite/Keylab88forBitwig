var kL = null;

function Observable(value, max, min, name) {
    var observers = [];
    this.addValueObserver = function (observer) {
        observers.push(observer);
        if (typeof value !== 'undefined')
            observer(value);
    };
    var notify = this.notify = function () { observers.forEach(function (observer) { observer(value); }); };
    this.inc = function (inc, range) {
        value += inc;
        notify();
    };
    this.get = function () { return value; };
    this.set = function (newValue) {
        if (value !== newValue) {
            if (typeof name === "string")
                println("Observable " + name + " set to " + newValue);
            value = newValue;
            if (typeof max !== 'undefined' && value > max)
                value = max;
            if (typeof min !== 'undefined' && value < min)
                value = min;
            notify();
        }
    };
    this.inc = function (_) { this.set(value + _); };
}

Array.prototype.remove = function (item) {
    var indexOf;
    for (var i = 0; i < arguments.length; i++) {
        while ((indexOf = this.indexOf(arguments[i])) !== -1)
            this.splice(indexOf, 1);
    }
    return this;
};

String.prototype.toProperCase = function () {
    return this.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};

function objectFromArray(array) {
    var result = {};
    array.forEach(function (_) { result[_.name] = _; });
    return result;
}

var flushQueue = [];

function flush() {
    while (flushQueue.length > 0)
        flushQueue.shift()();
}


function KeyLab() {
    var midiInKeys = this.midiInKeys = host.getMidiInPort(0).createNoteInput("Keys", "80????", "90????", "B001??", "B002??", "B00B??", "B040??", "C0????", "D0????", "E0????");
    this.midiInKeys.setShouldConsumeEvents(true);  // Disable the consuming of events by the NoteInputs, so they are also sent to onMidi

    if (DRUMPADS) { // Check if Drumpads are available for the model, if yes, create an Input for them
        var midiInPads = this.midiInPads = host.getMidiInPort(0).createNoteInput("Pads", "?9????");
        this.midiInPads.setShouldConsumeEvents(false);
        // Translate Poly AT to Timbre:
        this.midiInPads.assignPolyphonicAftertouchToExpression(9, NoteExpression.TIMBRE_UP, 2);
    }

    var midiOut = host.getMidiOutPort(0);

    var sendSysex = function sendSysex(sysex) {
        const sysexPreamble = "F0 00 20 6B 7F 42 ";
        if (!sysex.startsWith(sysexPreamble))
            sysex = sysexPreamble + sysex + "F7";

        var sender = function () { midiOut.sendSysex(sysex); };

        flushQueue.push(sender);
    };

    var loadMemory = function (preset) { sendSysex("05 " + uint7ToHex(preset)); };
    var saveMemory = function (preset) { sendSysex("06 " + uint7ToHex(preset)); };
    var getValue = function (id, cmd) { sendSysex("01 00 " + uint7ToHex(cmd) + uint7ToHex(id)); };
    var setValue = function (id, cmd, val) { sendSysex("02 00 " + uint7ToHex(cmd) + uint7ToHex(id) + uint7ToHex(val)); };
    var setValues = function (id, config) {
        var cmd = ["01 ", "02 ", "03 ", "04 ", "05 ", "06 ", "40 ", "41 "];
        config.forEach(function (cfg, i) {
            sendSysex("02 00 " + cmd[i] + uint7ToHex(id) + uint7ToHex(cfg));
        });
    }   ;

    var setKeylabDisplay = function (line1, line2) {
        sendSysex("04 00 60 01 " + (line1 || "").toHex(16) + "00 02 " + (line2 || "").toHex(16) + "00 ");
    };

    var ccMap = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
    var mmcMap = {};

    setKeylabDisplay("Configuring", "Keylab");
    sendSysex("F0 00 20 6B 7F 42 02 00 40 02 7F F7");

    // Defines a binding between a control and an action
    function Binding(control) {
        var enabled = false;
        var isLit = false;
        var action = undefined;
        var fnSetIsLit = (typeof control.isLit === 'object' && typeof control.isLit.set === 'function') ? control.isLit.set : function (_) { };

        Object.defineProperties(this, {
            control: { value: control },
            action: {
                get: function () { return action; },
                set: function (value) {
                    if (action === value) return;
                    var wasEnabled = enabled;
                    if (wasEnabled)
                        this.enabled = false;
                    action = value;
                    if (wasEnabled)
                        this.enabled = wasEnabled;
                }
            },
            enabled: {
                get: function () { return enabled; },
                set: function (value) {
                    if (enabled !== value) {
                        enabled = value;

                        if (typeof action === "undefined" || action === null)
                            return;

                        if (typeof action.setIndication === 'function')
                            action.setIndication(value);

                        if (value) {
                            if (action !== null)
                                action.bindings.push(this);

                            control.action = action;
                            fnSetIsLit(isLit);
                        } else {
                            if (action !== null)
                                action.bindings.remove(this);

                            if (control.action === action) {
                                control.action = null;
                                fnSetIsLit(false);
                            }
                        }
                    }
                }
            }
        });

        this.setLED = function (value) {
            if (typeof value === 'boolean') {
                isLit = value;
                fnSetIsLit(value);
            }
        };
    }

    controls = (function () {
        function AnyControl(id, type, name, _config) {
            this.action = null;
            var config = [];
            Object.defineProperties(this, {
                "id": { value: id },
                "type": { value: type },
                "name": { value: name },
                "config": {
                    get: function () { return config; },
                    set: function (c) {
                        config = c;
                        switch (config[0]) {
                            case 5:
                                ccMap[config[1]][config[4]] = this;         // long press
                                ccMap[config[1]][config[2]] = this;         // short press
                                break;
                            case 1:
                            case 8:
                                ccMap[config[1]][config[2]] = this;
                                break;
                            case 7:
                                mmcMap[config[2].toString(16)] = this;
                                break;
                        }

                        setValues(id, config);
                        if (id === 0x6E)
                            setValues(0x0A, config);
                    }
                }
            });
            this.config = [].slice.call(arguments, 3);
        }

        function Clickable() {
            this.isPressed = new Observable(false);
            this.onMidi = function onMidi(status, data1, data2) {
                this.isPressed.set(data2 > 0);
                if (data2 > 0) {
                    if (this.action !== null && 'click' in this.action)
                        this.action.click(this);
                }
                else {
                    if ('isLit' in this)
                        this.isLit.notify();
                }
            };
        }

        function LedControl() {
            var isLit = new Observable(false);
            Object.defineProperties(this, { "isLit": { value: isLit } });
            var id = this.id;
            isLit.addValueObserver(function (lit) { setValue(id, 0x10, lit ? 1 : 0); });
        }

        function Transport(id, name, mmcID) {
            AnyControl.call(this, id, "Transport", name, 7, 0, mmcID, 0, 0xF7, 1);
            LedControl.call(this);
        }

        function BankButton(id, bank, cc) {
            AnyControl.call(this, id, "Bank", "Bank " + bank, 8, 0, cc, 0, 127, 1);
            LedControl.call(this);
            Clickable.call(this);
            Object.defineProperty(this, "bank", { value: bank });
        }

        function ModeButton(id, name, cc) {
            AnyControl.call(this, id, "Mode", name, 8, 0, cc, 0, 127, 1);
            LedControl.call(this);
            Clickable.call(this);
        }

        function KnobButton(id, name, cc) {
            AnyControl.call(this, id, "Button", name, 8, 0, cc, 0, 127, 1);
            LedControl.call(this);
            Clickable.call(this);
        }

        function Switch(id, index, cc) {
            AnyControl.call(this, id, "Button", "S" + (1 + index), 8, 0, cc, 0, 1, 1);
            LedControl.call(this);
            Clickable.call(this);
            Object.defineProperty(this, "index", { value: index });
        }

        function Knob(id, name, bank, index, cc) {
            AnyControl.call(this, id, "Knob", name, 1, 0, cc, 0, 0x7F, 1);

            if (typeof index === 'number')
                Object.defineProperty(this, "index", { value: index });
            if (typeof bank === 'number')
                Object.defineProperty(this, "bank", { value: bank });

            this.onMidi = function onMidi(status, data1, data2) {
                if (this.action === null)
                    return;

                if (typeof this.action.inc === 'function')
                    this.action.inc(data2 - 64);
            };
        }

        function Fader(id, bank, index, cc) {
            AnyControl.call(this, id, "Fader", "F" + index + " (Bank " + bank + ")", 1, 0, cc, 0, 0x7F, 1);
            Object.defineProperty(this, "index", { value: index });
            Object.defineProperty(this, "bank", { value: bank });
        }

        function Pad(id, index, note) {
            AnyControl.call(this, id, "Pad", "Pad " + (1 + index), 9, 9, note, 0x20, 0x7F, 1);
            LedControl.call(this);
            Object.defineProperty(this, "index", { value: index });
        }

        return {
            volume: new Knob(0x30, "Volume", undefined, undefined, 0x07),
            param: new Knob(0x31, "Param", undefined, undefined, 0x70),
            value: new Knob(0x33, "Value", undefined, undefined, 0x72),
            paramButton: new KnobButton(0x32, "Param Click", 0x71),
            valueButton: new KnobButton(0x34, "Value Click", 0x73),
            sound: new ModeButton(0x1E, "Sound", 0x76),
            multi: new ModeButton(0x1F, "Multi", 0x77),
            bank1: new BankButton(0x1D, 1, 0x2E),
            bank2: new BankButton(0x1C, 2, 0x2F),
            play: new Transport(0x58, "Play", 2),
            stop: new Transport(0x59, "Stop", 1),
            record: new Transport(0x5A, "Record", 6),
            rewind: new Transport(0x5B, "Rewind", 5),
            forward: new Transport(0x5C, "Forward", 4),
            loop: new Transport(0x5D, "Loop", 7),
            // transpose buttons???
            buttons: [
                new Switch(0x12, 0, 0x16, 0x68),
                new Switch(0x13, 1, 0x17, 0x69),
                new Switch(0x14, 2, 0x18, 0x6A),
                new Switch(0x15, 3, 0x19, 0x6B),
                new Switch(0x16, 4, 0x1A, 0x6C),
                new Switch(0x17, 5, 0x1B, 0x6D),
                new Switch(0x18, 6, 0x1C, 0x6E),
                new Switch(0x19, 7, 0x1D, 0x6F),
                new Switch(0x1A, 8, 0x1E, 0x74),
                new Switch(0x1B, 9, 0x1F, 0x75)
            ],
            knobs: [
                new Knob(0x01, "P 1 (Bank 1)", 1, 0, 0x47),
                new Knob(0x02, "P 2 (Bank 1)", 1, 1, 0x46),
                new Knob(0x03, "P 3 (Bank 1)", 1, 2, 0x4C),
                new Knob(0x04, "P 4 (Bank 1)", 1, 3, 0x4D),
                new Knob(0x09, "P 5 (Bank 1)", 1, 4, 0x5D),
                new Knob(0x05, "P 6 (Bank 1)", 1, 5, 0x12),
                new Knob(0x06, "P 7 (Bank 1)", 1, 6, 0x13),
                new Knob(0x07, "P 8 (Bank 1)", 1, 7, 0x10),
                new Knob(0x08, "P 9 (Bank 1)", 1, 8, 0x11),
                new Knob(0x6E, "P10 (Bank 1)", 1, 9, 0x5B),       // Special case knob that can also have ID 0x0A.  Arturia are cunts.
                new Knob(0x21, "P 1 (Bank 2)", 2, 0, 0x23),
                new Knob(0x22, "P 2 (Bank 2)", 2, 1, 0x24),
                new Knob(0x23, "P 3 (Bank 2)", 2, 2, 0x25),
                new Knob(0x24, "P 4 (Bank 2)", 2, 3, 0x26),
                new Knob(0x29, "P 5 (Bank 2)", 2, 4, 0x27),
                new Knob(0x25, "P 6 (Bank 2)", 2, 5, 0x28),
                new Knob(0x26, "P 7 (Bank 2)", 2, 6, 0x29),
                new Knob(0x27, "P 8 (Bank 2)", 2, 7, 0x2A),
                new Knob(0x28, "P 9 (Bank 2)", 2, 8, 0x2B),
                new Knob(0x2A, "P10 (Bank 2)", 2, 9, 0x2C)
            ],
            pads: [
                new Pad(0x70, 0, 0x24),
                new Pad(0x71, 1, 0x25),
                new Pad(0x72, 2, 0x26),
                new Pad(0x73, 3, 0x27),
                new Pad(0x74, 4, 0x28),
                new Pad(0x75, 5, 0x29),
                new Pad(0x76, 6, 0x2A),
                new Pad(0x77, 7, 0x2B),
                new Pad(0x78, 8, 0x2C),
                new Pad(0x79, 9, 0x2D),
                new Pad(0x7A, 10, 0x2E),
                new Pad(0x7B, 11, 0x2F),
                new Pad(0x7C, 12, 0x30),
                new Pad(0x7D, 13, 0x31),
                new Pad(0x7E, 14, 0x32),
                new Pad(0x7F, 15, 0x33)
            ],
            faders: [
                new Fader(0x0B, 1, 0, 0x49),
                new Fader(0x0C, 1, 1, 0x4B),
                new Fader(0x0D, 1, 2, 0x4F),
                new Fader(0x0E, 1, 3, 0x48),
                new Fader(0x4B, 1, 4, 0x50),
                new Fader(0x4C, 1, 5, 0x51),
                new Fader(0x4D, 1, 6, 0x52),
                new Fader(0x4E, 1, 7, 0x53),
                new Fader(0x4F, 1, 8, 0x55),
                new Fader(0x2B, 2, 0, 0x49),         // 0x43
                new Fader(0x2C, 2, 1, 0x4B),         // 0x44
                new Fader(0x2D, 2, 2, 0x4F),         // 0x45
                new Fader(0x2E, 2, 3, 0x48),         // 0x46
                new Fader(0x6B, 2, 4, 0x50),         // 0x57
                new Fader(0x6C, 2, 5, 0x51),         // 0x58
                new Fader(0x6D, 2, 6, 0x52),         // 0x59
                new Fader(0x6E, 2, 7, 0x53),         // 0x5A
                new Fader(0x6F, 2, 8, 0x55)          // 0x5C
            ]
        };
    })();

    var masterTrack = host.createMasterTrack(0);
    masterTrack.getVolume().setIndication(true);

    var tracks = host.createMainTrackBank(9, 0, 0);
    var scenes = tracks.getClipLauncherScenes();
    for (var j = 0; j < 9; j++) {
        tracks.getTrack(j).getVolume().markInterested();
        tracks.getTrack(j).getVolume().setIndication(true);
    }

    var preferences = host.getPreferences();
    var application = this.application = host.createApplication();
    var hostActions = this.hostActions = new function () {
        var categories = application.getActionCategories();
        for (var i = 0; i < categories.length; i++) {
            var thisCat = this[categories[i].getName()] = {};
            var actions = categories[i].getActions();
            for (var j = 0; j < actions.length; j++)
                thisCat[actions[j].getName()] = actions[j];
        }
    }();

    var cTrack = host.createArrangerCursorTrack(3, 4);      // 4 scene slots
    var cDevice = cTrack.createCursorDevice();
    var cDeviceSlot = cDevice.getCursorSlot();

    var deviceIsPlugin = false; cDevice.isPlugin().addValueObserver(function (_) { deviceIsPlugin = _; });
    var deviceIsWindowOpen = false; cDevice.isWindowOpen().addValueObserver(function (_) { deviceIsWindowOpen = _; });
    var deviceHasNext = false; cDevice.hasNext().addValueObserver(function (_) { deviceHasNext = _; });
    var deviceHasPrevious = false; cDevice.hasPrevious().addValueObserver(function (_) { deviceHasPrevious = _; });
    var deviceIsNested = false; cDevice.isNested().addValueObserver(function (_) { deviceIsNested = _; });
    var deviceHasSlots = false; cDevice.hasSlots().addValueObserver(function (_) { deviceHasSlots = _; });
    var deviceHasDrumPads = false; cDevice.hasDrumPads().addValueObserver(function (_) { deviceHasDrumPads = _; });
    var deviceIsExpanded = false; cDevice.isExpanded().addValueObserver(function (_) { deviceIsExpanded = _; });
    var deviceExists = false; cDevice.exists().addValueObserver(function (_) { deviceExists = _; });
    var deviceIsEnabled = false; cDevice.isEnabled().addValueObserver(function (_) { deviceIsEnabled = _; });
    var deviceIsRemoteControlsSectionVisible = false; cDevice.isRemoteControlsSectionVisible().addValueObserver(function (_) { deviceIsRemoteControlsSectionVisible = _; });
    var deviceIsMacroSectionVisible = false; cDevice.isMacroSectionVisible().addValueObserver(function (_) { deviceIsMacroSectionVisible = _; });
    var deviceName = false; cDevice.name().addValueObserver(function (_) {
        deviceName = _;
        setKeylabDisplay("Device:", _);
    });
    var deviceSlotNames = false; cDevice.slotNames().addValueObserver(function (_) {
        deviceSlotNames = [].slice.call(_);
    });
    var deviceSlotName = false; cDeviceSlot.name().addValueObserver(function (_) { deviceSlotName = _; });
    var deviceSlotExists = false; cDeviceSlot.exists().addValueObserver(function (_) { deviceSlotExists = _; });

    var browser = cDevice.createDeviceBrowser(1, 1);
    var cBrowser = browser.createCursorSession();
    var arranger = host.createArranger();
    var mixer = host.createMixer();
    var cRemote = cDevice.createCursorRemoteControlsPage(8);
    var remotePageNames = []; cRemote.pageNames().addValueObserver(function (_) { remotePageNames = _; });
    var remotePageIndex = 0; cRemote.selectedPageIndex().addValueObserver(function (value) { remotePageIndex = value; });

    var popup = host.createPopupBrowser();

    var bank = new Observable(1, undefined, undefined, "BANK");
    var mode = new Observable("Arrange", undefined, undefined, "MODE");		// valid values: Arrange, Mix, Edit, Browse

    popup.exists().addValueObserver(function (browsing) {
        if (browsing)
            hostActions.Browser["Focus Browser File List"].invoke();

        mode.set(browsing ? "Browse" : panelLayoutName.toProperCase());
    });

    var panelLayouts = ["ARRANGE", "MIX", "EDIT"];
    var panelLayoutName = "";
    var panelLayoutIndex = 0;

    application.panelLayout().addValueObserver(function (value) {
        panelLayoutName = value;
        println("Panel Layout: " + value);
        panelLayoutIndex = panelLayouts.indexOf(value);
        mode.set(value.toProperCase());
    });

    var transport = host.createTransport();
    transport.isArrangerLoopEnabled().addValueObserver(controls.loop.isLit.set);
    transport.isArrangerRecordEnabled().addValueObserver(controls.record.isLit.set);
    transport.isPlaying().addValueObserver(function (playing) {
        controls.play.isLit.set(playing);
        controls.stop.isLit.set(!playing);
    });

    var moveCursor = function (cursor, inc) {
        if (cursor !== undefined)
            inc > 0 ? cursor.selectNext() : cursor.selectPrevious();
    };

    var moveCursorDevice = function (inc) {
        if (!deviceExists)
            return;

        if (deviceIsExpanded) {
            if (inc > 0) {
                if (deviceSlotExists) {
                    cDevice.selectFirstInSlot(deviceSlotName);
                    return;
                }
                //if (cDevice.hasDrumPads().get()) {
                //    println("Selecting Drumpad");
                //    cDevice.selectFirstInKeyPad(0x24);
                //    return;
                //}
            }
        }
        if (deviceIsNested && !(inc > 0 ? deviceHasNext : deviceHasPrevious))
            cDevice.selectParent();

        inc > 0 ? cDevice.selectNext() : cDevice.selectPrevious();
        cDevice.selectInEditor();
    };

    var actions = new (function CreateActions() {

        function cycleDeviceVisibility() {
            if (cDevice.isPlugin().get()) {
                cDevice.isWindowOpen().toggle();
                if (remotePageNames.length > 0)
                    cDevice.isRemoteControlsSectionVisible().set(true);
            }
            else {
                if (deviceIsExpanded) {
                    if (!deviceIsRemoteControlsSectionVisible) {
                        cDevice.isRemoteControlsSectionVisible().toggle();
                        return;
                    }
                }
                cDevice.isExpanded().toggle();
            }
        }

        var autoConfirmDelete = false;
        preferences.getEnumSetting("Auto-Confirm Delete?", "Browser", ["Yes", "No"], "No").addValueObserver(function (_) { autoConfirmDelete = _; });

        var tabNames = [];
        popup.contentTypeNames().addValueObserver(function (_) { tabNames = _; });

        var autoSelectFirstResult = false;
        preferences.getEnumSetting("Auto-Select first result?", "Browser", ["Yes", "No"], "Yes").addValueObserver(function (_) { autoSelectFirstResult = _; });

        var cResult = popup.resultsColumn().createCursorItem();
        cResult.addValueObserver(32, "", function (val) {
            if (val && val.length > 0 && mode.get() === "Browse")
                setKeylabDisplay(val, "");
        });

        function moveAndSelect(cursor, inc) {
            moveCursor(cursor, inc);
            if (autoSelectFirstResult)
                flushQueue.push(function () {
                    hostActions.Browser["Focus Browser File List"].invoke();
                    hostActions["Selection Navigation"]["Select first item"].invoke();
                });
        }

        var padBankSize = 4;
        var padTrackBank = host.createTrackBank(padBankSize, 0, padBankSize);       // Create a track bank that follows the select track
        padTrackBank.followCursorTrack(cTrack);

        var padsMode = new Observable("Pads");		// "Launcher", "Pads"
        padsMode.addValueObserver(function (value) {
            controls.pads.forEach(function (ctrl, i) {
                if (value === "Launcher") {
                    ctrl.config = [8, 10, 0x24 + i, 0, 0x7F, 1];
                    ctrl.isLit.set(false);
                } else
                    ctrl.config = [9, 9, 0x24 + i, 0x20, 0x7F, 1];     // Pads: Midi note mode
            });

            //for (var r = 0; r < 4; r++)
            //    padTrackBank.getTrack(r).clipLauncherSlotBank().setIndication(value === "Launcher");
        });

        var padsOffset = new Observable(0, -48, 64);
        padsOffset.addValueObserver(function (value) {
            var padTranslation = new Array(128);
            for (var i = 0; i < 128; i++) {
                padTranslation[i] = (value < 0 || value > 127) ? -1 : value;
                value++;
            }
            midiInPads.setKeyTranslationTable(padTranslation);
            host.showPopupNotification("Pad Offset:" + value < 0 ? "-" : "" + value);
            setKeylabDisplay("Pad Offset:" + value < 0 ? "-" : "" + value);
        });

        // Creates an Action appropriate for Knob controls
        function KnobAction(name, fnInc) {
            Object.defineProperty(this, "name", { value: name });
            var bindings = this.bindings = [];
            if (typeof fnInc.inc === 'function') {
                this.inc = function (_) { fnInc.inc(_, 128); };

                if (typeof fnInc.setIndication === 'function') {
                    var indicationcount = 0;
                    this.setIndication = function (_) {
                        indicationcount = Math.max(0, indicationcount + _ ? 1 : -1);
                        fnInc.setIndication(indicationcount > 0);
                    };
                }
            }
            else if (typeof fnInc === 'function')
                this.inc = fnInc;
            else
                println("Configuration error on KnobAction " + name);
        }

        // Creates an action that responds to a clickable control 
        function ClickAction(name, handler, valueOrObserver) {
            var bindings = this.bindings = [];
            var setLit = function setLit(value) { bindings.forEach(function (binding) { binding.setLED(value); }); };

            Object.defineProperties(this, { "name": { value: name } });

            if (typeof handler.addValueObserver === 'function') {  // if an observable has been passed
                if (typeof handler.set === 'function' && (typeof valueOrObserver === "number" || typeof valueOrObserver === "string")) {

                    this.click = function (_) { handler.set(valueOrObserver); };
                    handler.addValueObserver(function setLED(value) {
                        setLit(value === valueOrObserver);
                    });
                }
                else if (typeof handler.toggle === 'function') {

                    this.click = function (_) { handler.toggle(); };
                    handler.addValueObserver(setLit);
                } else
                    println("Coding error on ClickAction " + name + "  - handle is observable, but has no set or toggle");
            } else {
                this.click = handler;
                if (typeof valueOrObserver === 'function')
                    valueOrObserver(setLit);
            }
        }

        this.noButtonAction = new ClickAction("---Off---", function () { });


        var actionItems = [
            this.noButtonAction,
            new ClickAction("Inspector", function () { application.toggleInspector(); }),
            new ClickAction("Devices", function () { application.toggleDevices(); }),
            new ClickAction("Note Editor", function () { application.toggleNoteEditor(); }),
            new ClickAction("Automation", function () { application.toggleAutomationEditor(); }),
            new ClickAction("Mixer", function () { application.toggleMixer(); }),
            new ClickAction("Duplicate", function () { application.duplicate(); }),
            new ClickAction("Undo", function () { application.undo(); }),
            new ClickAction("Redo", function () { application.redo(); }),
            new ClickAction("Zoom In", function () { application.zoomIn(); }),
            new ClickAction("Zoom Out", function () { application.zoomOut(); }),
            new ClickAction("Zoom To Fit", function () { application.zoomToFit(); }),
            new ClickAction("Zoom Selection", function () { application.zoomToSelection(); }),
            new ClickAction("New Audio Track", function () { application.createAudioTrack(-1); }),
            new ClickAction("New Effect Track", function () { application.createEffectTrack(-1); }),
            new ClickAction("New Instrument Track", function () { application.createInstrumentTrack(-1); }),
            new ClickAction("Show Plugin", cDevice.isWindowOpen()),
            new ClickAction("Expand Device", cDevice.isExpanded()),
            new ClickAction("Expand <-> Remote", function () { cycleDeviceVisibility(); }),
            new ClickAction("Expand/Show Device",
                function () { (deviceIsPlugin ? cDevice.isWindowOpen() : cDevice.isExpanded()).toggle(); },
                function (fnSet) {
                    cDevice.isWindowOpen().addValueObserver(function (_) { if (deviceIsPlugin) fnSet(_); });
                    cDevice.isExpanded().addValueObserver(function (_) { if (!deviceIsPlugin) fnSet(_); });
                }),
            new ClickAction("Show Remote Controls", cDevice.isRemoteControlsSectionVisible()),
            new ClickAction("Next Remote Page", function () { cRemote.selectNextPage(true); }),
            new ClickAction("Prev Remote Page", function () { cRemote.selectPreviousPage(true); }),

            new ClickAction("Arranger: Show Cue Markers", arranger.areCueMarkersVisible()),
            new ClickAction("Arranger: FX Tracks", arranger.areEffectTracksVisible()),
            new ClickAction("Arranger: Clip Launcher", arranger.isClipLauncherVisible()),
            new ClickAction("Arranger: Timeline", arranger.isTimelineVisible()),
            new ClickAction("Arranger: Big Rows", arranger.hasDoubleRowTrackHeight()),
            new ClickAction("Arranger: Follow Playback", arranger.isPlaybackFollowEnabled()),
            new ClickAction("Mixer: Meters", mixer.isMeterSectionVisible()),
            new ClickAction("Mixer: Sends", mixer.isSendSectionVisible()),
            new ClickAction("Mixer: I/O", mixer.isIoSectionVisible()),
            new ClickAction("Mixer: Devices", mixer.isDeviceSectionVisible()),
            new ClickAction("Mixer: Clip Launcher", mixer.isClipLauncherSectionVisible()),
            new ClickAction("Browse", function () { browser.startBrowsing(); }),
            new ClickAction("Browse Replace", function () { cDevice.browseToInsertBeforeDevice(); }),
            new ClickAction("Browse Insert Before", function () { cDevice.browseToReplaceDevice(); }),
            new ClickAction("Browse Insert After", function () { cDevice.browseToInsertAfterDevice(); }),
            new ClickAction("Automation Mode: Latch", transport.automationWriteMode(), "latch"),
            new ClickAction("Automation Mode: Touch", transport.automationWriteMode(), "touch"),
            new ClickAction("Automation Mode: Write", transport.automationWriteMode(), "write"),
            new ClickAction("Metronome", transport.isMetronomeEnabled()),
            new ClickAction("Metronome Tick Playback", transport.isMetronomeTickPlaybackEnabled()),
            new ClickAction("Punch In", transport.isPunchInEnabled()),
            new ClickAction("Punch Out", transport.isPunchOutEnabled()),
            new ClickAction("Track: Arm", cTrack.getArm()),
            new ClickAction("Track: Monitor", cTrack.getMonitor()),
            new ClickAction("Track: Auto Monitor", cTrack.getAutoMonitor()),
            new ClickAction("Pads: Page Up", function () { padsMode.get() === "Launcher" ? padTrackBank.scrollScenesUp() : padOffset.inc(-16); }),
            new ClickAction("Pads: Page Down", function () { padsMode.get() === "Launcher" ? padTrackBank.scrollScenesDown() : padOffset.inc(16); })
        ];

        var noKnobAction = this.noKnobAction = new KnobAction("---Off---", function () { });

        var knobActs = [
            this.noKnobAction,
            new KnobAction("Select Track", function (_) { moveCursor(cTrack, _); }),
            new KnobAction("Select Device", function (_) { moveCursorDevice(_); }),
            new KnobAction("Select Sub-Panel", function (_) { inc > 0 ? application.nextSubPanel() : application.previousSubPanel(); }),
            new KnobAction("Send MIDI CC +/-", function (_) { midiInKeys.sendRawMidiEvent(0xB0, 0x46 + (2 * index) + (_ > 0 ? 1 : 0), 0x7f); }),
            new KnobAction("Track Pan", function (_) { cTrack.getPan().inc(_); }),
            new KnobAction("Track Send 1", cTrack.getSend(0)),
            new KnobAction("Track Send 2", cTrack.getSend(1)),
            new KnobAction("Track Send 3", cTrack.getSend(2)),
            new KnobAction("Shuttle Transport", function (inc) { transport.incPosition(inc, true); }),
            new KnobAction("In Position", function (inc) { transport.getInPosition().incRaw(inc); }),
            new KnobAction("Out Position", function (inc) { transport.getOutPosition().incRaw(inc); }),
            new KnobAction("Tempo", function (inc) { transport.tempo().inc(inc, 128); }),
            new KnobAction("Scroll Scene", function (inc) { inc > 0 ? padTrackBank.scrollScenesDown() : padTrackBank.scrollScenesUp(); }),
            new KnobAction("Metronome Volume", transport.metronomeVolume())
        ];

        for (var i = 1; i <= 10; i++)
            actionItems.push(new ClickAction("Remote Page " + i, cRemote.selectedPageIndex(), i - 1));

        for (i = 1; i <= 8; i++)
            knobActs.push(new KnobAction("Remote Control " + i, cRemote.getParameter(i - 1)));


        //var userPages = 4;
        //var uControls = host.createUserControls(userPages * 8);
        //var userControlPageIndex = new Observable(0, userPages);
        //function getUControl(index, page) {
        //    page = page || userControlPageIndex.get();
        //    return uControls.getControl((page * 8) + index);
        //}

        //for (var userPageIndex = 0; userPageIndex < userPages; userPageIndex++) {
        //    for (var j = 0; j < 8; j++)
        //        uControls.getControl((userPageIndex * 8) + j).setLabel("Group " + (1+userPageIndex) + " Knob " + (1+j));

        //    actionItems.push(new ClickAction("User Page " + (1 + userPageIndex), userControlPageIndex, userPageIndex));
        //}

        //var getUserControl = function (index) { return uControls.getControl(index + (8 * userControlPageIndex.get())); };
        //for (i = 1; i <= 8; i++)
        //    knobActs.push(new KnobAction("User Control " + i, getUserControl(i - 1)));



        this.buttonActions = objectFromArray(actionItems);
        this.knobActions = objectFromArray(knobActs);

        this.browseActions = objectFromArray([
            this.noButtonAction,
            new ClickAction("Browser Tab 1", popup.selectedContentTypeIndex(), 0),
            new ClickAction("Browser Tab 2", popup.selectedContentTypeIndex(), 1),
            new ClickAction("Browser Tab 3", popup.selectedContentTypeIndex(), 2),
            new ClickAction("Browser Tab 4", popup.selectedContentTypeIndex(), 3),
            new ClickAction("Browser Tab 5", popup.selectedContentTypeIndex(), 4),
            new ClickAction("Audition On/Off", popup.shouldAudition()),
            new ClickAction("Delete Preset", function () { hostActions.General["Reveal File"].invoke(); }),
            new ClickAction("Edit Metadata", function () { hostActions.General["Edit File Metadata..."].invoke(); }),
            new ClickAction("Cancel", function () { popup.cancel(); }),
            new ClickAction("Confirm", function () { popup.commit(); }),
            new ClickAction("Delete Preset", function () {
                hostActions.General.Delete.invoke();
                if (!autoConfirmDelete)
                    return;
                moveCursor(cResult, 1);
                hostActions.General.Yes.invoke();
                hostActions.Browser["Focus Browser File List"].invoke();
            })
        ]);

        this.browseKnobActions = (function () {
            var location = popup.locationColumn().createCursorItem();
            var device = popup.deviceColumn().createCursorItem();
            var category = popup.categoryColumn().createCursorItem();
            var tag = popup.tagColumn().createCursorItem();
            var creator = popup.creatorColumn().createCursorItem();
            var smartCollection = popup.smartCollectionColumn().createCursorItem();
            var deviceType = popup.deviceTypeColumn().createCursorItem();
            var fileType = popup.fileTypeColumn().createCursorItem();
            var result = popup.resultsColumn().createCursorItem();

            return objectFromArray([
                noKnobAction,
                new KnobAction("Scroll Location", function (_) { moveAndSelect(location, _); }),
                new KnobAction("Scroll Device", function (_) { moveAndSelect(device, _); }),
                new KnobAction("Scroll Category", function (_) { moveAndSelect(category, _); }),
                new KnobAction("Scroll Tag", function (_) { moveAndSelect(tag, _); }),
                new KnobAction("Scroll Creator", function (_) { moveAndSelect(creator, _); }),
                new KnobAction("Scroll Collection", function (_) { moveAndSelect(smartCollection, _); }),
                new KnobAction("Scroll Device Type", function (_) { moveAndSelect(deviceType, _); }),
                new KnobAction("Scroll File Type", function (_) { moveAndSelect(fileType, _); }),
                new KnobAction("Scroll Result", function (_) { moveCursor(result, _); }),
                new KnobAction("Content Tab", function (_) {
                    var tabIndex = popup.selectedContentTypeIndex().get() + tabNames.length + _;
                    popup.selectedContentTypeIndex().set(tabIndex % tabNames.length);
                })
            ]);
        })();

        var masterVolumeBinding = new Binding(controls.volume);
        masterVolumeBinding.action = new KnobAction("Master Volume", masterTrack.getVolume());
        masterVolumeBinding.enabled = true;
    })();

    (function setupAllModes() {

        var buttonTemplate = {
            actions: actions.buttonActions,
            controls: controls.buttons,
            names: ["Button S01", "Button S02", "Button S03", "Button S04", "Button S05", "Button S06", "Button S07", "Button S08", "Button S09", "Button S10"],
            initials: ["---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---"]
        };

        var pvButtonTemplate = {
            actions: actions.buttonActions,
            controls: [controls.paramButton, controls.valueButton],
            names: ["Param Click", "Value Click"],
            initials: ["Browse", "Expand/Show Device"]
        };

        var knob1Template = {
            actions: actions.knobActions,
            controls: controls.knobs.filter(function (ctrl) { return ctrl.bank === 1; }),
            names: ["Knob P01", "Knob P02", "Knob P03", "Knob P04", "Knob P05", "Knob P06", "Knob P07", "Knob P08", "Knob P09", "Knob P10"],
            initials: ["---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---"]
        };

        var knob2Template = {
            actions: actions.knobActions,
            controls: controls.knobs.filter(function (ctrl) { return ctrl.bank === 2; }),
            names: ["Knob P01", "Knob P02", "Knob P03", "Knob P04", "Knob P05", "Knob P06", "Knob P07", "Knob P08", "Knob P09", "Knob P10"],
            initials: ["---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---", "---Off---"]
        };

        var pvKnobTemplate = {
            actions: actions.knobActions,
            controls: [controls.param, controls.value],
            names: ["Param", "Value"],
            initials: ["Select Track", "Select Device"]
        };

        function createPreferenceSet(section, observable, enabledValue, baseTemplate, template) {

            Object.setPrototypeOf(template, baseTemplate);
            var actions = template.actions;
            var fallback = template.fallback;
            var allActions = Object.keys(actions);

            var prefs = template.names.map(function (name, i) {
                return preferences.getEnumSetting(name, section, allActions, template.initials[i] || fallback.name);
            });

            template.controls.forEach(function (control, i) {

                var setting = prefs[i % prefs.length];

                var binding = new Binding(control);
                setting.addValueObserver(function (name) { binding.action = actions[name]; });
                observable.addValueObserver(function (value) { binding.enabled = value === enabledValue; });
            });
        }

        var setupArrange = createPreferenceSet.bind(null, "Arrange Mode", mode, "Arrange");
        var setupMix = createPreferenceSet.bind(null, "Mix Mode", mode, "Mix");
        var setupEdit = createPreferenceSet.bind(null, "Edit Mode", mode, "Edit");

        setupArrange(pvKnobTemplate, {});
        setupArrange(pvButtonTemplate, {});
        setupArrange(buttonTemplate, {
            initials: ["Remote Page 1", "Remote Page 2", "Remote Page 3", "Remote Page 4", "Remote Page 5", "Remote Page 6", "Remote Page 7", "Remote Page 8", "Remote Page 9", "Remote Page 10"]
        });

        setupMix(pvKnobTemplate, {});
        setupMix(pvButtonTemplate, {});
        setupMix(buttonTemplate, {
            initials: ["Browse Replace", "Expand <-> Remote", "Inspector", "Devices", "Note Editor", "Toggle Automation", "Toggle Mixer", "Device: Macros Panel", "Device: Remote Controls", "Next Remote Page", "Prev Remote Page", "Arranger: Big Rows", "Layout:Arrange", "Layout:Mix", "Layout:Edit"]
        });

        setupEdit(pvKnobTemplate, {});
        setupEdit(pvButtonTemplate, {});
        setupEdit(buttonTemplate, {
            initials: ["Browse Replace", "Expand <-> Remote", "Inspector", "Devices", "Note Editor", "Toggle Automation", "Toggle Mixer", "Device: Macros Panel", "Device: Remote Controls", "Next Remote Page", "Prev Remote Page", "Arranger: Big Rows", "Layout:Arrange", "Layout:Mix", "Layout:Edit"]
        });

        createPreferenceSet("Arrange: Bank 1", mode, "Arrange", knob1Template, {
            initials: ["Remote Control 1", "Remote Control 2", "Remote Control 3", "Remote Control 4", "Shuttle Transport", "Remote Control 5", "Remote Control 6", "Remote Control 7", "Remote Control 8", "Tempo"]
        });
        createPreferenceSet("Arrange: Bank 2", mode, "Arrange", knob2Template, {
            initials: ["Remote Control 1", "Remote Control 2", "Remote Control 3", "Remote Control 4", "Shuttle Transport", "Remote Control 5", "Remote Control 6", "Remote Control 7", "Remote Control 8", "Tempo"]
        });

        createPreferenceSet("Mix Mode: Bank 1", mode, "Mix", knob1Template, {
            initials: ["Track Pan", "Track Send 1", "Track Send 2", "Track Send 3", "Shuttle Transport", "In Position", "Out Position", "Scroll Scene", "---Off---", "Tempo"]
        });
        createPreferenceSet("Mix Mode: Bank 2", mode, "Mix", knob2Template, {
            initials: ["Track Pan", "Track Send 1", "Track Send 2", "Track Send 3", "Shuttle Transport", "In Position", "Out Position", "Scroll Scene", "---Off---", "Tempo"]
        });
        createPreferenceSet("Edit: Bank 1", mode, "Edit", knob1Template, {
            initials: ["Track Pan", "Track Send 1", "Track Send 2", "Track Send 3", "Shuttle Transport", "In Position", "Out Position", "Scroll Scene", "---Off---", "Tempo"]
        });
        createPreferenceSet("Edit: Bank 2", mode, "Edit", knob2Template, {
            initials: ["Track Pan", "Track Send 1", "Track Send 2", "Track Send 3", "Shuttle Transport", "In Position", "Out Position", "Scroll Scene", "---Off---", "Tempo"]
        });



        createPreferenceSet("Browsing", mode, "Browse", pvKnobTemplate, {
            initials: ["Scroll Category", "Scroll Result"],
            actions: actions.browseKnobActions
        });
        createPreferenceSet("Browsing", mode, "Browse", pvButtonTemplate, {
            initials: ["Cancel", "Confirm"],
            actions: actions.browseActions
        });
        createPreferenceSet("Browsing: Buttons", mode, "Browse", buttonTemplate, {
            actions: actions.browseActions,
            initials: ["Browser Tab 1", "Browser Tab 2", "Browser Tab 3", "Browser Tab 4", "Browser Tab 5", "Audition On/Off", "Delete Preset", "Edit Metadata", "Cancel", "Confirm", "Delete Preset"]
        });
        createPreferenceSet("Browsing: Knobs", mode, "Browse", knob1Template, {
            actions: actions.browseKnobActions,
            controls: controls.knobs,		// Note: all knobs. Bank 1 & 2 share same preference objects
            initials: ["Scroll Location", "Scroll Device", "Scroll Category", "Scroll Tag", "Scroll Creator", "Scroll Collection", "Scroll Device Type", "Scroll File Type", "Scroll Result", "Content Tab"]
        });

    })();

    var selectEditModeOnRelease = false;

    host.getMidiInPort(0).setMidiCallback(
        function onMidi(status, data1, data2) {
            switch (status & 0xF0) {
                case 0xB0:
                    var ctrl = ccMap[status & 0x0F][data1];
                    if (ctrl === undefined) {
                        println("Oh oh, can't find control for midi:");
                        printMidi(status, data1, data2);
                        break;
                    }

                    //println(ctrl.type + ':' + ctrl.name);

                    switch (ctrl.type) {
                        case "Knob":
                            ctrl.onMidi(status, data1, data2);
                            return;

                        case "Button":
                            ctrl.onMidi(status, data1, data2);
                            return;

                        case "Fader":
                            tracks.getTrack(ctrl.index).getVolume().set(data2, 128);
                            return;

                        case "Bank":
                            if (data2 === 0)
                                bank.set(ctrl.bank);
                            return;

                        case "Mode":
                            if (popup.exists().get())
                                popup.cancel();		// Cancel any browsing session
                            ctrl.onMidi(status, data1, data2);
                            if (data2 > 0) {
                                selectEditModeOnRelease = controls.multi.isPressed.get() && controls.sound.isPressed.get();
                            } else {
                                if (selectEditModeOnRelease) {
                                    application.setPanelLayout("EDIT");
                                    if (!controls.multi.isPressed.get() && !controls.sound.isPressed.get())
                                        selectEditModeOnRelease = false;
                                } else if (ctrl === controls.sound) {
                                    if (panelLayoutName === "ARRANGE")
                                        application.toggleDevices();
                                    else
                                        application.setPanelLayout("ARRANGE");
                                } else if (ctrl === controls.multi) {
                                    if (panelLayoutName === "MIX")
                                        application.toggleDevices();
                                    else
                                        application.setPanelLayout("MIX");
                                }
                            }
                            return;
                    }
            }
        }
    );

    host.getMidiInPort(0).setSysexCallback(
        function (data) {
            if (data.substring(0, 4) === "f07f" && data.substring(6, 8) === "06") {
                var ctrl = mmcMap[data.substring(8, 10)];
                if (ctrl !== undefined)
                    switch (ctrl.name) {
                        case "Rewind": transport.rewind(); return;
                        case "Forward": transport.fastForward(); return;
                        case "Play": transport.togglePlay(); return;
                        case "Record": transport.record(); return;
                        case "Loop": transport.toggleLoop(); return;
                        case "Stop": transport.isPlaying().get() ? transport.stop() : transport.tapTempo(); return;
                    }
            }
            println("Unknown sysex:" + data);
        }
    );

    mode.addValueObserver(function (_) {
        controls.sound.isLit.set(_ === "Arrange" || _ === "Edit");
        controls.multi.isLit.set(_ === "Mix" || _ === "Edit");
    });

    bank.addValueObserver(function (_) {
        controls.bank1.isLit = _ === 1;
        controls.bank2.isLit = _ === 2;
    });

    setKeylabDisplay("Welcome to", "Bitwig");

    return this;
}

function init() {
    kL = KeyLab();
}

function exit() {

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
}

