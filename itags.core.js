
/*jshint proto:true */

"use strict";

require('polyfill/polyfill-base.js');
require('./css/itags.core.css');

var jsExt = require('js-ext/js-ext.js'), // want the full version: include it at the top, so that object.merge is available
    createHashMap = require('js-ext/extra/hashmap.js').createMap,
    asyncSilent = require('utils').asyncSilent,
    laterSilent = require('utils').laterSilent,
    CLASS_ITAG_RENDERED = 'itag-rendered',
    DEFAULT_CHAIN_INIT = true,
    DEFAULT_CHAIN_DESTROY = true,
    Classes = jsExt.Classes,
    NODE = 'node',
    REMOVE = 'remove',
    INSERT = 'insert',
    CHANGE = 'change',
    ATTRIBUTE = 'attribute',
    NODE_REMOVED = NODE+REMOVE,
    NODE_INSERTED = NODE+INSERT,
    NODE_CONTENT_CHANGE = NODE+'content'+CHANGE,
    ATTRIBUTE_REMOVED = ATTRIBUTE+REMOVE,
    ATTRIBUTE_CHANGED = ATTRIBUTE+CHANGE,
    ATTRIBUTE_INSERTED = ATTRIBUTE+INSERT,
    DELAYED_FINALIZE_EVENTS = {
        'mousedown': true,
        'mouseup': true,
        'mousemove': true,
        'panmove': true,
        'panstart': true,
        'panleft': true,
        'panright': true,
        'panup': true,
        'pandown': true,
        'pinchmove': true,
        'rotatemove': true,
        'focus': true,
        'blur': true,
        'keydown': true,
        'keyup': true,
        'keypress': true
    },
    DELAYED_EVT_TIME = 1000,
    ITAG_METHODS = createHashMap({
        init: '_initUI',
        render: 'renderUI', // only one without leading underscore
        destroy: '_destroyUI'
    }),
    // ITAG_METHOD_VALUES must match previous ITAG_METHODS's values!
    ITAG_METHOD_VALUES = createHashMap({
        _initUI: true,
        renderUI: true, // only one without leading underscore
        _destroyUI: true
    }),
    merge = function (sourceObj, targetObj) {
        var name;
        for (name in sourceObj) {
            targetObj[ITAG_METHODS[name] || name] = sourceObj[name];
        }
    },
    NOOP = function() {},
    // Define configurable, writable and non-enumerable props
    // if they don't exist.
    defineUnNumerableProperty = function (object, name, method) {
        Object.defineProperty(object, name, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: method
        });
    },
    EXTRA_BASE_MEMBERS = {
        initUI: function(constructor) {
            var instance = this,
                vnode = instance.vnode,
                superInit;
            if (!vnode.ce_initialized && !vnode.removedFromDOM && !vnode.ce_destroyed) {
                superInit = function(constructor) {
                    var classCarierBKP = instance.__classCarier__;
                    if (constructor.$$chainInited) {
                        instance.__classCarier__ = constructor.$$super.constructor;
                        superInit(constructor.$$super.constructor);
                    }
                    classCarierBKP = instance.__classCarier__;
                    // don't call `hasOwnProperty` directly on obj --> it might have been overruled
                    Object.prototype.hasOwnProperty.call(constructor.prototype, '_initUI') && constructor.prototype._initUI.call(instance);
                };
                superInit(constructor || instance.constructor);
                Object.protectedProp(vnode, 'ce_initialized', true);
            }
        },
        destroyUI: function(constructor) {
            var instance = this,
                vnode = instance.vnode,
                superDestroy;
            if (vnode.ce_initialized && vnode.removedFromDOM && !vnode.ce_destroyed) {
                superDestroy = function(constructor) {
                    var classCarierBKP = instance.__classCarier__;
                    // don't call `hasOwnProperty` directly on obj --> it might have been overruled
                    Object.prototype.hasOwnProperty.call(constructor.prototype, '_destroyUI') && constructor.prototype._destroyUI.call(instance);
                    if (constructor.$$chainDestroyed) {
                        instance.__classCarier__ = constructor.$$super.constructor;
                        superDestroy(constructor.$$super.constructor);
                    }
                    classCarierBKP = instance.__classCarier__;
                };
                superDestroy(constructor || instance.constructor);
                instance.detachAll();
                Object.protectedProp(vnode, 'ce_destroyed', true);
            }
        },
        _initUI: NOOP,
        _destroyUI: NOOP,
        renderUI: NOOP
    };

