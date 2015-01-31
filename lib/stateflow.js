/*jslint node: true */
'use strict';
/**
 * @module stateflow
 */
var util = require('util');
var EventEmitter = require('events').EventEmitter;

/**
 * @typedef stateDefinition
 * @property type {string} 'begin': initial state on flow start, 'state': normal state (default), 'end': flow terminates when this state 
 * @property action {action} executed when the state becomes active, defined a function, action name to use a registered action or subflow object flow defintion. 
 * @property on {object} key is state completion event value is the next state to goto. 'objectName.eventName' is also supported, aka if this.get('objectName') emits eventName then goto the next state .
 */

 /**
 * @typedef flowDefinition {object}
 * @property *stateName* {stateDefinition} every state has a state name and a state definition.
 */

/**
 * Instance assigned to each state in a flow and bound to the action's this variable.
 * 
 * @constructor
 * @param {object} config subflow definition which might contain additional properties.
 * @param {string} name state name.
 * @param {StateFlow} parent flow.
 * @property {boolean} active is true when the state is the current state (initial false offcourse).
 * @property {StateFlow|undefined} parent only set on subflows and regular states.
 * @property {stateDefinition} config state defintion
 */
function State(config, name, parent) {
    var self = this;
    this.data = {};

    /**
     * @typedef {object} StateFlow~stateDefinition
     * @property {string|State~action|flowDefinition} action - the state action to be executed when the state becomes active
     * @property {object} - an object where the key is the completion event and the value the next target state when this state completes with matching event, * means all events.
     */
    this.config = config;
    this.name = name;
    this.parent = parent;

    // an array of objects with follwing properties: target, event, listener
    this.listeners = [];

    this.flowActiveListeners = [];

    this.on('exit', function () {
        this.listeners.forEach(function (config) {
            config.source.removeListener(config.event, config.listener);
        });
        this.listeners = [];
        this.cancelTimeout();
    });

    if(parent) {
        parent.once('flow:exit', function() {
            self.flowActiveListeners.forEach( function(config) {
                config.source.removeListener(config.event, config.listener);
            });
            self.flowActiveListeners = [];
        });
    }

    this.timeout = 0;


    this.listeners = [];
}

util.inherits(State, EventEmitter);
/**
 * Get an object value from the current state or it's parents.
 * @param name {string} the object name
 */
State.prototype.get = function (name) {
    var value;
    if (this.data[name]) {
        value = this.data[name];
    } else if (this.parent) {
        value = this.parent.get(name);
    }
    if (typeof value === 'function') {
        return value();
    }
    return value;
};

/**
 * Set a property
 * @param name {string} 
 * @param obj {object|function} object or getter function executed on {@link State#get}
 */
State.prototype.set = function (name, obj) {
    this.data[name] = obj;
};

State.prototype.createListenerConfig = function(objectOrName, event, listener) {

    var self = this, listenerConfig = {
        source: typeof objectOrName === 'object' ? objectOrName : this.get(objectOrName),
        event: event,
        listener: listener
    };

    if(listener === undefined) { // listener is undefined so orignal event is complete event
        listenerConfig.listener = function () {
            self.stateComplete(event);
        };
    } else if (typeof listener === 'string') { // listener is a string complete event
        listenerConfig.listener = function () {
            self.stateComplete(listener);
        };
    } else {
        listenerConfig.listener = function () {
            listener.apply(self, arguments); // call the listener with stateobject as "this"
        };
    }
    return listenerConfig;
};
 /**
  * Listen to an event while the state is active
  *
  * All events registered with 'onStateActive' are automatically removed when the state exits.
  *
  * @param objectOrName {object|string} the service name (string) which was registered with set or event emitter instance (object), 
  * @param event {string} the event to listen on
  * @param listener {callback|string} event listener function or state completion event 
  */
State.prototype.onStateActive = function (objectOrName, event, listener) {
    var listenerConfig = this.createListenerConfig(objectOrName,event, listener);

    if(typeof listenerConfig.source === 'object' && typeof listenerConfig.source.on === 'function') {
        listenerConfig.source.on(listenerConfig.event, listenerConfig.listener);
        this.listeners.push(listenerConfig); // listeners must be renamed too stateActiveListeners.
    }

};

State.prototype.listenTo = function(objectOrName, event, listener) {
    console.error("listenTo is deprecated please use 'onStateActive'");
    this.onStateActive(objectOrName, event, listener);
};

