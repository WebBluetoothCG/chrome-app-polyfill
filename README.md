# A Web Bluetooth polyfill for Chrome Apps

The `bluetooth.js` script will add a `navigator.bluetooth` attribute that behaves as specified
in the [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/),
modulo bugs, incomplete features, and changes to the spec since the polyfill was implemented.
We provide an HTML file for use with HTML Imports as `<link rel="import" href="bluetooth.html">`.

To use this polyfill,
add a ["bluetooth" section](https://developer.chrome.com/apps/app_bluetooth#manifest)
to your Chrome App manifest,
listing the GATT Service UUIDs you want to use:

```json
"bluetooth": {
  "low_energy": true,
  "uuids": [ "..." ]
}
```


## Known incomplete features

`navigator.bluetooth.requestDevice` is absent.
For now, use [`chrome.bluetooth.getDevices()`](https://developer.chrome.com/apps/bluetooth#method-getDevices)
to retrieve devices known to the Chrome Apps system,
and then open them in the Web Bluetooth polyfill
with `navigator.bluetooth.getDevice(chromeDevice.address)`.

Event bubbling and service change events aren't implemented.
Listen for the `characteristicvaluechanged` event directly on `navigator.bluetooth`.

None of the UUID constants are defined.
