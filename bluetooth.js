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

function canonicalUUID(uuidAlias) {
  uuidAlias >>>= 0;  // Make sure the number is positive and 32 bits.
  var strAlias = "0000000" + uuidAlias.toString(16);
  strAlias = strAlias.substr(-8);
  return strAlias + "-0000-1000-8000-00805f9b34fb"
}

if (navigator.bluetooth) {
  // navigator.bluetooth already exists; not polyfilling.
  if (!window.BluetoothUUID) {
    window.BluetoothUUID = {};
  }
  if (!window.BluetoothUUID.canonicalUUID) {
    window.BluetoothUUID.canonicalUUID = canonicalUUID;
  }
  return;
}
if (!window.chrome || !chrome.bluetooth || !chrome.bluetoothLowEnergy) {
  console.warn("Not inside a Chrome App with the bluetooth and bluetoothLowEnergy permissions. " +
               "Can't polyfill Web Bluetooth.");
  return;
}

var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;


// Events:
function BluetoothEvent(type, initDict) {
  this.type = type;
  initDict = initDict || {};
  this.bubbles = !!initDict.bubbles;
  this.cancelable = !!initDict.cancelable;

  this._dispatching = false;
  this._trusted = false;
  this._stopImmediatePropagation = false;
  this._stopPropagation = false;
  this._canceled = false;

  this.target = null;
  this.currentTarget = null;
  this.eventPhase = Event.NONE;

  this.detail = initDict.detail;
  this.timestamp = new Date().getTime();
};
BluetoothEvent.prototype = {
  stopPropagation: function() {
    this._stopPropagation = true;
  },

  stopImmediatePropagation: function() {
    this._stopImmediatePropagation = true;
    this._stopPropagation = true;
  },

  preventDefault: function() {
    if (this.cancelable) {
      this._canceled = true;
    }
  }
};

chrome.bluetoothLowEnergy.onCharacteristicValueChanged.addListener(function(chromeCharacteristic) {
  updateCharacteristic(chromeCharacteristic).then(function(characteristic) {
    characteristic.dispatchEvent(new BluetoothEvent('characteristicvaluechanged', {detail: {
      value: characteristic.value
    }}));
  });
});


function BluetoothNode(parent) {
  this._capturingListeners = {};
  this._bubblingListeners = {};
  this._parent = parent;
  this._children = [];
  this._eventHandlers = {};
  if (parent) {
    parent._children.push(this);
  }
}

