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

(function() {
'use strict';

if (!Array.prototype.findIndex) {
  Array.prototype.findIndex = function(callback, thisArg) {
    for (var i = 0; i < this.length; ++i) {
      if (callback.call(thisArg, this[i], i, this)) {
        return i;
      }
    }
    return -1;
  }
}

if (!Array.prototype.contains) {
  Array.prototype.contains = function(searchElement, fromIndex) {
    fromIndex = fromIndex || 0;
    for (var i = fromIndex; i < this.length; ++i) {
      if (this[i] === searchElement) {
        return true;
      }
    }
    return false;
  }
}

function findDeviceIndexByAddress(arr, device) {
  return arr.findIndex(function(elem) { return elem.address === device.address });
}

function uuidsMatchFilters(serviceUuids, filters) {
  return filters.some(function(filter) {
    return filter.services.every(function(service) {
      return serviceUuids.contains(service);
    });
  });
};

function DeviceView(bluetoothDevice, requestDeviceInfo) {
  var self = this;

  self.device = bluetoothDevice;
  self.filters = requestDeviceInfo.filters;
  self.options = requestDeviceInfo.options;
  self.address = self.device.address;
  self.updateFrom(bluetoothDevice);
  self.initialUuids = self.device.uuids || [];
  self.allUuids = self.initialUuids;
  self.matchesFilters = uuidsMatchFilters(self.initialUuids, self.filters);
  self.initiallyConnected = self.device.connected;

  // Try to connect, to populate the 'connectable' property.
  chrome.bluetoothLowEnergy.connect(self.device.address, function() {
    if (chrome.runtime.lastError) {
      console.log("Could not connect to", self.device.address, chrome.runtime.lastError.message);
      return;
    }
    chrome.bluetoothLowEnergy.getServices(self.device.address, function(services) {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      self.allUuids = services.map(function(service) {
        return services.isPrimary ? service.uuid : null;
      }).filter(function(uuid) { return uuid !== null; });
      if (self.options.connectForServices) {
        // The real implementation would avoid connecting or discovering
        // services if !connectForServices, but this is simpler, and will
        // still let us see the result.
        self.matchesFilters = uuidsMatchFilters(self.allUuids, self.filters);
      }
      if (!self.initiallyConnected) {
        chrome.bluetoothLowEnergy.disconnect(self.device.address, function() {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            return;
          }
        });
      }
    });
  })
}

DeviceView.prototype.updateFrom = function(sourceDevice) {
  var self = this;
  Object.keys(sourceDevice).forEach(function(key) {
    self.device[key] = sourceDevice[key];
  });
  self.name = self.device.name;
  self.connected = self.device.connected;
  if (self.connected) {
    self.connectable = true;
  }
}

Polymer('request-device-window', {
  created: function() {
    var self = this;
    this.onDeviceAddedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index != -1) {
        console.error('chrome.bluetooth.onDeviceAdded called for existing device:', device);
      }
      self.devices.push(new DeviceView(device, self.requestDeviceInfo));
    };

    this.onDeviceChangedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index == -1) {
        console.error('chrome.bluetooth.onDeviceChanged called for non-existent device:', device);
      } else {
        self.devices[index].updateFrom(device);
      }
    };

    this.onDeviceRemovedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index == -1) {
        console.error('chrome.bluetooth.onDeviceRemoved called for non-existent device:', device);
      } else {
        self.devices.splice(index, 1);
      }
    };
  },

  closeDialog: function() {
    this.$.deviceSelectorDialog.style.display = "none";
    chrome.bluetooth.onDeviceAdded.removeListener(this.onDeviceAddedListener);
    chrome.bluetooth.onDeviceChanged.removeListener(this.onDeviceChangedListener);
    chrome.bluetooth.onDeviceRemoved.removeListener(this.onDeviceRemovedListener);

    chrome.bluetooth.stopDiscovery(function() {
      chrome.runtime.lastError;  // Ignore errors.
    });
  },

  cancelled: function() {
    this.requestDeviceInfo.reject(new Error('NotFoundError'));
    this.closeDialog();
  },

  selected: function() {
    if (!this.$.deviceSelector.selected) {
      // Do nothing if nothing was selected.
      return;
    }
    this.requestDeviceInfo.resolve(this.$.deviceSelector.selectedModel.device.device);
    this.closeDialog();
  },

  selectPrevious: function() {
    this.$.deviceSelector.selectPrevious();
  },

  selectNext: function() {
    this.$.deviceSelector.selectNext();
  },

  requestDevice: function(requestDeviceInfo) {
    this.requestDeviceInfo = requestDeviceInfo;
    this.devices = [];
    this.origin = this.requestDeviceInfo.origin;
    this.$.deviceSelectorDialog.style.display = "inline";

    var self = this;
    chrome.bluetooth.getDevices(function(devices) {
      self.devices = devices.map(function(btDevice) {
        return new DeviceView(btDevice, self.requestDeviceInfo);
      });

      chrome.bluetooth.onDeviceAdded.addListener(self.onDeviceAddedListener);
      chrome.bluetooth.onDeviceChanged.addListener(self.onDeviceChangedListener);
      chrome.bluetooth.onDeviceRemoved.addListener(self.onDeviceRemovedListener);
    });

    chrome.bluetooth.stopDiscovery(function() {
      // startDiscovery sometimes fails ("Starting discovery failed") because the
      // app has already started discovery, but discovery isn't actually running.
      // Stopping and starting works around this.
      chrome.runtime.lastError;
      chrome.bluetooth.startDiscovery(function() {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
        }
      });
    });
  }
});

})();
