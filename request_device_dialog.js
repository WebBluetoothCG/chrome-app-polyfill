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
  self.matchesFilters = uuidsMatchFilters(self.initialUuids, self.filters);
}

DeviceView.prototype.updateFrom = function(sourceDevice) {
  var self = this;
  Object.keys(sourceDevice).forEach(function(key) {
    self.device[key] = sourceDevice[key];
  });
  self.name = self.device.name;
  self.connected = self.device.connected;
  // TODO(jyasskin): When path loss (Tx Power - RSSI) is available on
  // sourceDevice, use that to update here.
  self.updatePathLoss(0);
}

DeviceView.prototype.updatePathLoss = function(newPathLoss) {
  if (newPathLoss === this.pathLoss) {
    return;
  }
  this.pathLoss = newPathLoss;
  // TODO(jyasskin): Use a threshold that's not totally made up.
  if (this.pathLoss < 15) {
    this.distance = "Near";
  } else {
    this.distance = "Far";
  }
}

Polymer('web-bluetooth-request-device-dialog', {
  created: function() {
    var self = this;
    this.onDeviceAddedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index != -1) {
        console.error('chrome.bluetooth.onDeviceAdded called for existing device:', device);
      }
      self.devices.push(new DeviceView(device, self.requestDeviceInfo));
      self.updateMatchedDevices();
    };

    this.onDeviceChangedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index == -1) {
        console.error('chrome.bluetooth.onDeviceChanged called for non-existent device:', device);
      } else {
        self.devices[index].updateFrom(device);
        self.updateMatchedDevices();
      }
    };

    this.onDeviceRemovedListener = function(device) {
      var index = findDeviceIndexByAddress(self.devices, device);
      if (index == -1) {
        console.error('chrome.bluetooth.onDeviceRemoved called for non-existent device:', device);
      } else {
        self.devices.splice(index, 1);
        self.updateMatchedDevices();
      }
    };
  },

  updateMatchedDevices: function() {
    this.matchedDevices = this.devices.filter(function(device) {
      return device.matchesFilters;
    });
  },

  dialogClosed: function() {
    var self = this;
    if (self.rejectOnClose) {
      var e = new Error('Cancelled');
      e.name = 'NotFoundError';
      self.requestDeviceInfo.reject(e);
    }
    clearTimeout(self.stopScanningTimeout);

    chrome.bluetooth.onDeviceAdded.removeListener(self.onDeviceAddedListener);
    chrome.bluetooth.onDeviceChanged.removeListener(self.onDeviceChangedListener);
    chrome.bluetooth.onDeviceRemoved.removeListener(self.onDeviceRemovedListener);
  },

  cancelled: function() {
    this.$.deviceSelectorDialog.close();
  },

  selected: function() {
    if (!this.$.deviceSelector.selected) {
      // Do nothing if nothing was selected.
      return;
    }
    this.rejectOnClose = false;
    this.requestDeviceInfo.resolve(this.$.deviceSelector.selectedModel.device.device);
    this.$.deviceSelectorDialog.close();
  },

  selectPrevious: function() {
    this.$.deviceSelector.selectPrevious();
  },

  selectNext: function() {
    this.$.deviceSelector.selectNext();
  },

  requestDevice: function(requestDeviceInfo) {
    this.requestDeviceInfo = requestDeviceInfo;
    this.rejectOnClose = true;
    this.devices = [];
    this.origin = this.requestDeviceInfo.originName;
    this.scanning = true;
    this.$.deviceSelectorDialog.open();

    var self = this;
    chrome.bluetooth.getDevices(function(devices) {
      self.devices = devices.map(function(btDevice) {
        return new DeviceView(btDevice, self.requestDeviceInfo);
      });
      self.updateMatchedDevices();

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
          self.scanning = false;
          return;
        }
        var T_GAP_gen_disc_scan_min = 10240;  // 10.24 seconds
        self.stopScanningTimeout = setTimeout(function() {
          self.scanning = false;
        }, T_GAP_gen_disc_scan_min);
      });
    });
  }
});

})();