BluetoothNode.prototype = {
  get parent() {
    return this._parent;
  },
  get children() {
    return this._children;
  },
  get root() {
    return this._parent ? this._parent.root : this;
  },

  removeEventListener: function(type, listener, opt_useCapture) {
    if (!listener) {
      return;
    }

    var listeners = opt_useCapture ? this._capturingListeners : this._bubblingListeners;

    var l = listeners[type] || [];
    var i = l.indexOf(listener);
    if (i >= 0) {
      l.splice(i, 1);
    }
    listeners[type] = l;
  },

  addEventListener: function(type, listener, opt_useCapture) {
    if (!listener) {
      return;
    }

    var listeners = opt_useCapture ? this._capturingListeners : this._bubblingListeners;

    var l = listeners[type] || [];
    if (l.indexOf(listener) < 0) {
      l.push(listener);
    }
    listeners[type] = l;
  },

  dispatchEvent: function(evt) {
    if (!(evt instanceof BluetoothEvent)) {
      throw new Error("Should be a BluetoothEvent");
    }
    if (evt._dispatching) {
      throw new Error("Invalid state");
    }
    evt._trusted = true;

    return this._doDispatch(evt);
  },

  _doDispatch: function(evt, opt_targetOverride) {
    evt._dispatching = true;

    evt.target = opt_targetOverride || this;

    var n = evt.target;
    var eventPath = [];
    while (n.parent) {
      n = n.parent;
      eventPath.push(n);
    }
    eventPath = eventPath.reverse();

    evt.eventPhase = Event.CAPTURING_PHASE;

    for (let p of eventPath) {
      if (evt._stopPropagation) {
        break;
      }

      p._invokeListeners(evt);
    }

    evt.eventPhase = Event.AT_TARGET;
    if (!evt._stopPropagation) {
      evt.target._invokeListeners(evt);
    }

    if (evt.bubbles) {
      eventPath = eventPath.reverse();
      evt.eventPhase = Event.BUBBLING_PHASE;
      for (let p of eventPath) {
        if (evt._stopPropagation) {
          break;
        }
        p._invokeListeners(evt);
      }
    }

    evt._dispatching = false;
    evt.eventPhase = 0;
    evt.currentTarget = null;
    return !evt._canceled;
  },

  _invokeListeners: function(evt) {
    evt.currentTarget = this;

    let listeners = (evt.eventPhase === Event.CAPTURING_PHASE ?
            this._capturingListeners[evt.type] : this._bubblingListeners[evt.type]) || [];


    for (let l of listeners) {
      if (evt._stopImmediatePropagation) {
        return;
      }

      try {
        l.call(evt.currentTarget, evt);
      } catch (e) {
        console.error(e);
      }

    }
  },

  _getHandler: function(key) {
    return this._eventHandlers[key];
  },

  _setHandler: function(key, handler) {
    let old = this._getHandler(key);
    if (old) {
      this.removeEventListener(key, old);
    }
    this._eventHandlers[key] = handler;
    if (handler) {
      this.addEventListener(key, handler);
    }
  }

};
var _extend = function(c, obj) {
  for (var i in obj) {
    if (obj.hasOwnProperty(i)) {
      var getter = obj.__lookupGetter__(i),
          setter = obj.__lookupSetter__(i);
      if (getter||setter) {
        if (getter) {
          c.__defineGetter__(i, getter);
        }
        if (setter) {
          c.__defineSetter__(i, setter);
        }
      } else {
        c[i] = obj[i];
      }
    }
  }
  return c;
};


function CharacteristicEventHandlersNode(parent) {
  BluetoothNode.call(this, parent); // call super constructor.
}
CharacteristicEventHandlersNode.prototype = _extend(Object.create(BluetoothNode.prototype), {
  get oncharacteristicvaluechanged() {
    return this._getHandler("characteristicvaluechanged");
  },

  set oncharacteristicvaluechanged(handler) {
    this._setHandler("characteristicvaluechanged", handler);
  }
});
CharacteristicEventHandlersNode.prototype.constructor = CharacteristicEventHandlersNode;

function ServiceEventHandlersNode(parent) {
  CharacteristicEventHandlersNode.call(this, parent); // call super constructor.
}
ServiceEventHandlersNode.prototype = _extend(Object.create(CharacteristicEventHandlersNode.prototype),{
  get onserviceadded() {
    return this._getHandler("serviceadded");
  },
  set onserviceadded(handler) {
    this._setHandler("serviceadded", handler);
  },

  get onservicechanged() {
    return this._getHandler("servicechanged");
  },
  set onservicechanged(handler) {
    this._setHandler("servicechanged", handler);
  },

  get onserviceremoved() {
    return this._getHandler("serviceremoved");
  },
  set onserviceremoved(handler) {
    this._setHandler("serviceremoved", handler);
  }

});
ServiceEventHandlersNode.prototype.constructor = ServiceEventHandlersNode;


// https://webbluetoothcg.github.io/web-bluetooth/ interface
function BluetoothDevice(chromeDeviceAddress) {
  ServiceEventHandlersNode.call(this, null);
  this._address = chromeDeviceAddress;
};
window.BluetoothDevice = BluetoothDevice;

