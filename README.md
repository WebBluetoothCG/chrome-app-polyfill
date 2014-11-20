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

Event bubbling and service change events aren't implemented.
Listen for the `characteristicvaluechanged` event directly on `navigator.bluetooth`.

Only the service UUID constants are defined.

## Extensions

`navigator.bluetooth.requestDevice` extends [`RequestDeviceOptions`](https://webbluetoothcg.github.io/web-bluetooth/#idl-def-RequestDeviceOptions)
to include a `connectForServices` boolean,
which selects between filtering on maybe only the advertised GATT services,
vs discovering all services on the device before filtering.