/**
 * Listen for flow events while the flow is running an objectOrName, event, the listener will be registered only once.
 * for the same set of arguments per state, even when called multiple times which is the typical use case.
 * @param objectOrName
 * @param event
 * @param listener
 */
State.prototype.onFlowActive = function(objectOrName, event, listener) {
    var list, listenerConfig, key = {source: objectOrName, event:event, listener: listener};

    list = this.flowActiveListeners.filter(function (config) {
        return config.key.source === key.source && config.key.event === key.event && config.key.listener === key.listener;
    });

    if(list.length === 0) {
        listenerConfig = this.createListenerConfig(objectOrName, event, listener);
        listenerConfig.key = key;
        if(typeof listenerConfig.source === 'object' && typeof listenerConfig.source.on === 'function') { // only register if we have a valid source object1
            listenerConfig.source.on(listenerConfig.event, listenerConfig.listener);
            this.flowActiveListeners.push(listenerConfig);
        }
    } else if(list.length > 1) {
        throw new Error('More than one of the same onFlowActive listener registered!');
    }

};

/**
 * Cancel the previous installed timeout, always executed when state exits.
 * Can be used within a state action.
 */
State.prototype.cancelTimeout = function () {
    if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
    }
    delete this.lastTimeoutAction;
    delete this.lastTimeoutTime;
};

/**
 * Install a state timeout handler, an active timeout is automatically cancelled before going to the next state.
 * If handler is omitted then the last handler after cancelTimeout() will be reset also the last timeout time will be reset if omitted and available.
 * @param timeout {integer} timeout in milliseconds
 * @param handler {callback|string} function or completion event (string).
 */
State.prototype.installTimeout = function (timeout, handler) {
    var cb, self = this, effectiveTimeout = timeout || this.lastTimeoutTime;
    if (typeof handler === 'function') {
        cb = function () {
            handler.call(self);
        };
    } else if (typeof handler === 'string') {
        cb = function () {
            self.stateComplete(handler);
        };
    } else if (this.lastTimeoutAction) { 
        // install timeout without handler will reinstall the last after cancelTimeout() if there was such one.
        cb = this.lastTimeoutAction;
    } else {
        cb = function () {
            self.stateComplete('timeout');
        };
    }
    if( effectiveTimeout === undefined ) {
        throw new Error('Could not determ timeout value!');
    }

    this.cancelTimeout();

    this.timeoutHandle = setTimeout(cb, effectiveTimeout );
    this.lastTimeoutAction = cb;
    this.lastTimeoutTime = effectiveTimeout;
};

/**
 * StateFlow is an async event state machine, using js object notation.<br/>
 * Each property is a state the value is the state definition, state definition has:<br/>
 *  action: function, register action, or subflow definition.<br/>
 *  on: a mapping between state completion events and target state<br/>
 *  type: 'begin': the initial state of the flow, 'end': the state that terminates the flow after execution the action.
 *
 * <pre>
 * Usage:
 * var flow = new StateFlow({
 *      beginState: {
 *          type: 'begin',
 *          action: function (complete) {
 *              complete('anEvent');
 *          },
 *          on: {
 *              anEvent:'nextState'
 *          }
 *      },
 *      nextState: {
 *          type: 'end',
 *          action: function (complete) {
 *              complete('done'); 
 *          } 
 *      }
 * });
 * flow.start(function (event) {
 *     if(event !== 'done') throw new Error('event must be done, as in nextState');
 * });
 * </pre>
 * @extends State
 * @constructor
 * @param config {flowDefinition} flow definition
 * @property currentState {string}
 * @property parent {StateFlow}
 */
function StateFlow(config) {
    /**
     * @typedef StateFlow~flowDefinition {object} where the key is the state and the value a {@link stateDefinition}
     */
    State.call(this, config);
    this.actions = {};
    this.actionsInitializers = {};
    this.actionsDestructors = {};

    this.states = {};
    this.on('newListener', function (event, listener) {
        // call a state listener when the state is already active
        if (event === 'state:' + this.currentState) {
            listener.call(this, this.currentState);
        }
    });

    this.on('flow:entry', function() {
        Object.keys(config).forEach(function (state) {
            this.initializeState(state);
        }, this);
    });

    this.on('flow:exit', function() {
        Object.keys(config).forEach(function (state) {
            this.destroyState(state);
        }, this);
        this.states = {};
    });

    this.serviceFromEventSeparator = '.';
}
util.inherits(StateFlow, State);