BluetoothDevice.prototype = _extend(Object.create(ServiceEventHandlersNode.prototype),{
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

  get instanceId() {
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

  connectGATT: function() {
    return this.connect().then(function() {return this}.bind(this));
  },

  connect: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.connect,
                              self._address, {persistent: false}
      ).catch(function(e) {
        if (e == "Device is already connected" || e == "Already connected") {
          return;  // This is a successful connect().
        }
        throw NamedError('NetworkError', self + '.connect() failed: ' + e);
      }).then(function() {
        self._connected = true;
      });
  },

  disconnect: function() {
    var self = this;
    return callChromeFunction(chrome.bluetoothLowEnergy.disconnect, self._address
      ).then(function() {
        self._connected = false;
      }, function(e) {
        throw NamedError('NetworkError', self + '.disconnect() failed: ' + e);
      });
  },

  getPrimaryServices: function(serviceUuids) {
    var self = this;
    return getChildren({
      chromeSearchFunction: chrome.bluetoothLowEnergy.getServices,
      parentChromeId: self._address,
      uuids: serviceUuids,
      uuidCanonicalizer: window.BluetoothUUID.getService,
      webConstructor: function(service) { return updateService(service); },
    });
  },

  getPrimaryService: function(serviceUuid) {
    return firstOrNull(this.getPrimaryServices([serviceUuid]))
  },

  toString: function() {
    return self.instanceId;
  }
});
BluetoothDevice.prototype.constructor = BluetoothDevice;

function BluetoothGattService(webBluetoothDevice, chromeBluetoothService) {
  ServiceEventHandlersNode.call(this,webBluetoothDevice);
  this._device = webBluetoothDevice;
  this._chromeService = chromeBluetoothService;
};
window.BluetoothGattService = BluetoothGattService;

BluetoothGattService.prototype = _extend(Object.create(ServiceEventHandlersNode.prototype),{
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
      uuidCanonicalizer: window.BluetoothUUID.getCharacteristic,
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
      uuidCanonicalizer: window.BluetoothUUID.getService,
      webConstructor: function(service) { return updateService(service); },
    });
  },

  getIncludedService: function(serviceUuid) {
    return firstOrNull(this.getAllIncludedServices([serviceUuid]))
  },
});
BluetoothGattService.prototype.constructor = BluetoothGattService;

var characteristicPropertyNames = ["broadcast", "read", "writeWithoutResponse", "write", "notify", "indicate", "authenticatedSignedWrites", "extendedProperties", "reliableWrite", "writableAuxiliaries"];

function BluetoothGattCharacteristic(webBluetoothService, chromeCharacteristicId) {
  CharacteristicEventHandlersNode.call(this, webBluetoothService);
  this._service = webBluetoothService;
  this._instanceId = chromeCharacteristicId;
};
window.BluetoothGattCharacteristic = BluetoothGattCharacteristic;

BluetoothGattCharacteristic.prototype = _extend(Object.create(CharacteristicEventHandlersNode.prototype),{
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
      uuidCanonicalizer: window.BluetoothUUID.getDescriptor,
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
});
BluetoothGattCharacteristic.prototype.constructor = BluetoothGattCharacteristic;

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

window.BluetoothUUID = {};

window.BluetoothUUID.canonicalUUID = canonicalUUID;

function ResolveUUIDName(tableName) {
  var table = window.BluetoothUUID[tableName];
  return function(name) {
    if (typeof name==="number") {
      return canonicalUUID(name);
    } else if (uuidRegex.test(name)) {
      return name;
    } else if (table.hasOwnProperty(name)) {
      return table[name];
    } else {
      throw new NamedError('SyntaxError', '"' + name + '" is not a known '+tableName+' name.');
    }
  }
}


