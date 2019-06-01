function Observable(value, max, min) {
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
    this.set = function (_) {
        if (value !== _) {
            value = _;
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

Array.prototype.toObject = function (fnPropertyName) {
    var result = {};
    array.forEach(function (_) {
        result[fnPropertyName(_)] = _;
    });
    return result;
};

String.prototype.toProperCase = function () {
    return this.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};


var TRACE = false;

function log(info) {
    if (TRACE)
        println(info);
}

