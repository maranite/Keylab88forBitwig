function NOP() { };

//var midiImports = new JavaImporter(com.bitwig.extension.api.util.midi);
var SysexBuilder = Java.type("com.bitwig.extension.api.util.midi.SysexBuilder");

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

Function.prototype.inherits = function inherits(superCtor, prototype) {
    var superProto = typeof superCtor === "function" ? superCtor.prototype : superCtor;
    if (prototype) {
        var proto = Object.create(superProto);
        if (typeof prototype === "function") {
            this.prototype = prototype.call(proto);
        } else {
            this.prototype = proto;
            //for (var prop in Object.getOwnPropertyNames(superProto)) {
            //    if (!this.prototype.hasOwnProperty(prop))
            //        Object.defineProperty(this.prototype, prop, Object.getOwnPropertyDescriptor(superProto, prop));
            //}
        }
    }
    else
        this.prototype = superProto;
}

function captureArguments(target, skip) {
    var caller = captureArguments.caller;
    var match = /function\s*\w+\s*\((.+)\)/i.exec(caller.toString());
    if (match) {
        var args = match[1].split(",");
        if (!target) target = {};
        [].forEach.call(caller.arguments, function (val, idx) {
            if (skip && idx < skip) return;
            var propName = args[idx];
            if (propName)
                target[propName.trim()] = val;
        });
        return target;
    }
}

function BindingSet(capturing) {
    allBindingSets.push(this);
    Object.defineProperty(this, "bindings", { "value": [] });
    if (typeof capturing === "boolean")
        Object.defineProperty(this, "capturing", { "value": capturing, "writable": true });
    else {
        Object.defineProperty(this, "capturing", { "value": true, "writable": true });
        if (typeof capturing === "function")
            capturing();
        this.capturing = false;
    }
}
BindingSet.prototype = {
    "allBindingSets": [],
    get active() { return this.bindings.every(function (binding) { return binding.active; }) },
    set active(value) { return this.bindings.forEach(function (binding) { binding.active = value; }) },
    "push": function () {
        var pops = this.bindings.map(function (binding) { binding.push(); });
        return function () { pops.forEach(function (pop) { pop(); }); }
    },
    "capture": function (binding) {
        if (this.capturing) this.bindings.push(binding);
    }
}