window.BluetoothUUID.service = {
  alert_notification: canonicalUUID(0x1811),
  automation_io: canonicalUUID(0x1815),
  battery_service: canonicalUUID(0x180F),
  blood_pressure: canonicalUUID(0x1810),
  body_composition: canonicalUUID(0x181B),
  bond_management: canonicalUUID(0x181E),
  continuous_glucose_monitoring: canonicalUUID(0x181F),
  current_time: canonicalUUID(0x1805),
  cycling_power: canonicalUUID(0x1818),
  cycling_speed_and_cadence: canonicalUUID(0x1816),
  device_information: canonicalUUID(0x180A),
  environmental_sensing: canonicalUUID(0x181A),
  generic_access: canonicalUUID(0x1800),
  generic_attribute: canonicalUUID(0x1801),
  glucose: canonicalUUID(0x1808),
  health_thermometer: canonicalUUID(0x1809),
  heart_rate: canonicalUUID(0x180D),
  human_interface_device: canonicalUUID(0x1812),
  immediate_alert: canonicalUUID(0x1802),
  indoor_positioning: canonicalUUID(0x1821),
  internet_protocol_support: canonicalUUID(0x1820),
  link_loss: canonicalUUID(0x1803 ),
  location_and_navigation: canonicalUUID(0x1819),
  next_dst_change: canonicalUUID(0x1807),
  phone_alert_status: canonicalUUID(0x180E),
  pulse_oximeter: canonicalUUID(0x1822),
  reference_time_update: canonicalUUID(0x1806),
  running_speed_and_cadence: canonicalUUID(0x1814),
  scan_parameters: canonicalUUID(0x1813),
  tx_power: canonicalUUID(0x1804),
  user_data: canonicalUUID(0x181C),
  weight_scale: canonicalUUID(0x181D)
}


