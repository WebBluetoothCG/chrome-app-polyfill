/*
Copyright 2014 Google Inc. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

(function () {
'use strict';

// https://webbluetoothcg.github.io/web-bluetooth/ interface
function BluetoothDevice(chromeDeviceAddress) {
  this._address = chromeDeviceAddress;
};
window.BluetoothDevice = BluetoothDevice;

BluetoothDevice.prototype = {
  _updateFrom: function(chromeBluetoothDevice) {
    this._name = chromeBluetoothDevice.name;
    this._deviceClass = chromeBluetoothDevice.deviceClass
    this._vendorIdSource = chromeBluetoothDevice.vendorIdSource;
    this._vendorId = chromeBluetoothDevice.vendorId;
    this._productId = chromeBluetoothDevice.productId;
    this._productVersion = chromeBluetoothDevice.productVersion;
    this._paired = chromeBluetoothDevice.paired;
    this._connected = chromeBluetoothDevice.connected;
    this._uuids = chromeBluetoothDevice.uuids;
  },

  get address() {
    return this._address;
  },
  get name() {
    return this._name;
  },
  get deviceClass() {
    return this._deviceClass;
  },
  get vendorIdSource() {
    return this._vendorIdSource;
  },
  get vendorId() {
    return this._vendorId;
  },
  get productId() {
    return this._productId;
  },
  get productVersion() {
    return this._productVersion;
  },
  get paired() {
    return this._paired;
  },
  get connected() {
    return this._connected;
  },
  get uuids() {
    return this._uuids;
  },

  connect: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.connect,
                              self.address, {persistent: false}
      ).then(function() {
        self._connected = true;
      });
  },

  disconnect: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.disconnect, self.address
      ).then(function() {
        self._connected = false;
      });
  },

  getAllServices: function(serviceUuids) {
    var self = this;
    return getChildren({
      chromeSearchFunction: chrome.bluetoothLowEnergy.getServices,
      parentChromeId: self.address,
      uuids: serviceUuids,
      webConstructor: function(service) { return updateService(service); },
    });
  },

  getService: function(serviceUuid) {
    return firstOrNull(this.getAllServices([serviceUuid]))
  },
};

function BluetoothGattService(webBluetoothDevice, chromeBluetoothService) {
  this._device = webBluetoothDevice;
  this._chromeService = chromeBluetoothService;
};
window.BluetoothGattService = BluetoothGattService;

BluetoothGattService.prototype = {
  get uuid() {
    return this._chromeService.uuid;
  },
  get isPrimary() {
    return this._chromeService.isPrimary;
  },
  get instanceId() {
    return this._chromeService.instanceId;
  },
  get device() {
    return this._device;
  },

  getAllCharacteristics: function(characteristicUuids) {
    var self = this;
    return getChildren({
      chromeSearchFunction: chrome.bluetoothLowEnergy.getCharacteristics,
      parentChromeId: self.instanceId,
      uuids: characteristicUuids,
      webConstructor: function(characteristic) { return updateCharacteristic(characteristic); },
    });
  },

  getCharacteristic: function(characteristicUuid) {
    return firstOrNull(this.getAllCharacteristics([characteristicUuid]))
  },

  getAllIncludedServices: function(serviceUuids) {
    var self = this;
    return getChildren({
      chromeSearchFunction: chrome.bluetoothLowEnergy.getIncludedServices,
      parentChromeId: self.instanceId,
      uuids: serviceUuids,
      webConstructor: function(service) { return updateService(service); },
    });
  },

  getIncludedService: function(serviceUuid) {
    return firstOrNull(this.getAllIncludedServices([serviceUuid]))
  },
};

var characteristicPropertyNames = ["broadcast", "read", "writeWithoutResponse", "write", "notify", "indicate", "authenticatedSignedWrites", "extendedProperties", "reliableWrite", "writableAuxiliaries"];

function BluetoothGattCharacteristic(webBluetoothService, chromeCharacteristicId) {
  this._service = webBluetoothService;
  this._instanceId = chromeCharacteristicId;
};
window.BluetoothGattCharacteristic = BluetoothGattCharacteristic;

BluetoothGattCharacteristic.prototype = {
  _updateFrom: function(chromeBluetoothCharacteristic) {
    this._uuid = chromeBluetoothCharacteristic.uuid;
    this._value = chromeBluetoothCharacteristic.value;

    this._properties = {};
    for (var property of characteristicPropertyNames) {
      this._properties[property] = false;
    }
    for (var property of chromeBluetoothCharacteristic.properties) {
      this._properties[property] = true;
    }
    Object.freeze(this._properties);
  },

  get uuid() {
    return this._uuid;
  },
  get service() {
    return this._service;
  },
  get properties() {
    return this._properties;
  },
  get instanceId() {
    return this._instanceId;
  },
  get value() {
    return this._value;
  },

  getAllDescriptors: function(descriptorUuids) {
    var self = this;
    return getChildren({
      chromeSearchFunction: chrome.bluetoothLowEnergy.getDescriptors,
      parentChromeId: self.instanceId,
      uuids: descriptorUuids,
      webConstructor: function(descriptor) { return updateDescriptor(descriptor); },
    });
  },

  getDescriptor: function(descriptorUuid) {
    return firstOrNull(this.getAllDescriptors([descriptorUuid]));
  },

  readValue: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.readCharacteristicValue, self.instanceId
      ).then(function(args) {
        var characteristic = args[0];
        self._updateFrom(characteristic);
        return characteristic.value;
      });
  },

  writeValue: function(newValue) {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.writeCharacteristicValue,
                              self.instanceId, newValue
      ).then(function() {});
  },

  startNotifications: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.startCharacteristicNotifications,
                              self.instanceId, {persistent: false}
      ).then(function() {});
  },

  stopNotifications: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.stopCharacteristicNotifications,
                              self.instanceId
      ).then(function() {});
  },
};

function BluetoothGattDescriptor(webBluetoothCharacteristic, chromeDescriptorId) {
  this._characteristic = webBluetoothCharacteristic;
  this._instanceId = chromeDescriptorId;
};
window.BluetoothGattDescriptor = BluetoothGattDescriptor;

BluetoothGattDescriptor.prototype = {
  _updateFrom: function(chromeBluetoothDescriptor) {
    this._uuid = chromeBluetoothDescriptor.uuid;
    this._value = chromeBluetoothDescriptor.value;
  },

  get uuid() {
    return this._uuid;
  },
  get characteristic() {
    return this._characteristic;
  },
  get instanceId() {
    return this._instanceId;
  },
  get value() {
    return this._value;
  },
  readValue: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.readDescriptorValue, self.instanceId
      ).then(function(args) {
        var descriptor = args[0];
        self._updateFrom(descriptor);
        return descriptor.value;
      });
  },
  writeValue: function(newValue) {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.writeDescriptorValue,
                              self.instanceId, newValue
      ).then(function() {});
  },
};

navigator.bluetooth = {};

// TODO: Handle the Bluetooth tree and opt_capture.
var bluetoothListeners = new Map();  // type -> Set<listener>
navigator.bluetooth.addEventListener = function(type, listener, opt_capture) {
  var typeListeners = bluetoothListeners.get(type);
  if (!typeListeners) {
    typeListeners = new Set();
    bluetoothListeners.set(type, typeListeners);
  }
  typeListeners.add(listener);
}
navigator.bluetooth.removeEventListener = function(type, listener, opt_capture) {
  var typeListeners = bluetoothListeners.get(type);
  if (!typeListeners) {
    return;
  }
  typeListeners.remove(listener);
}
var dispatchSymbol = Symbol('dispatch');
navigator.bluetooth.dispatchEvent = function(event, target) {
  if (event[dispatchSymbol]) {
    ThrowName('InvalidStateError');
  }
  event[dispatchSymbol] = true;
  try {
    event.isTrusted = false;
    event.target = target;
    event.eventPhase = Event.AT_TARGET;
    var typeListeners = bluetoothListeners.get(event.type);
    var handled = false;
    if (typeListeners) {
      for (var listener of typeListeners) {
        handled = listener(event);
        if (handled) {
          break;
        }
      }
    }
    return handled;
  } finally {
    delete event[dispatchSymbol];
  }
}

navigator.bluetooth.requestDevice = function(filters) {
  return Promise.reject(new Error('Not Implemented'));
};

var deviceCache = new Map();  // Address -> Device
navigator.bluetooth.getDevice = function(deviceAddress) {
  return callChromeFunction(chrome.bluetooth.getDevice, deviceAddress
    ).then(function(args) {
      var chromeDevice = args[0];
      return updateDevice(chromeDevice);
    });
};
function updateDevice(chromeDevice) {
  var device = deviceCache.get(chromeDevice.address);
  if (!device) {
    device = new BluetoothDevice(chromeDevice.address);
    deviceCache.set(chromeDevice.address, device);
  }
  device._updateFrom(chromeDevice);
  return device;
};

var serviceCache = new Map();  // InstanceId -> Service
navigator.bluetooth.getService = function(serviceInstanceId) {
  // Services have no dynamic data, so it's ok to skip chrome.getService().
  var service = serviceCache.get(serviceInstanceId);
  if (service)
    return Promise.resolve(service);
  return callChromeFunction(chrome.bluetoothLowEnergy.getService, serviceInstanceId
    ).then(function(args) {
      var chromeService = args[0];
      return updateService(chromeService);
    });
};
function updateService(chromeService) {
  var device = deviceCache.get(chromeService.deviceAddress);
  var devicePromise;
  if (device) {
    devicePromise = Promise.resolve(device);
  } else {
    devicePromise = navigator.bluetooth.getDevice(chromeService.deviceAddress);
  }
  return devicePromise.then(function(device) {
    var service = serviceCache.get(chromeService.instanceId);
    if (service)
      return service;
    service = new BluetoothGattService(device, chromeService);
    serviceCache.set(chromeService.instanceId, service);
    return service;
  });
};

var characteristicCache = new Map();  // InstanceId -> Characteristic
navigator.bluetooth.getCharacteristic = function(characteristicInstanceId) {
  return callChromeFunction(chrome.bluetoothLowEnergy.getCharacteristic, characteristicInstanceId
    ).then(function(args) {
      var chromeCharacteristic = args[0];
      return updateCharacteristic(chromeCharacteristic);
    });
};
function updateCharacteristic(chromeCharacteristic) {
  return updateService(chromeCharacteristic.service
    ).then(function(service) {
      var characteristic = characteristicCache.get(chromeCharacteristic.instanceId);
      if (!characteristic) {
        characteristic = new BluetoothGattCharacteristic(service, chromeCharacteristic.instanceId);
        characteristicCache.set(chromeCharacteristic.instanceId, characteristic);
      }
      characteristic._updateFrom(chromeCharacteristic);
      return characteristic;
    });
};

var descriptorCache = new Map();  // InstanceId -> Descriptor
navigator.bluetooth.getDescriptor = function(descriptorInstanceId) {
  return callChromeFunction(chrome.bluetoothLowEnergy.getDescriptor, descriptorInstanceId
    ).then(function(args) {
      var chromeDescriptor = args[0];
      return updateDescriptor(chromeDescriptor);
    });
};
function updateDescriptor(chromeDescriptor) {
  return updateCharacteristic(chromeDescriptor.characteristic
    ).then(function(service) {
      var descriptor = descriptorCache.get(chromeDescriptor.instanceId);
      if (!descriptor) {
        descriptor = new BluetoothGattDescriptor(service, chromeDescriptor.instanceId);
        descriptorCache.set(chromeDescriptor.instanceId, descriptor);
      }
      descriptor._updateFrom(chromeDescriptor);
      return descriptor;
    });
};

// Events:

function BluetoothEvent(type, initDict) {
  this.type = type;
  initDict = initDict || {};
  this.bubbles = !!initDict.bubbles;
  this.cancelable = !!initDict.cancelable;
};
BluetoothEvent.prototype = {
  __proto__: Event.prototype,
  target: null,
  currentTarget: null,
  eventPhase: Event.NONE,
};

chrome.bluetoothLowEnergy.onCharacteristicValueChanged.addListener(function(chromeCharacteristic) {
  updateCharacteristic(chromeCharacteristic).then(function(characteristic) {
    var event = new BluetoothEvent('characteristicvaluechanged');
    event.characteristic = characteristic;
    event.value = characteristic.value;
    navigator.bluetooth.dispatchEvent(event, characteristic);
  });
});


// Local helper functions:

//
// Parameters in the options struct:
//   chromeSearchFunction: the chrome.bluetoothLowEnergy function that searches for children.
//   parentChromeId: the instance ID or address of the chrome-side parent object.
//   uuids: an Array listing the uuids of children to return.
//          |undefined| means to return all children.
//   webConstructor: the constructor of the web-side instances.
//                   Will be passed the chrome-side instance, and may return a Promise.
function getChildren(options) {
  if (options.uuids !== undefined && options.uuids.length == undefined) {
    options.uuids = [options.uuids];
  }
  return callChromeFunction(options.chromeSearchFunction, options.parentChromeId
  ).then(function(args) {
    var chromeInstances = args[0];
    if (options.uuids !== undefined) {
      chromeInstances = chromeInstances.filter(function(chromeInstance) {
        return options.uuids.indexOf(chromeInstance.uuid) !== -1;
      });
    }
    return Promise.all(chromeInstances.map(function(chromeInstance) {
      return options.webConstructor(chromeInstance);
    }));
  });
};

function firstOrNull(promise) {
  return promise.then(function(array) {
    if (array.length > 0) {
      return array[0];
    }
    return null;
  });
};

function ThrowName(name) {
  var e = new Error();
  e.name = name;
  throw e;
};

// Calls fn(arguments, callback) and returns a Promise that resolves when
// |callback| is called, with the |arguments| that |callback| received.
function callChromeFunction(fn) {
  var fn_args = arguments;
  return new Promise(function(resolve, reject) {
    var args = new Array(fn_args.length);
    for (var i = 1; i < fn_args.length; ++i) {
      args[i-1] = fn_args[i];
    }
    args[args.length - 1] = function() {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message);
      } else {
        resolve(arguments);
      }
    };
    fn.apply(undefined, args);
  });
};

})();