function Controls() {
    var midiIn = host.getMidiInPort(0);
    var midiInKeys = midiIn.createNoteInput("Keys", "80????", "90????", "B001??", "B002??", "B00B??", "B040??", "C0????", "D0????", "E0????");
    midiInKeys.setShouldConsumeEvents(true);  // Disable the consuming of events by the NoteInputs, so they are also sent to onMidi

    var midiInPads = midiIn.createNoteInput("Pads", "?9????");
    midiInPads.setShouldConsumeEvents(false);
    // Translate Poly AT to Timbre:
    midiInPads.assignPolyphonicAftertouchToExpression(9, NoteExpression.TIMBRE_UP, 2);

    var midiOut = host.getMidiOutPort(0);

    function sendSysex(anyArgs) {
        var builder = SysexBuilder.fromHex("F0 00 20 6B 7F 42 ");
        for (var i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            if (typeof arg === "number")
                builder.addByte(arg)
            else
                builder.addHex(arg);
        }

        var bytes = builder.terminate();
        flushQueue.push(function () { midiOut.sendSysex(bytes); });

        //var sysex = "F0 00 20 6B 7F 42 "
        //    + [].map.call(arguments, function (n) { return ("0" + n.toString(16) + " ").substr(-3); }).join('')
        //    + "F7";
        //
        //flushQueue.push(function () { midiOut.sendSysex(sysex); });
    }

    var mmcMap = {};
    var ccMap = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
    var nrpnMap = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
    var rpnMap = [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];
    var idMap = {};
    var mostRecentPN = [];

    function updateHandlerMaps(config, target) {
        var a = config[2];
        var b = config[3];
        if (a && b) {
            switch (config[1]) {
                case 1:
                case 5:
                case 8:
                    ccMap[a][b] = target;
                    return;
                case 4:
                    if (config[5])
                        rpnMap[a][b] = target;
                    else
                        nrpnMap[a][b] = target;
                    return;
            }
            /*                  |  1 |  2 |    3 |   4 |   5 | 6 |40|41|Fad|Enc|Btn|Trnsprt|Pad|
            Off	 			    | 00 |  - |    - |   - |   - | - |  |  | x | x | x |   x   | x |
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
            Program Change      | 0B | CH | PROG | LSB | MSB | 1 |  |  |   |   | x |   x   |   | */
        }
    }

    function midiCallback(status, data1, data2) {
        switch (status & 0xF0) {
            case 0xB0:
                var chanel = status & 0x0F;
                var handler = ccMap[chanel][data1];
                switch (data1) {
                    case 99: mostRecentPN = nrpnMap[chanel][data2]; return;
                    case 101: mostRecentPN = rpnMap[chanel][data2]; return;
                    case 6: handler = mostRecentPN || ccMap[chanel][data1]; break;
                }
                if (handler) {
                    typeof handler === "function" ? handler(data2) : handler.onMidi(data2);
                }
                else
                    println("No handler for midi: " + status & " " + data1 & " " + data2);
                return;
        }
    };

    function sysexCallback(data) {
        var match = /f07f(..)06/i.exec(data);
        if (match) {
            var mmcId = parseInt(match[1]);
            var ctrl = mmcMap[mmcId];
            if (ctrl)
                typeof ctrl === "function" ? ctrl(mmcId) : ctrl.onMidi(mmcId);
            return true;
        }
        match = /f000206b7f420200(..)(..)(..)F7/i.exec(data);
        if (match) {
            var cmd = parseInt("0x" + match[1]);
            var id = parseInt("0x" + match[2]);
            var val = parseInt("0x" + match[3]);
            var ctrl = idMap[id];
            if (ctrl)
                handleConfig(cmd, val);
            else
                print("Unknown control ID " + id & " in sysex " + data);
            return true;
        }
        println("Unknown sysex:" + data);
    };

    midiIn.setMidiCallback(midiCallback);
    midiIn.setSysexCallback(sysexCallback);


    function Control(id, type, name, defaults) {
        var config = {};
        Object.defineProperties(this, {
            "id": { "value": Array.isArray(id) ? id : [id] },
            "type": { "value": type },
            "name": { "value": name },
            "bindings": { "value": [] },
            "activeBinding": { "value": null, writable: true },
            "config": {
                "get": function () { return config; },
                "set": function (newConfig) {
                    if (Object.keys(newConfig).every(function (key) { return config[key] === newConfig[key] }))
                        return;
                    updateHandlerMaps(config, undefined);
                    this.id.forEach(function (id) {
                        Object.keys(newConfig).forEach(function (key) {
                            if (config[key] === newConfig[key]) return;
                            config[key] = newConfig[key];
                            sendSysex(2, 0, key, id, newConfig[key]);
                        })
                    });
                    updateHandlerMaps(config, this);
                }
            }
        });
        if (defaults) Object.assign(this, defaults);
        this.id.forEach(function (id) { idMap[id] = this; });
    }
    Control.prototype = {
        "channel": 0,
        "requestConfig": function requestConfig() {
            for (var i = 5; i >= 0; i++)
                sendSysex(1, 0, configIndices[i], this.id[0]);
        },
        "handleConfig": function handleConfig(cmd, val) {
            config[cmd] = val;
            if (cmd === 1) {
                if (activeBinding) {
                    activeBinding.active = false;
                    activeBinding.active = true;
                }
            }
        },
        "configureAsFader": function () { this.config = { 1: 1, 2: this.channel, 3: this.cc, 4: 0, 5: 0x7f, 6: 0, 0x40: 0, 0x41: 1 }; },
        "configureAsKnob": function () { this.config = { 1: 1, 2: this.channel, 3: this.cc, 4: 0, 5: 0x7f, 6: 0, 0x40: 0, 0x41: 5 }; },
        "configureAsEncoder": function () { this.config = { 1: 1, 2: this.channel, 3: this.cc, 4: 0, 5: 0x7f, 6: 1, 0x40: 1, 0x41: 5 }; },
        "configureAsDuration": function () { this.config = { 1: 5, 2: this.channel, 3: this.cc, 4: this.cc, 5: this.longcc, 6: 0, 0x40: 0 }; },
        "configureAsToggle": function () { this.config = { 1: 8, 2: this.channel, 3: this.cc, 4: 0, 5: 0x7f, 6: 0 }; },
        "configureAsGate": function () { this.config = { 1: 8, 2: this.channel, 3: this.cc, 4: 0, 5: 0x7f, 6: 1 }; },
        "configureAsNoteToggle": function () { this.config = { 1: 9, 2: this.channel, 3: this.note, 4: 0, 5: 0x7f, 6: 1 }; },
        "configureAsNote": function () { this.config = { 1: 9, 2: this.channel, 3: this.note, 4: 0, 5: 0x7f, 6: 1 }; },
        "configureAsMMC": function () { this.config = { 1: 7, 2: 0, 3: this.mmc, 4: 0, 5: 0, 6: 0 }; },
        "configureAsNRPN": function () { this.config = { 1: 4, 2: this.channel, 3: this.nrpn, 4: 0, 5: 0x7f, 6: 0 }; },
        "configureAsRPN": function () { this.config = { 1: 4, 2: this.channel, 3: this.rpn, 4: 0, 5: 0x7f, 6: 1 }; },
        "createBinding": function createBinding(target, defaults, activate) {
            var control = this;
            var binding = Object.create(this, {
                "target": { "value": target },
                "push": function () {
                    var previousBinding = control.activeBinding;
                    this.active = true;
                    return function () {
                        if (previousBinding)
                            previousBinding.active = true;
                    }
                },
                "active": {
                    "get": function () { return control.activeBinding === this; },
                    "set": function (value) {
                        if (value === this.active) return;
                        var activePeer = control.activeBinding;

                        if (value) {
                            if (activePeer)
                                activePeer.active = false;
                            control.activeBinding = this;
                            activate();
                        } else {
                            control.activeBinding = undefined;
                        }

                        if ("setIndication" in target)
                            target.setIndication(value);

                        if ("setLabel" in target)
                            target.setLabel(this.name);
                    }
                }
            });
            if (defaults) Object.assign(binding, defaults);
            control.bindings.push(binding);
            BindingSet.prototype.allBindingSets.forEach(function (bs) { bs.capture(binding); });
            return binding;
        },
        "findFirst": function findFirst(obj, props) {
            var s = [].slice.call(arguments, 1);
            for (var prop in s)
                if (Object.hasOwnProperty(obj, prop)) return prop;
            for (var prop in s)
                if (prop in obj) return prop;
            return undefined;
        }
    };

    function ClickControl(id, type, name, hasLed, defaults) {
        Control.call(this, id, type, name, defaults);
        captureArguments(this, 1);
        this.isDown = false;
        if (hasLed) {
            var isLit = false;
            Object.defineProperties(this, {
                "isLit": {
                    "get": function () { return isLit; },
                    "set": function (value) {
                        isLit = value ? true : false;
                        this.id.forEach(function (id) {
                            sendSysex(2, 0, 0x10, id, isLit ? 1 : 0);
                        });
                    }
                },
                "handleConfig": function handleConfig(cmd, val) {
                    if (cmd === 0x10)
                        isLit = val > 0;
                    else
                        Control.prototype.handleConfig.call(this, cmd, val);
                }
            });
        }
    };
    ClickControl.inherits(Control, function () {

        function activateClickProperty() {
            var targetToggles = "toggle" in this.target;
            var control = this.__proto__;
            var target = this.target;

            if ("isLit" in control)
                control.isLit = this.mostRecentIsLit;

            switch (this.findFirst("rpn", "nrpn", "cc", "mmc")) {
                case "mmc":
                    this.configureAsMMC();
                    this.onMidi = targetToggles
                        ? function (data) { target.toggle(); }
                        : function (data) { target.click(); }
                    return;
                case "rpn": this.configureAsRPN(); break;
                case "nrpn": this.configureAsNRPN(); break;
                case "cc": this.configureAsGate(); break;
            }

            this.onMidi = function (data) {
                control.isDown = data > 0;
                if (!targetToggles)
                    target.click(control.isDown);
                else if (data === 0)
                    target.toggle();
            };
        }

        this.bindTo = function bindTo(target, defaults) {
            if (!("toggle" in target || "click" in target))
                throw "Binding a clickable control requires a target that contains either an 'toggle' or 'click' method.";

            if ("isLit" in control && "addValueObserver" in target) {
                this.mostRecentIsLit = false;
                target.addValueObserver((function (value) {
                    this.mostRecentIsLit = value;
                    if (this.active)
                        this.isLit = value;
                }).bind(this));
            }
            return this.createBinding(target, defaults, activateClickProperty);
        }
    });

    function KnobControl(id, type, name, defaults) {
        Control.call(this, id, type, name, defaults);
    }
    KnobControl.inherits(Control, function () {
        function activateProperty() {
            //var status = 0xB0 | this.config[2];
            var target = this.target;
            this.onMidi = function (data) { target.set(data, 128); };
            switch (this.findFirst("rpn", "nrpn", "cc")) {
                case "rpn":
                    this.configureAsRPN();
                    //midiOut.sendMidi(status, 101, this.config[3]);
                    //midiOut.sendMidi(status, 6, this.mostRecentValue);
                    break;
                case "nrpn":
                    this.configureAsNRPN();
                    //midiOut.sendMidi(status, 99, this.config[3]);
                    //midiOut.sendMidi(status, 6, this.mostRecentValue);
                    break;
                case "cc":
                    if ("inc" in target && !("forceAbsolute" in this)) {
                        this.configureAsEncoder();
                        this.onMidi = function (data) { target.inc(data - 64, 128); };
                    }
                    else {
                        this.configureAsKnob();
                        //midiOut.sendMidi(status, this.config[3], this.mostRecentValue);
                    }
                    break;
            }
        };

        function activateCursor() {
            var target = this.target;
            this.configureAsEncoder();
            this.onMidi = function (data) {
                if (data > 64)
                    target.selectNext();
                else if (data < 64)
                    target.selectPrevious();
            };
        };

        function activateScroll() {
            var target = this.target;
            this.configureAsEncoder();
            this.onMidi = function (data) {
                if (data > 64)
                    target.scrollForwards();
                else if (data < 64)
                    target.scrollBackwards();
            };
        };

        this.bindTo = function bindTo(target, defaults) {
            if (!("inc" in target || "set" in target || "selectPrevious" in target || "scrollForwards" in target))
                throw "bindTo requires a target that implements inc, set, selectPrevious/Next or scrollBackwards/Forwards methods.";

            //if ("addValueObserver" in target)
            //    target.addValueObserver(128, (function (value) { this.mostRecentValue = value; }).bind(this));

            var activate = "selectPrevious" in target ? activateCursor :
                "scrollForwards" in target ? activateScroll : activateProperty;

            return this.createBinding(target, defaults, activate);
        }
    });

    function FaderControl(id, bank, index, defaults) {
        Control.call(this, id, "Fader", "P " + index, defaults);
        Object.defineProperties(this, { "index": { "value": index }, "bank": { "value": bank } });
    }
    FaderControl.inherits(Control, function () {
        function activate() {
            var target = this.target;
            this.onMidi = function (data) { target.set(data, 128); };
            switch (this.findFirst("rpn", "nrpn", "cc")) {
                case "rpn": this.configureAsRPN(); break;
                case "nrpn": this.configureAsNRPN(); break;
                default: this.configureAsFader(); break;
            }
        };
        this.bindTo = function bindTo(target, defaults) {
            if (!("set" in target))
                throw "Binding a control requires a target that contains either an 'inc' or 'set' method.";

            return this.createBinding(target, defaults, activate);
        }
    });

    //var loadMemory = function (preset) { sendSysex(5, preset); };
    //var saveMemory = function (preset) { sendSysex(6, preset); };
    this.getValue = function getValue(id, cmd) { sendSysex(1, 0, cmd, id); };
    this.setValue = function setValue(id, cmd, val) { sendSysex(2, 0, cmd, id, val); };
    this.setValues = function setValues(id, config) {
        var cmd = ["01 ", "02 ", "03 ", "04 ", "05 ", "06 ", "40 ", "41 "];
        config.forEach(function (cfg, i) {
            sendSysex("02 00 " + cmd[i] + uint7ToHex(id) + uint7ToHex(cfg));
        });
    };

    this.setDisplay = function setKeylabDisplay(line1, line2) {
        sendSysex("04 00 60 01 "
            + [].map.call(line1 || "", function (c) { return ("0" + c.toString(16) + " ").substring(-3); }).join("")
            + "00 02 "
            + [].map.call(line2 || "", function (c) { return ("0" + c.toString(16) + " ").substring(-3); }).join("")
            + "00 ");
    };

    this.volume = new KnobControl(0x30, "Volume", "Volume", { cc: 0x07 });
    this.param = new KnobControl(0x31, "Param", "Param", { cc: 0x70 });
    this.paramButton = new ClickControl(0x32, "Param", "Param Click", { cc: 0x71 });
    this.value = new KnobControl(0x33, "Value", "Value", { cc: 0x72 });
    this.valueButton = new ClickControl(0x34, "Value", "Value Click", { cc: 0x73 });
    this.sound = new ClickControl(0x1E, "Mode", "Sound", { cc: 0x76 });
    this.multi = new ClickControl(0x1F, "Mode", "Multi", { cc: 0x77 });
    this.bank1 = new ClickControl(0x1D, "Bank", "Bank 1", { cc: 0x2E });
    this.bank2 = new ClickControl(0x1C, "Bank", "Bank 2", { cc: 0x2F });
    this.play = new ClickControl(0x58, "Transport", "Play", { nrpn: 2 });
    this.stop = new ClickControl(0x59, "Transport", "Stop", { nrpn: 1 });
    this.record = new ClickControl(0x5A, "Transport", "Record", { nrpn: 6 });
    this.rewind = new ClickControl(0x5B, "Transport", "Rewind", { nrpn: 5 });
    this.forward = new ClickControl(0x5C, "Transport", "Forward", { nrpn: 4 });
    this.loop = new ClickControl(0x5D, "Transport", "Loop", { nrpn: 7 });
    // transpose buttons???
    this.switches = [
        new ClickControl(0x12, 0, { index: 0x1, cc: 0x16 }), //, {"cc" = 0x68}),
        new ClickControl(0x13, 1, { index: 0x2, cc: 0x17 }), //, {"cc" = 0x69}),
        new ClickControl(0x14, 2, { index: 0x3, cc: 0x18 }), //, 0x6A),
        new ClickControl(0x15, 3, { index: 0x4, cc: 0x19 }), //, 0x6B),
        new ClickControl(0x16, 4, { index: 0x5, cc: 0x1A }), //, 0x6C),
        new ClickControl(0x17, 5, { index: 0x6, cc: 0x1B }), //, 0x6D),
        new ClickControl(0x18, 6, { index: 0x7, cc: 0x1C }), //, 0x6E),
        new ClickControl(0x19, 7, { index: 0x8, cc: 0x1D }), //, 0x6F),
        new ClickControl(0x1A, 8, { index: 0x9, cc: 0x1E }), //, {"cc" = 0x74}),
        new ClickControl(0x1B, 9, { index: 0xA, cc: 0x1F })  //, {"cc" = 0x75})
    ];
    this.encoders = [[
        new KnobControl(0x01, "Encoder", "P01 B1", { bank: 1, index: 0, cc: 0x47 }),
        new KnobControl(0x02, "Encoder", "P02 B1", { bank: 1, index: 1, cc: 0x46 }),
        new KnobControl(0x03, "Encoder", "P03 B1", { bank: 1, index: 2, cc: 0x4C }),
        new KnobControl(0x04, "Encoder", "P04 B1", { bank: 1, index: 3, cc: 0x4D }),
        new KnobControl(0x09, "Encoder", "P05 B1", { bank: 1, index: 4, cc: 0x5D }),
        new KnobControl(0x05, "Encoder", "P06 B1", { bank: 1, index: 5, cc: 0x12 }),
        new KnobControl(0x06, "Encoder", "P07 B1", { bank: 1, index: 6, cc: 0x13 }),
        new KnobControl(0x07, "Encoder", "P08 B1", { bank: 1, index: 7, cc: 0x10 }),
        new KnobControl(0x08, "Encoder", "P09 B1", { bank: 1, index: 8, cc: 0x11 }),
        new KnobControl([0x0A, 0x6E], "Encoder", "P10 B1", { bank: 1, index: 9, cc: 0x5B })  // Special case knob that can also have ID 0x0A.  Arturia are cunts.
    ], [
        new KnobControl(0x21, "Encoder", "P01 B2", { bank: 1, index: 0, cc: 0x23 }),
        new KnobControl(0x22, "Encoder", "P02 B2", { bank: 1, index: 1, cc: 0x24 }),
        new KnobControl(0x23, "Encoder", "P03 B2", { bank: 1, index: 2, cc: 0x25 }),
        new KnobControl(0x24, "Encoder", "P04 B2", { bank: 1, index: 3, cc: 0x26 }),
        new KnobControl(0x29, "Encoder", "P05 B2", { bank: 1, index: 4, cc: 0x27 }),
        new KnobControl(0x25, "Encoder", "P06 B2", { bank: 1, index: 5, cc: 0x28 }),
        new KnobControl(0x26, "Encoder", "P07 B2", { bank: 1, index: 6, cc: 0x29 }),
        new KnobControl(0x27, "Encoder", "P08 B2", { bank: 1, index: 7, cc: 0x2A }),
        new KnobControl(0x28, "Encoder", "P09 B2", { bank: 1, index: 8, cc: 0x2B }),
        new KnobControl(0x2A, "Encoder", "P10 B2", { bank: 1, index: 9, cc: 0x2C })]];
    this.faders = [[
        new FaderControl(0x0B, "Fader", "F1", { index: 0, cc: 0x49 }),
        new FaderControl(0x0C, "Fader", "F2", { index: 1, cc: 0x4B }),
        new FaderControl(0x0D, "Fader", "F3", { index: 2, cc: 0x4F }),
        new FaderControl(0x0E, "Fader", "F4", { index: 3, cc: 0x48 }),
        new FaderControl(0x4B, "Fader", "F5", { index: 4, cc: 0x50 }),
        new FaderControl(0x4C, "Fader", "F6", { index: 5, cc: 0x51 }),
        new FaderControl(0x4D, "Fader", "F7", { index: 6, cc: 0x52 }),
        new FaderControl(0x4E, "Fader", "F8", { index: 7, cc: 0x53 }),
        new FaderControl(0x4F, "Fader", "F9", { index: 8, cc: 0x55 })
    ], [
        new FaderControl(0x2B, "Fader", "F1", { index: 0, cc: 0x49, chanel: 1 }),
        new FaderControl(0x2C, "Fader", "F2", { index: 1, cc: 0x4B, chanel: 1 }),
        new FaderControl(0x2D, "Fader", "F3", { index: 2, cc: 0x4F, chanel: 1 }),
        new FaderControl(0x2E, "Fader", "F4", { index: 3, cc: 0x48, chanel: 1 }),
        new FaderControl(0x6B, "Fader", "F5", { index: 4, cc: 0x50, chanel: 1 }),
        new FaderControl(0x6C, "Fader", "F6", { index: 5, cc: 0x51, chanel: 1 }),
        new FaderControl(0x6D, "Fader", "F7", { index: 6, cc: 0x52, chanel: 1 }),
        new FaderControl(0x6E, "Fader", "F8", { index: 7, cc: 0x53, chanel: 1 }),
        new FaderControl(0x6F, "Fader", "F9", { index: 8, cc: 0x55, chanel: 1 })
    ]];
    this.pads = [
        new ClickControl(0x70, "Pad", "Pad 00", { index: 0x0, note: 0x24, cc: 0x24, chanel: 15 }),
        new ClickControl(0x71, "Pad", "Pad 01", { index: 0x1, note: 0x25, cc: 0x25, chanel: 15 }),
        new ClickControl(0x72, "Pad", "Pad 02", { index: 0x2, note: 0x26, cc: 0x26, chanel: 15 }),
        new ClickControl(0x73, "Pad", "Pad 03", { index: 0x3, note: 0x27, cc: 0x27, chanel: 15 }),
        new ClickControl(0x74, "Pad", "Pad 04", { index: 0x4, note: 0x28, cc: 0x28, chanel: 15 }),
        new ClickControl(0x75, "Pad", "Pad 05", { index: 0x5, note: 0x29, cc: 0x29, chanel: 15 }),
        new ClickControl(0x76, "Pad", "Pad 06", { index: 0x6, note: 0x2A, cc: 0x2A, chanel: 15 }),
        new ClickControl(0x77, "Pad", "Pad 07", { index: 0x7, note: 0x2B, cc: 0x2B, chanel: 15 }),
        new ClickControl(0x78, "Pad", "Pad 08", { index: 0x8, note: 0x2C, cc: 0x2C, chanel: 15 }),
        new ClickControl(0x79, "Pad", "Pad 09", { index: 0x9, note: 0x2D, cc: 0x2D, chanel: 15 }),
        new ClickControl(0x7A, "Pad", "Pad 10", { index: 0xA, note: 0x2E, cc: 0x2E, chanel: 15 }),
        new ClickControl(0x7B, "Pad", "Pad 11", { index: 0xB, note: 0x2F, cc: 0x2F, chanel: 15 }),
        new ClickControl(0x7C, "Pad", "Pad 12", { index: 0xC, note: 0x30, cc: 0x30, chanel: 15 }),
        new ClickControl(0x7D, "Pad", "Pad 13", { index: 0xD, note: 0x31, cc: 0x31, chanel: 15 }),
        new ClickControl(0x7E, "Pad", "Pad 14", { index: 0xE, note: 0x32, cc: 0x32, chanel: 15 }),
        new ClickControl(0x7F, "Pad", "Pad 15", { index: 0xF, note: 0x33, cc: 0x33, chanel: 15 })
    ];

    sendSysex(2, 0, 0x40, 2, 0x7f);     //TODO: Get all the old info about controls
    //Object.seal(this);
}

