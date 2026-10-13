'use strict';
function b64(arr) { try { return Java.use('android.util.Base64').encodeToString(arr, 2); } catch (e) { return ''; } }
function slice(b, off, n) { return Java.use('java.util.Arrays').copyOfRange(b, off, off + n); }
function whenJavaReady(cb) {
  if (typeof Java !== 'undefined' && Java.available) { Java.perform(cb); }
  else { setTimeout(function () { whenJavaReady(cb); }, 50); }
}
whenJavaReady(function () {
  var OUT = 'com.android.org.conscrypt.ConscryptEngineSocket$SSLOutputStream';
  var IN = 'com.android.org.conscrypt.ConscryptEngineSocket$SSLInputStream';

  var SO = Java.use(OUT);
  var w3 = SO.write.overload('[B', 'int', 'int');
  w3.implementation = function (b, off, len) {
    send({ dir: 'req', n: len, cid: Java.use('java.lang.System').identityHashCode(this), b64: b64(slice(b, off, len)) });
    return w3.call(this, b, off, len);
  };
  var w1 = SO.write.overload('[B');
  w1.implementation = function (b) {
    send({ dir: 'req', n: b.length, cid: Java.use('java.lang.System').identityHashCode(this), b64: b64(b) });
    return w1.call(this, b);
  };


  var w0 = SO.write.overload('int');
  w0.implementation = function (x) {
    // capture the single byte properly
    var arr = Java.array('byte', [ (x & 0xff) > 127 ? (x & 0xff) - 256 : (x & 0xff) ]);
    send({ dir: 'req', n: 1, cid: Java.use('java.lang.System').identityHashCode(this), b64: b64(arr) });
    return w0.call(this, x);
  };
  var SI = Java.use(IN);
  var r3 = SI.read.overload('[B', 'int', 'int');
  r3.implementation = function (b, off, len) {
    var n = r3.call(this, b, off, len);
    if (n > 0) send({ dir: 'resp', n: n, cid: Java.use('java.lang.System').identityHashCode(this), b64: b64(slice(b, off, n)) });
    return n;
  };
  var r1 = SI.read.overload('[B');
  r1.implementation = function (b) {
    var n = r1.call(this, b);
    if (n > 0) send({ dir: 'resp', n: n, cid: Java.use('java.lang.System').identityHashCode(this), b64: b64(slice(b, 0, n)) });
    return n;
  };
  send('[dump4] bidirectional plaintext hooks installed');
});
