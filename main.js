/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();

let objects_arr = {};
let timers_arr = {};

let adapter;
function startAdapter(options) {
	options = options || {};
	Object.assign(options, {
        name: adapterName,
        unload: function (callback) {
            try {
                adapter.log.info('Expire adapter stopped...');
                for (let id in objects_arr) {
                    if(objects_arr.hasOwnProperty(id)) {
                        deleteObject(id);
                    }
                }
                callback();
            } catch (e) {
                callback();
            }
        },
        objectChange: function (id, obj) {
            if(obj && obj.common && obj.common.custom && obj.common.custom[adapter.namespace] && obj.common.custom[adapter.namespace].enabled) {
                adapter.log.debug('Object change detected for: ' + id);
                deleteObject(id);
                addToObjects(id, obj);
            } else {
                deleteObject(id);
            }
        },
        stateChange: function (id, state) {
            if(objects_arr.hasOwnProperty(id)) {
                if(state.val != objects_arr[id].expire_state) {
                    adapter.log.debug('Detect state change for: ' + id);
                    process(id, state, objects_arr[id].expire_interval, objects_arr[id].expire_state, objects_arr[id].expire_ack);
                }
            }
        },
        ready: () => main()
    });

    adapter = new utils.Adapter(options);

	return adapter;
};

function parseToMillis(timeString){
    var seconds = parseFloat(timeString);
    if(timeString.indexOf("d") != -1){
        seconds *= 3600 * 24;
    }
    if(timeString.indexOf("m") != -1){
        seconds *= 60;
    }
    if(timeString.indexOf("h") != -1){
        seconds *= 3600;
    }
    if(timeString.indexOf("s") != -1){
        seconds *= 1;
    }
    return seconds * 1000;
}

function deleteObject(id) {
    if (objects_arr.hasOwnProperty(id)) {
        delete objects_arr[id];

        if(timers_arr.hasOwnProperty(id)) {
            if(timers_arr[id] != null) {
                clearTimeout(timers_arr[id]);
            }
            delete timers_arr[id];
        }
        
        adapter.log.info('Disable expire for: ' + id);
    }
}

function checkExpired(id, state, expire_interval) {
    let interval = 0;
    let now = new Date().getTime();
    let end_time = state.ts + expire_interval;
    interval = end_time - now + 1;
    //console.log(formatDate(end_time, "TT.MM.JJJJ SS:mm:ss.sss"));
    if(now > end_time) {
        return 0;
    }

    return interval;
}

function setExpired(id, state, expire_state, ack) {
    let value = state.val;
    if(value != expire_state) {
        adapter.log.info("Set " + id + " to expired!");
        adapter.setForeignState(id, {val: expire_state, ack: ack});
    }
}

function process(id, state, expire_interval, expire_state, expire_ack) {
    adapter.log.debug('Process id: ' + id);
    let res = null;
    try {
        res = checkExpired(id, state, expire_interval);
    } catch(err) {
        adapter.log.error('Something wrong with state ' + id + ': ' + err);
        return;
    }

    if(res == 0) {
        setExpired(id, state, expire_state, expire_ack);
    } else {
        if(!timers_arr.hasOwnProperty(id)) {
            timers_arr[id] = null;
        }
        if(timers_arr[id] != null) {
            clearTimeout(timers_arr[id]);
            timers_arr[id] = null;
        }

        adapter.log.debug('Register timer for: ' + id);
        timers_arr[id] = setTimeout(function () {
            adapter.log.debug('Timeout callback for id: ' + id);
            adapter.getForeignState(id, function(err, state) {
                if (err || !state) {
                    adapter.log.error('Failed to get state for id: ' + id);
                    return;
                }
                process(id, state, expire_interval, expire_state, expire_ack);
            });
        }, res);
    }
}

function addToObjects(id, obj) {
    adapter.log.info('Register expire for id: ' + id);
    if(obj && obj.value && obj.value.custom) {
        objects_arr[id] = obj.value.custom;
        objects_arr[id].type = obj.value.type;
    } else if(obj && obj.common && obj.common.custom) {
        objects_arr[id] = obj.common.custom;
        objects_arr[id].type = obj.common.type;
    } else {
        return;
    }
    
    let expire_interval = parseToMillis(objects_arr[id][adapter.namespace].interval);
    let expire_ack = objects_arr[id][adapter.namespace].ack === true;
    let expire_state = objects_arr[id][adapter.namespace].state;
    if(objects_arr[id].type == 'boolean') {
        expire_state = expire_state === true;
    } else if(objects_arr[id].type == 'number') {
        expire_state = Number(expire_state);
    } else if(objects_arr[id].type == 'string') {
        expire_state = String(expire_state);
    } else {
        adapter.log.warn('Type ' + objects_arr[id].type + ' for id: ' + id + ', does not supported');
        delete objects_arr[id];
        return;
    }

    objects_arr[id].expire_interval = expire_interval;
    objects_arr[id].expire_state = expire_state;
    objects_arr[id].expire_ack = expire_ack;

    adapter.getForeignState(id, function(err, state) {
        if (err || !state) {
            adapter.log.error('Failed to get state for id: ' + id);
            return;
        }
        process(id, state, expire_interval, expire_state, expire_ack);
    });
}

function main() {
    adapter.log.info('Expire adapter started!');
    adapter.objects.getObjectView('expire', 'state', {}, function (err, doc) {
        if(doc && doc.rows) {
            for(let i = 0, l = doc.rows.length; i < l; i++) {
                let obj = doc.rows[i];
                if(obj && obj.id && obj.value && obj.value.custom && obj.value.custom[adapter.namespace] && obj.value.custom[adapter.namespace].enabled) {
                    addToObjects(obj.id, obj);
                }
            }
        }
    });

    adapter.subscribeForeignObjects('*');
    adapter.subscribeForeignStates('*');
}

// If started as allInOne/compact mode => return function to create instance
if(module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
} 