DELAYED_FINALIZE_EVENTS.keys().forEach(function(key) {
    DELAYED_FINALIZE_EVENTS[key+'outside'] = true;
});

module.exports = function (window) {

    var DOCUMENT = window.document,
        PROTOTYPE_CHAIN_CAN_BE_SET = arguments[1], // hidden feature, used by unit-test
        RUNNING_ON_NODE = (typeof global !== 'undefined') && (global.window!==window),
        PROTO_SUPPORTED = !!Object.__proto__,
        itagCore, MUTATION_EVENTS, PROTECTED_MEMBERS, Event, registerDelay, focusManager, basePrototypeNewCE, mergeFlat;

    require('vdom')(window);
    Event = require('event-dom')(window);

/*jshint boss:true */
    if (itagCore=window._ItagCore) {
/*jshint boss:false */
        return itagCore; // itagCore was already defined
    }

    Object.protectedProp(window, 'ITAGS', {}); // for the ProtoConstructors
    EXTRA_BASE_MEMBERS.merge(Event.Listener)
                      .merge(Event._CE_listener);

    PROTECTED_MEMBERS = createHashMap();
    EXTRA_BASE_MEMBERS.each(function(value, key) {
        ITAG_METHOD_VALUES[key] || (PROTECTED_MEMBERS[key] = true);
    });

    MUTATION_EVENTS = [NODE_REMOVED, NODE_INSERTED, NODE_CONTENT_CHANGE, ATTRIBUTE_REMOVED, ATTRIBUTE_CHANGED, ATTRIBUTE_INSERTED];

    mergeFlat = function(constructor, domElement) {
        var prototype = constructor.prototype,
            keys, i, name;
        if (domElement.__addedProps__) {
            // set before: erase previous properties
            domElement.__addedProps__.each(function(value, key) {
                if (key!=='$super') {
                    delete domElement[key];
                }
            });
        }
        domElement.__addedProps__ = {};
        while (prototype !== window.HTMLElement.prototype) {
            keys = Object.getOwnPropertyNames(prototype);
            for (i=0; name=keys[i]; i++) {
                if (!domElement.__addedProps__[name]) {
                    Object.defineProperty(domElement, name, Object.getOwnPropertyDescriptor(prototype, name));
                    domElement.__addedProps__[name] = true;
                }
            }
            constructor = constructor.$$super.constructor;
            prototype = constructor.prototype;
        }
    };

    focusManager = function(element) {
        var focusManagerNode = element.getElement('[focusmanager].focussed');
        focusManagerNode && focusManagerNode.focus();
    };

    itagCore = {

        itagFilter: function(e) {
            return !!e.target.getTagName().startsWith('I-');
        },

        _renderDomElements: function(tagName, updateFn, properties, isParcel) {
            var itagElements = DOCUMENT.getAll(tagName),
                len = itagElements.length,
                i, itagElement;
            for (i=0; i<len; i++) {
                itagElement = itagElements[i];
                this._upgradeElement(itagElement, updateFn, properties, isParcel);
            }
        },

        defineParcel: function(parcelName, updateFn, properties) {
            if (parcelName.contains('-')) {
                console.warn(parcelName+' should not consist of a minus token');
                return;
            }
            this._defineElement('i-parcel-'+parcelName, updateFn, properties, true);
        },


        defineElement: function(itagName) {
            if (!itagName.contains('-')) {
                console.warn('defineElement: '+itagName+' should consist of a minus token');
                return;
            }
            window.ITAGS[itagName] = function() {
                return DOCUMENT._createElement(itagName);
            };
        },

        defineItag: function(itagName, updateFn, properties) {
            if (!itagName.contains('-')) {
                console.warn('defineItag: '+itagName+' should consist of a minus token');
                return;
            }
            this._defineElement(itagName, updateFn, properties);
        },

        _defineElement: function(itagName, updateFn, properties, isParcel) {
            itagName = itagName.toLowerCase();
            if (window.ITAGS[itagName]) {
                console.warn(itagName+' already exists and cannot be redefined');
                return;
            }
            (typeof updateFn === 'function') || (updateFn=NOOP);
            this._renderDomElements(itagName, updateFn, properties, isParcel);
            window.ITAGS[itagName] = this._createElement(itagName, updateFn, properties, isParcel);
        },

        _createElement: function(itagName, updateFn, properties, isParcel) {
            var instance = this;
            return function() {
                var element = DOCUMENT._createElement(itagName);
                instance._upgradeElement(element, updateFn, properties, isParcel);
                return element;
            };
        },

        _upgradeElement: function(element, updateFn, properties, isParcel) {
            merge(properties, element);
            merge({
                _updateUI: isParcel ? function() {
                        var vnode = element.vnode;
                        if (vnode._data) {
                            if (!vnode.ce_initialized) {
                                if (typeof element._init==='function') {
                                    element._init();
                                }
                                else {
                                    Object.protectedProp(vnode, 'ce_initialized', true);
                                }
                                element._setRendered();
                            }
                            updateFn.call(element);
                        }
                    } : updateFn,
                _injectModel: function(model) {
                    var instance = this,
                        stringifiedData;
                    instance.model = model;
                    instance._updateUI();
                    if (RUNNING_ON_NODE) {
                        // store the modeldata inside an inner div-node
                        try {
                            stringifiedData = JSON.stringify(model);
                            instance.prepend('<span class="itag-data">'+stringifiedData+'</span>');
                        }
                        catch(e) {
                            console.warn(e);
                        }
                    }
                },
                _retrieveModel: function() {
                    // try to load the model from a stored inner div-node
                    var instance = this,
                        dataNode = instance.getElement('span.itag-data'),
                        stringifiedData;
                    if (dataNode) {
                        try {
                            stringifiedData = dataNode.getHTML();
                            instance.model = JSON.parseWithDate(stringifiedData);
                            dataNode.remove(true);
                        }
                        catch(e) {
                            console.warn(e);
                        }
                    }
                    return instance.model;
                },
                _setRendered: function() {
                    var instance = this;
                    if (instance.hasClass(CLASS_ITAG_RENDERED)) {
                        // already rendered on the server:
                        // bin the sored json-data on the property `model`:
                        instance.retrieveModel();
                    }
                    else {
                        instance.setClass(CLASS_ITAG_RENDERED, null, null, true);
                    }
                    instance._itagReady || (instance._itagReady=window.Promise.manage());
                    instance._itagReady.fulfill();
                },
                model: {}
            }, element);
            merge(Event.Listener, element);
            // render, but do this after the element is created:
            // in the next eventcycle:
            asyncSilent(function() {
                (typeof element._init==='function') && element._init();
                element._updateUI();
                isParcel || element._setRendered();
                element.hasClass('focussed') && focusManager(element);
            });
        }

    };

    DOCUMENT._createElement = DOCUMENT.createElement;
    DOCUMENT.createElement = function(tag) {
        var ItagClass = window.ITAGS[tag.toLowerCase()];
        if (ItagClass) {
            return new ItagClass();
        }
        return this._createElement(tag);
    };


    (function(FunctionPrototype) {
        var originalSubClass = FunctionPrototype.subClass;

        FunctionPrototype._mergePrototypes = FunctionPrototype.mergePrototypes;
        FunctionPrototype.mergePrototypes = function(map, force) {
            var instance = this;
            if (!instance.isItag) {
                // default mergePrototypes
                instance._mergePrototypes.apply(instance, arguments);
            }
            else {
                instance._mergePrototypes(map, force, ITAG_METHODS, PROTECTED_MEMBERS);
                Event.emit(instance, 'itag:prototypechanged', {map: map, force: force});
            }
            return instance;
        };

        FunctionPrototype._removePrototypes = FunctionPrototype.removePrototypes;
        FunctionPrototype.removePrototypes = function(properties) {
            var instance = this;
            instance._removePrototypes.apply(instance, arguments);
            instance.isItag && Event.emit(instance, 'itag:prototyperemoved', {properties: properties});
            return instance;
        };

        FunctionPrototype.subClass = function(constructor, prototypes, chainInit, chainDestroy) {
            var instance = this,
                baseProt, proto, domElementConstructor, itagName;
            if (typeof constructor === 'string') {
                // Itag subclassing
                if (typeof prototypes === 'boolean') {
                    chainDestroy = chainInit;
                    chainInit = prototypes;
                    prototypes = null;
                }
                (typeof chainInit === 'boolean') || (chainInit=DEFAULT_CHAIN_INIT);
                (typeof chainDestroy === 'boolean') || (chainDestroy=DEFAULT_CHAIN_DESTROY);

                itagName = constructor.toLowerCase();
                if (window.ITAGS[itagName]) {
                    console.warn(itagName+' already exists: it will be redefined');
                }

                // if instance.isItag, then we subclass an existing i-tag
                baseProt = instance.prototype;
                proto = Object.create(baseProt);

                // merge some system function in case they don't exists
                domElementConstructor = function() {
                    var domElement = DOCUMENT._createElement(itagName);
                    if (!PROTO_SUPPORTED) {
                        mergeFlat(domElementConstructor, domElement);
                        domElement.__proto__ = proto;
                        domElement.__classCarier__ = domElementConstructor;
                        domElement.initUI(domElementConstructor);
                        domElement.after(['itag:prototypechanged', 'itag:prototyperemoved'], function() {
                            mergeFlat(domElementConstructor, domElement);
                        });
                    }
                    else {
                        domElement.__proto__ = proto;
                        domElement.__classCarier__ = domElementConstructor;
                        domElement.initUI();
                    }
                    return domElement;
                };

                domElementConstructor.prototype = proto;

                proto.constructor = domElementConstructor;
                domElementConstructor.$$chainInited = chainInit ? true : false;
                domElementConstructor.$$chainDestroyed = chainDestroy ? true : false;
                domElementConstructor.$$super = baseProt;
                domElementConstructor.$$orig = {};
                Object.protectedProp(domElementConstructor, 'isItag', true); // so that `mergePrototype` can identify

                prototypes && domElementConstructor.mergePrototypes(prototypes, true);
                window.ITAGS[itagName] = domElementConstructor;
                return domElementConstructor;
            }
            else {
                // Function subclassing
                return originalSubClass.apply(instance, arguments);
            }
        };

    }(Function.prototype));



    var createItagBaseClass = function () {
        return Function.prototype.subClass.apply(window.HTMLElement);
    };

    /**
     * Returns a base class with the given constructor and prototype methods
     *
     * @for Object
     * @method createClass
     * @param [constructor] {Function} constructor for the class
     * @param [prototype] {Object} Hash map of prototype members of the new class
     * @static
     * @return {Function} the new class
    */
    Object.protectedProp(Classes, 'ItagBaseClass', createItagBaseClass().mergePrototypes(EXTRA_BASE_MEMBERS, true, {}, {}));

    // because `mergePrototypes` cannot merge object-getters, we will add the getter `$super` manually:
    Object.defineProperties(Classes.ItagBaseClass.prototype, Classes.coreMethods);

    Object.defineProperty(Classes.ItagBaseClass.prototype, '$superProp', {
        value: function(/* func, *args */) {
            var instance = this,
                classCarierReturn = instance.__$superCarierStart__ || instance.__classCarier__ || instance.__methodClassCarier__,
                currentClassCarier = instance.__classCarier__ || instance.__methodClassCarier__,
                args = arguments,
                superClass, superPrototype, firstArg, returnValue;

            instance.__$superCarierStart__ = null;
            if (args.length === 0) {
                instance.__classCarier__ = classCarierReturn;
                return;
            }

            superClass = currentClassCarier.$$super.constructor,
            superPrototype = superClass.prototype,
            firstArg = Array.prototype.shift.apply(args); // will decrease the length of args with one
            firstArg = ITAG_METHODS[firstArg] || firstArg;
            (firstArg === '_initUI') && (firstArg='initUI'); // to re-initiate chaining
            (firstArg === '_destroyUI') && (firstArg='destroyUI'); // to re-initiate chaining
            if ((firstArg==='initUI') && currentClassCarier.$$chainInited) {
                console.warn('init cannot be invoked manually, because the Class is `chainInited`');
                return currentClassCarier;
            }

            if ((firstArg==='destroyUI') && currentClassCarier.$$chainDestroyed) {
                console.warn('destroy cannot be invoked manually, because the Class is `chainDestroyed`');
                return currentClassCarier;
            }

            if (typeof superPrototype[firstArg] === 'function') {
                instance.__classCarier__ = superClass;
                if ((firstArg==='initUI') || (firstArg==='destroyUI')) {
                    returnValue = superPrototype[firstArg].call(instance, instance.__classCarier__);
                }
                else {
                    returnValue = superPrototype[firstArg].apply(instance, args);
                }
            }
            instance.__classCarier__ = classCarierReturn;
            return returnValue || superPrototype[firstArg];
        }
    });

    /**
     * Returns a base class with the given constructor and prototype methods
     *
     * @for Object
     * @method createClass
     * @param [constructor] {Function} constructor for the class
     * @param [prototype] {Object} Hash map of prototype members of the new class
     * @static
     * @return {Function} the new class
    */
    Object.protectedProp(DOCUMENT, 'createItag', Classes.ItagBaseClass.subClass.bind(Classes.ItagBaseClass));




    (function(HTMLElementPrototype) {
        HTMLElementPrototype.isItag = function() {
            return !!this.vnode.tag.startsWith('I-');
        };
        HTMLElementPrototype.itagReady = function() {
            var instance = this;
            if (!instance.isItag()) {
                console.warn('itagReady() invoked on a non-itag element');
                return window.Promise.reject('Element is no itag');
            }
            instance._itagReady || (instance._itagReady=window.Promise.manage());
            return instance._itagReady;
        };
    }(window.HTMLElement.prototype));

    DOCUMENT.refreshParcels = function() {
        var list = this.getParcels(),
            len = list.length,
            i, parcel;
        for (i=0; i<len; i++) {
            parcel = list[i];
            parcel.renderUI();
            parcel.hasClass('focussed') && focusManager(parcel);
        }
    };

    Event.after(
        [ATTRIBUTE_CHANGED, ATTRIBUTE_INSERTED, ATTRIBUTE_REMOVED],
        function(e) {
            var element = e.target;
            element.renderUI();
            element.hasClass('focussed') && focusManager(element);
        },
        itagCore.itagFilter
    );

    Event.after(
        NODE_REMOVED,
        function(e) {
            var node = e.target;
            (typeof node.destroyUI==='function') && node.destroyUI(PROTO_SUPPORTED ? null : node.__proto__.constructor);
        },
        itagCore.itagFilter
    );

    Event.finalize(function(e) {
        if (DELAYED_FINALIZE_EVENTS[e.type]) {
            registerDelay || (registerDelay = laterSilent(function() {
                DOCUMENT.refreshParcels();
                registerDelay = null;
            }, DELAYED_EVT_TIME));
        }
        else {
            DOCUMENT.refreshParcels();
        }
    });

    // we patch the window timer functions in order to run `refreshParcels` afterwards:
    window._setTimeout = window.setTimeout;
    window._setInterval = window.setInterval;

    window.setTimeout = function() {
        var args = arguments;
        args[0] = (function(originalFn) {
            return function() {
                originalFn();
                DOCUMENT.refreshParcels();
            };
        })(args[0]);
        window._setTimeout.apply(this, arguments);
    };

    window.setInterval = function() {
        var args = arguments;
        args[0] = (function(originalFn) {
            return function() {
                originalFn();
                DOCUMENT.refreshParcels();
            };
        })(args[0]);
        window._setInterval.apply(this, arguments);
    };

    if (typeof window.setImmediate !== 'undefined') {
        window._setImmediate = window.setImmediate;
        window.setImmediate = function() {
            var args = arguments;
            args[0] = (function(originalFn) {
                return function() {
                    originalFn();
                    DOCUMENT.refreshParcels();
                };
            })(args[0]);
            window._setImmediate.apply(this, arguments);
        };
    }

    Object.protectedProp(window, '_ItagCore', itagCore);

    if (PROTOTYPE_CHAIN_CAN_BE_SET) {
        itagCore.setPrototypeChain = function(activate) {
            PROTO_SUPPORTED = activate ? !!Object.__proto__ : false;
        };
    }

    return itagCore;

};