/**
 * Register a named action function
 * @param name the name to be used in the state action property
 * @param action the function to be as 'state action'
 * @memberof StateFlow
 */
StateFlow.prototype.registerAction = function (name, action, initializer, destructor) {
    this.actions[name] = action;
    if(typeof initializer ==='function') {
        this.actionsInitializers[name] = initializer;
    }
    if(typeof destructor === 'function') {
        this.actionsDestructors[name] = destructor;
    }
};

/**
 * Get registered action from the current flow, travel the parent chain until the named action is found (action's registered in the parent flow are also available in the subflow).
 * @returns literal registered action {string|object|function}
 * @private
 */
StateFlow.prototype.getRegisteredAction = function (name) {
    if (this.actions[name]) {
        return this.actions[name];
    }
    if (this.parent) {
        return this.parent.getRegisteredAction(name);
    }
};

/**
 * @param state {string} state name of a subflow
 * @returns {object} flow definition of a subflow.
 * @private
 */
StateFlow.prototype.getSubFlowConfig = function (state) {
    var def = this.config[state], action;
    if (typeof def.action === 'object') {
        action = def.action;
    } else if (typeof def.action === 'string') {
        action = this.getRegisteredAction(def.action);
        if (typeof action !== 'object') {
            throw new Error(def + ' is not a subflow!');
        }
    } else {
        throw new Error(def.action + ' is not a subflow!');
    }

    return action;
};

/**
 * Check state action is a subflow or references a subflow.
 * @returns {Boolean}
 * @private
 */
StateFlow.prototype.isSubFlowState = function (state) {
    var def = this.config[state];
    if (typeof def.action === 'object') {
        return true;
    }
    if (typeof def.action === 'string' && typeof this.getRegisteredAction(def.action) === 'object') {
        return true;
    }
    return false;
};

StateFlow.prototype.initializeState = function(state) {
    var stateObject = this.getStateObject(state);

    if(typeof this.config[state].initialize === 'function') {
        this.config[state].initialize.call(stateObject);
    } else if(typeof state.action ==='string') {
        if( this.actionsInitializers[state.action]) {
            this.actionsInitializers[state.action].call(stateObject);
        }
    }

};

StateFlow.prototype.destroyState = function(state) {
    var stateObject = this.getStateObject(state);

    if(typeof this.config[state].destroy === 'function') {
        this.config[state].destroy.call(stateObject);
    }  else if(typeof state.action ==='string') {
        if( this.actionsDestructors[state.action]) {
            this.actionsDestructors[state.action].call(stateObject);
        }
    }

};

/**
 * Get state action function
 * @param state state name to get the action from.
 * @returns {action}
 * @private
 */
StateFlow.prototype.getAction = function (state) {
    var def = this.config[state], action;

    if (typeof def.action === 'function') {
        return def.action;
    }
    if (typeof def.action === 'string') {
        action = this.getRegisteredAction(def.action);
        if (typeof action === 'object') {
            return this.createSubFlowAction();
        }
        return action;
    }
    if (typeof def.action) {
        return this.createSubFlowAction();
    }
    throw new Error("No action found for state '" + state + "'");
};



/**
 * @returns {action} subflow state action
 * @private
 */
StateFlow.prototype.createSubFlowAction = function () {
    return function (complete) {
        this.start(function (event) {
            complete(event);
        });
    };
};


/**
 * Start the flow with the state of type 'begin' 
 * @param complete {completion} callback to be called when the end state has been reached.
 */
StateFlow.prototype.start = function (complete) {
    var self = this, states = this.findStatesByType('begin');

    if (states.length === 0) {
        throw new Error('No begin state found!');
    }
    if (states.length > 1) {
        throw new Error('Too many begin states found!');
    }
    this.emit('flow:entry');


    this.stateComplete = function(event) {
        self.emit('flow:exit');
        if( typeof complete ==='function') {
            complete(event);
        }
    };


    this.go(states[0], this.stateComplete);
};

/**
 * Find state by type
 * @param state type to look for
 * @private
 */
StateFlow.prototype.findStatesByType = function (type) {
    var result = Object.keys(this.config).filter(function (stateName) {
        if (this[stateName].type === type || (type === 'state' && this[stateName].type === undefined)) {
            return true;
        }
    }, this.config);

    return result;
};