window.BluetoothUUID.characteristic = {
  "aerobic_heart_rate_lower_limit": canonicalUUID(0x2A7E),
  "aerobic_heart_rate_upper_limit": canonicalUUID(0x2A84),
  "aerobic_threshold": canonicalUUID(0x2A7F),
  "age": canonicalUUID(0x2A80),
  "aggregate": canonicalUUID(0x2A5A),
  "alert_category_id": canonicalUUID(0x2A43),
  "alert_category_id_bit_mask": canonicalUUID(0x2A42),
  "alert_level": canonicalUUID(0x2A06),
  "alert_notification_control_point": canonicalUUID(0x2A44),
  "alert_status": canonicalUUID(0x2A3F),
  "altitude": canonicalUUID(0x2AB3),
  "anaerobic_heart_rate_lower_limit": canonicalUUID(0x2A81),
  "anaerobic_heart_rate_upper_limit": canonicalUUID(0x2A82),
  "anaerobic_threshold": canonicalUUID(0x2A83),
  "analog": canonicalUUID(0x2A58),
  "apparent_wind_direction": canonicalUUID(0x2A73),
  "apparent_wind_speed": canonicalUUID(0x2A72),
  "gap.appearance": canonicalUUID(0x2A01),
  "barometric_pressure_trend": canonicalUUID(0x2AA3),
  "battery_level": canonicalUUID(0x2A19),
  "blood_pressure_feature": canonicalUUID(0x2A49),
  "blood_pressure_measurement": canonicalUUID(0x2A35),
  "body_composition_feature": canonicalUUID(0x2A9B),
  "body_composition_measurement": canonicalUUID(0x2A9C),
  "body_sensor_location": canonicalUUID(0x2A38),
  "bond_management_control_point": canonicalUUID(0x2AA4),
  "bond_management_feature": canonicalUUID(0x2AA5),
  "boot_keyboard_input_report": canonicalUUID(0x2A22),
  "boot_keyboard_output_report": canonicalUUID(0x2A32),
  "boot_mouse_input_report": canonicalUUID(0x2A33),
  "gap.central_address_resolution_support": canonicalUUID(0x2AA6),
  "cgm_feature": canonicalUUID(0x2AA8),
  "cgm_measurement": canonicalUUID(0x2AA7),
  "cgm_session_run_time": canonicalUUID(0x2AAB),
  "cgm_session_start_time": canonicalUUID(0x2AAA),
  "cgm_specific_ops_control_point": canonicalUUID(0x2AAC),
  "cgm_status": canonicalUUID(0x2AA9),
  "csc_feature": canonicalUUID(0x2A5C),
  "csc_measurement": canonicalUUID(0x2A5B),
  "current_time": canonicalUUID(0x2A2B),
  "cycling_power_control_point": canonicalUUID(0x2A66),
  "cycling_power_feature": canonicalUUID(0x2A65),
  "cycling_power_measurement": canonicalUUID(0x2A63),
  "cycling_power_vector": canonicalUUID(0x2A64),
  "database_change_increment": canonicalUUID(0x2A99),
  "date_of_birth": canonicalUUID(0x2A85),
  "date_of_threshold_assessment": canonicalUUID(0x2A86),
  "date_time": canonicalUUID(0x2A08),
  "day_date_time": canonicalUUID(0x2A0A),
  "day_of_week": canonicalUUID(0x2A09),
  "descriptor_value_changed": canonicalUUID(0x2A7D),
  "gap.device_name": canonicalUUID(0x2A00),
  "dew_point": canonicalUUID(0x2A7B),
  "digital": canonicalUUID(0x2A56),
  "dst_offset": canonicalUUID(0x2A0D),
  "elevation": canonicalUUID(0x2A6C),
  "email_address": canonicalUUID(0x2A87),
  "exact_time_256": canonicalUUID(0x2A0C),
  "fat_burn_heart_rate_lower_limit": canonicalUUID(0x2A88),
  "fat_burn_heart_rate_upper_limit": canonicalUUID(0x2A89),
  "firmware_revision_string": canonicalUUID(0x2A26),
  "first_name": canonicalUUID(0x2A8A),
  "five_zone_heart_rate_limits": canonicalUUID(0x2A8B),
  "floor_number": canonicalUUID(0x2AB2),
  "gender": canonicalUUID(0x2A8C),
  "glucose_feature": canonicalUUID(0x2A51),
  "glucose_measurement": canonicalUUID(0x2A18),
  "glucose_measurement_context": canonicalUUID(0x2A34),
  "gust_factor": canonicalUUID(0x2A74),
  "hardware_revision_string": canonicalUUID(0x2A27),
  "heart_rate_control_point": canonicalUUID(0x2A39),
  "heart_rate_max": canonicalUUID(0x2A8D),
  "heart_rate_measurement": canonicalUUID(0x2A37),
  "heat_index": canonicalUUID(0x2A7A),
  "height": canonicalUUID(0x2A8E),
  "hid_control_point": canonicalUUID(0x2A4C),
  "hid_information": canonicalUUID(0x2A4A),
  "hip_circumference": canonicalUUID(0x2A8F),
  "humidity": canonicalUUID(0x2A6F),
  "ieee_11073-20601_regulatory_certification_data_list": canonicalUUID(0x2A2A),
  "indoor_positioning_configuration": canonicalUUID(0x2AAD),
  "intermediate_blood_pressure": canonicalUUID(0x2A36),
  "intermediate_temperature": canonicalUUID(0x2A1E),
  "irradiance": canonicalUUID(0x2A77),
  "language": canonicalUUID(0x2AA2),
  "last_name": canonicalUUID(0x2A90),
  "latitude": canonicalUUID(0x2AAE),
  "ln_control_point": canonicalUUID(0x2A6B),
  "ln_feature": canonicalUUID(0x2A6A),
  "local_east_coordinate.xml": canonicalUUID(0x2AB1),
  "local_north_coordinate": canonicalUUID(0x2AB0),
  "local_time_information": canonicalUUID(0x2A0F),
  "location_and_speed": canonicalUUID(0x2A67),
  "location_name": canonicalUUID(0x2AB5),
  "longitude": canonicalUUID(0x2AAF),
  "magnetic_declination": canonicalUUID(0x2A2C),
  "magnetic_flux_density_2D": canonicalUUID(0x2AA0),
  "magnetic_flux_density_3D": canonicalUUID(0x2AA1),
  "manufacturer_name_string": canonicalUUID(0x2A29),
  "maximum_recommended_heart_rate": canonicalUUID(0x2A91),
  "measurement_interval": canonicalUUID(0x2A21),
  "model_number_string": canonicalUUID(0x2A24),
  "navigation": canonicalUUID(0x2A68),
  "new_alert": canonicalUUID(0x2A46),
  "gap.peripheral_preferred_connection_parameters": canonicalUUID(0x2A04),
  "gap.peripheral_privacy_flag": canonicalUUID(0x2A02),
  "plx_continuous_measurement": canonicalUUID(0x2A5F),
  "plx_features": canonicalUUID(0x2A60),
  "plx_spot_check_measurement": canonicalUUID(0x2A5E),
  "pnp_id": canonicalUUID(0x2A50),
  "pollen_concentration": canonicalUUID(0x2A75),
  "position_quality": canonicalUUID(0x2A69),
  "pressure": canonicalUUID(0x2A6D),
  "protocol_mode": canonicalUUID(0x2A4E),
  "rainfall": canonicalUUID(0x2A78),
  "gap.reconnection_address": canonicalUUID(0x2A03),
  "record_access_control_point": canonicalUUID(0x2A52),
  "reference_time_information": canonicalUUID(0x2A14),
  "report": canonicalUUID(0x2A4D),
  "report_map": canonicalUUID(0x2A4B),
  "resting_heart_rate": canonicalUUID(0x2A92),
  "ringer_control_point": canonicalUUID(0x2A40),
  "ringer_setting": canonicalUUID(0x2A41),
  "rsc_feature": canonicalUUID(0x2A54),
  "rsc_measurement": canonicalUUID(0x2A53),
  "sc_control_point": canonicalUUID(0x2A55),
  "scan_interval_window": canonicalUUID(0x2A4F),
  "scan_refresh": canonicalUUID(0x2A31),
  "sensor_location": canonicalUUID(0x2A5D),
  "serial_number_string": canonicalUUID(0x2A25),
  "gatt.service_changed": canonicalUUID(0x2A05),
  "software_revision_string": canonicalUUID(0x2A28),
  "sport_type_for_aerobic_and_anaerobic_thresholds": canonicalUUID(0x2A93),
  "supported_new_alert_category": canonicalUUID(0x2A47),
  "supported_unread_alert_category": canonicalUUID(0x2A48),
  "system_id": canonicalUUID(0x2A23),
  "temperature": canonicalUUID(0x2A6E),
  "temperature_measurement": canonicalUUID(0x2A1C),
  "temperature_type": canonicalUUID(0x2A1D),
  "three_zone_heart_rate_limits": canonicalUUID(0x2A94),
  "time_accuracy": canonicalUUID(0x2A12),
  "time_source": canonicalUUID(0x2A13),
  "time_update_control_point": canonicalUUID(0x2A16),
  "time_update_state": canonicalUUID(0x2A17),
  "time_with_dst": canonicalUUID(0x2A11),
  "time_zone": canonicalUUID(0x2A0E),
  "true_wind_direction": canonicalUUID(0x2A71),
  "true_wind_speed": canonicalUUID(0x2A70),
  "two_zone_heart_rate_limit": canonicalUUID(0x2A95),
  "tx_power_level": canonicalUUID(0x2A07),
  "uncertainty": canonicalUUID(0x2AB4),
  "unread_alert_status": canonicalUUID(0x2A45),
  "user_control_point": canonicalUUID(0x2A9F),
  "user_index": canonicalUUID(0x2A9A),
  "uv_index": canonicalUUID(0x2A76),
  "vo2_max": canonicalUUID(0x2A96),
  "waist_circumference": canonicalUUID(0x2A97),
  "weight": canonicalUUID(0x2A98),
  "weight_measurement": canonicalUUID(0x2A9D),
  "weight_scale_feature": canonicalUUID(0x2A9E),
  "wind_chill": canonicalUUID(0x2A79)
};