function KeyLab(controls) {

    function wrap(container, properties) {
        // Wraps a BitWig property and exposes it on the target object as a javascript property, along with an xxxChanged event
        var target = Object.create(container);
        target.super = container;
        properties.forEach(
            function addProp(name) {
                var StringArrayValue = Java.type("com.bitwig.extension.controller.api.StringArrayValue");
                var prop = container[name]();
                prop.markInterested();
                if (prop instanceof StringArrayValue) {
                    Object.defineProperty(target, name, { "get": function () { return Java.from(prop.get(); } });
                    prop.addValueObserver(function (value) {
                        var evt = target[name + "Changed"];
                        if (evt && typeof evt === "function") evt(Java.from(value));
                    });
                } else {
                    var propDef = { "get": prop.get().bind(prop) };
                    if ("set" in prop) propDef.set = prop.set().bind(prop);
                    Object.defineProperty(target, name, propDef);
                    prop.addValueObserver(function (value) {
                        var evt = target[name + "Changed"];
                        if (evt && typeof evt === "function") evt(value);
                    });
                }
            });
        return target;
    }

    function radioGroupFor(observable, value1, value2, valuen) {
        var listeners = {};
        observable.addValueObserver(function (value) {
            Object.entries(listeners).forEach(function (keyVal) { keyVal[1](value == keyVal[0]); });
        });
        [].slice.call(arguments, 1).forEach(function (arg, index) {
            this[arg] = {
                toggle: function () { observable.set(index) },
                addValueObserver: function (fn) { listeners[arg] = fn; }
            };
        });
    }


    var application = wrap(host.createApplication(), ["panelLayout"]);
    var atHost = new (function hostActionFactory() {
        var categories = application.getActionCategories();
        for (var i = 0; i < categories.length; i++) {
            var categoryName = categories[i].getName().replace(/[^a-z]/g, "");
            var category = this[categoryName] = {};
            var actions = categories[i].getActions();

            for (var w = 0; j < actions.length; w++) {
                var action = actions[w];
                var name = action.getName().replace(/[^a-z]/g, "");
                category[name] = function () { action.invoke(); };
            }
        }
    })();

    var cTrack = host.createArrangerCursorTrack(3, 4);      // 4 scene slots
    var cDevice = wrap(cTrack.createCursorDevice(), ["isPlugin", "isWindowOpen", "hasNext", "hasPrevious",
        "isNested", "hasSlots", "hasDrumPads", "isExpanded", "exists", "isEnabled",
        "isRemoteControlsSectionVisible", "isMacroSectionVisible", "name", "slotNames"]);

    var cDeviceSlot = wrap(cDevice.getCursorSlot(), ["name", "exists"]);
    var cRemote = wrap(cDevice.createCursorRemoteControlsPage(8), ["pageNames", "selectedPageIndex"]);

    cDevice.moveCursor = function (inc) {
        if (!cDevice.exists) return;

        if (cDevice.isExpanded) {
            if (inc > 0) {
                if (cDeviceSlot.exists) {
                    cDevice.selectFirstInSlot(cDeviceSlot.ame);
                    return;
                }
                //if (cDevice.hasDrumPads) {
                //    println("Selecting Drumpad");
                //    cDevice.selectFirstInKeyPad(0x24);
                //    return;
                //}
            }
        }
        // If there are we can't go any further in the requested direction, go up a level.
        if (cDevice.isNested && !cDevice[inc > 0 ? "hasNext" : "hasPrevious"])
            cDevice.selectParent();

        inc > 0 ? cDevice.selectNext() : cDevice.selectPrevious();
        cDevice.selectInEditor();
    };

    var browser = wrap(cDevice.createDeviceBrowser(1, 1), ["exists", "isWindowMinimized", "shouldAudition"]);

    var cBrowser = browser.createCursorSession();
    var arranger = wrap(host.createArranger(), ["isPlaybackFollowEnabled", "hasDoubleRowTrackHeight", "areCueMarkersVisible",
        "isClipLauncherVisible", "isTimelineVisible", "isIoSectionVisible", "areEffectTracksVisible"]);
    var mixer = wrap(host.createMixer(), ["isMeterSectionVisible", "isIoSectionVisible", "isSendSectionVisible",
        "isClipLauncherSectionVisible", "isDeviceSectionVisible", "isCrossFadeSectionVisible"]);
    var preferences = host.getPreferences();
    var masterTrack = host.createMasterTrack(0);
    var tracks = host.createMainTrackBank(9, 0, 0);
    var transport = host.createTransport();
    var userControls = host.createUserControls(10);
    var popup = wrap(host.createPopupBrowser(), ["selectedContentTypeIndex", "contentTypeNames"]);

    // BindingSet Definitions
    var allBindingSets = {
        commonBindings: new BindingSet(function () {
            controls.volume.bindTo(masterTrack.getVolume());
            for (var j = 0; j < 9; j++) {
                var target = tracks.getTrack(j).getVolume();
                controls.faders[0][j].bindTo(target);
                controls.faders[1][j].bindTo(target);
            }

            // Transport
            controls.loop.bindTo(transport.isArrangerLoopEnabled());
            controls.record.bindTo(transport.isArrangerRecordEnabled());
            controls.forward.bindTo({ "toggle": function () { transport.fastForward(); } });
            controls.rewind.bindTo({ "toggle": function () { transport.rewind(); } });

            controls.play.bindTo({
                "toggle": function () { transport.togglePlay(); },
                "addValueObserver": function (callback) { transport.isPlaying().addValueObserver(callback); }
            });

            controls.stop.bindTo({
                "click": function () { transport.isPlaying().get() ? transport.stop() : transport.tapTempo(); },
                "addValueObserver": function (callback) { transport.isPlaying().addValueObserver(function (isPlaying) { callback(!isPlaying); }); }
            });
        }),
        encoderBank1BindsUserControls: new BindingSet(function () {
            controls.encoders[0].forEach(function (enc, idx) {
                enc.bindTo(userControls.getControl(idx));
            });
        }),
        encoderBank2BindsUserControls: new BindingSet(function () {
            controls.encoders[1].forEach(function (enc, idx) {
                enc.bindTo(userControls.getControl(idx));
            });
        }),
        encoderBank1BindsRemoteControls: new BindingSet(function () {
            var enc = controls.encoders[0];
            enc[0].bindTo(cRemote.getParameter(0));
            enc[1].bindTo(cRemote.getParameter(1));
            enc[2].bindTo(cRemote.getParameter(2));
            enc[3].bindTo(cRemote.getParameter(3));
            enc[4].bindTo(transport.tempo());
            enc[5].bindTo(cRemote.getParameter(4));
            enc[6].bindTo(cRemote.getParameter(5));
            enc[7].bindTo(cRemote.getParameter(6));
            enc[8].bindTo(cRemote.getParameter(7));
            enc[9].bindTo({ "inc": function (inc) { transport.incPosition(inc, true), } });
        }),
        encoderBank2BindsMixer: new BindingSet(function () {
            var enc = controls.encoders[1];
            enc[0].bindTo(cTrack.getVolume());
            enc[1].bindTo(cTrack.getPan());
            enc[2].bindTo(cTrack.getSend(0));
            enc[3].bindTo(cTrack.getSend(1));
            enc[4].bindTo(cTrack.getSend(2));
            enc[5].bindTo(transport.tempo());
            enc[6].bindTo(transport.getInPosition());
            enc[7].bindTo(transport.getOutPosition());
            enc[8].bindTo(transport.metronomeVolume());
            enc[9].bindTo({ "inc": function (inc) { transport.incPosition(inc, true); } });
        }),
        paramValueBindsTrackAndDevice: new BindingSet(function () {
            controls.param.bindTo(cTrac);
            controls.value.bindTo(cDevice.moveCursor);
        }),
        browseSessionBindings: new BindingSet(function () {
            //var callbacks = [];
            //popup.selectedContentTypeIndexChanged = function (value) {
            //    controls.setDisplay("Browse:", popup.contentTypeNames[index]);
            //    callbacks.forEach(function (callback, index) { callback(value === index); });
            //};
            //for (var i = 0; i < 5; i++) {
            //    var index = i;
            //    control.switches[i].bindTo({
            //        "click": function () { popup.selectedContentTypeIndex = index; },
            //        "addValueObserver": function (callback) { callbacks[index] = callback; }
            //    });
            //}
            var rg = new radioGroupFor(popup.base.selectedContentTypeIndex(), 1, 2, 3, 4, 5);
            control.switches[0].bindTo(rg[0]);
            control.switches[1].bindTo(rg[1]);
            control.switches[2].bindTo(rg[2]);
            control.switches[3].bindTo(rg[3]);
            control.switches[4].bindTo(rg[4]);
            control.switches[5].bindTo(popup.shouldAudition());
            control.switches[6].bindTo({ "toggle": function () { atHost.General.RevealFile(); } });
            control.switches[7].bindTo({ "toggle": function () { atHost.General.EditFileMetadata(); } });
            control.switches[8].bindTo({ "toggle": function () { popup.cancel(); } });
            control.switches[9].bindTo({ "toggle": function () { popup.commit(); } });
            //new ClickAction("Delete Preset", function () {
            //    atHost.General.Delete();
            //    if (!autoConfirmDelete)
            //        return;
            //    moveCursor(cResult, 1);
            //    atHost.General.Yes();
            //    atHost.Browser.FocusBrowserFileList();
            //})

            function encoderCursor(cursor) {
                if ("createCursorItem" in cursor) cursor = cursor.createCursorItem();
                return {
                    "inc": function (inc) {
                        inc > 0 ? cursor.selectNext() : cursor.selectPrevious();
                        flushQueue.push(function () {
                            atHost.Browser.FocusBrowserFileList();
                            atHost.SelectionNavigation.Selectfirstitem();
                        });
                    }
                }
            };

            controls.encoders1[0].bindTo(encoderCursor(popup.locationColumn()));
            controls.encoders1[1].bindTo(encoderCursor(popup.deviceColumn()));
            controls.encoders1[2].bindTo(encoderCursor(popup.categoryColumn()));
            controls.encoders1[3].bindTo(encoderCursor(popup.tagColumn()));
            controls.encoders1[4].bindTo(encoderCursor(popup.creatorColumn()));
            controls.encoders1[5].bindTo(encoderCursor(popup.smartCollectionColumn()));
            controls.encoders1[6].bindTo(encoderCursor(popup.deviceTypeColumn()));
            controls.encoders1[7].bindTo(encoderCursor(popup.fileTypeColumn()));
            controls.encoders1[8].bindTo(encoderCursor(popup.resultsColumn(), false));
            //controls.encoders1[9].bindNOP

            controls.paramClick.bindTo({ "click": function () { popup.cancel(); } });
            controls.valueClick.bindTo({ "click": function () { popup.commit(); } });
            controls.param.bindTo(encoderCursor(popup.categoryColumn()));
            controls.value.bindTo(popup.resultsColumn());
        })
    }

   

    // Behavior section
    device.nameChanged = function (name) { setKeylabDisplay("Device:", name); };

    allBindingSets.commonBindings.active = true;

    var returnToPreBrowseState;
    popup.existsChanged = function (browsing) {
        if (browsing) {
            atHost.Browser.FocusBrowserFileList();
            returnToPreBrowseState = allBindingSets.browseSessionBindings.push();
        } else {
            if (returnToPreBrowseState)
                returnToPreBrowseState();
            returnToPreBrowseState = undefined;
        }
        //mode.set(browsing ? "Browse" : panelLayoutName.toProperCase());
    };

    controls.multi.bindTo({
        "toggle": function () {
        },
        "addValueObserver": function () {

        }
    });

    application.panelLayoutChanged = function (value) {
        switch (value) {
            case "ARRANGE":
            case "MIX":
            case "EDIT":
            default:
                allBindingSets.encoderBank1BindsRemoteControls.active = true;
                allBindingSets.encoderBank2BindsMixer.active = true;
                break;
        }
    });


    /*
      
    var bank = new Observable(1, undefined, undefined, "BANK");
    var mode = new Observable("Arrange", undefined, undefined, "MODE");		// valid values: Arrange, Mix, Edit, Browse
     

     
     
       function cycleDeviceVisibility() {
           if (cDevice.isPlugin) {
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
     
       var autoSelectFirstResult = false;
       preferences.getEnumSetting("Auto-Select first result?", "Browser", ["Yes", "No"], "Yes").addValueObserver(function (_) { autoSelectFirstResult = _; });
     
       var cResult = popup.resultsColumn().createCursorItem();
       cResult.addValueObserver(32, "", function (val) {
           if (val && val.length > 0 && mode.get() === "Browse")
               setKeylabDisplay(val, "");
       });
     
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
     
    
       ClickAction("Inspector", function () { application.toggleInspector(); }),
       ClickAction("Devices", function () { application.toggleDevices(); }),
       ClickAction("Note Editor", function () { application.toggleNoteEditor(); }),
       ClickAction("Automation", function () { application.toggleAutomationEditor(); }),
       ClickAction("Mixer", function () { application.toggleMixer(); }),
       ClickAction("Duplicate", function () { application.duplicate(); }),
       ClickAction("Undo", function () { application.undo(); }),
       ClickAction("Redo", function () { application.redo(); }),
       ClickAction("Zoom In", function () { application.zoomIn(); }),
       ClickAction("Zoom Out", function () { application.zoomOut(); }),
       ClickAction("Zoom To Fit", function () { application.zoomToFit(); }),
       ClickAction("Zoom Selection", function () { application.zoomToSelection(); }),
       ClickAction("New Audio Track", function () { application.createAudioTrack(-1); }),
       ClickAction("New Effect Track", function () { application.createEffectTrack(-1); }),
       ClickAction("New Instrument Track", function () { application.createInstrumentTrack(-1); }),
       ClickAction("Show Plugin", cDevice.isWindowOpen()),
       ClickAction("Expand Device", cDevice.isExpanded()),
       ClickAction("Expand <-> Remote", function () { cycleDeviceVisibility(); }),
       ClickAction("Expand/Show Device",
       function () { (deviceIsPlugin ? cDevice.isWindowOpen() : cDevice.isExpanded()).toggle(); },
       function (fnSet) {
           cDevice.isWindowOpen().addValueObserver(function (_) { if (deviceIsPlugin) fnSet(_); });
           cDevice.isExpanded().addValueObserver(function (_) { if (!deviceIsPlugin) fnSet(_); });
       }),
       ClickAction("Show Remote Controls", cDevice.isRemoteControlsSectionVisible()),
       ClickAction("Next Remote Page", function () { cRemote.selectNextPage(true); }),
       ClickAction("Prev Remote Page", function () { cRemote.selectPreviousPage(true); }),
       ClickAction("Arranger: Show Cue Markers", arranger.areCueMarkersVisible()),
       ClickAction("Arranger: FX Tracks", arranger.areEffectTracksVisible()),
       ClickAction("Arranger: Clip Launcher", arranger.isClipLauncherVisible()),
       ClickAction("Arranger: Timeline", arranger.isTimelineVisible()),
       ClickAction("Arranger: Big Rows", arranger.hasDoubleRowTrackHeight()),
       ClickAction("Arranger: Follow Playback", arranger.isPlaybackFollowEnabled()),
       ClickAction("Mixer: Meters", mixer.isMeterSectionVisible()),
       ClickAction("Mixer: Sends", mixer.isSendSectionVisible()),
       ClickAction("Mixer: I/O", mixer.isIoSectionVisible()),
       ClickAction("Mixer: Devices", mixer.isDeviceSectionVisible()),
       ClickAction("Mixer: Clip Launcher", mixer.isClipLauncherSectionVisible()),
       ClickAction("Browse", function () { browser.startBrowsing(); }),
       ClickAction("Browse Replace", function () { cDevice.browseToInsertBeforeDevice(); }),
       ClickAction("Browse Insert Before", function () { cDevice.browseToReplaceDevice(); }),
       ClickAction("Browse Insert After", function () { cDevice.browseToInsertAfterDevice(); }),
       ClickAction("Automation Mode: Latch", transport.automationWriteMode(), "latch"),
       ClickAction("Automation Mode: Touch", transport.automationWriteMode(), "touch"),
       ClickAction("Automation Mode: Write", transport.automationWriteMode(), "write"),
       ClickAction("Metronome", transport.isMetronomeEnabled()),
       ClickAction("Metronome Tick Playback", transport.isMetronomeTickPlaybackEnabled()),
       ClickAction("Punch In", transport.isPunchInEnabled()),
       ClickAction("Punch Out", transport.isPunchOutEnabled()),
       ClickAction("Track: Arm", cTrack.getArm()),
       ClickAction("Track: Monitor", cTrack.getMonitor()),
       ClickAction("Track: Auto Monitor", cTrack.getAutoMonitor()),
       ClickAction("Pads: Page Up", function () { padsMode.get() === "Launcher" ? padTrackBank.scrollScenesUp() : padOffset.inc(-16); }),
       ClickAction("Pads: Page Down", function () { padsMode.get() === "Launcher" ? padTrackBank.scrollScenesDown() : padOffset.inc(16); })
     
       KnobAction("Select Track", function (_) { moveCursor(cTrack, _); }),
       KnobAction("Select Device", function (_) { moveCursorDevice(_); }),
       KnobAction("Select Sub-Panel", function (_) { inc > 0 ? application.nextSubPanel() : application.previousSubPanel(); }),
       KnobAction("Send MIDI CC +/-", function (_) { midiInKeys.sendRawMidiEvent(0xB0, 0x46 + (2 * index) + (_ > 0 ? 1 : 0), 0x7f); }),
       KnobAction("Scroll Scene", function (inc) { inc > 0 ? padTrackBank.scrollScenesDown() : padTrackBank.scrollScenesUp(); }),
       KnobAction("Select Track", function (_) { moveCursor(cTrack, _); }),
       KnobAction("Select Device", function (_) { moveCursorDevice(_); }),
       KnobAction("Select Sub-Panel", function (_) { inc > 0 ? application.nextSubPanel() : application.previousSubPanel(); }),
       KnobAction("Send MIDI CC +/-", function (_) { midiInKeys.sendRawMidiEvent(0xB0, 0x46 + (2 * index) + (_ > 0 ? 1 : 0), 0x7f); }),
       KnobAction("Shuttle Transport", function (inc) { transport.incPosition(inc, true); }),
       KnobAction("In Position", function (inc) { transport.getInPosition().incRaw(inc); }),
       KnobAction("Out Position", function (inc) { transport.getOutPosition().incRaw(inc); }),
       KnobAction("Tempo", function (inc) { transport.tempo().inc(inc, 128); }),
       KnobAction("Scroll Scene", function (inc) { inc > 0 ? padTrackBank.scrollScenesDown() : padTrackBank.scrollScenesUp(); }),
       KnobAction("Metronome Volume", transport.metronomeVolume())
    */
    return this;
}

var controls = null;
var kL = null;

function init() {
    controls = new Controls();
    kL = KeyLab(controls);
    controls.setDisplay("Welcome to", "Bitwig");
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

var flushQueue = [];

function flush() {
    while (flushQueue.length > 0)
        flushQueue.shift()();
}




loadAPI(2);
DRUMPADS = true;
//load("KeyLab.js");

host.defineController("Arturia", "KeyLab-88 Redux", "2.0", "aff2aae0-c398-11e4-ab27-1800200c9aff");
host.defineMidiPorts(1, 1);
host.addDeviceNameBasedDiscoveryPair(["KeyLab 88"], ["KeyLab 88"]);
host.defineSysexIdentityReply("F0 7E 00 06 02 00 20 6B ?? ?? 05 48 ?? ?? ?? ?? F7");