/**
 * Set the flow in a specific state, this function is still considered internal because abruptly goes to the target state.
 * @param state {string} target state
 * @param complete {completion} the callback to be called when a state of type 'end' is reached, aka when the "flow-state" has been ended.
 * @property {string} currentState is set to the given state.
 * @private
 */
StateFlow.prototype.go = function (state, complete) {
    var stateDefinition = this.config[state], stateObj, action;

    if (stateDefinition === undefined) {
        throw new Error("No state defination found for state '" + state + "'");
    }

    stateObj = this.getStateObject(state);
     /**
      * State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>
      * If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>
      * If defined by flow definition then start and end of the flow will be mapped to the state.
      *
      * @callback action
      * @param completion {completion} state completion callback
      * @this {State}
      */
    action = this.getAction(state);
    if (action === undefined) {
        throw new Error(state + '.action' + ' is undefined');
    }
    stateObj.active = true;
    this.currentState = state;
    stateObj.stateComplete = this.createStateHandler(state, stateObj, complete);
    this.forwardServiceEvents(stateObj, stateDefinition.on);
    /** 
     * State entry event fired just before a state action is called
     * @event State~entry 
     */
    stateObj.emit('entry', state);
     /** 
      * Event fired when a specific stateName state has been reached, if new listener is added with an state:stateName which is already
      * current then the event will also be fired (stateName must must be replaced with an actual state).
      * @event StateFlow~state:stateName 
      */
    this.emit('state:' + state);
    action.call(stateObj, stateObj.stateComplete);
};

StateFlow.prototype.forwardServiceEvents = function (stateObject, on, complete) {
    var forwardEvents = [];
    if (typeof on === 'object') {
        forwardEvents = Object.keys(on).filter(function(key) {
            return key.indexOf(this.serviceFromEventSeparator) !== -1;
        }, this);
    }
    forwardEvents.forEach(function (key) {
        var serviceAndEvent = key.split(this.serviceFromEventSeparator);
        
        stateObject.listenTo(serviceAndEvent[0], serviceAndEvent[1], function (event) {
            this.stateComplete(key); // when the service.event appears, emit it agian as service.event event!
        });
    }, this);
};

/**
 * Create a completion function action parameter callback, the callback moves the flow to the next state when an on event matches a completation event.
 * @param state {string} the state where callback is created for
 * @param stateObj {object} 
 * @param flowCompleted {completion} end of flow callback.
 * @return complete {completion}
 * @private
 */
StateFlow.prototype.createStateHandler = function (state, stateObj, flowCompleted) {
    var stateDefinition = this.config[state], self = this, completed = false, stateCompletion;

    if (stateDefinition === undefined) {
        throw new Error("No state defination found for state '" + state + "'");
    }

    /**
     * State completion callback  available as first argument of {@link action} or as stateComplete property of {@link State}.
     * @name completion
     * @callback completion
     * @param event {string} completion event
     */
    stateCompletion = function (event) {
        var targetState, exitFunction;
        exitFunction = function () {
            completed = true;
            /** 
             * State exit event with the completed state name, at this point the state is no longer active.
             * @event State~exit 
             */
            stateObj.emit('exit', targetState);
            stateObj.active = false;
        };
        if (!completed) {
            if (stateDefinition.type === 'end') {
                exitFunction();
                flowCompleted(event);
            } else if (typeof stateDefinition.on === 'object' && stateDefinition.on[event]) {
                targetState = stateDefinition.on[event];
            } else if (typeof stateDefinition.on === 'object' && stateDefinition.on['*']) {
                targetState = stateDefinition.on['*'];
            }
            if (targetState) {
                exitFunction();
                self.go(targetState, flowCompleted);
            }
        } else {
            console.error("State '" + state + "' already completed!");
        }
    };

    return stateCompletion;
};

/**
 * Get the state instance object, which is associated with the state action this.
 * Used to provide functionallity and data state see {State}.
 *
 * For every state there is state object.
 * @param state {string} state name to get an state object for
 * @return {State} state instance object
 */
StateFlow.prototype.getStateObject = function (state) {
    if (!this.states[state]) {
        if (this.isSubFlowState(state)) {
            this.states[state] = new StateFlow(this.getSubFlowConfig(state));
        } else {
            this.states[state] = new State(this.config[state]);
        }
        this.states[state].name = state;
        this.states[state].parent = this;
    }
    return this.states[state];
};

module.exports.StateFlow = StateFlow;