window.BluetoothUUID.descriptor = {
  "gatt.characteristic_extended_properties": canonicalUUID(0x2900),
  "gatt.characteristic_user_description": canonicalUUID(0x2901),
  "gatt.client_characteristic_configuration": canonicalUUID(0x2902),
  "gatt.server_characteristic_configuration": canonicalUUID(0x2903),
  "gatt.characteristic_presentation_format": canonicalUUID(0x2904),
  "gatt.characteristic_aggregate_format": canonicalUUID(0x2905),
  "valid_range": canonicalUUID(0x2906),
  "external_report_reference": canonicalUUID(0x2907),
  "report_reference": canonicalUUID(0x2908),
  "value_trigger_setting": canonicalUUID(0x290A),
  "es_configuration": canonicalUUID(0x290B),
  "es_measurement": canonicalUUID(0x290C),
  "es_trigger_setting": canonicalUUID(0x290D)
};
  
window.BluetoothUUID.getService = ResolveUUIDName('service');
window.BluetoothUUID.getCharacteristic = ResolveUUIDName('characteristic');
window.BluetoothUUID.getDescriptor = ResolveUUIDName('descriptor');


navigator.bluetooth.requestDevice = function(requestDeviceOptions) {
  var filters = requestDeviceOptions.filters;
  return new Promise(function(resolve, reject) {
    var requestDeviceDialog = document.createElement('web-bluetooth-request-device-dialog');
    document.body.appendChild(requestDeviceDialog);

    filters = filters.map(function(filter) {
      return {
        services: filter.services.map(window.BluetoothUUID.getService)
      };
    });
    var options = {
      optionalServices: requestDeviceOptions.optionalServices || [],
      connectForServices: requestDeviceOptions.connectForServices || false,
    };

    var resolved = false;
    var requestDeviceInfo = {
      filters: filters,
      options: options,
      origin: new URL(document.URL).origin,
      originName: chrome.runtime.getManifest().name,
      resolve: function(chromeDevice) {
        resolved = true;
        resolve(updateDevice(chromeDevice));
      },
      reject: function() {
        resolved = true;
        reject.apply(null, arguments);
      },
    };

    var dialogClosedListener = function() {
      if (!resolved) {
        reject(NamedError('NotFoundError', 'Cancelled'));
      }
      chrome.bluetooth.stopDiscovery(function() {
        chrome.runtime.lastError;  // Ignore errors.
      });
      requestDeviceDialog.removeEventListener('iron-overlay-closed', dialogClosedListener);
      document.body.removeChild(requestDeviceDialog);
    };

    requestDeviceDialog.addEventListener('iron-overlay-closed', dialogClosedListener);
    requestDeviceDialog.requestDevice(requestDeviceInfo);
  });
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

// Local helper functions:

//
// Parameters in the options struct:
//   chromeSearchFunction: the chrome.bluetoothLowEnergy function that searches for children.
//   parentChromeId: the instance ID or address of the chrome-side parent object.
//   uuids: an Array listing the uuids of children to return.
//          |undefined| means to return all children.
//   uuidCanonicalizer: funcction that cannonicalizes uuids.
//   webConstructor: the constructor of the web-side instances.
//                   Will be passed the chrome-side instance, and may return a Promise.
function getChildren(options) {
  if (typeof options.uuids === 'string') {
    options.uuids = [options.uuids];
  }
  if (options.uuids !== undefined) {
    options.uuids = options.uuids.map(options.uuidCanonicalizer);
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

function NamedError(name, message) {
  var e = new Error(message || '');
  e.name = name;
  return e;
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
