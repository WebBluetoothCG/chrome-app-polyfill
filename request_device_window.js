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

// Run at load instead of immediately so that the chrome.app.window.create
// callback can add window properties first.
addEventListener('load', function () {
'use strict';

window.onerror = function(error) {
  requestDeviceInfo.reject(error);
  window.close();
}

var model = document.querySelector('#model');

model.cancelled = function() {
  requestDeviceInfo.reject(new Error('NotFoundError'));
  window.close();
};

model.selected = function() {
  requestDeviceInfo.resolve(model.$.deviceSelector.selectedModel.device);
  window.close();
}

model.filterDevices = function(devices) {
  function matchesFilter(device, filter) {
    return filter.services.every(function(service) {
      return device.uuids.contains(service);
    });
  }
  function matchesFilters(device) {
    return window.requestDeviceInfo.filters.some(function(filter) {
      matchesFilter(device, filter);
    })
  };
  return devices.filter(matchesFilters);
}

model.origin = requestDeviceInfo.origin;
model.devices = [];

chrome.bluetooth.getDevices(function(devices) {
  model.devices = devices;

  chrome.bluetooth.onDeviceAdded.addListener(function(device) {
    var index = findDeviceIndexByAddress(model.devices, device);
    if (index != -1) {
      console.error('chrome.bluetooth.onDeviceAdded called for existing device:', device);
    }
    model.devices.push(device);
  });
  chrome.bluetooth.onDeviceChanged.addListener(function(device) {
    var index = findDeviceIndexByAddress(model.devices, device);
    if (index == -1) {
      console.error('chrome.bluetooth.onDeviceChanged called for non-existent device:', device);
    } else {
      Object.keys(device).forEach(function(key) {
        model.devices[index][key] = device[key];
      });
    }
  });
  chrome.bluetooth.onDeviceRemoved.addListener(function(device) {
    var index = findDeviceIndexByAddress(model.devices, device);
    if (index == -1) {
      console.error('chrome.bluetooth.onDeviceRemoved called for non-existent device:', device);
    } else {
      model.devices.splice(index, 1);
    }
  });
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

});
